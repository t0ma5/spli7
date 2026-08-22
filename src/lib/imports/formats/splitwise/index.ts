import dayjs from 'dayjs'

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
  originalCurrency?: string
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
  const headerCells = firstLine.split(',').map((c) => c.replace(/^"|"$/g, '').trim())
  const detection = detectSplitwiseHeaders(headerCells)
  const recognizedFields = Object.keys(detection.fieldIndices).length
  return detectLanguageScore(detection.language, recognizedFields)
}

export function parseSplitwiseToInternal(content: string): SplitwiseParseResult {
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
  let groupCurrency = ''

  for (const row of parsed.rows) {
    if (!groupCurrency && row.currency) {
      groupCurrency = row.currency
    }

    const expenseDate = dayjs(row.date)
    if (!expenseDate.isValid()) {
      errors.push({
        row: row.rowNumber,
        message: `Invalid expense date: ${row.date}`,
      })
      continue
    }

    const totalC = Math.round(row.amount * 100)

    const deltasC: Deltas = {}
    for (let i = 0; i < participantIds.length; i++) {
      const id = participantIds[i]
      const balance = row.balances[i] ?? 0
      deltasC[id] = Math.round(balance * 100)
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
        expenseDate: expenseDate.toDate(),
        title: ge.description,
        category: mappedCategory?.id ?? 0,
        amount: ge.totalC,
        originalCurrency: row.currency || undefined,
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
        expenseDate: expenseDate.toDate(),
        title: reimbursementTitle,
        category: mappedCategory?.id ?? 0,
        amount: r.amountC,
        originalCurrency: row.currency || undefined,
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
