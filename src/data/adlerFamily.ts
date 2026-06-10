import type { Member, Relationship, FamilyTree } from '../types'

// ─────────────────────────────────────────────
// Demo family seed — 1 tree, 30 members, 10 generations
// ─────────────────────────────────────────────
// Deterministic pilot dataset exercising every profile feature at once
// (owner request: "fill the demo with fake names, dates and pictures so
// we can test populated profiles, at least 10 generations deep"):
//   • 10 generations (born 1742 → 2016) along one main line, with
//     sibling branches at generations 3, 5, 7 and 8.
//   • Deceased members across generations 0-6 (+ one in gen 7) so the
//     deceased filter and the † badge have real data.
//   • One divorce: דוד ↔ יעל ('ex'), including a shared child (שי) so
//     the divorced-parents secondary connector renders.
//   • In-law parents (עמוס + צפורה) above spouse מיכל — exercises the
//     menorah satellite layout.
//   • Explicit kohen lineage down the male main line + one levi in-law
//     so the lineage filter returns a meaningful subset.
//   • Illustrated DiceBear avatars (clearly not real people) on most
//     members; a few left photo-less to keep the fallback covered.
//
// The same dataset is pushed into the LIVE demo tree by
// scripts/seed-demo-tree.ts — keep both in sync by editing ONLY here.

const DEMO_TREE_ID = 'demo-family'

