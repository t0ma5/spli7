import { updateGroup } from '@/lib/api'
import { getRepository } from '@/lib/db'
import {
  assertGroupUnlocked,
  beginPinAttempt,
  clearPinFailures,
  setUnlockCookie,
} from '@/lib/group-access'
import { pinMatchesHash } from '@/lib/group-pin'
import { groupFormSchema } from '@/lib/schemas'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const updateGroupProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1).max(64),
      groupFormValues: groupFormSchema,
      participantId: z.string().max(64).optional(),
    }),
  )
  .mutation(async ({ input: { groupId, groupFormValues, participantId } }) => {
    await assertGroupUnlocked(groupId)
    const changesPin = Boolean(
      groupFormValues.clearPin || groupFormValues.newPin,
    )
    if (changesPin) {
      const meta = await getRepository().getMeta(groupId)
      if (meta?.pinHash) {
        if (!groupFormValues.currentPin) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Current PIN required',
          })
        }
        await beginPinAttempt(groupId)
        const matches = await pinMatchesHash(
          groupFormValues.currentPin,
          groupId,
          meta.pinHash,
        )
        if (!matches) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Incorrect PIN',
          })
        }
      }
    }
    await updateGroup(groupId, groupFormValues, participantId)
    if (groupFormValues.newPin) {
      await clearPinFailures(groupId)
      await setUnlockCookie(groupId)
    } else if (groupFormValues.clearPin) {
      await clearPinFailures(groupId)
    }
  })
