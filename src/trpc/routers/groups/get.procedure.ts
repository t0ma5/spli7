import { getGroupIncludingDeleted } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const getGroupProcedure = baseProcedure
  .input(z.object({ groupId: z.string().min(1).max(30) }))
  .query(async ({ input: { groupId } }) => {
    const group = await getGroupIncludingDeleted(groupId)
    return { group }
  })
