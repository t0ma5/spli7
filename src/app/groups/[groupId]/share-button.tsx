'use client'
import { CopyButton } from '@/components/copy-button'
import { ShareUrlButton } from '@/components/share-url-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useBaseUrl } from '@/lib/hooks'
import { Group } from '@/lib/kv/types'
import { Share } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type Props = {
  group: Group
}

export function ShareButton({ group }: Props) {
  const t = useTranslations('Share')
  const baseUrl = useBaseUrl()
  const url = baseUrl && `${baseUrl}/groups/${group.id}/expenses?ref=share`
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!url) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    void import('qrcode').then((QRCode) =>
      QRCode.toDataURL(url, { width: 180, margin: 1 }).then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl)
      }),
    )
    return () => {
      cancelled = true
    }
  }, [url])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button title={t('title')} size="icon" className="flex-shrink-0">
          <Share className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="[&_p]:text-sm flex flex-col gap-3">
        <p>{t('description')}</p>
        {url && (
          <div className="flex gap-2">
            <Input className="flex-1" defaultValue={url} readOnly />
            <CopyButton text={url} />
            <ShareUrlButton
              text={`Join my group ${group.name} on spl1t`}
              url={url}
            />
          </div>
        )}
        {qrDataUrl && (
          <div className="flex flex-col items-center gap-2">
            <img
              src={qrDataUrl}
              alt={t('qrAlt')}
              className="rounded-md border bg-white p-2"
              width={180}
              height={180}
            />
            <p className="text-muted-foreground text-center">{t('qrHelp')}</p>
          </div>
        )}
        <p>
          <strong>{t('warning')}</strong> {t('warningHelp')}
        </p>
      </PopoverContent>
    </Popover>
  )
}
