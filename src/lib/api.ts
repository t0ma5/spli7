import 'server-only'

import { getRepository } from '@/lib/db'
import { encodeActivityCursor, encodeExpenseCursor } from '@/lib/db/list-cursor'
import {
  WRITE_RETRIES,
  type ActivityListCursor,
  type ExpenseListCursor,
  type GroupExpenseMutation,
  type GroupMeta,
} from '@/lib/db/repository'
import {
  INACTIVITY_MONTHS,
  isInactive,
  isSoftDeleteExpired,
  MAX_RECURRING_GENERATIONS_PER_RUN,
} from '@/lib/group-lifecycle'
import { hashGroupPin, isLegacyPinHash, pinMatchesHash } from '@/lib/group-pin'
import {
  getCategoryById,
  resolveCategoryId,
  SEEDED_CATEGORIES,
} from '@/lib/kv/categories'
import {
  ActivityType,
  Expense,
  getExpensePaidBy,
  Group,
  GroupDocument,
  Participant,
  RecurrenceRule,
  RecurringExpenseLink,
  SplitMode,
  type Activity,
} from '@/lib/kv/types'
import { randomId } from '@/lib/randomId'
import {
  ExpenseFormValues,
  GroupFormValues,
  GroupImportValues,
} from '@/lib/schemas'
import { parseSplitwiseCsv } from '@/lib/splitwise-import'
import { parseTricountCsv } from '@/lib/tricount-import'

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

function toIsoDateOnly(date: Date): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  ).toISOString()
}

function participantById(
  participants: Participant[],
  participantId: string,
): Participant | undefined {
  return participants.find((p) => p.id === participantId)
}

function mapGroup(group: GroupMeta): Group {
  return {
    id: group.id,
    name: group.name,
    information: group.information,
    currency: group.currency,
    currencyCode: group.currencyCode,
    hasPin: Boolean(group.pinHash),
    defaultSplitMode: group.defaultSplitMode ?? null,
    fixedExpenseDateGroups: group.fixedExpenseDateGroups ?? false,
    createdAt: toDate(group.createdAt),
    lastActivityAt: group.lastActivityAt
      ? toDate(group.lastActivityAt)
      : toDate(group.createdAt),
    deletedAt: group.deletedAt ? toDate(group.deletedAt) : null,
    participants: group.participants,
  }
}

async function getGroupDocument(
  groupId: string,
): Promise<GroupDocument | null> {
  return getRepository().get(groupId)
}

async function persistGroup(
  group: GroupDocument,
  previous: GroupDocument,
  touchActivity = true,
) {
  if (touchActivity) {
    group.lastActivityAt = new Date().toISOString()
  }
  const expected = group.version ?? 0
  const result = await getRepository().save(group, expected, previous)
  if (result === 'conflict') {
    throw new ConflictError()
  }
}

class ConflictError extends Error {
  constructor() {
    super('This group was updated by someone else. Please retry.')
    this.name = 'ConflictError'
  }
}

