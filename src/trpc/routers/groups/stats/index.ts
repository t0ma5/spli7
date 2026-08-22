import { createTRPCRouter } from '@/trpc/init'
import { getStatsCategoryExpensesProcedure } from '@/trpc/routers/groups/stats/category-expenses.procedure'
import { getGroupStatsProcedure } from '@/trpc/routers/groups/stats/get.procedure'
import { getStatsMonthExpensesProcedure } from '@/trpc/routers/groups/stats/month-expenses.procedure'
import { getStatsOverviewProcedure } from '@/trpc/routers/groups/stats/overview.procedure'

export const groupStatsRouter = createTRPCRouter({
  get: getGroupStatsProcedure,
  overview: getStatsOverviewProcedure,
  categoryExpenses: getStatsCategoryExpensesProcedure,
  monthExpenses: getStatsMonthExpensesProcedure,
})
