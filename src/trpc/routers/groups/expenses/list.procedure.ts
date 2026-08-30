import { getGroupExpenses } from '@/lib/api'
import { decodeExpenseCursor } from '@/lib/db/list-cursor'
import { assertGroupUnlocked } from '@/lib/group-access'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const listGroupExpensesProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1).max(64),
      cursor: z.string().min(1).max(256).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      filter: z.string().max(200).optional(),
    }),
  )
  .query(async ({ input: { groupId, cursor, limit = 10, filter } }) => {
    await assertGroupUnlocked(groupId)
    const after = cursor ? decodeExpenseCursor(cursor) : undefined
    if (cursor && !after) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid cursor.' })
    }
    const expenses = await getGroupExpenses(groupId, {
      after: after ?? undefined,
      length: limit + 1,
      filter,
    })
    const page = expenses.slice(0, limit)
    const last = page.at(-1)
    const hasMore = !!expenses[limit]
    return {
      expenses: page.map(({ listCursor: _listCursor, ...expense }) => ({
        ...expense,
        createdAt: new Date(expense.createdAt),
        expenseDate: new Date(expense.expenseDate),
      })),
      hasMore,
      nextCursor: hasMore ? last?.listCursor : undefined,
    }
  })
