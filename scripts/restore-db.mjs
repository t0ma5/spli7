// Load a backup (scripts/backup-db.mjs, scripts/download-backup.mjs or
// /api/cron/backup?download=1; .json or .json.gz) into an
// EMPTY database that already has the migrations applied. It refuses to run
// against a database that has groups, so it cannot clobber live data.
// Usage: TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… node scripts/restore-db.mjs <file>
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createClient } from '@libsql/client/http'

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

const [file] = process.argv.slice(2)
const url = process.env.TURSO_DATABASE_URL
if (!file || !url) {
  console.error('Usage: TURSO_DATABASE_URL=… node scripts/restore-db.mjs <file>')
  process.exit(1)
}
const raw = readFileSync(file)
// Daily backups from the Blob store are gzipped (.json.gz).
const backup = JSON.parse(
  (file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'),
)
if (backup.format !== 'spli7-backup-1') {
  console.error(`Unknown backup format: ${backup.format}`)
  process.exit(1)
}

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
const existing = await client.execute('SELECT COUNT(*) AS n FROM groups')
if (Number(existing.rows[0].n) > 0) {
  console.error('Target database already has groups. Restore into an empty one.')
  process.exit(1)
}

for (const table of TABLES) {
  const rows = backup.tables[table] ?? []
  for (let i = 0; i < rows.length; i += 100) {
    await client.batch(
      rows.slice(i, i + 100).map((row) => {
        const columns = Object.keys(row)
        return {
          sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          args: columns.map((column) => row[column]),
        }
      }),
      'write',
    )
  }
  console.log(`${table}: ${rows.length}`)
}
