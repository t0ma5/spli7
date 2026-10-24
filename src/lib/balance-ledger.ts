import type { Balances } from '@/lib/balances'
import { allocatePaidForAmounts } from '@/lib/expense-shares'
import { getExpensePaidBy, type Expense } from '@/lib/kv/types'

/** One participant's stored sums. `paid` and `owed` are minor units. */
export type ParticipantBalanceRow = {
  participantId: string
  paid: number
  owed: number
}

/** A paid-for row's exact share of the expense, as stored in the ledger. */
export type PaidForOwed = {
  expenseId: string
  participantId: string
  owed: number
}

/**
 * Owed amount of every paid-for row of one expense. Uses the same
 * largest-remainder split as `getBalances`, so the ledger matches it exactly.
 */
export function expenseOwedAmounts(
  expense: Pick<Expense, 'id' | 'amount' | 'splitMode' | 'paidFor'>,
): PaidForOwed[] {
  return allocatePaidForAmounts({
    id: expense.id,
    amount: expense.amount,
    paidFor: (expense.paidFor ?? []).map((paidFor) => ({
      participantId: paidFor.participantId,
      shares: paidFor.shares,
    })),
    splitMode: expense.splitMode,
  }).map((allocation) => ({
    expenseId: expense.id,
    participantId: allocation.participantId,
    owed: allocation.amount,
  }))
}

/** Ledger sums computed in memory: the fallback and the test oracle. */
export function sumExpenseBalances(
  expenses: Expense[],
): ParticipantBalanceRow[] {
  const sums = new Map<string, ParticipantBalanceRow>()
  const row = (participantId: string) => {
    let entry = sums.get(participantId)
    if (!entry) {
      entry = { participantId, paid: 0, owed: 0 }
      sums.set(participantId, entry)
    }
    return entry
  }
  for (const expense of expenses) {
    for (const paidBy of getExpensePaidBy(expense)) {
      row(paidBy.participantId).paid += paidBy.amount
    }
    for (const paidFor of expenseOwedAmounts(expense)) {
      row(paidFor.participantId).owed += paidFor.owed
    }
  }
  return Array.from(sums.values())
}

export function balancesFromRows(rows: ParticipantBalanceRow[]): Balances {
  const balances: Balances = {}
  for (const { participantId, paid, owed } of rows) {
    const roundedPaid = Math.round(paid) + 0
    const roundedOwed = Math.round(owed) + 0
    balances[participantId] = {
      paid: roundedPaid,
      paidFor: roundedOwed,
      total: roundedPaid - roundedOwed,
    }
  }
  return balances
}
