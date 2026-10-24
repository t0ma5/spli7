// In-memory stand-in for @vercel/blob in Jest (the real package ships ESM
// that Jest does not transform). Jest uses it automatically for every test.
type Stored = { body: Uint8Array; contentType: string; uploadedAt: Date }

export const __store = new Map<string, Stored>()

function toBytes(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) return body
  if (typeof body === 'string') return new TextEncoder().encode(body)
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  throw new Error('mock @vercel/blob: unsupported body')
}

export async function put(
  pathname: string,
  body: unknown,
  options: { contentType?: string } = {},
) {
  __store.set(pathname, {
    body: toBytes(body),
    contentType: options.contentType ?? 'application/octet-stream',
    uploadedAt: new Date(),
  })
  return { pathname, url: `https://blob.test/${pathname}` }
}

export async function get(pathname: string) {
  const stored = __store.get(pathname)
  if (!stored) return null
  return {
    statusCode: 200 as const,
    stream: new Blob([stored.body as Uint8Array<ArrayBuffer>]).stream(),
    headers: new Headers(),
    blob: {
      pathname,
      contentType: stored.contentType,
      size: stored.body.byteLength,
    },
  }
}

export async function del(pathnames: string | string[]) {
  for (const pathname of Array.isArray(pathnames) ? pathnames : [pathnames]) {
    __store.delete(pathname)
  }
}

export async function list(options: { prefix?: string; cursor?: string } = {}) {
  const blobs = Array.from(__store.entries())
    .filter(([pathname]) => pathname.startsWith(options.prefix ?? ''))
    .map(([pathname, stored]) => ({
      pathname,
      url: `https://blob.test/${pathname}`,
      size: stored.body.byteLength,
      uploadedAt: stored.uploadedAt,
    }))
  return { blobs, hasMore: false, cursor: undefined }
}

export async function copy(from: string, to: string) {
  const stored = __store.get(from)
  if (!stored) throw new Error('BlobNotFoundError')
  __store.set(to, { ...stored, uploadedAt: new Date() })
  return { pathname: to, url: `https://blob.test/${to}` }
}
