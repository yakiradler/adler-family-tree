/**
 * Wipe the Adler population on Frankfurt and reseed with the
 * 7-member nuclear family used as the "base rebuild" smoke surface.
 *
 * Usage:
 *   npx tsx scripts/wipe-and-reseed.ts --confirm
 *
 * The --confirm flag is mandatory — without it the script prints
 * what it would do and exits without writing anything. This is
 * production data; we don't want a misclick to nuke the live tree.
 *
 * Scope:
 *   • Deletes EVERY public.members + public.relationships row whose
 *     created_by is the Adler owner. Other users (if any) are
 *     untouched.
 *   • Drops any default tree migration 011 created for that owner
 *     ("עץ של ...") so the seed below can claim the canonical tree
 *     row with its own id.
 *   • Inserts the 7-member seed (with tree_id pointing at the new
 *     'Adler nuclear' tree) and the 8 relationships that wire them
 *     together.
 *
 * Why this exists:
 *   The base-rebuild plan assumes a small surface (7 members) so
 *   layout / isolation regressions surface immediately. The live
 *   84-member population masks them — fixes that look OK on
 *   localhost reappear when scaled. Resetting to nuclear gives us
 *   a deterministic, fast-iterating loop.
 */
import { Client } from 'pg'
import { readFileSync, writeFileSync, existsSync } from 'fs'
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
  try { await c.connect(); console.log(`✓ Connected via ${opts.label}`); return c }
  catch (e) {
    console.log(`  ✗ ${opts.label}: ${(e instanceof Error ? e.message : String(e)).slice(0, 110)}`)
    try { await c.end() } catch { /* ignore */ }
    return null
  }
}

async function connect(): Promise<Client> {
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
  throw new Error('No cached pooler region — run a migration first to populate scripts/.region-cache')
}

const OWNER_EMAILS = ['yakir@davidvatine.co.il', 'yakir00010@gmail.com', 'yakir17ari@gmail.com']
const NUCLEAR_TREE_ID = '00000000-0000-4000-8000-000000000001' // deterministic v4-shaped UUID

// Generic 7-member family, 3 generations. Chosen for symmetry testing:
//   • Gen 0: Grandfather + Grandmother
//   • Gen 1: Father + Mother
//   • Gen 2: Son + Daughter (centre) + Son  (3 siblings — odd count so
//           the middle child sits directly under the parents)
// birth_order is set explicitly so the layout engine can place
// siblings deterministically (oldest → middle → youngest).
const SEED_MEMBERS = [
  { id: '00000000-0000-4000-8000-000000000010', first_name: 'סבא',   last_name: 'דוגמה', gender: 'male',   birth_date: '1940-01-01', birth_order: null },
  { id: '00000000-0000-4000-8000-000000000011', first_name: 'סבתא',  last_name: 'דוגמה', gender: 'female', birth_date: '1942-01-01', birth_order: null },
  { id: '00000000-0000-4000-8000-000000000012', first_name: 'אבא',   last_name: 'דוגמה', gender: 'male',   birth_date: '1968-01-01', birth_order: null },
  { id: '00000000-0000-4000-8000-000000000013', first_name: 'אמא',   last_name: 'דוגמה', gender: 'female', birth_date: '1970-01-01', birth_order: null },
  { id: '00000000-0000-4000-8000-000000000014', first_name: 'בן א\'', last_name: 'דוגמה', gender: 'male',   birth_date: '1992-01-01', birth_order: 1 },
  { id: '00000000-0000-4000-8000-000000000015', first_name: 'בת',    last_name: 'דוגמה', gender: 'female', birth_date: '1995-01-01', birth_order: 2 },
  { id: '00000000-0000-4000-8000-000000000016', first_name: 'בן ב\'', last_name: 'דוגמה', gender: 'male',   birth_date: '1998-01-01', birth_order: 3 },
] as const

const SEED_RELATIONSHIPS = [
  // Gen 0 marriage
  { a: SEED_MEMBERS[0].id, b: SEED_MEMBERS[1].id, type: 'spouse', status: 'current' },
  // Grandparents → father
  { a: SEED_MEMBERS[0].id, b: SEED_MEMBERS[2].id, type: 'parent-child' },
  { a: SEED_MEMBERS[1].id, b: SEED_MEMBERS[2].id, type: 'parent-child' },
  // Gen 1 marriage
  { a: SEED_MEMBERS[2].id, b: SEED_MEMBERS[3].id, type: 'spouse', status: 'current' },
  // Parents → 3 children
  { a: SEED_MEMBERS[2].id, b: SEED_MEMBERS[4].id, type: 'parent-child' },
  { a: SEED_MEMBERS[3].id, b: SEED_MEMBERS[4].id, type: 'parent-child' },
  { a: SEED_MEMBERS[2].id, b: SEED_MEMBERS[5].id, type: 'parent-child' },
  { a: SEED_MEMBERS[3].id, b: SEED_MEMBERS[5].id, type: 'parent-child' },
  { a: SEED_MEMBERS[2].id, b: SEED_MEMBERS[6].id, type: 'parent-child' },
  { a: SEED_MEMBERS[3].id, b: SEED_MEMBERS[6].id, type: 'parent-child' },
]

