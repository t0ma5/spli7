jest.mock('nanoid', () => {
  let n = 0
  return { nanoid: () => `id${++n}` }
})

import {
  createExpense,
  createGroup,
  deleteExpense,
  getActiveRecurringExpenses,
  getActivities,
  getExpense,
  getGroup,
  getGroupExpenseCount,
  getGroupExpenses,
  getGroupExpensesParticipants,
  getGroupForExport,
  getGroups,
  updateExpense,
  updateGroup,
} from '@/lib/api'
import { getRepository, setRepositoryForTests } from '@/lib/db'
import { decodeActivityCursor, decodeExpenseCursor } from '@/lib/db/list-cursor'
import { createMemoryRepository } from '@/lib/db/memory'
import type { GroupRepository } from '@/lib/db/repository'

function countingGetRepository() {
  const inner = createMemoryRepository()
  let getCount = 0
  const repo = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'get') {
        return (id: string) => {
          getCount += 1
          return target.get(id)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function'
        ? (value as (...args: never[]) => unknown).bind(target)
        : value
    },
  }) as GroupRepository
  return { repo, getCount: () => getCount }
}

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

  it('stores a client-minted expense id and refuses a reuse', async () => {
    const group = await createGroup({
      name: 'Trip',
      currency: '$',
      currencyCode: 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: [{ name: 'Ada' }, { name: 'Bob' }],
    })
    const other = await createGroup({
      name: 'Other',
      currency: '$',
      currencyCode: 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: [{ name: 'Cara' }, { name: 'Dan' }],
    })
    const ada = group.participants[0].id
    const bob = group.participants[1].id
    const form = {
      expenseDate: new Date('2026-01-01'),
      title: 'Dinner',
      category: 0,
      amount: 1657,
      paidBy: [{ participant: ada, amount: 1657 }],
      paidFor: [
        { participant: ada, shares: 1 },
        { participant: bob, shares: 1 },
      ],
      splitMode: 'EVENLY' as const,
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [] as [],
      recurrenceRule: 'NONE' as const,
    }
    const minted = 'abcdefghijklmnopqrstu'
    const expense = await createExpense(form, group.id, undefined, minted)
    expect(expense.id).toBe(minted)

    await expect(
      createExpense({ ...form, title: 'Again' }, group.id, undefined, minted),
    ).rejects.toThrow('Expense id already exists')
    expect(await getGroupExpenseCount(group.id)).toBe(1)

    const cara = other.participants[0].id
    const dan = other.participants[1].id
    await expect(
      createExpense(
        {
          ...form,
          paidBy: [{ participant: cara, amount: 1657 }],
          paidFor: [
            { participant: cara, shares: 1 },
            { participant: dan, shares: 1 },
          ],
        },
        other.id,
        undefined,
        minted,
      ),
    ).rejects.toThrow('Expense id already exists')
    expect(await getGroupExpenseCount(other.id)).toBe(0)
    expect((await getExpense(group.id, minted))?.title).toBe('Dinner')

    await expect(
      createExpense(form, group.id, undefined, 'short'),
    ).rejects.toThrow('Invalid expense id')
  })

  it('creates, updates, and deletes an expense without loading the group document', async () => {
    const { repo, getCount } = countingGetRepository()
    setRepositoryForTests(repo)
    const group = await createGroup({
      name: 'Trip',
      currency: '$',
      currencyCode: 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: [{ name: 'Ada' }, { name: 'Bob' }],
    })
    const ada = group.participants[0].id
    const bob = group.participants[1].id
    const form = {
      expenseDate: new Date('2026-01-01'),
      title: 'Dinner',
      category: 0,
      amount: 1000,
      paidBy: [{ participant: ada, amount: 1000 }],
      paidFor: [
        { participant: ada, shares: 1 },
        { participant: bob, shares: 1 },
      ],
      splitMode: 'EVENLY' as const,
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [] as [],
      recurrenceRule: 'NONE' as const,
    }

    const created = await createExpense(form, group.id)
    expect(getCount()).toBe(0)
    expect(await getGroupExpenseCount(group.id)).toBe(1)

    await updateExpense(group.id, created.id, { ...form, title: 'Lunch' })
    expect(getCount()).toBe(0)
    expect((await getExpense(group.id, created.id))?.title).toBe('Lunch')

    await deleteExpense(group.id, created.id)
    expect(getCount()).toBe(0)
    expect(await getGroupExpenseCount(group.id)).toBe(0)

    await updateGroup(group.id, {
      name: 'Renamed',
      currency: group.currency,
      currencyCode: group.currencyCode ?? 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: group.participants.map((participant) => ({
        id: participant.id,
        name: participant.name,
      })),
    })
    expect(getCount()).toBeGreaterThan(0)
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

    const page = await getGroupExpenses(group.id, { length: 2 })
    expect(page.map((expense) => expense.title)).toEqual(['Museum', 'Taxi'])
    const next = await getGroupExpenses(group.id, {
      after: decodeExpenseCursor(page[1].listCursor)!,
      length: 2,
    })
    expect(next.map((expense) => expense.title)).toEqual(['Dinner', 'Coffee'])

    const filtered = await getGroupExpenses(group.id, {
      filter: 'din',
      length: 10,
    })
    expect(filtered.map((expense) => expense.title)).toEqual(['Dinner'])

    const one = await getExpense(group.id, page[0].id)
    expect(one?.title).toBe('Museum')

    const activities = await getActivities(group.id, { length: 2 })
    expect(activities).toHaveLength(2)
    expect(activities[0].expense?.title).toBe('Museum')
    const moreActivities = await getActivities(group.id, {
      after: decodeActivityCursor(activities[1].listCursor)!,
      length: 2,
    })
    expect(moreActivities.length).toBeGreaterThan(0)
    expect(moreActivities[0].id).not.toBe(activities[0].id)

    const participantIds = await getGroupExpensesParticipants(group.id)
    expect(participantIds.sort()).toEqual([ada, bob].sort())

    const exported = await getGroupForExport(group.id)
    expect(exported?.expenses).toHaveLength(4)
    expect(exported?.participants).toHaveLength(2)

    await createExpense(
      {
        expenseDate: new Date('2027-01-01'),
        title: 'Rent',
        category: 0,
        amount: 500,
        paidBy: [{ participant: ada, amount: 500 }],
        paidFor: [
          { participant: ada, shares: 1 },
          { participant: bob, shares: 1 },
        ],
        splitMode: 'EVENLY',
        saveDefaultSplittingOptions: false,
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'MONTHLY',
      },
      group.id,
    )
    const recurring = await getActiveRecurringExpenses(group.id)
    expect(recurring).toEqual([
      expect.objectContaining({
        amount: 500,
        recurrenceRule: 'MONTHLY',
        isReimbursement: false,
      }),
    ])
  })
})
