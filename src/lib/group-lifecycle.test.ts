import {
  INACTIVITY_MONTHS,
  SOFT_DELETE_GRACE_DAYS,
  isInactive,
  isSoftDeleteExpired,
  monthsAgo,
  nextRecurringDate,
  usesAnchorDay,
} from '@/lib/group-lifecycle'
import { RecurrenceRule } from '@/lib/kv/types'

describe('group-lifecycle', () => {
  const now = new Date('2026-08-30T00:00:00.000Z')

  it('treats recent reads as activity', () => {
    expect(
      isInactive(
        {
          createdAt: '2020-01-01T00:00:00.000Z',
          lastActivityAt: '2020-01-01T00:00:00.000Z',
          lastSeenAt: now.toISOString(),
        },
        now,
      ),
    ).toBe(false)
  })

  it('expires when both activity and last seen are old', () => {
    expect(
      isInactive(
        {
          createdAt: monthsAgo(INACTIVITY_MONTHS + 1, now).toISOString(),
          lastActivityAt: monthsAgo(INACTIVITY_MONTHS + 1, now).toISOString(),
          lastSeenAt: monthsAgo(INACTIVITY_MONTHS + 1, now).toISOString(),
        },
        now,
      ),
    ).toBe(true)
  })

  it('hard-delete grace is 30 days', () => {
    const deletedAt = new Date(
      now.getTime() - (SOFT_DELETE_GRACE_DAYS + 1) * 24 * 60 * 60 * 1000,
    ).toISOString()
    expect(isSoftDeleteExpired(deletedAt, now)).toBe(true)
  })

  it('keeps the monthly anchor day after a short month', () => {
    const january = new Date(Date.UTC(2025, 0, 31))
    const february = nextRecurringDate(RecurrenceRule.MONTHLY, january, 31)
    expect(february.toISOString().slice(0, 10)).toBe('2025-02-28')
    const march = nextRecurringDate(RecurrenceRule.MONTHLY, february, 31)
    expect(march.toISOString().slice(0, 10)).toBe('2025-03-31')
  })
})

describe('nextRecurringDate yearly', () => {
  const day = (date: Date) => date.toISOString().slice(0, 10)

  it('repeats on the same day one year later', () => {
    const start = new Date(Date.UTC(2025, 2, 15))
    expect(day(nextRecurringDate(RecurrenceRule.YEARLY, start, 15))).toBe(
      '2026-03-15',
    )
  })

  it('returns to 29 February in the next leap year', () => {
    let date = new Date(Date.UTC(2024, 1, 29))
    const dates = []
    for (let i = 0; i < 4; i++) {
      date = nextRecurringDate(RecurrenceRule.YEARLY, date, 29)
      dates.push(day(date))
    }
    expect(dates).toEqual([
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ])
  })

  it('falls back to the day of the prior date without an anchor', () => {
    const start = new Date(Date.UTC(2025, 11, 31))
    expect(day(nextRecurringDate(RecurrenceRule.YEARLY, start))).toBe(
      '2026-12-31',
    )
  })
})

describe('usesAnchorDay', () => {
  it('is true only for monthly and yearly', () => {
    expect(usesAnchorDay(RecurrenceRule.MONTHLY)).toBe(true)
    expect(usesAnchorDay(RecurrenceRule.YEARLY)).toBe(true)
    expect(usesAnchorDay(RecurrenceRule.DAILY)).toBe(false)
    expect(usesAnchorDay(RecurrenceRule.WEEKLY)).toBe(false)
    expect(usesAnchorDay(RecurrenceRule.NONE)).toBe(false)
    expect(usesAnchorDay(null)).toBe(false)
  })
})
