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

export function canManageRelationships(profile: Profile | null | undefined): boolean {
  if (profile?.role === 'admin') return true
  if (profile?.role === 'user') return true
  return masterCan(profile, 'canManageRelationships')
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
