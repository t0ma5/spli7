export const SplitMode = {
  EVENLY: 'EVENLY',
  BY_SHARES: 'BY_SHARES',
  BY_PERCENTAGE: 'BY_PERCENTAGE',
  BY_AMOUNT: 'BY_AMOUNT',
} as const
export type SplitMode = (typeof SplitMode)[keyof typeof SplitMode]

export const RecurrenceRule = {
  NONE: 'NONE',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const
export type RecurrenceRule =
  (typeof RecurrenceRule)[keyof typeof RecurrenceRule]

export const ActivityType = {
  UPDATE_GROUP: 'UPDATE_GROUP',
  CREATE_EXPENSE: 'CREATE_EXPENSE',
  UPDATE_EXPENSE: 'UPDATE_EXPENSE',
  DELETE_EXPENSE: 'DELETE_EXPENSE',
} as const
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType]

export type Participant = {
  id: string
  name: string
  groupId: string
}

export type Category = {
  id: number
  grouping: string
  name: string
}

export type ExpenseDocument = {
  id: string
  url: string
  width: number
  height: number
  expenseId?: string | null
}

export type RecurringExpenseLink = {
  id: string
  groupId: string
  currentFrameExpenseId: string
  nextExpenseCreatedAt: string | null
  nextExpenseDate: string
}

export type ExpensePaidFor = {
  expenseId: string
  participantId: string
  shares: number
}

export type Expense = {
  id: string
  groupId: string
  expenseDate: string
  title: string
  categoryId: number
  amount: number
  originalAmount: number | null
  originalCurrency: string | null
  conversionRate: number | null
  paidById: string
  isReimbursement: boolean
  splitMode: SplitMode
  createdAt: string
  notes: string | null
  recurrenceRule: RecurrenceRule | null
  paidFor: ExpensePaidFor[]
  documents: ExpenseDocument[]
  recurringExpenseLink: RecurringExpenseLink | null
}

export type Activity = {
  id: string
  groupId: string
  time: string
  activityType: ActivityType
  participantId: string | null
  expenseId: string | null
  data: string | null
}

export type GroupDocument = {
  id: string
  name: string
  information: string | null
  currency: string
  currencyCode: string | null
  createdAt: string
  participants: Participant[]
  expenses: Expense[]
  activities: Activity[]
}

export type Group = {
  id: string
  name: string
  information: string | null
  currency: string
  currencyCode: string | null
  createdAt: Date
  participants: Participant[]
}

export type ExpenseListItem = {
  amount: number
  category: Category | null
  createdAt: Date
  expenseDate: Date
  id: string
  isReimbursement: boolean
  paidBy: { id: string; name: string }
  paidFor: { shares: number; participant: { id: string; name: string } }[]
  splitMode: SplitMode
  recurrenceRule: RecurrenceRule | null
  title: string
  _count: { documents: number }
}

export type GroupListItem = {
  id: string
  name: string
  information: string | null
  currency: string
  currencyCode: string | null
  createdAt: string
  _count: { participants: number }
}
