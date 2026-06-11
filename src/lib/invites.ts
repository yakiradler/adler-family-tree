import type { TreeInvite } from '../types'

/**
 * Invite-code helpers shared by InviteCodeManager (admin tab), the
 * tree long-press menu (owner direct mint) and decideAccessRequest
 * (auto-mint on share-code approval). Pure — no Supabase imports —
 * so the rules stay unit-testable.
 */

// 10-char base32-ish code. We avoid 0/O/1/I to make codes phone-readable.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateCode(len = 10): string {
  let out = ''
  const arr = new Uint32Array(len)
  crypto.getRandomValues(arr)
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length]
  }
  // Stylise: ABCDE-12345 for readability.
  return `${out.slice(0, 5)}-${out.slice(5)}`
}

export type ExpiryChoice = 'never' | '7d' | '30d' | '90d'

export function expiryToIso(choice: ExpiryChoice, now: number = Date.now()): string | null {
  if (choice === 'never') return null
  const days = choice === '7d' ? 7 : choice === '30d' ? 30 : 90
  return new Date(now + days * 86_400_000).toISOString()
}

/** Codes minted from the share flows live this long by default. */
export const SHARE_CODE_EXPIRY_DAYS = 30

/**
 * Insert payload for a share code: 30-day expiry, unlimited uses.
 * `createdFor` marks who the code was minted FOR (the approved
 * requester) so their tree menu / notification can surface it; left
 * null for generic owner-minted codes.
 */
export function shareInviteDraft(
  treeId: string,
  createdBy: string,
  now: number = Date.now(),
  createdFor?: string,
): Omit<TreeInvite, 'id' | 'created_at'> {
  return {
    code: generateCode(),
    tree_id: treeId,
    created_by: createdBy,
    created_for: createdFor ?? null,
    expires_at: new Date(now + SHARE_CODE_EXPIRY_DAYS * 86_400_000).toISOString(),
    uses_left: null,
    note: null,
  }
}

export function isInviteActive(
  inv: Pick<TreeInvite, 'expires_at' | 'uses_left'>,
  now: number = Date.now(),
): boolean {
  if (inv.expires_at != null && new Date(inv.expires_at).getTime() <= now) return false
  if (inv.uses_left != null && inv.uses_left <= 0) return false
  return true
}

/**
 * The newest still-active GENERIC code for a tree (created_for null) —
 * owner re-opening the menu reuses it instead of minting a fresh code
 * on every click.
 */
export function pickReusableShareInvite(
  invites: TreeInvite[],
  treeId: string,
  now: number = Date.now(),
): TreeInvite | null {
  const candidates = invites
    .filter((i) => i.tree_id === treeId && i.created_for == null && isInviteActive(i, now))
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  return candidates[0] ?? null
}

/**
 * The newest still-active code minted FOR a specific user on a tree —
 * what the member sees as "הקוד שלך לעץ הזה" after approval.
 */
export function pickPersonalShareInvite(
  invites: TreeInvite[],
  treeId: string,
  userId: string,
  now: number = Date.now(),
): TreeInvite | null {
  const candidates = invites
    .filter((i) => i.tree_id === treeId && i.created_for === userId && isInviteActive(i, now))
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  return candidates[0] ?? null
}
