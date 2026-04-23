import { supabase } from './supabase'
import type { Relationship } from '../types'

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