// Illustrated avatar URL — DiceBear renders a deterministic cartoon per
// seed, so the same person always gets the same face. SVG endpoint is
// free, unauthenticated and license-safe for non-real-person avatars.
function avatar(seed: string): string {
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`
}

export const ADLER_TREES: FamilyTree[] = [
  {
    id: DEMO_TREE_ID,
    name: 'משפחה לדוגמה',
    description: '10 דורות — נתוני הדגמה מלאים',
    color: '#007AFF',
    created_by: 'demo',
  },
]

// Shorthand: build a member with the demo defaults applied.
function m(member: Omit<Member, 'tree_id' | 'created_by'>): Member {
  return { ...member, tree_id: DEMO_TREE_ID, created_by: 'demo' }
}

export const ADLER_MEMBERS: Member[] = [
  // ── Gen 0 (b. ~1742) ────────────────────────────────────────────
  m({ id: 'g0m', first_name: 'אליעזר', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '1742-03-15', death_date: '1818-06-02', photo_url: avatar('g0m-eliezer'),
      bio: 'אבי השושלת. סוחר בדים שהקים את בית המשפחה הראשון.' }),
  m({ id: 'g0f', first_name: 'מרים', last_name: 'כרמל', maiden_name: 'גלבוע', gender: 'female',
      birth_date: '1748-07-21', death_date: '1825-01-10', photo_url: avatar('g0f-miriam') }),

  // ── Gen 1 (b. ~1771) ────────────────────────────────────────────
  m({ id: 'g1m', first_name: 'יחיאל', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '1771-05-09', death_date: '1840-11-23', photo_url: avatar('g1m-yechiel') }),
  m({ id: 'g1f', first_name: 'פרומה', last_name: 'כרמל', maiden_name: 'תבור', gender: 'female',
      birth_date: '1776-09-30', death_date: '1851-04-17', photo_url: avatar('g1f-fruma') }),

  // ── Gen 2 (b. ~1800) ────────────────────────────────────────────
  m({ id: 'g2m', first_name: 'זלמן', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '1800-12-03', death_date: '1872-02-25', photo_url: avatar('g2m-zalman') }),
  m({ id: 'g2f', first_name: 'רבקה', last_name: 'כרמל', maiden_name: 'שקד', gender: 'female',
      birth_date: '1806-04-14', death_date: '1881-08-08', photo_url: avatar('g2f-rivka') }),

  // ── Gen 3 (b. ~1831) — first sibling branch ─────────────────────
  m({ id: 'g3m', first_name: 'מנחם', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '1831-01-19', death_date: '1900-03-30', birth_order: 1, photo_url: avatar('g3m-menachem'),
      bio: 'חזן הקהילה במשך ארבעים שנה.' }),
  m({ id: 'g3s1', first_name: 'גיטל', last_name: 'כרמל', gender: 'female',
      birth_date: '1834-08-27', death_date: '1903-05-02', birth_order: 2 }),
  m({ id: 'g3f', first_name: 'חנה', last_name: 'כרמל', maiden_name: 'ארבל', gender: 'female',
      birth_date: '1836-06-06', death_date: '1912-10-12', photo_url: avatar('g3f-chana') }),

  // ── Gen 4 (b. ~1862) ────────────────────────────────────────────
  m({ id: 'g4m', first_name: 'שמואל', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '1862-02-11', death_date: '1935-07-19', photo_url: avatar('g4m-shmuel') }),
  m({ id: 'g4f', first_name: 'לאה', last_name: 'כרמל', maiden_name: 'גולן', gender: 'female',
      birth_date: '1867-11-28', death_date: '1948-01-05', photo_url: avatar('g4f-lea') }),

  // ── Gen 5 (b. ~1893) — second sibling branch ────────────────────
  m({ id: 'g5m', first_name: 'אברהם', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '1893-04-02', death_date: '1971-09-14', birth_order: 1, photo_url: avatar('g5m-avraham'),
      bio: 'עלה ארצה ב-1920 והקים משק חקלאי בעמק.' }),
  m({ id: 'g5s1', first_name: 'פנחס', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '1896-10-23', death_date: '1966-03-09', birth_order: 2 }),
  m({ id: 'g5f', first_name: 'שרה', last_name: 'כרמל', maiden_name: 'אשכול', gender: 'female',
      birth_date: '1898-08-16', death_date: '1985-12-01', photo_url: avatar('g5f-sara') }),

  // ── Gen 6 (b. ~1925) ────────────────────────────────────────────
  m({ id: 'g6m', first_name: 'יוסף', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '1925-06-18', death_date: '2001-02-07', photo_url: avatar('g6m-yosef'),
      bio: 'מורה ומחנך. אהב לספר לנכדים על ילדותו בעמק.' }),
  m({ id: 'g6f', first_name: 'רחל', last_name: 'כרמל', maiden_name: 'אלון', gender: 'female',
      birth_date: '1929-03-25', death_date: '2010-09-19', photo_url: avatar('g6f-rachel') }),

  // ── Gen 7 (b. ~1950s) — divorce lives here ──────────────────────
  m({ id: 'g7s1', first_name: 'אסתר', last_name: 'כרמל', gender: 'female',
      birth_date: '1950-01-30', birth_order: 1, photo_url: avatar('g7s1-esther') }),
  m({ id: 'g7m', first_name: 'דוד', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '1953-07-12', birth_order: 2, photo_url: avatar('g7m-david'),
      bio: 'מהנדס בגמלאות. חובב צילום וטיולים.' }),
  m({ id: 'g7s2', first_name: 'משה', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '1957-12-05', death_date: '2020-04-22', birth_order: 3, photo_url: avatar('g7s2-moshe') }),
  // Ex-wife — kept her own surname after the divorce.
  m({ id: 'g7x', first_name: 'יעל', last_name: 'ירדן', gender: 'female',
      birth_date: '1955-02-17', photo_url: avatar('g7x-yael') }),
  m({ id: 'g7f', first_name: 'נעמי', last_name: 'כרמל', maiden_name: 'סביון', gender: 'female',
      birth_date: '1958-10-08', photo_url: avatar('g7f-naomi') }),

  // ── Gen 8 (b. ~1980s) — in-law parents live here ────────────────
  m({ id: 'g8s1', first_name: 'שי', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '1976-06-25', birth_order: 1, photo_url: avatar('g8s1-shai'),
      bio: 'בנם של דוד ויעל. גר בחו"ל.' }),
  m({ id: 'g8m', first_name: 'איתן', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '1980-03-03', birth_order: 2, photo_url: avatar('g8m-eitan') }),
  m({ id: 'g8s2', first_name: 'רות', last_name: 'כרמל', gender: 'female',
      birth_date: '1983-09-11', birth_order: 3, photo_url: avatar('g8s2-ruth') }),
  m({ id: 'g8f', first_name: 'מיכל', last_name: 'כרמל', maiden_name: 'דקל', gender: 'female',
      birth_date: '1982-05-29', photo_url: avatar('g8f-michal') }),
  // מיכל's parents — render as a menorah satellite above her.
  m({ id: 'g8il1', first_name: 'עמוס', last_name: 'דקל', gender: 'male', lineage: 'levi',
      birth_date: '1951-04-09', photo_url: avatar('g8il1-amos') }),
  m({ id: 'g8il2', first_name: 'צפורה', last_name: 'דקל', maiden_name: 'אשל', gender: 'female',
      birth_date: '1956-08-14' }),

  // ── Gen 9 (b. 2008-2016) ────────────────────────────────────────
  m({ id: 'g9c1', first_name: 'נועה', last_name: 'כרמל', gender: 'female',
      birth_date: '2008-02-14', birth_order: 1, photo_url: avatar('g9c1-noa') }),
  m({ id: 'g9c2', first_name: 'אורי', last_name: 'כרמל', gender: 'male', lineage: 'kohen',
      birth_date: '2011-07-07', birth_order: 2, photo_url: avatar('g9c2-uri') }),
  m({ id: 'g9c3', first_name: 'תמר', last_name: 'כרמל', gender: 'female',
      birth_date: '2016-11-20', birth_order: 3, photo_url: avatar('g9c3-tamar') }),
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

// Both parents → child, in one call per child.
function child(of: [string, string], id: string): Relationship[] {
  return [rel(of[0], id), rel(of[1], id)]
}

export const ADLER_RELATIONSHIPS: Relationship[] = [
  // Marriages down the main line
  rel('g0m', 'g0f', 'spouse', 'current'),
  rel('g1m', 'g1f', 'spouse', 'current'),
  rel('g2m', 'g2f', 'spouse', 'current'),
  rel('g3m', 'g3f', 'spouse', 'current'),
  rel('g4m', 'g4f', 'spouse', 'current'),
  rel('g5m', 'g5f', 'spouse', 'current'),
  rel('g6m', 'g6f', 'spouse', 'current'),
  // דוד: divorced from יעל, currently married to נעמי
  rel('g7m', 'g7x', 'spouse', 'ex'),
  rel('g7m', 'g7f', 'spouse', 'current'),
  rel('g8m', 'g8f', 'spouse', 'current'),
  // In-law couple (מיכל's parents)
  rel('g8il1', 'g8il2', 'spouse', 'current'),

  // Parent-child edges, generation by generation
  ...child(['g0m', 'g0f'], 'g1m'),
  ...child(['g1m', 'g1f'], 'g2m'),
  ...child(['g2m', 'g2f'], 'g3m'),
  ...child(['g2m', 'g2f'], 'g3s1'),
  ...child(['g3m', 'g3f'], 'g4m'),
  ...child(['g4m', 'g4f'], 'g5m'),
  ...child(['g4m', 'g4f'], 'g5s1'),
  ...child(['g5m', 'g5f'], 'g6m'),
  ...child(['g6m', 'g6f'], 'g7s1'),
  ...child(['g6m', 'g6f'], 'g7m'),
  ...child(['g6m', 'g6f'], 'g7s2'),
  // שי — child of the divorced couple
  ...child(['g7m', 'g7x'], 'g8s1'),
  ...child(['g7m', 'g7f'], 'g8m'),
  ...child(['g7m', 'g7f'], 'g8s2'),
  // מיכל under her own parents (menorah satellite)
  ...child(['g8il1', 'g8il2'], 'g8f'),
  ...child(['g8m', 'g8f'], 'g9c1'),
  ...child(['g8m', 'g8f'], 'g9c2'),
  ...child(['g8m', 'g8f'], 'g9c3'),
]
