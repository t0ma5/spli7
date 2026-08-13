import { BalanceTimelineExpense, getBalanceTimeline } from './balance-timeline'

const participants = {
  alex: { id: 'alex', name: 'Alex' },
  blair: { id: 'blair', name: 'Blair' },
  casey: { id: 'casey', name: 'Casey' },
}

const categories = {
  payment: { id: 1, grouping: 'Uncategorized', name: 'Payment' },
  rent: { id: 18, grouping: 'Home', name: 'Rent' },
}

type PaidByInput =
  | BalanceTimelineExpense['paidBy']
  | { id: string; name: string; amount?: number }

function asPaidBy(
  paidBy: PaidByInput,
  amount: number,
): BalanceTimelineExpense['paidBy'] {
  if (Array.isArray(paidBy)) return paidBy
  return [{ id: paidBy.id, name: paidBy.name, amount: paidBy.amount ?? amount }]
}

function expense({
  amount,
  category = categories.rent,
  createdAt,
  date,
  isReimbursement = false,
  paidBy = participants.alex,
  paidFor = [
    { participant: participants.alex, shares: 1 },
    { participant: participants.blair, shares: 1 },
  ],
  splitMode = 'EVENLY',
}: {
  amount: number
  category?: BalanceTimelineExpense['category']
  createdAt?: string
  date: string
  isReimbursement?: boolean
  paidBy?: PaidByInput
  paidFor?: BalanceTimelineExpense['paidFor']
  splitMode?: BalanceTimelineExpense['splitMode']
}): BalanceTimelineExpense {
  return {
    amount,
    category,
    createdAt: createdAt ? new Date(createdAt) : undefined,
    expenseDate: new Date(date),
    isReimbursement,
    paidBy: asPaidBy(paidBy, amount),
    paidFor,
    splitMode,
  }
}

describe('getBalanceTimeline', () => {
  it('groups balance changes into sorted daily event points', () => {
    const timeline = getBalanceTimeline(
      [
        expense({ amount: 3000, date: '2026-06-03T00:00:00.000Z' }),
        expense({ amount: 12000, date: '2026-06-01T00:00:00.000Z' }),
        expense({ amount: 6000, date: '2026-06-01T00:00:00.000Z' }),
      ],
      { range: 'all' },
    )

    expect(timeline.points.map((point) => point.key)).toEqual([
      '2026-06-01-start',
      '2026-06-01',
      '2026-06-03',
    ])
    expect(timeline.points[0]).toMatchObject({
      balances: {
        alex: 0,
        blair: 0,
      },
      isStart: true,
    })
    expect(timeline.points[1]?.balances).toMatchObject({
      alex: 9000,
      blair: -9000,
    })
  })

  it('marks reimbursement days and updates balances toward zero', () => {
    const timeline = getBalanceTimeline(
      [
        expense({ amount: 12000, date: '2026-06-01T00:00:00.000Z' }),
        expense({
          amount: 4000,
          category: categories.payment,
          date: '2026-06-15T00:00:00.000Z',
          isReimbursement: true,
          paidBy: participants.blair,
          paidFor: [{ participant: participants.alex, shares: 1 }],
        }),
      ],
      { range: 'all' },
    )

    expect(timeline.points[2]).toMatchObject({
      hasRepayment: true,
      balances: {
        alex: 2000,
        blair: -2000,
      },
      deltas: {
        alex: -4000,
        blair: 4000,
      },
      events: [
        {
          isReimbursement: true,
          paidBy: [{ ...participants.blair, amount: 4000 }],
          paidFor: [participants.alex],
        },
      ],
    })
  })

  it('uses UTC date parts for day grouping', () => {
    const timeline = getBalanceTimeline(
      [expense({ amount: 12000, date: '2026-06-01T00:00:00.000Z' })],
      { range: 'all' },
    )

    expect(timeline.points[1]).toMatchObject({
      key: '2026-06-01',
      year: 2026,
      month: 5,
      day: 1,
    })
  })

  it('filters visible event days by range while preserving opening balances', () => {
    const timeline = getBalanceTimeline(
      [
        expense({ amount: 12000, date: '2026-01-15T00:00:00.000Z' }),
        expense({
          amount: 2000,
          date: '2026-06-15T00:00:00.000Z',
          isReimbursement: true,
          paidBy: participants.blair,
          paidFor: [{ participant: participants.alex, shares: 1 }],
        }),
      ],
      { range: '3' },
    )

    expect(timeline.points.map((point) => point.key)).toEqual([
      '2026-04-01-start',
      '2026-06-15',
    ])
    expect(timeline.points[0]?.balances).toMatchObject({
      alex: 6000,
      blair: -6000,
    })
    expect(timeline.points[1]?.balances).toMatchObject({
      alex: 4000,
      blair: -4000,
    })
  })

  it('returns participants present on the timeline without unused summary fields', () => {
    const timeline = getBalanceTimeline(
      [
        expense({
          amount: 9000,
          date: '2026-06-01T00:00:00.000Z',
          paidFor: [
            { participant: participants.alex, shares: 1 },
            { participant: participants.blair, shares: 1 },
            { participant: participants.casey, shares: 1 },
          ],
        }),
        expense({
          amount: 3000,
          category: categories.payment,
          date: '2026-06-10T00:00:00.000Z',
          isReimbursement: true,
          paidBy: participants.blair,
          paidFor: [{ participant: participants.alex, shares: 1 }],
        }),
      ],
      { range: 'all' },
    )

    expect(
      timeline.participants.map((participant) => participant.id).sort(),
    ).toEqual(['alex', 'blair', 'casey'])
    expect(timeline.points.at(-1)?.balances).toMatchObject({
      alex: 3000,
      blair: 0,
      casey: -3000,
    })
  })

  it('attributes paid amounts across multiple payers', () => {
    const timeline = getBalanceTimeline(
      [
        expense({
          amount: 10000,
          date: '2026-06-01T00:00:00.000Z',
          paidBy: [
            { ...participants.alex, amount: 6000 },
            { ...participants.blair, amount: 4000 },
          ],
          paidFor: [
            { participant: participants.alex, shares: 1 },
            { participant: participants.blair, shares: 1 },
          ],
        }),
      ],
      { range: 'all' },
    )

    expect(timeline.points[1]?.balances).toMatchObject({
      alex: 1000,
      blair: -1000,
    })
  })
})
