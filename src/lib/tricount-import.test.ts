/**
 * @jest-environment-options {"tz": "Europe/Helsinki"}
 */
// East of UTC on purpose: reading a local-midnight date back with getUTC*
// moved every imported expense to the previous day here.
import { parseSplitwiseCsv } from '@/lib/splitwise-import'
import { parseTricountCsv } from '@/lib/tricount-import'

// nanoid ships ESM only, which this jest setup does not transform.
jest.mock('./randomId', () => {
  let next = 0
  return { randomId: () => `id${next++}` }
})

const HEADER =
  'Title,Amount,Currency,Exchange rate,Amount in default currency (EUR),Category,Paid by,Date & time,Paid by Alice,Paid by Bob,Paid by Carol,Impacted to Alice,Impacted to Bob,Impacted to Carol'

function csv(...rows: string[]) {
  return [HEADER, ...rows].join('\n')
}

async function parse(...rows: string[]) {
  const group = await parseTricountCsv(csv(...rows))
  const name = (id: string) => group.participants.find((p) => p.id === id)?.name
  return {
    group,
    expenses: group.expenses.map((e) => ({
      title: e.title,
      date: e.expenseDate,
      amount: e.amount,
      paidBy: e.paidBy.map((p) => [name(p.participantId), p.amount]),
      paidFor: e.paidFor.map((p) => [name(p.participantId), p.shares]),
    })),
  }
}

describe('parseTricountCsv', () => {
  it('runs in an east-of-UTC timezone', () => {
    expect(new Date(2024, 0, 1).getTimezoneOffset()).toBe(-120)
  })

  it('keeps the calendar day of the export whatever the server timezone', async () => {
    const { expenses } = await parse(
      'Dinner,30.00,EUR,1,30.00,,Alice,2024-03-15 00:30:00,30.00,,,-10.00,-10.00,-10.00',
    )
    expect(expenses[0].date).toBe('2024-03-15T00:00:00.000Z')
  })

  it('keeps everyone’s share on a refund row', async () => {
    const { expenses } = await parse(
      'Refund,-20.00,EUR,1,-20.00,,Alice,2024-03-16 12:00:00,-20.00,,,10.00,10.00,',
    )
    expect(expenses).toEqual([
      {
        title: 'Refund',
        date: '2024-03-16T00:00:00.000Z',
        amount: -2000,
        paidBy: [['Alice', -2000]],
        paidFor: [
          ['Alice', 1000],
          ['Bob', 1000],
        ],
      },
    ])
  })

  it('spreads one-unit rounding over the largest shares, not the last one', async () => {
    // 10.00 split three ways: Tricount writes 3.33 each, one cent short.
    const { expenses } = await parse(
      'Taxi,10.00,EUR,1,10.00,,Alice,2024-03-15 10:00:00,10.00,,,-3.33,-3.33,-3.33',
      'Tea,10.00,EUR,1,10.00,,Bob,2024-03-15 10:00:00,,10.00,,-3.32,-3.34,-3.33',
    )
    expect(expenses[0].paidFor).toEqual([
      ['Alice', 334],
      ['Bob', 333],
      ['Carol', 333],
    ])
    expect(expenses[1].paidFor).toEqual([
      ['Alice', 332],
      ['Bob', 335],
      ['Carol', 333],
    ])
  })

  it('rejects a row whose columns are off by more than rounding', async () => {
    await expect(
      parse(
        'Taxi,10.00,EUR,1,10.00,,Alice,2024-03-15 10:00:00,10.00,,,-3.00,-3.00,-3.00',
      ),
    ).rejects.toThrow(/Row 2 \("Taxi"\): .*do not add up/)
  })

  it('trims the "Paid by" name before looking it up', async () => {
    const header =
      'Title,Amount,Currency,Category,Paid by,Date & time,Impacted to Alice,Impacted to Bob'
    const group = await parseTricountCsv(
      [header, 'Lunch,8.00,EUR,,  Bob ,2024-03-15 10:00:00,-4.00,-4.00'].join(
        '\n',
      ),
    )
    const bob = group.participants.find((p) => p.name === 'Bob')!
    expect(group.expenses[0].paidBy).toEqual([
      expect.objectContaining({ participantId: bob.id, amount: 800 }),
    ])
  })

  it('fails naming the row instead of skipping or inventing data', async () => {
    const header =
      'Title,Amount,Currency,Category,Paid by,Date & time,Impacted to Alice,Impacted to Bob'
    const rows = [
      header,
      'Ok,8.00,EUR,,Alice,2024-03-15 10:00:00,-4.00,-4.00',
      'Ghost,8.00,EUR,,Zoe,2024-03-15 10:00:00,-4.00,-4.00',
      'Undated,8.00,EUR,,Alice,yesterday,-4.00,-4.00',
      'Short,8.00,EUR',
      '',
    ]
    const error = await parseTricountCsv(rows.join('\n')).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain('Row 3 ("Ghost"): unknown payer "Zoe"')
    expect(message).toContain('Row 4 ("Undated"): invalid date "yesterday"')
    expect(message).toContain('Row 5 ("Short"): has 3 cells')
    expect(message).not.toContain('Row 2')
    expect(message).not.toContain('Row 6')
  })
})

describe('parseSplitwiseCsv', () => {
  it('keeps the calendar day of the export whatever the server timezone', () => {
    const group = parseSplitwiseCsv(
      [
        'Date,Description,Category,Cost,Currency,Alice,Bob',
        '2025-11-15,A,General,10.00,EUR,5.00,-5.00',
      ].join('\n'),
    )
    expect(group.expenses[0].expenseDate).toBe('2025-11-15T00:00:00.000Z')
  })

  it('rejects an export that mixes currencies, naming them', () => {
    expect(() =>
      parseSplitwiseCsv(
        [
          'Date,Description,Category,Cost,Currency,Alice,Bob',
          '2025-11-15,A,General,10.00,EUR,5.00,-5.00',
          '2025-11-16,B,General,100.00,USD,50.00,-50.00',
          '2025-11-17,C,General,1000,JPY,500,-500',
        ].join('\n'),
      ),
    ).toThrow(/row 3: .*several currencies \(EUR, USD, JPY\)/)
  })
})
