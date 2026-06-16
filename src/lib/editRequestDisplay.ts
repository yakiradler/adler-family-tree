import type { Translations } from '../i18n/useT'

/**
 * Human-readable rendering of an edit-request's proposed changes.
 *
 * `change_data` is a raw map of member-column → new value (e.g.
 * `{ first_name: 'יוסי', death_date: null }`). The admin/owner approval
 * card used to print the raw English column keys ("first name",
 * "death date") and `String(value)`, which read as meaningless English
 * to a Hebrew user. These helpers translate the key to the same label
 * the edit form uses and format the value (dates, gender, booleans,
 * cleared fields) so the card explains *exactly* what is being changed.
 */

/** Member-column → translation key for its label. */
const FIELD_LABEL_KEY: Record<string, keyof Translations> = {
  first_name: 'firstName',
  last_name: 'lastName',
  first_name_en: 'firstNameEn',
  last_name_en: 'lastNameEn',
  maiden_name: 'maidenNameLabel',
  nickname: 'editNickname',
  birth_date: 'birthDate',
  death_date: 'deathDate',
  hebrew_birth_date: 'editHebrewBirth',
  hebrew_death_date: 'editHebrewDeath',
  bio: 'biography',
  gender: 'gender',
}

export function fieldLabel(key: string, t: Translations): string {
  const tk = FIELD_LABEL_KEY[key]
  if (tk) return t[tk] as string
  // Unknown / future field — humanise the column name as a fallback.
  return key.replace(/_/g, ' ')
}

export function formatValue(
  key: string,
  value: unknown,
  lang: 'he' | 'en',
): string {
  // Cleared field — explicit "(removed)" so an emptying edit is obvious.
  if (value === null || value === undefined || value === '') {
    return lang === 'he' ? '(רוקן)' : '(cleared)'
  }
  if (key === 'gender') {
    if (value === 'male') return lang === 'he' ? 'זכר' : 'Male'
    if (value === 'female') return lang === 'he' ? 'נקבה' : 'Female'
  }
  if (typeof value === 'boolean') {
    return value ? (lang === 'he' ? 'כן' : 'Yes') : (lang === 'he' ? 'לא' : 'No')
  }
  // ISO date columns → locale-formatted date.
  if ((key === 'birth_date' || key === 'death_date') && typeof value === 'string') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    }
  }
  if (typeof value === 'object') {
    // e.g. a contact object — don't dump JSON at the user.
    return lang === 'he' ? '(עודכן)' : '(updated)'
  }
  return String(value)
}
