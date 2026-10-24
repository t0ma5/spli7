import { getGroupBalances } from '@/lib/api'
import { getPublicBalances, getSuggestedReimbursements } from '@/lib/balances'
import { assertGroupUnlocked } from '@/lib/group-access'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const listGroupBalancesProcedure = baseProcedure
  .input(z.object({ groupId: z.string().min(1).max(64) }))
  .query(async ({ input: { groupId } }) => {
    await assertGroupUnlocked(groupId)
    const balances = await getGroupBalances(groupId)
    const reimbursements = getSuggestedReimbursements(balances)
    const publicBalances = getPublicBalances(reimbursements)

    return { balances: publicBalances, reimbursements }
  })
