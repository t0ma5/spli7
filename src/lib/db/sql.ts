import {
  createClient,
  type Client,
  type InStatement,
  type Transaction,
  type Value,
} from '@libsql/client/http'

export type SqlStatement = {
  readonly sql: string
  readonly args: Value[]
  bind(...values: unknown[]): SqlStatement
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: { changes: number } }>
}

export type SqlDatabase = {
  prepare(query: string): SqlStatement
  batch(stmts: SqlStatement[]): Promise<unknown>
  /** Run `fn` in one write transaction. Commit on success, roll back on throw. */
  transaction<T>(fn: (db: SqlDatabase) => Promise<T>): Promise<T>
}

type SqlExecutor = {
  execute(stmt: {
    sql: string
    args: Value[]
  }): Promise<{ rows: unknown[]; rowsAffected: number }>
  batch(stmts: InStatement[]): Promise<unknown>
}

function asValues(values: unknown[]): Value[] {
  return values.map((value) => {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'boolean' ||
      value instanceof ArrayBuffer ||
      value instanceof Uint8Array
    ) {
      return (value ?? null) as Value
    }
    throw new Error(`Unsupported SQL bind value: ${typeof value}`)
  })
}

class LibsqlStatement implements SqlStatement {
  constructor(
    private readonly executor: SqlExecutor,
    readonly sql: string,
    readonly args: Value[] = [],
  ) {}

  bind(...values: unknown[]): SqlStatement {
    return new LibsqlStatement(this.executor, this.sql, asValues(values))
  }

  async first<T>(): Promise<T | null> {
    const result = await this.executor.execute({
      sql: this.sql,
      args: this.args,
    })
    const row = result.rows[0]
    return (row as T | undefined) ?? null
  }

  async all<T>(): Promise<{ results: T[] }> {
    const result = await this.executor.execute({
      sql: this.sql,
      args: this.args,
    })
    return { results: result.rows as unknown as T[] }
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = await this.executor.execute({
      sql: this.sql,
      args: this.args,
    })
    return { meta: { changes: result.rowsAffected } }
  }
}

function clientExecutor(client: Client): SqlExecutor {
  return {
    execute: async (stmt) => {
      const result = await client.execute(stmt)
      return { rows: result.rows, rowsAffected: result.rowsAffected }
    },
    batch: (stmts) => client.batch(stmts, 'write'),
  }
}

function transactionExecutor(tx: Transaction): SqlExecutor {
  return {
    execute: async (stmt) => {
      const result = await tx.execute(stmt)
      return { rows: result.rows, rowsAffected: result.rowsAffected }
    },
    batch: (stmts) => tx.batch(stmts),
  }
}

class LibsqlDatabase implements SqlDatabase {
  constructor(
    private readonly executor: SqlExecutor,
    private readonly beginWrite?: () => Promise<Transaction>,
  ) {}

  prepare(query: string): SqlStatement {
    return new LibsqlStatement(this.executor, query)
  }

  async batch(stmts: SqlStatement[]): Promise<unknown> {
    if (stmts.length === 0) return []
    const statements: InStatement[] = stmts.map((stmt) => ({
      sql: stmt.sql,
      args: stmt.args,
    }))
    return this.executor.batch(statements)
  }

  async transaction<T>(fn: (db: SqlDatabase) => Promise<T>): Promise<T> {
    if (!this.beginWrite) return fn(this)
    const tx = await this.beginWrite()
    try {
      const result = await fn(new LibsqlDatabase(transactionExecutor(tx)))
      await tx.commit()
      return result
    } catch (error) {
      try {
        await tx.rollback()
      } catch {
        // The transaction may already be closed.
      }
      throw error
    } finally {
      tx.close()
    }
  }
}

let cached: SqlDatabase | null = null

export function getSqlDatabase(): SqlDatabase {
  if (cached) return cached
  const url = process.env.TURSO_DATABASE_URL
  if (!url) {
    throw new Error('TURSO_DATABASE_URL is not configured')
  }
  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })
  cached = new LibsqlDatabase(clientExecutor(client), () =>
    client.transaction('write'),
  )
  return cached
}
