import { verifyGroupPin } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const verifyGroupPinProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      pin: z.string().min(4).max(8),
    }),
  )
  .mutation(async ({ input: { groupId, pin } }) => {
    const ok = await verifyGroupPin(groupId, pin)
    if (!ok) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Incorrect PIN' })
    }
    return { ok: true as const }
  })
