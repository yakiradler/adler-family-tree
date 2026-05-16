/**
 * Priestly lineage (שושלת) resolution.
 *
 * Halachic rule (Phase E): Kohen / Levi status passes through the male
 * line ONLY. A man whose father is a Kohen is a Kohen. A woman whose
 * father is a Kohen is a "Bat-Kohen" (בת כהן) — she carries the merit
 * but is NOT a Kohenet, so she does NOT receive the visual crown badge.
 *
 * Two sources of truth, in priority order:
 *   1. Explicit `member.lineage` field (set via Add/Edit modal). This is
 *      respected for males. For females, an explicit Kohen/Levi value is
 *      treated as "father was a Kohen/Levi" — i.e. it surfaces as
 *      `daughterOf` in the resolved info, and `showBadge` stays false.
 *   2. Automatic Adler rule — a male whose `last_name` AND at least one
 *      parent's `last_name` both match "Adler" is auto-tagged Kohen.
 *      Adler-Kohens get a special display suffix: "אדלר (כהנא)" /
 *      "Adler (Kahane)".
 *   3. Inheritance — a male whose father is Kohen / Levi inherits.
 *      A female whose father is Kohen / Levi gets `daughterOf` set.
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
 * Effective lineage info for a member.
 *
 * - `lineage`           — the effective lineage usable for filters.
 *                         For females it stays null (they're not Kohanot).
 * - `byAdlerRule`       — true iff the auto-Kohen rule fired (display
 *                         "Adler (Kahane)" suffix).
 * - `showBadge`         — true iff the visual badge should render.
 *                         Crown/Levi badge is shown only for males with
 *                         resolved Kohen/Levi lineage.
 * - `daughterOf`        — for females, the *paternal* lineage if her
 *                         father is Kohen / Levi. Used to render
 *                         "Daughter of a Kohen" inside the profile.
 */
export interface LineageInfo {
  lineage: Lineage | null
  byAdlerRule: boolean
  showBadge: boolean
  daughterOf: Lineage | null
}

const EMPTY: LineageInfo = {
  lineage: null,
  byAdlerRule: false,
  showBadge: false,
  daughterOf: null,
}

function maleFathers(parents: Member[]): Member[] {
  // Halacha: Kohen / Levi status passes through the MALE line ONLY.
  // We require an explicit `gender === 'male'`; parents whose gender is
  // unknown are NOT treated as fathers, because tagging an Israel as
  // Kohen by mistake is the worse error. A male parent missing the
  // gender field is a data-entry bug — fix the member record, don't
  // paper over it here.
  return parents.filter(p => p.gender === 'male')
}

/**
 * Resolve a parent's lineage WITHOUT recursion guards. Recursion is safe
 * because parent-child relationships form a DAG and each call walks one
 * level up. We only need 1 level (father) for inheritance. For the Adler
 * surname rule we don't need to walk further.
 */
function resolveFatherLineage(
  parents: Member[],
  parentMap: Map<string, Member[]>,
): Lineage | null {
  const fathers = maleFathers(parents)
  for (const father of fathers) {
    const info = resolveLineage(father, parentMap)
    if (info.lineage === 'kohen' || info.lineage === 'levi') return info.lineage
  }
  return null
}

export function resolveLineage(
  member: Member,
  parentMap: Map<string, Member[]>,
): LineageInfo {
  const parents = parentMap.get(member.id) ?? []
  const isMale = member.gender !== 'female'

  // Father's lineage (Kohen / Levi only — Israel doesn't propagate).
  const fatherLineage = resolveFatherLineage(parents, parentMap)

  // Females: Kohen / Levi never resolves — only daughterOf is set.
  if (!isMale) {
    // Honour explicit field by treating it as "her father's lineage".
    const explicit = member.lineage === 'kohen' || member.lineage === 'levi'
      ? member.lineage
      : null
    return {
      lineage: null,
      byAdlerRule: false,
      showBadge: false,
      daughterOf: fatherLineage ?? explicit ?? null,
    }
  }

  // Males ── explicit lineage wins.
  if (member.lineage === 'kohen' || member.lineage === 'levi' || member.lineage === 'israel') {
    return {
      lineage: member.lineage,
      byAdlerRule: false,
      showBadge: member.lineage !== 'israel',
      daughterOf: null,
    }
  }

  // Adler auto-Kohen rule (males only). The surname rule is a heuristic
  // for the Adler family's specific lineage — but it must still respect
  // the male-line halacha. If the only Adler parent is the mother, we
  // do NOT auto-tag the son as Kohen (he'd be a "ben bat-kohen", not a
  // Kohen). Require an Adler FATHER (or at least a male parent whose
  // surname matches).
  if (isAdlerSurname(member.last_name)) {
    const hasAdlerFather = parents.some(
      p => p.gender === 'male' && isAdlerSurname(p.last_name),
    )
    if (hasAdlerFather) {
      return { lineage: 'kohen', byAdlerRule: true, showBadge: true, daughterOf: null }
    }
  }

  // Inherit from father if Kohen / Levi.
  if (fatherLineage) {
    return { lineage: fatherLineage, byAdlerRule: false, showBadge: true, daughterOf: null }
  }

  return EMPTY
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
