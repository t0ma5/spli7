import type { GroupDocument } from '@/lib/kv/types'

export type WriteResult = 'ok' | 'conflict'

export type PinAttemptState = {
  failCount: number
  windowStart: number
  lockedUntil: number | null
}

export interface GroupRepository {
  get(id: string): Promise<GroupDocument | null>
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
