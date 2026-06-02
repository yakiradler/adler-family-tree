/**
 * One-off migration: copy schema + data from Mumbai (ap-south-1) to
 * the new Frankfurt (eu-central-1) project.
 *
 * Order matters:
 *   1. Apply schema.sql + migrations 006 + 009 to Frankfurt (idempotent).
 *   2. Temporarily disable the on_auth_user_created trigger so we can
 *      insert auth.users rows without the trigger auto-creating profile
 *      stubs that conflict with the real profile rows we copy next.
 *   3. Copy auth.users + auth.identities (preserves password hashes, so
 *      users can keep logging in with the same password).
 *   4. Re-enable the trigger.
 *   5. Copy public.* tables in FK dependency order.
 *   6. Verify row counts match.
 *
 * Safe to re-run. Each table uses INSERT ... ON CONFLICT DO NOTHING
 * (or DO UPDATE for profiles) so a partial previous run won't break it.
 */
import { Client } from 'pg'
import { readFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')

const PASSWORD = 'Yakiradler1123'

// Port 5432 = session mode pooler (one client = one Postgres backend).
// Required for schema scripts: transaction mode (6543) breaks SQL-language
// functions that reference tables defined later in the same script,
// because each statement runs in its own connection so dependencies
// can't be resolved across the multi-statement script.
const OLD = {
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.oklwywuxglaefchjbhcw',
  database: 'postgres',
  password: PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
}

const NEW = {
  host: 'aws-1-eu-central-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.wkbdqdytfjycbbcnzjuv',
  database: 'postgres',
  password: PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
}

// FK dependency order — parents before children so inserts don't fail.
// profiles depends on auth.users (copied earlier), then everything in
// public depends on profiles or family_trees in a fan-out shape.
const PUBLIC_TABLES_IN_ORDER = [
  'profiles',
  'family_trees',
  'tree_access',
  'members',
  'relationships',
  'edit_requests',
  'access_requests',
  'tree_invites',
] as const

async function step(label: string, fn: () => Promise<void>) {
  console.log(`\n── ${label} ──`)
  await fn()
}

async function applySchema(dst: Client) {
  // schema.sql defines `public.is_admin(uid)` as a SQL function that
  // references `public.profiles` BEFORE the profiles table itself is
  // created later in the file. SQL-language function bodies are
  // validated at CREATE time when check_function_bodies is on (default),
  // which fails here. Turn it off for the script — Postgres will still
  // catch real bugs the first time the function actually runs.
  await dst.query('set check_function_bodies = off')
  dst.on('notice', (n) => console.log(`    [notice] ${n.message}`))
  for (const file of ['schema.sql', 'migrations/006_user_soft_delete.sql', 'migrations/009_trees_select_via_access.sql']) {
    const path = join(projectRoot, file)
    const sql = readFileSync(path, 'utf8')
    console.log(`  applying ${file} (${sql.length} bytes)…`)
    await dst.query(sql)
    console.log(`  ✓ ${file}`)
  }
  await dst.query('set check_function_bodies = on')
}

async function getColumns(c: Client, schema: string, table: string): Promise<string[]> {
  // Exclude generated columns (e.g. auth.users.confirmed_at) — Postgres
  // rejects any explicit value for them, even NULL.
  const r = await c.query(
    `select column_name from information_schema.columns
      where table_schema = $1 and table_name = $2
        and is_generated = 'NEVER'
      order by ordinal_position`,
    [schema, table],
  )
  return r.rows.map((row) => row.column_name as string)
}

async function getJsonColumns(c: Client, schema: string, table: string): Promise<Set<string>> {
  const r = await c.query(
    `select column_name from information_schema.columns
      where table_schema = $1 and table_name = $2
        and data_type in ('json', 'jsonb')`,
    [schema, table],
  )
  return new Set(r.rows.map((row) => row.column_name as string))
}

async function copyTable(
  src: Client,
  dst: Client,
  schema: string,
  table: string,
  options: { conflict?: 'do nothing' | 'do update'; pk?: string[]; updateCols?: string[] } = {},
) {
  const cols = await getColumns(src, schema, table)
  if (cols.length === 0) {
    console.log(`  ! ${schema}.${table} not found in source — skipping`)
    return { copied: 0, total: 0 }
  }
  const dstCols = await getColumns(dst, schema, table)
  // Only copy columns that exist in both.
  const shared = cols.filter((c) => dstCols.includes(c))
  if (shared.length !== cols.length) {
    const missing = cols.filter((c) => !shared.includes(c))
    console.log(`  ! columns dropped (not in dst): ${missing.join(', ')}`)
  }
  // pg returns jsonb values as JS objects/arrays. When we pass them back
  // as parameters, pg renders arrays in Postgres array syntax (`{...}`)
  // which fails on a jsonb column. Stringify them ourselves.
  const jsonCols = await getJsonColumns(src, schema, table)
  const quoted = shared.map((c) => `"${c}"`).join(', ')
  const rows = await src.query(`select ${quoted} from "${schema}"."${table}"`)
  const total = rows.rows.length
  if (total === 0) {
    console.log(`  · ${schema}.${table}: 0 rows`)
    return { copied: 0, total: 0 }
  }
  const placeholders = shared.map((_, i) => `$${i + 1}`).join(', ')
  let onConflict = ''
  if (options.conflict === 'do nothing') {
    onConflict = ' on conflict do nothing'
  } else if (options.conflict === 'do update' && options.pk && options.updateCols) {
    const setClauses = options.updateCols.map((c) => `"${c}" = excluded."${c}"`).join(', ')
    const pkCols = options.pk.map((c) => `"${c}"`).join(', ')
    onConflict = ` on conflict (${pkCols}) do update set ${setClauses}`
  }
  const sql = `insert into "${schema}"."${table}" (${quoted}) values (${placeholders})${onConflict}`
  let copied = 0
  for (const r of rows.rows) {
    const values = shared.map((c) => {
      const v = r[c]
      if (v !== null && jsonCols.has(c)) return JSON.stringify(v)
      return v
    })
    try {
      const res = await dst.query(sql, values)
      copied += res.rowCount ?? 0
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`  ✗ row failed in ${table}: ${msg.slice(0, 140)}`)
      throw e
    }
  }
  console.log(`  ✓ ${schema}.${table}: ${copied}/${total} rows`)
  return { copied, total }
}

