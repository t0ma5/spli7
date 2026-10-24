import { getD1, type SqlDatabase, type SqlStatement } from '@/lib/db/client'
import { diffGroupChildren } from '@/lib/db/group-patch'
import type {
  ActivityListOptions,
  ExpenseListOptions,
  GroupExpenseMutation,
  GroupMeta,
  GroupRepository,
  GroupSummary,
  PinAttemptState,
  WriteResult,
} from '@/lib/db/repository'
import { PENDING_CREATE_DELETED_AT } from '@/lib/group-lifecycle'
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
import { parsePaymentMethods } from '@/lib/payment-methods'

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
  payment_methods: string | null
}

function rowToParticipant(row: ParticipantRow) {
  return {
    id: row.id,
    name: row.name,
    groupId: row.group_id,
    paymentMethods: parsePaymentMethods(row.payment_methods),
  }
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
  db: SqlDatabase,
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
    .prepare(
      'SELECT * FROM expenses WHERE group_id = ? ORDER BY expense_date DESC, created_at DESC',
    )
    .bind(id)
    .all<ExpenseRow>()

  const expenses = await hydrateExpenses(db, expenseRows)

  const activities = await listActivityRows(db, id)

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
    participants: participantRows.map(rowToParticipant),
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

function participantUpsert(
  db: SqlDatabase,
  groupId: string,
  participant: GroupDocument['participants'][number],
  index: number,
): SqlStatement {
  return db
    .prepare(
      `INSERT INTO participants (id, group_id, name, sort_order, payment_methods)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         sort_order = excluded.sort_order,
         payment_methods = excluded.payment_methods
       WHERE participants.group_id = excluded.group_id`,
    )
    .bind(
      participant.id,
      groupId,
      participant.name,
      index,
      participant.paymentMethods?.length
        ? JSON.stringify(participant.paymentMethods)
        : null,
    )
}

/** Lowercased in JS: SQLite LOWER() only folds ASCII, so Ä would never match ä. */
export function expenseSearchText(title: string, notes: string | null): string {
  return `${title}
${notes ?? ''}`.toLowerCase()
}

function expenseInserts(
  db: SqlDatabase,
  groupId: string,
  expense: GroupDocument['expenses'][number],
  mode: 'insert' | 'upsert' = 'upsert',
): SqlStatement[] {
  // A plain insert lets the primary key reject an id that already exists in
  // any group. Upserts never move a row to another group.
  const onConflict =
    mode === 'insert'
      ? ''
      : `ON CONFLICT(id) DO UPDATE SET
          expense_date = excluded.expense_date,
          title = excluded.title,
          category_id = excluded.category_id,
          amount = excluded.amount,
          original_amount = excluded.original_amount,
          original_currency = excluded.original_currency,
          conversion_rate = excluded.conversion_rate,
          is_reimbursement = excluded.is_reimbursement,
          split_mode = excluded.split_mode,
          created_at = excluded.created_at,
          notes = excluded.notes,
          recurrence_rule = excluded.recurrence_rule,
          search_text = excluded.search_text
         WHERE expenses.group_id = excluded.group_id`
  const stmts: SqlStatement[] = [
    db
      .prepare(
        `INSERT INTO expenses (
          id, group_id, expense_date, title, category_id, amount,
          original_amount, original_currency, conversion_rate, is_reimbursement,
          split_mode, created_at, notes, recurrence_rule, search_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ${onConflict}`,
      )
      .bind(
        expense.id,
        groupId,
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
        expenseSearchText(expense.title, expense.notes),
      ),
  ]
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
            id, group_id, current_frame_expense_id, next_expense_created_at, next_expense_date, anchor_day
          ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
            group_id = excluded.group_id,
            current_frame_expense_id = excluded.current_frame_expense_id,
            next_expense_created_at = excluded.next_expense_created_at,
            next_expense_date = excluded.next_expense_date,
            anchor_day = excluded.anchor_day`,
        )
        .bind(
          link.id,
          groupId,
          expense.id,
          link.nextExpenseCreatedAt,
          link.nextExpenseDate,
          link.anchorDay,
        ),
    )
  }
  return stmts
}

function activityInsert(
  db: SqlDatabase,
  activity: GroupDocument['activities'][number],
): SqlStatement {
  return db
    .prepare(
      `INSERT INTO activities (
        id, group_id, time, activity_type, participant_id, expense_id, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      activity.id,
      activity.groupId,
      activity.time,
      activity.activityType,
      activity.participantId,
      activity.expenseId,
      activity.data,
    )
}

function expenseChildDeletes(
  db: SqlDatabase,
  expenseId: string,
): SqlStatement[] {
  return [
    db
      .prepare('DELETE FROM expense_documents WHERE expense_id = ?')
      .bind(expenseId),
    db
      .prepare(
        'DELETE FROM recurring_expense_links WHERE current_frame_expense_id = ?',
      )
      .bind(expenseId),
    db
      .prepare('DELETE FROM expense_paid_by WHERE expense_id = ?')
      .bind(expenseId),
    db
      .prepare('DELETE FROM expense_paid_for WHERE expense_id = ?')
      .bind(expenseId),
  ]
}

function inDeletes(
  db: SqlDatabase,
  sqlBeforeIn: string,
  ids: string[],
): SqlStatement[] {
  const stmts: SqlStatement[] = []
  const size = 80
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size)
    const placeholders = chunk.map(() => '?').join(',')
    stmts.push(db.prepare(`${sqlBeforeIn} (${placeholders})`).bind(...chunk))
  }
  return stmts
}

