import 'server-only'

import { CATEGORIES_KEY, getKv, groupKey } from '@/lib/kv/client'
import { SEEDED_CATEGORIES } from '@/lib/kv/categories'
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

export async function ensureCategories(): Promise<Category[]> {
  const kv = await getKv()
  const existing = await kv.get(CATEGORIES_KEY, 'json')
  if (existing) {
    return existing as Category[]
  }
  await kv.put(CATEGORIES_KEY, JSON.stringify(SEEDED_CATEGORIES))
  return SEEDED_CATEGORIES
}
