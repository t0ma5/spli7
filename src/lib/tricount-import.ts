export { looksLikeTricountCsv } from '@/lib/tricount-detect'
import { getCurrency } from '@/lib/currency'
import { SEEDED_CATEGORIES } from '@/lib/kv/categories'
import type { Expense, Participant } from '@/lib/kv/types'
import { SplitMode } from '@/lib/kv/types'
import { randomId } from '@/lib/randomId'

const rateCache = new Map<string, number>()

async function getExchangeRate(
  date: Date,
  base: string,
  target: string,
): Promise<number> {
  if (base === target) return 1
  const dateString = date.toISOString().split('T')[0]
  try {
    const res = await fetch(
      `https://api.frankfurter.dev/${dateString}?base=${base}&symbols=${target}`,
    )
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> }
      if (data.rates?.[target]) return data.rates[target]
    }
  } catch {
    // fall through
  }
  return 1
}

async function getRate(
  date: Date,
  base: string,
  target: string,
): Promise<number> {
  const dateString = date.toISOString().split('T')[0]
  const cacheKey = `${dateString}_${base}_${target}`
  if (rateCache.has(cacheKey)) return rateCache.get(cacheKey)!
  const rate = await getExchangeRate(date, base, target)
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
    (paidByIdx === -1 && !hasPerPersonPaidBy)
  ) {
    throw new Error('Invalid Tricount CSV format: missing required columns')
  }

  let defaultCurrencyCode = 'EUR'
  if (amountInDefaultIdx !== -1) {
    const match = headers[amountInDefaultIdx].match(/\(([^)]+)\)/)
    if (match) defaultCurrencyCode = match[1]
  }

  const resolvedTarget = (targetCurrencyCode || defaultCurrencyCode).toUpperCase()

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

  const expenses: Expense[] = []

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]
    if (row.length < 8) continue
    if (row[0].startsWith('tricount ') && row[0].includes(' - Exported on')) {
      continue
    }

    const title = row[titleIdx] || 'Untitled'
    const amountStr = row[amountIdx]
    const currencyStr = row[currencyIdx]
    const amountInDefaultStr =
      amountInDefaultIdx !== -1 ? row[amountInDefaultIdx] : amountStr

    if (!amountStr || Number.isNaN(parseFloat(amountStr))) continue

    const amountOriginalVal = parseFloat(amountStr)
    const amountDefaultVal = parseFloat(amountInDefaultStr || amountStr)
    const isReimbursement =
      title.toLowerCase().includes('recouvrement de dette') ||
      title.toLowerCase().includes('repayment') ||
      title.toLowerCase().includes('reimbursement') ||
      title.toLowerCase().includes('transfer') ||
      title.toLowerCase().includes('settlement')

    const categoryName = categoryIdx !== -1 ? row[categoryIdx] : ''
    const categoryId = findCategoryId(categoryName, isReimbursement)

    let expenseDate = new Date()
    if (dateTimeIdx !== -1 && row[dateTimeIdx]) {
      const parsedDate = new Date(row[dateTimeIdx])
      if (!Number.isNaN(parsedDate.getTime())) expenseDate = parsedDate
    }

    let targetToDefaultRate = 1
    if (resolvedTarget !== defaultCurrencyCode) {
      let foundRate = false
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i]
        if (r.length >= 8 && r[currencyIdx] === resolvedTarget) {
          const rate = parseFloat(r[exchangeRateIdx])
          if (rate && !Number.isNaN(rate)) {
            targetToDefaultRate = rate
            foundRate = true
            break
          }
        }
      }
      if (!foundRate) {
        targetToDefaultRate = await getRate(
          expenseDate,
          resolvedTarget,
          defaultCurrencyCode,
        )
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

    const toTargetCents = (defaultCurrencyAmount: number) =>
      Math.round(
        (Math.abs(defaultCurrencyAmount) / targetToDefaultRate) *
          10 ** targetCurrencyDigits,
      )

    const paidByList: { participantId: string; amount: number }[] = []
    for (const name of participantNames) {
      const pMap = participantMap.get(name)!
      if (pMap.paidByIdx !== -1 && row[pMap.paidByIdx]) {
        const paidVal = parseFloat(row[pMap.paidByIdx])
        if (!Number.isNaN(paidVal) && paidVal > 0) {
          const paidAmount = toTargetCents(paidVal)
          if (paidAmount > 0) {
            paidByList.push({
              participantId: participantDbIds.get(name)!,
              amount: paidAmount,
            })
          }
        }
      }
    }

    if (paidByList.length === 0) {
      if (paidByIdx === -1) continue
      const paidByName = row[paidByIdx]
      const paidById = participantDbIds.get(paidByName)
      if (!paidById) continue
      paidByList.push({ participantId: paidById, amount: amountCents })
    } else {
      const paidSum = paidByList.reduce((sum, p) => sum + p.amount, 0)
      const paidDiscrepancy = amountCents - paidSum
      if (paidDiscrepancy !== 0) {
        paidByList[paidByList.length - 1].amount += paidDiscrepancy
      }
    }

    const paidForList: { participantId: string; shares: number }[] = []
    let sumShares = 0

    for (const name of participantNames) {
      const pMap = participantMap.get(name)!
      if (pMap.impactedIdx !== -1 && row[pMap.impactedIdx]) {
        const impactedVal = parseFloat(row[pMap.impactedIdx])
        if (impactedVal < 0) {
          const shareAmount = toTargetCents(impactedVal)
          if (shareAmount > 0) {
            paidForList.push({
              participantId: participantDbIds.get(name)!,
              shares: shareAmount,
            })
            sumShares += shareAmount
          }
        }
      }
    }

    const discrepancy = amountCents - sumShares
    if (discrepancy !== 0 && paidForList.length > 0) {
      paidForList[paidForList.length - 1].shares += discrepancy
    }

    if (paidForList.length === 0) {
      paidForList.push({
        participantId: paidByList[0].participantId,
        shares: amountCents,
      })
    }

    const expenseId = randomId()
    expenses.push({
      id: expenseId,
      groupId,
      expenseDate: toIsoDateOnly(expenseDate),
      title,
      categoryId,
      amount: amountCents,
      originalAmount: originalAmountCents,
      originalCurrency: originalCurrencyCode,
      conversionRate: conversionRateVal,
      paidBy: paidByList.map(({ participantId, amount }) => ({
        expenseId,
        participantId,
        amount,
      })),
      isReimbursement,
      splitMode: SplitMode.BY_AMOUNT,
      createdAt: expenseDate.toISOString(),
      notes: null,
      recurrenceRule: null,
      paidFor: paidForList.map(({ participantId, shares }) => ({
        expenseId,
        participantId,
        shares,
      })),
      documents: [],
      recurringExpenseLink: null,
    })
  }

  return {
    name: groupName.slice(0, 50),
    currency: targetCurrency.symbol || resolvedTarget,
    currencyCode: resolvedTarget,
    participants,
    expenses,
  }
}