function childInserts(db: SqlDatabase, group: GroupDocument): SqlStatement[] {
  const stmts: SqlStatement[] = []
  group.participants.forEach((participant, index) => {
    stmts.push(participantUpsert(db, group.id, participant, index))
  })
  for (const expense of group.expenses) {
    stmts.push(...expenseInserts(db, group.id, expense, 'insert'))
  }
  for (const activity of group.activities) {
    stmts.push(activityInsert(db, activity))
  }
  return stmts
}

function childPatchStatements(
  db: SqlDatabase,
  group: GroupDocument,
  previous: GroupDocument,
): SqlStatement[] {
  const patch = diffGroupChildren(previous, group)
  const stmts: SqlStatement[] = []

  if (patch.deleteExpenseIds.length > 0) {
    stmts.push(
      ...inDeletes(
        db,
        'DELETE FROM expense_documents WHERE expense_id IN',
        patch.deleteExpenseIds,
      ),
      ...inDeletes(
        db,
        'DELETE FROM recurring_expense_links WHERE current_frame_expense_id IN',
        patch.deleteExpenseIds,
      ),
      ...inDeletes(
        db,
        'DELETE FROM expense_paid_by WHERE expense_id IN',
        patch.deleteExpenseIds,
      ),
      ...inDeletes(
        db,
        'DELETE FROM expense_paid_for WHERE expense_id IN',
        patch.deleteExpenseIds,
      ),
      ...inDeletes(
        db,
        'DELETE FROM expenses WHERE id IN',
        patch.deleteExpenseIds,
      ),
    )
  }

  if (patch.replaceParticipants) {
    patch.participants.forEach((participant, index) => {
      stmts.push(participantUpsert(db, group.id, participant, index))
    })
  }

  for (const expense of patch.upsertExpenses) {
    stmts.push(...expenseChildDeletes(db, expense.id))
    stmts.push(...expenseInserts(db, group.id, expense))
  }

  if (patch.deleteParticipantIds.length > 0) {
    stmts.push(
      ...inDeletes(
        db,
        'DELETE FROM participants WHERE id IN',
        patch.deleteParticipantIds,
      ),
    )
  }

  if (patch.deleteActivityIds.length > 0) {
    stmts.push(
      ...inDeletes(
        db,
        'DELETE FROM activities WHERE id IN',
        patch.deleteActivityIds,
      ),
    )
  }
  for (const activity of patch.insertActivities) {
    stmts.push(activityInsert(db, activity))
  }

  return stmts
}

