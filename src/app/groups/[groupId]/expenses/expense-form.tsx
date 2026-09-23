import { AmountInput } from '@/components/amount-input'
import { CategorySelector } from '@/components/category-selector'
import { CurrencySelector } from '@/components/currency-selector'
import { ExpenseDocumentsInput } from '@/components/expense-documents-input'
import { Money } from '@/components/money'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormFieldScope,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Locale } from '@/i18n/request'
import { evaluateAmountExpression } from '@/lib/amount-expression'
import { Currency, defaultCurrencyList, getCurrency } from '@/lib/currency'
import {
  convertToGroupCurrency,
  convertToOriginalCurrency,
} from '@/lib/currency-conversion'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { useActiveUser, useCurrencyRate } from '@/lib/hooks'
import { RecurrenceRule } from '@/lib/kv/types'
import { normalizeNumberInput } from '@/lib/number-input'
import { randomId } from '@/lib/randomId'
import {
  EXPENSE_NOTES_MAX,
  ExpenseFormValues,
  SplittingOptions,
  expenseFormSchema,
} from '@/lib/schemas'
import { distributeAmount } from '@/lib/shares'
import { calculateShare } from '@/lib/totals'
import {
  amountAsDecimal,
  amountAsMinorUnits,
  cn,
  formatAmountAsDecimal,
  formatCurrency,
  getCurrencyFromGroup,
  getTodayForDateInput,
} from '@/lib/utils'
import { AppRouterOutput } from '@/trpc/routers/_app'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronRight, Copy, Save, UserMinus, UserPlus } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Fragment, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { match } from 'ts-pattern'
import { DeletePopup } from '../../../../components/delete-popup'
import { extractCategoryFromTitle } from '../../../../components/expense-form-actions'
import { Textarea } from '../../../../components/ui/textarea'

/**
 * Drops decimals beyond the currency's. An amount is rounded to those when
 * saved, and the "amounts must add up" check compares exact values, so a
 * third decimal would fail it invisibly.
 */
const limitAmountDecimals = (value: string, currency: Currency) => {
  const [integer, fraction] = value.split('.')
  if (fraction === undefined || currency.decimal_digits === 0) {
    return integer ?? value
  }
  return `${integer}.${fraction.slice(0, currency.decimal_digits)}`
}

const getDefaultSplittingOptions = (
  group: NonNullable<AppRouterOutput['groups']['get']['group']>,
) => {
  const defaultValue = {
    splitMode: (group.defaultSplitMode ?? 'EVENLY') as
      'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE' | 'BY_AMOUNT',
    paidFor: group.participants.map(({ id }) => ({
      participant: id,
      shares: '1' as any, // Use string to ensure consistent schema handling
    })),
  }

  if (typeof localStorage === 'undefined') return defaultValue
  const defaultSplitMode = localStorage.getItem(
    `${group.id}-defaultSplittingOptions`,
  )
  if (defaultSplitMode === null) return defaultValue
  const parsedDefaultSplitMode = JSON.parse(
    defaultSplitMode,
  ) as SplittingOptions

  if (parsedDefaultSplitMode.paidFor === null) {
    parsedDefaultSplitMode.paidFor = defaultValue.paidFor
  }

  // if there is a participant in the default options that does not exist anymore,
  // remove the stale default splitting options
  for (const parsedPaidFor of parsedDefaultSplitMode.paidFor) {
    if (
      !group.participants.some(({ id }) => id === parsedPaidFor.participant)
    ) {
      localStorage.removeItem(`${group.id}-defaultSplittingOptions`)
      return defaultValue
    }
  }

  return {
    splitMode: parsedDefaultSplitMode.splitMode,
    paidFor: parsedDefaultSplitMode.paidFor.map((paidFor) => ({
      participant: paidFor.participant,
      shares: (paidFor.shares / 100).toString() as any, // Convert to string for consistent schema handling
    })),
  }
}

async function persistDefaultSplittingOptions(
  groupId: string,
  expenseFormValues: ExpenseFormValues,
) {
  if (localStorage && expenseFormValues.saveDefaultSplittingOptions) {
    const computePaidFor = (): SplittingOptions['paidFor'] => {
      if (expenseFormValues.splitMode === 'EVENLY') {
        return expenseFormValues.paidFor.map(({ participant }) => ({
          participant,
          shares: 100,
        }))
      } else if (expenseFormValues.splitMode === 'BY_AMOUNT') {
        return null
      } else {
        return expenseFormValues.paidFor
      }
    }

    const splittingOptions = {
      splitMode: expenseFormValues.splitMode,
      paidFor: computePaidFor(),
    } satisfies SplittingOptions

    localStorage.setItem(
      `${groupId}-defaultSplittingOptions`,
      JSON.stringify(splittingOptions),
    )
  }
}

type LoadedExpense = NonNullable<
  AppRouterOutput['groups']['expenses']['get']['expense']
>

