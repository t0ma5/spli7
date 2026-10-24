// Dump every app table from Turso to backups/spli7-backup-<date>.json.
// Usage: TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… node scripts/backup-db.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@libsql/client/http'

// Same list and order as src/app/api/cron/backup/route.ts.
const TABLES = [
  'groups',
  'participants',
  'expenses',
  'expense_paid_by',
  'expense_paid_for',
  'expense_documents',
  'recurring_expense_links',
  'activities',
]

const url = process.env.TURSO_DATABASE_URL
if (!url) {
  console.error('Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for Turso Cloud)')
  process.exit(1)
}
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })

const tables = {}
for (const table of TABLES) {
  const result = await client.execute(`SELECT * FROM ${table}`)
  tables[table] = result.rows.map((row) =>
    Object.fromEntries(result.columns.map((column) => [column, row[column]])),
  )
}

const exportedAt = new Date().toISOString()
const dir = join(process.cwd(), 'backups')
mkdirSync(dir, { recursive: true })
const file = join(dir, `spli7-backup-${exportedAt.slice(0, 10)}.json`)
writeFileSync(
  file,
  JSON.stringify({ ok: true, format: 'spli7-backup-1', exportedAt, tables }),
)
const counts = TABLES.map((t) => `${t}=${tables[t].length}`).join(' ')
console.log(`wrote ${file}\n${counts}`)
