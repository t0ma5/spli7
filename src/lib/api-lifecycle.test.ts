jest.mock('nanoid', () => {
  let n = 0
  return { nanoid: () => `lc${++n}` }
})

import {
  cleanupExpiredGroups,
  createExpense,
  createGroup,
  getGroupIncludingDeleted,
  materializeAllDueRecurringExpenses,
} from '@/lib/api'
import { setRepositoryForTests } from '@/lib/db'
import { createMemoryRepository } from '@/lib/db/memory'
import type { GroupRepository } from '@/lib/db/repository'
import { PENDING_CREATE_DELETED_AT } from '@/lib/group-lifecycle'
import type { GroupDocument } from '@/lib/kv/types'

function group(
  id: string,
  stamps: Partial<
    Pick<GroupDocument, 'lastActivityAt' | 'lastSeenAt' | 'deletedAt'>
  >,
): GroupDocument {
  return {
    id,
    name: id,
    information: null,
    currency: '$',
    currencyCode: 'USD',
    pinHash: null,
    defaultSplitMode: 'EVENLY',
    fixedExpenseDateGroups: false,
    version: 0,
    createdAt: '2020-01-01T00:00:00.000Z',
    lastActivityAt: stamps.lastActivityAt ?? null,
    lastSeenAt: stamps.lastSeenAt ?? null,
    deletedAt: stamps.deletedAt ?? null,
    participants: [{ id: `${id}-p`, name: 'Ada', groupId: id }],
    expenses: [],
    activities: [],
  }
}

describe('group lifecycle', () => {
  let repo: GroupRepository

  afterEach(() => setRepositoryForTests(null))

  it('expires by timestamps without loading any group document', async () => {
    const now = new Date('2026-10-24T00:00:00.000Z')
    repo = createMemoryRepository([
      group('stale', { lastActivityAt: '2024-01-01T00:00:00.000Z' }),
      group('seen', {
        lastActivityAt: '2024-01-01T00:00:00.000Z',
        lastSeenAt: '2026-10-01T00:00:00.000Z',
      }),
      group('purge', { deletedAt: '2026-08-01T00:00:00.000Z' }),
      group('grace', { deletedAt: '2026-10-20T00:00:00.000Z' }),
      group('pending', { deletedAt: PENDING_CREATE_DELETED_AT }),
    ])
    const get = jest.spyOn(repo, 'get')
    setRepositoryForTests(repo)

    const result = await cleanupExpiredGroups(now)

    expect(get).not.toHaveBeenCalled()
    expect(result).toMatchObject({ softDeleted: 1, hardDeleted: 2 })
    expect((await repo.getMeta('stale'))?.deletedAt).toBe(now.toISOString())
    expect((await repo.getMeta('seen'))?.deletedAt).toBeNull()
    expect(await repo.getMeta('purge')).toBeNull()
    expect(await repo.getMeta('pending')).toBeNull()
    expect(await repo.getMeta('grace')).not.toBeNull()
  })

  it('hides a half-written import from the restore screen', async () => {
    repo = createMemoryRepository([
      group('pending', { deletedAt: PENDING_CREATE_DELETED_AT }),
    ])
    setRepositoryForTests(repo)
    expect(await getGroupIncludingDeleted('pending')).toBeNull()
  })

  it('generates recurring copies without counting them as activity', async () => {
    repo = createMemoryRepository()
    setRepositoryForTests(repo)
    const created = await createGroup({
      name: 'Rent',
      currency: '$',
      currencyCode: 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: [{ name: 'Ada' }],
    })
    const ada = created.participants[0].id
    const firstOfMonth = new Date()
    firstOfMonth.setUTCMonth(firstOfMonth.getUTCMonth() - 2, 1)
    await createExpense(
      {
        expenseDate: firstOfMonth,
        title: 'Rent',
        category: 0,
        amount: 1000,
        paidBy: [{ participant: ada, amount: 1000 }],
        paidFor: [{ participant: ada, shares: 1 }],
        splitMode: 'EVENLY',
        saveDefaultSplittingOptions: false,
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'MONTHLY',
      },
      created.id,
    )
    const before = await repo.getMeta(created.id)

    const first = await materializeAllDueRecurringExpenses()
    const after = await repo.getMeta(created.id)
    expect(first.updated).toBe(1)
    expect((await repo.get(created.id))?.expenses.length).toBe(3)
    expect(after?.lastActivityAt).toBe(before?.lastActivityAt)

    // Nothing due any more: no group listed, no write, no version bump.
    const second = await materializeAllDueRecurringExpenses()
    expect(second).toMatchObject({ scanned: 0, updated: 0 })
    expect((await repo.getMeta(created.id))?.version).toBe(after?.version)
  })

  it('refuses a client-minted id that already exists', async () => {
    repo = createMemoryRepository()
    setRepositoryForTests(repo)
    const created = await createGroup({
      name: 'Ids',
      currency: '$',
      currencyCode: 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: [{ name: 'Ada' }],
    })
    const ada = created.participants[0].id
    const form = {
      expenseDate: new Date('2026-01-01'),
      title: 'Dinner',
      category: 0,
      amount: 100,
      paidBy: [{ participant: ada, amount: 100 }],
      paidFor: [{ participant: ada, shares: 1 }],
      splitMode: 'EVENLY' as const,
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [] as [],
      recurrenceRule: 'NONE' as const,
    }
    const id = 'A'.repeat(21)
    await createExpense(form, created.id, undefined, id)
    // Skip the friendly pre-check: the insert itself must refuse the id.
    jest.spyOn(repo, 'expenseIdExists').mockResolvedValue(false)
    await expect(
      createExpense(form, created.id, undefined, id),
    ).rejects.toThrow(/UNIQUE/)
  })
})
