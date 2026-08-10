import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'

export async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true })
  if (!env.DB) {
    throw new Error('KV binding DB is not configured')
  }
  return env.DB
}

export function groupKey(groupId: string) {
  return `group:${groupId}`
}

export const CATEGORIES_KEY = 'categories'
export const HEALTH_KEY = '__health__'
