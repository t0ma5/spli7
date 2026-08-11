/**
 * Safely evaluate a basic arithmetic expression (+ - * / and parentheses).
 * Returns null if the expression is invalid or not a finite number.
 */
export function evaluateAmountExpression(input: string): number | null {
  const normalized = input.trim().replace(/,/g, '.').replace(/\s+/g, '')
  if (!normalized) return null
  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    const value = Number(normalized)
    return Number.isFinite(value) ? value : null
  }
  if (!/^[0-9+\-*/().]+$/.test(normalized)) return null

  try {
    // Tokenize into numbers and operators, then shunting-yard → RPN
    const tokens: string[] = []
    let i = 0
    while (i < normalized.length) {
      const ch = normalized[i]
      if ((ch >= '0' && ch <= '9') || ch === '.') {
        let j = i + 1
        while (
          j < normalized.length &&
          ((normalized[j] >= '0' && normalized[j] <= '9') ||
            normalized[j] === '.')
        ) {
          j++
        }
        tokens.push(normalized.slice(i, j))
        i = j
        continue
      }
      // unary minus
      if (
        ch === '-' &&
        (tokens.length === 0 ||
          ['+', '-', '*', '/', '('].includes(tokens[tokens.length - 1]))
      ) {
        let j = i + 1
        if (j < normalized.length && normalized[j] === '(') {
          tokens.push('-1', '*')
          i++
          continue
        }
        while (
          j < normalized.length &&
          ((normalized[j] >= '0' && normalized[j] <= '9') ||
            normalized[j] === '.')
        ) {
          j++
        }
        if (j === i + 1) return null
        tokens.push(normalized.slice(i, j))
        i = j
        continue
      }
      if ('+-*/()'.includes(ch)) {
        tokens.push(ch)
        i++
        continue
      }
      return null
    }

    const precedence: Record<string, number> = {
      '+': 1,
      '-': 1,
      '*': 2,
      '/': 2,
    }
    const output: string[] = []
    const ops: string[] = []
    for (const token of tokens) {
      if (/^-?\d+(\.\d+)?$/.test(token)) {
        output.push(token)
      } else if (token in precedence) {
        while (
          ops.length &&
          ops[ops.length - 1] in precedence &&
          precedence[ops[ops.length - 1]] >= precedence[token]
        ) {
          output.push(ops.pop()!)
        }
        ops.push(token)
      } else if (token === '(') {
        ops.push(token)
      } else if (token === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') {
          output.push(ops.pop()!)
        }
        if (!ops.length) return null
        ops.pop()
      } else {
        return null
      }
    }
    while (ops.length) {
      const op = ops.pop()!
      if (op === '(' || op === ')') return null
      output.push(op)
    }

    const stack: number[] = []
    for (const token of output) {
      if (/^-?\d+(\.\d+)?$/.test(token)) {
        stack.push(Number(token))
        continue
      }
      const b = stack.pop()
      const a = stack.pop()
      if (a === undefined || b === undefined) return null
      let result: number
      switch (token) {
        case '+':
          result = a + b
          break
        case '-':
          result = a - b
          break
        case '*':
          result = a * b
          break
        case '/':
          if (b === 0) return null
          result = a / b
          break
        default:
          return null
      }
      if (!Number.isFinite(result)) return null
      stack.push(result)
    }
    if (stack.length !== 1) return null
    return stack[0]
  } catch {
    return null
  }
}
