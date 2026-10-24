import { getRepository } from '@/lib/db'
import { documentPathname, documentsConfigured } from '@/lib/documents'
import { assertExportAccess } from '@/lib/group-access'
import { get } from '@vercel/blob'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/** Stream one receipt photo to someone who can open the group. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ groupId: string; docId: string }> },
) {
  const { groupId, docId } = await params
  if (!documentsConfigured()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!(await assertExportAccess(req, groupId))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const group = await getRepository().getMeta(groupId)
  if (!group || group.deletedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let pathname: string
  try {
    pathname = documentPathname(groupId, docId)
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const result = await get(pathname, { access: 'private' })
  if (!result || result.statusCode !== 200) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return new Response(result.stream, {
    headers: {
      'Content-Type': result.blob.contentType,
      'Content-Length': String(result.blob.size),
      // Private: the PIN cookie decides who may see it, so no shared caches.
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
