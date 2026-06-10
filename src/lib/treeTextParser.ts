/**
 * Local family-tree text parser.
 *
 * Goal: let a user paste a semi-structured paragraph in Hebrew or
 * English and end up with a populated tree, WITHOUT calling any
 * external AI service.  The parser is forgiving — it accepts a
 * handful of natural patterns:
 *
 *   • Header lines (Hebrew):
 *       אבא: דוד אדלר, 1955
 *       אמא: שרה לבית כהן, 1958
 *       הילדים שלהם:
 *         - יוסי, 1985
 *         - מירי, 1988, נשואה לרון לבית שטרן
 *
 *   • Header lines (English):
 *       Father: David Adler, 1955
 *       Mother: Sarah (Cohen), 1958
 *       Their children:
 *         - Yossi, 1985
 *         - Miri, 1988, married to Ron (Stern)
 *
 *   • Spouse hints inside a child line:
 *         "נשואה לרון",  "married to Ron",  "+ Ron"
 *
 *   • Nested children for a couple:
 *         "ליוסי ורות: אורי 2015, נועה 2018"
 *         "Yossi and Ruth's kids: Uri 2015, Noa 2018"
 *
 *   • Maiden name in parentheses (or "לבית X" / "née X"):
 *         "שרה (כהן)",  "שרה לבית כהן",  "Sarah (Cohen)",  "Sarah née Cohen"
 *
 * The parser returns a `ParseResult` with:
 *   • members[]        — every person the parser identified, with a
 *                        stable temporary id and any metadata it could
 *                        infer (gender, surname, birth year, maiden).
 *   • relationships[]  — parent-child + spouse edges between them.
 *   • warnings[]       — soft issues we want to surface to the user
 *                        ("two parents had different surnames — using
 *                        the father's").
 *   • questions[]      — ambiguities the user should resolve before
 *                        we commit ("is X the child of A or of B?").
 *
 * The Add-from-Text modal calls `parse(text)`, lets the user review
 * the result, then calls `commit(result, store)` to materialise it
 * into the real tree.
 *
 * NO new dependencies — only regex + string work, so this ships in
 * the existing 218 kB main bundle without bloat.
 */

import type { Member, Relationship, Gender, Lineage } from '../types'

// ─── Types ───────────────────────────────────────────────────────────

export interface ParsedMember {
  /** Stable id for this parse run (e.g. "p-1"). Resolved to real
   *  member ids when we commit. */
  tempId: string
  firstName: string
  lastName?: string
  maidenName?: string
  birthYear?: number
  gender?: Gender
  /** Free-form note we couldn't pin to a structured field. */
  note?: string
}

export interface ParsedRelationship {
  type: 'parent-child' | 'spouse'
  /** Refers to ParsedMember.tempId. */
  fromTempId: string
  toTempId: string
}

export interface ParseQuestion {
  id: string
  message: string
  /** Suggested choices; the modal renders them as buttons. */
  options: { label: string; apply: (result: ParseResult) => ParseResult }[]
}

export interface ParseResult {
  members: ParsedMember[]
  relationships: ParsedRelationship[]
  warnings: string[]
  questions: ParseQuestion[]
}

// ─── Lexer helpers ───────────────────────────────────────────────────

const RX_YEAR = /\b(1[89]\d{2}|20\d{2})\b/
const RX_PAREN = /[(（](.+?)[)）]/

