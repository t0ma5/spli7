import 'server-only'

import { getD1 } from '@/lib/db/client'
import { del, list, put } from '@vercel/blob'
import { gzipSync } from 'node:zlib'

/**
 * Every table the app writes, in an order that restores without breaking
 * foreign keys. scripts/backup-db.mjs and scripts/restore-db.mjs use the same
 * list. pin_attempts is left out on purpose: it is short-lived rate limiting.
 */
export const BACKUP_TABLES = [
  'groups',
  'participants',
  'expenses',
  'expense_paid_by',
  'expense_paid_for',
  'expense_documents',
  'recurring_expense_links',
  'activities',
] as const

export const BACKUP_FORMAT = 'spli7-backup-1'
const PREFIX = 'backups/'
const KEEP_DAILY = 30
const KEEP_MONTHLY = 12

export async function buildBackup() {
  const db = await getD1()
  const tables: Record<string, unknown[]> = {}
  for (const table of BACKUP_TABLES) {
    const { results } = await db.prepare(`SELECT * FROM ${table}`).all()
    tables[table] = results
  }
  return {
    ok: true as const,
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    tables,
  }
}

function backupPathname(date: string) {
  return `${PREFIX}spli7-backup-${date}.json.gz`
}

function dateOf(pathname: string): string | null {
  return (
    /spli7-backup-(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(pathname)?.[1] ?? null
  )
}

/**
 * Which dated backups to keep: the newest `KEEP_DAILY` days, plus the first
 * backup of each of the last `KEEP_MONTHLY` months.
 */
export function backupsToDelete(dates: string[]): string[] {
  const sorted = Array.from(new Set(dates)).sort().reverse()
  const keep = new Set(sorted.slice(0, KEEP_DAILY))
  const firstOfMonth = new Map<string, string>()
  for (const date of sorted) firstOfMonth.set(date.slice(0, 7), date)
  Array.from(firstOfMonth.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, KEEP_MONTHLY)
    .forEach(([, date]) => keep.add(date))
  return sorted.filter((date) => !keep.has(date))
}

/** Write today's dump to the private Blob store and prune old ones. */
export async function storeBackup() {
  const backup = await buildBackup()
  const date = backup.exportedAt.slice(0, 10)
  const body = gzipSync(JSON.stringify(backup))
  const pathname = backupPathname(date)
  await put(pathname, body, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/gzip',
  })

  const existing: string[] = []
  let cursor: string | undefined
  do {
    const page = await list({ prefix: PREFIX, cursor })
    for (const blob of page.blobs) {
      if (dateOf(blob.pathname)) existing.push(blob.pathname)
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  const deleteDates = new Set(
    backupsToDelete(existing.flatMap((p) => dateOf(p) ?? [])),
  )
  const deleted = existing.filter((p) => deleteDates.has(dateOf(p) ?? ''))
  if (deleted.length > 0) await del(deleted)

  return {
    pathname,
    bytes: body.byteLength,
    rows: Object.fromEntries(
      Object.entries(backup.tables).map(([table, rows]) => [
        table,
        rows.length,
      ]),
    ),
    kept: existing.length - deleted.length,
    deleted: deleted.length,
  }
}