async function withGroupWrite<T>(
  groupId: string,
  fn: (group: GroupDocument) => T | Promise<T>,
  options?: { touchActivity?: boolean; allowDeleted?: boolean },
): Promise<T> {
  const touchActivity = options?.touchActivity ?? true
  const allowDeleted = options?.allowDeleted ?? false
  let lastError: unknown
  for (let attempt = 0; attempt < WRITE_RETRIES; attempt++) {
    const group = await getGroupDocument(groupId)
    if (!group) throw new Error(`Invalid group ID: ${groupId}`)
    if (group.deletedAt && !allowDeleted) {
      throw new Error(`Invalid group ID: ${groupId}`)
    }
    try {
      const previous = structuredClone(group)
      const value = await fn(group)
      await persistGroup(group, previous, touchActivity)
      return value
    } catch (error) {
      lastError = error
      if (!(error instanceof ConflictError)) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new ConflictError()
}

async function withExpenseWrite<T>(
  groupId: string,
  fn: (
    meta: GroupMeta,
  ) =>
    | { value: T; mutation: GroupExpenseMutation }
    | Promise<{ value: T; mutation: GroupExpenseMutation }>,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < WRITE_RETRIES; attempt++) {
    const meta = await getRepository().getMeta(groupId)
    if (!meta || meta.deletedAt) {
      throw new Error(`Invalid group ID: ${groupId}`)
    }
    try {
      const { value, mutation } = await fn(meta)
      const result = await getRepository().mutateExpenses(
        groupId,
        meta.version ?? 0,
        {
          ...mutation,
          lastActivityAt: mutation.lastActivityAt ?? new Date().toISOString(),
        },
      )
      if (result === 'conflict') throw new ConflictError()
      return value
    } catch (error) {
      lastError = error
      if (!(error instanceof ConflictError)) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new ConflictError()
}

function makeActivity(
  groupId: string,
  activityType: ActivityType,
  extra?: { participantId?: string; expenseId?: string; data?: string },
): Activity {
  return {
    id: randomId(),
    groupId,
    time: new Date().toISOString(),
    activityType,
    participantId: extra?.participantId ?? null,
    expenseId: extra?.expenseId ?? null,
    data: extra?.data ?? null,
  }
}

function assertParticipantsInGroup(
  participants: Participant[],
  expenseFormValues: ExpenseFormValues,
) {
  for (const participant of [
    ...expenseFormValues.paidBy.map((p) => p.participant),
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!participants.some((item) => item.id === participant)) {
      throw new Error(`Invalid participant ID: ${participant}`)
    }
  }
}

function assertIntegerMinorUnits(amount: number, label: string) {
  if (!Number.isInteger(amount)) {
    throw new Error(`${label} must be an integer number of minor units`)
  }
}

function appendActivity(
  group: GroupDocument,
  activityType: ActivityType,
  extra?: { participantId?: string; expenseId?: string; data?: string },
) {
  group.activities.unshift({
    id: randomId(),
    groupId: group.id,
    time: new Date().toISOString(),
    activityType,
    participantId: extra?.participantId ?? null,
    expenseId: extra?.expenseId ?? null,
    data: extra?.data ?? null,
  })
}

function buildExpenseFromForm(
  expenseFormValues: ExpenseFormValues,
  groupId: string,
  expenseId: string,
  existing?: Expense,
): Expense {
  const isCreateRecurrence =
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE

  let recurringExpenseLink: RecurringExpenseLink | null =
    existing?.recurringExpenseLink ?? null

  if (
    existing &&
    existing.recurrenceRule !== RecurrenceRule.NONE &&
    expenseFormValues.recurrenceRule === RecurrenceRule.NONE &&
    existing.recurringExpenseLink?.nextExpenseCreatedAt === null
  ) {
    recurringExpenseLink = null
  } else if (
    existing &&
    existing.recurrenceRule !== expenseFormValues.recurrenceRule &&
    existing.recurringExpenseLink?.nextExpenseCreatedAt === null &&
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE
  ) {
    recurringExpenseLink = {
      ...existing.recurringExpenseLink!,
      nextExpenseDate: calculateNextDate(
        expenseFormValues.recurrenceRule as RecurrenceRule,
        toDate(existing.expenseDate),
      ).toISOString(),
    }
  } else if (
    (!existing || existing.recurrenceRule === RecurrenceRule.NONE) &&
    isCreateRecurrence &&
    !recurringExpenseLink
  ) {
    recurringExpenseLink = createPayloadForNewRecurringExpenseLink(
      expenseFormValues.recurrenceRule as RecurrenceRule,
      expenseFormValues.expenseDate,
      groupId,
      expenseId,
    )
  }

  return {
    id: expenseId,
    groupId,
    expenseDate: toIsoDateOnly(expenseFormValues.expenseDate),
    title: expenseFormValues.title,
    categoryId: expenseFormValues.category,
    amount: expenseFormValues.amount,
    originalAmount: expenseFormValues.originalAmount ?? null,
    originalCurrency: expenseFormValues.originalCurrency || null,
    conversionRate: expenseFormValues.conversionRate ?? null,
    paidBy: expenseFormValues.paidBy.map((paidBy) => {
      const amount = Number(paidBy.amount)
      assertIntegerMinorUnits(amount, 'paidBy.amount')
      return {
        expenseId,
        participantId: paidBy.participant,
        amount,
      }
    }),
    isReimbursement: expenseFormValues.isReimbursement,
    splitMode: expenseFormValues.splitMode as SplitMode,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    notes: expenseFormValues.notes ?? null,
    recurrenceRule:
      (expenseFormValues.recurrenceRule as RecurrenceRule) ??
      RecurrenceRule.NONE,
    paidFor: expenseFormValues.paidFor.map((paidFor) => ({
      expenseId,
      participantId: paidFor.participant,
      shares: Number(paidFor.shares),
    })),
    // Documents / uploads are out of scope; SQLite is not used for binaries.
    documents: [],
    recurringExpenseLink,
  }
}

export async function createGroup(groupFormValues: GroupFormValues) {
  const id = randomId()
  const group: GroupDocument = {
    id,
    name: groupFormValues.name,
    information: groupFormValues.information ?? null,
    currency: groupFormValues.currency,
    currencyCode: groupFormValues.currencyCode || null,
    pinHash:
      groupFormValues.newPin && groupFormValues.newPin.length > 0
        ? await hashGroupPin(groupFormValues.newPin, id)
        : null,
    defaultSplitMode: groupFormValues.defaultSplitMode ?? SplitMode.EVENLY,
    fixedExpenseDateGroups: groupFormValues.fixedExpenseDateGroups ?? false,
    version: 0,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    deletedAt: null,
    participants: groupFormValues.participants.map(({ name }) => ({
      id: randomId(),
      name,
      groupId: id,
    })),
    expenses: [],
    activities: [],
  }
  await getRepository().create(group)
  return mapGroup(group)
}

/** Create a new group from a Spliit JSON export (new IDs). */
export async function createGroupFromImport(importValues: GroupImportValues) {
  const groupId = randomId()
  const participantIdMap = new Map<string, string>()
  const expenseIdMap = new Map<string, string>()

  const participants = importValues.participants.map((participant) => {
    const newId = randomId()
    participantIdMap.set(participant.id, newId)
    return {
      id: newId,
      name: participant.name,
      groupId,
    }
  })

  const expenses: Expense[] = importValues.expenses.map((expense) => {
    const expenseId = randomId()
    if (expense.id) expenseIdMap.set(expense.id, expenseId)

    const legacyPaidBy =
      expense.paidBy && expense.paidBy.length > 0
        ? expense.paidBy
        : expense.paidById
          ? [{ participantId: expense.paidById, amount: expense.amount }]
          : []

    const paidBy = legacyPaidBy.map(({ participantId, amount }) => {
      const mappedId = participantIdMap.get(participantId)
      if (!mappedId) {
        throw new Error(`Invalid paidBy participantId: ${participantId}`)
      }
      return {
        expenseId,
        participantId: mappedId,
        amount,
      }
    })
    if (paidBy.length === 0) {
      throw new Error('Expense is missing paidBy')
    }

    const categoryId = resolveCategoryId(expense.category)

    return {
      id: expenseId,
      groupId,
      expenseDate: toIsoDateOnly(expense.expenseDate),
      title: expense.title,
      categoryId,
      amount: expense.amount,
      originalAmount: expense.originalAmount ?? null,
      originalCurrency: expense.originalCurrency ?? null,
      conversionRate: expense.conversionRate ?? null,
      paidBy,
      isReimbursement: expense.isReimbursement,
      splitMode: expense.splitMode as SplitMode,
      createdAt: expense.createdAt.toISOString(),
      notes: expense.notes ?? null,
      recurrenceRule: (expense.recurrenceRule as RecurrenceRule | null) ?? null,
      paidFor: expense.paidFor.map(({ participantId, shares }) => {
        const mappedId = participantIdMap.get(participantId)
        if (!mappedId) {
          throw new Error(`Invalid paidFor participantId: ${participantId}`)
        }
        return {
          expenseId,
          participantId: mappedId,
          shares,
        }
      }),
      documents: (expense.documents ?? []).map((document) => ({
        id: randomId(),
        url: document.url,
        width: document.width,
        height: document.height,
        expenseId,
      })),
      recurringExpenseLink: null,
    }
  })

  const activities = (importValues.activities ?? []).map((activity) => {
    const mappedParticipantId = activity.participantId
      ? (participantIdMap.get(activity.participantId) ?? null)
      : null
    const mappedExpenseId = activity.expenseId
      ? (expenseIdMap.get(activity.expenseId) ?? null)
      : null

    return {
      id: randomId(),
      groupId,
      time: activity.time.toISOString(),
      activityType:
        activity.activityType as (typeof ActivityType)[keyof typeof ActivityType],
      participantId: mappedParticipantId,
      expenseId: mappedExpenseId,
      data: activity.data ?? null,
    }
  })

  const group: GroupDocument = {
    id: groupId,
    name: importValues.name,
    information: importValues.information ?? null,
    currency: importValues.currency,
    currencyCode: importValues.currencyCode || null,
    pinHash: null,
    defaultSplitMode:
      (importValues.defaultSplitMode as SplitMode | null | undefined) ??
      SplitMode.EVENLY,
    fixedExpenseDateGroups: false,
    version: 0,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    deletedAt: null,
    participants,
    expenses,
    activities,
  }

  await getRepository().create(group)
  return mapGroup(group)
}

/** Create a new group from a Tricount GDPR CSV export (new IDs). */
export async function createGroupFromTricountCsv(
  csvText: string,
  targetCurrencyCode?: string,
) {
  const parsed = await parseTricountCsv(csvText, targetCurrencyCode)
  const now = new Date().toISOString()
  const group: GroupDocument = {
    id: parsed.participants[0]?.groupId ?? randomId(),
    name: parsed.name,
    information: null,
    currency: parsed.currency,
    currencyCode: parsed.currencyCode,
    pinHash: null,
    defaultSplitMode: SplitMode.EVENLY,
    fixedExpenseDateGroups: false,
    version: 0,
    createdAt: now,
    lastActivityAt: now,
    lastSeenAt: now,
    deletedAt: null,
    participants: parsed.participants,
    expenses: parsed.expenses,
    activities: [],
  }

  // Keep participant/expense groupIds aligned if randomId above was used
  const groupId = group.id
  for (const participant of group.participants) {
    participant.groupId = groupId
  }
  for (const expense of group.expenses) {
    expense.groupId = groupId
  }

  await getRepository().create(group)
  return mapGroup(group)
}

/** Create a new group from a Splitwise CSV export (new IDs). */
export async function createGroupFromSplitwiseCsv(csvText: string) {
  const parsed = parseSplitwiseCsv(csvText)
  const now = new Date().toISOString()
  const group: GroupDocument = {
    id: parsed.participants[0]?.groupId ?? randomId(),
    name: parsed.name,
    information: null,
    currency: parsed.currency,
    currencyCode: parsed.currencyCode,
    pinHash: null,
    defaultSplitMode: SplitMode.EVENLY,
    fixedExpenseDateGroups: false,
    version: 0,
    createdAt: now,
    lastActivityAt: now,
    lastSeenAt: now,
    deletedAt: null,
    participants: parsed.participants,
    expenses: parsed.expenses,
    activities: [],
  }

  const groupId = group.id
  for (const participant of group.participants) {
    participant.groupId = groupId
  }
  for (const expense of group.expenses) {
    expense.groupId = groupId
  }

  await getRepository().create(group)
  return mapGroup(group)
}

const CLIENT_EXPENSE_ID = /^[A-Za-z0-9_-]{21}$/

export async function createExpense(
  expenseFormValues: ExpenseFormValues,
  groupId: string,
  participantId?: string,
  // The expense form mints this so the split it previews is the one saved
  // (the id seeds who takes the leftover minor unit). Omitted → server mint.
  expenseId?: string,
): Promise<Expense> {
  const id = expenseId ?? randomId()
  if (expenseId !== undefined && !CLIENT_EXPENSE_ID.test(expenseId)) {
    throw new Error('Invalid expense id')
  }
  // Inserts upsert on the global primary key. A reused id would overwrite
  // the existing row, including one in another group.
  if (await getRepository().expenseIdExists(id)) {
    throw new Error('Expense id already exists')
  }
  return withExpenseWrite(groupId, (meta) => {
    assertParticipantsInGroup(meta.participants, expenseFormValues)
    const expense = buildExpenseFromForm(expenseFormValues, groupId, id)
    return {
      value: expense,
      mutation: {
        upsertExpenses: [expense],
        insertActivities: [
          makeActivity(groupId, ActivityType.CREATE_EXPENSE, {
            participantId,
            expenseId: id,
            data: expenseFormValues.title,
          }),
        ],
      },
    }
  })
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  participantId?: string,
) {
  await withExpenseWrite(groupId, async () => {
    const existingExpense = await getRepository().getExpense(groupId, expenseId)
    return {
      value: undefined,
      mutation: {
        deleteExpenseIds: existingExpense ? [expenseId] : [],
        insertActivities: [
          makeActivity(groupId, ActivityType.DELETE_EXPENSE, {
            participantId,
            expenseId,
            data: existingExpense?.title,
          }),
        ],
      },
    }
  })
}

export async function getGroupExpensesParticipants(groupId: string) {
  return getRepository().listExpenseParticipantIds(groupId)
}

export async function getGroups(groupIds: string[]) {
  const summaries = await getRepository().listSummaries(groupIds)
  return summaries
    .filter((group) => !group.deletedAt)
    .map((group) => ({
      id: group.id,
      name: group.name,
      information: group.information,
      currency: group.currency,
      currencyCode: group.currencyCode,
      createdAt: toDate(group.createdAt).toISOString(),
      _count: { participants: group.participantCount },
    }))
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  expenseFormValues: ExpenseFormValues,
  participantId?: string,
) {
  return withExpenseWrite(groupId, async (meta) => {
    const existingExpense = await getRepository().getExpense(groupId, expenseId)
    if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)
    assertParticipantsInGroup(meta.participants, expenseFormValues)
    const updated = buildExpenseFromForm(
      expenseFormValues,
      groupId,
      expenseId,
      existingExpense,
    )
    return {
      value: updated,
      mutation: {
        upsertExpenses: [updated],
        insertActivities: [
          makeActivity(groupId, ActivityType.UPDATE_EXPENSE, {
            participantId,
            expenseId,
            data: expenseFormValues.title,
          }),
        ],
      },
    }
  })
}

export async function updateGroup(
  groupId: string,
  groupFormValues: GroupFormValues,
  participantId?: string,
) {
  return withGroupWrite(groupId, async (group) => {
    appendActivity(group, ActivityType.UPDATE_GROUP, { participantId })

    group.name = groupFormValues.name
    group.information = groupFormValues.information ?? null
    group.currency = groupFormValues.currency
    group.currencyCode = groupFormValues.currencyCode || null
    group.defaultSplitMode =
      groupFormValues.defaultSplitMode ?? SplitMode.EVENLY
    group.fixedExpenseDateGroups =
      groupFormValues.fixedExpenseDateGroups ?? false

    if (groupFormValues.clearPin) {
      if (group.pinHash) {
        if (!groupFormValues.currentPin) {
          throw new Error('Current PIN required to clear PIN')
        }
        const matches = await pinMatchesHash(
          groupFormValues.currentPin,
          groupId,
          group.pinHash,
        )
        if (!matches) {
          throw new Error('Incorrect PIN')
        }
      }
      group.pinHash = null
    } else if (groupFormValues.newPin) {
      if (group.pinHash) {
        if (!groupFormValues.currentPin) {
          throw new Error('Current PIN required to change PIN')
        }
        const matches = await pinMatchesHash(
          groupFormValues.currentPin,
          groupId,
          group.pinHash,
        )
        if (!matches) {
          throw new Error('Incorrect PIN')
        }
      }
      group.pinHash = await hashGroupPin(groupFormValues.newPin, groupId)
    }

    const nextIds = new Set(
      groupFormValues.participants
        .map((participant) => participant.id)
        .filter((id): id is string => Boolean(id)),
    )
    for (const existing of group.participants) {
      if (nextIds.has(existing.id)) continue
      const referenced = group.expenses.some(
        (expense) =>
          expense.paidBy.some((paid) => paid.participantId === existing.id) ||
          expense.paidFor.some((paid) => paid.participantId === existing.id),
      )
      if (referenced) {
        throw new Error(
          `Cannot remove ${existing.name}: they are still on an expense. Reassign or delete those expenses first.`,
        )
      }
    }

    const existingById = new Map(group.participants.map((p) => [p.id, p]))
    group.participants = groupFormValues.participants.map((participant) => {
      if (participant.id) {
        const existing = existingById.get(participant.id)
        if (existing) {
          return { ...existing, name: participant.name }
        }
      }
      return {
        id: randomId(),
        name: participant.name,
        groupId,
      }
    })

    return mapGroup(group)
  })
}

export async function verifyGroupPin(groupId: string, pin: string) {
  const group = await getRepository().getMeta(groupId)
  if (!group) return false
  if (!group.pinHash) return true
  const matches = await pinMatchesHash(pin, groupId, group.pinHash)
  if (!matches) return false
  if (isLegacyPinHash(group.pinHash)) {
    try {
      await withGroupWrite(groupId, async (fresh) => {
        if (fresh.pinHash && isLegacyPinHash(fresh.pinHash)) {
          fresh.pinHash = await hashGroupPin(pin, groupId)
        }
      })
    } catch {
      // Upgrade is best-effort; verification already succeeded.
    }
  }
  return true
}

export async function getGroup(groupId: string) {
  const group = await getRepository().getMeta(groupId)
  if (!group || group.deletedAt) return null
  void getRepository().bumpLastSeen(groupId, new Date().toISOString())
  return mapGroup(group)
}

/** Includes soft-deleted groups (for restore UI). */
export async function getGroupIncludingDeleted(groupId: string) {
  const group = await getRepository().getMeta(groupId)
  if (!group) return null
  return mapGroup(group)
}

export async function softDeleteGroup(groupId: string) {
  return withGroupWrite(
    groupId,
    (group) => {
      if (!group.deletedAt) {
        group.deletedAt = new Date().toISOString()
      }
      return mapGroup(group)
    },
    { allowDeleted: true, touchActivity: true },
  )
}

export async function restoreGroup(groupId: string) {
  return withGroupWrite(
    groupId,
    (group) => {
      group.deletedAt = null
      return mapGroup(group)
    },
    { allowDeleted: true },
  )
}

/**
 * Hard-delete soft-deleted groups past grace, and soft-delete inactive groups
 * (24 months without mutating or viewing activity).
 */
export async function cleanupExpiredGroups(now = new Date()) {
  const ids = await getRepository().listIds()
  let softDeleted = 0
  let hardDeleted = 0

  for (const groupId of ids) {
    const group = await getGroupDocument(groupId)
    if (!group) continue

    if (group.deletedAt) {
      if (isSoftDeleteExpired(group.deletedAt, now)) {
        await getRepository().delete(groupId)
        hardDeleted += 1
      }
      continue
    }

    if (isInactive(group, now)) {
      try {
        await withGroupWrite(
          groupId,
          (fresh) => {
            fresh.deletedAt = now.toISOString()
          },
          { touchActivity: false },
        )
        softDeleted += 1
      } catch {
        // Skip groups that changed under us; next cron will retry.
      }
    }
  }

  return {
    scanned: ids.length,
    softDeleted,
    hardDeleted,
    inactivityMonths: INACTIVITY_MONTHS,
  }
}

export async function getCategories() {
  return SEEDED_CATEGORIES
}

export async function materializeDueRecurringExpenses(groupId: string) {
  const now = new Date()
  const utcNow = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
    ),
  )
  if (!(await getRepository().hasDueRecurring(groupId, utcNow.toISOString()))) {
    return false
  }
  await withGroupWrite(groupId, (fresh) => {
    createRecurringExpensesForGroup(fresh)
  })
  return true
}

