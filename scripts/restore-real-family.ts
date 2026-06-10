/**
 * Restore the REAL Adler family (~73 members) into a NEW tree on the
 * live Supabase project.
 *
 * Source of truth: the pre-rewrite seed file preserved in git history
 * (commit 83c7aaa, last version before "chore(demo): replace 84-member
 * seed with 7-member nuclear family"). The data is extracted at
 * runtime via `git show` so the real names do NOT live in the current
 * working tree.
 *
 * Usage:
 *   npx tsx scripts/restore-real-family.ts --dry-run
 *   npx tsx scripts/restore-real-family.ts --yes
 *
 * What it does (one transaction):
 *   1. Creates the tree "משפחת אדלר" owned by the admin profile
 *      (errors out if a tree by that name already exists — rename or
 *      delete it first).
 *   2. Inserts all members from the historical seed with fresh UUIDs.
 *   3. Re-links all relationships. The historical data predates spouse
 *      statuses; every spouse edge imports as 'current' EXCEPT
 *      לאה צירל ↔ נתנאל (her FIRST husband per the historical bio
 *      comment) which imports as 'ex' so the layout doesn't flag two
 *      current spouses. The owner should review this in the app.
 */
import { Client } from 'pg'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const SOURCE_COMMIT = '83c7aaa'
const TREE_NAME = 'משפחת אדלר'
const TREE_COLOR = '#34C759'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const confirmed = args.includes('--yes')
if (!dryRun && !confirmed) {
  console.error('Refusing to modify the live DB without --yes (use --dry-run to preview).')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

// ── 1. Extract the historical seed module and import it ─────────────
const oldSource = execSync(`git show ${SOURCE_COMMIT}:src/data/adlerFamily.ts`, {
  cwd: repoRoot,
  encoding: 'utf8',
})
// The historical file imports types from '../types' — rewrite the
// import so the temp module (which lives in scripts/) resolves it.
const patched = oldSource.replace("from '../types'", "from '../src/types'")
const tmpFile = join(repoRoot, 'scripts', '.real-family.tmp.ts')
writeFileSync(tmpFile, patched, 'utf8')

interface OldMember {
  id: string
  first_name: string
  last_name: string
  nickname?: string
  bio?: string
  birth_date?: string
  death_date?: string
  gender?: string
  birth_order?: number | null
  lineage?: string | null
  hidden?: boolean
}
interface OldRel {
  id: string
  member_a_id: string
  member_b_id: string
  type: string
  status?: string | null
}

const mod = (await import(pathToFileURL(tmpFile).href)) as {
  ADLER_MEMBERS: OldMember[]
  ADLER_RELATIONSHIPS: OldRel[]
}
const members = mod.ADLER_MEMBERS
const rels = mod.ADLER_RELATIONSHIPS
rmSync(tmpFile)
console.log(`Loaded historical seed: ${members.length} members, ${rels.length} relationships`)

// ── 2. Connection (same strategy as run-migration.ts) ───────────────
const PROJECT_REF = 'wkbdqdytfjycbbcnzjuv'
const DB_PASSWORD = 'Yakiradler1123'
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
  throw new Error('Could not reach Supabase — set SUPABASE_POOLER_REGION (e.g. eu-central-1) and re-run.')
}

const c = await connect()
try {
  // Owner = the admin profile (first admin row).
  const admin = await c.query(
    `select id, full_name from public.profiles where role = 'admin' order by created_at limit 1`,
  )
  if (admin.rows.length === 0) throw new Error('No admin profile found')
  const ownerId: string = admin.rows[0].id
  console.log(`Owner: ${admin.rows[0].full_name} (${ownerId})`)

  const existing = await c.query('select id from public.family_trees where name = $1', [TREE_NAME])
  if (existing.rows.length > 0) {
    console.error(`✗ A tree named "${TREE_NAME}" already exists (${existing.rows[0].id}). Rename it first (the demo-reseed step does that).`)
    process.exit(1)
  }

  if (dryRun) {
    console.log(`--dry-run: would create tree "${TREE_NAME}" with ${members.length} members + ${rels.length} relationships. No changes made.`)
    process.exit(0)
  }

  await c.query('begin')

  const tree = await c.query(
    `insert into public.family_trees (name, description, color, created_by)
     values ($1, $2, $3, $4) returning id`,
    [TREE_NAME, 'העץ המשפחתי האמיתי', TREE_COLOR, ownerId],
  )
  const treeId: string = tree.rows[0].id
  console.log(`  created tree ${treeId}`)

  const idMap = new Map<string, string>()
  for (const m of members) {
    const res = await c.query(
      `insert into public.members
         (first_name, last_name, nickname, birth_date, death_date, bio,
          gender, birth_order, lineage, hidden, tree_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning id`,
      [
        m.first_name, m.last_name ?? '', m.nickname ?? null,
        m.birth_date ?? null, m.death_date ?? null, m.bio ?? null,
        m.gender ?? null, m.birth_order ?? null, m.lineage ?? null,
        m.hidden ?? false, treeId, ownerId,
      ],
    )
    idMap.set(m.id, res.rows[0].id)
  }
  console.log(`  inserted ${idMap.size} members`)

  let relCount = 0
  for (const r of rels) {
    const a = idMap.get(r.member_a_id)
    const b = idMap.get(r.member_b_id)
    if (!a || !b) throw new Error(`Relationship references unknown member: ${r.member_a_id} → ${r.member_b_id}`)
    // Historical data predates spouse statuses. לאה צירל (c01) had two
    // husbands; her FIRST (s01, per the bio comment) imports as 'ex'
    // so the tree doesn't carry two current spouses. Owner to verify.
    const status =
      r.type === 'spouse'
        ? (r.member_a_id === 'c01' && r.member_b_id === 's01' ? 'ex' : (r.status ?? 'current'))
        : null
    await c.query(
      `insert into public.relationships (member_a_id, member_b_id, type, status)
       values ($1,$2,$3,$4)`,
      [a, b, r.type, status],
    )
    relCount++
  }
  console.log(`  inserted ${relCount} relationships`)

  await c.query('commit')
  console.log(`✓ Real family restored into tree "${TREE_NAME}".`)
} catch (e) {
  try { await c.query('rollback') } catch { /* ignore */ }
  console.error('✗ Restore failed (rolled back):', e)
  process.exitCode = 1
} finally {
  await c.end()
}
