import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error:
        'Expense document uploads are not enabled on the Cloudflare KV deploy.',
    },
    { status: 501 },
  )
}
