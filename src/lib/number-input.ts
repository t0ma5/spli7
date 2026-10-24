type NormalizeNumberInputOptions = {
  decimalDigits?: number
  /**
   * Keep arithmetic (`+ - * / ( )`) so an amount like `10+5` can be typed and
   * evaluated later with `evaluateAmountExpression`. Each number in the
   * expression is still normalized, so a pasted `1.234,50` becomes `1234.50`.
   */
  allowExpression?: boolean
}

const EXPRESSION_OPERATOR = /[+\-*/()]/

export function normalizeNumberInput(
  value: string,
  options: NormalizeNumberInputOptions = {},
) {
  if (options.allowExpression && isExpression(value)) {
    return normalizeExpression(value, options)
  }
  return normalizeSingleNumber(value, options)
}

/**
 * True when the value holds an operator other than a leading minus sign, so
 * `-$1,659.84` is still a plain (negative) number but `10-2` is not.
 */
function isExpression(value: string) {
  const withoutLeadingSign = value
    .trim()
    .replace(/^[^\d,.\-+*/()]+/, '')
    .replace(/^-/, '')
  return EXPRESSION_OPERATOR.test(withoutLeadingSign)
}

function normalizeExpression(
  value: string,
  options: NormalizeNumberInputOptions,
) {
  const kept = value.replace(/[^\d.,+\-*/()]/g, '')
  return kept
    .split(/([+\-*/()])/)
    .map((part) =>
      part === '' || EXPRESSION_OPERATOR.test(part)
        ? part
        : normalizeSingleNumber(part, { decimalDigits: options.decimalDigits }),
    )
    .join('')
}

function normalizeSingleNumber(
  value: string,
  options: NormalizeNumberInputOptions,
) {
  const valueWithoutLeadingDecoration = value
    .trimStart()
    .replace(/^[^\d,.-]+/, '')
  const isNegative = valueWithoutLeadingDecoration.startsWith('-')
  const numericValue = value.replace(/[^\d.,]/g, '')

  if (numericValue.length === 0) return isNegative ? '-' : ''

  const separatorMatches = numericValue.match(/[.,]/g) ?? []
  if (separatorMatches.length === 0) {
    return `${isNegative ? '-' : ''}${numericValue}`
  }

  const dotCount = separatorMatches.filter(
    (separator) => separator === '.',
  ).length
  const commaCount = separatorMatches.length - dotCount

  if (dotCount > 0 && commaCount > 0) {
    return buildNumberWithRightmostDecimalSeparator(numericValue, isNegative)
  }

  if (separatorMatches.length > 1) {
    return `${isNegative ? '-' : ''}${numericValue.replace(/[.,]/g, '')}`
  }

  const separatorIndex = numericValue.search(/[.,]/)
  const fractionDigits = numericValue.length - separatorIndex - 1
  // A single separator followed by exactly three digits reads as a thousands
  // separator for money ("1,659"), unless the currency itself has three
  // decimals (KWD, BHD, OMR, TND), where "1.250" means one and a quarter.
  if (
    options.decimalDigits !== undefined &&
    options.decimalDigits !== 3 &&
    fractionDigits === 3 &&
    separatorIndex > 0
  ) {
    return `${isNegative ? '-' : ''}${numericValue.replace(/[.,]/g, '')}`
  }

  return `${isNegative ? '-' : ''}${numericValue.replace(/[.,]/, '.')}`
}

function buildNumberWithRightmostDecimalSeparator(
  value: string,
  isNegative: boolean,
) {
  const decimalSeparatorIndex = Math.max(
    value.lastIndexOf('.'),
    value.lastIndexOf(','),
  )
  const integerPart = value.slice(0, decimalSeparatorIndex).replace(/[.,]/g, '')
  const fractionPart = value
    .slice(decimalSeparatorIndex + 1)
    .replace(/[.,]/g, '')

  return `${isNegative ? '-' : ''}${integerPart}.${fractionPart}`
}
