import { match } from 'ts-pattern'

export type ExpenseSplitMode =
  'EVENLY' | 'BY_AMOUNT' | 'BY_PERCENTAGE' | 'BY_SHARES'

export type ExpenseShareParticipant = {
  participantId: string
  shares: number
}

/**
 * Shared paid-for allocation used by balances and the balance timeline.
 * Remainder goes to the last participant so split copies cannot drift.
 */
export function allocatePaidForAmounts({
  amount,
  paidFor,
  splitMode,
}: {
  amount: number
  paidFor: ExpenseShareParticipant[]
  splitMode: ExpenseSplitMode
}): { participantId: string; amount: number }[] {
  const totalPaidForShares = paidFor.reduce(
    (sum, entry) => sum + entry.shares,
    0,
  )
  let remaining = amount

  return paidFor.map((entry, index) => {
    const isLast = index === paidFor.length - 1
    const [shares, totalShares] = match(splitMode)
      .with('EVENLY', () => [1, paidFor.length] as const)
      .with('BY_SHARES', () => [entry.shares, totalPaidForShares] as const)
      .with('BY_PERCENTAGE', () => [entry.shares, totalPaidForShares] as const)
      .with('BY_AMOUNT', () => [entry.shares, totalPaidForShares] as const)
      .exhaustive()

    const dividedAmount = isLast
      ? remaining
      : Math.floor((amount * shares) / totalShares)
    remaining -= dividedAmount

    return {
      participantId: entry.participantId,
      amount: dividedAmount,
    }
  })
}
