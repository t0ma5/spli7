import { RecurrenceRule } from '@/lib/kv/types'

/** Soft-delete grace before hard purge (days). */
export const SOFT_DELETE_GRACE_DAYS = 30

/** Inactivity window before automatic expiry (months). */
export const INACTIVITY_MONTHS = 24

export const MAX_RECURRING_GENERATIONS_PER_RUN = 100

export function monthsAgo(months: number, from = new Date()): Date {
  const d = new Date(from)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d
}

export function daysAgo(days: number, from = new Date()): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000)
}

export function getLastActivityAt(group: {
  lastActivityAt?: string | null
  lastSeenAt?: string | null
  createdAt: string
}): Date {
  const stamps = [group.lastActivityAt, group.lastSeenAt, group.createdAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
  return new Date(Math.max(...stamps))
}

export function isInactive(
  group: {
    lastActivityAt?: string | null
    lastSeenAt?: string | null
    createdAt: string
  },
  now = new Date(),
): boolean {
  return getLastActivityAt(group) < monthsAgo(INACTIVITY_MONTHS, now)
}

export function isSoftDeleteExpired(
  deletedAt: string,
  now = new Date(),
): boolean {
  return new Date(deletedAt) < daysAgo(SOFT_DELETE_GRACE_DAYS, now)
}

function utcDaysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/** Whether a series repeats on a fixed day of month (stored as `anchorDay`). */
export function usesAnchorDay(
  recurrenceRule: RecurrenceRule | null | undefined,
): boolean {
  return (
    recurrenceRule === RecurrenceRule.MONTHLY ||
    recurrenceRule === RecurrenceRule.YEARLY
  )
}

/**
 * Next occurrence of a recurrence.
 *
 * Monthly and yearly dates keep `anchorDay` (the day the series was created
 * on). A 31st clamps to the 28th in February, then returns to the 31st in
 * March. A yearly series on 29 February falls on the 28th in common years.
 */
export function nextRecurringDate(
  recurrenceRule: RecurrenceRule,
  prior: Date,
  anchorDay?: number | null,
): Date {
  const nextDate = new Date(prior)
  switch (recurrenceRule) {
    case RecurrenceRule.DAILY:
      nextDate.setUTCDate(nextDate.getUTCDate() + 1)
      break
    case RecurrenceRule.WEEKLY:
      nextDate.setUTCDate(nextDate.getUTCDate() + 7)
      break
    case RecurrenceRule.MONTHLY:
    case RecurrenceRule.YEARLY: {
      const monthsAhead = recurrenceRule === RecurrenceRule.MONTHLY ? 1 : 12
      const anchor = anchorDay ?? nextDate.getUTCDate()
      const probe = new Date(
        Date.UTC(
          nextDate.getUTCFullYear(),
          nextDate.getUTCMonth() + monthsAhead,
          1,
        ),
      )
      const year = probe.getUTCFullYear()
      const month = probe.getUTCMonth()
      const day = Math.min(Math.max(anchor, 1), utcDaysInMonth(year, month))
      nextDate.setUTCFullYear(year, month, day)
      break
    }
    default:
      break
  }
  return nextDate
}