export async function materializeAllDueRecurringExpenses() {
  const ids = await getRepository().listIds()
  let updated = 0
  for (const id of ids) {
    try {
      if (await materializeDueRecurringExpenses(id)) updated += 1
    } catch {
      // next cron retries
    }
  }
  return { scanned: ids.length, updated }
}

export async function getGroupExpenses(
  groupId: string,
  options?: {
    after?: ExpenseListCursor
    length?: number
    filter?: string
  },
) {
  if (await materializeDueRecurringExpenses(groupId)) {
    // reloaded below
  }
  const group = await getRepository().getMeta(groupId)
  if (!group || group.deletedAt) return []
  void getRepository().bumpLastSeen(groupId, new Date().toISOString())

  const compact = options?.length === undefined
  const expenses = await getRepository().listExpenses(groupId, {
    after: options?.after,
    length: options?.length,
    filter: options?.filter,
    documents: !compact,
    recurring: !compact,
  })

  return expenses.map((expense) => {
    const paidBy = getExpensePaidBy(expense).map((pb) => {
      const participant = participantById(group.participants, pb.participantId)
      return {
        id: participant?.id ?? pb.participantId,
        name: participant?.name ?? 'Unknown',
        amount: pb.amount,
      }
    })
    return {
      amount: expense.amount,
      originalAmount: expense.originalAmount ?? null,
      originalCurrency: expense.originalCurrency ?? null,
      category: getCategoryById(expense.categoryId) ?? null,
      createdAt: toDate(expense.createdAt),
      expenseDate: toDate(expense.expenseDate),
      id: expense.id,
      isReimbursement: expense.isReimbursement,
      paidBy,
      paidFor: expense.paidFor.map((paidFor) => {
        const participant = participantById(
          group.participants,
          paidFor.participantId,
        )
        return {
          shares: paidFor.shares,
          participant: participant
            ? { id: participant.id, name: participant.name }
            : { id: paidFor.participantId, name: 'Unknown' },
        }
      }),
      splitMode: expense.splitMode,
      recurrenceRule: expense.recurrenceRule,
      title: expense.title,
      _count: { documents: expense.documents.length },
      listCursor: encodeExpenseCursor({
        expenseDate: expense.expenseDate,
        createdAt: expense.createdAt,
        id: expense.id,
      }),
    }
  })
}

