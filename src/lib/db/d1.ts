import { getD1 } from '@/lib/db/client'
import type {
  GroupRepository,
  GroupSummary,
  PinAttemptState,
  WriteResult,
} from '@/lib/db/repository'
import {
  type Activity,
  ActivityType,
  type Expense,
  type ExpenseDocument,
  type ExpensePaidBy,
  type ExpensePaidFor,
  getExpensePaidBy,
  type GroupDocument,
  RecurrenceRule,
  type RecurringExpenseLink,
  SplitMode,
} from '@/lib/kv/types'

type GroupRow = {
  id: string
  name: string
  information: string | null
  currency: string
  currency_code: string | null
  pin_hash: string | null
  default_split_mode: string
  fixed_expense_date_groups: number
  version: number
  created_at: string
  last_activity_at: string | null
  last_seen_at: string | null
  deleted_at: string | null
}

type ParticipantRow = {
  id: string
  group_id: string
  name: string
  sort_order: number
}

type ExpenseRow = {
  id: string
  group_id: string
  expense_date: string
  title: string
  category_id: number
  amount: number
  original_amount: number | null
  original_currency: string | null
  conversion_rate: number | null
  is_reimbursement: number
  split_mode: string
  created_at: string
  notes: string | null
  recurrence_rule: string | null
}

function bool01(value: boolean | null | undefined): number {
  return value ? 1 : 0
}