const client = await connect()

try {
  // Locate the Adler owner.
  const userRes = await client.query<{
    id: string; email: string
  }>(
    `select id, email from auth.users where email = any($1::text[])`,
    [OWNER_EMAILS],
  )
  if (userRes.rowCount === 0) {
    throw new Error(`No auth.users row matches any of: ${OWNER_EMAILS.join(', ')}`)
  }
  // Prefer yakir00010@gmail.com if multiple match — that's the admin
  // per the memory note, others are aliases.
  const owner =
    userRes.rows.find(r => r.email === 'yakir00010@gmail.com')
    ?? userRes.rows[0]
  console.log(`Owner: ${owner.email} (${owner.id})`)

  // Tally what we'd touch.
  const countRes = await client.query<{ members: string; rels: string }>(
    `select
       (select count(*) from public.members where created_by = $1)::text as members,
       (select count(*) from public.relationships r
          join public.members m on m.id = r.member_a_id
          where m.created_by = $1)::text as rels`,
    [owner.id],
  )
  const tally = countRes.rows[0]
  console.log(`Current owned data — members: ${tally.members}, relationships: ${tally.rels}`)
  console.log(`Will replace with: ${SEED_MEMBERS.length} members, ${SEED_RELATIONSHIPS.length} relationships`)

  if (!confirmed) {
    console.log('\n--confirm flag missing. Nothing written. Re-run with --confirm to proceed.')
    process.exit(0)
  }

  await client.query('begin')

  // 1. Drop relationships first (FK cascade would handle it, but
  // explicit is safer with the cross-tree trigger active).
  await client.query(
    `delete from public.relationships
       where member_a_id in (select id from public.members where created_by = $1)
          or member_b_id in (select id from public.members where created_by = $1)`,
    [owner.id],
  )

  // 2. Drop owned member_notes (cascade not guaranteed for the demo
  // table; idempotent if missing).
  try {
    await client.query(
      `delete from public.member_notes where author_id = $1 or member_id in (select id from public.members where created_by = $1)`,
      [owner.id],
    )
  } catch { /* table may not exist on this deployment */ }

  // 3. Drop owned members.
  await client.query(`delete from public.members where created_by = $1`, [owner.id])

  // 4. Drop any default tree migration 011 created for this owner —
  // we want the seed below to claim the canonical 'Adler nuclear' tree.
  await client.query(`delete from public.family_trees where created_by = $1`, [owner.id])

  // 5. Create the canonical seed tree.
  await client.query(
    `insert into public.family_trees (id, name, description, color, created_by)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do update set
       name = excluded.name,
       description = excluded.description,
       color = excluded.color`,
    [NUCLEAR_TREE_ID, 'משפחת אדלר', 'משפחה גרעינית — בסיס לבנייה מחדש', '#007AFF', owner.id],
  )

  // 6. Insert the 7 seed members.
  for (const m of SEED_MEMBERS) {
    await client.query(
      `insert into public.members (id, first_name, last_name, gender, birth_date, hidden, tree_id, created_by)
       values ($1, $2, $3, $4, $5::date, $6, $7, $8)`,
      [
        m.id, m.first_name, m.last_name, m.gender,
        'birth_date' in m ? m.birth_date : null,
        'hidden' in m ? m.hidden : false,
        NUCLEAR_TREE_ID, owner.id,
      ],
    )
  }

  // 7. Insert relationships.
  for (const r of SEED_RELATIONSHIPS) {
    await client.query(
      `insert into public.relationships (member_a_id, member_b_id, type, status)
       values ($1, $2, $3, $4)`,
      [r.a, r.b, r.type, 'status' in r ? r.status : null],
    )
  }

  await client.query('commit')
  console.log(`✓ Wipe + reseed complete: ${SEED_MEMBERS.length} members, ${SEED_RELATIONSHIPS.length} relationships under tree ${NUCLEAR_TREE_ID}`)

  // Verification.
  const finalCount = await client.query<{ members: string; rels: string; trees: string }>(
    `select
       (select count(*) from public.members where created_by = $1)::text as members,
       (select count(*) from public.relationships r
          join public.members m on m.id = r.member_a_id
          where m.created_by = $1)::text as rels,
       (select count(*) from public.family_trees where created_by = $1)::text as trees`,
    [owner.id],
  )
  console.log(`Verification — members: ${finalCount.rows[0].members}, rels: ${finalCount.rows[0].rels}, trees: ${finalCount.rows[0].trees}`)
  // Touch cache (no-op if already correct) so subsequent runs reuse the region.
  writeFileSync(cacheFile, readFileSync(cacheFile, 'utf8'))
} catch (e) {
  console.error('✗ Reseed failed:', e)
  try { await client.query('rollback') } catch { /* ignore */ }
  process.exitCode = 1
} finally {
  await client.end()
}
