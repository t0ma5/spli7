'use client'

import { GroupDeletedScreen } from '@/app/groups/[groupId]/group-deleted-screen'
import { GroupPinGate } from '@/app/groups/[groupId]/group-pin-gate'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import { useTranslations } from 'next-intl'
import { PropsWithChildren, useEffect } from 'react'
import { CurrentGroupProvider } from './current-group-context'
import { GroupHeader } from './group-header'
import { SaveGroupLocally } from './save-recent-group'

export function GroupLayoutClient({
  groupId,
  children,
}: PropsWithChildren<{ groupId: string }>) {
  const { data, isLoading, isError } = trpc.groups.get.useQuery({ groupId })
  const t = useTranslations('Groups.NotFound')
  const tGroups = useTranslations('Groups')
  const { toast } = useToast()

  useEffect(() => {
    if (data && !data.group) {
      toast({
        description: t('text'),
        variant: 'destructive',
      })
    }
  }, [data])

  const props =
    isLoading || !data?.group
      ? { isLoading: true as const, groupId, group: undefined }
      : { isLoading: false as const, groupId, group: data.group }

  if (isLoading) {
    return (
      <CurrentGroupProvider {...props}>
        <GroupHeader />
      </CurrentGroupProvider>
    )
  }

  if (isError) {
    return (
      <CurrentGroupProvider {...props}>
        <p className="text-sm text-muted-foreground">{tGroups('loadError')}</p>
      </CurrentGroupProvider>
    )
  }

  if (data?.group?.deletedAt) {
    return (
      <CurrentGroupProvider {...props}>
        <GroupDeletedScreen groupId={groupId} groupName={data.group.name} />
      </CurrentGroupProvider>
    )
  }

  const hasPin = Boolean(data?.group?.hasPin)
  const locked = Boolean(data?.locked)

  return (
    <CurrentGroupProvider {...props}>
      <GroupPinGate groupId={groupId} hasPin={hasPin} locked={locked}>
        <GroupHeader />
        {children}
        <SaveGroupLocally />
      </GroupPinGate>
    </CurrentGroupProvider>
  )
}
