import dayjs from 'dayjs'
import {
  groupExpensesByCalendarMonth,
  groupExpensesByRelativeDate,
} from './expense-date-groups'

const options = {
  currentMonthLabel: 'Current Month',
  locale: 'en-US',
  now: new Date('2026-06-15T12:00:00.000Z'),
}

function expense(expenseDate: string) {
  return { expenseDate: new Date(expenseDate) }
}

describe('groupExpensesByCalendarMonth', () => {
  it('includes the current month suffix for the current month', () => {
    const groups = groupExpensesByCalendarMonth(
      [expense('2026-06-15T00:00:00.000Z')],
      options,
    )

    expect(groups[0]?.label).toBe('June - Current Month')
  })

  it('omits the year for a previous month in the same year', () => {
    const groups = groupExpensesByCalendarMonth(
      [expense('2026-05-15T00:00:00.000Z')],
      options,
    )

    expect(groups[0]?.label).toBe('May')
  })

  it('includes the year for a month outside the current year', () => {
    const groups = groupExpensesByCalendarMonth(
      [expense('2025-12-15T00:00:00.000Z')],
      options,
    )

    expect(groups[0]?.label).toBe('December 2025')
  })

  it('uses UTC date parts when assigning expenses to a month', () => {
    const groups = groupExpensesByCalendarMonth(
      [expense('2026-06-01T00:00:00.000Z')],
      options,
    )

    expect(groups[0]?.key).toBe('2026-06')
    expect(groups[0]?.label).toBe('June - Current Month')
  })
})

/**
 * `expenseDate` is a DATE column, so it is carried at UTC midnight. Parsed in
 * the local timezone it lands on the previous day west of UTC, which used to
 * file a first-of-month expense under "Last month" while its card showed the
 * stored day. The suite is pinned to America/Los_Angeles (see jest.config.ts)
 * so these cases fail without `dateOnlyToLocalDate`.
 */
describe('groupExpensesByRelativeDate', () => {
  const weekStartsOn = 0

  it('groups a DATE value by its stored calendar day, not the local one', () => {
    const groups = groupExpensesByRelativeDate(
      [expense('2024-08-01T00:00:00.000Z')],
      dayjs('2024-08-20'),
      weekStartsOn,
    )

    expect(groups.map((group) => group.key)).toEqual(['earlierThisMonth'])
  })

  it('does not read a first-of-year value as the last day of the previous year', () => {
    const groups = groupExpensesByRelativeDate(
      [expense('2024-01-01T00:00:00.000Z')],
      dayjs('2024-06-15'),
      weekStartsOn,
    )

    expect(groups.map((group) => group.key)).toEqual(['earlierThisYear'])
  })

  it('files an expense dated today under this week whatever the time of day', () => {
    const groups = groupExpensesByRelativeDate(
      [expense('2024-08-20T00:00:00.000Z')],
      dayjs('2024-08-20T09:00'),
      weekStartsOn,
    )

    expect(groups.map((group) => group.key)).toEqual(['thisWeek'])
  })

  it('does not move the stored day forwards on an east-of-UTC host', () => {
    const groups = groupExpensesByRelativeDate(
      [expense('2024-08-31T00:00:00.000Z')],
      dayjs('2024-09-10'),
      weekStartsOn,
    )

    expect(groups.map((group) => group.key)).toEqual(['lastMonth'])
  })

  it('accumulates several expenses into the same bucket', () => {
    const groups = groupExpensesByRelativeDate(
      [
        { id: 'first', expenseDate: new Date('2024-08-05T00:00:00.000Z') },
        { id: 'second', expenseDate: new Date('2024-08-12T00:00:00.000Z') },
        { id: 'other', expenseDate: new Date('2024-07-15T00:00:00.000Z') },
      ],
      dayjs('2024-08-20'),
      weekStartsOn,
    )

    expect(groups.map((group) => group.key)).toEqual([
      'earlierThisMonth',
      'lastMonth',
    ])
    expect(groups[0]?.expenses.map((item) => item.id)).toEqual([
      'first',
      'second',
    ])
    expect(groups[1]?.expenses.map((item) => item.id)).toEqual(['other'])
  })
})
