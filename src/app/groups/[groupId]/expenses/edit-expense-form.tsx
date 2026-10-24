'use client'
import { useToast } from '@/components/ui/use-toast'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { trpc } from '@/trpc/client'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { ExpenseForm } from './expense-form'

export function EditExpenseForm({
  groupId,
  expenseId,
  runtimeFeatureFlags,
}: {
  groupId: string
  expenseId: string
  runtimeFeatureFlags: RuntimeFeatureFlags
}) {
  const { data: groupData } = trpc.groups.get.useQuery({ groupId })
  const group = groupData?.group

  const { data: categoriesData } = trpc.categories.list.useQuery()
  const categories = categoriesData?.categories

  const { data: expenseData } = trpc.groups.expenses.get.useQuery({
    groupId,
    expenseId,
  })
  const expense = expenseData?.expense

  const { mutateAsync: updateExpenseMutateAsync } =
    trpc.groups.expenses.update.useMutation()
  const { mutateAsync: deleteExpenseMutateAsync } =
    trpc.groups.expenses.delete.useMutation()

  const utils = trpc.useUtils()
  const router = useRouter()
  const { toast } = useToast()
  const t = useTranslations('ExpenseForm')

  const invalidateAfterChange = () => {
    utils.groups.expenses.invalidate()
    utils.groups.stats.invalidate()
    utils.groups.balances.invalidate()
    utils.groups.activities.invalidate()
  }

  if (!group || !categories || !expense) return null

  return (
    <ExpenseForm
      group={group}
      expense={expense}
      categories={categories}
      onSubmit={async (expenseFormValues, participantId) => {
        try {
          await updateExpenseMutateAsync({
            expenseId,
            groupId,
            expenseFormValues,
            participantId,
          })
        } catch {
          toast({ title: t('saveFailed'), variant: 'destructive' })
          return
        }
        invalidateAfterChange()
        router.push(`/groups/${group.id}`)
      }}
      onDelete={async (participantId) => {
        try {
          await deleteExpenseMutateAsync({
            expenseId,
            groupId,
            participantId,
          })
        } catch {
          toast({ title: t('deleteFailed'), variant: 'destructive' })
          return
        }
        invalidateAfterChange()
        router.push(`/groups/${group.id}`)
      }}
      runtimeFeatureFlags={runtimeFeatureFlags}
    />
  )
}
