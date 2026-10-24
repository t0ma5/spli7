import { createGroup } from '@/lib/api'
import { assertRateLimit } from '@/lib/group-access'
import { groupFormSchema } from '@/lib/schemas'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const createGroupProcedure = baseProcedure
  .input(
    z.object({
      groupFormValues: groupFormSchema,
    }),
  )
  .mutation(async ({ input: { groupFormValues } }) => {
    await assertRateLimit('create-group', {
      windowMs: 60 * 60 * 1000,
      maxRequests: 30,
    })
    const group = await createGroup(groupFormValues)
    return { groupId: group.id }
  })
