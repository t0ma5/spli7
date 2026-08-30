jest.mock('nanoid', () => {
  let n = 0
  return { nanoid: () => `id${++n}` }
})

import { createExpense, createGroup, updateGroup } from '@/lib/api'
import { setRepositoryForTests } from '@/lib/db'
import { createMemoryRepository } from '@/lib/db/memory'

describe('api + memory repository', () => {
  beforeEach(() => {
    setRepositoryForTests(createMemoryRepository())
  })

  afterEach(() => {
    setRepositoryForTests(null)
  })

  it('creates a group and an expense', async () => {
    const group = await createGroup({
      name: 'Trip',
      currency: '$',
      currencyCode: 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: [{ name: 'Ada' }, { name: 'Bob' }],
    })
    expect(group.participants).toHaveLength(2)

    const expense = await createExpense(
      {
        expenseDate: new Date('2026-01-01'),
        title: 'Dinner',
        category: 0,
        amount: 1000,
        paidBy: [{ participant: group.participants[0].id, amount: 1000 }],
        paidFor: [
          { participant: group.participants[0].id, shares: 1 },
          { participant: group.participants[1].id, shares: 1 },
        ],
        splitMode: 'EVENLY',
        saveDefaultSplittingOptions: false,
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
      group.id,
    )
    expect(expense.amount).toBe(1000)
  })

  it('last-write-wins is replaced by conflict retries that keep both expenses', async () => {
    const repo = createMemoryRepository()
    setRepositoryForTests(repo)
    const group = await createGroup({
      name: 'Race',
      currency: '$',
      currencyCode: 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: [{ name: 'Ada' }, { name: 'Bob' }],
    })

    const first = await repo.get(group.id)
    const second = await repo.get(group.id)
    expect(first && second).toBeTruthy()
    if (!first || !second) return

    first.expenses.push({
      id: 'one',
      groupId: group.id,
      expenseDate: '2026-01-01',
      title: 'A',
      categoryId: 0,
      amount: 10,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      paidBy: [
        {
          expenseId: 'one',
          participantId: group.participants[0].id,
          amount: 10,
        },
      ],
      isReimbursement: false,
      splitMode: 'EVENLY',
      createdAt: new Date().toISOString(),
      notes: null,
      recurrenceRule: 'NONE',
      paidFor: [
        {
          expenseId: 'one',
          participantId: group.participants[0].id,
          shares: 1,
        },
      ],
      documents: [],
      recurringExpenseLink: null,
    })
    const saved = await repo.save(first, first.version ?? 0)
    expect(saved).toBe('ok')

    second.expenses.push({
      id: 'two',
      groupId: group.id,
      expenseDate: '2026-01-01',
      title: 'B',
      categoryId: 0,
      amount: 20,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      paidBy: [
        {
          expenseId: 'two',
          participantId: group.participants[1].id,
          amount: 20,
        },
      ],
      isReimbursement: false,
      splitMode: 'EVENLY',
      createdAt: new Date().toISOString(),
      notes: null,
      recurrenceRule: 'NONE',
      paidFor: [
        {
          expenseId: 'two',
          participantId: group.participants[1].id,
          shares: 1,
        },
      ],
      documents: [],
      recurringExpenseLink: null,
    })
    const conflict = await repo.save(second, second.version ?? 0)
    expect(conflict).toBe('conflict')

    const latest = await repo.get(group.id)
    expect(latest?.expenses.map((expense) => expense.id)).toEqual(['one'])
  })

  it('rejects removing a participant who is on an expense', async () => {
    const group = await createGroup({
      name: 'House',
      currency: '$',
      currencyCode: 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: [{ name: 'Ada' }, { name: 'Bob' }],
    })
    await createExpense(
      {
        expenseDate: new Date('2026-01-01'),
        title: 'Rent',
        category: 0,
        amount: 200,
        paidBy: [{ participant: group.participants[0].id, amount: 200 }],
        paidFor: [
          { participant: group.participants[0].id, shares: 1 },
          { participant: group.participants[1].id, shares: 1 },
        ],
        splitMode: 'EVENLY',
        saveDefaultSplittingOptions: false,
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
      group.id,
    )

    await expect(
      updateGroup(group.id, {
        name: 'House',
        currency: '$',
        currencyCode: 'USD',
        defaultSplitMode: 'EVENLY',
        fixedExpenseDateGroups: false,
        participants: [{ id: group.participants[0].id, name: 'Ada' }],
      }),
    ).rejects.toThrow(/Cannot remove/)
  })
})
