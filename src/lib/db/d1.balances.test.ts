/**
 * @jest-environment node
 */
// Runs the real Turso SQL (migrations + d1 repository) on node:sqlite, so the
// balance ledger is checked against the in-memory getBalances oracle.
import type { SqlDatabase, SqlStatement } from '@/lib/db/sql'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// node:sqlite ships with Node 22+; @types/node here predates it.
type DatabaseSync = {
  readonly isTransaction: boolean
  exec(sql: string): void
  prepare(sql: string): {
    get(...args: unknown[]): unknown
    all(...args: unknown[]): unknown[]
    run(...args: unknown[]): { changes: number | bigint }
  }
  close(): void
}
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSync
}

let sqlite: DatabaseSync

function sqliteDatabase(): SqlDatabase {
  const statement = (sql: string, args: unknown[] = []): SqlStatement => {
    const values = args.map((value) => (value === undefined ? null : value))
    const prepared = () => sqlite.prepare(sql)
    return {
      sql,
      args: values as SqlStatement['args'],
      bind: (...next) => statement(sql, next),
      first: async <T>() => (prepared().get(...values) as T) ?? null,
      all: async <T>() => ({ results: prepared().all(...values) as T[] }),
      run: async () => ({
        meta: { changes: Number(prepared().run(...values).changes) },
      }),
    }
  }
  const atomically = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (sqlite.isTransaction) return fn()
    sqlite.exec('BEGIN')
    try {
      const result = await fn()
      sqlite.exec('COMMIT')
      return result
    } catch (error) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  }
  const db: SqlDatabase = {
    prepare: (sql) => statement(sql),
    batch: (stmts) =>
      atomically(async () => {
        for (const stmt of stmts) await stmt.run()
        return []
      }),
    transaction: (fn) => atomically(() => fn(db)),
  }
  return db
}

jest.mock('nanoid', () => {
  let n = 0
  return { nanoid: () => `id${++n}` }
})

jest.mock('./client', () => ({
  getD1: async () => sqliteDatabase(),
}))

import {
  createExpense,
  createGroup,
  deleteExpense,
  getGroupBalances,
  getGroupExpenses,
  updateExpense,
} from '@/lib/api'
import { getBalances } from '@/lib/balances'
import { d1Repository } from '@/lib/db/d1'
import type { ExpenseFormValues } from '@/lib/schemas'

function migrate() {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  const dir = join(process.cwd(), 'migrations')
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(join(dir, name), 'utf8'))
  }
}

async function oracle(groupId: string) {
  return getBalances(await getGroupExpenses(groupId))
}

