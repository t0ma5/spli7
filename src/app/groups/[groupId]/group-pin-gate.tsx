'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { groupPinUnlockStorageKey } from '@/lib/group-pin'
import { trpc } from '@/trpc/client'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PropsWithChildren, useEffect, useState } from 'react'

type Props = PropsWithChildren<{
  groupId: string
  hasPin: boolean
}>

export function GroupPinGate({ groupId, hasPin, children }: Props) {
  const t = useTranslations('GroupPin')
  const [unlocked, setUnlocked] = useState(!hasPin)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { mutateAsync, isPending } = trpc.groups.verifyPin.useMutation()

  useEffect(() => {
    if (!hasPin) {
      setUnlocked(true)
      return
    }
    try {
      setUnlocked(
        sessionStorage.getItem(groupPinUnlockStorageKey(groupId)) === '1',
      )
    } catch {
      setUnlocked(false)
    }
  }, [groupId, hasPin])

  if (!hasPin || unlocked) return <>{children}</>

  return (
    <Dialog open>
      <DialogContent
        className="sm:max-w-md [&>button.absolute]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            setError(null)
            try {
              await mutateAsync({ groupId, pin })
              sessionStorage.setItem(groupPinUnlockStorageKey(groupId), '1')
              setUnlocked(true)
            } catch {
              setError(t('incorrect'))
            }
          }}
        >
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder={t('placeholder')}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            required
            minLength={4}
            maxLength={8}
            pattern="\d{4,8}"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={isPending || pin.length < 4}>
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              t('unlock')
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