async function loadGroup(
  db: D1Database,
  id: string,
): Promise<GroupDocument | null> {
  const group = await db
    .prepare('SELECT * FROM groups WHERE id = ?')
    .bind(id)
    .first<GroupRow>()
  if (!group) return null

  const { results: participantRows } = await db
    .prepare(
      'SELECT * FROM participants WHERE group_id = ? ORDER BY sort_order ASC, name ASC',
    )
    .bind(id)
    .all<ParticipantRow>()

  const { results: expenseRows } = await db
    .prepare('SELECT * FROM expenses WHERE group_id = ?')
    .bind(id)
    .all<ExpenseRow>()

  const paidByByExpense = new Map<string, ExpensePaidBy[]>()
  const paidForByExpense = new Map<string, ExpensePaidFor[]>()
  const documentsByExpense = new Map<string, ExpenseDocument[]>()
  const recurringByExpense = new Map<string, RecurringExpenseLink>()

  // Subqueries (one bind) instead of `IN (?,?,…)` — D1 allows only 100 bound
  // parameters, and migrated groups can have 100+ expenses.
  if (expenseRows.length > 0) {
    const { results: paidByRows } = await db
      .prepare(
        `SELECT expense_id, participant_id, amount FROM expense_paid_by
         WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)`,
      )
      .bind(id)
      .all<{ expense_id: string; participant_id: string; amount: number }>()
    for (const row of paidByRows) {
      const list = paidByByExpense.get(row.expense_id) ?? []
      list.push({
        expenseId: row.expense_id,
        participantId: row.participant_id,
        amount: row.amount,
      })
      paidByByExpense.set(row.expense_id, list)
    }

    const { results: paidForRows } = await db
      .prepare(
        `SELECT expense_id, participant_id, shares FROM expense_paid_for
         WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)`,
      )
      .bind(id)
      .all<{ expense_id: string; participant_id: string; shares: number }>()
    for (const row of paidForRows) {
      const list = paidForByExpense.get(row.expense_id) ?? []
      list.push({
        expenseId: row.expense_id,
        participantId: row.participant_id,
        shares: row.shares,
      })
      paidForByExpense.set(row.expense_id, list)
    }

    const { results: documentRows } = await db
      .prepare(
        `SELECT id, expense_id, url, width, height FROM expense_documents
         WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)`,
      )
      .bind(id)
      .all<{
        id: string
        expense_id: string
        url: string
        width: number
        height: number
      }>()
    for (const row of documentRows) {
      const list = documentsByExpense.get(row.expense_id) ?? []
      list.push({
        id: row.id,
        expenseId: row.expense_id,
        url: row.url,
        width: row.width,
        height: row.height,
      })
      documentsByExpense.set(row.expense_id, list)
    }

    const { results: recurringRows } = await db
      .prepare('SELECT * FROM recurring_expense_links WHERE group_id = ?')
      .bind(id)
      .all<{
        id: string
        group_id: string
        current_frame_expense_id: string
        next_expense_created_at: string | null
        next_expense_date: string
      }>()
    for (const row of recurringRows) {
      recurringByExpense.set(row.current_frame_expense_id, {
        id: row.id,
        groupId: row.group_id,
        currentFrameExpenseId: row.current_frame_expense_id,
        nextExpenseCreatedAt: row.next_expense_created_at,
        nextExpenseDate: row.next_expense_date,
      })
    }
  }

  const expenses: Expense[] = expenseRows.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    expenseDate: row.expense_date,
    title: row.title,
    categoryId: row.category_id,
    amount: row.amount,
    originalAmount: row.original_amount,
    originalCurrency: row.original_currency,
    conversionRate: row.conversion_rate,
    paidBy: paidByByExpense.get(row.id) ?? [],
    isReimbursement: row.is_reimbursement === 1,
    splitMode: (row.split_mode as SplitMode) ?? SplitMode.EVENLY,
    createdAt: row.created_at,
    notes: row.notes,
    recurrenceRule:
      (row.recurrence_rule as RecurrenceRule | null) ?? RecurrenceRule.NONE,
    paidFor: paidForByExpense.get(row.id) ?? [],
    documents: documentsByExpense.get(row.id) ?? [],
    recurringExpenseLink: recurringByExpense.get(row.id) ?? null,
  }))

  const { results: activityRows } = await db
    .prepare('SELECT * FROM activities WHERE group_id = ? ORDER BY time DESC')
    .bind(id)
    .all<{
      id: string
      group_id: string
      time: string
      activity_type: string
      participant_id: string | null
      expense_id: string | null
      data: string | null
    }>()

  const activities: Activity[] = activityRows.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    time: row.time,
    activityType: row.activity_type as ActivityType,
    participantId: row.participant_id,
    expenseId: row.expense_id,
    data: row.data,
  }))

  return {
    id: group.id,
    name: group.name,
    information: group.information,
    currency: group.currency,
    currencyCode: group.currency_code,
    pinHash: group.pin_hash,
    defaultSplitMode:
      (group.default_split_mode as SplitMode) ?? SplitMode.EVENLY,
    fixedExpenseDateGroups: group.fixed_expense_date_groups === 1,
    version: group.version,
    createdAt: group.created_at,
    lastActivityAt: group.last_activity_at,
    lastSeenAt: group.last_seen_at,
    deletedAt: group.deleted_at,
    participants: participantRows.map((row) => ({
      id: row.id,
      name: row.name,
      groupId: row.group_id,
    })),
    expenses,
    activities,
  }
}

function groupMetaBinds(group: GroupDocument) {
  return [
    group.name,
    group.information ?? null,
    group.currency,
    group.currencyCode ?? null,
    group.pinHash ?? null,
    group.defaultSplitMode ?? SplitMode.EVENLY,
    bool01(group.fixedExpenseDateGroups),
    group.createdAt,
    group.lastActivityAt ?? null,
    group.lastSeenAt ?? null,
    group.deletedAt ?? null,
    group.id,
  ]
}

