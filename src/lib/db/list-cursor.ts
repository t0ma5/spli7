export type ExpenseListCursor = {
  expenseDate: string
  createdAt: string
  id: string
}

export type ActivityListCursor = {
  time: string
  id: string
}

const SEP = '\u001f'

export function encodeExpenseCursor(cursor: ExpenseListCursor): string {
  return [cursor.expenseDate, cursor.createdAt, cursor.id].join(SEP)
}

export function decodeExpenseCursor(raw: string): ExpenseListCursor | null {
  const [expenseDate, createdAt, id] = raw.split(SEP)
  if (!expenseDate || !createdAt || !id) return null
  return { expenseDate, createdAt, id }
}

export function encodeActivityCursor(cursor: ActivityListCursor): string {
  return [cursor.time, cursor.id].join(SEP)
}

export function decodeActivityCursor(raw: string): ActivityListCursor | null {
  const [time, id] = raw.split(SEP)
  if (!time || !id) return null
  return { time, id }
}

/** True when `row` sorts after `after` in expense_date DESC, created_at DESC, id DESC. */
export function expenseIsAfterCursor(
  row: ExpenseListCursor,
  after: ExpenseListCursor,
): boolean {
  if (row.expenseDate !== after.expenseDate) {
    return row.expenseDate < after.expenseDate
  }
  if (row.createdAt !== after.createdAt) {
    return row.createdAt < after.createdAt
  }
  return row.id < after.id
}

/** True when `row` sorts after `after` in time DESC, id DESC. */
export function activityIsAfterCursor(
  row: ActivityListCursor,
  after: ActivityListCursor,
): boolean {
  if (row.time !== after.time) return row.time < after.time
  return row.id < after.id
}
