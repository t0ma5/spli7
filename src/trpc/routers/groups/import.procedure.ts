import { createGroupFromImport, createGroupFromTricountCsv } from '@/lib/api'
import { groupImportSchema } from '@/lib/schemas'
import { looksLikeTricountCsv } from '@/lib/tricount-detect'
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

export const importTricountProcedure = baseProcedure
  .input(
    z.object({
      csvText: z.string().min(1).max(5_000_000),
      targetCurrencyCode: z.string().length(3).optional(),
    }),
  )
  .mutation(async ({ input: { csvText, targetCurrencyCode } }) => {
    try {
      if (!looksLikeTricountCsv(csvText)) {
        throw new Error('Invalid Tricount CSV format')
      }
      const group = await createGroupFromTricountCsv(csvText, targetCurrencyCode)
      return { groupId: group.id, groupName: group.name }
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to import Tricount group',
      })
    }
  })