function expenseToFormValues(
  expense: LoadedExpense,
  groupCurrency: ReturnType<typeof getCurrencyFromGroup>,
  groupCurrencyCode: string | null,
  mode: 'edit' | 'duplicate',
): ExpenseFormValues {
  return {
    title: expense.title,
    expenseDate:
      mode === 'duplicate'
        ? getTodayForDateInput()
        : (expense.expenseDate ?? getTodayForDateInput()),
    amount: amountAsDecimal(expense.amount, groupCurrency),
    originalCurrency: expense.originalCurrency ?? groupCurrencyCode,
    originalAmount: expense.originalAmount ?? undefined,
    conversionRate: expense.conversionRate ?? undefined,
    category: expense.categoryId,
    paidBy: expense.paidBy.map(({ participantId, amount }) => ({
      participant: participantId,
      amount: amountAsDecimal(amount, groupCurrency) as any,
    })),
    paidFor: expense.paidFor.map(({ participantId, shares }) => ({
      participant: participantId,
      shares: (expense.splitMode === 'BY_AMOUNT'
        ? amountAsDecimal(shares, groupCurrency)
        : (shares / 100).toString()) as any,
    })),
    splitMode: expense.splitMode,
    saveDefaultSplittingOptions: false,
    isReimbursement: expense.isReimbursement,
    documents: mode === 'duplicate' ? [] : expense.documents,
    notes: expense.notes ?? '',
    recurrenceRule:
      mode === 'duplicate'
        ? RecurrenceRule.NONE
        : (expense.recurrenceRule ?? RecurrenceRule.NONE),
  }
}

