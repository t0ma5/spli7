import { getCurrency } from '@/lib/currency'
import { parseSplitwiseToInternal } from '@/lib/imports/formats/splitwise'
import { detectSplitwiseHeaders } from '@/lib/imports/formats/splitwise/header-detection'
import type { Expense, Participant } from '@/lib/kv/types'
import { SplitMode } from '@/lib/kv/types'
import { randomId } from '@/lib/randomId'
import type { ParsedTricountGroup } from '@/lib/tricount-import'

export function looksLikeSplitwiseCsv(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  if (!firstLine) return false
  const headerCells = firstLine
    .split(',')
    .map((cell) => cell.replace(/^"|"$/g, '').trim())
  const detection = detectSplitwiseHeaders(headerCells)
  return (
    detection.language !== 'unknown' &&
    Object.keys(detection.fieldIndices).length >= 3
  )
}

function toIsoDateOnly(date: Date): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  ).toISOString()
}

export function parseSplitwiseCsv(csvText: string): ParsedTricountGroup {
  const parsed = parseSplitwiseToInternal(csvText)
  const groupId = randomId()
  const now = new Date().toISOString()

  const participants: Participant[] = (parsed.group?.participants ?? []).map(
    (participant) => ({
      id: randomId(),
      name: participant.name,
      groupId,
    }),
  )

  const idMap = new Map<string, string>()
  ;(parsed.group?.participants ?? []).forEach((participant, index) => {
    idMap.set(participant.id, participants[index].id)
  })

  const currencyCode = (parsed.group?.currencyCode || 'EUR').slice(0, 3)
  const currencyInfo = getCurrency(currencyCode)
  const currency = currencyInfo.symbol_native || currencyInfo.symbol || currencyCode

  const expenses: Expense[] = parsed.expenses.map((expense) => {
    const expenseId = randomId()
    const paidById = idMap.get(expense.paidBy)
    if (!paidById) {
      throw new Error(`Unknown Splitwise payer: ${expense.paidBy}`)
    }

    return {
      id: expenseId,
      groupId,
      expenseDate: toIsoDateOnly(expense.expenseDate),
      title: expense.title,
      categoryId: expense.category,
      amount: expense.amount,
      originalAmount: null,
      originalCurrency: expense.originalCurrency ?? null,
      conversionRate: null,
      paidBy: [
        {
          expenseId,
          participantId: paidById,
          amount: expense.amount,
        },
      ],
      isReimbursement: expense.isReimbursement,
      splitMode: SplitMode.BY_AMOUNT,
      createdAt: now,
      notes: null,
      recurrenceRule: 'NONE',
      paidFor: expense.paidFor.map(({ participant, shares }) => {
        const mappedId = idMap.get(participant)
        if (!mappedId) {
          throw new Error(`Unknown Splitwise participant: ${participant}`)
        }
        return {
          expenseId,
          participantId: mappedId,
          shares,
        }
      }),
      documents: [],
      recurringExpenseLink: null,
    }
  })

  return {
    name: 'Splitwise import',
    currency,
    currencyCode,
    participants,
    expenses,
  }
}
