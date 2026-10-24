// Run a command with an env file loaded first, e.g.
//   node scripts/with-env.mjs .env.testdb.local next dev
// (`node --env-file` cannot wrap `next dev`, which passes Node flags on to its
// child through NODE_OPTIONS, where --env-file is not allowed.) The file's
// values also win over .env.local, because Next never overrides process.env.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

const [envFile, command, ...args] = process.argv.slice(2)
if (!envFile || !command) {
  console.error('Usage: node scripts/with-env.mjs <env-file> <command> [args]')
  process.exit(1)
}
// Values from the file override the shell, so a terminal that already has
// the live TURSO_* variables exported still talks to the file's database.
const env = { ...process.env, ...parseEnv(readFileSync(envFile, 'utf8')) }
const bin = join(process.cwd(), 'node_modules', '.bin', command)
const child = spawn(bin, args, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
})
child.on('exit', (code) => process.exit(code ?? 1))
