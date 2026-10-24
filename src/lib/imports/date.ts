import dayjs from 'dayjs'

const ISO_DATE_TIME =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/

/**
 * Reads `YYYY-MM-DD` or `YYYY-MM-DD HH:mm[:ss]` as a UTC wall-clock time.
 *
 * Import files carry dates without a timezone. Parsing them with `new Date()`
 * or `dayjs()` uses the server's local zone, and reading the UTC parts back
 * then moves the day for any server east of UTC. Building the date with
 * `Date.UTC` keeps the written calendar day whatever the server TZ is.
 *
 * Returns null for anything else, and for impossible dates such as
 * 2024-02-30 or 25:00.
 */
export function parseIsoDateTimeAsUtc(value: string): Date | null {
  const match = ISO_DATE_TIME.exec(value.trim())
  if (!match) return null
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map((part) => (part === undefined ? 0 : Number(part)))
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null
  }
  return date
}

/**
 * Parses a date cell of an import file to the UTC midnight of its calendar day,
 * or null when it is not a date.
 *
 * ISO dates are read directly. Other formats fall back to dayjs, which reads
 * them in the local zone, so the local calendar parts are the ones kept.
 */
export function parseImportDateOnly(value: string): Date | null {
  const iso = parseIsoDateTimeAsUtc(value)
  if (iso) {
    return new Date(
      Date.UTC(iso.getUTCFullYear(), iso.getUTCMonth(), iso.getUTCDate()),
    )
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = dayjs(trimmed)
  if (!parsed.isValid()) return null
  return new Date(Date.UTC(parsed.year(), parsed.month(), parsed.date()))
}
