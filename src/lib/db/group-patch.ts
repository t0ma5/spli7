import {
  getExpensePaidBy,
  type Activity,
  type Expense,
  type GroupDocument,
  type Participant,
} from '@/lib/kv/types'

export type GroupChildPatch = {
  replaceParticipants: boolean
  participants: Participant[]
  deleteParticipantIds: string[]
  deleteExpenseIds: string[]
  upsertExpenses: Expense[]
  deleteActivityIds: string[]
  insertActivities: Activity[]
}

function snapshotParticipants(participants: Participant[]): string {
  return participants
    .map(
      (participant, index) =>
        `${participant.id}\0${participant.name}\0${index}`,
    )
    .join('\n')
}

function snapshotExpense(expense: Expense): string {
  const paidBy = getExpensePaidBy(expense)
    .map((row) => `${row.participantId}:${row.amount}`)
    .sort()
  const paidFor = [...(expense.paidFor ?? [])]
    .map((row) => `${row.participantId}:${row.shares}`)
    .sort()
  const documents = [...(expense.documents ?? [])]
    .map(
      (document) =>
        `${document.id}:${document.url}:${document.width}:${document.height}`,
    )
    .sort()
  const link = expense.recurringExpenseLink
  return [
    expense.expenseDate,
    expense.title,
    expense.categoryId,
    expense.amount,
    expense.originalAmount,
    expense.originalCurrency,
    expense.conversionRate,
    expense.isReimbursement,
    expense.splitMode,
    expense.createdAt,
    expense.notes,
    expense.recurrenceRule,
    paidBy.join(','),
    paidFor.join(','),
    documents.join(','),
    link
      ? `${link.id}:${link.nextExpenseCreatedAt}:${link.nextExpenseDate}`
      : '',
  ].join('\0')
}

export function diffGroupChildren(
  previous: GroupDocument,
  next: GroupDocument,
): GroupChildPatch {
  const previousExpenses = new Map(
    previous.expenses.map((expense) => [expense.id, expense]),
  )
  const nextExpenses = new Map(
    next.expenses.map((expense) => [expense.id, expense]),
  )
  const deleteExpenseIds: string[] = []
  previousExpenses.forEach((_, id) => {
    if (!nextExpenses.has(id)) deleteExpenseIds.push(id)
  })
  const upsertExpenses: Expense[] = []
  for (const expense of next.expenses) {
    const before = previousExpenses.get(expense.id)
    if (!before || snapshotExpense(before) !== snapshotExpense(expense)) {
      upsertExpenses.push(expense)
    }
  }

  const previousActivities = new Map(
    previous.activities.map((activity) => [activity.id, activity]),
  )
  const nextActivityIds = new Set(
    next.activities.map((activity) => activity.id),
  )
  const deleteActivityIds: string[] = []
  previousActivities.forEach((_, id) => {
    if (!nextActivityIds.has(id)) deleteActivityIds.push(id)
  })
  const insertActivities = next.activities.filter(
    (activity) => !previousActivities.has(activity.id),
  )

  const previousParticipantIds = new Set(
    previous.participants.map((participant) => participant.id),
  )
  const nextParticipantIds = new Set(
    next.participants.map((participant) => participant.id),
  )
  const deleteParticipantIds: string[] = []
  previousParticipantIds.forEach((id) => {
    if (!nextParticipantIds.has(id)) deleteParticipantIds.push(id)
  })
  const replaceParticipants =
    snapshotParticipants(previous.participants) !==
    snapshotParticipants(next.participants)

  return {
    replaceParticipants,
    participants: replaceParticipants ? next.participants : [],
    deleteParticipantIds,
    deleteExpenseIds,
    upsertExpenses,
    deleteActivityIds,
    insertActivities,
  }
}

/** Apply a child-row diff to a snapshot. Used by the memory repo to match D1. */
export function applyGroupChildPatch(
  previous: GroupDocument,
  patch: GroupChildPatch,
): GroupDocument {
  const participants = patch.replaceParticipants
    ? patch.participants
    : previous.participants.filter(
        (participant) => !patch.deleteParticipantIds.includes(participant.id),
      )

  const deletedExpenses = new Set(patch.deleteExpenseIds)
  const expensesById = new Map(
    previous.expenses
      .filter((expense) => !deletedExpenses.has(expense.id))
      .map((expense) => [expense.id, expense]),
  )
  for (const expense of patch.upsertExpenses) {
    expensesById.set(expense.id, expense)
  }

  const deletedActivities = new Set(patch.deleteActivityIds)
  const remainingActivities = previous.activities.filter(
    (activity) => !deletedActivities.has(activity.id),
  )
  const activities = [...patch.insertActivities, ...remainingActivities]

  return {
    ...previous,
    participants,
    expenses: Array.from(expensesById.values()),
    activities,
  }
}
