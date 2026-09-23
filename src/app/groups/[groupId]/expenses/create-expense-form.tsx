'use client'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { randomId } from '@/lib/randomId'
import { trpc } from '@/trpc/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { ExpenseForm } from './expense-form'

export function CreateExpenseForm({
  groupId,
  runtimeFeatureFlags,
}: {
  groupId: string
  runtimeFeatureFlags: RuntimeFeatureFlags
}) {
  const searchParams = useSearchParams()
  const fromExpenseId = searchParams.get('fromExpense')

  const { data: groupData } = trpc.groups.get.useQuery({ groupId })
  const group = groupData?.group

  const { data: categoriesData } = trpc.categories.list.useQuery()
  const categories = categoriesData?.categories

  const { data: fromExpenseData, isLoading: fromExpenseLoading } =
    trpc.groups.expenses.get.useQuery(
      { groupId, expenseId: fromExpenseId ?? '' },
      { enabled: Boolean(fromExpenseId) },
    )

  const { mutateAsync: createExpenseMutateAsync } =
    trpc.groups.expenses.create.useMutation()

  // Minted here rather than on save: the id seeds which participant takes the
  // leftover minor unit, so the preview matches the saved split. Per mount, so
  // a fresh visit gets a fresh id.
  const [expenseId, setExpenseId] = useState(() => randomId())

  const utils = trpc.useUtils()
  const router = useRouter()

  if (!group || !categories) return null
  if (fromExpenseId && fromExpenseLoading) return null

  return (
    <ExpenseForm
      key={fromExpenseId ?? 'new'}
      group={group}
      categories={categories}
      duplicateFrom={fromExpenseData?.expense ?? undefined}
      expenseId={expenseId}
      onSubmit={async (expenseFormValues, participantId) => {
        try {
          await createExpenseMutateAsync({
            groupId,
            expenseFormValues,
            participantId,
            expenseId,
          })
        } catch (error) {
          // The server may have saved the expense and only the response was
          // lost. Reusing this id would upsert over that row.
          setExpenseId(randomId())
          throw error
        }
        utils.groups.expenses.invalidate()
        utils.groups.stats.invalidate()
        router.push(`/groups/${group.id}`)
      }}
      runtimeFeatureFlags={runtimeFeatureFlags}
    />
  )
}
