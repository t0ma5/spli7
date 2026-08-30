import { getActivities } from '@/lib/api'
import { decodeActivityCursor } from '@/lib/db/list-cursor'
import { assertGroupUnlocked } from '@/lib/group-access'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const listGroupActivitiesProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1).max(64),
      cursor: z.string().min(1).max(256).optional(),
      limit: z.number().int().min(1).max(100).optional().default(5),
    }),
  )
  .query(async ({ input: { groupId, cursor, limit } }) => {
    await assertGroupUnlocked(groupId)
    const after = cursor ? decodeActivityCursor(cursor) : undefined
    if (cursor && !after) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid cursor.' })
    }
    const activities = await getActivities(groupId, {
      after: after ?? undefined,
      length: limit + 1,
    })
    const page = activities.slice(0, limit)
    const last = page.at(-1)
    const hasMore = !!activities[limit]
    return {
      activities: page.map(
        ({ listCursor: _listCursor, ...activity }) => activity,
      ),
      hasMore,
      nextCursor: hasMore ? last?.listCursor : undefined,
    }
  })
