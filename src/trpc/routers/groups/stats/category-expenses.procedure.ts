import { getGroupExpenses } from '@/lib/api'
import { filterExpensesByDateRange, getExpensesByCategory } from '@/lib/totals'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const getStatsCategoryExpensesProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1).max(64),
      categoryId: z.number().int(),
      from: z.string().max(10).optional(),
      to: z.string().max(10).optional(),
    }),
  )
  .query(async ({ input: { groupId, categoryId, from, to } }) => {
    const allExpenses = await getGroupExpenses(groupId)
    const expenses = filterExpensesByDateRange(allExpenses, from, to)

    return {
      expenses: getExpensesByCategory(expenses, categoryId).map((expense) => ({
        id: expense.id,
        title: expense.title,
        amount: expense.amount,
        expenseDate: expense.expenseDate,
      })),
    }
  })