function expenseMutationStatements(
  db: SqlDatabase,
  groupId: string,
  mutation: GroupExpenseMutation,
): SqlStatement[] {
  const stmts: SqlStatement[] = []
  const deleteExpenseIds = mutation.deleteExpenseIds ?? []
  if (deleteExpenseIds.length > 0) {
    stmts.push(
      ...inDeletes(
        db,
        'DELETE FROM expense_documents WHERE expense_id IN',
        deleteExpenseIds,
      ),
      ...inDeletes(
        db,
        'DELETE FROM recurring_expense_links WHERE current_frame_expense_id IN',
        deleteExpenseIds,
      ),
      ...inDeletes(
        db,
        'DELETE FROM expense_paid_by WHERE expense_id IN',
        deleteExpenseIds,
      ),
      ...inDeletes(
        db,
        'DELETE FROM expense_paid_for WHERE expense_id IN',
        deleteExpenseIds,
      ),
      ...inDeletes(db, 'DELETE FROM expenses WHERE id IN', deleteExpenseIds),
    )
  }
  for (const expense of mutation.insertExpenses ?? []) {
    stmts.push(...expenseInserts(db, groupId, expense, 'insert'))
  }
  for (const expense of mutation.upsertExpenses ?? []) {
    stmts.push(...expenseChildDeletes(db, expense.id))
    stmts.push(...expenseInserts(db, groupId, expense))
  }
  for (const activity of mutation.insertActivities ?? []) {
    stmts.push(activityInsert(db, activity))
  }
  return stmts
}

function childDeletes(db: SqlDatabase, groupId: string): SqlStatement[] {
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

const CREATE_BATCH_SIZE = 40

async function runChunks(db: SqlDatabase, stmts: SqlStatement[]) {
  const size = CREATE_BATCH_SIZE
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size))
  }
}

/** D1 allows at most 100 bound parameters per statement. */
const D1_MAX_BOUND_PARAMETERS = 100

type ActivityRow = {
  id: string
  group_id: string
  time: string
  activity_type: string
  participant_id: string | null
  expense_id: string | null
  data: string | null
}

async function selectWhereIdIn<T>(
  db: SqlDatabase,
  sqlBeforeIn: string,
  ids: string[],
  extraBinds: unknown[] = [],
): Promise<T[]> {
  if (ids.length === 0) return []
  const chunkSize = Math.max(1, D1_MAX_BOUND_PARAMETERS - extraBinds.length)
  const out: T[] = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(',')
    const { results } = await db
      .prepare(`${sqlBeforeIn} (${placeholders})`)
      .bind(...extraBinds, ...chunk)
      .all<T>()
    out.push(...results)
  }
  return out
}

function rowToExpense(
  row: ExpenseRow,
  paidByByExpense: Map<string, ExpensePaidBy[]>,
  paidForByExpense: Map<string, ExpensePaidFor[]>,
  documentsByExpense: Map<string, ExpenseDocument[]>,
  recurringByExpense: Map<string, RecurringExpenseLink>,
): Expense {
  return {
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
  }
}

type ExpenseHydrate = {
  documents?: boolean
  recurring?: boolean
}

