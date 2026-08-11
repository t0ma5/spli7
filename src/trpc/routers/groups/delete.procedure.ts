import { restoreGroup, softDeleteGroup } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const softDeleteGroupProcedure = baseProcedure
  .input(z.object({ groupId: z.string().min(1).max(30) }))
  .mutation(async ({ input: { groupId } }) => {
    return softDeleteGroup(groupId)
  })

export const restoreGroupProcedure = baseProcedure
  .input(z.object({ groupId: z.string().min(1).max(30) }))
  .mutation(async ({ input: { groupId } }) => {
    return restoreGroup(groupId)
  })
