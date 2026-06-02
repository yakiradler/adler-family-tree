import type { Member, Relationship, FamilyTree } from '../types'

// ─────────────────────────────────────────────
// Generic family seed — 1 tree, 7 members, 3 generations
// ─────────────────────────────────────────────
// Symmetric, deterministic test population for the new layout engine:
//   • Gen 0: Grandfather + Grandmother
//   • Gen 1: Father + Mother
//   • Gen 2: Son #1 + Daughter (centre) + Son #2  (odd-count children
//           so the middle child sits directly under the parent line)
// birth_order on the children pins their visual order (left → right
// in RTL: oldest-son, middle-daughter, youngest-son).

const DEMO_TREE_ID = 'demo-family'

export const ADLER_TREES: FamilyTree[] = [
  {
    id: DEMO_TREE_ID,
    name: 'משפחה לדוגמה',
    description: '3 דורות — בסיס לעיצוב סימטרי',
    color: '#007AFF',
    created_by: 'demo',
  },
]

export const ADLER_MEMBERS: Member[] = [
  // Gen 0 — Grandparents
  { id: 'g01', first_name: 'סבא',   last_name: 'דוגמה', gender: 'male',   birth_date: '1940-01-01', tree_id: DEMO_TREE_ID, created_by: 'demo' },
  { id: 'g02', first_name: 'סבתא',  last_name: 'דוגמה', gender: 'female', birth_date: '1942-01-01', tree_id: DEMO_TREE_ID, created_by: 'demo' },
  // Gen 1 — Parents
  { id: 'p01', first_name: 'אבא',   last_name: 'דוגמה', gender: 'male',   birth_date: '1968-01-01', tree_id: DEMO_TREE_ID, created_by: 'demo' },
  { id: 'p02', first_name: 'אמא',   last_name: 'דוגמה', gender: 'female', birth_date: '1970-01-01', tree_id: DEMO_TREE_ID, created_by: 'demo' },
  // Gen 2 — 3 children (birth_order = left→right visual order)
  { id: 'c01', first_name: 'בן א\'', last_name: 'דוגמה', gender: 'male',   birth_date: '1992-01-01', birth_order: 1, tree_id: DEMO_TREE_ID, created_by: 'demo' },
  { id: 'c02', first_name: 'בת',    last_name: 'דוגמה', gender: 'female', birth_date: '1995-01-01', birth_order: 2, tree_id: DEMO_TREE_ID, created_by: 'demo' },
  { id: 'c03', first_name: 'בן ב\'', last_name: 'דוגמה', gender: 'male',   birth_date: '1998-01-01', birth_order: 3, tree_id: DEMO_TREE_ID, created_by: 'demo' },
]

// ─────────────────────────────────────────────
// Relationships
// ─────────────────────────────────────────────

let _rid = 0
function rel(
  a: string,
  b: string,
  type: Relationship['type'] = 'parent-child',
  status?: Relationship['status'],
): Relationship {
  const r: Relationship = { id: `rel${++_rid}`, member_a_id: a, member_b_id: b, type }
  if (status) r.status = status
  return r
}

export const ADLER_RELATIONSHIPS: Relationship[] = [
  // Gen 0 marriage
  rel('g01', 'g02', 'spouse', 'current'),
  // Grandparents → father
  rel('g01', 'p01'),
  rel('g02', 'p01'),
  // Gen 1 marriage
  rel('p01', 'p02', 'spouse', 'current'),
  // Parents → 3 children
  rel('p01', 'c01'), rel('p02', 'c01'),
  rel('p01', 'c02'), rel('p02', 'c02'),
  rel('p01', 'c03'), rel('p02', 'c03'),
]
