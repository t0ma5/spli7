import {
  activityIsAfterCursor,
  decodeActivityCursor,
  decodeExpenseCursor,
  encodeActivityCursor,
  encodeExpenseCursor,
  expenseIsAfterCursor,
} from '@/lib/db/list-cursor'

describe('list cursors', () => {
  it('round-trips expense and activity cursors', () => {
    const expense = {
      expenseDate: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-02T12:00:00.000Z',
      id: 'exp1',
    }
    expect(decodeExpenseCursor(encodeExpenseCursor(expense))).toEqual(expense)

    const activity = { time: '2026-01-02T12:00:00.000Z', id: 'act1' }
    expect(decodeActivityCursor(encodeActivityCursor(activity))).toEqual(
      activity,
    )
  })

  it('orders the next page after the cursor in DESC date order', () => {
    const after = {
      expenseDate: '2026-01-03T00:00:00.000Z',
      createdAt: '2026-01-03T00:00:00.000Z',
      id: 'b',
    }
    expect(
      expenseIsAfterCursor(
        {
          expenseDate: '2026-01-02T00:00:00.000Z',
          createdAt: '2026-01-02T00:00:00.000Z',
          id: 'a',
        },
        after,
      ),
    ).toBe(true)
    expect(
      expenseIsAfterCursor(
        {
          expenseDate: '2026-01-04T00:00:00.000Z',
          createdAt: '2026-01-04T00:00:00.000Z',
          id: 'c',
        },
        after,
      ),
    ).toBe(false)
    expect(
      activityIsAfterCursor(
        { time: '2026-01-01T00:00:00.000Z', id: 'x' },
        { time: '2026-01-02T00:00:00.000Z', id: 'y' },
      ),
    ).toBe(true)
  })
})
