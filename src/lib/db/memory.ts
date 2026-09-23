import { applyGroupChildPatch, diffGroupChildren } from '@/lib/db/group-patch'
import {
  activityIsAfterCursor,
  expenseIsAfterCursor,
} from '@/lib/db/list-cursor'
import type {
  ActivityListOptions,
  ExpenseListOptions,
  GroupRepository,
  PinAttemptState,
  WriteResult,
} from '@/lib/db/repository'
import {
  RecurrenceRule,
  type Activity,
  type Expense,
  type GroupDocument,
} from '@/lib/kv/types'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function expenseTime(value: string) {
  return new Date(value).getTime()
}

function sortExpenses(expenses: Expense[]): Expense[] {
  return [...expenses].sort((a, b) => {
    const dateDiff = expenseTime(b.expenseDate) - expenseTime(a.expenseDate)
    if (dateDiff !== 0) return dateDiff
    const createdDiff = expenseTime(b.createdAt) - expenseTime(a.createdAt)
    if (createdDiff !== 0) return createdDiff
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0
  })
}

function stripHydrate(expense: Expense, options?: ExpenseListOptions): Expense {
  const next = clone(expense)
  if (options?.documents === false) next.documents = []
  if (options?.recurring === false) next.recurringExpenseLink = null
  return next
}

function applyExpenseOptions(
  expenses: Expense[],
  options?: ExpenseListOptions,
): Expense[] {
  let next = sortExpenses(expenses)
  const filter = options?.filter?.trim().toLowerCase()
  if (filter) {
    next = next.filter((expense) =>
      expense.title.toLowerCase().includes(filter),
    )
  }
  if (options?.after) {
    const after = options.after
    next = next.filter((expense) => expenseIsAfterCursor(expense, after))
  }
  if (options?.length !== undefined) {
    next = next.slice(0, options.length)
  }
  return next.map((expense) => stripHydrate(expense, options))
}

function sortActivities(activities: Activity[]): Activity[] {
  return [...activities].sort((a, b) => {
    const timeDiff = expenseTime(b.time) - expenseTime(a.time)
    if (timeDiff !== 0) return timeDiff
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0
  })
}

function applyActivityOptions(
  activities: Activity[],
  options?: ActivityListOptions,
): Activity[] {
  let next = sortActivities(activities)
  if (options?.after) {
    const after = options.after
    next = next.filter((activity) => activityIsAfterCursor(activity, after))
  }
  if (options?.length !== undefined) {
    next = next.slice(0, options.length)
  }
  return next
}

