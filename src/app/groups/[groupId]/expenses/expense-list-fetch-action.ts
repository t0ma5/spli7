'use server'

import { getGroupExpenses } from '@/lib/api'
import { assertGroupUnlocked } from '@/lib/group-access'

export async function getGroupExpensesAction(
  groupId: string,
  options?: { offset: number; length: number },
) {
  try {
    await assertGroupUnlocked(groupId)
    return getGroupExpenses(groupId, {
      offset: options?.offset,
      length: Math.min(options?.length ?? 20, 100),
    })
  } catch {
    return null
  }
}
