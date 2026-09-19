import {
  createClient,
  type Client,
  type InStatement,
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
    private readonly client: Client,
    readonly sql: string,
    readonly args: Value[] = [],
  ) {}

  bind(...values: unknown[]): SqlStatement {
    return new LibsqlStatement(this.client, this.sql, asValues(values))
  }

  async first<T>(): Promise<T | null> {
    const result = await this.client.execute({
      sql: this.sql,
      args: this.args,
    })
    const row = result.rows[0]
    return (row as T | undefined) ?? null
  }

  async all<T>(): Promise<{ results: T[] }> {
    const result = await this.client.execute({
      sql: this.sql,
      args: this.args,
    })
    return { results: result.rows as unknown as T[] }
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = await this.client.execute({
      sql: this.sql,
      args: this.args,
    })
    return { meta: { changes: result.rowsAffected } }
  }
}

class LibsqlDatabase implements SqlDatabase {
  constructor(private readonly client: Client) {}

  prepare(query: string): SqlStatement {
    return new LibsqlStatement(this.client, query)
  }

  async batch(stmts: SqlStatement[]): Promise<unknown> {
    if (stmts.length === 0) return []
    const statements: InStatement[] = stmts.map((stmt) => ({
      sql: stmt.sql,
      args: stmt.args,
    }))
    return this.client.batch(statements, 'write')
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
  cached = new LibsqlDatabase(client)
  return cached
}
