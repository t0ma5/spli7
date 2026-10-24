import { groupImportSchema } from './schemas'

type Expense = Record<string, unknown>

function exportedGroup(
  expenses: Expense[],
  participants = [
    { id: 'a', name: 'Ada' },
    { id: 'b', name: 'Bob' },
  ],
) {
  // Shaped like getGroupForExport after a JSON round trip.
  return JSON.parse(
    JSON.stringify({
      exportVersion: 3,
      id: 'g',
      name: 'Trip',
      information: null,
      currency: '€',
      currencyCode: 'EUR',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants,
      expenses,
      activities: [],
    }),
  )
}

function expense(overrides: Expense = {}): Expense {
  return {
    id: 'e',
    createdAt: new Date('2026-01-01T10:00:00Z'),
    expenseDate: new Date('2026-01-01T00:00:00Z'),
    title: 'Dinner',
    category: { id: 0, grouping: 'Uncategorized', name: 'General' },
    amount: 1000,
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    paidBy: [{ participantId: 'a', amount: 1000 }],
    paidFor: [
      { participantId: 'a', shares: 100 },
      { participantId: 'b', shares: 100 },
    ],
    isReimbursement: false,
    splitMode: 'EVENLY',
    recurrenceRule: 'NONE',
    notes: null,
    documents: [],
    ...overrides,
  }
}

function issues(data: unknown) {
  const result = groupImportSchema.safeParse(data)
  return result.success
    ? []
    : result.error.issues.map((i) => `${i.path.join('.')}:${i.message}`)
}

describe('groupImportSchema', () => {
  it('accepts an export', () => {
    expect(
      issues(
        exportedGroup([
          expense(),
          expense({
            amount: 1000,
            paidBy: [
              { participantId: 'a', amount: 600 },
              { participantId: 'b', amount: 400 },
            ],
            splitMode: 'BY_AMOUNT',
            paidFor: [
              { participantId: 'a', shares: 300 },
              { participantId: 'b', shares: 700 },
            ],
          }),
          // Income stored by earlier Tricount imports: negative BY_AMOUNT shares.
          expense({
            amount: -2000,
            paidBy: [{ participantId: 'a', amount: -2000 }],
            splitMode: 'BY_AMOUNT',
            paidFor: [{ participantId: 'a', shares: -2000 }],
          }),
        ]),
      ),
    ).toEqual([])
  })

  it('accepts the legacy paidById shape', () => {
    expect(
      issues(exportedGroup([expense({ paidBy: undefined, paidById: 'b' })])),
    ).toEqual([])
  })

  it('requires paidBy to add up to the amount', () => {
    expect(
      issues(
        exportedGroup([
          expense({ paidBy: [{ participantId: 'a', amount: 999 }] }),
        ]),
      ),
    ).toEqual(['expenses.0.paidBy:paidBySum'])
  })

  it.each([
    ['zero', [0, 100]],
    ['negative', [500, -500]],
    ['fractional', [1.5, 1]],
    ['mixed sign on income', [-500, 500]],
  ])('rejects %s shares', (_, [first, second]) => {
    const result = issues(
      exportedGroup([
        expense({
          amount: -1000,
          paidBy: [{ participantId: 'a', amount: -1000 }],
          splitMode: 'BY_AMOUNT',
          paidFor: [
            { participantId: 'a', shares: first },
            { participantId: 'b', shares: second },
          ],
        }),
      ]),
    )
    expect(result.length).toBeGreaterThan(0)
  })

  it('bounds the amount like the expense form', () => {
    const big = 10_000_000_01
    expect(
      issues(
        exportedGroup([
          expense({
            amount: big,
            paidBy: [{ participantId: 'a', amount: big }],
          }),
        ]),
      ),
    ).toEqual(expect.arrayContaining(['expenses.0.amount:amountTenMillion']))
  })

  it('rejects duplicate participant ids and names', () => {
    expect(
      issues(
        exportedGroup(
          [],
          [
            { id: 'a', name: 'Ada' },
            { id: 'a', name: 'Bob' },
            { id: 'c', name: 'Ada' },
          ],
        ),
      ),
    ).toEqual([
      'participants.1.id:duplicateParticipantId',
      'participants.2.name:duplicateParticipantName',
    ])
  })

  it('rejects a participant listed twice in one expense', () => {
    expect(
      issues(
        exportedGroup([
          expense({
            paidBy: [
              { participantId: 'a', amount: 500 },
              { participantId: 'a', amount: 500 },
            ],
            paidFor: [
              { participantId: 'b', shares: 100 },
              { participantId: 'b', shares: 100 },
            ],
          }),
        ]),
      ),
    ).toEqual([
      'expenses.0.paidBy.1.participantId:duplicatePaidBy',
      'expenses.0.paidFor.1.participantId:duplicatePaidFor',
    ])
  })

  it('bounds paidBy and paidFor like the expense form', () => {
    const result = groupImportSchema.safeParse(
      exportedGroup([
        expense({
          paidBy: Array.from({ length: 101 }, () => ({
            participantId: 'a',
            amount: 0,
          })),
          paidFor: Array.from({ length: 501 }, () => ({
            participantId: 'a',
            shares: 1,
          })),
        }),
      ]),
    )
    const tooBig = result.success
      ? []
      : result.error.issues
          .filter((i) => i.code === 'too_big')
          .map((i) => i.path.join('.'))
    expect(tooBig).toEqual(['expenses.0.paidBy', 'expenses.0.paidFor'])
  })
})
