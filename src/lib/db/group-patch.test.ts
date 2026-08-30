import { applyGroupChildPatch, diffGroupChildren } from '@/lib/db/group-patch'
import type { Expense, GroupDocument } from '@/lib/kv/types'

function expense(partial: Partial<Expense> & { id: string }): Expense {
  return {
    groupId: 'g',
    expenseDate: '2026-01-01',
    title: 'x',
    categoryId: 0,
    amount: 10,
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    paidBy: [{ expenseId: partial.id, participantId: 'ada', amount: 10 }],
    isReimbursement: false,
    splitMode: 'EVENLY',
    createdAt: '2026-01-01T00:00:00.000Z',
    notes: null,
    recurrenceRule: 'NONE',
    paidFor: [{ expenseId: partial.id, participantId: 'ada', shares: 1 }],
    documents: [],
    recurringExpenseLink: null,
    ...partial,
  }
}

function group(
  extras: Partial<GroupDocument> & { expenses?: Expense[] },
): GroupDocument {
  return {
    id: 'g',
    name: 'Trip',
    information: null,
    currency: '$',
    currencyCode: 'USD',
    pinHash: null,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: null,
    lastSeenAt: null,
    deletedAt: null,
    participants: [
      { id: 'ada', name: 'Ada', groupId: 'g' },
      { id: 'bob', name: 'Bob', groupId: 'g' },
    ],
    activities: [],
    expenses: [],
    ...extras,
  }
}

describe('diffGroupChildren', () => {
  it('only upserts the new expense and activity when one expense is added', () => {
    const existing = expense({ id: 'old', title: 'Hotel' })
    const added = expense({ id: 'new', title: 'Taxi', amount: 20 })
    const previous = group({
      expenses: [existing],
      activities: [
        {
          id: 'a1',
          groupId: 'g',
          time: '2026-01-01T00:00:00.000Z',
          activityType: 'CREATE_EXPENSE',
          participantId: null,
          expenseId: 'old',
          data: 'Hotel',
        },
      ],
    })
    const next = group({
      expenses: [existing, added],
      activities: [
        {
          id: 'a2',
          groupId: 'g',
          time: '2026-01-02T00:00:00.000Z',
          activityType: 'CREATE_EXPENSE',
          participantId: null,
          expenseId: 'new',
          data: 'Taxi',
        },
        previous.activities[0],
      ],
    })

    expect(diffGroupChildren(previous, next)).toEqual({
      replaceParticipants: false,
      participants: [],
      deleteParticipantIds: [],
      deleteExpenseIds: [],
      upsertExpenses: [added],
      deleteActivityIds: [],
      insertActivities: [next.activities[0]],
    })
  })

  it('deletes a removed expense without rewriting the rest', () => {
    const keep = expense({ id: 'keep' })
    const gone = expense({ id: 'gone', title: 'Old' })
    const previous = group({ expenses: [keep, gone] })
    const next = group({ expenses: [keep] })
    expect(diffGroupChildren(previous, next)).toMatchObject({
      deleteExpenseIds: ['gone'],
      upsertExpenses: [],
    })
  })

  it('skips child writes when only group metadata changes', () => {
    const existing = expense({ id: 'e1' })
    const previous = group({ name: 'A', expenses: [existing] })
    const next = group({ name: 'B', expenses: [existing] })
    expect(diffGroupChildren(previous, next)).toEqual({
      replaceParticipants: false,
      participants: [],
      deleteParticipantIds: [],
      deleteExpenseIds: [],
      upsertExpenses: [],
      deleteActivityIds: [],
      insertActivities: [],
    })
  })

  it('replaces participants when a name or order changes', () => {
    const previous = group({})
    const next = group({
      participants: [
        { id: 'bob', name: 'Bob', groupId: 'g' },
        { id: 'ada', name: 'Ada L', groupId: 'g' },
      ],
    })
    const patch = diffGroupChildren(previous, next)
    expect(patch.replaceParticipants).toBe(true)
    expect(patch.participants).toEqual(next.participants)
  })

  it('rebuilds children from a patch so a full rewrite is not required', () => {
    const keep = expense({ id: 'keep', title: 'Hotel' })
    const added = expense({ id: 'new', title: 'Taxi', amount: 20 })
    const previous = group({
      expenses: [keep],
      activities: [
        {
          id: 'a1',
          groupId: 'g',
          time: '2026-01-01T00:00:00.000Z',
          activityType: 'CREATE_EXPENSE',
          participantId: null,
          expenseId: 'keep',
          data: 'Hotel',
        },
      ],
    })
    const next = group({
      name: 'Trip 2',
      expenses: [keep, added],
      activities: [
        {
          id: 'a2',
          groupId: 'g',
          time: '2026-01-02T00:00:00.000Z',
          activityType: 'CREATE_EXPENSE',
          participantId: null,
          expenseId: 'new',
          data: 'Taxi',
        },
        previous.activities[0],
      ],
    })
    const patched = applyGroupChildPatch(
      previous,
      diffGroupChildren(previous, next),
    )
    expect(patched.expenses.map((item) => item.id).sort()).toEqual([
      'keep',
      'new',
    ])
    expect(patched.activities.map((item) => item.id)).toEqual(['a2', 'a1'])
    expect(patched.participants).toEqual(previous.participants)
  })
})
