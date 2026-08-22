import { allocatePaidForAmounts } from '@/lib/expense-shares'
import { MonthlySpendingRange } from './monthly-spending'

type BalanceTimelineParticipant = {
  id: string
  name: string
}

type BalanceTimelineCategory = {
  id: number
  grouping: string
  name: string
}

type BalanceTimelineSplitMode =
  'EVENLY' | 'BY_AMOUNT' | 'BY_PERCENTAGE' | 'BY_SHARES'

export type BalanceTimelinePaidBy = BalanceTimelineParticipant & {
  amount: number
}

export type BalanceTimelineExpense = {
  amount: number
  category: BalanceTimelineCategory | null
  createdAt?: Date
  expenseDate: Date
  id?: string
  isReimbursement: boolean
  paidBy: BalanceTimelinePaidBy[]
  paidFor: {
    participant: BalanceTimelineParticipant
    shares: number
  }[]
  splitMode: BalanceTimelineSplitMode
  title?: string
}

export type BalanceTimelineEvent = {
  amount: number
  category: BalanceTimelineCategory | null
  isReimbursement: boolean
  paidBy: BalanceTimelinePaidBy[]
  paidFor: BalanceTimelineParticipant[]
  title?: string
}

export type BalanceTimelinePoint = {
  key: string
  year: number
  month: number
  day: number
  balances: Record<string, number>
  deltas: Record<string, number>
  events: BalanceTimelineEvent[]
  hasRepayment: boolean
  isStart: boolean
}

export type BalanceTimeline = {
  points: BalanceTimelinePoint[]
  participants: BalanceTimelineParticipant[]
  maxAbsBalance: number
  rangeEnd: { year: number; month: number; day: number }
  rangeStart: { year: number; month: number; day: number }
}

type MutableBalanceTimelineDay = {
  key: string
  year: number
  month: number
  day: number
  deltas: Map<string, number>
  events: BalanceTimelineEvent[]
  hasRepayment: boolean
}

export function getBalanceTimeline(
  expenses: BalanceTimelineExpense[],
  options: { range?: MonthlySpendingRange } = {},
): BalanceTimeline {
  if (expenses.length === 0) {
    return emptyBalanceTimeline()
  }

  const range = options.range ?? '6'
  const participants = getParticipants(expenses)
  const balances = new Map(
    participants.map((participant) => [participant.id, 0]),
  )
  const sortedExpenses = [...expenses].sort(compareExpensesAscending)
  const timelineRange = getTimelineRange(sortedExpenses, range)
  const days = new Map<string, MutableBalanceTimelineDay>()

  for (const expense of sortedExpenses) {
    const expenseDeltas = getExpenseDeltas(expense)

    if (getMonthKeyFromDate(expense.expenseDate) < timelineRange.startKey) {
      addDeltasToBalances(balances, expenseDeltas)
      continue
    }

    const day = getOrCreateDay(days, expense.expenseDate)
    addDeltasToDay(day, expenseDeltas)
    day.events.push(getTimelineEvent(expense))

    if (expense.isReimbursement) {
      day.hasRepayment = true
    }
  }

  const points: BalanceTimelinePoint[] = []
  let maxAbsBalance = 0

  if (days.size > 0) {
    const startBalances = mapToRoundedRecord(balances)
    const startDeltas = Object.fromEntries(
      participants.map((participant) => [participant.id, 0]),
    )

    maxAbsBalance = getMaxAbsBalance(startBalances, maxAbsBalance)

    points.push({
      ...timelineRange.start,
      key: `${getDayKey(timelineRange.start)}-start`,
      balances: startBalances,
      deltas: startDeltas,
      events: [],
      hasRepayment: false,
      isStart: true,
    })
  }

  for (const day of Array.from(days.values()).sort((dayA, dayB) =>
    dayA.key.localeCompare(dayB.key),
  )) {
    addDeltasToBalances(balances, day.deltas)

    const pointBalances = mapToRoundedRecord(balances)
    const pointDeltas = mapToRoundedRecord(day.deltas)

    maxAbsBalance = getMaxAbsBalance(pointBalances, maxAbsBalance)

    points.push({
      key: day.key,
      year: day.year,
      month: day.month,
      day: day.day,
      balances: pointBalances,
      deltas: pointDeltas,
      events: day.events,
      hasRepayment: day.hasRepayment,
      isStart: false,
    })
  }

  return {
    points,
    participants,
    maxAbsBalance,
    rangeEnd: timelineRange.end,
    rangeStart: timelineRange.start,
  }
}

function emptyBalanceTimeline(): BalanceTimeline {
  return {
    points: [],
    participants: [],
    maxAbsBalance: 0,
    rangeEnd: { year: 0, month: 0, day: 1 },
    rangeStart: { year: 0, month: 0, day: 1 },
  }
}

function getParticipants(expenses: BalanceTimelineExpense[]) {
  const participants = new Map<string, BalanceTimelineParticipant>()

  for (const expense of expenses) {
    for (const paidBy of expense.paidBy) {
      participants.set(paidBy.id, { id: paidBy.id, name: paidBy.name })
    }

    for (const paidFor of expense.paidFor) {
      participants.set(paidFor.participant.id, paidFor.participant)
    }
  }

  return Array.from(participants.values()).sort((participantA, participantB) =>
    participantA.name.localeCompare(participantB.name),
  )
}

