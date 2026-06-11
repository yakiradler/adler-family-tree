/**
 * External join links — `https://…/#/join?code=ABCDE-12345`.
 *
 * The link carries a regular invite code; opening it routes through
 * the /join page, which redeems the code for signed-in users and
 * stashes it through the login/signup flow for everyone else.
 */

export const PENDING_JOIN_KEY = 'ft-pending-join-code'

export function buildJoinUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/#/join?code=${encodeURIComponent(code)}`
}

const CODE_SHAPE = /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/

/**
 * Pull a plausible invite code out of a search string. Tolerant of
 * both `#/join?code=X` (HashRouter param) and `?code=X#/join` (mail
 * clients sometimes hoist the query before the hash).
 */
export function parseJoinCode(search: string | null | undefined): string | null {
  if (!search) return null
  const m = /[?&]code=([^&#]+)/.exec(search)
  if (!m) return null
  let raw: string
  try {
    raw = decodeURIComponent(m[1])
  } catch {
    raw = m[1]
  }
  const code = raw.trim().toUpperCase()
  return CODE_SHAPE.test(code) ? code : null
}

export function stashPendingJoinCode(code: string): void {
  try { window.localStorage.setItem(PENDING_JOIN_KEY, code) } catch { /* quota — ignore */ }
}

export function readPendingJoinCode(): string | null {
  try { return window.localStorage.getItem(PENDING_JOIN_KEY) } catch { return null }
}

export function clearPendingJoinCode(): void {
  try { window.localStorage.removeItem(PENDING_JOIN_KEY) } catch { /* ignore */ }
}
