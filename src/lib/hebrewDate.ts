import { HDate } from '@hebcal/core'

/**
 * Hebrew-calendar helpers, backed by @hebcal/core (a verified, widely
 * used Hebrew calendar engine) — NOT free text.
 *
 * Why: members store a regular (Gregorian) birth date. We derive the
 * Hebrew date from it and compute the *real* next Hebrew-calendar
 * birthday, so birthday alerts fire on the correct civil day each year
 * (the Hebrew anniversary drifts ~11 days against the Gregorian date).
 */

/** Parse an ISO/`YYYY-MM-DD` string to a local Date, or null if invalid. */
function parseIso(iso: string | undefined | null): Date | null {
  if (!iso) return null
  // Use the date parts directly so we anchor at LOCAL midnight (avoids the
  // UTC-vs-local off-by-one that `new Date('YYYY-MM-DD')` causes).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * The Hebrew date for a Gregorian date, rendered in Hebrew gematriya
 * (e.g. `'כ״ג בְּנִיסָן תשפ״ד'`). `withYear=false` drops the year.
 * Returns '' for an unparseable input.
 */
export function gregorianToHebrew(iso: string | undefined | null, withYear = true): string {
  const d = parseIso(iso)
  if (!d) return ''
  try {
    const hd = new HDate(d)
    // suppressNikud=true → cleaner for UI; second arg suppresses the year.
    return hd.renderGematriya(true, !withYear)
  } catch {
    return ''
  }
}

export interface NextHebrewBirthday {
  /** The Gregorian date of the next Hebrew-calendar anniversary (>= today). */
  nextDate: Date
  /** Hebrew-calendar age the person turns on that date. */
  turning: number
  /** The Hebrew date label (gematriya, no year), e.g. 'כ״ג בְּנִיסָן'. */
  hebrewLabel: string
}

/**
 * The next occurrence (on or after `today`) of the Hebrew-calendar
 * anniversary of `birthIso`, plus the Hebrew age then. Returns null if
 * the birth date can't be parsed.
 *
 * Uses HDate.add(n,'years') so leap-year month mapping (Adar / Adar II)
 * is handled by the calendar engine rather than by hand.
 */
export function nextHebrewBirthday(
  birthIso: string | undefined | null,
  today: Date,
): NextHebrewBirthday | null {
  const birth = parseIso(birthIso)
  if (!birth) return null
  try {
    const birthHd = new HDate(birth)
    const todayHd = new HDate(today)
    let cand = birthHd.add(todayHd.getFullYear() - birthHd.getFullYear(), 'years')
    if (cand.abs() < todayHd.abs()) cand = cand.add(1, 'years')
    return {
      nextDate: cand.greg(),
      turning: cand.getFullYear() - birthHd.getFullYear(),
      hebrewLabel: cand.renderGematriya(true, true),
    }
  } catch {
    return null
  }
}
