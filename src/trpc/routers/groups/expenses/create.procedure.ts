import { createExpense } from '@/lib/api'
import { assertGroupUnlocked } from '@/lib/group-access'
import { expenseFormSchema } from '@/lib/schemas'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const createGroupExpenseProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1).max(64),
      expenseFormValues: expenseFormSchema,
      participantId: z.string().optional(),
      // Minted by the form with randomId() (21-char nanoid) so the split
      // preview matches the saved expense. Optional: other callers stay
      // server-minted.
      expenseId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{21}$/)
        .optional(),
    }),
  )
  .mutation(
    async ({
      input: { groupId, expenseFormValues, participantId, expenseId },
    }) => {
      await assertGroupUnlocked(groupId)
      const expense = await createExpense(
        expenseFormValues,
        groupId,
        participantId,
        expenseId,
      )
      return { expenseId: expense.id }
    },
  )
