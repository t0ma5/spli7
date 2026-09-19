import { ApplePwaSplash } from '@/app/apple-pwa-splash'
import { ProgressBar } from '@/components/progress-bar'
import { ServiceWorkerRegistration } from '@/components/service-worker-registration'
import { SiteHeader } from '@/components/site-header'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/toaster'
import { env } from '@/lib/env'
import { TRPCProvider } from '@/trpc/client'
import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { Suspense } from 'react'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_BASE_URL),
  title: {
    default: 'spli7 · Share Expenses with Friends & Family',
    template: '%s · spli7',
  },
  description:
    'spli7 is a minimalist web application to share expenses with friends and family. No ads, no account, no problem. Based on Spliit.',
  openGraph: {
    title: 'spli7 · Share Expenses with Friends & Family',
    description:
      'spli7 is a minimalist web application to share expenses with friends and family. No ads, no account, no problem. Based on Spliit.',
    images: `/banner.png`,
    type: 'website',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    creator: '@scastiel',
    site: '@scastiel',
    images: `/banner.png`,
    title: 'spli7 · Share Expenses with Friends & Family',
    description:
      'spli7 is a minimalist web application to share expenses with friends and family. No ads, no account, no problem. Based on Spliit.',
  },
  appleWebApp: {
    capable: true,
    title: 'spli7',
  },
  applicationName: 'spli7',
  icons: [
    {
      url: '/android-chrome-192x192.png',
      sizes: '192x192',
      type: 'image/png',
    },
    {
      url: '/android-chrome-512x512.png',
      sizes: '512x512',
      type: 'image/png',
    },
  ],
}

export const viewport: Viewport = {
  themeColor: '#047857',
}

function Content({ children }: { children: React.ReactNode }) {
  return (
    <TRPCProvider>
      <SiteHeader />

      <div className="pt-16 flex-1 flex flex-col">{children}</div>

      <Toaster />
    </TRPCProvider>
  )
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await getLocale()
  const messages = await getMessages()
  return (
    <html lang={locale} suppressHydrationWarning>
      <ApplePwaSplash icon="/logo/512x512.png" color="#030712" />
      <body className="min-h-[100dvh] flex flex-col items-stretch bg-slate-50 bg-opacity-30 dark:bg-background">
        <NextIntlClientProvider messages={messages}>
          <ServiceWorkerRegistration />
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <Suspense>
              <ProgressBar />
            </Suspense>
            <Content>{children}</Content>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
