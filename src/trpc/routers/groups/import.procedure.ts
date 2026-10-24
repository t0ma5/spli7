import {
  createGroupFromImport,
  createGroupFromSplitwiseCsv,
  createGroupFromTricountCsv,
} from '@/lib/api'
import { assertRateLimit } from '@/lib/group-access'
import { groupImportSchema } from '@/lib/schemas'
import { looksLikeSplitwiseCsv } from '@/lib/splitwise-import'
import { looksLikeTricountCsv } from '@/lib/tricount-detect'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

// Imports write up to thousands of rows each.
const IMPORT_LIMIT = { windowMs: 60 * 60 * 1000, maxRequests: 10 }

export const importGroupProcedure = baseProcedure
  .input(
    z.object({
      groupImportValues: groupImportSchema,
    }),
  )
  .mutation(async ({ input: { groupImportValues } }) => {
    await assertRateLimit('import-group', IMPORT_LIMIT)
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
      csvText: z.string().min(1).max(1_000_000),
      targetCurrencyCode: z.string().length(3).optional(),
    }),
  )
  .mutation(async ({ input: { csvText, targetCurrencyCode } }) => {
    await assertRateLimit('import-group', IMPORT_LIMIT)
    try {
      if (!looksLikeTricountCsv(csvText)) {
        throw new Error('Invalid Tricount CSV format')
      }
      const group = await createGroupFromTricountCsv(
        csvText,
        targetCurrencyCode,
      )
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

export const importSplitwiseProcedure = baseProcedure
  .input(
    z.object({
      csvText: z.string().min(1).max(1_000_000),
    }),
  )
  .mutation(async ({ input: { csvText } }) => {
    await assertRateLimit('import-group', IMPORT_LIMIT)
    try {
      if (!looksLikeSplitwiseCsv(csvText)) {
        throw new Error('Invalid Splitwise CSV format')
      }
      const group = await createGroupFromSplitwiseCsv(csvText)
      return { groupId: group.id, groupName: group.name }
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to import Splitwise group',
      })
    }
  })
