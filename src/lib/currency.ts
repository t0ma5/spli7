import { Locale } from '@/i18n/request'
import currencyList from './currency-data.json'

export type Currency = {
  name: string
  symbol_native: string
  symbol: string
  code: string
  name_plural: string
  rounding: number
  decimal_digits: number
}

export const supportedCurrencyCodes = [
  'USD',
  'EUR',
  'JPY',
  'AUD',
  'ARS',
  'BGN',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'COP',
  'CZK',
  'DKK',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'INR',
  'ISK',
  'JOD',
  'KRW',
  'MKD',
  'MOP',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'VND',
  'ZAR',
] as const
export type supportedCurrencyCodeType = (typeof supportedCurrencyCodes)[number]

export function defaultCurrencyList(
  locale: Locale = 'en-US',
  customChoice: string | null = null,
) {
  const currencies = customChoice
    ? [
        {
          name: customChoice,
          symbol_native: '',
          symbol: '',
          code: '',
          name_plural: customChoice,
          rounding: 0,
          decimal_digits: 2,
        },
      ]
    : []
  const allCurrencies = currencyList[locale]
  return currencies.concat(Object.values(allCurrencies))
}

export function getCurrency(
  currencyCode: string | undefined | null,
  locale: Locale = 'en-US',
  customChoice = 'Custom',
): Currency {
  const defaultCurrency = {
    name: customChoice,
    symbol_native: '',
    symbol: '',
    code: '',
    name_plural: customChoice,
    rounding: 0,
    decimal_digits: 2,
  }
  if (!currencyCode || currencyCode === '') return defaultCurrency
  const currencyListInLocale = currencyList[locale] ?? currencyList['en-US']
  return (
    currencyListInLocale[currencyCode as supportedCurrencyCodeType] ??
    defaultCurrency
  )
}
