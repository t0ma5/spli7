import { isCronAuthorized, unauthorized } from '@/lib/cron-auth'
import { getD1 } from '@/lib/db/client'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return unauthorized()
  const db = await getD1()
  const { results } = await db
    .prepare(
      'SELECT id, name, created_at, last_activity_at, last_seen_at, deleted_at FROM groups',
    )
    .all<{
      id: string
      name: string
      created_at: string
      last_activity_at: string | null
      last_seen_at: string | null
      deleted_at: string | null
    }>()
  return NextResponse.json({
    ok: true,
    exportedAt: new Date().toISOString(),
    groupCount: results.length,
    groups: results,
  })
}

export async function POST(req: Request) {
  return GET(req)
}
