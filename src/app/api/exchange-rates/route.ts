import { NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'

// Proxy to the Frankfurter v2 API so that browsers never contact a third party
// (the CSP only allows connect-src 'self').
const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  base: z.string().regex(/^[A-Z]{3}$/),
  quote: z.string().regex(/^[A-Z]{3}$/),
})

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const query = querySchema.safeParse({
    date: searchParams.get('date'),
    base: searchParams.get('base'),
    quote: searchParams.get('quote'),
  })
  if (!query.success) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }

  const { date, base, quote } = query.data
  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v2/rates?${new URLSearchParams({
        date,
        base,
        quotes: quote,
      })}`,
      { next: { revalidate: 3600 } },
    )
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Unsuccessful response from API' },
        { status: 502 },
      )
    }
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json(
      { error: 'Exchange rate API unreachable' },
      { status: 502 },
    )
  }
}
