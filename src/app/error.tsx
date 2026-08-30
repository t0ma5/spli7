'use client'

import { useTranslations } from 'next-intl'

export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('Errors')
  return (
    <div className="container max-w-lg py-16 text-center space-y-4">
      <h2 className="text-xl font-semibold">{t('title')}</h2>
      <p className="text-muted-foreground text-sm">{t('generic')}</p>
      <button
        type="button"
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => reset()}
      >
        {t('retry')}
      </button>
    </div>
  )
}
