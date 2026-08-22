'use client'

import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'

const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000

/**
 * Registers the service worker (public/sw.js) that caches static assets to save
 * bandwidth and improve performance, and prompts the user to reload when a new
 * version has been deployed.
 *
 * Registration only runs in production: in development a cached service worker
 * would serve stale assets and mask changes.
 */
export function ServiceWorkerRegistration() {
  const { toast } = useToast()
  const t = useTranslations('Pwa')

  const toastRef = useRef(toast)
  const tRef = useRef(t)
  useEffect(() => {
    toastRef.current = toast
    tRef.current = t
  })

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    let cleanup: (() => void) | undefined

    const register = async () => {
      try {
        const hadController = !!navigator.serviceWorker.controller

        const registration = await navigator.serviceWorker.register('/sw.js')

        let refreshing = false
        const onControllerChange = () => {
          if (!hadController || refreshing) return
          refreshing = true
          window.location.reload()
        }
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          onControllerChange,
        )

        const promptUpdate = (worker: ServiceWorker) => {
          const t = tRef.current
          toastRef.current({
            title: t('updateTitle'),
            description: t('updateDescription'),
            duration: Infinity,
            action: (
              <ToastAction
                altText={t('reload')}
                onClick={() => worker.postMessage('SKIP_WAITING')}
              >
                {t('reload')}
              </ToastAction>
            ),
          })
        }

        if (registration.waiting && navigator.serviceWorker.controller) {
          promptUpdate(registration.waiting)
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          if (!newWorker) return
          newWorker.addEventListener('statechange', () => {
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              promptUpdate(newWorker)
            }
          })
        })

        const interval = window.setInterval(
          () => registration.update(),
          UPDATE_CHECK_INTERVAL,
        )
        const onVisibilityChange = () => {
          if (document.visibilityState === 'visible') registration.update()
        }
        document.addEventListener('visibilitychange', onVisibilityChange)

        cleanup = () => {
          navigator.serviceWorker.removeEventListener(
            'controllerchange',
            onControllerChange,
          )
          document.removeEventListener('visibilitychange', onVisibilityChange)
          window.clearInterval(interval)
        }
      } catch (error) {
        console.error('Service worker registration failed:', error)
      }
    }

    if (document.readyState === 'complete') {
      register()
    } else {
      const onLoad = () => register()
      window.addEventListener('load', onLoad)
      cleanup = () => window.removeEventListener('load', onLoad)
    }

    return () => cleanup?.()
  }, [])

  return null
}
