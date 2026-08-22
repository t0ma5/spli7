import { SplitMode } from '@/lib/kv/types'
import { getExpenseShares } from '@/lib/shares'

export type ExpenseSplitMode = SplitMode

export type ExpenseShareParticipant = {
  participantId: string
  shares: number
}

/**
 * Shared paid-for allocation used by balances and the balance timeline.
 * Delegates to Hamilton largest-remainder so split copies cannot drift.
 */
export function allocatePaidForAmounts({
  id,
  amount,
  paidFor,
  splitMode,
}: {
  id?: string | null
  amount: number
  paidFor: ExpenseShareParticipant[]
  splitMode: ExpenseSplitMode
}): { participantId: string; amount: number }[] {
  const shares = getExpenseShares({
    id,
    amount,
    splitMode,
    paidFor,
  })

  return paidFor.map((entry) => ({
    participantId: entry.participantId,
    amount: shares.get(entry.participantId) ?? 0,
  }))
}

export {
  distributeAmount,
  getExpenseShares,
  getParticipantShare,
} from '@/lib/shares'
