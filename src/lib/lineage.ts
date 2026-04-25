/**
 * Priestly lineage (שושלת) resolution.
 *
 * Two sources of truth, in priority order:
 *   1. Explicit `member.lineage` field (set via Add/Edit modal).
 *   2. Automatic Adler rule — when `member.last_name` AND at least one
 *      parent's `last_name` both match "Adler" (Hebrew or English spelling),
 *      the member is tagged as Kohen. Adler-Kohens also get a special
 *      display suffix: "Adler (Kahane)" / "אדלר (כהנא)".
 *
 * The resolver takes a precomputed parents-by-id map so the caller can do
 * the O(N) relationship walk ONCE per render and then query lineage per
 * member in O(1).
 */
import type { Lineage, Member, Relationship } from '../types'

const ADLER_SURNAMES = new Set(['אדלר', 'adler'])

function normalise(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase()
}

function isAdlerSurname(s: string | undefined | null): boolean {
  return ADLER_SURNAMES.has(normalise(s))
}

/**
 * Build a map of child-id → array of parent Members. Intended to be called
 * once per render (useMemo) and passed to `resolveLineage` for each member.
 */
export function buildParentMap(
  members: Member[],
  relationships: Relationship[],
): Map<string, Member[]> {
  const byId = new Map(members.map(m => [m.id, m]))
  const parentsOf = new Map<string, Member[]>()
  for (const r of relationships) {
    if (r.type !== 'parent-child') continue
    const parent = byId.get(r.member_a_id)
    if (!parent) continue
    if (!parentsOf.has(r.member_b_id)) parentsOf.set(r.member_b_id, [])
    parentsOf.get(r.member_b_id)!.push(parent)
  }
  return parentsOf
}

/**
 * Effective lineage for a member. Returns undefined when no lineage applies.
 * When `byAutoRule` is true in the return value, the Adler auto-Kohen rule
 * fired (so callers can choose to show the "Kahane" suffix in the display name).
 */
export interface LineageInfo {
  lineage: Lineage | null
  /** true iff the Adler → Kohen rule fired automatically for this member. */
  byAdlerRule: boolean
}

export function resolveLineage(
  member: Member,
  parentMap: Map<string, Member[]>,
): LineageInfo {
  // Explicit lineage wins.
  if (member.lineage === 'kohen' || member.lineage === 'levi' || member.lineage === 'israel') {
    return { lineage: member.lineage, byAdlerRule: false }
  }
  // Automatic Adler-Kohen rule.
  if (isAdlerSurname(member.last_name)) {
    const parents = parentMap.get(member.id) ?? []
    const hasAdlerParent = parents.some(p => isAdlerSurname(p.last_name))
    if (hasAdlerParent) return { lineage: 'kohen', byAdlerRule: true }
  }
  return { lineage: null, byAdlerRule: false }
}

/**
 * Display last name. For Adler-Kohens (by the auto rule), returns the
 * localised "Adler (Kahane)" form. Otherwise returns the raw last name.
 */
export function displayLastName(
  member: Member,
  info: LineageInfo,
  lang: 'he' | 'en',
): string {
  if (info.byAdlerRule) {
    return lang === 'he' ? 'אדלר (כהנא)' : 'Adler (Kahane)'
  }
  return member.last_name ?? ''
}
