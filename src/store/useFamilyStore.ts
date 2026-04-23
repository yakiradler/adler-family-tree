import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Member, Relationship, EditRequest, ViewMode, Profile } from '../types'

interface FamilyState {
  profile: Profile | null
  members: Member[]
  relationships: Relationship[]
  editRequests: EditRequest[]
  viewMode: ViewMode
  selectedMemberId: string | null
  isLoading: boolean

  setProfile: (profile: Profile | null) => void
  setViewMode: (mode: ViewMode) => void
  setSelectedMemberId: (id: string | null) => void

  fetchMembers: () => Promise<void>
  fetchRelationships: () => Promise<void>
  fetchEditRequests: () => Promise<void>

  addMember: (member: Omit<Member, 'id'>) => Promise<Member | null>
  updateMember: (id: string, updates: Partial<Member>) => Promise<void>
  deleteMember: (id: string) => Promise<void>

  addRelationship: (rel: Omit<Relationship, 'id'>) => Promise<void>
  deleteRelationship: (id: string) => Promise<void>

  approveEditRequest: (requestId: string) => Promise<void>
  rejectEditRequest: (requestId: string) => Promise<void>
}

export const useFamilyStore = create<FamilyState>((set, get) => ({
  profile: null,
  members: [],
  relationships: [],
  editRequests: [],
  viewMode: 'tree',
  selectedMemberId: null,
  isLoading: false,

  setProfile: (profile) => set({ profile }),
  setViewMode: (viewMode) => set({ viewMode }),
  setSelectedMemberId: (selectedMemberId) => set({ selectedMemberId }),

  fetchMembers: async () => {
    set({ isLoading: true })
    const { data } = await supabase.from('members').select('*').order('birth_date', { ascending: true })
    set({ members: data ?? [], isLoading: false })
  },

  fetchRelationships: async () => {
    const { data } = await supabase.from('relationships').select('*')
    set({ relationships: data ?? [] })
  },

  fetchEditRequests: async () => {
    const { data } = await supabase
      .from('edit_requests')
      .select(`*, profiles:requester_id(full_name), members:target_member_id(first_name, last_name)`)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    const mapped = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      requester_id: r.requester_id as string,
      requester_name: (r.profiles as { full_name: string } | null)?.full_name ?? 'Unknown',
      target_member_id: r.target_member_id as string,
      target_member_name: r.members
        ? `${(r.members as { first_name: string; last_name: string }).first_name} ${(r.members as { first_name: string; last_name: string }).last_name}`
        : 'Unknown',
      change_data: r.change_data as Record<string, unknown>,
      status: r.status as EditRequest['status'],
      created_at: r.created_at as string,
    }))
    set({ editRequests: mapped })
  },

  addMember: async (member) => {
    const { data } = await supabase.from('members').insert(member).select().single()
    if (data) {
      set((s) => ({ members: [...s.members, data] }))
      return data
    }
    // Demo-mode fallback
    const local: Member = { ...member, id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` } as Member
    set((s) => ({ members: [...s.members, local] }))
    return local
  },

  updateMember: async (id, updates) => {
    await supabase.from('members').update(updates).eq('id', id)
    set((s) => ({
      members: s.members.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    }))
  },

  deleteMember: async (id) => {
    await supabase.from('members').delete().eq('id', id)
    set((s) => ({ members: s.members.filter((m) => m.id !== id) }))
  },

  addRelationship: async (rel) => {
    const { data } = await supabase.from('relationships').insert(rel).select().single()
    if (data) {
      set((s) => ({ relationships: [...s.relationships, data] }))
    } else {
      // Demo-mode fallback: no supabase row returned, create local one
      const local: Relationship = { ...rel, id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
      set((s) => ({ relationships: [...s.relationships, local] }))
    }
  },

  deleteRelationship: async (id) => {
    await supabase.from('relationships').delete().eq('id', id)
    set((s) => ({ relationships: s.relationships.filter((r) => r.id !== id) }))
  },

  approveEditRequest: async (requestId) => {
    const req = get().editRequests.find((r) => r.id === requestId)
    if (!req) return
    await supabase.from('members').update(req.change_data).eq('id', req.target_member_id)
    await supabase.from('edit_requests').update({ status: 'approved' }).eq('id', requestId)
    set((s) => ({ editRequests: s.editRequests.filter((r) => r.id !== requestId) }))
    await get().fetchMembers()
  },

  rejectEditRequest: async (requestId) => {
    await supabase.from('edit_requests').update({ status: 'rejected' }).eq('id', requestId)
    set((s) => ({ editRequests: s.editRequests.filter((r) => r.id !== requestId) }))
  },
}))
