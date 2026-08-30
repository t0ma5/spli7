'use server'

import { getGroupExpenses } from '@/lib/api'
import { decodeExpenseCursor } from '@/lib/db/list-cursor'
import { assertGroupUnlocked } from '@/lib/group-access'

export async function getGroupExpensesAction(
  groupId: string,
  options?: { cursor?: string; length: number },
) {
  try {
    await assertGroupUnlocked(groupId)
    const after = options?.cursor
      ? decodeExpenseCursor(options.cursor)
      : undefined
    if (options?.cursor && !after) return null
    return getGroupExpenses(groupId, {
      after: after ?? undefined,
      length: Math.min(options?.length ?? 20, 100),
    })
  } catch {
    return null
  }
}
