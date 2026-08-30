import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'

export async function getD1(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true })
  if (!env.DATABASE) {
    throw new Error('D1 binding DATABASE is not configured')
  }
  return env.DATABASE
}

/** Legacy KV namespace used only for one-shot migration. */
export async function getLegacyKv(): Promise<KVNamespace | null> {
  const { env } = await getCloudflareContext({ async: true })
  return env.DB ?? null
}
