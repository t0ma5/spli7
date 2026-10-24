import { buildBackup, storeBackup } from '@/lib/backups'
import { isCronAuthorized, unauthorized } from '@/lib/cron-auth'
import { documentsConfigured } from '@/lib/documents'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Daily (vercel.json): gzip every table into the private Blob store as
 * backups/spli7-backup-<date>.json.gz, keeping 30 days plus 12 monthly copies.
 * `?download=1` returns the dump instead, for a manual pull:
 * `curl -H "Authorization: Bearer $CRON_SECRET" "…/api/cron/backup?download=1"`.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return unauthorized()

  if (new URL(req.url).searchParams.get('download') === '1') {
    const backup = await buildBackup()
    return NextResponse.json(backup, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="spli7-backup-${backup.exportedAt.slice(0, 10)}.json"`,
      },
    })
  }

  // The Blob token doubles as the "backups are configured" switch.
  if (!documentsConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'BLOB_READ_WRITE_TOKEN is not set' },
      { status: 503 },
    )
  }
  const result = await storeBackup()
  return NextResponse.json({ ok: true, ...result })
}

export async function POST(req: Request) {
  return GET(req)
}
