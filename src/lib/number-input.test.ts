import { normalizeNumberInput } from './number-input'

describe('normalizeNumberInput', () => {
  it('normalizes pasted US currency values', () => {
    expect(normalizeNumberInput('-$1,659.84', { decimalDigits: 2 })).toBe(
      '-1659.84',
    )
  })

  it('treats three trailing digits as grouped money digits', () => {
    expect(normalizeNumberInput('$1,659', { decimalDigits: 2 })).toBe('1659')
  })

  it('normalizes pasted European currency values', () => {
    expect(normalizeNumberInput('-\u20ac1.659,84', { decimalDigits: 2 })).toBe(
      '-1659.84',
    )
  })

  it('preserves comma decimal entry for simple values', () => {
    expect(normalizeNumberInput('1,23')).toBe('1.23')
  })

  it('preserves long decimal entry for conversion rates', () => {
    expect(normalizeNumberInput('1.2345')).toBe('1.2345')
    expect(normalizeNumberInput('1,2345')).toBe('1.2345')
  })

  it('normalizes grouped US and European values', () => {
    expect(normalizeNumberInput('1,234,567.89', { decimalDigits: 2 })).toBe(
      '1234567.89',
    )
    expect(normalizeNumberInput('1.234.567,89', { decimalDigits: 2 })).toBe(
      '1234567.89',
    )
  })

  it('reads three decimals as decimals for 3-decimal currencies', () => {
    expect(normalizeNumberInput('1.250', { decimalDigits: 3 })).toBe('1.250')
    expect(normalizeNumberInput('1,250', { decimalDigits: 3 })).toBe('1.250')
    expect(normalizeNumberInput('1.234,500', { decimalDigits: 3 })).toBe(
      '1234.500',
    )
  })

  describe('with allowExpression', () => {
    const opts = { allowExpression: true }

    it('keeps arithmetic operators', () => {
      expect(normalizeNumberInput('10+5', opts)).toBe('10+5')
      expect(normalizeNumberInput('10+5.50', opts)).toBe('10+5.50')
      expect(normalizeNumberInput('(12-2)*3/4', opts)).toBe('(12-2)*3/4')
      expect(normalizeNumberInput('10 + 5', opts)).toBe('10+5')
    })

    it('keeps a trailing operator while typing', () => {
      expect(normalizeNumberInput('10+', opts)).toBe('10+')
      expect(normalizeNumberInput('10-', opts)).toBe('10-')
    })

    it('normalizes each number in the expression', () => {
      expect(normalizeNumberInput('1,5*2', opts)).toBe('1.5*2')
      expect(normalizeNumberInput('1.234,50+1', opts)).toBe('1234.50+1')
    })

    it('still normalizes pasted plain numbers', () => {
      expect(normalizeNumberInput('1.234,50', opts)).toBe('1234.50')
      expect(normalizeNumberInput('-$1,659.84', opts)).toBe('-1659.84')
      expect(normalizeNumberInput('-', opts)).toBe('-')
      expect(normalizeNumberInput('12', opts)).toBe('12')
    })

    it('keeps a leading minus in front of an expression', () => {
      expect(normalizeNumberInput('-5+2', opts)).toBe('-5+2')
      expect(normalizeNumberInput('-(5+2)', opts)).toBe('-(5+2)')
    })
  })
})
