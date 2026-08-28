'use client'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { trpc } from '@/trpc/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { ExpenseForm } from './expense-form'

export function CreateExpenseForm({
  groupId,
  runtimeFeatureFlags,
}: {
  groupId: string
  expenseId?: string
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
      onSubmit={async (expenseFormValues, participantId) => {
        await createExpenseMutateAsync({
          groupId,
          expenseFormValues,
          participantId,
        })
        utils.groups.expenses.invalidate()
        utils.groups.stats.invalidate()
        router.push(`/groups/${group.id}`)
      }}
      runtimeFeatureFlags={runtimeFeatureFlags}
    />
  )
}
