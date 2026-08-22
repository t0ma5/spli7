import { allocatePaidForAmounts } from '@/lib/expense-shares'
import type { ExpenseListItem, Participant } from '@/lib/kv/types'

export type Balances = Record<
  Participant['id'],
  { paid: number; paidFor: number; total: number }
>

export type Reimbursement = {
  from: Participant['id']
  to: Participant['id']
  amount: number
}

export function getBalances(expenses: ExpenseListItem[]): Balances {
  const balances: Balances = {}

  for (const expense of expenses) {
    const paidFors = expense.paidFor

    for (const pb of expense.paidBy) {
      if (!balances[pb.id]) balances[pb.id] = { paid: 0, paidFor: 0, total: 0 }
      balances[pb.id].paid += pb.amount
    }

    const allocations = allocatePaidForAmounts({
      id: expense.id,
      amount: expense.amount,
      paidFor: paidFors.map((paidFor) => ({
        participantId: paidFor.participant.id,
        shares: paidFor.shares,
      })),
      splitMode: expense.splitMode,
    })

    for (const allocation of allocations) {
      if (!balances[allocation.participantId]) {
        balances[allocation.participantId] = { paid: 0, paidFor: 0, total: 0 }
      }
      balances[allocation.participantId].paidFor += allocation.amount
    }
  }

  for (const participantId in balances) {
    balances[participantId].paidFor =
      Math.round(balances[participantId].paidFor) + 0
    balances[participantId].paid = Math.round(balances[participantId].paid) + 0

    balances[participantId].total =
      balances[participantId].paid - balances[participantId].paidFor
  }
  return balances
}

export function getPublicBalances(reimbursements: Reimbursement[]): Balances {
  const balances: Balances = {}
  reimbursements.forEach((reimbursement) => {
    if (!balances[reimbursement.from])
      balances[reimbursement.from] = { paid: 0, paidFor: 0, total: 0 }

    if (!balances[reimbursement.to])
      balances[reimbursement.to] = { paid: 0, paidFor: 0, total: 0 }

    balances[reimbursement.from].paidFor += reimbursement.amount
    balances[reimbursement.from].total -= reimbursement.amount

    balances[reimbursement.to].paid += reimbursement.amount
    balances[reimbursement.to].total += reimbursement.amount
  })
  return balances
}

function compareBalancesForReimbursements(
  b1: { participantId: string; total: number },
  b2: { participantId: string; total: number },
): number {
  if (b1.total > 0 && 0 > b2.total) {
    return -1
  } else if (b2.total > 0 && 0 > b1.total) {
    return 1
  }
  return b1.participantId < b2.participantId ? -1 : 1
}

export function getSuggestedReimbursements(
  balances: Balances,
): Reimbursement[] {
  const balancesArray = Object.entries(balances)
    .map(([participantId, { total }]) => ({ participantId, total }))
    .filter((b) => b.total !== 0)
  balancesArray.sort(compareBalancesForReimbursements)
  const reimbursements: Reimbursement[] = []
  while (balancesArray.length > 1) {
    const first = balancesArray[0]
    const last = balancesArray[balancesArray.length - 1]
    const amount = first.total + last.total
    if (first.total > -last.total) {
      reimbursements.push({
        from: last.participantId,
        to: first.participantId,
        amount: -last.total,
      })
      first.total = amount
      balancesArray.pop()
    } else {
      reimbursements.push({
        from: last.participantId,
        to: first.participantId,
        amount: first.total,
      })
      last.total = amount
      balancesArray.shift()
    }
  }
  return reimbursements.filter(({ amount }) => Math.round(amount) + 0 !== 0)
}
