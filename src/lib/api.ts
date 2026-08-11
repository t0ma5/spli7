import 'server-only'

import { hashGroupPin } from '@/lib/group-pin'
import { getCategoryById, resolveCategoryId } from '@/lib/kv/categories'
import {
  ensureCategories,
  getGroupDocument,
  putGroupDocument,
} from '@/lib/kv/store'
import {
  ActivityType,
  Expense,
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
    createdAt: toDate(group.createdAt),
    participants: group.participants,
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
    paidById: expenseFormValues.paidBy,
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
    createdAt: new Date().toISOString(),
    participants: groupFormValues.participants.map(({ name }) => ({
      id: randomId(),
      name,
      groupId: id,
    })),
    expenses: [],
    activities: [],
  }
  await putGroupDocument(group)
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

    const paidById = participantIdMap.get(expense.paidById)
    if (!paidById) {
      throw new Error(`Invalid paidById: ${expense.paidById}`)
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
      paidById,
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
      documents: [],
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
    createdAt: new Date().toISOString(),
    participants,
    expenses,
    activities,
  }

  await putGroupDocument(group)
  return mapGroup(group)
}

export async function createExpense(
  expenseFormValues: ExpenseFormValues,
  groupId: string,
  participantId?: string,
): Promise<Expense> {
  const group = await getGroupDocument(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  for (const participant of [
    expenseFormValues.paidBy,
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
  await putGroupDocument(group)
  return expense
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  participantId?: string,
) {
  const group = await getGroupDocument(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  const existingExpense = group.expenses.find((e) => e.id === expenseId)
  appendActivity(group, ActivityType.DELETE_EXPENSE, {
    participantId,
    expenseId,
    data: existingExpense?.title,
  })

  group.expenses = group.expenses.filter((e) => e.id !== expenseId)
  await putGroupDocument(group)
}

export async function getGroupExpensesParticipants(groupId: string) {
  const expenses = await getGroupExpenses(groupId)
  return Array.from(
    new Set(
      expenses.flatMap((e) => [
        e.paidBy.id,
        ...e.paidFor.map((pf) => pf.participant.id),
      ]),
    ),
  )
}

export async function getGroups(groupIds: string[]) {
  const groups = (
    await Promise.all(groupIds.map((id) => getGroupDocument(id)))
  ).filter((group): group is GroupDocument => group !== null)

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
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  const existingIndex = group.expenses.findIndex((e) => e.id === expenseId)
  if (existingIndex === -1) throw new Error(`Invalid expense ID: ${expenseId}`)
  const existingExpense = group.expenses[existingIndex]

  for (const participant of [
    expenseFormValues.paidBy,
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
  await putGroupDocument(group)
  return updated
}

export async function updateGroup(
  groupId: string,
  groupFormValues: GroupFormValues,
  participantId?: string,
) {
  const group = await getGroupDocument(groupId)
  if (!group) throw new Error('Invalid group ID')

  appendActivity(group, ActivityType.UPDATE_GROUP, { participantId })

  group.name = groupFormValues.name
  group.information = groupFormValues.information ?? null
  group.currency = groupFormValues.currency
  group.currencyCode = groupFormValues.currencyCode || null
  group.defaultSplitMode = groupFormValues.defaultSplitMode ?? SplitMode.EVENLY

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

  const keptIds = new Set(
    groupFormValues.participants
      .map((p) => p.id)
      .filter((id): id is string => Boolean(id)),
  )
  group.participants = group.participants.filter((p) => keptIds.has(p.id))

  for (const participant of groupFormValues.participants) {
    if (participant.id) {
      const existing = group.participants.find((p) => p.id === participant.id)
      if (existing) existing.name = participant.name
    } else {
      group.participants.push({
        id: randomId(),
        name: participant.name,
        groupId,
      })
    }
  }

  await putGroupDocument(group)
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
  if (!group) return null
  return mapGroup(group)
}

export async function getCategories() {
  return ensureCategories()
}

export async function getGroupExpenses(
  groupId: string,
  options?: { offset?: number; length?: number; filter?: string },
) {
  const group = await getGroupDocument(groupId)
  if (!group) return []

  const mutated = createRecurringExpensesForGroup(group)
  if (mutated) {
    await putGroupDocument(group)
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
    const paidBy = participantById(group, expense.paidById)
    return {
      amount: expense.amount,
      category: getCategoryById(expense.categoryId) ?? null,
      createdAt: toDate(expense.createdAt),
      expenseDate: toDate(expense.expenseDate),
      id: expense.id,
      isReimbursement: expense.isReimbursement,
      paidBy: paidBy
        ? { id: paidBy.id, name: paidBy.name }
        : { id: expense.paidById, name: 'Unknown' },
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

  const paidBy = participantById(group, expense.paidById)
  return {
    ...expense,
    expenseDate: toDate(expense.expenseDate),
    createdAt: toDate(expense.createdAt),
    conversionRate: expense.conversionRate,
    paidBy: paidBy ?? {
      id: expense.paidById,
      name: 'Unknown',
      groupId,
    },
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
  await putGroupDocument(group)
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

    while (newExpenseDate < utcDateFromLocal) {
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
        paidById: currentExpenseRecord.paidById,
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
    exportVersion: 2 as const,
    id: group.id,
    name: group.name,
    information: group.information,
    currency: group.currency,
    currencyCode: group.currencyCode,
    defaultSplitMode: group.defaultSplitMode ?? SplitMode.EVENLY,
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
        paidById: expense.paidById,
        paidFor: expense.paidFor.map(({ participantId, shares }) => ({
          participantId,
          shares,
        })),
        isReimbursement: expense.isReimbursement,
        splitMode: expense.splitMode,
        recurrenceRule: expense.recurrenceRule,
        notes: expense.notes,
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
