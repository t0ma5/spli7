import 'server-only'

import { hashGroupPin } from '@/lib/group-pin'
import {
  INACTIVITY_MONTHS,
  MAX_RECURRING_GENERATIONS_PER_RUN,
  isInactive,
  isSoftDeleteExpired,
} from '@/lib/group-lifecycle'
import { getCategoryById, resolveCategoryId } from '@/lib/kv/categories'
import {
  deleteGroupDocument,
  ensureCategories,
  getGroupDocument,
  listGroupKeys,
  putGroupDocument,
} from '@/lib/kv/store'
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
} from '@/lib/kv/types'
import { randomId } from '@/lib/randomId'
import {
  ExpenseFormValues,
  GroupFormValues,
  GroupImportValues,
} from '@/lib/schemas'
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
  group: GroupDocument,
  participantId: string,
): Participant | undefined {
  return group.participants.find((p) => p.id === participantId)
}

function mapGroup(group: GroupDocument): Group {
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

async function persistGroup(group: GroupDocument, touchActivity = true) {
  if (touchActivity) {
    group.lastActivityAt = new Date().toISOString()
  }
  await putGroupDocument(group)
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
    paidBy: expenseFormValues.paidBy.map((paidBy) => ({
      expenseId,
      participantId: paidBy.participant,
      amount: Number(paidBy.amount),
    })),
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
    // Documents / uploads are out of scope for Cloudflare KV v1
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
    fixedExpenseDateGroups:
      groupFormValues.fixedExpenseDateGroups ?? false,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    deletedAt: null,
    participants: groupFormValues.participants.map(({ name }) => ({
      id: randomId(),
      name,
      groupId: id,
    })),
    expenses: [],
    activities: [],
  }
  await persistGroup(group)
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
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    deletedAt: null,
    participants,
    expenses,
    activities,
  }

  await persistGroup(group)
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
    createdAt: now,
    lastActivityAt: now,
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

  await persistGroup(group)
  return mapGroup(group)
}

export async function createExpense(
  expenseFormValues: ExpenseFormValues,
  groupId: string,
  participantId?: string,
): Promise<Expense> {
  const group = await getGroupDocument(groupId)
  if (!group || group.deletedAt) throw new Error(`Invalid group ID: ${groupId}`)

  for (const participant of [
    ...expenseFormValues.paidBy.map((p) => p.participant),
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!group.participants.some((p) => p.id === participant))
      throw new Error(`Invalid participant ID: ${participant}`)
  }

  const expenseId = randomId()
  appendActivity(group, ActivityType.CREATE_EXPENSE, {
    participantId,
    expenseId,
    data: expenseFormValues.title,
  })

  const expense = buildExpenseFromForm(expenseFormValues, groupId, expenseId)
  group.expenses.push(expense)
  await persistGroup(group)
  return expense
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  participantId?: string,
) {
  const group = await getGroupDocument(groupId)
  if (!group || group.deletedAt) throw new Error(`Invalid group ID: ${groupId}`)

  const existingExpense = group.expenses.find((e) => e.id === expenseId)
  appendActivity(group, ActivityType.DELETE_EXPENSE, {
    participantId,
    expenseId,
    data: existingExpense?.title,
  })

  group.expenses = group.expenses.filter((e) => e.id !== expenseId)
  await persistGroup(group)
}

export async function getGroupExpensesParticipants(groupId: string) {
  const expenses = await getGroupExpenses(groupId)
  return Array.from(
    new Set(
      expenses.flatMap((e) => [
        ...e.paidBy.map((pb) => pb.id),
        ...e.paidFor.map((pf) => pf.participant.id),
      ]),
    ),
  )
}

