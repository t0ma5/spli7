import { NextResponse } from 'next/server'

/** Expense uploads are not supported on this D1 deploy. */
export async function POST() {
  return NextResponse.json(
    { error: 'Expense document uploads are not available on this deployment.' },
    { status: 501 },
  )
}
