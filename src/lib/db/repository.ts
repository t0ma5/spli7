import type { Activity, Expense, GroupDocument } from '@/lib/kv/types'

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
  offset?: number
  length?: number
  filter?: string
}

export type ActivityListOptions = {
  offset?: number
  length?: number
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