export async function getGroups(groupIds: string[]) {
  const groups = (
    await Promise.all(groupIds.map((id) => getGroupDocument(id)))
  ).filter(
    (group): group is GroupDocument => group !== null && !group.deletedAt,
  )

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    information: group.information,
    currency: group.currency,
    currencyCode: group.currencyCode,
    createdAt: toDate(group.createdAt).toISOString(),
    _count: { participants: group.participants.length },
  }))
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  expenseFormValues: ExpenseFormValues,
  participantId?: string,
) {
  const group = await getGroupDocument(groupId)
  if (!group || group.deletedAt) throw new Error(`Invalid group ID: ${groupId}`)

  const existingIndex = group.expenses.findIndex((e) => e.id === expenseId)
  if (existingIndex === -1) throw new Error(`Invalid expense ID: ${expenseId}`)
  const existingExpense = group.expenses[existingIndex]

  for (const participant of [
    ...expenseFormValues.paidBy.map((p) => p.participant),
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!group.participants.some((p) => p.id === participant))
      throw new Error(`Invalid participant ID: ${participant}`)
  }

  appendActivity(group, ActivityType.UPDATE_EXPENSE, {
    participantId,
    expenseId,
    data: expenseFormValues.title,
  })

  const updated = buildExpenseFromForm(
    expenseFormValues,
    groupId,
    expenseId,
    existingExpense,
  )
  group.expenses[existingIndex] = updated
  await persistGroup(group)
  return updated
}

export async function updateGroup(
  groupId: string,
  groupFormValues: GroupFormValues,
  participantId?: string,
) {
  const group = await getGroupDocument(groupId)
  if (!group || group.deletedAt) throw new Error('Invalid group ID')

  appendActivity(group, ActivityType.UPDATE_GROUP, { participantId })

  group.name = groupFormValues.name
  group.information = groupFormValues.information ?? null
  group.currency = groupFormValues.currency
  group.currencyCode = groupFormValues.currencyCode || null
  group.defaultSplitMode = groupFormValues.defaultSplitMode ?? SplitMode.EVENLY
  group.fixedExpenseDateGroups =
    groupFormValues.fixedExpenseDateGroups ?? false

  if (groupFormValues.clearPin) {
    if (group.pinHash) {
      if (!groupFormValues.currentPin) {
        throw new Error('Current PIN required to clear PIN')
      }
      const currentHash = await hashGroupPin(
        groupFormValues.currentPin,
        groupId,
      )
      if (currentHash !== group.pinHash) {
        throw new Error('Incorrect PIN')
      }
    }
    group.pinHash = null
  } else if (groupFormValues.newPin) {
    if (group.pinHash) {
      if (!groupFormValues.currentPin) {
        throw new Error('Current PIN required to change PIN')
      }
      const currentHash = await hashGroupPin(
        groupFormValues.currentPin,
        groupId,
      )
      if (currentHash !== group.pinHash) {
        throw new Error('Incorrect PIN')
      }
    }
    group.pinHash = await hashGroupPin(groupFormValues.newPin, groupId)
  }

  // Rebuild in form order so drag/sort order is persisted (stable IDs preserved).
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

  await persistGroup(group)
  return mapGroup(group)
}

export async function verifyGroupPin(groupId: string, pin: string) {
  const group = await getGroupDocument(groupId)
  if (!group) return false
  if (!group.pinHash) return true
  const hash = await hashGroupPin(pin, groupId)
  return hash === group.pinHash
}

export async function getGroup(groupId: string) {
  const group = await getGroupDocument(groupId)
  if (!group || group.deletedAt) return null
  return mapGroup(group)
}

/** Includes soft-deleted groups (for restore UI). */
export async function getGroupIncludingDeleted(groupId: string) {
  const group = await getGroupDocument(groupId)
  if (!group) return null
  return mapGroup(group)
}

export async function softDeleteGroup(groupId: string) {
  const group = await getGroupDocument(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)
  if (group.deletedAt) return mapGroup(group)
  group.deletedAt = new Date().toISOString()
  await persistGroup(group)
  return mapGroup(group)
}

export async function restoreGroup(groupId: string) {
  const group = await getGroupDocument(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)
  group.deletedAt = null
  await persistGroup(group)
  return mapGroup(group)
}

/**
 * Hard-delete soft-deleted groups past grace, and soft-delete inactive groups
 * (24 months without mutating activity).
 */