async function main() {
  const src = new Client(OLD)
  const dst = new Client(NEW)
  await src.connect()
  console.log('✓ Connected to Mumbai (source)')
  await dst.connect()
  console.log('✓ Connected to Frankfurt (destination)')

  await step('1. Apply schema to Frankfurt', async () => {
    await applySchema(dst)
  })

  await step('2. Copy auth.users + auth.identities', async () => {
    // The pooler user does not own auth.users, so we cannot disable the
    // on_auth_user_created trigger. Instead, we let it fire (creating
    // stub profile rows) and then overwrite those stubs via UPSERT in
    // the profiles copy below.
    // Password hashes live in the encrypted_password column on auth.users
    // — keeping that column verbatim is what lets users keep their passwords.
    await copyTable(src, dst, 'auth', 'users', { conflict: 'do nothing' })
    await copyTable(src, dst, 'auth', 'identities', { conflict: 'do nothing' })
  })

  await step('3. Copy public.* tables', async () => {
    // For profiles we want UPDATE-on-conflict because the trigger may
    // have left stub rows if step 2 didn't fully suppress it.
    await copyTable(src, dst, 'public', 'profiles', {
      conflict: 'do update',
      pk: ['id'],
      updateCols: ['full_name', 'avatar_url', 'role', 'bio', 'onboarded_at', 'requested_role', 'master_permissions', 'active', 'deleted_at', 'created_at'],
    })
    for (const t of PUBLIC_TABLES_IN_ORDER) {
      if (t === 'profiles') continue
      await copyTable(src, dst, 'public', t, { conflict: 'do nothing' })
    }
  })

  await step('4. Clean up trigger-created stub profiles', async () => {
    // on_auth_user_created fires for each auth.users insert and seeds
    // a profile stub. For users whose profile was deleted in Mumbai
    // (e.g. soft-deleted accounts that were later hard-deleted), this
    // leaves Frankfurt with extra rows. Drop the extras so the row
    // counts match Mumbai exactly.
    const srcIds = await src.query('select id from public.profiles')
    const ids = srcIds.rows.map((r) => r.id as string)
    const res = await dst.query(
      `delete from public.profiles where id <> all($1::uuid[])`,
      [ids],
    )
    console.log(`  ✓ removed ${res.rowCount} stub profile(s) the trigger created`)
  })

  await step('5. Verify row counts match', async () => {
    const checks = [
      ['auth', 'users'],
      ['auth', 'identities'],
      ...PUBLIC_TABLES_IN_ORDER.map((t) => ['public', t] as const),
    ] as const
    let allGood = true
    for (const [schema, table] of checks) {
      const a = await src.query(`select count(*) as n from "${schema}"."${table}"`).catch(() => ({ rows: [{ n: 'err' }] }))
      const b = await dst.query(`select count(*) as n from "${schema}"."${table}"`).catch(() => ({ rows: [{ n: 'err' }] }))
      const match = a.rows[0].n === b.rows[0].n
      if (!match) allGood = false
      console.log(`  ${match ? '✓' : '✗'} ${schema}.${table}: src=${a.rows[0].n} dst=${b.rows[0].n}`)
    }
    if (!allGood) throw new Error('Row counts diverged — investigate before flipping env vars')
  })

  await src.end()
  await dst.end()
  console.log('\n✓ Migration complete.')
}

main().catch((e) => {
  console.error('\n✗ Migration failed:', e)
  process.exit(1)
})
