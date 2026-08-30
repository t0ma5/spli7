import type { GroupDocument } from '@/lib/kv/types'

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

export interface GroupRepository {
  get(id: string): Promise<GroupDocument | null>
  /** Metadata only — used by /groups so large expense graphs are not loaded. */
  listSummaries(ids: string[]): Promise<GroupSummary[]>
  create(group: GroupDocument): Promise<void>
  /**
   * Replace the stored group if `expectedVersion` still matches.
   * Increments `group.version` on success.
   */
  save(group: GroupDocument, expectedVersion: number): Promise<WriteResult>
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
