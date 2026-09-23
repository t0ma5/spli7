import type {
  ActivityListCursor,
  ExpenseListCursor,
} from '@/lib/db/list-cursor'
import type { Activity, Expense, GroupDocument } from '@/lib/kv/types'

export type { ActivityListCursor, ExpenseListCursor }

export type WriteResult = 'ok' | 'conflict'

export type PinAttemptState = {
  failCount: number
  windowStart: number
  lockedUntil: number | null
}

export type GroupSummary = {
  id: string
  name: string
  information: string | null
  currency: string
  currencyCode: string | null
  createdAt: string
  deletedAt: string | null
  participantCount: number
}

/** Group row + participants; no expenses or activities. */
export type GroupMeta = Omit<GroupDocument, 'expenses' | 'activities'>

export type ExpenseListOptions = {
  after?: ExpenseListCursor
  length?: number
  filter?: string
  /** Default true. Balances/stats skip documents and recurring links. */
  documents?: boolean
  recurring?: boolean
}

export type ActivityListOptions = {
  after?: ActivityListCursor
  length?: number
}

export type GroupExpenseMutation = {
  upsertExpenses?: Expense[]
  deleteExpenseIds?: string[]
  insertActivities?: Activity[]
  lastActivityAt?: string | null
}

export interface GroupRepository {
  get(id: string): Promise<GroupDocument | null>
  /** Header/PIN reads — does not hydrate expenses or activities. */
  getMeta(id: string): Promise<GroupMeta | null>
  /** Metadata only — used by /groups so large expense graphs are not loaded. */
  listSummaries(ids: string[]): Promise<GroupSummary[]>
  listExpenses(
    groupId: string,
    options?: ExpenseListOptions,
  ): Promise<Expense[]>
  listExpensesByIds(groupId: string, ids: string[]): Promise<Expense[]>
  countExpenses(groupId: string, filter?: string): Promise<number>
  listActivities(
    groupId: string,
    options?: ActivityListOptions,
  ): Promise<Activity[]>
  getExpense(groupId: string, expenseId: string): Promise<Expense | null>
  /** Primary key is global. Create must not upsert over another group's row. */
  expenseIdExists(expenseId: string): Promise<boolean>
  /** Distinct payer/share participant ids — no expense rows. */
  listExpenseParticipantIds(groupId: string): Promise<string[]>
  /** Active recurring frames (next copy not yet created). */
  listActiveRecurring(
    groupId: string,
  ): Promise<Pick<Expense, 'amount' | 'recurrenceRule' | 'isReimbursement'>[]>
  /** Cheap check so list pages do not hydrate the group when nothing is due. */
  hasDueRecurring(groupId: string, nowIso: string): Promise<boolean>
  create(group: GroupDocument): Promise<void>
  /**
   * Replace the stored group if `expectedVersion` still matches.
   * Increments `group.version` on success.
   * When `previous` is passed, only changed child rows are written.
   */
  save(
    group: GroupDocument,
    expectedVersion: number,
    previous?: GroupDocument,
  ): Promise<WriteResult>
  /**
   * Write expense/activity rows without loading the group document.
   * Bumps `version` when `expectedVersion` still matches.
   */
  mutateExpenses(
    groupId: string,
    expectedVersion: number,
    mutation: GroupExpenseMutation,
  ): Promise<WriteResult>
  delete(id: string): Promise<void>
  listIds(): Promise<string[]>
  bumpLastSeen(
    id: string,
    seenAt: string,
    minIntervalMs?: number,
  ): Promise<void>
  getPinAttempt(
    groupId: string,
    clientKey: string,
  ): Promise<PinAttemptState | null>
  putPinAttempt(
    groupId: string,
    clientKey: string,
    state: PinAttemptState,
  ): Promise<void>
}

export const WRITE_RETRIES = 8
