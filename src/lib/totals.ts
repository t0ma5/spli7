import type { ExpenseListItem } from '@/lib/kv/types'

export function getTotalGroupSpending(expenses: ExpenseListItem[]): number {
  return expenses.reduce(
    (total, expense) =>
      expense.isReimbursement ? total : total + expense.amount,
    0,
  )
}

export function getTotalActiveUserPaidFor(
  activeUserId: string | null,
  expenses: ExpenseListItem[],
): number {
  return expenses.reduce((total, expense) => {
    const userPaidBy = expense.paidBy.find(
      (paidBy) => paidBy.id === activeUserId,
    )
    return userPaidBy && !expense.isReimbursement
      ? total + userPaidBy.amount
      : total
  }, 0)
}

export function calculateShare(
  participantId: string | null,
  expense: Pick<
    ExpenseListItem,
    'amount' | 'paidFor' | 'splitMode' | 'isReimbursement'
  >,
): number {
  if (expense.isReimbursement) return 0

  const paidFors = expense.paidFor
  const userIndex = paidFors.findIndex(
    (paidFor) => paidFor.participant.id === participantId,
  )

  if (userIndex < 0) return 0

  const totalPaidForShares = paidFors.reduce(
    (sum, paidFor) => sum + Number(paidFor.shares),
    0,
  )

  let remaining = expense.amount
  for (let index = 0; index < paidFors.length; index++) {
    const paidFor = paidFors[index]
    const isLast = index === paidFors.length - 1
    let shares: number
    let totalShares: number
    switch (expense.splitMode) {
      case 'EVENLY':
        shares = 1
        totalShares = paidFors.length
        break
      case 'BY_AMOUNT':
        return Number(
          paidFors.find((p) => p.participant.id === participantId)?.shares ?? 0,
        )
      case 'BY_PERCENTAGE':
        shares = Number(paidFor.shares)
        totalShares = totalPaidForShares
        break
      case 'BY_SHARES':
        shares = Number(paidFor.shares)
        totalShares = totalPaidForShares
        break
      default:
        return 0
    }
    const dividedAmount = isLast
      ? remaining
      : Math.floor((expense.amount * shares) / totalShares)
    remaining -= dividedAmount
    if (index === userIndex) return dividedAmount
  }
  return 0
}

export function getTotalActiveUserShare(
  activeUserId: string | null,
  expenses: ExpenseListItem[],
): number {
  const total = expenses.reduce(
    (sum, expense) => sum + calculateShare(activeUserId, expense),
    0,
  )

  return parseFloat(total.toFixed(2))
}
