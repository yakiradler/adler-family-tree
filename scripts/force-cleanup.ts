/**
 * Force-cleanup: aggressively remove every leftover tree owned by
 * yakir (or with NULL ownership) on Frankfurt, leaving ONLY the
 * canonical "משפחה לדוגמה" with the deterministic 7-member seed.
 *
 * Usage:  npx tsx scripts/force-cleanup.ts --confirm
 */
import { Client } from 'pg'
import { readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const confirmed = process.argv.includes('--confirm')

const PROJECT_REF = 'wkbdqdytfjycbbcnzjuv'
const DB_PASSWORD = 'Yakiradler1123'

const here = dirname(fileURLToPath(import.meta.url))
const cacheFile = join(here, '.region-cache')

async function tryConnect(opts: {
  host: string; port: number; user: string; label: string
}): Promise<Client | null> {
  const c = new Client({
    host: opts.host, port: opts.port,
    database: 'postgres', user: opts.user, password: DB_PASSWORD,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 6000,
  })
  try { await c.connect(); console.log(`✓ ${opts.label}`); return c }
  catch { try { await c.end() } catch { /* ignore */ } return null }
}

async function connect(): Promise<Client> {
  const cached = existsSync(cacheFile) ? readFileSync(cacheFile, 'utf8').trim() : ''
  if (!cached) throw new Error('No region cache')
  const [prefix, ...rest] = cached.split(':')
  const [poolerPrefix, region] = rest.length ? [prefix, rest.join(':')] : ['aws-1', cached]
  const c = await tryConnect({
    host: `${poolerPrefix}-${region}.pooler.supabase.com`,
    port: 6543,
    user: `postgres.${PROJECT_REF}`,
    label: `pooler ${poolerPrefix}-${region}`,
  })
  if (!c) throw new Error('Cannot connect')
  return c
}

const client = await connect()

try {
  // List every tree currently in the DB and who owns it.
  const treeRes = await client.query<{
    id: string; name: string; created_by: string | null; email: string | null
  }>(
    `select t.id, t.name, t.created_by, u.email
       from public.family_trees t
       left join auth.users u on u.id = t.created_by
       order by t.created_at`,
  )
  console.log('Current family_trees in Frankfurt:')
  for (const r of treeRes.rows) {
    const members = await client.query<{ c: string }>(
      `select count(*)::text as c from public.members where tree_id = $1`,
      [r.id],
    )
    console.log(`  • ${r.id} :: "${r.name}" :: created_by=${r.email ?? 'NULL'} :: members=${members.rows[0].c}`)
  }

  if (!confirmed) {
    console.log('\n--confirm flag missing. Nothing deleted.')
    process.exit(0)
  }

  // Keep only the canonical demo tree id.
  const KEEP_ID = '00000000-0000-4000-8000-000000000001'
  await client.query('begin')

  // Delete every tree that is not the canonical one. Cascade will
  // take care of relationships via the FK on members.
  const toDrop = treeRes.rows.filter((r) => r.id !== KEEP_ID).map((r) => r.id)
  if (toDrop.length === 0) {
    console.log('Nothing to delete.')
    await client.query('rollback')
    process.exit(0)
  }
  console.log(`Deleting ${toDrop.length} tree(s):`, toDrop)

  // Step 1: delete all members in those trees (cascades to relationships).
  await client.query(
    `delete from public.relationships
       where member_a_id in (select id from public.members where tree_id = any($1::uuid[]))
          or member_b_id in (select id from public.members where tree_id = any($1::uuid[]))`,
    [toDrop],
  )
  try {
    await client.query(
      `delete from public.member_notes where member_id in (select id from public.members where tree_id = any($1::uuid[]))`,
      [toDrop],
    )
  } catch { /* table may not exist */ }
  await client.query(
    `delete from public.members where tree_id = any($1::uuid[])`,
    [toDrop],
  )
  await client.query(
    `delete from public.family_trees where id = any($1::uuid[])`,
    [toDrop],
  )

  await client.query('commit')

  // Verify
  const finalRes = await client.query<{ c: string }>(
    `select count(*)::text as c from public.family_trees`,
  )
  const finalMembers = await client.query<{ c: string }>(
    `select count(*)::text as c from public.members`,
  )
  const finalRels = await client.query<{ c: string }>(
    `select count(*)::text as c from public.relationships`,
  )
  console.log(`\n✓ Cleanup complete. Now: ${finalRes.rows[0].c} tree(s), ${finalMembers.rows[0].c} members, ${finalRels.rows[0].c} relationships.`)
} catch (e) {
  console.error('✗ Cleanup failed:', e)
  try { await client.query('rollback') } catch { /* ignore */ }
  process.exitCode = 1
} finally {
  await client.end()
}