export async function getGroupExpenseCount(groupId: string) {
  return getRepository().countExpenses(groupId)
}

/**
 * Current frames of active recurring expenses (the ones still generating
 * future copies). Used by stats so the subscription estimate is not multiplied
 * by every already-materialized occurrence.
 */
export async function getActiveRecurringExpenses(groupId: string) {
  await materializeDueRecurringExpenses(groupId)
  return getRepository().listActiveRecurring(groupId)
}

export async function getExpense(groupId: string, expenseId: string) {
  const expense = await getRepository().getExpense(groupId, expenseId)
  if (!expense) return null

  const paidBy = getExpensePaidBy(expense)
  return {
    ...expense,
    expenseDate: toDate(expense.expenseDate),
    createdAt: toDate(expense.createdAt),
    conversionRate: expense.conversionRate,
    paidBy,
    paidFor: expense.paidFor,
    category: getCategoryById(expense.categoryId) ?? null,
    documents: expense.documents,
    recurringExpenseLink: expense.recurringExpenseLink
      ? {
          ...expense.recurringExpenseLink,
          nextExpenseCreatedAt: expense.recurringExpenseLink
            .nextExpenseCreatedAt
            ? toDate(expense.recurringExpenseLink.nextExpenseCreatedAt)
            : null,
          nextExpenseDate: toDate(expense.recurringExpenseLink.nextExpenseDate),
        }
      : null,
  }
}

