import { materializeAllDueRecurringExpenses } from '@/lib/api'
import { isCronAuthorized, unauthorized } from '@/lib/cron-auth'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return unauthorized()
  const result = await materializeAllDueRecurringExpenses()
  return NextResponse.json({ ok: true, ...result })
}

export async function POST(req: Request) {
  return GET(req)
}
