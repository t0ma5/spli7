'use client'

import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import Link from 'next/link'

export function SiteHeader() {
  const t = useTranslations()
  return (
    <header className="fixed top-0 left-0 right-0 h-16 flex justify-between items-center bg-white dark:bg-gray-950 bg-opacity-50 dark:bg-opacity-50 px-2 border-b backdrop-blur-sm z-50">
      <Link
        className="flex items-center gap-2 hover:scale-105 transition-transform"
        href="/"
      >
        <h1 className="flex items-center m-0 leading-none">
          <Image
            src="/logo/128x128.png"
            className="h-8 w-8 object-contain"
            width={128}
            height={128}
            alt="spli7"
            priority
          />
        </h1>
      </Link>
      <div role="navigation" aria-label="Menu" className="flex">
        <ul className="flex items-center text-sm">
          <li>
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="-my-3 text-primary"
            >
              <Link href="/groups">{t('Header.groups')}</Link>
            </Button>
          </li>
          <li>
            <LocaleSwitcher />
          </li>
          <li>
            <ThemeToggle />
          </li>
        </ul>
      </div>
    </header>
  )
}
