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
  createdAt: string
}): Date {
  return new Date(group.lastActivityAt || group.createdAt)
}

export function isInactive(
  group: { lastActivityAt?: string | null; createdAt: string },
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