export function createMemoryRepository(
  seed: GroupDocument[] = [],
): GroupRepository {
  const groups = new Map<string, GroupDocument>()
  const pinAttempts = new Map<string, PinAttemptState>()

  for (const group of seed) {
    groups.set(group.id, clone(group))
  }

  return {
    async get(id) {
      const group = groups.get(id)
      return group ? clone(group) : null
    },
    async getMeta(id) {
      const group = groups.get(id)
      if (!group) return null
      const { expenses: _expenses, activities: _activities, ...meta } = group
      return clone(meta)
    },
    async listSummaries(ids) {
      return ids.flatMap((id) => {
        const group = groups.get(id)
        if (!group) return []
        return [
          {
            id: group.id,
            name: group.name,
            information: group.information,
            currency: group.currency,
            currencyCode: group.currencyCode,
            createdAt: group.createdAt,
            deletedAt: group.deletedAt ?? null,
            participantCount: group.participants.length,
          },
        ]
      })
    },
    async listExpenses(groupId, options) {
      const group = groups.get(groupId)
      if (!group || group.deletedAt) return []
      return applyExpenseOptions(group.expenses, options)
    },
    async listExpensesByIds(groupId, ids) {
      const group = groups.get(groupId)
      if (!group || group.deletedAt) return []
      const wanted = new Set(ids)
      return clone(group.expenses.filter((expense) => wanted.has(expense.id)))
    },
    async countExpenses(groupId, filter) {
      const group = groups.get(groupId)
      if (!group || group.deletedAt) return 0
      return applyExpenseOptions(group.expenses, { filter }).length
    },
    async listActivities(groupId, options) {
      const group = groups.get(groupId)
      if (!group) return []
      return clone(applyActivityOptions(group.activities, options))
    },
    async getExpense(groupId, expenseId) {
      const group = groups.get(groupId)
      if (!group || group.deletedAt) return null
      const expense = group.expenses.find((item) => item.id === expenseId)
      return expense ? clone(expense) : null
    },
    async expenseIdExists(expenseId) {
      for (const group of Array.from(groups.values())) {
        if (group.expenses.some((item) => item.id === expenseId)) return true
      }
      return false
    },
    async listExpenseParticipantIds(groupId) {
      const group = groups.get(groupId)
      if (!group || group.deletedAt) return []
      const ids = new Set<string>()
      for (const expense of group.expenses) {
        for (const paidBy of expense.paidBy ?? []) {
          ids.add(paidBy.participantId)
        }
        for (const paidFor of expense.paidFor ?? []) {
          ids.add(paidFor.participantId)
        }
      }
      return Array.from(ids)
    },
    async listActiveRecurring(groupId) {
      const group = groups.get(groupId)
      if (!group || group.deletedAt) return []
      return clone(
        group.expenses
          .filter(
            (expense) =>
              !expense.isReimbursement &&
              expense.recurrenceRule &&
              expense.recurrenceRule !== RecurrenceRule.NONE &&
              expense.recurringExpenseLink?.nextExpenseCreatedAt === null,
          )
          .map((expense) => ({
            amount: expense.amount,
            recurrenceRule: expense.recurrenceRule,
            isReimbursement: expense.isReimbursement,
          })),
      )
    },
    async hasDueRecurring(groupId, nowIso) {
      const group = groups.get(groupId)
      if (!group || group.deletedAt) return false
      const now = new Date(nowIso).getTime()
      return group.expenses.some(
        (expense) =>
          expense.recurringExpenseLink &&
          expense.recurringExpenseLink.nextExpenseCreatedAt === null &&
          new Date(expense.recurringExpenseLink.nextExpenseDate).getTime() <=
            now,
      )
    },
    async create(group) {
      if (groups.has(group.id)) throw new Error(`Group exists: ${group.id}`)
      groups.set(group.id, clone({ ...group, version: group.version ?? 0 }))
    },
    async save(group, expectedVersion, previous) {
      const existing = groups.get(group.id)
      if (!existing) return 'conflict'
      if ((existing.version ?? 0) !== expectedVersion) return 'conflict'
      const version = expectedVersion + 1
      if (previous) {
        const patched = applyGroupChildPatch(
          clone(previous),
          diffGroupChildren(previous, group),
        )
        groups.set(group.id, {
          ...clone(group),
          participants: patched.participants,
          expenses: patched.expenses,
          activities: patched.activities,
          version,
        })
      } else {
        groups.set(group.id, clone({ ...group, version }))
      }
      return 'ok' satisfies WriteResult
    },
    async mutateExpenses(groupId, expectedVersion, mutation) {
      const existing = groups.get(groupId)
      if (!existing || existing.deletedAt) return 'conflict'
      if ((existing.version ?? 0) !== expectedVersion) return 'conflict'
      const patched = applyGroupChildPatch(clone(existing), {
        replaceParticipants: false,
        participants: [],
        deleteParticipantIds: [],
        deleteExpenseIds: mutation.deleteExpenseIds ?? [],
        upsertExpenses: mutation.upsertExpenses ?? [],
        deleteActivityIds: [],
        insertActivities: mutation.insertActivities ?? [],
      })
      groups.set(groupId, {
        ...patched,
        lastActivityAt: mutation.lastActivityAt ?? new Date().toISOString(),
        version: expectedVersion + 1,
      })
      return 'ok' satisfies WriteResult
    },
    async delete(id) {
      groups.delete(id)
    },
    async listIds() {
      return Array.from(groups.keys())
    },
    async bumpLastSeen(id, seenAt, minIntervalMs = 60 * 60 * 1000) {
      const group = groups.get(id)
      if (!group) return
      const previous = group.lastSeenAt
        ? new Date(group.lastSeenAt).getTime()
        : 0
      if (Date.now() - previous < minIntervalMs) return
      group.lastSeenAt = seenAt
    },
    async getPinAttempt(groupId, clientKey) {
      return pinAttempts.get(`${groupId}:${clientKey}`) ?? null
    },
    async putPinAttempt(groupId, clientKey, state) {
      pinAttempts.set(`${groupId}:${clientKey}`, { ...state })
    },
  }
}