async function hydrateExpenses(
  db: SqlDatabase,
  expenseRows: ExpenseRow[],
  hydrate: ExpenseHydrate = {},
): Promise<Expense[]> {
  const includeDocuments = hydrate.documents !== false
  const includeRecurring = hydrate.recurring !== false
  const paidByByExpense = new Map<string, ExpensePaidBy[]>()
  const paidForByExpense = new Map<string, ExpensePaidFor[]>()
  const documentsByExpense = new Map<string, ExpenseDocument[]>()
  const recurringByExpense = new Map<string, RecurringExpenseLink>()
  const expenseIds = expenseRows.map((row) => row.id)
  if (expenseIds.length === 0) return []

  const paidByRows = await selectWhereIdIn<{
    expense_id: string
    participant_id: string
    amount: number
  }>(
    db,
    'SELECT expense_id, participant_id, amount FROM expense_paid_by WHERE expense_id IN',
    expenseIds,
  )
  for (const row of paidByRows) {
    const list = paidByByExpense.get(row.expense_id) ?? []
    list.push({
      expenseId: row.expense_id,
      participantId: row.participant_id,
      amount: row.amount,
    })
    paidByByExpense.set(row.expense_id, list)
  }

  const paidForRows = await selectWhereIdIn<{
    expense_id: string
    participant_id: string
    shares: number
  }>(
    db,
    'SELECT expense_id, participant_id, shares FROM expense_paid_for WHERE expense_id IN',
    expenseIds,
  )
  for (const row of paidForRows) {
    const list = paidForByExpense.get(row.expense_id) ?? []
    list.push({
      expenseId: row.expense_id,
      participantId: row.participant_id,
      shares: row.shares,
    })
    paidForByExpense.set(row.expense_id, list)
  }

  if (includeDocuments) {
    const documentRows = await selectWhereIdIn<{
      id: string
      expense_id: string
      url: string
      width: number
      height: number
    }>(
      db,
      'SELECT id, expense_id, url, width, height FROM expense_documents WHERE expense_id IN',
      expenseIds,
    )
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
  }

  if (includeRecurring) {
    const groupIds: string[] = []
    for (const row of expenseRows) {
      if (!groupIds.includes(row.group_id)) groupIds.push(row.group_id)
    }
    for (const groupId of groupIds) {
      const { results: recurringRows } = await db
        .prepare('SELECT * FROM recurring_expense_links WHERE group_id = ?')
        .bind(groupId)
        .all<{
          id: string
          group_id: string
          current_frame_expense_id: string
          next_expense_created_at: string | null
          next_expense_date: string
          anchor_day: number | null
        }>()
      for (const row of recurringRows) {
        recurringByExpense.set(row.current_frame_expense_id, {
          id: row.id,
          groupId: row.group_id,
          currentFrameExpenseId: row.current_frame_expense_id,
          nextExpenseCreatedAt: row.next_expense_created_at,
          nextExpenseDate: row.next_expense_date,
          anchorDay: row.anchor_day,
        })
      }
    }
  }

  return expenseRows.map((row) =>
    rowToExpense(
      row,
      paidByByExpense,
      paidForByExpense,
      documentsByExpense,
      recurringByExpense,
    ),
  )
}

async function listActivityRows(
  db: SqlDatabase,
  groupId: string,
  options?: ActivityListOptions,
): Promise<Activity[]> {
  const binds: unknown[] = [groupId]
  let sql = 'SELECT * FROM activities WHERE group_id = ?'
  if (options?.after) {
    sql += ' AND (time < ? OR (time = ? AND id < ?))'
    binds.push(options.after.time, options.after.time, options.after.id)
  }
  sql += ' ORDER BY time DESC, id DESC'
  if (options?.length !== undefined) {
    sql += ' LIMIT ?'
    binds.push(options.length)
  }
  const { results } = await db
    .prepare(sql)
    .bind(...binds)
    .all<ActivityRow>()
  return results.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    time: row.time,
    activityType: row.activity_type as ActivityType,
    participantId: row.participant_id,
    expenseId: row.expense_id,
    data: row.data,
  }))
}

async function loadMeta(
  db: SqlDatabase,
  id: string,
): Promise<GroupMeta | null> {
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
    participants: participantRows.map(rowToParticipant),
  }
}

