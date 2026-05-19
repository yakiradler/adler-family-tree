/**
 * Apply a SQL migration file to the live Supabase Postgres.
 *
 * Usage:  npx tsx scripts/run-migration.ts migrations/001_member_extensions.sql
 *
 * Migrations should be idempotent (use IF NOT EXISTS / CREATE OR REPLACE).
 *
 * Connection strategy:
 *   1. Try the direct host `db.<ref>.supabase.co` (only resolves to IPv6
 *      on many networks — Supabase deprecated IPv4 there).
 *   2. Fall back to the regional pooler `aws-0-<region>.pooler.supabase.com`
 *      which still has IPv4. We auto-probe regions until one accepts the
 *      project credentials, then cache the winner in SUPABASE_REGION_CACHE
 *      (env / file) so subsequent runs skip the probe.
 */
import { Client } from 'pg'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const file = process.argv[2]
if (!file) {
  console.error('Usage: tsx scripts/run-migration.ts <path-to-sql>')
  process.exit(1)
}

const sql = readFileSync(resolve(file), 'utf8')
console.log(`Applying ${file} (${sql.length} bytes)…`)

const PROJECT_REF = 'oklwywuxglaefchjbhcw'
const DB_PASSWORD = 'Yakiradler1123'

const here = dirname(fileURLToPath(import.meta.url))
const cacheFile = join(here, '.region-cache')

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
  // 1) Direct (IPv6-only on most networks, but free when it works).
  const direct = await tryConnect({
    host: `db.${PROJECT_REF}.supabase.co`,
    port: 5432,
    user: 'postgres',
    label: `direct db.${PROJECT_REF}.supabase.co:5432`,
  })
  if (direct) return direct

  // 2) Cached pooler region+prefix.
  // Supabase has two pooler generations: legacy `aws-0-<region>` and
  // newer `aws-1-<region>`. We try both per region.
  const cached = process.env.SUPABASE_POOLER_REGION
    ?? (existsSync(cacheFile) ? readFileSync(cacheFile, 'utf8').trim() : '')
  if (cached) {
    const [prefix, ...rest] = cached.split(':')
    // Backward-compat: if cache stored just a region, default to aws-1.
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
    console.log('  (cached pooler failed; re-probing)')
  }

  // 3) Probe common regions across both pooler generations.
  const regions = [
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
    'eu-central-1', 'eu-central-2', 'eu-west-1', 'eu-west-2', 'eu-west-3',
    'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
    'ap-south-1', 'sa-east-1', 'ca-central-1',
  ]
  for (const poolerPrefix of ['aws-1', 'aws-0']) {
    for (const r of regions) {
      const c = await tryConnect({
        host: `${poolerPrefix}-${r}.pooler.supabase.com`,
        port: 6543,
        user: `postgres.${PROJECT_REF}`,
        label: `pooler ${poolerPrefix}-${r}`,
      })
      if (c) {
        try { writeFileSync(cacheFile, `${poolerPrefix}:${r}`) } catch { /* non-fatal */ }
        return c
      }
    }
  }

  throw new Error(
    'Could not reach Supabase. Direct host is IPv6-only on this network and no pooler region accepted the project credentials. ' +
    'Set SUPABASE_POOLER_REGION env var (e.g. eu-central-1) and re-run.',
  )
}

const c = await connect()
// Surface RAISE NOTICE output so verification blocks in migrations
// (like "yakir00010 role: admin") show up in the run log.
c.on('notice', (n) => console.log(`  [notice] ${n.message}`))
try {
  await c.query(sql)
  console.log('✓ Migration applied.')
  // Show resulting columns for sanity.
  const cols = await c.query(
    `select column_name, data_type
       from information_schema.columns
      where table_schema = 'public' and table_name = 'members'
      order by ordinal_position`,
  )
  console.log('members columns now:')
  for (const r of cols.rows) console.log(' -', r.column_name, r.data_type)
} catch (e) {
  console.error('✗ Migration failed:', e)
  process.exitCode = 1
} finally {
  await c.end()
}