export async function getActivities(
  groupId: string,
  options?: { after?: ActivityListCursor; length?: number },
) {
  const activities = await getRepository().listActivities(groupId, options)
  const expenseIds = activities
    .map((activity) => activity.expenseId)
    .filter((id): id is string => Boolean(id))
  const uniqueIds: string[] = []
  for (const id of expenseIds) {
    if (!uniqueIds.includes(id)) uniqueIds.push(id)
  }
  const expenses = await getRepository().listExpensesByIds(groupId, uniqueIds)
  const expenseById = new Map(expenses.map((expense) => [expense.id, expense]))

  return activities.map((activity) => ({
    ...activity,
    time: toDate(activity.time),
    listCursor: encodeActivityCursor({ time: activity.time, id: activity.id }),
    expense:
      activity.expenseId !== null
        ? expenseById.get(activity.expenseId)
        : undefined,
  }))
}

export async function logActivity(
  groupId: string,
  activityType: ActivityType,
  extra?: { participantId?: string; expenseId?: string; data?: string },
) {
  await withExpenseWrite(groupId, () => ({
    value: undefined,
    mutation: {
      insertActivities: [makeActivity(groupId, activityType, extra)],
    },
  }))
}

function createRecurringExpensesForGroup(group: GroupDocument): boolean {
  const localDate = new Date()
  const utcDateFromLocal = new Date(
    Date.UTC(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate(),
      localDate.getUTCHours(),
      localDate.getUTCMinutes(),
    ),
  )

  let mutated = false
  const dueLinks = group.expenses.filter(
    (expense) =>
      expense.recurringExpenseLink &&
      expense.recurringExpenseLink.nextExpenseCreatedAt === null &&
      toDate(expense.recurringExpenseLink.nextExpenseDate) <= utcDateFromLocal,
  )

  for (const seedExpense of dueLinks) {
    let currentExpenseRecord = seedExpense
    let link = currentExpenseRecord.recurringExpenseLink
    if (!link) continue

    let newExpenseDate = toDate(link.nextExpenseDate)
    let generations = 0

    while (
      newExpenseDate < utcDateFromLocal &&
      generations < MAX_RECURRING_GENERATIONS_PER_RUN
    ) {
      generations += 1
      const newExpenseId = randomId()
      const newRecurringExpenseLinkId = randomId()
      const newRecurringExpenseNextExpenseDate = calculateNextDate(
        currentExpenseRecord.recurrenceRule as RecurrenceRule,
        newExpenseDate,
      )

      const createdAt = new Date().toISOString()
      const newExpense: Expense = {
        id: newExpenseId,
        groupId: group.id,
        expenseDate: toIsoDateOnly(newExpenseDate),
        title: currentExpenseRecord.title,
        categoryId: currentExpenseRecord.categoryId,
        amount: currentExpenseRecord.amount,
        originalAmount: currentExpenseRecord.originalAmount,
        originalCurrency: currentExpenseRecord.originalCurrency,
        conversionRate: currentExpenseRecord.conversionRate,
        paidBy: getExpensePaidBy(currentExpenseRecord).map((pb) => ({
          expenseId: newExpenseId,
          participantId: pb.participantId,
          amount: pb.amount,
        })),
        isReimbursement: currentExpenseRecord.isReimbursement,
        splitMode: currentExpenseRecord.splitMode,
        createdAt,
        notes: currentExpenseRecord.notes,
        recurrenceRule: currentExpenseRecord.recurrenceRule,
        paidFor: currentExpenseRecord.paidFor.map((paidFor) => ({
          expenseId: newExpenseId,
          participantId: paidFor.participantId,
          shares: paidFor.shares,
        })),
        documents: [],
        recurringExpenseLink: {
          id: newRecurringExpenseLinkId,
          groupId: group.id,
          currentFrameExpenseId: newExpenseId,
          nextExpenseCreatedAt: null,
          nextExpenseDate: newRecurringExpenseNextExpenseDate.toISOString(),
        },
      }

      if (currentExpenseRecord.recurringExpenseLink) {
        currentExpenseRecord.recurringExpenseLink.nextExpenseCreatedAt =
          createdAt
      }

      group.expenses.push(newExpense)
      mutated = true

      currentExpenseRecord = newExpense
      link = newExpense.recurringExpenseLink
      newExpenseDate = newRecurringExpenseNextExpenseDate
    }
  }

  return mutated
}