function childInserts(
  db: D1Database,
  group: GroupDocument,
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = []
  group.participants.forEach((participant, index) => {
    stmts.push(
      db
        .prepare(
          'INSERT INTO participants (id, group_id, name, sort_order) VALUES (?, ?, ?, ?)',
        )
        .bind(participant.id, group.id, participant.name, index),
    )
  })
  for (const expense of group.expenses) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO expenses (
            id, group_id, expense_date, title, category_id, amount,
            original_amount, original_currency, conversion_rate, is_reimbursement,
            split_mode, created_at, notes, recurrence_rule
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          expense.id,
          group.id,
          expense.expenseDate,
          expense.title,
          expense.categoryId,
          expense.amount,
          expense.originalAmount,
          expense.originalCurrency,
          expense.conversionRate,
          bool01(expense.isReimbursement),
          expense.splitMode,
          expense.createdAt,
          expense.notes,
          expense.recurrenceRule,
        ),
    )
    for (const paidBy of getExpensePaidBy(expense)) {
      stmts.push(
        db
          .prepare(
            'INSERT INTO expense_paid_by (expense_id, participant_id, amount) VALUES (?, ?, ?)',
          )
          .bind(expense.id, paidBy.participantId, paidBy.amount),
      )
    }
    for (const paidFor of expense.paidFor ?? []) {
      stmts.push(
        db
          .prepare(
            'INSERT INTO expense_paid_for (expense_id, participant_id, shares) VALUES (?, ?, ?)',
          )
          .bind(expense.id, paidFor.participantId, paidFor.shares),
      )
    }
    for (const document of expense.documents) {
      stmts.push(
        db
          .prepare(
            'INSERT INTO expense_documents (id, expense_id, url, width, height) VALUES (?, ?, ?, ?, ?)',
          )
          .bind(
            document.id,
            expense.id,
            document.url,
            document.width,
            document.height,
          ),
      )
    }
    if (expense.recurringExpenseLink) {
      const link = expense.recurringExpenseLink
      stmts.push(
        db
          .prepare(
            `INSERT INTO recurring_expense_links (
              id, group_id, current_frame_expense_id, next_expense_created_at, next_expense_date
            ) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            link.id,
            group.id,
            expense.id,
            link.nextExpenseCreatedAt,
            link.nextExpenseDate,
          ),
      )
    }
  }
  for (const activity of group.activities) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO activities (
            id, group_id, time, activity_type, participant_id, expense_id, data
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          activity.id,
          group.id,
          activity.time,
          activity.activityType,
          activity.participantId,
          activity.expenseId,
          activity.data,
        ),
    )
  }
  return stmts
}

function childDeletes(db: D1Database, groupId: string): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM activities WHERE group_id = ?').bind(groupId),
    db
      .prepare(
        'DELETE FROM expense_documents WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)',
      )
      .bind(groupId),
    db
      .prepare('DELETE FROM recurring_expense_links WHERE group_id = ?')
      .bind(groupId),
    db
      .prepare(
        'DELETE FROM expense_paid_by WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)',
      )
      .bind(groupId),
    db
      .prepare(
        'DELETE FROM expense_paid_for WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)',
      )
      .bind(groupId),
    db.prepare('DELETE FROM expenses WHERE group_id = ?').bind(groupId),
    db.prepare('DELETE FROM participants WHERE group_id = ?').bind(groupId),
  ]
}

async function runChunks(db: D1Database, stmts: D1PreparedStatement[]) {
  const size = 40
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size))
  }
}

/** D1 allows at most 100 bound parameters per statement. */
const D1_MAX_BOUND_PARAMETERS = 100

async function selectWhereIdIn<T>(
  db: D1Database,
  sqlBeforeIn: string,
  ids: string[],
): Promise<T[]> {
  if (ids.length === 0) return []
  const out: T[] = []
  for (let i = 0; i < ids.length; i += D1_MAX_BOUND_PARAMETERS) {
    const chunk = ids.slice(i, i + D1_MAX_BOUND_PARAMETERS)
    const placeholders = chunk.map(() => '?').join(',')
    const { results } = await db
      .prepare(`${sqlBeforeIn} (${placeholders})`)
      .bind(...chunk)
      .all<T>()
    out.push(...results)
  }
  return out
}

export const d1Repository: GroupRepository = {
  async get(id) {
    return loadGroup(await getD1(), id)
  },

  async listSummaries(ids) {
    const unique = Array.from(new Set(ids))
    const rows = await selectWhereIdIn<
      GroupRow & { participant_count: number }
    >(
      await getD1(),
      `SELECT g.*,
        (SELECT COUNT(*) FROM participants p WHERE p.group_id = g.id) AS participant_count
       FROM groups g WHERE g.id IN`,
      unique,
    )
    const byId = new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          information: row.information,
          currency: row.currency,
          currencyCode: row.currency_code,
          createdAt: row.created_at,
          deletedAt: row.deleted_at,
          participantCount: row.participant_count,
        } satisfies GroupSummary,
      ]),
    )
    return ids.flatMap((id) => {
      const row = byId.get(id)
      return row ? [row] : []
    })
  },

  async create(group) {
    const db = await getD1()
    const version = group.version ?? 0
    const insertGroup = db
      .prepare(
        `INSERT INTO groups (
          id, name, information, currency, currency_code, pin_hash,
          default_split_mode, fixed_expense_date_groups, version,
          created_at, last_activity_at, last_seen_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        group.id,
        group.name,
        group.information ?? null,
        group.currency,
        group.currencyCode ?? null,
        group.pinHash ?? null,
        group.defaultSplitMode ?? SplitMode.EVENLY,
        bool01(group.fixedExpenseDateGroups),
        version,
        group.createdAt,
        group.lastActivityAt ?? null,
        group.lastSeenAt ?? null,
        group.deletedAt ?? null,
      )
    try {
      await runChunks(db, [insertGroup, ...childInserts(db, group)])
    } catch (error) {
      await db.prepare('DELETE FROM groups WHERE id = ?').bind(group.id).run()
      throw error
    }
  },

  async save(group, expectedVersion): Promise<WriteResult> {
    const db = await getD1()
    const claimed = await db
      .prepare(
        `UPDATE groups SET
          name = ?, information = ?, currency = ?, currency_code = ?, pin_hash = ?,
          default_split_mode = ?, fixed_expense_date_groups = ?,
          created_at = ?, last_activity_at = ?, last_seen_at = ?, deleted_at = ?,
          version = version + 1
         WHERE id = ? AND version = ?`,
      )
      .bind(...groupMetaBinds(group), expectedVersion)
      .run()
    if ((claimed.meta.changes ?? 0) !== 1) return 'conflict'

    const deletes = childDeletes(db, group.id)
    await db.batch(deletes)
    await runChunks(db, childInserts(db, group))
    group.version = expectedVersion + 1
    return 'ok'
  },

  async delete(id) {
    const db = await getD1()
    await db.prepare('DELETE FROM groups WHERE id = ?').bind(id).run()
  },

  async listIds() {
    const db = await getD1()
    const { results } = await db
      .prepare('SELECT id FROM groups')
      .all<{ id: string }>()
    return results.map((row) => row.id)
  },

  async bumpLastSeen(id, seenAt, minIntervalMs = 60 * 60 * 1000) {
    const db = await getD1()
    const threshold = new Date(Date.now() - minIntervalMs).toISOString()
    await db
      .prepare(
        `UPDATE groups SET last_seen_at = ?
         WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)`,
      )
      .bind(seenAt, id, threshold)
      .run()
  },

  async getPinAttempt(groupId, clientKey) {
    const db = await getD1()
    const row = await db
      .prepare(
        'SELECT fail_count, window_start, locked_until FROM pin_attempts WHERE group_id = ? AND client_key = ?',
      )
      .bind(groupId, clientKey)
      .first<{
        fail_count: number
        window_start: number
        locked_until: number | null
      }>()
    if (!row) return null
    return {
      failCount: row.fail_count,
      windowStart: row.window_start,
      lockedUntil: row.locked_until,
    }
  },

  async putPinAttempt(groupId, clientKey, state: PinAttemptState) {
    const db = await getD1()
    await db
      .prepare(
        `INSERT INTO pin_attempts (group_id, client_key, fail_count, window_start, locked_until)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(group_id, client_key) DO UPDATE SET
           fail_count = excluded.fail_count,
           window_start = excluded.window_start,
           locked_until = excluded.locked_until`,
      )
      .bind(
        groupId,
        clientKey,
        state.failCount,
        state.windowStart,
        state.lockedUntil,
      )
      .run()
  },
}
