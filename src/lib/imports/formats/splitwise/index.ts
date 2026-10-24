import { getCurrency } from '@/lib/currency'
import { parseImportDateOnly } from '@/lib/imports/date'

import { mapSplitwiseCategoryLabel } from './category-mapping'
import { parseSplitwiseExportCsv } from './csv-parser'
import { detectSplitwiseHeaders } from './header-detection'
import {
  Deltas,
  ParsedRowModel,
  formatReimbursementTitle,
  parseExportRow,
} from './reconstruction'

const normalizeName = (value: string, fallback: string) => {
  const trimmed = value.trim()
  return trimmed || fallback
}

const detectLanguageScore = (language: string, recognizedFields: number) => {
  if (language === 'unknown' || recognizedFields < 3) return 0
  return Math.min(0.95, 0.7 + recognizedFields * 0.05)
}

export type SplitwiseInternalExpense = {
  expenseDate: Date
  title: string
  category: number
  amount: number
  paidBy: string
  paidFor: { participant: string; shares: number }[]
  splitMode: 'BY_AMOUNT'
  isReimbursement: boolean
}

export type SplitwiseParseResult = {
  expenses: SplitwiseInternalExpense[]
  group?: {
    currency?: string
    currencyCode?: string
    participants: { id: string; name: string }[]
  }
  errors?: { row: number; message: string }[]
}

export function detectSplitwiseCsv(content: string): number {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? ''
  if (!firstLine) return 0
  const headerCells = firstLine
    .split(',')
    .map((c) => c.replace(/^"|"$/g, '').trim())
  const detection = detectSplitwiseHeaders(headerCells)
  const recognizedFields = Object.keys(detection.fieldIndices).length
  return detectLanguageScore(detection.language, recognizedFields)
}

export function parseSplitwiseToInternal(
  content: string,
): SplitwiseParseResult {
  const parsed = parseSplitwiseExportCsv(content)

  const participants = parsed.participantNames.map((name, index) => {
    const fallback = `Participant ${index + 1}`
    const normalized = normalizeName(name, fallback)
    return { id: `p${index}`, name: normalized }
  })

  const participantIds = participants.map((p) => p.id)
  const participantNameById: Record<string, string> = {}
  for (const p of participants) {
    participantNameById[p.id] = p.name
  }

  const errors: { row: number; message: string }[] = [
    ...parsed.errors,
    ...parsed.headerErrors.map((message) => ({ row: 1, message })),
  ]
  const expenses: SplitwiseInternalExpense[] = []

  // Amounts are stored in the group currency without conversion, so every row
  // has to be in that one currency. Converting would need historical rates.
  const currencies: string[] = []
  let firstForeignRow: number | null = null
  for (const row of parsed.rows) {
    const code = row.currency.toUpperCase()
    if (!code || currencies.includes(code)) continue
    if (currencies.length > 0 && firstForeignRow === null) {
      firstForeignRow = row.rowNumber
    }
    currencies.push(code)
  }
  if (firstForeignRow !== null) {
    // First, so the import reports it rather than a row-level problem.
    errors.unshift({
      row: firstForeignRow,
      message: `The export mixes several currencies (${currencies.join(', ')}). Only single-currency exports can be imported; convert the expenses to one currency in Splitwise first.`,
    })
  }
  const groupCurrency = currencies[0] ?? ''

  for (const row of parsed.rows) {
    const expenseDate = parseImportDateOnly(row.date)
    if (!expenseDate) {
      errors.push({
        row: row.rowNumber,
        message: `Invalid expense date: ${row.date}`,
      })
      continue
    }

    const scale =
      10 **
      (getCurrency(row.currency || groupCurrency || 'EUR').decimal_digits ?? 2)
    let totalC = Math.round(row.amount * scale)
    const income = totalC < 0
    if (income) totalC = -totalC

    const deltasC: Deltas = {}
    for (let i = 0; i < participantIds.length; i++) {
      const id = participantIds[i]
      const balance = row.balances[i] ?? 0
      const minor = Math.round(balance * scale)
      deltasC[id] = income ? -minor : minor
    }

    const mappedCategory = mapSplitwiseCategoryLabel(
      row.category,
      parsed.language,
    )
    const isPaymentCategory =
      mappedCategory?.grouping === 'Uncategorized' &&
      mappedCategory?.name === 'Payment'

    let parsedRow: ParsedRowModel
    try {
      parsedRow = parseExportRow(
        row.description || 'Imported expense',
        isPaymentCategory,
        totalC,
        participantIds,
        deltasC,
      )
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Failed to interpret Splitwise row'
      errors.push({ row: row.rowNumber, message })
      continue
    }

    for (const ge of parsedRow.groupExpenses) {
      expenses.push({
        expenseDate,
        title: ge.description,
        category: mappedCategory?.id ?? 0,
        amount: income ? -ge.totalC : ge.totalC,
        paidBy: ge.payer,
        paidFor: Object.entries(ge.sharesC).map(([participant, share]) => ({
          participant,
          shares: share,
        })),
        splitMode: 'BY_AMOUNT',
        isReimbursement: false,
      })
    }

    for (const r of parsedRow.reimbursements) {
      const payerName = participantNameById[r.payer] ?? r.payer
      const receiverName = participantNameById[r.receiver] ?? r.receiver
      const reimbursementTitle = formatReimbursementTitle(
        payerName,
        receiverName,
        parsed.language,
      )
      expenses.push({
        expenseDate,
        title: reimbursementTitle,
        category: mappedCategory?.id ?? 0,
        amount: income ? -r.amountC : r.amountC,
        paidBy: r.payer,
        paidFor: [
          {
            participant: r.receiver,
            shares: r.amountC,
          },
        ],
        splitMode: 'BY_AMOUNT',
        isReimbursement: true,
      })
    }
  }

  return {
    expenses,
    group: {
      currency: groupCurrency || undefined,
      currencyCode: groupCurrency || undefined,
      participants,
    },
    errors,
  }
}

/** Adapter matching the upstream format object used by unit tests. */
export const splitwiseCsvFormat = {
  id: 'splitwise-csv',
  label: 'Splitwise CSV',
  priority: 90,
  async detect(content: string) {
    return detectSplitwiseCsv(content)
  },
  async parseToInternal(content: string) {
    return parseSplitwiseToInternal(content)
  },
}
