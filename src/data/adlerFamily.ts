import type { Member, Relationship, FamilyTree } from '../types'

// ─────────────────────────────────────────────
// Adler demo seed — nuclear family (post-rebuild)
// ─────────────────────────────────────────────
// Why this is small: the prior seed shipped 84 members across 4
// generations, which masked layout / isolation bugs that only showed
// up at scale. We're rebuilding base correctness on a 7-member
// nuclear family first — once every interaction works perfectly on
// this surface, we'll scale the real population back up.
//
// What's in this seed:
//   • 2 grandparents (gen 0)
//   • 2 parents + 1 hidden ex-spouse of the mother (gen 1)
//   • 2 children: יקיר + his sister (gen 2)
//
// The hidden ex-spouse exercises the "drop floating ex-spouses"
// path from stage 1 — he should never appear on the canvas, even
// though a relationship row links him to the mother.

const DEMO_TREE_ID = 'demo-adler'

export const ADLER_TREES: FamilyTree[] = [
  {
    id: DEMO_TREE_ID,
    name: 'משפחת אדלר',
    description: 'דמו — משפחה גרעינית',
    color: '#007AFF',
    created_by: 'demo',
  },
]

export const ADLER_MEMBERS: Member[] = [
  // Gen 0 — Grandparents
  {
    id: 'g01', first_name: 'יצחק', last_name: 'אדלר', gender: 'male',
    birth_date: '1940-05-20', tree_id: DEMO_TREE_ID, created_by: 'demo',
  },
  {
    id: 'g02', first_name: 'שולמית', last_name: 'אדלר', gender: 'female',
    birth_date: '1943-06-10', tree_id: DEMO_TREE_ID, created_by: 'demo',
  },

  // Gen 1 — Parents
  {
    id: 'p01', first_name: 'אריה', last_name: 'אדלר', gender: 'male',
    birth_date: '1968-09-22', tree_id: DEMO_TREE_ID, created_by: 'demo',
  },
  {
    id: 'p02', first_name: 'מרים', last_name: 'אדלר', gender: 'female',
    birth_date: '1970-03-15', tree_id: DEMO_TREE_ID, created_by: 'demo',
  },

  // Gen 1 — Hidden ex-spouse of the mother (regression guard for the
  // "floating נתנאל" bug — he should never render).
  {
    id: 'p03', first_name: 'נתנאל', last_name: 'כהן', gender: 'male',
    hidden: true, tree_id: DEMO_TREE_ID, created_by: 'demo',
  },

  // Gen 2 — Children
  {
    id: 'c01', first_name: 'יקיר', last_name: 'אדלר', gender: 'male',
    birth_date: '1995-07-08', tree_id: DEMO_TREE_ID, created_by: 'demo',
  },
  {
    id: 'c02', first_name: 'נועה', last_name: 'אדלר', gender: 'female',
    birth_date: '1998-04-18', tree_id: DEMO_TREE_ID, created_by: 'demo',
  },
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
  // Grandparents marriage
  rel('g01', 'g02', 'spouse'),

  // Grandparents → אריה (the father)
  rel('g01', 'p01'),
  rel('g02', 'p01'),

  // Current marriage: אריה ↔ מרים
  rel('p01', 'p02', 'spouse'),

  // Mother's hidden ex (status='ex' so it never crowds the layout)
  rel('p02', 'p03', 'spouse', 'ex'),

  // Parents → יקיר
  rel('p01', 'c01'),
  rel('p02', 'c01'),

  // Parents → נועה
  rel('p01', 'c02'),
  rel('p02', 'c02'),
]
