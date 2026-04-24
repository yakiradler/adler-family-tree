/**
 * Layout test — pulls the real Adler family from Supabase and verifies that
 * all 4 layout modes produce visibly different positions.
 *
 * Run:  npx tsx scripts/test-layouts.ts
 */

import { Client } from 'pg'
import {
  buildLayout,
  NODE_W,
  type LayoutMode,
  type LayoutNode,
} from '../src/components/views/treeLayout'
import type { Member, Relationship } from '../src/types'

const DB_URL =
  'postgresql://postgres:Yakiradler1123@db.oklwywuxglaefchjbhcw.supabase.co:5432/postgres'

async function fetchData(): Promise<{ members: Member[]; relationships: Relationship[] }> {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const mRes = await client.query(
      `SELECT id, first_name, last_name, nickname, birth_date::text,
              death_date::text, hebrew_birth_date, hebrew_death_date,
              bio, photo_url, gender, birth_order, created_by
         FROM members`,
    )
    const rRes = await client.query(
      `SELECT id, member_a_id, member_b_id, type FROM relationships`,
    )
    return {
      members: mRes.rows as Member[],
      relationships: rRes.rows as Relationship[],
    }
  } finally {
    await client.end()
  }
}

function bbox(nodes: LayoutNode[]) {
  if (!nodes.length) return { w: 0, h: 0 }
  const xs = nodes.map(n => n.x)
  const ys = nodes.map(n => n.y)
  return {
    w: Math.max(...xs.map(x => x + NODE_W)) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }
}

function positionKey(nodes: LayoutNode[]): string {
  // A deterministic signature of (id, round(x), round(y)) sorted by id.
  return [...nodes]
    .sort((a, b) => a.member.id.localeCompare(b.member.id))
    .map(n => `${n.member.id.slice(0, 6)}:${Math.round(n.x)},${Math.round(n.y)}`)
    .join('|')
}

function movedNodes(
  base: LayoutNode[],
  other: LayoutNode[],
): { n: number; samples: string[] } {
  const bm = new Map(base.map(n => [n.member.id, n]))
  let n = 0
  const samples: string[] = []
  for (const o of other) {
    const b = bm.get(o.member.id)
    if (!b) continue
    const dx = Math.round(o.x - b.x)
    const dy = Math.round(o.y - b.y)
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      n++
      if (samples.length < 4)
        samples.push(
          `  ${o.member.first_name} ${o.member.last_name}: Δx=${dx} Δy=${dy}`,
        )
    }
  }
  return { n, samples }
}

async function main() {
  console.log('→ Connecting to Supabase…')
  const { members, relationships } = await fetchData()
  console.log(`   ${members.length} members · ${relationships.length} relationships\n`)

  const modes: LayoutMode[] = ['classic', 'grid', 'arc', 'staggered']
  const layouts: Record<LayoutMode, LayoutNode[]> = Object.fromEntries(
    modes.map(m => [m, buildLayout(members, relationships, m)]),
  ) as Record<LayoutMode, LayoutNode[]>

  console.log('═══════════════════════════════════════════════════════════')
  console.log('BOUNDING BOX per mode')
  console.log('═══════════════════════════════════════════════════════════')
  for (const m of modes) {
    const { w, h } = bbox(layouts[m])
    console.log(`  ${m.padEnd(10)} ${Math.round(w).toString().padStart(5)} × ${Math.round(h).toString().padStart(5)} px`)
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('POSITION DIFF vs classic')
  console.log('═══════════════════════════════════════════════════════════')
  const base = layouts.classic
  let allGood = true
  for (const m of modes) {
    if (m === 'classic') continue
    const { n, samples } = movedNodes(base, layouts[m])
    const pct = ((n / members.length) * 100).toFixed(0)
    const ok = n >= Math.max(2, Math.floor(members.length * 0.05))
    console.log(`  ${m.padEnd(10)} ${n} node(s) moved (${pct}%) ${ok ? '✓' : '✗ TOO FEW'}`)
    for (const s of samples) console.log(s)
    if (!ok) allGood = false
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('Y-AXIS SHIFTS (arc/staggered should shift leaves vertically)')
  console.log('═══════════════════════════════════════════════════════════')
  for (const m of modes) {
    if (m === 'classic') continue
    const nodes = layouts[m]
    const baseMap = new Map(base.map(n => [n.member.id, n]))
    const yShifts = nodes
      .map(n => ({ n, dy: Math.round(n.y - (baseMap.get(n.member.id)?.y ?? 0)) }))
      .filter(x => Math.abs(x.dy) > 2)
    const maxShift = yShifts.length ? Math.max(...yShifts.map(x => Math.abs(x.dy))) : 0
    const expectShift = m === 'arc' || m === 'staggered'
    const ok = expectShift ? yShifts.length >= 2 && maxShift > 10 : true
    console.log(
      `  ${m.padEnd(10)} ${yShifts.length} leaves shifted, max |Δy|=${maxShift}px ${
        expectShift ? (ok ? '✓' : '✗ EXPECTED SHIFTS') : '(not expected)'
      }`,
    )
    if (!ok) allGood = false
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('SIGNATURE UNIQUENESS (each mode must produce unique layout)')
  console.log('═══════════════════════════════════════════════════════════')
  const sigs = new Map<string, LayoutMode[]>()
  for (const m of modes) {
    const sig = positionKey(layouts[m])
    if (!sigs.has(sig)) sigs.set(sig, [])
    sigs.get(sig)!.push(m)
  }
  let unique = true
  for (const [, modesInGroup] of sigs) {
    if (modesInGroup.length > 1) {
      console.log(`  ✗ DUPLICATE: ${modesInGroup.join(', ')} produce identical positions`)
      unique = false
    }
  }
  if (unique) console.log('  ✓ All 4 modes produce unique layouts')

  console.log('\n═══════════════════════════════════════════════════════════')
  if (allGood && unique) {
    console.log('RESULT: ✓ ALL TESTS PASSED — layouts actually differ.')
    process.exit(0)
  } else {
    console.log('RESULT: ✗ FAILED — layouts are not differentiated enough.')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(2)
})
