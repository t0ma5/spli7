import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@libsql/client/http'

const url = process.env.TURSO_DATABASE_URL
if (!url) {
  console.error('Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for Turso Cloud)')
  process.exit(1)
}

const client = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

await client.execute(
  `CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
  )`,
)

const applied = new Set(
  (await client.execute('SELECT name FROM _migrations')).rows.map((row) =>
    String(row.name),
  ),
)

const dir = join(process.cwd(), 'migrations')
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.sql'))
  .sort()

for (const name of files) {
  if (applied.has(name)) {
    console.log(`skip ${name}`)
    continue
  }
  const sql = readFileSync(join(dir, name), 'utf8')
  await client.executeMultiple(sql)
  await client.execute({
    sql: 'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
    args: [name, new Date().toISOString()],
  })
  console.log(`applied ${name}`)
}

console.log('ok turso')
