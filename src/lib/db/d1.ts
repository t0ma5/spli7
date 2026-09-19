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

function participantUpsert(
  db: SqlDatabase,
  groupId: string,
  participant: GroupDocument['participants'][number],
  index: number,
): SqlStatement {
  return db
    .prepare(
      `INSERT INTO participants (id, group_id, name, sort_order) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         sort_order = excluded.sort_order,
         group_id = excluded.group_id`,
    )
    .bind(participant.id, groupId, participant.name, index)
}

function expenseInserts(
  db: SqlDatabase,
  groupId: string,
  expense: GroupDocument['expenses'][number],
): SqlStatement[] {
  const stmts: SqlStatement[] = [
    db
      .prepare(
        `INSERT INTO expenses (
          id, group_id, expense_date, title, category_id, amount,
          original_amount, original_currency, conversion_rate, is_reimbursement,
          split_mode, created_at, notes, recurrence_rule
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          group_id = excluded.group_id,
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
          recurrence_rule = excluded.recurrence_rule`,
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
            id, group_id, current_frame_expense_id, next_expense_created_at, next_expense_date
          ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
            group_id = excluded.group_id,
            current_frame_expense_id = excluded.current_frame_expense_id,
            next_expense_created_at = excluded.next_expense_created_at,
            next_expense_date = excluded.next_expense_date`,
        )
        .bind(
          link.id,
          groupId,
          expense.id,
          link.nextExpenseCreatedAt,
          link.nextExpenseDate,
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
    stmts.push(...expenseInserts(db, group.id, expense))
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

async function runChunks(db: SqlDatabase, stmts: SqlStatement[]) {
  const size = 40
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
    participants: participantRows.map((row) => ({
      id: row.id,
      name: row.name,
      groupId: row.group_id,
    })),
  }
}

async function selectExpenseRows(
  db: SqlDatabase,
  groupId: string,
  options?: ExpenseListOptions,
): Promise<ExpenseRow[]> {
  const filter = options?.filter?.trim()
  const clauses = ['group_id = ?']
  const binds: unknown[] = [groupId]
  if (filter) {
    clauses.push(`LOWER(title) LIKE ? ESCAPE '\\'`)
    binds.push(
      `%${filter.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`,
    )
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
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS n FROM expenses
           WHERE group_id = ? AND LOWER(title) LIKE ? ESCAPE '\\'`,
        )
        .bind(
          groupId,
          `%${trimmed.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`,
        )
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
    const meta = await db
      .prepare('SELECT id FROM groups WHERE id = ?')
      .bind(groupId)
      .first<{ id: string }>()
    if (!meta) return []
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
    try {
      await runChunks(db, [insertGroup, ...childInserts(db, group)])
    } catch (error) {
      await db.prepare('DELETE FROM groups WHERE id = ?').bind(group.id).run()
      throw error
    }
  },

  async save(group, expectedVersion, previous): Promise<WriteResult> {
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

    if (previous) {
      await runChunks(db, childPatchStatements(db, group, previous))
    } else {
      const deletes = childDeletes(db, group.id)
      await db.batch(deletes)
      await runChunks(db, childInserts(db, group))
    }
    group.version = expectedVersion + 1
    return 'ok'
  },

  async mutateExpenses(groupId, expectedVersion, mutation) {
    const db = await getD1()
    const lastActivityAt = mutation.lastActivityAt ?? new Date().toISOString()
    const claimed = await db
      .prepare(
        `UPDATE groups SET
          last_activity_at = ?,
          version = version + 1
         WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      )
      .bind(lastActivityAt, groupId, expectedVersion)
      .run()
    if ((claimed.meta.changes ?? 0) !== 1) return 'conflict'
    await runChunks(db, expenseMutationStatements(db, groupId, mutation))
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
