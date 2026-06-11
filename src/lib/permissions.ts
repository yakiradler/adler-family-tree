import { supabase } from './supabase'
import type { Relationship, Profile, UserRole, MasterPermissions } from '../types'

// ─── 4-tier RBAC helpers (Phase C/D) ────────────────────────────────────
// Centralised checks. UI gates should call these rather than inspecting
// `profile.role` directly so we can change rules in one place.
export type PermissionKey = keyof MasterPermissions

export interface PermissionContext {
  targetMemberId?: string
  nuclearFamilyIds?: Set<string>
  ownMemberId?: string
}

const ROLE_ORDER: UserRole[] = ['guest', 'user', 'master', 'admin']

export function isAdmin(profile?: Profile | null): boolean {
  return profile?.role === 'admin'
}

export function isAtLeast(profile: Profile | null | undefined, role: UserRole): boolean {
  if (!profile) return false
  return ROLE_ORDER.indexOf(profile.role) >= ROLE_ORDER.indexOf(role)
}

export function masterCan(
  profile: Profile | null | undefined,
  key: PermissionKey,
): boolean {
  if (!profile) return false
  if (profile.role === 'admin') return true
  if (profile.role !== 'master') return false
  return Boolean(profile.master_permissions?.[key])
}

export function canEditMember(
  profile: Profile | null | undefined,
  ctx: PermissionContext = {},
): boolean {
  if (!profile) return false
  if (profile.role === 'admin') return true
  if (profile.role === 'master' && profile.master_permissions?.canEditAnyMember) return true
  if (profile.role === 'guest') return false
  const target = ctx.targetMemberId
  if (!target) return false
  if (ctx.ownMemberId && target === ctx.ownMemberId) return true
  if (ctx.nuclearFamilyIds?.has(target)) return true
  return false
}

export function canDeleteMember(profile: Profile | null | undefined): boolean {
  return profile?.role === 'admin' || masterCan(profile, 'canDeleteMembers')
}

/**
 * Gate for adding/removing parent-child + spouse + sibling edges from
 * the relationship manager.
 *
 * - admin: always allowed
 * - master with canManageRelationships=true: always allowed
 * - user: allowed only when the target member is in the user's own
 *   nuclear family (or is the user themselves). Without a ctx, the
 *   answer is `false` for user-role — they cannot blanket-edit the
 *   whole tree just because they're authenticated.
 * - guest: never allowed
 */
export function canManageRelationships(
  profile: Profile | null | undefined,
  ctx: PermissionContext = {},
): boolean {
  if (!profile) return false
  if (profile.role === 'admin') return true
  if (masterCan(profile, 'canManageRelationships')) return true
  if (profile.role !== 'user') return false
  // User-role gate: only first-degree family. If ctx is missing we have
  // to refuse — the caller forgot to pass it, and returning `true` would
  // re-introduce the bug where any user can rewrite anyone's edges.
  const target = ctx.targetMemberId
  if (!target) return false
  if (ctx.ownMemberId && target === ctx.ownMemberId) return true
  return Boolean(ctx.nuclearFamilyIds?.has(target))
}

/**
 * The logged-in user's own nuclear family, walked outward from THEIR
 * member card (profile.linked_member_id): spouses, children, parents.
 *
 * This is the set `canEditMember` / `canManageRelationships` expect as
 * `ctx.nuclearFamilyIds`. Callers used to build it from the *selected*
 * member's relations, which made the `has(target)` check vacuously
 * false (a member is never inside their own relatives set) — so plain
 * users could edit nobody but themselves. Centralising the computation
 * here keeps every gate anchored to the user, not the target.
 */
export function computeNuclearFamilyIds(
  ownMemberId: string | null | undefined,
  relationships: Relationship[],
): Set<string> {
  const out = new Set<string>()
  if (!ownMemberId) return out
  for (const r of relationships) {
    if (r.type === 'spouse') {
      if (r.member_a_id === ownMemberId) out.add(r.member_b_id)
      else if (r.member_b_id === ownMemberId) out.add(r.member_a_id)
    } else if (r.type === 'parent-child') {
      // a = parent, b = child. Both directions are first-degree:
      // my children (I'm the parent) and my parents (I'm the child).
      if (r.member_a_id === ownMemberId) out.add(r.member_b_id)
      else if (r.member_b_id === ownMemberId) out.add(r.member_a_id)
    }
  }
  return out
}

export function canApproveEditRequests(profile: Profile | null | undefined): boolean {
  return profile?.role === 'admin' || masterCan(profile, 'canApproveEditRequests')
}

export function canManageInvites(profile: Profile | null | undefined): boolean {
  return profile?.role === 'admin' || masterCan(profile, 'canManageInvites')
}

export function isReadOnly(profile: Profile | null | undefined): boolean {
  return !profile || profile.role === 'guest'
}

export function isOnboarded(profile: Profile | null | undefined): boolean {
  return Boolean(profile?.onboarded_at)
}

// ─── Existing nuclear-family edit gateway (preserved) ───────────────────

function isFirstDegree(
  _currentUserId: string,
  targetMemberId: string,
  relationships: Relationship[],
  memberIdForUser: string,
): boolean {
  return relationships.some((r) => {
    const involves = (r.member_a_id === memberIdForUser && r.member_b_id === targetMemberId) ||
                     (r.member_b_id === memberIdForUser && r.member_a_id === targetMemberId)
    return involves
  })
}

export async function requestOrApplyEdit(
  currentUserId: string,
  currentUserMemberId: string,
  targetMemberId: string,
  changeData: Record<string, unknown>,
  relationships: Relationship[],
): Promise<{ autoApproved: boolean }> {
  const canAutoEdit = isFirstDegree(currentUserId, targetMemberId, relationships, currentUserMemberId)

  if (canAutoEdit) {
    const updates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(changeData)) {
      updates[key] = value
    }
    await supabase.from('members').update(updates).eq('id', targetMemberId)
    return { autoApproved: true }
  }

  await supabase.from('edit_requests').insert({
    requester_id: currentUserId,
    target_member_id: targetMemberId,
    change_data: changeData,
    status: 'pending',
  })
  return { autoApproved: false }
}
