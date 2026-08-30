import { restoreGroup, softDeleteGroup } from '@/lib/api'
import { assertGroupUnlocked } from '@/lib/group-access'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const softDeleteGroupProcedure = baseProcedure
  .input(z.object({ groupId: z.string().min(1).max(64) }))
  .mutation(async ({ input: { groupId } }) => {
    await assertGroupUnlocked(groupId)
    return softDeleteGroup(groupId)
  })

export const restoreGroupProcedure = baseProcedure
  .input(z.object({ groupId: z.string().min(1).max(64) }))
  .mutation(async ({ input: { groupId } }) => {
    await assertGroupUnlocked(groupId)
    return restoreGroup(groupId)
  })
