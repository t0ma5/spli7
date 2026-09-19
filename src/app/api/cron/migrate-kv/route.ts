import { isCronAuthorized, unauthorized } from '@/lib/cron-auth'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return unauthorized()
  return NextResponse.json(
    { error: 'Legacy KV import is retired. Data lives in Turso.' },
    { status: 410 },
  )
}
