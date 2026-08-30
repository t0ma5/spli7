import type {
  GroupRepository,
  PinAttemptState,
  WriteResult,
} from '@/lib/db/repository'
import type { GroupDocument } from '@/lib/kv/types'

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function createMemoryRepository(
  seed: GroupDocument[] = [],
): GroupRepository {
  const groups = new Map<string, GroupDocument>()
  const pinAttempts = new Map<string, PinAttemptState>()

  for (const group of seed) {
    groups.set(group.id, clone(group))
  }

  return {
    async get(id) {
      const group = groups.get(id)
      return group ? clone(group) : null
    },
    async create(group) {
      if (groups.has(group.id)) throw new Error(`Group exists: ${group.id}`)
      groups.set(group.id, clone({ ...group, version: group.version ?? 0 }))
    },
    async save(group, expectedVersion) {
      const existing = groups.get(group.id)
      if (!existing) return 'conflict'
      if ((existing.version ?? 0) !== expectedVersion) return 'conflict'
      groups.set(group.id, clone({ ...group, version: expectedVersion + 1 }))
      return 'ok' satisfies WriteResult
    },
    async delete(id) {
      groups.delete(id)
    },
    async listIds() {
      return Array.from(groups.keys())
    },
    async bumpLastSeen(id, seenAt, minIntervalMs = 60 * 60 * 1000) {
      const group = groups.get(id)
      if (!group) return
      const previous = group.lastSeenAt
        ? new Date(group.lastSeenAt).getTime()
        : 0
      if (Date.now() - previous < minIntervalMs) return
      group.lastSeenAt = seenAt
    },
    async getPinAttempt(groupId, clientKey) {
      return pinAttempts.get(`${groupId}:${clientKey}`) ?? null
    },
    async putPinAttempt(groupId, clientKey, state) {
      pinAttempts.set(`${groupId}:${clientKey}`, { ...state })
    },
  }
}
