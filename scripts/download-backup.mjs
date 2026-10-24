// List or download the daily backups that /api/cron/backup writes to the
// private Vercel Blob store.
// Usage:
//   node --env-file=.env.local scripts/download-backup.mjs          list
//   node --env-file=.env.local scripts/download-backup.mjs latest   download newest
//   node --env-file=.env.local scripts/download-backup.mjs 2026-10-24
// Files land in backups/ (gitignored). Restore with scripts/restore-db.mjs.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { get, list } from '@vercel/blob'

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Set BLOB_READ_WRITE_TOKEN (npx vercel env pull)')
  process.exit(1)
}

const blobs = []
let cursor
do {
  const page = await list({ prefix: 'backups/', cursor })
  blobs.push(...page.blobs)
  cursor = page.hasMore ? page.cursor : undefined
} while (cursor)
blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1))

const wanted = process.argv[2]
if (!wanted) {
  for (const blob of blobs) {
    console.log(`${blob.pathname}  ${(blob.size / 1024).toFixed(1)} kB`)
  }
  process.exit(0)
}

const blob =
  wanted === 'latest'
    ? blobs[0]
    : blobs.find((b) => b.pathname.includes(`spli7-backup-${wanted}`))
if (!blob) {
  console.error(`No backup for ${wanted}`)
  process.exit(1)
}
const result = await get(blob.pathname, { access: 'private' })
if (!result || result.statusCode !== 200) {
  console.error(`Could not read ${blob.pathname}`)
  process.exit(1)
}
const bytes = Buffer.from(await new Response(result.stream).arrayBuffer())
const dir = join(process.cwd(), 'backups')
mkdirSync(dir, { recursive: true })
const file = join(dir, blob.pathname.split('/').pop())
writeFileSync(file, bytes)
console.log(`wrote ${file}`)
