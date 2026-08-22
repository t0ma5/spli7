import { getGroupExpenses } from '@/lib/api'
import { filterExpensesByDateRange, getExpensesByMonth } from '@/lib/totals'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const getStatsMonthExpensesProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1).max(64),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      from: z.string().max(10).optional(),
      to: z.string().max(10).optional(),
    }),
  )
  .query(async ({ input: { groupId, month, from, to } }) => {
    const allExpenses = await getGroupExpenses(groupId)
    const expenses = filterExpensesByDateRange(allExpenses, from, to)

    return {
      expenses: getExpensesByMonth(expenses, month).map((expense) => ({
        id: expense.id,
        title: expense.title,
        amount: expense.amount,
        expenseDate: expense.expenseDate,
      })),
    }
  })
