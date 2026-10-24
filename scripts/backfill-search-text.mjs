// One-off: recompute expenses.search_text with JavaScript lowercasing, which
// folds non-ASCII letters (Ä, Ö, Ç…) that SQLite LOWER() leaves alone.
// Usage: TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… node scripts/backfill-search-text.mjs
import { createClient } from '@libsql/client/http'

const url = process.env.TURSO_DATABASE_URL
if (!url) {
  console.error('Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for Turso Cloud)')
  process.exit(1)
}

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
const { rows } = await client.execute(
  'SELECT id, title, notes, search_text FROM expenses',
)

const updates = []
for (const row of rows) {
  const next = `${row.title}\n${row.notes ?? ''}`.toLowerCase()
  if (next !== row.search_text) {
    updates.push({
      sql: 'UPDATE expenses SET search_text = ? WHERE id = ?',
      args: [next, row.id],
    })
  }
}

for (let i = 0; i < updates.length; i += 100) {
  await client.batch(updates.slice(i, i + 100), 'write')
}
console.log(`updated ${updates.length} of ${rows.length} expenses`)
