import { getActiveRecurringExpenses, getGroup, getGroupExpenses } from '@/lib/api'
import {
  filterExpensesByDateRange,
  getRecurringSpending,
  getSpendingByCategory,
  getSpendingByParticipant,
  getSpendingOverTime,
  getSpendingSummary,
  getTotalActiveUserPaidFor,
  getTotalActiveUserShare,
  getTotalGroupSpending,
} from '@/lib/totals'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

/**
 * Single data-loader for the stats page cards (summary, over time, by
 * participant, by category, recurring). Fetches the group's expenses once and
 * derives every section from them. Recurring stats are range-independent.
 */
export const getStatsOverviewProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1).max(64),
      participantId: z.string().max(64).optional(),
      from: z.string().max(10).optional(),
      to: z.string().max(10).optional(),
    }),
  )
  .query(async ({ input: { groupId, participantId, from, to } }) => {
    const [group, allExpenses] = await Promise.all([
      getGroup(groupId),
      getGroupExpenses(groupId),
    ])
    const recurringExpenses = await getActiveRecurringExpenses(groupId)

    const expenses = filterExpensesByDateRange(allExpenses, from, to)
    const participants = group?.participants ?? []

    return {
      totalGroupSpendings: getTotalGroupSpending(expenses),
      totalParticipantSpendings:
        participantId !== undefined
          ? getTotalActiveUserPaidFor(participantId, expenses)
          : undefined,
      totalParticipantShare:
        participantId !== undefined
          ? getTotalActiveUserShare(participantId, expenses)
          : undefined,
      summary: getSpendingSummary(expenses),
      months: getSpendingOverTime(expenses),
      participants: getSpendingByParticipant(participants, expenses),
      categories: getSpendingByCategory(expenses),
      recurring: getRecurringSpending(recurringExpenses),
    }
  })
