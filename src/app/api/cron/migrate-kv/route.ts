import { isCronAuthorized, unauthorized } from '@/lib/cron-auth'
import { getRepository } from '@/lib/db'
import { getLegacyKv } from '@/lib/db/client'
import type { GroupDocument } from '@/lib/kv/types'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return unauthorized()
  const kv = await getLegacyKv()
  if (!kv) {
    return NextResponse.json(
      { error: 'Legacy KV binding DB is not configured' },
      { status: 400 },
    )
  }

  const repo = getRepository()
  const imported: string[] = []
  const skipped: string[] = []
  const failed: { id: string; error: string }[] = []

  let cursor: string | undefined
  do {
    const page = await kv.list({ prefix: 'group:', cursor, limit: 1000 })
    for (const key of page.keys) {
      const groupId = key.name.slice('group:'.length)
      try {
        const existing = await repo.get(groupId)
        if (existing) {
          skipped.push(groupId)
          continue
        }
        const doc = await kv.get<GroupDocument>(key.name, 'json')
        if (!doc || !doc.id) continue
        doc.version = doc.version ?? 0
        await repo.create(doc)
        imported.push(groupId)
      } catch (error) {
        failed.push({
          id: groupId,
          error: error instanceof Error ? error.message : 'import failed',
        })
      }
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  return NextResponse.json({
    ok: true,
    imported: imported.length,
    skipped: skipped.length,
    failed,
  })
}
