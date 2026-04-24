import { Client } from 'pg'
import { buildLayout, NODE_W } from '../src/components/views/treeLayout'
import type { Member, Relationship } from '../src/types'

const DB =
  'postgresql://postgres:Yakiradler1123@db.oklwywuxglaefchjbhcw.supabase.co:5432/postgres'

async function main() {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const mRes = await c.query(
    `SELECT id, first_name, last_name, nickname, birth_date::text, death_date::text,
            hebrew_birth_date, hebrew_death_date, bio, photo_url, gender, birth_order, created_by
       FROM members`,
  )
  const rRes = await c.query(`SELECT id, member_a_id, member_b_id, type FROM relationships`)
  const members = mRes.rows as Member[]
  const relationships = rRes.rows as Relationship[]
  await c.end()

  const R = members.find(m => m.first_name === 'רחל לאה' && m.last_name === 'אדלר')!
  const N = members.find(m => m.first_name === 'נחום אליהו' && m.last_name === 'עמית')!
  console.log('R id:', R.id)
  console.log('N id:', N.id)

  console.log('\nR relationships:')
  for (const r of relationships)
    if (r.member_a_id === R.id || r.member_b_id === R.id) {
      const a = members.find(m => m.id === r.member_a_id)
      const b = members.find(m => m.id === r.member_b_id)
      console.log(`  ${r.type}: ${a?.first_name} ${a?.last_name} → ${b?.first_name} ${b?.last_name}`)
    }
  console.log('\nN relationships:')
  for (const r of relationships)
    if (r.member_a_id === N.id || r.member_b_id === N.id) {
      const a = members.find(m => m.id === r.member_a_id)
      const b = members.find(m => m.id === r.member_b_id)
      console.log(`  ${r.type}: ${a?.first_name} ${a?.last_name} → ${b?.first_name} ${b?.last_name}`)
    }

  const nodes = buildLayout(members, relationships, 'classic')
  const rN = nodes.find(n => n.member.id === R.id)!
  const nN = nodes.find(n => n.member.id === N.id)!
  console.log(`\nClassic layout:`)
  console.log(`  R: x=${Math.round(rN.x)} y=${Math.round(rN.y)} gen=${rN.generation}`)
  console.log(`  N: x=${Math.round(nN.x)} y=${Math.round(nN.y)} gen=${nN.generation}`)
  console.log(`  dx=${Math.round(nN.x - rN.x)} (expected: ±${NODE_W + 22} for coupled spouses)`)

  // Check: do N and R share any children?
  const childrenOfR = new Set(
    relationships.filter(r => r.type === 'parent-child' && r.member_a_id === R.id).map(r => r.member_b_id),
  )
  const childrenOfN = new Set(
    relationships.filter(r => r.type === 'parent-child' && r.member_a_id === N.id).map(r => r.member_b_id),
  )
  console.log(`\n  R has ${childrenOfR.size} owned children:`, [...childrenOfR].map(id => members.find(m => m.id === id)?.first_name))
  console.log(`  N has ${childrenOfN.size} owned children:`, [...childrenOfN].map(id => members.find(m => m.id === id)?.first_name))

  // Show N's and R's full ancestors up to roots
  const parentsOf = new Map<string, string[]>()
  for (const r of relationships)
    if (r.type === 'parent-child') {
      if (!parentsOf.has(r.member_b_id)) parentsOf.set(r.member_b_id, [])
      parentsOf.get(r.member_b_id)!.push(r.member_a_id)
    }
  function ancestors(id: string): string[] {
    const out: string[] = []
    let queue = [id]
    while (queue.length) {
      const next: string[] = []
      for (const q of queue) {
        for (const p of parentsOf.get(q) ?? []) {
          const pm = members.find(m => m.id === p)
          if (pm) { out.push(`${pm.first_name} ${pm.last_name}`); next.push(p) }
        }
      }
      queue = next
    }
    return out
  }
  console.log(`\n  R ancestors: ${ancestors(R.id).join(' / ')}`)
  console.log(`  N ancestors: ${ancestors(N.id).join(' / ')}`)

  // Find x-positions of their immediate siblings in gen 2
  const gen2 = nodes.filter(n => n.generation === 2).sort((a, b) => a.x - b.x)
  console.log('\n  Gen 2 members by x:')
  for (const g of gen2) {
    console.log(`    x=${Math.round(g.x).toString().padStart(5)} y=${Math.round(g.y)}  ${g.member.first_name} ${g.member.last_name}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
