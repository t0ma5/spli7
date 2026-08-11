import { createGroupFromImport } from '@/lib/api'
import { groupImportSchema } from '@/lib/schemas'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const importGroupProcedure = baseProcedure
  .input(
    z.object({
      groupImportValues: groupImportSchema,
    }),
  )
  .mutation(async ({ input: { groupImportValues } }) => {
    try {
      const group = await createGroupFromImport(groupImportValues)
      return { groupId: group.id, groupName: group.name }
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          error instanceof Error ? error.message : 'Failed to import group',
      })
    }
  })