function createPayloadForNewRecurringExpenseLink(
  recurrenceRule: RecurrenceRule,
  priorDateToNextRecurrence: Date,
  groupId: string,
  currentFrameExpenseId: string,
): RecurringExpenseLink {
  return {
    id: randomId(),
    groupId,
    currentFrameExpenseId,
    nextExpenseCreatedAt: null,
    nextExpenseDate: calculateNextDate(
      recurrenceRule,
      priorDateToNextRecurrence,
    ).toISOString(),
  }
}

function calculateNextDate(
  recurrenceRule: RecurrenceRule,
  priorDateToNextRecurrence: Date,
): Date {
  const nextDate = new Date(priorDateToNextRecurrence)
  switch (recurrenceRule) {
    case RecurrenceRule.DAILY:
      nextDate.setUTCDate(nextDate.getUTCDate() + 1)
      break
    case RecurrenceRule.WEEKLY:
      nextDate.setUTCDate(nextDate.getUTCDate() + 7)
      break
    case RecurrenceRule.MONTHLY: {
      const nextYear = nextDate.getUTCFullYear()
      const nextMonth = nextDate.getUTCMonth() + 1
      let nextDay = nextDate.getUTCDate()

      while (!isDateInNextMonth(nextYear, nextMonth, nextDay)) {
        nextDay -= 1
      }
      nextDate.setUTCMonth(nextMonth, nextDay)
      break
    }
  }

  return nextDate
}

