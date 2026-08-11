import { createTRPCRouter } from '@/trpc/init'
import { activitiesRouter } from '@/trpc/routers/groups/activities'
import { groupBalancesRouter } from '@/trpc/routers/groups/balances'
import { createGroupProcedure } from '@/trpc/routers/groups/create.procedure'
import {
  restoreGroupProcedure,
  softDeleteGroupProcedure,
} from '@/trpc/routers/groups/delete.procedure'
import { groupExpensesRouter } from '@/trpc/routers/groups/expenses'
import { getGroupProcedure } from '@/trpc/routers/groups/get.procedure'
import { importGroupProcedure, importTricountProcedure } from '@/trpc/routers/groups/import.procedure'
import { groupStatsRouter } from '@/trpc/routers/groups/stats'
import { updateGroupProcedure } from '@/trpc/routers/groups/update.procedure'
import { verifyGroupPinProcedure } from '@/trpc/routers/groups/verifyPin.procedure'
import { getGroupDetailsProcedure } from './getDetails.procedure'
import { listGroupsProcedure } from './list.procedure'

export const groupsRouter = createTRPCRouter({
  expenses: groupExpensesRouter,
  balances: groupBalancesRouter,
  stats: groupStatsRouter,
  activities: activitiesRouter,

  get: getGroupProcedure,
  getDetails: getGroupDetailsProcedure,
  list: listGroupsProcedure,
  create: createGroupProcedure,
  import: importGroupProcedure,
  importTricount: importTricountProcedure,
  update: updateGroupProcedure,
  softDelete: softDeleteGroupProcedure,
  restore: restoreGroupProcedure,
  verifyPin: verifyGroupPinProcedure,
})
