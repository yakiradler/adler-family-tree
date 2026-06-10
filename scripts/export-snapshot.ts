/**
 * Read-only snapshot of all public tables in the live Supabase Postgres.
 *
 * Usage:  npx tsx scripts/export-snapshot.ts
 *
 * Writes scripts/backups/snapshot-<ISO timestamp>.json with every row of
 * every table in the `public` schema, plus row counts. Issues only SELECT
 * statements — it can never modify data.
 *
 * Connection strategy mirrors run-migration.ts (direct host is IPv6-only
 * on most networks; fall back to the regional pooler, cached in
 * scripts/.region-cache).
 */
import { Client } from 'pg'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const PROJECT_REF = 'wkbdqdytfjycbbcnzjuv'

const here = dirname(fileURLToPath(import.meta.url))
const cacheFile = join(here, '.region-cache')
const backupDir = join(here, 'backups')

// Password comes from the environment, falling back to the single
// pre-existing location in run-migration.ts (read at runtime so the
// secret is never duplicated into another file). Rotating the password
// into .env and out of the repo entirely is tracked as follow-up work.
function resolveDbPassword(): string {
  const fromEnv = process.env.SUPABASE_DB_PASSWORD
  if (fromEnv) return fromEnv
  const migration = readFileSync(join(here, 'run-migration.ts'), 'utf8')
  const match = migration.match(/const DB_PASSWORD = '([^']+)'/)
  if (!match) {
    console.error('Set SUPABASE_DB_PASSWORD env var to run the snapshot.')
    process.exit(1)
  }
  return match[1]
}
const DB_PASSWORD = resolveDbPassword()

async function tryConnect(opts: {
  host: string
  port: number
  user: string
  label: string
}): Promise<Client | null> {
  const c = new Client({
    host: opts.host,
    port: opts.port,
    database: 'postgres',
    user: opts.user,
    password: DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 6000,
  })
  try {
    await c.connect()
    console.log(`✓ Connected via ${opts.label}`)
    return c
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 110)
    console.log(`  ✗ ${opts.label}: ${msg}`)
    try { await c.end() } catch { /* ignore */ }
    return null
  }
}

async function connect(): Promise<Client> {
  const direct = await tryConnect({
    host: `db.${PROJECT_REF}.supabase.co`,
    port: 5432,
    user: 'postgres',
    label: `direct db.${PROJECT_REF}.supabase.co:5432`,
  })
  if (direct) return direct

  const cached = process.env.SUPABASE_POOLER_REGION
    ?? (existsSync(cacheFile) ? readFileSync(cacheFile, 'utf8').trim() : '')
  if (cached) {
    const [prefix, ...rest] = cached.split(':')
    const [poolerPrefix, region] = rest.length
      ? [prefix, rest.join(':')]
      : ['aws-1', cached]
    const c = await tryConnect({
      host: `${poolerPrefix}-${region}.pooler.supabase.com`,
      port: 6543,
      user: `postgres.${PROJECT_REF}`,
      label: `pooler ${poolerPrefix}-${region} (cached)`,
    })
    if (c) return c
  }

  throw new Error(
    'Could not reach Supabase. Set SUPABASE_POOLER_REGION (e.g. aws-1:eu-central-1) and re-run.',
  )
}

const c = await connect()
try {
  const tables = await c.query(
    `select table_name
       from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  )

  const snapshot: Record<string, { count: number; rows: unknown[] }> = {}
  for (const { table_name } of tables.rows) {
    // Identifier comes from information_schema, but quote it anyway.
    const res = await c.query(`select * from public."${table_name}"`)
    snapshot[table_name] = { count: res.rowCount ?? res.rows.length, rows: res.rows }
    console.log(`  ${table_name}: ${res.rows.length} rows`)
  }

  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(backupDir, `snapshot-${stamp}.json`)
  writeFileSync(file, JSON.stringify({ projectRef: PROJECT_REF, takenAt: stamp, tables: snapshot }, null, 2))
  console.log(`\n✓ Snapshot written to ${file}`)
  console.log(`  Total tables: ${tables.rows.length}`)
  const members = snapshot['members']?.count ?? 0
  const rels = snapshot['relationships']?.count ?? 0
  console.log(`  members: ${members}, relationships: ${rels}`)
  if (members === 0) {
    console.warn('⚠ members table is empty — verify you are pointed at the right project!')
    process.exitCode = 1
  }
} catch (e) {
  console.error('✗ Snapshot failed:', e)
  process.exitCode = 1
} finally {
  await c.end()
}
