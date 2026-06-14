/**
 * Turn user-entered contact values (a handle like "@yakir", a bare number,
 * or a full URL) into safe, tappable hrefs for the profile "Contact"
 * section. Pure + unit-tested so the link-building rules can't silently
 * drift. Empty/whitespace input yields null so callers can skip the row.
 */

const clean = (v: string | undefined | null): string => (v ?? '').trim()

/** `tel:` link — keeps digits and a leading +. */
export function telHref(phone: string | undefined | null): string | null {
  const v = clean(phone)
  if (!v) return null
  const digits = v.replace(/[^\d+]/g, '')
  return digits ? `tel:${digits}` : null
}

/**
 * WhatsApp deep link (wa.me). Best-effort international format: a 10-digit
 * number starting with 0 is treated as Israeli (drop the 0, prefix 972);
 * anything already starting with a country code is used as-is.
 */
export function whatsappHref(phone: string | undefined | null): string | null {
  const v = clean(phone)
  if (!v) return null
  let d = v.replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('0') && d.length === 10) d = `972${d.slice(1)}`
  return `https://wa.me/${d}`
}

/** `mailto:` link. */
export function mailtoHref(email: string | undefined | null): string | null {
  const v = clean(email)
  return v ? `mailto:${v}` : null
}

function socialHref(base: string, value: string | undefined | null): string | null {
  const v = clean(value)
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  // Strip a leading @ and any accidental leading slashes from a handle.
  const handle = v.replace(/^@/, '').replace(/^\/+/, '')
  return handle ? `${base}/${handle}` : null
}

export const facebookHref = (v: string | undefined | null): string | null =>
  socialHref('https://facebook.com', v)

export const instagramHref = (v: string | undefined | null): string | null =>
  socialHref('https://instagram.com', v)
