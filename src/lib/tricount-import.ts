export { looksLikeTricountCsv } from '@/lib/tricount-detect'
import { getCurrency } from '@/lib/currency'
import { parseIsoDateTimeAsUtc } from '@/lib/imports/date'
import { SEEDED_CATEGORIES } from '@/lib/kv/categories'
import type { Expense, Participant } from '@/lib/kv/types'
import { SplitMode } from '@/lib/kv/types'
import { randomId } from '@/lib/randomId'

const rateCache = new Map<string, number>()

async function getExchangeRate(
  date: Date,
  base: string,
  target: string,
): Promise<number | null> {
  if (base === target) return 1
  const dateString = date.toISOString().split('T')[0]
  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v2/rates?date=${dateString}&base=${base}&quotes=${target}`,
    )
    if (res.ok) {
      const data = (await res.json()) as { quote: string; rate: number }[]
      const rate = data.find(({ quote }) => quote === target)?.rate
      if (rate) return rate
    }
  } catch {
    return null
  }
  return null
}

async function getRate(
  date: Date,
  base: string,
  target: string,
): Promise<number | null> {
  const dateString = date.toISOString().split('T')[0]
  const cacheKey = `${dateString}_${base}_${target}`
  if (rateCache.has(cacheKey)) return rateCache.get(cacheKey)!
  const rate = await getExchangeRate(date, base, target)
  if (rate == null) return null
  rateCache.set(cacheKey, rate)
  return rate
}

function parseCSV(text: string): string[][] {
  const lines: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i]
    const nextChar = cleanText[i + 1]

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      lines.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field || row.length > 0) {
    row.push(field)
    lines.push(row)
  }
  return lines.filter((r) => r.length > 0)
}

function toIsoDateOnly(date: Date): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  ).toISOString()
}

function findCategoryId(
  tricountCategory: string,
  isReimbursement: boolean,
): number {
  if (isReimbursement) return 1
  const normalized = tricountCategory.toLowerCase().trim()
  if (!normalized || normalized === 'no category') return 0
  const match = SEEDED_CATEGORIES.find(
    (c) =>
      c.name.toLowerCase() === normalized ||
      c.grouping.toLowerCase() === normalized,
  )
  return match ? match.id : 0
}

const MAX_REPORTED_ERRORS = 5

/**
 * Makes the entries add up to `total` by moving single minor units, which
 * absorbs the rounding of converting each participant's column separately.
 * The largest entries take the units first. A gap of more than one unit per
 * entry is not rounding, so the entries are left alone and false is returned.
 */
function absorbRounding(entries: { cents: number }[], total: number): boolean {
  const gap = total - entries.reduce((sum, e) => sum + e.cents, 0)
  if (gap === 0) return true
  if (Math.abs(gap) > entries.length) return false
  const step = Math.sign(gap)
  const order = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.cents - a.entry.cents || a.index - b.index)
  for (let i = 0; i < Math.abs(gap); i++) order[i].entry.cents += step
  return entries.every((e) => e.cents > 0)
}

export type ParsedTricountGroup = {
  name: string
  currency: string
  currencyCode: string
  participants: Participant[]
  expenses: Expense[]
}

export async function parseTricountCsv(
  csvText: string,
  targetCurrencyCode?: string,
): Promise<ParsedTricountGroup> {
  const rows = parseCSV(csvText)
  if (rows.length < 2) {
    throw new Error('CSV file is empty or invalid')
  }
  const headers = rows[0]

  const titleIdx = headers.indexOf('Title')
  const amountIdx = headers.indexOf('Amount')
  const currencyIdx = headers.indexOf('Currency')
  const exchangeRateIdx = headers.indexOf('Exchange rate')
  const amountInDefaultIdx = headers.findIndex((h) =>
    h.startsWith('Amount in default currency'),
  )
  const categoryIdx = headers.indexOf('Category')
  const paidByIdx = headers.indexOf('Paid by')
  const dateTimeIdx = headers.indexOf('Date & time')

  const participantNames: string[] = []
  const participantMap = new Map<
    string,
    { paidByIdx: number; impactedIdx: number }
  >()

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]
    if (header.startsWith('Paid by ') && header !== 'Paid by') {
      const name = header.substring('Paid by '.length).trim()
      if (name) {
        if (!participantMap.has(name)) {
          participantMap.set(name, { paidByIdx: -1, impactedIdx: -1 })
        }
        participantMap.get(name)!.paidByIdx = i
        if (!participantNames.includes(name)) participantNames.push(name)
      }
    } else if (header.startsWith('Impacted to ')) {
      const name = header.substring('Impacted to '.length).trim()
      if (name) {
        if (!participantMap.has(name)) {
          participantMap.set(name, { paidByIdx: -1, impactedIdx: -1 })
        }
        participantMap.get(name)!.impactedIdx = i
        if (!participantNames.includes(name)) participantNames.push(name)
      }
    }
  }

  const hasPerPersonPaidBy = Array.from(participantMap.values()).some(
    (p) => p.paidByIdx !== -1,
  )

  if (
    titleIdx === -1 ||
    amountIdx === -1 ||
    currencyIdx === -1 ||
    dateTimeIdx === -1 ||
    (paidByIdx === -1 && !hasPerPersonPaidBy)
  ) {
    throw new Error(
      'Invalid Tricount CSV format: missing required columns (Title, Amount, Currency, Date & time, Paid by)',
    )
  }

  let defaultCurrencyCode = 'EUR'
  if (amountInDefaultIdx !== -1) {
    const match = headers[amountInDefaultIdx].match(/\(([^)]+)\)/)
    if (match) defaultCurrencyCode = match[1]
  }

  const resolvedTarget = (
    targetCurrencyCode || defaultCurrencyCode
  ).toUpperCase()

  if (participantNames.length === 0) {
    throw new Error('No participants found in the Tricount CSV')
  }

  let groupName = 'Imported Tricount Group'
  for (let i = rows.length - 1; i >= 0; i--) {
    const cell = rows[i]?.[0]
    if (!cell) continue
    const groupNameMatch = cell.match(/^tricount (.*) - Exported on /i)
    if (groupNameMatch) {
      groupName = groupNameMatch[1]
      break
    }
  }

  const groupId = randomId()
  const targetCurrency = getCurrency(resolvedTarget)
  const participants: Participant[] = participantNames.map((name) => ({
    id: randomId(),
    name,
    groupId,
  }))
  const participantDbIds = new Map(
    participants.map((p) => [p.name, p.id] as const),
  )

  // Every cell the parser reads; a data row shorter than this is malformed.
  const usedIndices = [
    titleIdx,
    amountIdx,
    currencyIdx,
    exchangeRateIdx,
    amountInDefaultIdx,
    categoryIdx,
    paidByIdx,
    dateTimeIdx,
    ...Array.from(participantMap.values()).flatMap((p) => [
      p.paidByIdx,
      p.impactedIdx,
    ]),
  ]
  const minCells = Math.max(...usedIndices) + 1

  const isSkippableRow = (row: string[]) =>
    row.every((cell) => cell.trim() === '') ||
    (row[0].startsWith('tricount ') && row[0].includes(' - Exported on'))

  const expenses: Expense[] = []
  const errors: string[] = []
  const rateByCurrency = new Map<string, number>()
  if (exchangeRateIdx !== -1 && currencyIdx !== -1) {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      if (r.length < minCells) continue
      const code = r[currencyIdx]
      const rate = parseFloat(r[exchangeRateIdx])
      if (code && rate && !Number.isNaN(rate) && !rateByCurrency.has(code)) {
        rateByCurrency.set(code, rate)
      }
    }
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]
    if (isSkippableRow(row)) continue

    // The header is row 1, so data rows are numbered as a spreadsheet shows them.
    const rowTitle = row[titleIdx]
    const rowLabel = `Row ${rowIndex + 1}${rowTitle ? ` ("${rowTitle}")` : ''}`
    const rowError = (message: string) => {
      errors.push(`${rowLabel}: ${message}`)
    }

    if (row.length < minCells) {
      rowError(`has ${row.length} cells, expected at least ${minCells}`)
      continue
    }

    const title = row[titleIdx] || 'Untitled'
    const amountStr = row[amountIdx]
    const currencyStr = row[currencyIdx]
    const amountInDefaultStr =
      amountInDefaultIdx !== -1 ? row[amountInDefaultIdx] : amountStr

    const amountOriginalVal = parseFloat(amountStr)
    if (!amountStr || !Number.isFinite(amountOriginalVal)) {
      rowError(`invalid amount "${amountStr}"`)
      continue
    }
    const amountDefaultVal = parseFloat(amountInDefaultStr || amountStr)
    if (!Number.isFinite(amountDefaultVal)) {
      rowError(`invalid amount in default currency "${amountInDefaultStr}"`)
      continue
    }

    const isReimbursement =
      title.toLowerCase().includes('recouvrement de dette') ||
      title.toLowerCase().includes('repayment') ||
      title.toLowerCase().includes('reimbursement')

    const categoryName = categoryIdx !== -1 ? row[categoryIdx] : ''
    const categoryId = findCategoryId(categoryName, isReimbursement)

    const dateCell = row[dateTimeIdx]
    const expenseDateTime = parseIsoDateTimeAsUtc(dateCell)
    if (!expenseDateTime) {
      rowError(`invalid date "${dateCell}", expected YYYY-MM-DD HH:mm:ss`)
      continue
    }

    let targetToDefaultRate = 1
    if (resolvedTarget !== defaultCurrencyCode) {
      const mapped = rateByCurrency.get(resolvedTarget)
      if (mapped) {
        targetToDefaultRate = mapped
      } else {
        const fetchedRate = await getRate(
          expenseDateTime,
          resolvedTarget,
          defaultCurrencyCode,
        )
        if (fetchedRate == null) {
          throw new Error(
            `No exchange rate for ${resolvedTarget} to ${defaultCurrencyCode} on ${expenseDateTime.toISOString().slice(0, 10)}`,
          )
        }
        targetToDefaultRate = fetchedRate
      }
    }

    const targetCurrencyDigits = targetCurrency.decimal_digits ?? 2
    let amountCents = 0
    let originalAmountCents: number | null = null
    let originalCurrencyCode: string | null = null
    let conversionRateVal: number | null = null

    if (currencyStr === resolvedTarget) {
      amountCents = Math.round(amountOriginalVal * 10 ** targetCurrencyDigits)
    } else {
      const amountTargetVal = amountDefaultVal / targetToDefaultRate
      amountCents = Math.round(amountTargetVal * 10 ** targetCurrencyDigits)
      const origCurrency = getCurrency(currencyStr)
      originalAmountCents = Math.round(
        amountOriginalVal * 10 ** (origCurrency.decimal_digits ?? 2),
      )
      originalCurrencyCode = currencyStr
      conversionRateVal =
        amountOriginalVal !== 0 ? amountTargetVal / amountOriginalVal : null
    }

    if (amountCents === 0) {
      rowError('the amount is zero')
      continue
    }
    // A refund has a negative amount: its "Paid by" columns are negative and
    // its "Impacted to" columns positive, the opposite of an expense. Both are
    // read as magnitudes and the sign goes back on the amount and the payers,
    // so a refund keeps everyone's share.
    const sign = Math.sign(amountCents)
    const totalCents = Math.abs(amountCents)

    const toTargetCents = (defaultCurrencyAmount: number) =>
      Math.round(
        (Math.abs(defaultCurrencyAmount) / targetToDefaultRate) *
          10 ** targetCurrencyDigits,
      )

    // Reads one column per participant. Values of the expected sign become
    // magnitudes in target minor units; non-numbers and values of the other
    // sign are reported, and null is returned.
    const readColumns = (
      kind: 'paid' | 'impacted',
      expectedSign: number,
    ): { name: string; cents: number }[] | null => {
      const entries: { name: string; cents: number }[] = []
      let ok = true
      for (const name of participantNames) {
        const pMap = participantMap.get(name)!
        const idx = kind === 'paid' ? pMap.paidByIdx : pMap.impactedIdx
        const cell = idx === -1 ? '' : row[idx].trim()
        if (!cell) continue
        const value = parseFloat(cell)
        if (!Number.isFinite(value)) {
          rowError(`invalid ${kind} value "${cell}" for ${name}`)
          ok = false
          continue
        }
        if (value === 0) continue
        if (Math.sign(value) !== expectedSign) {
          rowError(
            `${kind} value ${cell} for ${name} has the wrong sign for an amount of ${amountStr}`,
          )
          ok = false
          continue
        }
        const cents = toTargetCents(value)
        if (cents > 0) entries.push({ name, cents })
      }
      return ok ? entries : null
    }

    const paidEntries = readColumns('paid', sign)
    const impactedEntries = readColumns('impacted', -sign)
    if (!paidEntries || !impactedEntries) continue

    if (paidEntries.length === 0) {
      const paidByName = paidByIdx === -1 ? '' : row[paidByIdx].trim()
      if (!paidByName) {
        rowError('no payer')
        continue
      }
      if (!participantDbIds.has(paidByName)) {
        rowError(`unknown payer "${paidByName}"`)
        continue
      }
      paidEntries.push({ name: paidByName, cents: totalCents })
    }
    if (impactedEntries.length === 0) {
      rowError('nobody is impacted')
      continue
    }

    const sumCents = (entries: { cents: number }[]) =>
      entries.reduce((sum, entry) => sum + entry.cents, 0)
    const paidSum = sumCents(paidEntries)
    const impactedSum = sumCents(impactedEntries)
    if (
      !absorbRounding(paidEntries, totalCents) ||
      !absorbRounding(impactedEntries, totalCents)
    ) {
      rowError(
        `the participant columns (paid ${paidSum}, impacted ${impactedSum} minor units) do not add up to the amount (${totalCents} minor units)`,
      )
      continue
    }

    const expenseId = randomId()
    expenses.push({
      id: expenseId,
      groupId,
      expenseDate: toIsoDateOnly(expenseDateTime),
      title,
      categoryId,
      amount: amountCents,
      originalAmount: originalAmountCents,
      originalCurrency: originalCurrencyCode,
      conversionRate: conversionRateVal,
      paidBy: paidEntries.map(({ name, cents }) => ({
        expenseId,
        participantId: participantDbIds.get(name)!,
        amount: sign * cents,
      })),
      isReimbursement,
      splitMode: SplitMode.BY_AMOUNT,
      createdAt: expenseDateTime.toISOString(),
      notes: null,
      recurrenceRule: null,
      paidFor: impactedEntries.map(({ name, cents }) => ({
        expenseId,
        participantId: participantDbIds.get(name)!,
        shares: cents,
      })),
      documents: [],
      recurringExpenseLink: null,
    })
  }

  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_REPORTED_ERRORS).join('; ')
    const more =
      errors.length > MAX_REPORTED_ERRORS
        ? ` (and ${errors.length - MAX_REPORTED_ERRORS} more)`
        : ''
    throw new Error(`Tricount import failed. ${shown}${more}`)
  }

  return {
    name: groupName.slice(0, 50),
    currency: targetCurrency.symbol || resolvedTarget,
    currencyCode: resolvedTarget,
    participants,
    expenses,
  }
}