function isDateInNextMonth(
  utcYear: number,
  utcMonth: number,
  utcDate: number,
): boolean {
  const testDate = new Date(Date.UTC(utcYear, utcMonth, utcDate))
  return testDate.getUTCDate() === utcDate
}

export async function getGroupForExport(groupId: string) {
  const group = await getRepository().getMeta(groupId)
  if (!group) return null
  void getRepository().bumpLastSeen(groupId, new Date().toISOString())

  const [expenses, activities] = await Promise.all([
    getRepository().listExpenses(groupId),
    getRepository().listActivities(groupId),
  ])

  return {
    exportVersion: 3 as const,
    id: group.id,
    name: group.name,
    information: group.information,
    currency: group.currency,
    currencyCode: group.currencyCode,
    defaultSplitMode: group.defaultSplitMode ?? SplitMode.EVENLY,
    fixedExpenseDateGroups: group.fixedExpenseDateGroups ?? false,
    participants: group.participants.map((p) => ({ id: p.id, name: p.name })),
    expenses: expenses
      .slice()
      .sort((a, b) => {
        const dateDiff =
          toDate(a.expenseDate).getTime() - toDate(b.expenseDate).getTime()
        if (dateDiff !== 0) return dateDiff
        return toDate(a.createdAt).getTime() - toDate(b.createdAt).getTime()
      })
      .map((expense) => ({
        id: expense.id,
        createdAt: toDate(expense.createdAt),
        expenseDate: toDate(expense.expenseDate),
        title: expense.title,
        category: getCategoryById(expense.categoryId) ?? null,
        amount: expense.amount,
        originalAmount: expense.originalAmount,
        originalCurrency: expense.originalCurrency,
        conversionRate: expense.conversionRate,
        paidBy: getExpensePaidBy(expense).map(({ participantId, amount }) => ({
          participantId,
          amount,
        })),
        paidFor: expense.paidFor.map(({ participantId, shares }) => ({
          participantId,
          shares,
        })),
        isReimbursement: expense.isReimbursement,
        splitMode: expense.splitMode,
        recurrenceRule: expense.recurrenceRule,
        notes: expense.notes,
        documents: (expense.documents ?? []).map((document) => ({
          id: document.id,
          url: document.url,
          width: document.width,
          height: document.height,
        })),
      })),
    activities: activities
      .slice()
      .sort((a, b) => toDate(a.time).getTime() - toDate(b.time).getTime())
      .map((activity) => ({
        time: toDate(activity.time),
        activityType: activity.activityType,
        participantId: activity.participantId,
        expenseId: activity.expenseId,
        data: activity.data,
      })),
  }
}
