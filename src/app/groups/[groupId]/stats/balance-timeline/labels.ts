import { formatChartCurrency } from '@/lib/chart-currency'
import { formatCurrency } from '@/lib/utils'

type ChartCurrency = Parameters<typeof formatCurrency>[0]

type TimelineCategory = {
  grouping: string
  name: string
} | null

type TimelineEvent = {
  amount: number
  category: TimelineCategory
  isReimbursement: boolean
  paidBy: { id: string; name: string; amount: number }[]
  paidFor: { id: string; name: string }[]
  title?: string
}

type Translate = (key: string, values?: Record<string, string>) => string

export function formatParticipantBalance({
  amount,
  currency,
  includeCurrently,
  locale,
  participantName,
  roundAmounts,
  t,
}: {
  amount: number
  currency: ChartCurrency
  includeCurrently: boolean
  locale: string
  participantName: string
  roundAmounts: boolean
  t: Translate
}) {
  const formattedAmount = formatChartCurrency({
    amount: Math.abs(amount),
    currency,
    locale,
    roundAmounts,
  })
  const values = { name: participantName, amount: formattedAmount }

  if (amount < 0) {
    return t(
      includeCurrently ? 'participantOwesCurrently' : 'participantOwes',
      values,
    )
  }
  if (amount > 0) {
    return t(
      includeCurrently ? 'participantIsOwedCurrently' : 'participantIsOwed',
      values,
    )
  }

  return t(
    includeCurrently ? 'participantSettledCurrently' : 'participantSettled',
    values,
  )
}

export function getPaymentEventLabel({
  currency,
  event,
  locale,
  roundAmounts,
  t,
}: {
  currency: ChartCurrency
  event: TimelineEvent
  locale: string
  roundAmounts: boolean
  t: Translate
}) {
  const paidForNames = event.paidFor
    .map((participant) => participant.name)
    .join(', ')
  const paidByNames = event.paidBy.map((pb) => pb.name).join(', ')

  return t('paymentEvent', {
    paidBy: paidByNames,
    paidFor: paidForNames,
    amount: formatChartCurrency({
      amount: Math.abs(event.amount),
      currency,
      locale,
      roundAmounts,
    }),
  })
}

export function getExpenseEventLabel({
  currency,
  event,
  locale,
  roundAmounts,
  t,
  tCategories,
}: {
  currency: ChartCurrency
  event: TimelineEvent
  locale: string
  roundAmounts: boolean
  t: Translate
  tCategories: (key: string) => string
}) {
  const categoryLabel = event.category
    ? tCategories(`${event.category.grouping}.${event.category.name}`)
    : t('expenseFallback')
  const eventLabel = event.title
    ? `${event.title} (${categoryLabel})`
    : categoryLabel
  const paidByNames = event.paidBy.map((pb) => pb.name).join(', ')

  return t('expenseEvent', {
    event: eventLabel,
    paidBy: paidByNames,
    amount: formatChartCurrency({
      amount: Math.abs(event.amount),
      currency,
      locale,
      roundAmounts,
    }),
  })
}