function expenseForm(
  overrides: Partial<ExpenseFormValues> &
    Pick<ExpenseFormValues, 'amount' | 'paidBy' | 'paidFor'>,
): ExpenseFormValues {
  return {
    expenseDate: new Date('2026-01-01'),
    title: 'Expense',
    category: 0,
    splitMode: 'EVENLY',
    saveDefaultSplittingOptions: false,
    isReimbursement: false,
    documents: [],
    recurrenceRule: 'NONE',
    ...overrides,
  } as ExpenseFormValues
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('balance ledger on the Turso schema', () => {
  beforeEach(migrate)
  afterEach(() => sqlite.close())

  async function seed() {
    const group = await createGroup({
      name: 'Trip',
      currency: '$',
      currencyCode: 'USD',
      defaultSplitMode: 'EVENLY',
      fixedExpenseDateGroups: false,
      participants: [{ name: 'Ada' }, { name: 'Bob' }, { name: 'Cy' }],
    })
    const [a, b, c] = group.participants.map((p) => p.id)
    // 1000 over three leaves a remainder cent for the largest-remainder rule.
    const dinner = await createExpense(
      expenseForm({
        amount: 1000,
        paidBy: [{ participant: a, amount: 1000 }],
        paidFor: [
          { participant: a, shares: 1 },
          { participant: b, shares: 1 },
          { participant: c, shares: 1 },
        ],
      }),
      group.id,
    )
    await createExpense(
      expenseForm({
        amount: 777,
        splitMode: 'BY_SHARES',
        paidBy: [
          { participant: b, amount: 500 },
          { participant: c, amount: 277 },
        ],
        paidFor: [
          { participant: a, shares: 1 },
          { participant: b, shares: 2 },
        ],
      }),
      group.id,
    )
    const taxi = await createExpense(
      expenseForm({
        amount: 1001,
        splitMode: 'BY_AMOUNT',
        paidBy: [{ participant: c, amount: 1001 }],
        paidFor: [
          { participant: a, shares: 600 },
          { participant: c, shares: 401 },
        ],
      }),
      group.id,
    )
    return { group, a, b, c, dinner, taxi }
  }

  it('matches getBalances through creates, updates and deletes', async () => {
    const { group, a, b, c, dinner, taxi } = await seed()
    // New writes keep the ledger ready, so reads never take the fallback.
    expect(await d1Repository.getBalances(group.id)).not.toBeNull()
    expect(await getGroupBalances(group.id)).toEqual(await oracle(group.id))

    await updateExpense(
      group.id,
      dinner.id,
      expenseForm({
        amount: 1333,
        paidBy: [{ participant: b, amount: 1333 }],
        paidFor: [
          { participant: b, shares: 1 },
          { participant: c, shares: 1 },
        ],
      }),
    )
    expect(await getGroupBalances(group.id)).toEqual(await oracle(group.id))

    await deleteExpense(group.id, taxi.id)
    const balances = await getGroupBalances(group.id)
    expect(balances).toEqual(await oracle(group.id))
    expect(balances[a].total + balances[b].total + balances[c].total).toBe(0)

    // The read is one row per participant, not one per expense.
    const rows = sqlite
      .prepare(
        'SELECT COUNT(*) AS n FROM participant_balances WHERE group_id = ?',
      )
      .get(group.id) as { n: number }
    expect(rows.n).toBe(3)
  })

  it('falls back for a pre-ledger group, then fills it after the response', async () => {
    const { group } = await seed()
    const expected = await oracle(group.id)
    sqlite.exec('UPDATE expense_paid_for SET owed = NULL')
    sqlite.exec('DELETE FROM participant_balances')
    sqlite.exec('UPDATE groups SET balances_ready = 0')

    expect(await d1Repository.getBalances(group.id)).toBeNull()
    expect(await getGroupBalances(group.id)).toEqual(expected)
    await flush()

    const ready = sqlite
      .prepare('SELECT balances_ready AS r FROM groups WHERE id = ?')
      .get(group.id) as { r: number }
    expect(ready.r).toBe(1)
    expect(await d1Repository.getBalances(group.id)).not.toBeNull()
    expect(await getGroupBalances(group.id)).toEqual(expected)
  })

  it('does not fill from amounts computed before a concurrent write', async () => {
    const { group } = await seed()
    sqlite.exec('UPDATE expense_paid_for SET owed = NULL')
    sqlite.exec('UPDATE groups SET balances_ready = 0')
    const { version } = sqlite
      .prepare('SELECT version FROM groups WHERE id = ?')
      .get(group.id) as { version: number }

    expect(await d1Repository.fillBalances(group.id, version - 1, [])).toBe(
      false,
    )
    const stillNull = sqlite
      .prepare('SELECT COUNT(*) AS n FROM expense_paid_for WHERE owed IS NULL')
      .get() as { n: number }
    expect(stillNull.n).toBeGreaterThan(0)
  })

  it('returns no balances for a deleted group', async () => {
    const { group } = await seed()
    sqlite
      .prepare('UPDATE groups SET deleted_at = ? WHERE id = ?')
      .run(new Date().toISOString(), group.id)
    expect(await getGroupBalances(group.id)).toEqual({})
  })
})
