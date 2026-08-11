'use client'

import { GroupForm } from '@/components/group-form'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useCurrentGroup } from '../current-group-context'

export const EditGroup = () => {
  const { groupId } = useCurrentGroup()
  const { data, isLoading } = trpc.groups.getDetails.useQuery({ groupId })
  const { mutateAsync } = trpc.groups.update.useMutation()
  const softDelete = trpc.groups.softDelete.useMutation()
  const utils = trpc.useUtils()
  const router = useRouter()
  const { toast } = useToast()
  const t = useTranslations('GroupForm.Settings')

  if (isLoading) return <></>

  return (
    <GroupForm
      group={data?.group}
      onSubmit={async (groupFormValues, participantId) => {
        await mutateAsync({ groupId, participantId, groupFormValues })
        await utils.groups.invalidate()
      }}
      onDelete={async () => {
        if (!confirm(t('deleteConfirm'))) return
        await softDelete.mutateAsync({ groupId })
        toast({ title: t('deleted') })
        await utils.groups.invalidate()
        router.push('/groups')
      }}
      protectedParticipantIds={data?.participantsWithExpenses}
    />
  )
}
