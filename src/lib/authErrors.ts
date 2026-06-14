import type { Translations } from '../i18n/useT'

/**
 * Map a Supabase auth error to a localized, human message so a Hebrew-first
 * family user never sees a raw English string ("Invalid login credentials")
 * inside an RTL card. Switches on the stable Supabase `error.code` when
 * present, falls back to message-substring matching, and finally a generic
 * localized error. Unmapped causes are logged for diagnosis.
 */
export function mapAuthError(err: unknown, t: Translations): string {
  const code =
    typeof err === 'object' && err && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : ''
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  const has = (s: string) => msg.includes(s)

  if (code === 'invalid_credentials' || has('invalid login credentials'))
    return t.authErrInvalidCredentials
  if (code === 'email_not_confirmed' || has('email not confirmed') || has('not confirmed'))
    return t.authErrEmailNotConfirmed
  if (
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    has('rate limit') ||
    has('for security purposes') ||
    has('too many')
  )
    return t.authErrRateLimit
  if (
    code === 'weak_password' ||
    has('password should be') ||
    has('weak password') ||
    has('at least 6')
  )
    return t.authErrWeakPassword
  if (
    code === 'user_already_exists' ||
    has('already registered') ||
    has('already been registered')
  )
    return t.authEmailAlreadyRegistered
  if (
    code === 'validation_failed' ||
    has('unable to validate email') ||
    has('invalid email') ||
    has('invalid format')
  )
    return t.authErrInvalidEmail

  // Nothing matched — log the raw cause so we can add a mapping later, but
  // show the user a clean generic message rather than English internals.
  if (msg) console.warn('[auth] unmapped error:', err)
  return t.genericError
}
