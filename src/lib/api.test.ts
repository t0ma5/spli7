jest.mock('nanoid', () => {
  let n = 0
  return { nanoid: () => `id${++n}` }
})

import {
  createExpense,
  createGroup,
  getActivities,
  getExpense,
  getGroup,
  getGroupExpenseCount,
  getGroupExpenses,
  getGroups,
  updateGroup,
} from '@/lib/api'
import { getRepository, setRepositoryForTests } from '@/lib/db'
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

  it('lists group summaries without requiring a full expense graph', async () => {
    const repo = createMemoryRepository()
    setRepositoryForTests(repo)
    const group = await createGroup({
      name: 'Big',
      currency: '$',
      currencyCode: 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: [{ name: 'Ada' }, { name: 'Bob' }],
    })
    const stored = await repo.get(group.id)
    expect(stored).toBeTruthy()
    if (!stored) return
    stored.expenses = Array.from({ length: 160 }, (_, index) => ({
      id: `exp${index}`,
      groupId: group.id,
      expenseDate: '2026-01-01',
      title: `E${index}`,
      categoryId: 0,
      amount: 1,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      paidBy: [
        {
          expenseId: `exp${index}`,
          participantId: group.participants[0].id,
          amount: 1,
        },
      ],
      isReimbursement: false,
      splitMode: 'EVENLY' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      notes: null,
      recurrenceRule: 'NONE' as const,
      paidFor: [
        {
          expenseId: `exp${index}`,
          participantId: group.participants[0].id,
          shares: 1,
        },
      ],
      documents: [],
      recurringExpenseLink: null,
    }))
    await repo.save(stored, stored.version ?? 0)

    const listed = await getGroups([group.id, 'missing'])
    expect(listed).toEqual([
      expect.objectContaining({
        id: group.id,
        name: 'Big',
        _count: { participants: 2 },
      }),
    ])
  })

  it('omits soft-deleted groups from the recent list', async () => {
    const group = await createGroup({
      name: 'Gone',
      currency: '$',
      currencyCode: 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: [{ name: 'Ada' }],
    })
    const existing = await getRepository().get(group.id)
    expect(existing).toBeTruthy()
    if (!existing) return
    existing.deletedAt = '2026-08-11T00:00:00.000Z'
    await getRepository().save(existing, existing.version ?? 0)
    await expect(getGroups([group.id])).resolves.toEqual([])
  })

  it('pages and filters expenses in the repository instead of slicing a full document', async () => {
    const group = await createGroup({
      name: 'Paged',
      currency: '$',
      currencyCode: 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: [{ name: 'Ada' }, { name: 'Bob' }],
    })
    const ada = group.participants[0].id
    const bob = group.participants[1].id
    const titles = ['Coffee', 'Dinner', 'Taxi', 'Museum']
    for (let index = 0; index < titles.length; index++) {
      await createExpense(
        {
          expenseDate: new Date(`2026-01-0${index + 1}`),
          title: titles[index],
          category: 0,
          amount: 100 + index,
          paidBy: [{ participant: ada, amount: 100 + index }],
          paidFor: [
            { participant: ada, shares: 1 },
            { participant: bob, shares: 1 },
          ],
          splitMode: 'EVENLY',
          saveDefaultSplittingOptions: false,
          isReimbursement: false,
          documents: [],
          recurrenceRule: 'NONE',
        },
        group.id,
      )
    }

    expect(await getGroupExpenseCount(group.id)).toBe(4)
    const header = await getGroup(group.id)
    expect(header?.name).toBe('Paged')
    expect(header?.participants).toHaveLength(2)

    const page = await getGroupExpenses(group.id, { offset: 0, length: 2 })
    expect(page.map((expense) => expense.title)).toEqual(['Museum', 'Taxi'])
    const next = await getGroupExpenses(group.id, { offset: 2, length: 2 })
    expect(next.map((expense) => expense.title)).toEqual(['Dinner', 'Coffee'])

    const filtered = await getGroupExpenses(group.id, {
      filter: 'din',
      offset: 0,
      length: 10,
    })
    expect(filtered.map((expense) => expense.title)).toEqual(['Dinner'])

    const one = await getExpense(group.id, page[0].id)
    expect(one?.title).toBe('Museum')

    const activities = await getActivities(group.id, { offset: 0, length: 2 })
    expect(activities).toHaveLength(2)
    expect(activities[0].expense?.title).toBe('Museum')
  })
})
