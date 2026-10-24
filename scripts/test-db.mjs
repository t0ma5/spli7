// Manage spli7-test, a Turso copy of the live database for safe UI and
// migration checks. Uses the Turso Platform API.
//
// Usage (reads TURSO_PLATFORM_TOKEN, TURSO_ORG, TURSO_DATABASE_URL):
//   npm run testdb -- create    copy live data into spli7-test, write .env.testdb.local
//   npm run testdb -- refresh   delete and copy again (fresh live data)
//   npm run testdb -- delete    remove spli7-test
//   npm run testdb -- migrate   apply migrations/ to spli7-test
//   npm run testdb -- status    show whether spli7-test exists
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

const TEST_DB = 'spli7-test'
const ENV_FILE = join(process.cwd(), '.env.testdb.local')
const API = 'https://api.turso.tech/v1'

const token = process.env.TURSO_PLATFORM_TOKEN
const org = process.env.TURSO_ORG
if (!token || !org) {
  console.error('Set TURSO_PLATFORM_TOKEN and TURSO_ORG in .env.local')
  process.exit(1)
}

function liveDbName() {
  const url = process.env.TURSO_DATABASE_URL
  if (!url) throw new Error('TURSO_DATABASE_URL is not set')
  // libsql://<db>-<org>.<region>.turso.io
  const host = new URL(url.replace(/^libsql:/, 'https:')).hostname
  const suffix = `-${org}`
  const first = host.split('.')[0]
  if (!first.endsWith(suffix)) {
    throw new Error(`Cannot read the database name from ${host}`)
  }
  return first.slice(0, -suffix.length)
}

async function api(method, path, body) {
  const res = await fetch(`${API}/organizations/${org}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) {
    throw new Error(`${method} ${path}: ${res.status} ${json.error ?? text}`)
  }
  return json
}

async function exists() {
  const { databases } = await api('GET', '/databases')
  return databases.find((db) => db.Name === TEST_DB) ?? null
}

async function create() {
  if (await exists()) {
    console.log(`${TEST_DB} already exists; use refresh for fresh data`)
    return writeEnv()
  }
  const source = liveDbName()
  const { database } = await api('POST', '/databases', {
    name: TEST_DB,
    group: 'default',
    seed: { type: 'database', name: source },
  })
  console.log(`created ${TEST_DB} from ${source} (${database.Hostname})`)
  await writeEnv()
}

async function writeEnv() {
  const db = await exists()
  if (!db) throw new Error(`${TEST_DB} does not exist`)
  const { jwt } = await api(
    'POST',
    `/databases/${TEST_DB}/auth/tokens?expiration=never&authorization=full-access`,
  )
  // Same secrets as local dev so PIN cookies and cron calls work.
  const keep = [
    'PIN_SECRET',
    'CRON_SECRET',
    'NEXT_PUBLIC_BASE_URL',
    'BLOB_READ_WRITE_TOKEN',
    'NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS',
  ]
    .filter((key) => process.env[key])
    .map((key) => `${key}=${process.env[key]}`)
  writeFileSync(
    ENV_FILE,
    [
      '# spli7-test (copy of live data). Written by scripts/test-db.mjs.',
      `TURSO_DATABASE_URL=libsql://${db.Hostname}`,
      `TURSO_AUTH_TOKEN=${jwt}`,
      ...keep,
      '',
    ].join('\n'),
  )
  console.log(`wrote ${ENV_FILE}`)
}

async function remove() {
  if (!(await exists())) {
    console.log(`${TEST_DB} does not exist`)
    return
  }
  await api('DELETE', `/databases/${TEST_DB}`)
  console.log(`deleted ${TEST_DB}`)
}

function migrate() {
  if (!existsSync(ENV_FILE)) throw new Error('Run create first')
  // The parent process already holds the LIVE database settings from
  // .env.local, and --env-file never overrides existing variables. Pass the
  // test settings explicitly so they win.
  const result = spawnSync(process.execPath, ['scripts/apply-migrations.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, ...parseEnv(readFileSync(ENV_FILE, 'utf8')) },
  })
  process.exit(result.status ?? 1)
}

const command = process.argv[2]
try {
  if (command === 'create') await create()
  else if (command === 'refresh') {
    await remove()
    await create()
  } else if (command === 'delete') await remove()
  else if (command === 'migrate') migrate()
  else if (command === 'status') {
    const db = await exists()
    console.log(db ? `${TEST_DB}: ${db.Hostname}` : `${TEST_DB}: not created`)
    console.log(`${ENV_FILE}: ${existsSync(ENV_FILE) ? 'present' : 'missing'}`)
  } else {
    console.error(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(0, 10).join('\n'))
    process.exit(1)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