function expenseSearchPattern(filter: string): string {
  return `%${filter.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
}

// Rows written before migration 0004 have no search_text; LOWER() still
// covers their ASCII letters until scripts/backfill-search-text.mjs runs.
const EXPENSE_SEARCH_SQL = `(IFNULL(search_text, LOWER(title) || char(10) || LOWER(IFNULL(notes, ''))) LIKE ? ESCAPE '\\')`

async function selectExpenseRows(
  db: SqlDatabase,
  groupId: string,
  options?: ExpenseListOptions,
): Promise<ExpenseRow[]> {
  const filter = options?.filter?.trim()
  const clauses = ['group_id = ?']
  const binds: unknown[] = [groupId]
  if (filter) {
    clauses.push(EXPENSE_SEARCH_SQL)
    binds.push(expenseSearchPattern(filter))
  }
  if (options?.after) {
    clauses.push(
      `(expense_date < ? OR (expense_date = ? AND created_at < ?) OR (expense_date = ? AND created_at = ? AND id < ?))`,
    )
    const { expenseDate, createdAt, id } = options.after
    binds.push(expenseDate, expenseDate, createdAt, expenseDate, createdAt, id)
  }
  let sql = `SELECT * FROM expenses WHERE ${clauses.join(' AND ')} ORDER BY expense_date DESC, created_at DESC, id DESC`
  if (options?.length !== undefined) {
    sql += ' LIMIT ?'
    binds.push(options.length)
  }
  const { results } = await db
    .prepare(sql)
    .bind(...binds)
    .all<ExpenseRow>()
  return results
}

async function activeGroupId(
  db: SqlDatabase,
  groupId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM groups WHERE id = ? AND deleted_at IS NULL')
    .bind(groupId)
    .first<{ id: string }>()
  return Boolean(row)
}

class VersionConflict extends Error {
  constructor() {
    super('version conflict')
    this.name = 'VersionConflict'
  }
}

export const d1Repository: GroupRepository = {
  async get(id) {
    return loadGroup(await getD1(), id)
  },

  async getMeta(id) {
    return loadMeta(await getD1(), id)
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
          pinHash: row.pin_hash,
        } satisfies GroupSummary,
      ]),
    )
    return ids.flatMap((id) => {
      const row = byId.get(id)
      return row ? [row] : []
    })
  },

  async listExpenses(groupId, options) {
    const db = await getD1()
    if (!(await activeGroupId(db, groupId))) return []
    const rows = await selectExpenseRows(db, groupId, options)
    return hydrateExpenses(db, rows, {
      documents: options?.documents,
      recurring: options?.recurring,
    })
  },

  async listExpensesByIds(groupId, ids) {
    const db = await getD1()
    if (!(await activeGroupId(db, groupId)) || ids.length === 0) return []
    const rows = await selectWhereIdIn<ExpenseRow>(
      db,
      'SELECT * FROM expenses WHERE group_id = ? AND id IN',
      ids,
      [groupId],
    )
    return hydrateExpenses(db, rows)
  },

  async countExpenses(groupId, filter) {
    const db = await getD1()
    if (!(await activeGroupId(db, groupId))) return 0
    const trimmed = filter?.trim()
    if (trimmed) {
      const pattern = expenseSearchPattern(trimmed)
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS n FROM expenses
           WHERE group_id = ? AND ${EXPENSE_SEARCH_SQL}`,
        )
        .bind(groupId, pattern)
        .first<{ n: number }>()
      return row?.n ?? 0
    }
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM expenses WHERE group_id = ?')
      .bind(groupId)
      .first<{ n: number }>()
    return row?.n ?? 0
  },

  async listActivities(groupId, options) {
    const db = await getD1()
    if (!(await activeGroupId(db, groupId))) return []
    return listActivityRows(db, groupId, options)
  },

  async getExpense(groupId, expenseId) {
    const db = await getD1()
    if (!(await activeGroupId(db, groupId))) return null
    const row = await db
      .prepare('SELECT * FROM expenses WHERE group_id = ? AND id = ?')
      .bind(groupId, expenseId)
      .first<ExpenseRow>()
    if (!row) return null
    const [expense] = await hydrateExpenses(db, [row])
    return expense ?? null
  },

  async expenseIdExists(expenseId) {
    const db = await getD1()
    const row = await db
      .prepare('SELECT 1 AS ok FROM expenses WHERE id = ?')
      .bind(expenseId)
      .first<{ ok: number }>()
    return Boolean(row)
  },

  async listExpenseParticipantIds(groupId) {
    const db = await getD1()
    if (!(await activeGroupId(db, groupId))) return []
    const { results } = await db
      .prepare(
        `SELECT participant_id FROM expense_paid_by
         WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)
         UNION
         SELECT participant_id FROM expense_paid_for
         WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)`,
      )
      .bind(groupId, groupId)
      .all<{ participant_id: string }>()
    return results.map((row) => row.participant_id)
  },

  async listActiveRecurring(groupId) {
    const db = await getD1()
    if (!(await activeGroupId(db, groupId))) return []
    const { results } = await db
      .prepare(
        `SELECT e.amount, e.recurrence_rule, e.is_reimbursement
         FROM expenses e
         INNER JOIN recurring_expense_links r
           ON r.current_frame_expense_id = e.id
         WHERE e.group_id = ?
           AND e.is_reimbursement = 0
           AND r.next_expense_created_at IS NULL
           AND e.recurrence_rule IS NOT NULL
           AND e.recurrence_rule != ?`,
      )
      .bind(groupId, RecurrenceRule.NONE)
      .all<{
        amount: number
        recurrence_rule: string | null
        is_reimbursement: number
      }>()
    return results.map((row) => ({
      amount: row.amount,
      recurrenceRule:
        (row.recurrence_rule as RecurrenceRule | null) ?? RecurrenceRule.NONE,
      isReimbursement: row.is_reimbursement === 1,
    }))
  },

  async hasDueRecurring(groupId, nowIso) {
    const db = await getD1()
    if (!(await activeGroupId(db, groupId))) return false
    const row = await db
      .prepare(
        `SELECT 1 AS ok FROM recurring_expense_links
         WHERE group_id = ? AND next_expense_created_at IS NULL
           AND next_expense_date <= ?
         LIMIT 1`,
      )
      .bind(groupId, nowIso)
      .first<{ ok: number }>()
    return Boolean(row)
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
    const children = childInserts(db, group)
    // One batch is one transaction.
    if (children.length < CREATE_BATCH_SIZE) {
      await db.batch([insertGroup, ...children])
      return
    }
    // A large import does not fit one batch, and holding a write transaction
    // across thousands of round trips would block every other writer. Insert
    // the group as long-deleted so it stays invisible, then publish it last.
    // If the function dies half way, the next cleanup run purges it.
    const pending = db
      .prepare('UPDATE groups SET deleted_at = ? WHERE id = ?')
      .bind(PENDING_CREATE_DELETED_AT, group.id)
    const publish = db
      .prepare('UPDATE groups SET deleted_at = ? WHERE id = ?')
      .bind(group.deletedAt ?? null, group.id)
    try {
      await db.batch([insertGroup, pending])
      await runChunks(db, children)
      await publish.run()
    } catch (error) {
      await db.prepare('DELETE FROM groups WHERE id = ?').bind(group.id).run()
      throw error
    }
  },

  async save(group, expectedVersion, previous): Promise<WriteResult> {
    const db = await getD1()
    try {
      await db.transaction(async (tx) => {
        const claimed = await tx
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
        if ((claimed.meta.changes ?? 0) !== 1) throw new VersionConflict()
        if (previous) {
          await runChunks(tx, childPatchStatements(tx, group, previous))
        } else {
          await tx.batch(childDeletes(tx, group.id))
          await runChunks(tx, childInserts(tx, group))
        }
      })
    } catch (error) {
      if (error instanceof VersionConflict) return 'conflict'
      throw error
    }
    group.version = expectedVersion + 1
    return 'ok'
  },

  async mutateExpenses(groupId, expectedVersion, mutation) {
    const db = await getD1()
    const lastActivityAt = mutation.lastActivityAt ?? new Date().toISOString()
    try {
      await db.transaction(async (tx) => {
        const claimed = await tx
          .prepare(
            `UPDATE groups SET
              last_activity_at = ?,
              version = version + 1
             WHERE id = ? AND version = ? AND deleted_at IS NULL`,
          )
          .bind(lastActivityAt, groupId, expectedVersion)
          .run()
        if ((claimed.meta.changes ?? 0) !== 1) throw new VersionConflict()
        await runChunks(tx, expenseMutationStatements(tx, groupId, mutation))
      })
    } catch (error) {
      if (error instanceof VersionConflict) return 'conflict'
      throw error
    }
    return 'ok'
  },

  async delete(id) {
    const db = await getD1()
    // Child rows go by ON DELETE CASCADE; pin_attempts has no foreign key.
    await db.batch([
      db.prepare('DELETE FROM pin_attempts WHERE group_id = ?').bind(id),
      db.prepare('DELETE FROM groups WHERE id = ?').bind(id),
    ])
  },

  async listIds() {
    const db = await getD1()
    const { results } = await db
      .prepare('SELECT id FROM groups')
      .all<{ id: string }>()
    return results.map((row) => row.id)
  },

  async listLifecycle() {
    const db = await getD1()
    const { results } = await db
      .prepare(
        'SELECT id, created_at, last_activity_at, last_seen_at, deleted_at FROM groups',
      )
      .all<{
        id: string
        created_at: string
        last_activity_at: string | null
        last_seen_at: string | null
        deleted_at: string | null
      }>()
    return results.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      lastSeenAt: row.last_seen_at,
      deletedAt: row.deleted_at,
    }))
  },

  async softDeleteIfInactive(id, deletedAt, inactiveBeforeIso) {
    const db = await getD1()
    // SQLite's multi-argument MAX() is NULL if any argument is NULL.
    const result = await db
      .prepare(
        `UPDATE groups SET deleted_at = ?, version = version + 1
         WHERE id = ? AND deleted_at IS NULL
           AND MAX(created_at,
                   IFNULL(last_activity_at, created_at),
                   IFNULL(last_seen_at, created_at)) < ?`,
      )
      .bind(deletedAt, id, inactiveBeforeIso)
      .run()
    return (result.meta.changes ?? 0) === 1
  },

  async listGroupIdsWithDueRecurring(nowIso) {
    const db = await getD1()
    const { results } = await db
      .prepare(
        `SELECT DISTINCT r.group_id FROM recurring_expense_links r
         INNER JOIN groups g ON g.id = r.group_id
         WHERE g.deleted_at IS NULL
           AND r.next_expense_created_at IS NULL
           AND r.next_expense_date <= ?`,
      )
      .bind(nowIso)
      .all<{ group_id: string }>()
    return results.map((row) => row.group_id)
  },

  async prunePinAttempts(beforeMs) {
    const db = await getD1()
    const result = await db
      .prepare(
        `DELETE FROM pin_attempts
         WHERE window_start < ? AND (locked_until IS NULL OR locked_until < ?)`,
      )
      .bind(beforeMs, beforeMs)
      .run()
    return result.meta.changes ?? 0
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

  async reservePinAttempt(groupId, clientKey, now, limits) {
    const db = await getD1()
    const row = await db
      .prepare(
        `INSERT INTO pin_attempts (group_id, client_key, fail_count, window_start, locked_until)
         VALUES (?, ?, 1, ?, NULL)
         ON CONFLICT(group_id, client_key) DO UPDATE SET
           fail_count = CASE
             WHEN pin_attempts.locked_until IS NOT NULL AND pin_attempts.locked_until > excluded.window_start
               THEN pin_attempts.fail_count + 1
             WHEN pin_attempts.locked_until IS NOT NULL AND pin_attempts.locked_until <= excluded.window_start
               THEN 1
             WHEN excluded.window_start - pin_attempts.window_start < ?
               THEN pin_attempts.fail_count + 1
             ELSE 1
           END,
           window_start = CASE
             WHEN pin_attempts.locked_until IS NOT NULL AND pin_attempts.locked_until > excluded.window_start
               THEN pin_attempts.window_start
             WHEN pin_attempts.locked_until IS NOT NULL AND pin_attempts.locked_until <= excluded.window_start
               THEN excluded.window_start
             WHEN excluded.window_start - pin_attempts.window_start < ?
               THEN pin_attempts.window_start
             ELSE excluded.window_start
           END,
           locked_until = CASE
             WHEN pin_attempts.locked_until IS NOT NULL AND pin_attempts.locked_until > excluded.window_start
               THEN pin_attempts.locked_until
             WHEN (
               CASE
                 WHEN pin_attempts.locked_until IS NOT NULL AND pin_attempts.locked_until <= excluded.window_start
                   THEN 1
                 WHEN excluded.window_start - pin_attempts.window_start < ?
                   THEN pin_attempts.fail_count + 1
                 ELSE 1
               END
             ) >= ? THEN excluded.window_start + ?
             ELSE NULL
           END
         RETURNING fail_count, window_start, locked_until`,
      )
      .bind(
        groupId,
        clientKey,
        now,
        limits.windowMs,
        limits.windowMs,
        limits.windowMs,
        limits.maxFailures,
        limits.lockMs,
      )
      .first<{
        fail_count: number
        window_start: number
        locked_until: number | null
      }>()
    if (!row) {
      throw new Error('PIN attempt was not recorded')
    }
    return {
      failCount: Number(row.fail_count),
      windowStart: Number(row.window_start),
      lockedUntil: row.locked_until == null ? null : Number(row.locked_until),
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
