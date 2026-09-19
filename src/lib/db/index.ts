import { d1Repository } from '@/lib/db/d1'
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
  return d1Repository
}
