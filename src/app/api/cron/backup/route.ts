import { isCronAuthorized, unauthorized } from '@/lib/cron-auth'
import { getD1 } from '@/lib/db/client'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Every table the app writes, in an order that restores without breaking
// foreign keys. Restore with scripts/restore-db.mjs.
const BACKUP_TABLES = [
  'groups',
  'participants',
  'expenses',
  'expense_paid_by',
  'expense_paid_for',
  'expense_documents',
  'recurring_expense_links',
  'activities',
] as const

/**
 * Full dump of the database as JSON. Pull it with
 * `curl -H "Authorization: Bearer $CRON_SECRET" …/api/cron/backup > backup.json`
 * or run scripts/backup-db.mjs, which reads Turso directly.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return unauthorized()
  const db = await getD1()
  const tables: Record<string, unknown[]> = {}
  for (const table of BACKUP_TABLES) {
    const { results } = await db.prepare(`SELECT * FROM ${table}`).all()
    tables[table] = results
  }
  const exportedAt = new Date().toISOString()
  return NextResponse.json(
    { ok: true, format: 'spli7-backup-1', exportedAt, tables },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="spli7-backup-${exportedAt.slice(0, 10)}.json"`,
      },
    },
  )
}

export async function POST(req: Request) {
  return GET(req)
}
