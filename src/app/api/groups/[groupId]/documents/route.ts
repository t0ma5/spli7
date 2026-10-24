import { getRepository } from '@/lib/db'
import {
  documentPathname,
  documentsConfigured,
  documentUrl,
  MAX_DOCUMENT_BYTES,
  sniffImageType,
} from '@/lib/documents'
import { env } from '@/lib/env'
import { assertExportAccess, assertRateLimit } from '@/lib/group-access'
import { randomId } from '@/lib/randomId'
import { TRPCError } from '@trpc/server'
import { put } from '@vercel/blob'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

function error(status: number, message: string) {
  return NextResponse.json({ error: message }, { status })
}

function dimension(value: FormDataEntryValue | null): number | null {
  const number = Number(value)
  return Number.isInteger(number) && number >= 1 && number <= 20_000
    ? number
    : null
}

/**
 * Upload one receipt photo for a group. The client resizes it first, so it
 * fits Vercel's 4.5 MB request limit. Returns the document to attach to the
 * expense; nothing references the blob until the expense is saved.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params
  if (!env.NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS || !documentsConfigured()) {
    return error(404, 'Receipt uploads are not enabled')
  }
  if (!(await assertExportAccess(req, groupId))) {
    return error(401, 'Unauthorized')
  }
  const group = await getRepository().getMeta(groupId)
  if (!group || group.deletedAt) return error(404, 'Invalid group ID')

  try {
    await assertRateLimit('upload-document', {
      windowMs: 60 * 60 * 1000,
      maxRequests: 60,
    })
  } catch (caught) {
    if (caught instanceof TRPCError && caught.code === 'TOO_MANY_REQUESTS') {
      return error(429, caught.message)
    }
    throw caught
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const width = dimension(form?.get('width') ?? null)
  const height = dimension(form?.get('height') ?? null)
  if (!(file instanceof File) || !width || !height) {
    return error(400, 'Expected a file with width and height')
  }
  if (file.size === 0 || file.size > MAX_DOCUMENT_BYTES) {
    return error(413, 'File too large')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const contentType = sniffImageType(bytes)
  if (!contentType) return error(415, 'Only JPEG, PNG or WebP images')

  const id = randomId()
  await put(documentPathname(groupId, id), Buffer.from(bytes), {
    access: 'private',
    addRandomSuffix: false,
    contentType,
  })
  return NextResponse.json({
    id,
    url: documentUrl(groupId, id),
    width,
    height,
  })
}
