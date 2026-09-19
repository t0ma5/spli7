import 'server-only'

import { getSqlDatabase, type SqlDatabase } from '@/lib/db/sql'

export type { SqlDatabase, SqlStatement } from '@/lib/db/sql'

export async function getD1(): Promise<SqlDatabase> {
  return getSqlDatabase()
}
