'use client'
import * as React from 'react'

import { Input, InputProps } from '@/components/ui/input'
import { normalizeNumberInput } from '@/lib/number-input'
import { cn } from '@/lib/utils'

type Props = Omit<InputProps, 'onChange'> & {
  step?: number
  onChange: (amount: string) => void
  prefix?: string
  postfix?: string
  affixClassName?: string
}

const AmountInput = React.forwardRef<HTMLInputElement, Props>(
  (
    {
      className,
      affixClassName,
      step = 0.01,
      prefix,
      postfix,
      onChange,
      ...props
    },
    ref,
  ) => {
    return (
      <div className="flex items-baseline gap-2">
        {prefix !== undefined && (
          <span className={cn(affixClassName)}>{prefix}</span>
        )}
        <Input
          className={cn('text-base', className)}
          type="text"
          inputMode={step >= 1 ? 'numeric' : 'decimal'}
          step={step}
          placeholder={step >= 1 ? '0' : String(step).replace(/\d/g, '0')}
          onChange={(event) =>
            onChange(normalizeNumberInput(event.target.value))
          }
          onFocus={(e) => {
            // small delay to work around Safari clearing selection on mouse up
            const target = e.currentTarget
            setTimeout(() => target.select(), 1)
          }}
          ref={ref}
          {...props}
        />
        {postfix !== undefined && (
          <span className={cn(affixClassName)}>{postfix}</span>
        )}
      </div>
    )
  },
)
AmountInput.displayName = 'AmountInput'

export { AmountInput }
