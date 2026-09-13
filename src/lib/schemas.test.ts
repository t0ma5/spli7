import {
  EXPENSE_NOTES_MAX,
  GROUP_INFORMATION_MAX,
  expenseFormSchema,
  groupFormSchema,
  groupImportSchema,
} from './schemas'

function groupForm(information?: string) {
  return {
    name: 'Trip',
    information,
    currency: '$',
    currencyCode: 'USD',
    defaultSplitMode: 'EVENLY' as const,
    fixedExpenseDateGroups: false,
    participants: [{ name: 'Ada' }],
  }
}

function expenseForm(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    expenseDate: new Date('2026-01-01'),
    title: 'Dinner',
    category: 0,
    paidBy: [{ participant: 'ada', amount: 1000 }],
    paidFor: [{ participant: 'ada', shares: 1 }],
    splitMode: 'EVENLY',
    saveDefaultSplittingOptions: false,
    isReimbursement: false,
    documents: [],
    recurrenceRule: 'NONE',
    ...overrides,
  }
}

describe('form input caps', () => {
  it('accepts group information up to 10000 characters and rejects more', () => {
    expect(
      groupFormSchema.safeParse(groupForm('x'.repeat(GROUP_INFORMATION_MAX)))
        .success,
    ).toBe(true)

    const over = groupFormSchema.safeParse(
      groupForm('x'.repeat(GROUP_INFORMATION_MAX + 1)),
    )
    expect(over.success).toBe(false)
    if (!over.success) {
      expect(over.error.issues[0]?.message).toBe('max10000')
    }
  })

  it('accepts expense notes up to 5000 characters and rejects more', () => {
    expect(
      expenseFormSchema.safeParse(
        expenseForm({ notes: 'n'.repeat(EXPENSE_NOTES_MAX) }),
      ).success,
    ).toBe(true)

    const over = expenseFormSchema.safeParse(
      expenseForm({ notes: 'n'.repeat(EXPENSE_NOTES_MAX + 1) }),
    )
    expect(over.success).toBe(false)
    if (!over.success) {
      expect(over.error.issues[0]?.message).toBe('max5000')
    }
  })

  it('does not cap document pixel dimensions used for layout', () => {
    const parsed = expenseFormSchema.safeParse(
      expenseForm({
        documents: [
          {
            id: 'doc1',
            url: 'https://example.com/pano.jpg',
            width: 16000,
            height: 4000,
          },
        ],
      }),
    )
    expect(parsed.success).toBe(true)
  })

  it('keeps import information and notes aligned with the form caps', () => {
    const parsed = groupImportSchema.safeParse({
      name: 'Trip',
      information: 'i'.repeat(GROUP_INFORMATION_MAX),
      currency: '$',
      currencyCode: '',
      participants: [{ id: 'ada', name: 'Ada' }],
      expenses: [
        {
          createdAt: new Date('2026-01-01'),
          expenseDate: new Date('2026-01-01'),
          title: 'Dinner',
          amount: 1000,
          paidById: 'ada',
          paidFor: [{ participantId: 'ada', shares: 1 }],
          isReimbursement: false,
          splitMode: 'EVENLY',
          notes: 'n'.repeat(EXPENSE_NOTES_MAX),
          documents: [
            {
              url: 'https://example.com/pano.jpg',
              width: 16000,
              height: 4000,
            },
          ],
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })
})

function byAmountExpense(amount: number, shares: string[]) {
  return expenseForm({
    paidBy: [{ participant: 'a', amount }],
    paidFor: shares.map((share, i) => ({
      participant: `p${i}`,
      shares: share,
    })),
    splitMode: 'BY_AMOUNT',
  })
}

function issueMessages(input: unknown): string[] {
  const result = expenseFormSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((i) => i.message)
}

describe('expenseFormSchema, split by amount', () => {
  it('accepts amounts that add up to the expense amount', () => {
    expect(
      issueMessages(
        byAmountExpense(524.34, [
          '110.11',
          '209.74',
          '104.87',
          '89.14',
          '10.48',
        ]),
      ),
    ).toEqual([])
  })

  it('rejects amounts one cent off', () => {
    expect(
      issueMessages(
        byAmountExpense(524.34, [
          '110.11',
          '209.74',
          '104.87',
          '89.14',
          '10.49',
        ]),
      ),
    ).toEqual(['amountSum'])
  })

  it('sums amounts typed with a decimal comma', () => {
    expect(issueMessages(byAmountExpense(100, ['50', '30', '20,00']))).toEqual(
      [],
    )
  })

  it('reports an emptied amount instead of throwing on it', () => {
    expect(issueMessages(byAmountExpense(100, ['60', '']))).toEqual([
      'noZeroShares',
      'amountSum',
    ])
  })
})
