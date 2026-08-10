'use client'

import { Button } from '@/components/ui/button'
import { Receipt } from 'lucide-react'
import { useTranslations } from 'next-intl'

/**
 * Receipt scanning is deferred on the Cloudflare KV deploy.
 * Kept as a no-op so expense pages compile when the feature flag is off.
 */
export function CreateFromReceiptButton() {
  const t = useTranslations('CreateFromReceipt')
  return (
    <Button
      size="icon"
      variant="secondary"
      title={t('Dialog.triggerTitle')}
      disabled
    >
      <Receipt className="w-4 h-4" />
    </Button>
  )
}
