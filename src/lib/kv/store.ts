import 'server-only'

import { SEEDED_CATEGORIES } from '@/lib/kv/categories'
import { CATEGORIES_KEY, getKv, groupKey } from '@/lib/kv/client'
import type { Category, GroupDocument } from '@/lib/kv/types'

export async function getGroupDocument(
  groupId: string,
): Promise<GroupDocument | null> {
  const kv = await getKv()
  const value = await kv.get(groupKey(groupId), 'json')
  return (value as GroupDocument | null) ?? null
}

export async function putGroupDocument(group: GroupDocument): Promise<void> {
  const kv = await getKv()
  await kv.put(groupKey(group.id), JSON.stringify(group))
}

export async function deleteGroupDocument(groupId: string): Promise<void> {
  const kv = await getKv()
  await kv.delete(groupKey(groupId))
}

/** List all `group:*` keys (paginated). Listing is eventually consistent. */
export async function listGroupKeys(): Promise<string[]> {
  const kv = await getKv()
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await kv.list({ prefix: 'group:', cursor, limit: 1000 })
    for (const key of page.keys) {
      keys.push(key.name)
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return keys
}

export async function ensureCategories(): Promise<Category[]> {
  const kv = await getKv()
  const existing = await kv.get(CATEGORIES_KEY, 'json')
  if (existing) {
    return existing as Category[]
  }
  await kv.put(CATEGORIES_KEY, JSON.stringify(SEEDED_CATEGORIES))
  return SEEDED_CATEGORIES
}
