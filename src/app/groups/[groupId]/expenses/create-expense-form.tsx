'use client'
import { markSavedOffline } from '@/components/offline-sync'
import { useToast } from '@/components/ui/use-toast'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import {
  enqueueExpense,
  isNetworkError,
  isOfflineQueueSupported,
} from '@/lib/offline-queue'
import { randomId } from '@/lib/randomId'
import { trpc } from '@/trpc/client'
import { useTranslations } from 'next-intl'
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
  const { toast } = useToast()
  const t = useTranslations('ExpenseForm')

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
        // Offline: keep the expense in IndexedDB under this id; OfflineSync
        // sends it later, and a duplicate id there means it already landed.
        const queueOffline = async () => {
          try {
            await enqueueExpense({
              groupId,
              expenseId,
              expenseFormValues,
              participantId,
            })
          } catch {
            return false
          }
          // The client router waits for the network before navigating, so
          // this is a full load from the service worker's cache; the toast
          // is shown after it.
          markSavedOffline()
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- router.push stalls offline
          window.location.assign(`/groups/${groupId}/expenses`)
          return true
        }

        if (
          isOfflineQueueSupported() &&
          !navigator.onLine &&
          (await queueOffline())
        )
          return

        try {
          await createExpenseMutateAsync({
            groupId,
            expenseFormValues,
            participantId,
            expenseId,
          })
        } catch (error) {
          if (
            isOfflineQueueSupported() &&
            isNetworkError(error) &&
            (await queueOffline())
          )
            return
          // The server may have saved the expense and only the response was
          // lost. Reusing this id would upsert over that row.
          setExpenseId(randomId())
          // Not rethrown: the form stays as typed so the user can retry.
          toast({ title: t('saveFailed'), variant: 'destructive' })
          return
        }
        utils.groups.expenses.invalidate()
        utils.groups.stats.invalidate()
        utils.groups.balances.invalidate()
        utils.groups.activities.invalidate()
        router.push(`/groups/${group.id}`)
      }}
      runtimeFeatureFlags={runtimeFeatureFlags}
    />
  )
}
