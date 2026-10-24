import 'server-only'

import { copy, del, list } from '@vercel/blob'

/**
 * Receipt photos live in a private Vercel Blob store under
 * `receipts/{groupId}/{docId}`. Pages never see Blob URLs: an expense stores
 * the app route below, which checks group access (PIN) before streaming.
 */
const DOC_ID = /^[A-Za-z0-9_-]{21}$/
const GROUP_ID = /^[A-Za-z0-9_-]{1,64}$/
const DOCUMENT_URL =
  /^\/api\/groups\/([A-Za-z0-9_-]{1,64})\/documents\/([A-Za-z0-9_-]{21})$/

export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
export const DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export function documentsConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN)
}

export function documentPathname(groupId: string, docId: string): string {
  if (!GROUP_ID.test(groupId) || !DOC_ID.test(docId)) {
    throw new Error('Invalid document reference')
  }
  return `receipts/${groupId}/${docId}`
}

export function documentUrl(groupId: string, docId: string): string {
  return `/api/groups/${groupId}/documents/${docId}`
}

export function parseDocumentUrl(
  url: string,
): { groupId: string; docId: string } | null {
  const match = DOCUMENT_URL.exec(url)
  return match ? { groupId: match[1], docId: match[2] } : null
}

/** True when `url` is one of this group's own receipt routes. */
export function isGroupDocumentUrl(url: string, groupId: string): boolean {
  return parseDocumentUrl(url)?.groupId === groupId
}

/** Image type from the first bytes, so a renamed file cannot pass as a photo. */
export function sniffImageType(
  bytes: Uint8Array,
): (typeof DOCUMENT_TYPES)[number] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(from, to)))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** Best effort: a leftover blob costs storage, never correctness. */
export async function deleteDocumentBlobs(urls: string[]): Promise<void> {
  if (!documentsConfigured()) return
  const pathnames = urls.flatMap((url) => {
    const parsed = parseDocumentUrl(url)
    return parsed ? [documentPathname(parsed.groupId, parsed.docId)] : []
  })
  if (pathnames.length === 0) return
  try {
    await del(pathnames)
  } catch (error) {
    console.error('documents: delete failed', error)
  }
}

export async function deleteGroupDocuments(groupId: string): Promise<number> {
  if (!documentsConfigured() || !GROUP_ID.test(groupId)) return 0
  let removed = 0
  let cursor: string | undefined
  do {
    const page = await list({ prefix: `receipts/${groupId}/`, cursor })
    if (page.blobs.length > 0) {
      await del(page.blobs.map((blob) => blob.pathname))
      removed += page.blobs.length
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return removed
}

/**
 * Copy a receipt into another group (JSON import). Returns the new route URL,
 * or null when the source is not one of our receipts or cannot be read.
 */
export async function copyDocumentToGroup(
  url: string,
  toGroupId: string,
  newDocId: string,
): Promise<string | null> {
  const parsed = parseDocumentUrl(url)
  if (!parsed || !documentsConfigured()) return null
  try {
    await copy(
      documentPathname(parsed.groupId, parsed.docId),
      documentPathname(toGroupId, newDocId),
      { access: 'private', addRandomSuffix: false },
    )
    return documentUrl(toGroupId, newDocId)
  } catch {
    return null
  }
}