export async function cleanupExpiredGroups(now = new Date()) {
  const keys = await listGroupKeys()
  let softDeleted = 0
  let hardDeleted = 0

  for (const key of keys) {
    const groupId = key.startsWith('group:') ? key.slice('group:'.length) : key
    const group = await getGroupDocument(groupId)
    if (!group) continue

    if (group.deletedAt) {
      if (isSoftDeleteExpired(group.deletedAt, now)) {
        await deleteGroupDocument(groupId)
        hardDeleted += 1
      }
      continue
    }

    if (isInactive(group, now)) {
      group.deletedAt = now.toISOString()
      await persistGroup(group, false)
      softDeleted += 1
    }
  }

  return { scanned: keys.length, softDeleted, hardDeleted, inactivityMonths: INACTIVITY_MONTHS }
}

export async function getCategories() {
  return ensureCategories()
}

export async function getGroupExpenses(
  groupId: string,
  options?: { offset?: number; length?: number; filter?: string },
) {
  const group = await getGroupDocument(groupId)
  if (!group || group.deletedAt) return []

  const mutated = createRecurringExpensesForGroup(group)
  if (mutated) {
    await persistGroup(group)
  }

  let expenses = [...group.expenses]
  if (options?.filter) {
    const filter = options.filter.toLowerCase()
    expenses = expenses.filter((expense) =>
      expense.title.toLowerCase().includes(filter),
    )
  }

  expenses.sort((a, b) => {
    const dateDiff =
      toDate(b.expenseDate).getTime() - toDate(a.expenseDate).getTime()
    if (dateDiff !== 0) return dateDiff
    return toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()
  })

  if (options?.offset !== undefined || options?.length !== undefined) {
    const offset = options.offset ?? 0
    const length = options.length
    expenses =
      length === undefined
        ? expenses.slice(offset)
        : expenses.slice(offset, offset + length)
  }

  return expenses.map((expense) => {
    const paidBy = getExpensePaidBy(expense).map((pb) => {
      const participant = participantById(group, pb.participantId)
      return {
        id: participant?.id ?? pb.participantId,
        name: participant?.name ?? 'Unknown',
        amount: pb.amount,
      }
    })
    return {
      amount: expense.amount,
      category: getCategoryById(expense.categoryId) ?? null,
      createdAt: toDate(expense.createdAt),
      expenseDate: toDate(expense.expenseDate),
      id: expense.id,
      isReimbursement: expense.isReimbursement,
      paidBy,
      paidFor: expense.paidFor.map((paidFor) => {
        const participant = participantById(group, paidFor.participantId)
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
    }
  })
}

export async function getGroupExpenseCount(groupId: string) {
  const group = await getGroupDocument(groupId)
  return group?.expenses.length ?? 0
}

export async function getExpense(groupId: string, expenseId: string) {
  const group = await getGroupDocument(groupId)
  if (!group) return null
  const expense = group.expenses.find((e) => e.id === expenseId)
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
  options?: { offset?: number; length?: number },
) {
  const group = await getGroupDocument(groupId)
  if (!group) return []

  let activities = [...group.activities].sort(
    (a, b) => toDate(b.time).getTime() - toDate(a.time).getTime(),
  )

  if (options?.offset !== undefined || options?.length !== undefined) {
    const offset = options.offset ?? 0
    const length = options.length
    activities =
      length === undefined
        ? activities.slice(offset)
        : activities.slice(offset, offset + length)
  }

  return activities.map((activity) => ({
    ...activity,
    time: toDate(activity.time),
    expense:
      activity.expenseId !== null
        ? group.expenses.find((expense) => expense.id === activity.expenseId)
        : undefined,
  }))
}

export async function logActivity(
  groupId: string,
  activityType: ActivityType,
  extra?: { participantId?: string; expenseId?: string; data?: string },
) {
  const group = await getGroupDocument(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)
  appendActivity(group, activityType, extra)
  await persistGroup(group)
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
  const group = await getGroupDocument(groupId)
  if (!group) return null

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
    expenses: group.expenses
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
    activities: group.activities
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
