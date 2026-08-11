'use client'

import { saveRecentGroup } from '@/app/groups/recent-groups-helpers'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useMediaQuery } from '@/lib/hooks'
import { groupImportSchema } from '@/lib/schemas'
import { looksLikeTricountCsv } from '@/lib/tricount-detect'
import { trpc } from '@/trpc/client'
import { Loader2, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

type Props = {
  reload: () => void
}

export function ImportGroupJsonButton({ reload }: Props) {
  const t = useTranslations('Groups.ImportJSON')
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const utils = trpc.useUtils()
  const { mutateAsync: importJson } = trpc.groups.import.useMutation()
  const { mutateAsync: importTricount } =
    trpc.groups.importTricount.useMutation()

  async function handleFile(file: File) {
    setError(null)
    setPending(true)
    try {
      const text = await file.text()

      if (looksLikeTricountCsv(text)) {
        const { groupId, groupName } = await importTricount({ csvText: text })
        saveRecentGroup({ id: groupId, name: groupName })
        await utils.groups.invalidate()
        reload()
        setOpen(false)
        router.push(`/groups/${groupId}`)
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        setError(t('invalidJson'))
        return
      }

      const validated = groupImportSchema.safeParse(parsed)
      if (!validated.success) {
        const firstIssue = validated.error.issues[0]
        setError(
          firstIssue
            ? `${t('invalidSchema')} (${firstIssue.path.join('.') || 'root'}: ${firstIssue.message})`
            : t('invalidSchema'),
        )
        return
      }

      const { groupId, groupName } = await importJson({
        groupImportValues: validated.data,
      })
      saveRecentGroup({ id: groupId, name: groupName })
      await utils.groups.invalidate()
      reload()
      setOpen(false)
      router.push(`/groups/${groupId}`)
    } catch {
      setError(t('error'))
    } finally {
      setPending(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary">{t('button')}</Button>
      </PopoverTrigger>
      <PopoverContent
        align={isDesktop ? 'end' : 'start'}
        className="[&_p]:text-sm flex flex-col gap-3"
      >
        <h3 className="font-bold">{t('title')}</h3>
        <p>{t('description')}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json,text/csv,.csv"
          className="hidden"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
        <Button
          type="button"
          disabled={pending}
          onClick={() => fileInputRef.current?.click()}
        >
          {pending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Upload className="w-4 h-4 mr-2" />
          )}
          {pending ? t('importing') : t('chooseFile')}
        </Button>
        {error && <p className="text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  )
}
