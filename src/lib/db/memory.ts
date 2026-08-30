import type {
  ActivityListOptions,
  ExpenseListOptions,
  GroupRepository,
  PinAttemptState,
  WriteResult,
} from '@/lib/db/repository'
import type { Activity, Expense, GroupDocument } from '@/lib/kv/types'

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
    return expenseTime(b.createdAt) - expenseTime(a.createdAt)
  })
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
  if (options?.offset !== undefined || options?.length !== undefined) {
    const offset = options.offset ?? 0
    const length = options.length
    next =
      length === undefined
        ? next.slice(offset)
        : next.slice(offset, offset + length)
  }
  return next
}

function applyActivityOptions(
  activities: Activity[],
  options?: ActivityListOptions,
): Activity[] {
  let next = [...activities].sort(
    (a, b) => expenseTime(b.time) - expenseTime(a.time),
  )
  if (options?.offset !== undefined || options?.length !== undefined) {
    const offset = options.offset ?? 0
    const length = options.length
    next =
      length === undefined
        ? next.slice(offset)
        : next.slice(offset, offset + length)
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
      return clone(applyExpenseOptions(group.expenses, options))
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
    async save(group, expectedVersion, _previous) {
      const existing = groups.get(group.id)
      if (!existing) return 'conflict'
      if ((existing.version ?? 0) !== expectedVersion) return 'conflict'
      groups.set(group.id, clone({ ...group, version: expectedVersion + 1 }))
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
