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
  'AED',
  'AFN',
  'ALL',
  'AMD',
  'ARS',
  'AUD',
  'AZN',
  'BAM',
  'BDT',
  'BGN',
  'BHD',
  'BIF',
  'BND',
  'BOB',
  'BRL',
  'BWP',
  'BYN',
  'BZD',
  'CAD',
  'CDF',
  'CHF',
  'CLP',
  'CNY',
  'COP',
  'CRC',
  'CVE',
  'CZK',
  'DJF',
  'DKK',
  'DOP',
  'DZD',
  'EGP',
  'ERN',
  'ETB',
  'GBP',
  'GEL',
  'GHS',
  'GNF',
  'GTQ',
  'HKD',
  'HNL',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'IQD',
  'IRR',
  'ISK',
  'JMD',
  'JOD',
  'KES',
  'KHR',
  'KMF',
  'KRW',
  'KWD',
  'KZT',
  'LBP',
  'LKR',
  'LYD',
  'MAD',
  'MDL',
  'MGA',
  'MKD',
  'MMK',
  'MOP',
  'MUR',
  'MXN',
  'MYR',
  'MZN',
  'NAD',
  'NGN',
  'NIO',
  'NOK',
  'NPR',
  'NZD',
  'OMR',
  'PAB',
  'PEN',
  'PHP',
  'PKR',
  'PLN',
  'PYG',
  'QAR',
  'RON',
  'RSD',
  'RUB',
  'RWF',
  'SAR',
  'SDG',
  'SEK',
  'SGD',
  'SOS',
  'SYP',
  'THB',
  'TND',
  'TOP',
  'TRY',
  'TTD',
  'TWD',
  'TZS',
  'UAH',
  'UGX',
  'UYU',
  'UZS',
  'VND',
  'XAF',
  'XOF',
  'YER',
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
