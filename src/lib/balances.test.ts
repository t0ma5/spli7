import { getBalances, getSuggestedReimbursements } from '@/lib/balances'
import { allocatePaidForAmounts } from '@/lib/expense-shares'
import type { ExpenseListItem } from '@/lib/kv/types'
import { SplitMode } from '@/lib/kv/types'

function expense(
  partial: Partial<ExpenseListItem> & { id: string; amount: number },
): ExpenseListItem {
  return {
    originalAmount: null,
    originalCurrency: null,
    category: null,
    createdAt: new Date('2026-01-01'),
    expenseDate: new Date('2026-01-01'),
    isReimbursement: false,
    paidBy: [{ id: 'a', name: 'A', amount: partial.amount }],
    paidFor: [
      { shares: 1, participant: { id: 'a', name: 'A' } },
      { shares: 1, participant: { id: 'b', name: 'B' } },
    ],
    splitMode: SplitMode.EVENLY,
    recurrenceRule: null,
    title: 'x',
    _count: { documents: 0 },
    ...partial,
  }
}

describe('balances', () => {
  it('sums to zero across participants', () => {
    const expenses = [
      expense({
        id: '1',
        amount: 100,
        paidBy: [{ id: 'a', name: 'A', amount: 100 }],
      }),
      expense({
        id: '2',
        amount: 50,
        paidBy: [{ id: 'b', name: 'B', amount: 50 }],
        paidFor: [{ shares: 1, participant: { id: 'a', name: 'A' } }],
        splitMode: SplitMode.BY_SHARES,
      }),
    ]
    const balances = getBalances(expenses)
    const total = Object.values(balances).reduce(
      (sum, row) => sum + row.total,
      0,
    )
    expect(total).toBe(0)
  })

  it('suggested reimbursements settle every balance', () => {
    const expenses = [
      expense({
        id: '1',
        amount: 99,
        paidBy: [{ id: 'a', name: 'A', amount: 99 }],
        paidFor: [
          { shares: 1, participant: { id: 'a', name: 'A' } },
          { shares: 1, participant: { id: 'b', name: 'B' } },
          { shares: 1, participant: { id: 'c', name: 'C' } },
        ],
      }),
    ]
    const balances = getBalances(expenses)
    const reimbursements = getSuggestedReimbursements(balances)
    const copy = Object.fromEntries(
      Object.entries(balances).map(([id, row]) => [id, { ...row }]),
    ) as typeof balances
    for (const reimbursement of reimbursements) {
      copy[reimbursement.from].total += reimbursement.amount
      copy[reimbursement.to].total -= reimbursement.amount
    }
    for (const row of Object.values(copy)) {
      expect(row.total).toBe(0)
    }
  })

  it('property: random even splits stay conserved', () => {
    for (let i = 0; i < 50; i++) {
      const amount = 100 + i
      const expenses = [
        expense({
          id: `e${i}`,
          amount,
          paidBy: [{ id: 'a', name: 'A', amount }],
        }),
      ]
      const balances = getBalances(expenses)
      const total = Object.values(balances).reduce(
        (sum, row) => sum + row.total,
        0,
      )
      expect(total).toBe(0)
      const reimbursements = getSuggestedReimbursements(balances)
      expect(reimbursements.length).toBeGreaterThan(0)
    }
  })
})

describe('expense-shares', () => {
  it('allocations sum to the expense amount', () => {
    const allocations = allocatePaidForAmounts({
      id: 'exp',
      amount: 100,
      splitMode: SplitMode.EVENLY,
      paidFor: [
        { participantId: 'a', shares: 1 },
        { participantId: 'b', shares: 1 },
        { participantId: 'c', shares: 1 },
      ],
    })
    expect(allocations.reduce((sum, row) => sum + row.amount, 0)).toBe(100)
  })
})
