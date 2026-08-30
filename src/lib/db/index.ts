import { createMemoryRepository } from '@/lib/db/memory'
import type { GroupRepository } from '@/lib/db/repository'

let override: GroupRepository | null = null

export function setRepositoryForTests(repo: GroupRepository | null) {
  override = repo
}

export function getRepository(): GroupRepository {
  if (override) return override
  if (process.env.SPL1T_MEMORY_DB === '1') {
    return createMemoryRepository()
  }
  // Lazy so Jest can inject a memory repo without loading Workers bindings.
  const { d1Repository } = require('./d1') as typeof import('./d1')
  return d1Repository
}
