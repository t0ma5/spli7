'use client'
import { ActiveUserBalance } from '@/app/groups/[groupId]/expenses/active-user-balance'
import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import { DocumentsCount } from '@/app/groups/[groupId]/expenses/documents-count'
import { Button } from '@/components/ui/button'
import { Locale } from '@/i18n/request'
import { Currency, getCurrency } from '@/lib/currency'
import type { ExpenseListItem } from '@/lib/kv/types'
import { cn, formatCurrency, formatDateOnly } from '@/lib/utils'
import { ChevronRight, Copy } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Fragment } from 'react'

type Expense = ExpenseListItem

function Participants({
  expense,
  participantCount,
}: {
  expense: Expense
  participantCount: number
}) {
  const t = useTranslations('ExpenseCard')
  const key = expense.amount > 0 ? 'paidBy' : 'receivedBy'
  const paidFor =
    expense.paidFor.length == participantCount && participantCount >= 4 ? (
      <strong>{t('everyone')}</strong>
    ) : (
      expense.paidFor.map((paidFor, index) => (
        <Fragment key={index}>
          {index !== 0 && <>, </>}
          <strong>{paidFor.participant.name}</strong>
        </Fragment>
      ))
    )

  const participants = t.rich(key, {
    strong: (chunks) => <strong>{chunks}</strong>,
    paidBy: expense.paidBy.map((pb) => pb.name).join(', '),
    paidFor: () => paidFor,
    forCount: expense.paidFor.length,
  })
  return <>{participants}</>
}

type Props = {
  expense: Expense
  currency: Currency
  groupId: string
  participantCount: number
}

export function ExpenseCard({
  expense,
  currency,
  groupId,
  participantCount,
}: Props) {
  const router = useRouter()
  const locale = useLocale() as Locale
  const t = useTranslations('ExpenseCard')

  const originalAmount =
    expense.originalAmount != null &&
    expense.originalCurrency &&
    expense.originalCurrency !== currency.code
      ? formatCurrency(
          getCurrency(expense.originalCurrency, locale),
          expense.originalAmount,
          locale,
        )
      : null

  return (
    <div
      key={expense.id}
      className={cn(
        'flex justify-between sm:mx-6 px-4 sm:rounded-lg sm:pr-2 sm:pl-4 py-4 text-sm cursor-pointer hover:bg-accent gap-1 items-stretch',
        expense.isReimbursement && 'italic',
      )}
      onClick={() => {
        router.push(`/groups/${groupId}/expenses/${expense.id}/edit`)
      }}
    >
      <CategoryIcon
        category={expense.category}
        className="w-4 h-4 mr-2 mt-0.5 text-muted-foreground"
      />
      <div className="flex-1">
        <div className={cn('mb-1', expense.isReimbursement && 'italic')}>
          {expense.title}
        </div>
        <div className="text-xs text-muted-foreground">
          <Participants expense={expense} participantCount={participantCount} />
        </div>
        <div className="text-xs text-muted-foreground">
          <ActiveUserBalance {...{ groupId, currency, expense }} />
        </div>
      </div>
      <div className="flex flex-col justify-between items-end">
        <div
          className={cn(
            'tabular-nums whitespace-nowrap',
            expense.isReimbursement ? 'italic' : 'font-bold',
          )}
        >
          {formatCurrency(currency, expense.amount, locale)}
        </div>
        {originalAmount && (
          <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
            {originalAmount}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          <DocumentsCount count={expense._count.documents} />
        </div>
        <div className="text-xs text-muted-foreground">
          {formatDateOnly(expense.expenseDate, locale, { dateStyle: 'medium' })}
        </div>
      </div>
      <div className="self-center hidden sm:flex flex-col gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title={t('copy')}
          onClick={(event) => {
            event.stopPropagation()
            router.push(
              `/groups/${groupId}/expenses/create?fromExpense=${expense.id}`,
            )
          }}
        >
          <Copy className="w-4 h-4" />
        </Button>
        <Button size="icon" variant="link" asChild>
          <Link href={`/groups/${groupId}/expenses/${expense.id}/edit`}>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
