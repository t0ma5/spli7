import { getGroupForExport } from '@/lib/api'
import { getCurrency } from '@/lib/currency'
import { formatAmountAsDecimal, getCurrencyFromGroup } from '@/lib/utils'
import { Parser } from '@json2csv/plainjs'
import contentDisposition from 'content-disposition'
import { NextResponse } from 'next/server'

const splitModeLabel = {
  EVENLY: 'Evenly',
  BY_SHARES: 'Unevenly – By shares',
  BY_PERCENTAGE: 'Unevenly – By percentage',
  BY_AMOUNT: 'Unevenly – By amount',
}

function formatDate(isoDateString: Date): string {
  const date = new Date(isoDateString)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params
  const group = await getGroupForExport(groupId)

  if (!group) {
    return NextResponse.json({ error: 'Invalid group ID' }, { status: 404 })
  }

  const fields = [
    { label: 'Date', value: 'date' },
    { label: 'Description', value: 'title' },
    { label: 'Category', value: 'categoryName' },
    { label: 'Currency', value: 'currency' },
    { label: 'Cost', value: 'amount' },
    { label: 'Original cost', value: 'originalAmount' },
    { label: 'Original currency', value: 'originalCurrency' },
    { label: 'Conversion rate', value: 'conversionRate' },
    { label: 'Is Reimbursement', value: 'isReimbursement' },
    { label: 'Split mode', value: 'splitMode' },
    ...group.participants.map((participant) => ({
      label: participant.name,
      value: participant.name,
    })),
  ]

  const currency = getCurrencyFromGroup(group)

  const expenses = group.expenses.map((expense) => ({
    date: formatDate(expense.expenseDate),
    title: expense.title,
    categoryName: expense.category?.name || '',
    currency: group.currencyCode ?? group.currency,
    amount: formatAmountAsDecimal(expense.amount, currency),
    originalAmount: expense.originalAmount
      ? formatAmountAsDecimal(
          expense.originalAmount,
          getCurrency(expense.originalCurrency),
        )
      : null,
    originalCurrency: expense.originalCurrency,
    conversionRate:
      expense.conversionRate !== null && expense.conversionRate !== undefined
        ? String(expense.conversionRate)
        : null,
    isReimbursement: expense.isReimbursement ? 'Yes' : 'No',
    splitMode: splitModeLabel[expense.splitMode],
    ...Object.fromEntries(
      group.participants.map((participant) => {
        const { totalShares, participantShare } = expense.paidFor.reduce(
          (acc, { participantId, shares }) => {
            acc.totalShares += shares
            if (participantId === participant.id) {
              acc.participantShare = shares
            }
            return acc
          },
          { totalShares: 0, participantShare: 0 },
        )

        const isPaidByParticipant = expense.paidById === participant.id
        const participantAmountShare = +formatAmountAsDecimal(
          totalShares === 0
            ? 0
            : (expense.amount / totalShares) * participantShare,
          currency,
        )

        return [
          participant.name,
          participantAmountShare * (isPaidByParticipant ? 1 : -1),
        ]
      }),
    ),
  }))

  const json2csvParser = new Parser({ fields })
  const csv = json2csvParser.parse(expenses)

  const date = new Date().toISOString().split('T')[0]
  const filename = `Spliit Export - ${group.name} - ${date}.csv`

  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(filename),
    },
  })
}
