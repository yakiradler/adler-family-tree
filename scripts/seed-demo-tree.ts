/**
 * Replace the LIVE demo tree's population with the 10-generation pilot
 * dataset from src/data/adlerFamily.ts (single source of truth — edit
 * the seed there, never here).
 *
 * Usage:
 *   npx tsx scripts/seed-demo-tree.ts --tree "משפחת אדלר" --dry-run
 *   npx tsx scripts/seed-demo-tree.ts --tree "משפחת אדלר" --yes
 *
 * What it does (inside ONE transaction):
 *   1. Resolves the target tree by name (must match exactly one row).
 *   2. Deletes all relationships touching the tree's current members,
 *      then the members themselves (the old placeholder population).
 *   3. Inserts the seed members with fresh UUIDs (created_by = the
 *      tree's owner) and re-links all seed relationships.
 *
 * Safety:
 *   * Refuses to run without --yes (or with --dry-run, which only
 *     prints what WOULD happen).
 *   * Take a snapshot first: npx tsx scripts/export-snapshot.ts
 */
import { Client } from 'pg'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { ADLER_MEMBERS, ADLER_RELATIONSHIPS } from '../src/data/adlerFamily'

const args = process.argv.slice(2)
function argValue(flag: string): string | null {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : null
}
const treeName = argValue('--tree')
const dryRun = args.includes('--dry-run')
const confirmed = args.includes('--yes')

if (!treeName) {
  console.error('Usage: tsx scripts/seed-demo-tree.ts --tree "<tree name>" [--dry-run | --yes]')
  process.exit(1)
}
if (!dryRun && !confirmed) {
  console.error('Refusing to modify the live DB without --yes (use --dry-run to preview).')
  process.exit(1)
}

// ── Connection (same strategy as run-migration.ts) ───────────────────
const PROJECT_REF = 'wkbdqdytfjycbbcnzjuv'
const DB_PASSWORD = 'Yakiradler1123'
const here = dirname(fileURLToPath(import.meta.url))
const cacheFile = join(here, '.region-cache')

async function tryConnect(opts: { host: string; port: number; user: string; label: string }): Promise<Client | null> {
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
    console.log(`  ✗ ${opts.label}: ${(e instanceof Error ? e.message : String(e)).slice(0, 110)}`)
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
    const [poolerPrefix, region] = rest.length ? [prefix, rest.join(':')] : ['aws-1', cached]
    const c = await tryConnect({
      host: `${poolerPrefix}-${region}.pooler.supabase.com`,
      port: 6543,
      user: `postgres.${PROJECT_REF}`,
      label: `pooler ${poolerPrefix}-${region} (cached)`,
    })
    if (c) return c
  }
  const regions = [
    'eu-central-1', 'eu-central-2', 'eu-west-1', 'eu-west-2', 'eu-west-3',
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
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
  throw new Error('Could not reach Supabase — set SUPABASE_POOLER_REGION and re-run.')
}

const c = await connect()
try {
  // 1) Resolve the target tree.
  const trees = await c.query(
    'select id, name, created_by from public.family_trees where name = $1',
    [treeName],
  )
  if (trees.rows.length !== 1) {
    console.error(`✗ Expected exactly one tree named "${treeName}", found ${trees.rows.length}.`)
    const all = await c.query('select name from public.family_trees order by created_at')
    console.error('  Available trees:', all.rows.map((r) => r.name).join(' · '))
    process.exit(1)
  }
  const treeId: string = trees.rows[0].id
  const ownerId: string = trees.rows[0].created_by
  const existing = await c.query(
    'select count(*)::int as n from public.members where tree_id = $1',
    [treeId],
  )
  console.log(`Target tree "${treeName}" (${treeId})`)
  console.log(`  current members: ${existing.rows[0].n} → will be replaced by ${ADLER_MEMBERS.length} seed members`)
  console.log(`  owner (created_by for new rows): ${ownerId}`)

  if (dryRun) {
    console.log('--dry-run: no changes made.')
    process.exit(0)
  }

  await c.query('begin')

  // 2) Clear the old population. Relationships cascade from members,
  //    but delete them explicitly first so cross-tree edges (if any)
  //    can't dangle.
  const delRels = await c.query(
    `delete from public.relationships
      where member_a_id in (select id from public.members where tree_id = $1)
         or member_b_id in (select id from public.members where tree_id = $1)`,
    [treeId],
  )
  const delMembers = await c.query(
    'delete from public.members where tree_id = $1',
    [treeId],
  )
  console.log(`  deleted ${delRels.rowCount} relationships, ${delMembers.rowCount} members`)

  // 3) Insert seed members; map seed ids → fresh DB UUIDs.
  const idMap = new Map<string, string>()
  for (const m of ADLER_MEMBERS) {
    const res = await c.query(
      `insert into public.members
         (first_name, last_name, maiden_name, nickname, birth_date, death_date,
          bio, photo_url, gender, birth_order, lineage, tree_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning id`,
      [
        m.first_name, m.last_name, m.maiden_name ?? null, m.nickname ?? null,
        m.birth_date ?? null, m.death_date ?? null, m.bio ?? null,
        m.photo_url ?? null, m.gender ?? null, m.birth_order ?? null,
        m.lineage ?? null, treeId, ownerId,
      ],
    )
    idMap.set(m.id, res.rows[0].id)
  }
  console.log(`  inserted ${idMap.size} members`)

  // 4) Re-link relationships through the id map.
  let relCount = 0
  for (const r of ADLER_RELATIONSHIPS) {
    const a = idMap.get(r.member_a_id)
    const b = idMap.get(r.member_b_id)
    if (!a || !b) throw new Error(`Seed relationship references unknown member: ${r.member_a_id} → ${r.member_b_id}`)
    await c.query(
      `insert into public.relationships (member_a_id, member_b_id, type, status)
       values ($1,$2,$3,$4)`,
      [a, b, r.type, r.status ?? null],
    )
    relCount++
  }
  console.log(`  inserted ${relCount} relationships`)

  await c.query('commit')
  console.log('✓ Demo tree reseeded.')
} catch (e) {
  try { await c.query('rollback') } catch { /* ignore */ }
  console.error('✗ Seeding failed (rolled back):', e)
  process.exitCode = 1
} finally {
  await c.end()
}