/** Heuristic surname locality — Hebrew "לבית X" / "מבית X" / English "née X". */
const RX_MAIDEN_HE = /(?:לבית|מבית)\s+([֐-׿\w'-]+)/
const RX_MAIDEN_EN = /\bn[eé]e\s+([A-Za-z'-]+)\b/i

/** Match all-Hebrew / all-Latin name-ish tokens. We keep apostrophes
 *  and hyphens so names like "אבן-ארי" / "O'Brien" survive. */
const RX_NAME_TOKEN = /[֐-׿A-Za-z][֐-׿A-Za-z'-]+/g

/** Words that hint at the surrounding member's role/relation. */
const ROLE_HINTS = {
  he: {
    father:    ['אבא', 'אבי', 'אב', 'סבא', 'הסבא'],
    mother:    ['אמא', 'אמי', 'אם', 'סבתא', 'הסבתא'],
    childrenSection: ['ילדים', 'הילדים', 'בנים', 'בנות', 'הצאצאים'],
    married:   ['נשוי', 'נשואה', 'נשואים', 'התחתן', 'התחתנה', 'בעלה', 'אשתו', 'בן זוג', 'בת זוג'],
    couple:    ['ו', 'ול'],
  },
  en: {
    father:    ['father', 'dad', 'grandfather', 'grandpa'],
    mother:    ['mother', 'mom', 'grandmother', 'grandma'],
    childrenSection: ['children', 'kids', 'sons', 'daughters', 'offspring'],
    married:   ['married', 'married to', 'spouse', 'husband', 'wife', 'partner'],
    couple:    ['and'],
  },
}

const ALL_ROLE_WORDS = new Set([
  ...Object.values(ROLE_HINTS.he).flat(),
  ...Object.values(ROLE_HINTS.en).flat(),
  // Common section labels we want to STRIP from name extraction:
  'ילד', 'בן', 'בת', 'נולד', 'נולדה',
  'son', 'daughter', 'born', 'are', 'is', 'their', 'of', 'a',
  // List markers
  '-', '—', '*', '•',
])

const STOP_WORDS_AS_NAME = new Set([
  // Hebrew possessives and pronouns that look name-like but aren't
  'הוא', 'היא', 'הם', 'הן', 'שלי', 'שלך', 'שלו', 'שלה',
  // Hebrew role words used as labels
  'אבא', 'אמא', 'אבי', 'אמי', 'אב', 'אם', 'סבא', 'סבתא', 'הסבא', 'הסבתא',
  'ילדים', 'הילדים', 'בנים', 'בנות', 'הצאצאים', 'בני',
  'נשוי', 'נשואה', 'נשואים', 'התחתן', 'התחתנה', 'בעלה', 'אשתו',
  'נולד', 'נולדה', 'לבית', 'מבית', 'של', 'ה', 'את', 'ל',
  // English equivalents
  'father', 'mother', 'dad', 'mom', 'son', 'daughter', 'children', 'kids',
  'grandfather', 'grandmother', 'married', 'their', 'born', 'and', 'to', 'is',
  'a', 'the', 'of', 'née',
])

function detectGenderFromKeyword(line: string): Gender | undefined {
  const lower = line.toLowerCase()
  if (ROLE_HINTS.he.father.some((w) => line.includes(w))) return 'male'
  if (ROLE_HINTS.he.mother.some((w) => line.includes(w))) return 'female'
  if (ROLE_HINTS.en.father.some((w) => lower.includes(w))) return 'male'
  if (ROLE_HINTS.en.mother.some((w) => lower.includes(w))) return 'female'
  // Hebrew gendered verbs are a strong signal too
  if (/נשואה|נולדה|אמה/.test(line)) return 'female'
  if (/נשוי|נולד|אביו/.test(line)) return 'male'
  return undefined
}

function extractYear(s: string): number | undefined {
  const m = s.match(RX_YEAR)
  return m ? parseInt(m[1]!, 10) : undefined
}

function extractMaiden(s: string): string | undefined {
  // "לבית X" / "née X" wins over the bare parens because parens
  // can also enclose nicknames, dates, etc.
  const heM = s.match(RX_MAIDEN_HE)
  if (heM) return heM[1]
  const enM = s.match(RX_MAIDEN_EN)
  if (enM) return enM[1]
  const paren = s.match(RX_PAREN)
  if (paren) {
    const inner = paren[1]!.trim()
    // Only treat as maiden name if it looks like a name (not a year).
    if (!RX_YEAR.test(inner) && inner.length <= 30) return inner
  }
  return undefined
}

function stripDecorations(s: string): string {
  return s
    .replace(RX_PAREN, ' ')
    .replace(RX_MAIDEN_HE, ' ')
    .replace(RX_MAIDEN_EN, ' ')
    .replace(RX_YEAR, ' ')
    .replace(/[,;:״""'"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractNameTokens(s: string): string[] {
  const stripped = stripDecorations(s)
  const matches = stripped.match(RX_NAME_TOKEN) ?? []
  return matches.filter((tok) => {
    const lower = tok.toLowerCase()
    if (STOP_WORDS_AS_NAME.has(tok) || STOP_WORDS_AS_NAME.has(lower)) return false
    if (ALL_ROLE_WORDS.has(tok) || ALL_ROLE_WORDS.has(lower)) return false
    return true
  })
}

function pickFirstLast(tokens: string[]): { first?: string; last?: string } {
  if (tokens.length === 0) return {}
  if (tokens.length === 1) return { first: tokens[0] }
  // Take first token as given name, remaining tokens (joined) as
  // surname. This handles "Sarah Cohen", "Sarah Anne Cohen", etc.
  return { first: tokens[0], last: tokens.slice(1).join(' ') }
}

// ─── Main parser ─────────────────────────────────────────────────────

interface Workspace {
  members: Map<string, ParsedMember>
  rels: ParsedRelationship[]
  warnings: string[]
  questions: ParseQuestion[]
  nextId: number
  /** Most-recently-mentioned parents — used to attach a `ילדים:` block. */
  recentParents: string[] // tempIds
}

function newMember(ws: Workspace, partial: Partial<ParsedMember>): ParsedMember {
  const tempId = `p-${++ws.nextId}`
  const m: ParsedMember = {
    tempId,
    firstName: partial.firstName ?? 'Unknown',
    ...partial,
  }
  ws.members.set(tempId, m)
  return m
}

/** Find an existing member by first-name (case-insensitive). Used so
 *  later mentions of the same person (e.g. "יוסי ורות → ילדים…") link
 *  to the previously-declared row instead of creating a duplicate. */
function findByFirstName(ws: Workspace, first: string): ParsedMember | undefined {
  const lower = first.toLowerCase()
  for (const m of ws.members.values()) {
    if (m.firstName.toLowerCase() === lower) return m
  }
  return undefined
}

/** Process a single "person fragment" — a token group that describes
 *  one human (e.g. "יוסי, 1985" or "מירי 1988 נשואה לרון"). */
function parsePerson(
  fragment: string,
  ws: Workspace,
  hint: { gender?: Gender; lastNameDefault?: string } = {},
): ParsedMember | null {
  const trimmed = fragment.trim()
  if (!trimmed) return null

  const year = extractYear(trimmed)
  const maiden = extractMaiden(trimmed)
  const tokens = extractNameTokens(trimmed)
  const { first, last } = pickFirstLast(tokens)
  if (!first) return null

  // Reuse existing if same first name + no conflicting year.
  const existing = findByFirstName(ws, first)
  if (existing) {
    if (year && !existing.birthYear) existing.birthYear = year
    if (last && !existing.lastName) existing.lastName = last
    if (maiden && !existing.maidenName) existing.maidenName = maiden
    if (hint.gender && !existing.gender) existing.gender = hint.gender
    return existing
  }

  return newMember(ws, {
    firstName: first,
    lastName: last ?? hint.lastNameDefault,
    maidenName: maiden,
    birthYear: year,
    gender: hint.gender ?? detectGenderFromKeyword(trimmed),
  })
}

/** Split a multi-person string ("יוסי, מירי ורון" / "Yossi, Miri and Ron")
 *  into individual person fragments. */
function splitPeopleList(s: string): string[] {
  return s
    .split(/,|;|\band\b|\bו\b|\bאו\b/i)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** Detect "X נשוי/נשואה ל Y" / "X married to Y" inside a single line
 *  and create a spouse edge.  Returns the (modified) primary person. */
function attachSpouseFromLine(
  primary: ParsedMember,
  line: string,
  ws: Workspace,
): void {
  // Hebrew: "נשוי/ה ל-ROMI" or "+ ROMI"
  const heMarried = line.match(/נשוי\s+ל[־-]?\s*(.+)|נשואה\s+ל[־-]?\s*(.+)/)
  const heCouple = line.match(/\+\s*(.+)/)
  const enMarried = line.match(/married\s+to\s+(.+)/i)
  const m = heMarried?.[1] ?? heMarried?.[2] ?? heCouple?.[1] ?? enMarried?.[1]
  if (!m) return
  // Bail if the spouse fragment is empty after stripping the marker.
  const spouseFrag = m.trim()
  if (!spouseFrag) return
  const spouse = parsePerson(spouseFrag, ws, {
    gender: primary.gender === 'male' ? 'female' : primary.gender === 'female' ? 'male' : undefined,
  })
  if (!spouse || spouse.tempId === primary.tempId) return
  // De-dupe spouse edges.
  const exists = ws.rels.some(
    (r) => r.type === 'spouse'
      && ((r.fromTempId === primary.tempId && r.toTempId === spouse.tempId)
        || (r.fromTempId === spouse.tempId && r.toTempId === primary.tempId)),
  )
  if (!exists) {
    ws.rels.push({ type: 'spouse', fromTempId: primary.tempId, toTempId: spouse.tempId })
  }
}

/** Add parent→child edges from each of `parentIds` to each of
 *  `childIds`. Skips duplicates. */
function linkParentsToChildren(ws: Workspace, parentIds: string[], childIds: string[]) {
  for (const p of parentIds) {
    for (const c of childIds) {
      if (p === c) continue
      const exists = ws.rels.some(
        (r) => r.type === 'parent-child' && r.fromTempId === p && r.toTempId === c,
      )
      if (!exists) ws.rels.push({ type: 'parent-child', fromTempId: p, toTempId: c })
    }
  }
}

/** Couple references inside a line: "יוסי ורות → ילדים: ..." */
function tryCoupleChildrenLine(line: string, ws: Workspace): boolean {
  // Hebrew: "לX וY: A, B" or "X ו-Y → A, B" or "הילדים של X ו-Y: ..."
  // English: "X and Y's kids: ..." / "X and Y: A, B"
  const sepIdx = (() => {
    const idx1 = line.indexOf(':')
    const idx2 = line.indexOf('→')
    if (idx1 === -1) return idx2
    if (idx2 === -1) return idx1
    return Math.min(idx1, idx2)
  })()
  if (sepIdx < 0) return false
  const head = line.slice(0, sepIdx)
  const tail = line.slice(sepIdx + 1)
  // Head must mention a conjunction (ו / and).
  if (!/\b(and)\b/i.test(head) && !/\bו\b/.test(head) && !head.includes(' ו')) return false
  // Pull two names out of the head.
  const parts = head.split(/\band\b|\bו\b|\s+ו/i).map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return false
  const parentA = parsePerson(parts[0]!, ws)
  const parentB = parsePerson(parts[1]!, ws)
  if (!parentA || !parentB) return false
  // Mark them as spouses (idempotent).
  attachSpouseFromLine(parentA, `+ ${parentB.firstName}`, ws)
  // Tail is the children list.
  const childFragments = splitPeopleList(tail)
  const childIds: string[] = []
  for (const cf of childFragments) {
    const child = parsePerson(cf, ws)
    if (!child) continue
    // Inherit father's surname unless explicitly set.
    if (!child.lastName && parentA.lastName) child.lastName = parentA.lastName
    childIds.push(child.tempId)
    attachSpouseFromLine(child, cf, ws)
  }
  linkParentsToChildren(ws, [parentA.tempId, parentB.tempId], childIds)
  ws.recentParents = [parentA.tempId, parentB.tempId]
  return true
}

/** Process a single line. Mutates `ws` directly. */
function parseLine(rawLine: string, ws: Workspace, ctx: { lastChildrenHeader: boolean }) {
  const line = rawLine.replace(/^[-—•*]\s*/, '').trim()
  if (!line) return

  // Couple → children?
  if (tryCoupleChildrenLine(line, ws)) {
    ctx.lastChildrenHeader = false
    return
  }

  // Pattern: "Header: payload"  (e.g. "אבא: דוד אדלר 1955")
  const colonIdx = line.indexOf(':')
  if (colonIdx > 0 && colonIdx < 30) {
    const header = line.slice(0, colonIdx).trim()
    const payload = line.slice(colonIdx + 1).trim()
    const lower = header.toLowerCase()

    // Father?
    if (ROLE_HINTS.he.father.includes(header) || ROLE_HINTS.en.father.includes(lower)) {
      const father = parsePerson(payload, ws, { gender: 'male' })
      if (father) {
        // Hook into the most-recent mother if any (consecutive header lines).
        const recentMother = ws.recentParents.find((id) => ws.members.get(id)?.gender === 'female')
        if (recentMother) {
          attachSpouseFromLine(father, `+ ${ws.members.get(recentMother)!.firstName}`, ws)
        }
        ws.recentParents = [...new Set([father.tempId, ...ws.recentParents])].slice(0, 2)
      }
      ctx.lastChildrenHeader = false
      return
    }

    // Mother?
    if (ROLE_HINTS.he.mother.includes(header) || ROLE_HINTS.en.mother.includes(lower)) {
      const mother = parsePerson(payload, ws, { gender: 'female' })
      if (mother) {
        const recentFather = ws.recentParents.find((id) => ws.members.get(id)?.gender === 'male')
        if (recentFather) {
          attachSpouseFromLine(mother, `+ ${ws.members.get(recentFather)!.firstName}`, ws)
        }
        ws.recentParents = [...new Set([mother.tempId, ...ws.recentParents])].slice(0, 2)
      }
      ctx.lastChildrenHeader = false
      return
    }

    // Children header — payload may be empty (it's on next lines) or
    // an inline list.
    if (ROLE_HINTS.he.childrenSection.includes(header) || ROLE_HINTS.en.childrenSection.includes(lower)
        || /^הילדים/.test(header) || /^their\s+children/i.test(header)) {
      ctx.lastChildrenHeader = true
      if (payload) {
        consumeChildrenList(payload, ws)
        ctx.lastChildrenHeader = false
      }
      return
    }
  }

  // Lone "Children of X and Y are:" without colon? skip — covered above.

  // If we're inside a children block, treat the line as a child.
  if (ctx.lastChildrenHeader) {
    consumeChildrenList(line, ws)
    return
  }

  // Bare line — try as a single person + maybe inline spouse hint.
  const person = parsePerson(line, ws)
  if (person) {
    attachSpouseFromLine(person, line, ws)
  }
}

function consumeChildrenList(s: string, ws: Workspace) {
  const childFragments = splitPeopleList(s)
  const childIds: string[] = []
  // Default surname: father's last name.
  const father = ws.recentParents
    .map((id) => ws.members.get(id))
    .find((m) => m?.gender === 'male')
  for (const cf of childFragments) {
    const child = parsePerson(cf, ws, { lastNameDefault: father?.lastName })
    if (!child) continue
    childIds.push(child.tempId)
    attachSpouseFromLine(child, cf, ws)
  }
  if (ws.recentParents.length > 0 && childIds.length > 0) {
    linkParentsToChildren(ws, ws.recentParents, childIds)
  } else if (childIds.length > 0) {
    // Children mentioned with no preceding parents — surface a question.
    ws.questions.push({
      id: `orphan-${ws.questions.length}`,
      message: childIds.map((id) => ws.members.get(id)?.firstName).filter(Boolean).join(', ')
        + (childIds.length > 1 ? ' — מי ההורים שלהם?' : ' — מי ההורים שלו/ה?'),
      options: [],
    })
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export function parseTreeText(text: string): ParseResult {
  const ws: Workspace = {
    members: new Map(),
    rels: [],
    warnings: [],
    questions: [],
    nextId: 0,
    recentParents: [],
  }
  const ctx = { lastChildrenHeader: false }
  for (const raw of text.split(/\r?\n/)) {
    parseLine(raw, ws, ctx)
  }
  return {
    members: [...ws.members.values()],
    relationships: ws.rels,
    warnings: ws.warnings,
    questions: ws.questions,
  }
}

// ─── Committing the parse result into the live store ─────────────────

export interface StoreAdapter {
  addMember: (m: Omit<Member, 'id'>) => Promise<Member | null>
  addRelationship: (r: Omit<Relationship, 'id'>) => Promise<void>
  /** Used to stamp `created_by` on each new row. */
  authorId: string
  /** Optional active tree the new members should attach to. */
  treeId?: string | null
}

export async function commitParseResult(
  result: ParseResult,
  store: StoreAdapter,
): Promise<{ created: number }> {
  // First pass: create members. Map tempId → real id.
  const idMap = new Map<string, string>()
  for (const pm of result.members) {
    const memberInput: Omit<Member, 'id'> = {
      first_name: pm.firstName,
      last_name: pm.lastName ?? '',
      maiden_name: pm.maidenName,
      birth_date: pm.birthYear ? `${pm.birthYear}-01-01` : undefined,
      gender: pm.gender,
      lineage: undefined as Lineage | undefined,
      created_by: store.authorId,
      tree_id: store.treeId ?? undefined,
    }
    const created = await store.addMember(memberInput)
    if (created) idMap.set(pm.tempId, created.id)
  }
  // Second pass: relationships.
  for (const r of result.relationships) {
    const fromId = idMap.get(r.fromTempId)
    const toId = idMap.get(r.toTempId)
    if (!fromId || !toId) continue
    if (r.type === 'parent-child') {
      await store.addRelationship({
        member_a_id: fromId, // parent
        member_b_id: toId,   // child
        type: 'parent-child',
        parent_type: 'bio',
      })
    } else {
      await store.addRelationship({
        member_a_id: fromId,
        member_b_id: toId,
        type: 'spouse',
        status: 'current',
      })
    }
  }
  return { created: idMap.size }
}
