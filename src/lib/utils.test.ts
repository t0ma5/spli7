import { Currency } from './currency'
import {
  amountAsMinorUnits,
  dateOnlyToLocalDate,
  formatCurrency,
  formatDateOnly,
  getTodayForDateInput,
} from './utils'

describe('formatCurrency', () => {
  const currency: Currency = {
    name: 'Test',
    symbol_native: '',
    symbol: 'CUR',
    code: '',
    name_plural: '',
    rounding: 0,
    decimal_digits: 2,
  }
  /** For testing decimals */
  const partialAmount = 1.23
  /** For testing small full amounts */
  const smallAmount = 1
  /** For testing large full amounts */
  const largeAmount = 10000

  /** Non-breaking space */
  const nbsp = '\xa0'

  interface variation {
    amount: number
    locale: string
    result: string
  }

  /**
   * Variations to be tested, chosen as follows
   * - `en-US` is a very common i18n fallback
   * - `de-DE` exhibited faulty behavior in previous versions
   */
  const variations: variation[] = [
    {
      amount: partialAmount,
      locale: `en-US`,
      result: `${currency.symbol}1.23`,
    },
    {
      amount: smallAmount,
      locale: `en-US`,
      result: `${currency.symbol}1.00`,
    },
    {
      amount: largeAmount,
      locale: `en-US`,
      result: `${currency.symbol}10,000.00`,
    },
    {
      amount: partialAmount,
      locale: `de-DE`,
      result: `1,23${nbsp}${currency.symbol}`,
    },
    {
      amount: smallAmount,
      locale: `de-DE`,
      result: `1,00${nbsp}${currency.symbol}`,
    },
    {
      amount: largeAmount,
      locale: `de-DE`,
      result: `10.000,00${nbsp}${currency.symbol}`,
    },
  ]

  for (const variation of variations) {
    it(`formats ${variation.amount} in ${variation.locale} without fractions`, () => {
      expect(
        formatCurrency(currency, variation.amount * 100, variation.locale),
      ).toBe(variation.result)
    })
    it(`formats ${variation.amount} in ${variation.locale} with fractions`, () => {
      expect(
        formatCurrency(currency, variation.amount, variation.locale, true),
      ).toBe(variation.result)
    })
  }
})

describe('getTodayForDateInput', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('formats as the local calendar date via toISOString', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(2026, 8, 11, 1, 56, 0))

    const isoDate = getTodayForDateInput().toISOString().substring(0, 10)
    const now = new Date()
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    expect(isoDate).toBe(local)
    expect(isoDate).toBe('2026-09-11')
  })
})

describe('dateOnlyToLocalDate', () => {
  it('keeps the stored calendar day for a DATE column value', () => {
    const date = dateOnlyToLocalDate(new Date('2024-08-01T00:00:00.000Z'))

    expect(date.getFullYear()).toBe(2024)
    expect(date.getMonth()).toBe(7)
    expect(date.getDate()).toBe(1)
  })

  it('keeps the first of January in its own year', () => {
    const date = dateOnlyToLocalDate(new Date('2024-01-01T00:00:00.000Z'))

    expect(date.getFullYear()).toBe(2024)
    expect(date.getMonth()).toBe(0)
    expect(date.getDate()).toBe(1)
  })

  it('keeps the last day of a month on that same day', () => {
    const date = dateOnlyToLocalDate(new Date('2024-08-31T00:00:00.000Z'))

    expect(date.getMonth()).toBe(7)
    expect(date.getDate()).toBe(31)
  })
})

describe('formatDateOnly', () => {
  it('formats a DATE column value on its stored calendar day', () => {
    const formatted = formatDateOnly(
      new Date('2024-08-01T00:00:00.000Z'),
      'en-US',
      { dateStyle: 'medium' },
    )

    expect(formatted).toBe('Aug 1, 2024')
  })
})

describe('amountAsMinorUnits', () => {
  const currency = (decimal_digits: number) =>
    ({ decimal_digits }) as unknown as Currency

  it('is not thrown off by float error', () => {
    expect(Math.round(1.005 * 100)).toBe(100)
    expect(amountAsMinorUnits(1.005, currency(2))).toBe(101)
    expect(amountAsMinorUnits(8.345, currency(2))).toBe(835)
    expect(amountAsMinorUnits(0.1 + 0.2, currency(2))).toBe(30)
  })

  it('handles 0 and 3 decimal currencies', () => {
    expect(amountAsMinorUnits(1000, currency(0))).toBe(1000)
    expect(amountAsMinorUnits(1.5, currency(0))).toBe(2)
    expect(amountAsMinorUnits(1.2345, currency(3))).toBe(1235)
  })

  it('rounds half up like Math.round for negative amounts', () => {
    expect(amountAsMinorUnits(-1.005, currency(2))).toBe(-100)
    expect(amountAsMinorUnits(-12.34, currency(2))).toBe(-1234)
  })

  it('reads empty form strings as zero', () => {
    expect(amountAsMinorUnits('' as unknown as number, currency(2))).toBe(0)
    expect(amountAsMinorUnits('12.5' as unknown as number, currency(2))).toBe(
      1250,
    )
  })
})