export function ExpenseForm({
  group,
  categories,
  expense,
  duplicateFrom,
  expenseId,
  onSubmit,
  onDelete,
  runtimeFeatureFlags,
}: {
  group: NonNullable<AppRouterOutput['groups']['get']['group']>
  categories: AppRouterOutput['categories']['list']['categories']
  expense?: LoadedExpense
  duplicateFrom?: LoadedExpense
  /**
   * Id a new expense will be created with. Only the split preview reads it.
   * When editing, `expense.id` wins.
   */
  expenseId?: string
  onSubmit: (value: ExpenseFormValues, participantId?: string) => Promise<void>
  onDelete?: (participantId?: string) => Promise<void>
  runtimeFeatureFlags: RuntimeFeatureFlags
}) {
  const t = useTranslations('ExpenseForm')
  const locale = useLocale() as Locale
  const isCreate = expense === undefined
  const searchParams = useSearchParams()

  const getSelectedPayer = () => {
    if (isCreate && typeof window !== 'undefined') {
      const activeUser = localStorage.getItem(`${group.id}-activeUser`)
      if (activeUser && activeUser !== 'None') {
        return activeUser
      }
    }
    return undefined
  }

  const getSelectedRecurrenceRule = (field?: { value: string }) => {
    return field?.value as RecurrenceRule
  }
  const defaultSplittingOptions = getDefaultSplittingOptions(group)
  const groupCurrency = getCurrencyFromGroup(group)
  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: expense
      ? expenseToFormValues(expense, groupCurrency, group.currencyCode, 'edit')
      : duplicateFrom
        ? expenseToFormValues(
            duplicateFrom,
            groupCurrency,
            group.currencyCode,
            'duplicate',
          )
        : searchParams.get('reimbursement')
          ? {
              title: t('reimbursement'),
              expenseDate: getTodayForDateInput(),
              amount: amountAsDecimal(
                Number(searchParams.get('amount')) || 0,
                groupCurrency,
              ),
              originalCurrency: group.currencyCode,
              originalAmount: undefined,
              conversionRate: undefined,
              category: 1, // category with Id 1 is Payment
              paidBy: [
                {
                  participant: searchParams.get('from') ?? (undefined as any),
                  amount: amountAsDecimal(
                    Number(searchParams.get('amount')) || 0,
                    groupCurrency,
                  ) as any,
                },
              ],
              paidFor: [
                searchParams.get('to')
                  ? {
                      participant: searchParams.get('to')!,
                      shares: '1' as any, // String for consistent form handling
                    }
                  : undefined,
              ],
              isReimbursement: true,
              splitMode: defaultSplittingOptions.splitMode,
              saveDefaultSplittingOptions: false,
              documents: [],
              notes: '',
              recurrenceRule: RecurrenceRule.NONE,
            }
          : {
              title: searchParams.get('title') ?? '',
              expenseDate: searchParams.get('date')
                ? new Date(searchParams.get('date') as string)
                : getTodayForDateInput(),
              amount: Number(searchParams.get('amount')) || 0,
              originalCurrency: group.currencyCode ?? undefined,
              originalAmount: undefined,
              conversionRate: undefined,
              category: searchParams.get('categoryId')
                ? Number(searchParams.get('categoryId'))
                : 0, // category with Id 0 is General
              // paid for all, split evenly
              paidFor: defaultSplittingOptions.paidFor,
              paidBy: [
                {
                  participant: getSelectedPayer() as any,
                  amount: (Number(searchParams.get('amount')) || '') as any,
                },
              ],
              isReimbursement: false,
              splitMode: defaultSplittingOptions.splitMode,
              saveDefaultSplittingOptions: false,
              documents: searchParams.get('imageUrl')
                ? [
                    {
                      id: randomId(),
                      url: searchParams.get('imageUrl') as string,
                      width: Number(searchParams.get('imageWidth')),
                      height: Number(searchParams.get('imageHeight')),
                    },
                  ]
                : [],
              notes: '',
              recurrenceRule: RecurrenceRule.NONE,
            },
  })
  const [isCategoryLoading, setCategoryLoading] = useState(false)
  const activeUserId = useActiveUser(group.id)

  const calcTotalAmountMajor = (
    paidBys: { amount: number | string }[] | undefined,
  ) =>
    (paidBys ?? []).reduce((sum, { amount }) => sum + (Number(amount) || 0), 0)

  const submit = async (values: ExpenseFormValues) => {
    await persistDefaultSplittingOptions(group.id, values)

    const evaluatedPaidBy: ExpenseFormValues['paidBy'] = []
    for (let index = 0; index < values.paidBy.length; index++) {
      const entry = values.paidBy[index]
      const evaluated = evaluateAmountExpression(String(entry.amount))
      if (evaluated === null) {
        form.setError(`paidBy.${index}.amount`, { message: 'invalidNumber' })
        return
      }
      evaluatedPaidBy.push({ ...entry, amount: evaluated })
    }
    values.paidBy = evaluatedPaidBy

    // Store monetary amounts in minor units (cents)
    values.paidBy = values.paidBy.map(({ participant, amount }) => ({
      participant,
      amount: amountAsMinorUnits(Number(amount), groupCurrency),
    }))
    values.amount = values.paidBy.reduce(
      (sum, { amount }) => sum + Number(amount),
      0,
    )
    values.paidFor = values.paidFor.map(({ participant, shares }) => ({
      participant,
      shares:
        values.splitMode === 'BY_AMOUNT'
          ? amountAsMinorUnits(shares, groupCurrency)
          : shares,
    }))

    // Currency should be blank if same as group currency
    if (!conversionRequired) {
      delete values.originalAmount
      delete values.originalCurrency
    }
    return onSubmit(values, activeUserId ?? undefined)
  }

  const watchedPaidBy = form.watch('paidBy')
  const totalAmountMajor = calcTotalAmountMajor(watchedPaidBy as any)
  const totalAmountMinor = amountAsMinorUnits(totalAmountMajor, groupCurrency)
  const [isIncome, setIsIncome] = useState(totalAmountMajor < 0)
  // How the user last touched each participant's share. An 'edited' amount is
  // kept as typed; every other participant takes an equal part of what is
  // left. A 'cleared' participant (the input was emptied) is one of those, but
  // the input shows its part as a placeholder rather than a value, so the user
  // can type over it without deleting it first.
  const [shareEdits, setShareEdits] = useState<
    Map<string, 'edited' | 'cleared'>
  >(new Map())

  const markShareEdited = (id: string, cleared: boolean) => {
    const state =
      cleared && form.getValues().splitMode === 'BY_AMOUNT'
        ? 'cleared'
        : 'edited'
    setShareEdits((prev) => new Map(prev).set(id, state))
  }

  const forgetShareEdit = (id: string) =>
    setShareEdits((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })

  const sExpense = isIncome ? 'Income' : 'Expense'

  const originalCurrency = getCurrency(
    form.getValues('originalCurrency'),
    locale,
    'Custom',
  )
  const exchangeRate = useCurrencyRate(
    form.watch('expenseDate'),
    form.watch('originalCurrency') ?? '',
    groupCurrency.code,
  )

  const conversionRequired =
    group.currencyCode &&
    group.currencyCode.length &&
    originalCurrency.code.length &&
    originalCurrency.code !== group.currencyCode

  /**
   * For a regular expense the user enters what they spent in the original
   * currency and the group-currency amount follows. For a repayment it is the
   * other way around: the group-currency amount is the balance being settled,
   * and the original amount is the amount to actually transfer.
   */
  const convertFromGroupCurrency = !!form.watch('isReimbursement')

  useEffect(() => {
    setShareEdits(new Map())
  }, [form.watch('splitMode'), form.watch('paidBy')])

  useEffect(() => {
    const sum = calcTotalAmountMajor(form.getValues('paidBy') as any)
    form.setValue('amount', sum, { shouldDirty: false, shouldValidate: false })
    const income = sum < 0
    setIsIncome(income)
    if (income) form.setValue('isReimbursement', false)
  }, [form.watch('paidBy')])

  useEffect(() => {
    const splitMode = form.getValues().splitMode

    // Only auto-balance for split mode 'Unevenly - By amount'
    if (
      splitMode === 'BY_AMOUNT' &&
      (form.getFieldState('paidFor').isDirty ||
        form.getFieldState('paidBy').isDirty)
    ) {
      const totalAmount = calcTotalAmountMajor(form.getValues('paidBy') as any)
      const paidFor = form.getValues().paidFor
      let newPaidFor = [...paidFor]

      const editedParticipants = Array.from(shareEdits)
        .filter(([, state]) => state === 'edited')
        .map(([id]) => id)
      let remainingAmount = totalAmount
      let remainingParticipants = newPaidFor.length - editedParticipants.length

      newPaidFor = newPaidFor.map((participant) => {
        if (editedParticipants.includes(participant.participant)) {
          const participantShare = Number(participant.shares) || 0
          if (splitMode === 'BY_AMOUNT') {
            remainingAmount -= participantShare
          }
          return participant
        }
        return participant
      })

      if (remainingParticipants > 0) {
        // Apportion in minor units so the auto-filled amounts add up to the
        // total exactly. Dividing and rounding each one independently makes
        // 95 across three participants come out as 31.67 three times, which
        // the "amounts must add up" validation then rejects.
        const amountsPerRemaining = distributeAmount(
          amountAsMinorUnits(remainingAmount, groupCurrency),
          remainingParticipants,
        )

        let remainingIndex = 0
        newPaidFor = newPaidFor.map((participant) => {
          if (!editedParticipants.includes(participant.participant)) {
            return {
              ...participant,
              shares: formatAmountAsDecimal(
                amountsPerRemaining[remainingIndex++],
                groupCurrency,
              ) as any,
            }
          }
          return participant
        })
      }
      form.setValue('paidFor', newPaidFor, { shouldValidate: true })
    }
  }, [shareEdits, form.watch('paidBy'), form.watch('splitMode')])

  const [usingCustomConversionRate, setUsingCustomConversionRate] = useState(
    !!form.formState.defaultValues?.conversionRate,
  )

  useEffect(() => {
    if (!usingCustomConversionRate && exchangeRate.data) {
      form.setValue('conversionRate', exchangeRate.data)
    }
  }, [exchangeRate.data, usingCustomConversionRate])

  useEffect(() => {
    if (convertFromGroupCurrency || !conversionRequired) return
    if (!form.getFieldState('originalAmount').isTouched) return
    const originalAmount = form.getValues('originalAmount') ?? 0
    const conversionRate = form.getValues('conversionRate')

    if (conversionRate && originalAmount) {
      const converted = convertToGroupCurrency(
        Number(originalAmount),
        Number(conversionRate),
        groupCurrency,
      )
      if (converted !== null) {
        const v = normalizeNumberInput(converted)
        const income = Number(v) < 0
        setIsIncome(income)
        if (income) form.setValue('isReimbursement', false)
        form.setValue('amount', Number(v))
        const paidBy = form.getValues('paidBy') as any[]
        if (paidBy.length === 1) {
          form.setValue('paidBy.0.amount', v as any, {
            shouldDirty: true,
            shouldValidate: true,
          })
        } else if (paidBy.length > 1) {
          const currentSum = calcTotalAmountMajor(paidBy)
          if (currentSum !== 0) {
            const scale = Number(v) / currentSum
            form.setValue(
              'paidBy',
              paidBy.map((entry) => ({
                ...entry,
                amount: normalizeNumberInput(
                  (Number(entry.amount) * scale).toFixed(
                    groupCurrency.decimal_digits,
                  ),
                ) as any,
              })),
              { shouldDirty: true, shouldValidate: true },
            )
          }
        }
      }
    }
  }, [
    form.watch('originalAmount'),
    form.watch('conversionRate'),
    form.getFieldState('originalAmount').isTouched,
    convertFromGroupCurrency,
    conversionRequired,
  ])

  useEffect(() => {
    if (!convertFromGroupCurrency || !conversionRequired) return
    if (
      !isCreate &&
      !form.getFieldState('paidBy').isDirty &&
      !form.getFieldState('originalCurrency').isDirty &&
      !form.getFieldState('conversionRate').isDirty
    )
      return

    const converted = convertToOriginalCurrency(
      calcTotalAmountMajor(form.getValues('paidBy') as any),
      Number(form.getValues('conversionRate')),
      originalCurrency,
    )
    if (converted !== null) {
      form.setValue(
        'originalAmount',
        (Number(converted) === 0 ? '' : normalizeNumberInput(converted)) as any,
      )
    }
  }, [
    form.watch('paidBy'),
    form.watch('conversionRate'),
    convertFromGroupCurrency,
    conversionRequired,
    originalCurrency.code,
    isCreate,
  ])

  let conversionRateMessage = ''
  if (exchangeRate.isLoading) {
    conversionRateMessage = t('conversionRateState.loading')
  } else {
    let ratesDisplay = ''
    if (exchangeRate.data) {
      // non breaking spaces so the rate text is not split with line feeds
      ratesDisplay = `${form.getValues('originalCurrency')}\xa01\xa0=\xa0${
        group.currencyCode
      }\xa0${exchangeRate.data}`
    }
    if (exchangeRate.error) {
      if (exchangeRate.error instanceof RangeError && exchangeRate.data)
        conversionRateMessage = t('conversionRateState.dateMismatch', {
          date: exchangeRate.error.message,
        })
      else {
        conversionRateMessage = t('conversionRateState.error')
      }
      conversionRateMessage +=
        ' ' +
        (ratesDisplay.length
          ? `${t('conversionRateState.staleRate')} ${ratesDisplay}`
          : t('conversionRateState.noRate'))
    } else {
      conversionRateMessage = ratesDisplay.length
        ? `${t('conversionRateState.success')} ${ratesDisplay}`
        : t('conversionRateState.currencyNotFound')
    }
  }

  // What the "amounts must add up" error reports: the current sum and how far
  // off it is, so the user can fix a one-cent rounding difference without
  // adding the amounts up themselves. Summed in minor units so that 0.1 + 0.2
  // does not come out as a difference; the inputs never hold finer amounts.
  const splitSumValues = ((): Record<string, string> | undefined => {
    if (!form.formState.errors.paidFor) return undefined
    const paidFor = form.watch('paidFor')
    switch (form.watch('splitMode')) {
      case 'BY_AMOUNT': {
        const amount = amountAsMinorUnits(totalAmountMajor, groupCurrency)
        const sum = paidFor.reduce(
          (sum, { shares }) =>
            sum + amountAsMinorUnits(Number(shares) || 0, groupCurrency),
          0,
        )
        return {
          sum: formatCurrency(groupCurrency, sum, locale),
          amount: formatCurrency(groupCurrency, amount, locale),
          difference: formatCurrency(
            groupCurrency,
            Math.abs(sum - amount),
            locale,
          ),
          direction: sum > amount ? 'over' : 'under',
        }
      }
      case 'BY_PERCENTAGE': {
        const sum = paidFor.reduce(
          (sum, { shares }) => sum + Math.round((Number(shares) || 0) * 100),
          0,
        )
        const formatPercentage = (basisPoints: number) =>
          (basisPoints / 100).toLocaleString(locale, {
            maximumFractionDigits: 2,
          })
        return {
          sum: formatPercentage(sum),
          difference: formatPercentage(Math.abs(sum - 10000)),
          direction: sum > 10000 ? 'over' : 'under',
        }
      }
      default:
        return undefined
    }
  })()

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span>{t(`${sExpense}.${isCreate ? 'create' : 'edit'}`)}</span>
              {!isCreate && expense && (
                <Button
                  type="button"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  title={t('copy')}
                  asChild
                >
                  <Link
                    href={`/groups/${group.id}/expenses/create?fromExpense=${expense.id}`}
                  >
                    <Copy className="w-4 h-4" />
                    <span className="sr-only">{t('copy')}</span>
                  </Link>
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="order-1 sm:col-start-1">
                  <FormLabel>{t(`${sExpense}.TitleField.label`)}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t(`${sExpense}.TitleField.placeholder`)}
                      className="text-base"
                      {...field}
                      onBlur={async () => {
                        field.onBlur() // avoid skipping other blur event listeners since we overwrite `field`
                        if (runtimeFeatureFlags.enableCategoryExtract) {
                          setCategoryLoading(true)
                          const { categoryId } = await extractCategoryFromTitle(
                            field.value,
                          )
                          form.setValue('category', categoryId)
                          setCategoryLoading(false)
                        }
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(`${sExpense}.TitleField.description`)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expenseDate"
              render={({ field }) => (
                <FormItem className="order-2 sm:col-start-2">
                  <FormLabel>{t(`${sExpense}.DateField.label`)}</FormLabel>
                  <FormControl>
                    <Input
                      className="date-base"
                      type="date"
                      defaultValue={formatDate(field.value)}
                      onChange={(event) => {
                        return field.onChange(new Date(event.target.value))
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(`${sExpense}.DateField.description`)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="originalCurrency"
              render={({ field: { onChange, ...field } }) => (
                <FormItem className="order-3 sm:col-start-2">
                  <FormLabel>{t(`${sExpense}.currencyField.label`)}</FormLabel>
                  <FormControl>
                    {group.currencyCode ? (
                      <CurrencySelector
                        currencies={defaultCurrencyList(locale, '')}
                        defaultValue={form.watch(field.name) ?? ''}
                        isLoading={false}
                        onValueChange={(v) => onChange(v)}
                      />
                    ) : (
                      <Input
                        className="text-base"
                        disabled={true}
                        {...field}
                        placeholder={group.currency}
                      />
                    )}
                  </FormControl>
                  <FormDescription>
                    {t(`${sExpense}.currencyField.description`)}{' '}
                    {!group.currencyCode && t('conversionUnavailable')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div
              className={`order-4 sm:col-start-2 ${
                !conversionRequired ? 'hidden' : ''
              } space-y-2`}
            >
              <FormField
                control={form.control}
                name="originalAmount"
                render={({ field: { onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel>
                      {t(
                        convertFromGroupCurrency
                          ? 'originalAmountField.repaymentLabel'
                          : 'originalAmountField.label',
                      )}
                    </FormLabel>
                    <div className="flex items-baseline gap-2">
                      <span>{originalCurrency.symbol}</span>
                      <FormControl>
                        <Input
                          className={cn(
                            'text-base max-w-[120px]',
                            convertFromGroupCurrency &&
                              'bg-muted text-muted-foreground',
                          )}
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          readOnly={convertFromGroupCurrency}
                          onChange={(event) => {
                            const v = normalizeNumberInput(event.target.value)
                            onChange(v)
                          }}
                          {...field}
                          onFocus={(e) => {
                            const target = e.currentTarget
                            setTimeout(() => target.select(), 1)
                          }}
                        />
                      </FormControl>
                    </div>
                    {convertFromGroupCurrency && (
                      <FormDescription>
                        {t('originalAmountField.repaymentDescription')}
                      </FormDescription>
                    )}
                    <FormDescription>
                      {isNaN(form.getValues('expenseDate').getTime()) ? (
                        t('conversionRateState.noDate')
                      ) : form.getValues('expenseDate') &&
                        !usingCustomConversionRate ? (
                        <>
                          {conversionRateMessage}
                          {!exchangeRate.isLoading && (
                            <Button
                              className="h-auto py-0"
                              type="button"
                              variant="link"
                              onClick={() => exchangeRate.refresh()}
                            >
                              {t('conversionRateState.refresh')}
                            </Button>
                          )}
                        </>
                      ) : (
                        t('conversionRateState.customRate')
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Collapsible
                open={usingCustomConversionRate}
                onOpenChange={setUsingCustomConversionRate}
              >
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="link" className="-mx-4">
                    {usingCustomConversionRate
                      ? t('conversionRateField.useApi')
                      : t('conversionRateField.useCustom')}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <FormField
                    control={form.control}
                    name="conversionRate"
                    render={({ field: { onChange, ...field } }) => (
                      <FormItem>
                        <FormLabel>{t('conversionRateField.label')}</FormLabel>
                        <div className="flex items-baseline gap-2">
                          <span>
                            {originalCurrency.symbol} 1 = {group.currency}
                          </span>
                          <FormControl>
                            <Input
                              className="text-base max-w-[120px]"
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              onChange={(event) => {
                                const v = normalizeNumberInput(
                                  event.target.value,
                                )
                                onChange(v)
                              }}
                              {...field}
                              onFocus={(e) => {
                                const target = e.currentTarget
                                setTimeout(() => target.select(), 1)
                              }}
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CollapsibleContent>
              </Collapsible>
            </div>
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem className="order-5 sm:col-start-1">
                  <FormLabel>{t('categoryField.label')}</FormLabel>
                  <CategorySelector
                    categories={categories}
                    defaultValue={
                      form.watch(field.name) // may be overwritten externally
                    }
                    onValueChange={field.onChange}
                    isLoading={isCategoryLoading}
                  />
                  <FormDescription>
                    {t(`${sExpense}.categoryFieldDescription`)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paidBy"
              render={({ field }) => (
                <FormItem className="order-8 sm:col-start-2">
                  <FormLabel>{t(`${sExpense}.paidByField.label`)}</FormLabel>
                  <FormDescription>
                    {t(`${sExpense}.paidByField.description`)}
                  </FormDescription>
                  <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
                    <span className="text-sm text-muted-foreground">
                      {t('participant')}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t('amountField.label')}
                    </span>
                    {(field.value as any[]).map((entry, index) => (
                      <Fragment key={index}>
                        <FormField
                          control={form.control}
                          name={`paidBy.${index}.participant` as any}
                          render={({ field: pField }) => (
                            <FormItem>
                              <FormControl>
                                <Select
                                  onValueChange={pField.onChange}
                                  value={pField.value || entry.participant}
                                >
                                  <SelectTrigger>
                                    <SelectValue
                                      placeholder={t(
                                        `${sExpense}.paidByField.placeholder`,
                                      )}
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {group.participants.map(({ id, name }) => (
                                      <SelectItem key={id} value={id}>
                                        {name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="flex gap-2 items-center">
                          <FormField
                            control={form.control}
                            name={`paidBy.${index}.amount` as any}
                            render={({ field: aField }) => (
                              <FormItem>
                                <FormControl>
                                  <AmountInput
                                    className="text-base max-w-[120px]"
                                    prefix={group.currency}
                                    value={aField.value ?? ''}
                                    onChange={(amount) => {
                                      aField.onChange(amount)
                                    }}
                                    onBlur={(event) => {
                                      aField.onBlur()
                                      const evaluated =
                                        evaluateAmountExpression(
                                          event.target.value,
                                        )
                                      if (evaluated === null) return
                                      aField.onChange(
                                        normalizeNumberInput(String(evaluated)),
                                      )
                                    }}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          {(field.value as any[]).length > 1 && (
                            <Button
                              type="button"
                              title={t('removePayer')}
                              variant="ghost"
                              className="p-2 h-8 text-destructive"
                              onClick={() =>
                                field.onChange(
                                  (form.getValues('paidBy') as any[]).filter(
                                    (_, i) => i !== index,
                                  ),
                                )
                              }
                            >
                              <UserMinus className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {(field.value as any[]).length > 1 ? (
                      <>
                        <span className="font-medium">{t('total')}</span>
                        <Money
                          currency={groupCurrency}
                          amount={totalAmountMinor}
                        />
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t('amountField.mathHelp')}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      title={t('addPayer')}
                      className="p-2 h-8"
                      onClick={() => {
                        const newPaidBy = [
                          ...(form.getValues('paidBy') as any[]),
                          {
                            participant: undefined as unknown as string,
                            amount: '' as unknown as number,
                          },
                        ]
                        form.setValue('paidBy', newPaidBy as any, {
                          shouldDirty: true,
                          shouldTouch: true,
                          shouldValidate: false,
                        })
                      }}
                    >
                      <UserPlus className="w-4 h-4" />
                    </Button>
                  </div>
                  <FormMessage />

                  {!isIncome && (
                    <FormField
                      control={form.control}
                      name="isReimbursement"
                      render={({ field: reimbursementField }) => (
                        <FormItem className="flex flex-row gap-2 items-center space-y-0 pt-2">
                          <FormControl>
                            <Checkbox
                              checked={reimbursementField.value}
                              onCheckedChange={reimbursementField.onChange}
                            />
                          </FormControl>
                          <div>
                            <FormLabel>
                              {t('isReimbursementField.label')}
                            </FormLabel>
                          </div>
                        </FormItem>
                      )}
                    />
                  )}
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="order-7 sm:col-start-1">
                  <FormLabel>{t('notesField.label')}</FormLabel>
                  <FormControl>
                    <Textarea
                      className="text-base"
                      maxLength={EXPENSE_NOTES_MAX}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="recurrenceRule"
              render={({ field }) => (
                <FormItem className="order-6 sm:col-start-2">
                  <FormLabel>{t(`${sExpense}.recurrenceRule.label`)}</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      form.setValue('recurrenceRule', value as RecurrenceRule)
                    }}
                    defaultValue={getSelectedRecurrenceRule(field)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="NONE" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">
                        {t(`${sExpense}.recurrenceRule.none`)}
                      </SelectItem>
                      <SelectItem value="DAILY">
                        {t(`${sExpense}.recurrenceRule.daily`)}
                      </SelectItem>
                      <SelectItem value="WEEKLY">
                        {t(`${sExpense}.recurrenceRule.weekly`)}
                      </SelectItem>
                      <SelectItem value="MONTHLY">
                        {t(`${sExpense}.recurrenceRule.monthly`)}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t(`${sExpense}.recurrenceRule.description`)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex justify-between">
              <span>{t(`${sExpense}.paidFor.title`)}</span>
              <Button
                variant="link"
                type="button"
                className="-my-2 -mx-4"
                onClick={() => {
                  const paidFor = form.getValues().paidFor
                  const allSelected =
                    paidFor.length === group.participants.length
                  const newPaidFor = allSelected
                    ? []
                    : group.participants.map((p) => ({
                        participant: p.id,
                        shares: (paidFor.find(
                          (pfor) => pfor.participant === p.id,
                        )?.shares ?? '1') as any, // Use string to ensure consistent schema handling
                      }))
                  form.setValue('paidFor', newPaidFor as any, {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  })
                  if (allSelected) setShareEdits(new Map())
                }}
              >
                {form.getValues().paidFor.length ===
                group.participants.length ? (
                  <>{t('selectNone')}</>
                ) : (
                  <>{t('selectAll')}</>
                )}
              </Button>
            </CardTitle>
            <CardDescription>
              {t(`${sExpense}.paidFor.description`)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="paidFor"
              render={() => (
                <FormItem className="sm:order-4 row-span-2 space-y-0">
                  {group.participants.map(({ id, name }) => (
                    <FormField
                      key={id}
                      control={form.control}
                      name="paidFor"
                      render={({ field }) => {
                        const index = field.value.findIndex(
                          ({ participant }) => participant === id,
                        )
                        const isSelected = index !== -1
                        const row = field.value[index]
                        const cleared = shareEdits.get(id) === 'cleared'
                        const sharesLabel = (
                          <span
                            className={cn('text-sm', {
                              'text-muted': !isSelected,
                            })}
                          >
                            {match(form.getValues().splitMode)
                              .with('BY_SHARES', () => <>{t('shares')}</>)
                              .with('BY_PERCENTAGE', () => <>%</>)
                              .with('BY_AMOUNT', () => <>{group.currency}</>)
                              .otherwise(() => (
                                <></>
                              ))}
                          </span>
                        )
                        return (
                          <div
                            data-id={`${id}/${form.getValues().splitMode}/${
                              group.currency
                            }`}
                            className="flex flex-wrap gap-y-4 items-center border-t last-of-type:border-b last-of-type:!mb-4 -mx-6 px-6 py-3"
                          >
                            <FormItem className="flex-1 flex flex-row items-start space-x-3 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    const options = {
                                      shouldDirty: true,
                                      shouldTouch: true,
                                      shouldValidate: true,
                                    }
                                    checked
                                      ? form.setValue(
                                          'paidFor',
                                          [
                                            ...field.value,
                                            {
                                              participant: id,
                                              shares: '1', // Use string to ensure consistent schema handling
                                            },
                                          ] as any,
                                          options,
                                        )
                                      : form.setValue(
                                          'paidFor',
                                          field.value?.filter(
                                            (value) => value.participant !== id,
                                          ),
                                          options,
                                        )
                                    if (!checked) forgetShareEdit(id)
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="text-sm font-normal flex-1">
                                {name}
                                {isSelected &&
                                  !form.watch('isReimbursement') && (
                                    <span className="text-muted-foreground ml-2">
                                      (
                                      {formatCurrency(
                                        groupCurrency,
                                        calculateShare(id, {
                                          // Id seeds who takes the leftover
                                          // minor unit, so the preview matches
                                          // the saved split.
                                          id: expense?.id ?? expenseId,
                                          amount: amountAsMinorUnits(
                                            calcTotalAmountMajor(
                                              form.watch('paidBy') as any,
                                            ),
                                            groupCurrency,
                                          ),
                                          paidFor: field.value.map(
                                            ({ participant, shares }) => ({
                                              participant: {
                                                id: participant,
                                                name: '',
                                                groupId: '',
                                              },
                                              shares:
                                                form.watch('splitMode') ===
                                                'BY_PERCENTAGE'
                                                  ? Number(shares) * 100
                                                  : form.watch('splitMode') ===
                                                      'BY_AMOUNT'
                                                    ? amountAsMinorUnits(
                                                        shares,
                                                        groupCurrency,
                                                      )
                                                    : shares,
                                              expenseId: '',
                                              participantId: '',
                                            }),
                                          ),
                                          splitMode: form.watch('splitMode'),
                                          isReimbursement:
                                            form.watch('isReimbursement'),
                                        }),
                                        locale,
                                      )}
                                      )
                                    </span>
                                  )}
                              </FormLabel>
                            </FormItem>
                            <div className="flex flex-wrap justify-end gap-y-2">
                              {form.getValues().splitMode === 'BY_AMOUNT' &&
                                !!conversionRequired && (
                                  <FormFieldScope
                                    name={`paidFor.${index}.originalAmount`}
                                  >
                                    <div>
                                      <div className="flex gap-1 items-center">
                                        <span
                                          className={cn('text-sm', {
                                            'text-muted': !isSelected,
                                          })}
                                        >
                                          {originalCurrency.symbol}
                                        </span>
                                        <FormControl>
                                          <Input
                                            key={String(!isSelected)}
                                            className="text-base w-[80px] -my-2"
                                            type="text"
                                            inputMode="decimal"
                                            disabled={!isSelected}
                                            value={
                                              cleared
                                                ? ''
                                                : (row?.originalAmount ?? '')
                                            }
                                            placeholder={
                                              (cleared &&
                                                exchangeRate.data &&
                                                convertToOriginalCurrency(
                                                  Number(row?.shares),
                                                  exchangeRate.data,
                                                  originalCurrency,
                                                )) ||
                                              undefined
                                            }
                                            onChange={(event) => {
                                              const value = limitAmountDecimals(
                                                normalizeNumberInput(
                                                  event.target.value,
                                                  {
                                                    decimalDigits:
                                                      originalCurrency.decimal_digits,
                                                  },
                                                ),
                                                originalCurrency,
                                              )
                                              const originalAmount =
                                                Number(value)
                                              let convertedAmount = ''
                                              if (
                                                value !== '' &&
                                                !Number.isNaN(originalAmount) &&
                                                exchangeRate.data
                                              ) {
                                                convertedAmount =
                                                  convertToGroupCurrency(
                                                    originalAmount,
                                                    exchangeRate.data,
                                                    groupCurrency,
                                                  ) ?? ''
                                              }
                                              field.onChange(
                                                field.value.map((p) =>
                                                  p.participant === id
                                                    ? {
                                                        participant: id,
                                                        originalAmount: value,
                                                        shares:
                                                          limitAmountDecimals(
                                                            normalizeNumberInput(
                                                              convertedAmount,
                                                            ),
                                                            groupCurrency,
                                                          ),
                                                      }
                                                    : p,
                                                ),
                                              )
                                              markShareEdited(id, value === '')
                                            }}
                                            step={
                                              10 **
                                              -originalCurrency.decimal_digits
                                            }
                                          />
                                        </FormControl>
                                        <ChevronRight className="h-4 w-4 mx-1 opacity-50" />
                                      </div>
                                    </div>
                                  </FormFieldScope>
                                )}
                              {form.getValues().splitMode !== 'EVENLY' && (
                                <FormFieldScope
                                  name={`paidFor.${index}.shares`}
                                >
                                  <div>
                                    <div className="flex gap-1 items-center">
                                      {form.getValues().splitMode ===
                                        'BY_AMOUNT' && sharesLabel}
                                      <FormControl>
                                        <Input
                                          key={String(!isSelected)}
                                          className="text-base w-[80px] -my-2"
                                          type="text"
                                          disabled={!isSelected}
                                          value={cleared ? '' : row?.shares}
                                          placeholder={
                                            cleared
                                              ? String(row?.shares ?? '')
                                              : undefined
                                          }
                                          onChange={(event) => {
                                            const splitMode =
                                              form.getValues().splitMode
                                            const shares =
                                              splitMode === 'BY_AMOUNT'
                                                ? limitAmountDecimals(
                                                    normalizeNumberInput(
                                                      event.target.value,
                                                      {
                                                        decimalDigits:
                                                          groupCurrency.decimal_digits,
                                                      },
                                                    ),
                                                    groupCurrency,
                                                  )
                                                : normalizeNumberInput(
                                                    event.target.value,
                                                  )
                                            field.onChange(
                                              field.value.map((p) =>
                                                p.participant === id
                                                  ? { participant: id, shares }
                                                  : p,
                                              ),
                                            )
                                            markShareEdited(id, shares === '')
                                          }}
                                          inputMode={
                                            form.getValues().splitMode ===
                                            'BY_AMOUNT'
                                              ? 'decimal'
                                              : 'numeric'
                                          }
                                          step={
                                            form.getValues().splitMode ===
                                            'BY_AMOUNT'
                                              ? 10 **
                                                -groupCurrency.decimal_digits
                                              : 1
                                          }
                                        />
                                      </FormControl>
                                      {['BY_SHARES', 'BY_PERCENTAGE'].includes(
                                        form.getValues().splitMode,
                                      ) && sharesLabel}
                                    </div>
                                    <FormMessage className="float-right" />
                                  </div>
                                </FormFieldScope>
                              )}
                            </div>
                          </div>
                        )
                      }}
                    />
                  ))}
                  <FormMessage values={splitSumValues} />
                </FormItem>
              )}
            />

            <Collapsible
              className="mt-5"
              defaultOpen={form.getValues().splitMode !== 'EVENLY'}
            >
              <CollapsibleTrigger asChild>
                <Button variant="link" className="-mx-4">
                  {t('advancedOptions')}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid sm:grid-cols-2 gap-6 pt-3">
                  <FormField
                    control={form.control}
                    name="splitMode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('SplitModeField.label')}</FormLabel>
                        <FormControl>
                          <Select
                            onValueChange={(value) => {
                              form.setValue('splitMode', value as any, {
                                shouldDirty: true,
                                shouldTouch: true,
                                shouldValidate: true,
                              })
                              // Validating `splitMode` leaves a "must add up"
                              // error from the previous mode in place, and its
                              // message would now be given the values of the
                              // new mode. Check the shares again for this one.
                              if (form.getFieldState('paidFor').error) {
                                form.clearErrors('paidFor')
                                void form.trigger('paidFor')
                              }
                            }}
                            defaultValue={field.value}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="EVENLY">
                                {t('SplitModeField.evenly')}
                              </SelectItem>
                              <SelectItem value="BY_SHARES">
                                {t('SplitModeField.byShares')}
                              </SelectItem>
                              <SelectItem value="BY_PERCENTAGE">
                                {t('SplitModeField.byPercentage')}
                              </SelectItem>
                              <SelectItem value="BY_AMOUNT">
                                {t('SplitModeField.byAmount')}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>
                          {t(`${sExpense}.splitModeDescription`)}
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="saveDefaultSplittingOptions"
                    render={({ field }) => (
                      <FormItem className="flex flex-row gap-2 items-center space-y-0 pt-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div>
                          <FormLabel>
                            {t('SplitModeField.saveAsDefault')}
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

        {runtimeFeatureFlags.enableExpenseDocuments && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex justify-between">
                <span>{t('attachDocuments')}</span>
              </CardTitle>
              <CardDescription>
                {t(`${sExpense}.attachDescription`)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="documents"
                render={({ field }) => (
                  <ExpenseDocumentsInput
                    documents={field.value}
                    updateDocuments={field.onChange}
                  />
                )}
              />
            </CardContent>
          </Card>
        )}

        <div className="flex mt-4 gap-2">
          <SubmitButton loadingContent={t(isCreate ? 'creating' : 'saving')}>
            <Save className="w-4 h-4 mr-2" />
            {t(isCreate ? 'create' : 'save')}
          </SubmitButton>
          {!isCreate && onDelete && (
            <DeletePopup
              onDelete={() => onDelete(activeUserId ?? undefined)}
            ></DeletePopup>
          )}
          <Button variant="ghost" asChild>
            <Link href={`/groups/${group.id}`}>{t('cancel')}</Link>
          </Button>
        </div>
      </form>
    </Form>
  )
}

function formatDate(date?: Date) {
  if (!date || isNaN(date as any)) date = getTodayForDateInput()
  return date.toISOString().substring(0, 10)
}
