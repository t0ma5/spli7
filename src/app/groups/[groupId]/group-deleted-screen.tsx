'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

export function GroupDeletedScreen({
  groupId,
  groupName,
}: {
  groupId: string
  groupName: string
}) {
  const t = useTranslations('Groups.Deleted')
  const router = useRouter()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const restore = trpc.groups.restore.useMutation({
    onSuccess: async () => {
      toast({ title: t('restored') })
      await utils.groups.invalidate()
      router.refresh()
    },
  })

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('description', { name: groupName })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Button
          onClick={() => restore.mutate({ groupId })}
          disabled={restore.isPending}
        >
          {t('restore')}
        </Button>
        <Button variant="ghost" onClick={() => router.push('/groups')}>
          {t('back')}
        </Button>
      </CardContent>
    </Card>
  )
}
