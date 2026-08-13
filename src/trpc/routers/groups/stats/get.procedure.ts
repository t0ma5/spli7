import { getGroupExpenses } from '@/lib/api'
import { getBalanceTimeline } from '@/lib/balance-timeline'
import {
  getMonthlyCategorySpending,
  monthlySpendingGroupingOptions,
  monthlySpendingRangeOptions,
} from '@/lib/monthly-spending'
import {
  getTotalActiveUserPaidFor,
  getTotalActiveUserShare,
  getTotalGroupSpending,
} from '@/lib/totals'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const getGroupStatsProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      participantId: z.string().optional(),
      // Optional on purpose: Totals does not pass these, so we skip monthly /
      // timeline aggregation and avoid a second heavy payload on stats load.
      monthlySpendingGrouping: z
        .enum(monthlySpendingGroupingOptions)
        .optional(),
      monthlySpendingRange: z.enum(monthlySpendingRangeOptions).optional(),
    }),
  )
  .query(
    async ({
      input: {
        groupId,
        participantId,
        monthlySpendingGrouping,
        monthlySpendingRange,
      },
    }) => {
      const expenses = await getGroupExpenses(groupId)
      const totalGroupSpendings = getTotalGroupSpending(expenses)

      const includeCharts =
        monthlySpendingGrouping !== undefined &&
        monthlySpendingRange !== undefined

      const monthlyCategorySpending = includeCharts
        ? getMonthlyCategorySpending(expenses, {
            grouping: monthlySpendingGrouping,
            range: monthlySpendingRange,
          })
        : undefined
      const balanceTimeline = includeCharts
        ? getBalanceTimeline(expenses, {
            range: monthlySpendingRange,
          })
        : undefined

      const totalParticipantSpendings =
        participantId !== undefined
          ? getTotalActiveUserPaidFor(participantId, expenses)
          : undefined
      const totalParticipantShare =
        participantId !== undefined
          ? getTotalActiveUserShare(participantId, expenses)
          : undefined

      return {
        totalGroupSpendings,
        totalParticipantSpendings,
        totalParticipantShare,
        monthlyCategorySpending,
        balanceTimeline,
      }
    },
  )
