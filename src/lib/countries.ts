import type { Member } from '../types'

/**
 * Country + heritage helpers for the member origin flags (migration 035).
 *
 * Country names come from the browser's own `Intl.DisplayNames` — free,
 * localized Hebrew/English, no dataset to maintain. We only keep the ISO
 * alpha-2 code list here (~250 short strings).
 *
 * `heritage_code` holds EITHER an ISO country code (rendered as that
 * country's flag) OR a symbol token from HERITAGE_TOKENS below (rendered
 * as an inline SVG). Unknown values render nothing — so a future token
 * added by a newer client can't break an older one.
 */

// ISO-3166-1 alpha-2 — officially assigned codes.
export const COUNTRY_CODES: readonly string[] = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS',
  'BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN',
  'CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE',
  'EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF',
  'GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM',
  'HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM',
  'JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC',
  'LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK',
  'ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA',
  'NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG',
  'PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW',
  'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS',
  'ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO',
  'TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI',
  'VN','VU','WF','WS','YE','YT','ZA','ZM','ZW',
]

/** Symbol tokens for heritage_code that are NOT country flags. */
export const HERITAGE_TOKENS = ['jewish'] as const
export type HeritageToken = (typeof HERITAGE_TOKENS)[number]

export function isCountryCode(code: string | null | undefined): code is string {
  return !!code && /^[A-Z]{2}$/.test(code) && COUNTRY_CODES.includes(code)
}

export function isHeritageToken(code: string | null | undefined): code is HeritageToken {
  return !!code && (HERITAGE_TOKENS as readonly string[]).includes(code)
}

// Intl.DisplayNames instances are surprisingly expensive to construct —
// build each locale's once and reuse.
const displayNamesCache = new Map<string, Intl.DisplayNames | null>()

function regionNames(locale: 'he' | 'en'): Intl.DisplayNames | null {
  if (!displayNamesCache.has(locale)) {
    try {
      displayNamesCache.set(locale, new Intl.DisplayNames([locale], { type: 'region' }))
    } catch {
      displayNamesCache.set(locale, null)
    }
  }
  return displayNamesCache.get(locale) ?? null
}

/** Localized country name; falls back to the raw code if Intl fails. */
export function countryName(code: string, lang: 'he' | 'en'): string {
  try {
    return regionNames(lang)?.of(code) ?? code
  } catch {
    return code
  }
}

/**
 * Search text for a country covering BOTH languages, so a Hebrew user can
 * also type "france" and vice versa. Lower-cased.
 */
export function countryHaystack(code: string): string {
  return `${code} ${countryName(code, 'he')} ${countryName(code, 'en')}`.toLowerCase()
}

/**
 * Feature detection for migration 035. Server rows include every column
 * (as null) once the migration ran; before that, sending the new columns
 * in an UPDATE would 42703 and roll the whole edit back — so the pickers
 * hide until a server-confirmed row proves the columns exist. Demo mode
 * (no backend) always supports them.
 */
export function supportsMemberFlags(members: Member[], isSupabaseConfigured: boolean): boolean {
  if (!isSupabaseConfigured) return true
  const serverRow = members.find((m) => !m.id.startsWith('mem-'))
  if (!serverRow) return false
  return 'birth_country_code' in serverRow
}