function compareExpensesAscending(
  expenseA: BalanceTimelineExpense,
  expenseB: BalanceTimelineExpense,
) {
  const dateDifference =
    expenseA.expenseDate.getTime() - expenseB.expenseDate.getTime()
  if (dateDifference !== 0) return dateDifference

  return (
    (expenseA.createdAt?.getTime() ?? 0) - (expenseB.createdAt?.getTime() ?? 0)
  )
}

function getTimelineRange(
  expenses: BalanceTimelineExpense[],
  range: MonthlySpendingRange,
) {
  const monthKeys = expenses.map((expense) =>
    getMonthKeyFromDate(expense.expenseDate),
  )
  const firstMonthKey = monthKeys.reduce((first, monthKey) =>
    monthKey < first ? monthKey : first,
  )
  const lastMonthKey = monthKeys.reduce((last, monthKey) =>
    monthKey > last ? monthKey : last,
  )

  const lastMonth = getMonthPartsFromKey(lastMonthKey)
  const startMonth =
    range === 'all'
      ? getMonthPartsFromKey(firstMonthKey)
      : addMonths(lastMonth.year, lastMonth.month, -Number(range) + 1)
  const endMonth = getMonthPartsFromKey(lastMonthKey)

  return {
    end: {
      ...endMonth,
      day: getDaysInMonth(endMonth.year, endMonth.month),
    },
    start: {
      ...startMonth,
      day: 1,
    },
    startKey: getMonthKeyFromParts(startMonth),
  }
}

function getTimelineEvent(expense: BalanceTimelineExpense) {
  return {
    amount: expense.amount,
    category: expense.category,
    isReimbursement: expense.isReimbursement,
    paidBy: expense.paidBy,
    paidFor: expense.paidFor.map((paidFor) => paidFor.participant),
    title: expense.title,
  }
}

function getExpenseDeltas(expense: BalanceTimelineExpense) {
  const deltas = new Map<string, number>()

  for (const paidBy of expense.paidBy) {
    addDelta(deltas, paidBy.id, paidBy.amount)
  }

  const allocations = allocatePaidForAmounts({
    id: expense.id,
    amount: expense.amount,
    paidFor: expense.paidFor.map((paidFor) => ({
      participantId: paidFor.participant.id,
      shares: paidFor.shares,
    })),
    splitMode: expense.splitMode,
  })

  for (const allocation of allocations) {
    addDelta(deltas, allocation.participantId, -allocation.amount)
  }

  return deltas
}

function getMaxAbsBalance(
  balances: Record<string, number>,
  currentMaxAbsBalance: number,
) {
  return Object.values(balances).reduce(
    (maxAbsBalance, balance) => Math.max(maxAbsBalance, Math.abs(balance)),
    currentMaxAbsBalance,
  )
}

function getOrCreateDay(
  days: Map<string, MutableBalanceTimelineDay>,
  date: Date,
) {
  const key = getDayKeyFromDate(date)
  const existingDay = days.get(key)

  if (existingDay) return existingDay

  const day = {
    key,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    deltas: new Map<string, number>(),
    events: [],
    hasRepayment: false,
  }

  days.set(key, day)
  return day
}

function addDeltasToDay(
  day: MutableBalanceTimelineDay,
  deltas: Map<string, number>,
) {
  deltas.forEach((delta, participantId) => {
    addDelta(day.deltas, participantId, delta)
  })
}

function addDeltasToBalances(
  balances: Map<string, number>,
  deltas: Map<string, number>,
) {
  deltas.forEach((delta, participantId) => {
    addDelta(balances, participantId, delta)
  })
}

function addDelta(
  deltas: Map<string, number>,
  participantId: string,
  amount: number,
) {
  deltas.set(participantId, (deltas.get(participantId) ?? 0) + amount)
}

function mapToRoundedRecord(map: Map<string, number>) {
  return Object.fromEntries(
    Array.from(map.entries()).map(([participantId, amount]) => [
      participantId,
      roundCurrencyAmount(amount),
    ]),
  )
}

function roundCurrencyAmount(amount: number) {
  return Math.round(amount) + 0
}

function getMonthKeyFromDate(date: Date) {
  return getMonthKey(date.getUTCFullYear(), date.getUTCMonth())
}

function getDayKeyFromDate(date: Date) {
  return getDayKey({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  })
}

function getDayKey(parts: { year: number; month: number; day: number }) {
  return `${getMonthKey(parts.year, parts.month)}-${String(parts.day).padStart(
    2,
    '0',
  )}`
}

function getMonthKeyFromParts(parts: { year: number; month: number }) {
  return getMonthKey(parts.year, parts.month)
}

function getMonthKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function getMonthPartsFromKey(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return { year, month: month - 1 }
}

function addMonths(year: number, month: number, monthsToAdd: number) {
  const date = new Date(Date.UTC(year, month + monthsToAdd, 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
}

function getDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}
