'use server'

import { Locale, Locales, defaultLocale, locales } from '@/i18n/request'
import { match } from '@formatjs/intl-localematcher'
import Negotiator from 'negotiator'
import { cookies, headers } from 'next/headers'

const COOKIE_NAME = 'NEXT_LOCALE'

function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (locales as string[]).includes(value)
}

function getAcceptLanguageLocale(requestHeaders: Headers, locales: Locales) {
  let locale
  const languages = new Negotiator({
    headers: {
      'accept-language': requestHeaders.get('accept-language') || undefined,
    },
  }).languages()
  try {
    locale = match(languages, locales, defaultLocale)
  } catch (e) {
    // invalid language - fallback to default
    locale = defaultLocale
  }
  return isLocale(locale) ? locale : defaultLocale
}

export async function getUserLocale(): Promise<Locale> {
  // Prio 1: use existing cookie. It is user-controlled and also outlives
  // removed locales, so only trust a value we still ship messages for.
  const cookieLocale = (await cookies()).get(COOKIE_NAME)?.value
  if (isLocale(cookieLocale)) return cookieLocale

  // Prio 2: use `accept-language` header
  // Prio 3: use default locale
  return getAcceptLanguageLocale(await headers(), locales)
}

export async function setUserLocale(locale: Locale) {
  // Server actions take any string at runtime, not just the typed union.
  if (!isLocale(locale)) return
  ;(await cookies()).set(COOKIE_NAME, locale, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })
}
