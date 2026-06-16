import type { Member } from '../types'

/**
 * Bilingual member-name display.
 *
 * Members carry a primary Hebrew name (`first_name`/`last_name`) and an
 * optional English name (`first_name_en`/`last_name_en`). The UI shows
 * the name matching the active language, falling back to whichever name
 * exists so nothing ever renders blank.
 */

type NamedMember = Pick<Member, 'first_name' | 'last_name' | 'first_name_en' | 'last_name_en'>

function join(first?: string | null, last?: string | null): string {
  return [first, last].map((s) => (s ?? '').trim()).filter(Boolean).join(' ')
}

/** Full display name for the active language, with fallback. */
export function displayName(member: NamedMember, lang: 'he' | 'en'): string {
  const he = join(member.first_name, member.last_name)
  const en = join(member.first_name_en, member.last_name_en)
  if (lang === 'en') return en || he
  return he || en
}

/** First name only, for the active language, with fallback. */
export function displayFirst(member: NamedMember, lang: 'he' | 'en'): string {
  const he = (member.first_name ?? '').trim()
  const en = (member.first_name_en ?? '').trim()
  if (lang === 'en') return en || he
  return he || en
}
