import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type {
  Member, Relationship, EditRequest, ViewMode, Profile,
  AccessRequest, UserRole, FamilyTree,
} from '../types'

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
  updateRelationship: (id: string, updates: Partial<Relationship>) => Promise<void>
  deleteRelationship: (id: string) => Promise<void>

  approveEditRequest: (requestId: string) => Promise<void>
  rejectEditRequest: (requestId: string) => Promise<void>

  // ── Onboarding + RBAC (Phase C/D) ───────────────────────────────────
  accessRequests: AccessRequest[]
  fetchAccessRequests: () => Promise<void>
  submitAccessRequest: (
    payload: Pick<AccessRequest, 'requested_role' | 'answers' | 'invite_code'>,
  ) => Promise<void>
  decideAccessRequest: (
    id: string, decision: 'approved' | 'rejected',
    grantedRole?: UserRole,
  ) => Promise<void>
  completeOnboarding: (patch: Partial<Profile>) => Promise<void>
  updateProfileById: (id: string, patch: Partial<Profile>) => Promise<void>

  // ── Multi-tree (Phase F) ────────────────────────────────────────────
  /**
   * Trees the current user has access to. The "main" tree is implicit
   * (every Member without a tree_id belongs to it) so this list is
   * additive — adding a tree doesn't migrate the existing population.
   */
  trees: FamilyTree[]
  /** null = the main/default tree (members without tree_id). */
  activeTreeId: string | null
  setActiveTreeId: (id: string | null) => void
  addTree: (tree: Omit<FamilyTree, 'id'>) => Promise<FamilyTree | null>
  updateTree: (id: string, patch: Partial<FamilyTree>) => Promise<void>
  deleteTree: (id: string) => Promise<void>
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

  updateRelationship: async (id, updates) => {
    await supabase.from('relationships').update(updates).eq('id', id)
    set((s) => ({
      relationships: s.relationships.map((r) =>
        r.id === id ? { ...r, ...updates } : r,
      ),
    }))
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

  // ── Onboarding + RBAC ────────────────────────────────────────────────
  accessRequests: [],

  fetchAccessRequests: async () => {
    const { data } = await supabase
      .from('access_requests')
      .select(`*, profiles:requester_id(full_name)`)
      .order('created_at', { ascending: false })
    const mapped: AccessRequest[] = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      requester_id: r.requester_id as string,
      requester_name: (r.profiles as { full_name: string } | null)?.full_name ?? 'Unknown',
      requested_role: r.requested_role as UserRole,
      answers: (r.answers as Record<string, unknown>) ?? {},
      invite_code: (r.invite_code as string | null) ?? null,
      status: r.status as AccessRequest['status'],
      decided_by: (r.decided_by as string | null) ?? null,
      decided_at: (r.decided_at as string | null) ?? null,
      created_at: r.created_at as string,
    }))
    set({ accessRequests: mapped })
  },

  submitAccessRequest: async ({ requested_role, answers, invite_code }) => {
    const me = get().profile
    if (!me) return
    const row = {
      requester_id: me.id,
      requested_role,
      answers,
      invite_code: invite_code ?? null,
      status: 'pending' as const,
    }
    const { data } = await supabase.from('access_requests').insert(row).select().single()
    if (data) {
      set((s) => ({ accessRequests: [data as AccessRequest, ...s.accessRequests] }))
    }
  },

  decideAccessRequest: async (id, decision, grantedRole) => {
    const req = get().accessRequests.find(r => r.id === id)
    const patch: Record<string, unknown> = {
      status: decision,
      decided_at: new Date().toISOString(),
    }
    await supabase.from('access_requests').update(patch).eq('id', id)
    if (decision === 'approved' && req) {
      const role = grantedRole ?? req.requested_role
      await supabase.from('profiles').update({ role }).eq('id', req.requester_id)
    }
    set((s) => ({
      accessRequests: s.accessRequests.map(r =>
        r.id === id ? { ...r, status: decision, decided_at: patch.decided_at as string } : r,
      ),
    }))
  },

  completeOnboarding: async (patch) => {
    const me = get().profile
    if (!me) return
    const finalPatch: Partial<Profile> = {
      ...patch,
      onboarded_at: new Date().toISOString(),
    }
    await supabase.from('profiles').update(finalPatch).eq('id', me.id)
    set({ profile: { ...me, ...finalPatch } })
  },

  updateProfileById: async (id, patch) => {
    await supabase.from('profiles').update(patch).eq('id', id)
    const me = get().profile
    if (me?.id === id) set({ profile: { ...me, ...patch } })
  },

  // ── Multi-tree implementation ──────────────────────────────────────
  // Persisted in Supabase if a `family_trees` table is provisioned;
  // otherwise everything lives in-memory which is fine for demo + the
  // first migration window. Members carry an optional `tree_id` so the
  // active tree filter can drop in without a schema migration.
  trees: [],
  activeTreeId:
    typeof window !== 'undefined'
      ? window.localStorage.getItem('ft-active-tree-id') || null
      : null,
  setActiveTreeId: (id) => {
    try {
      if (id) window.localStorage.setItem('ft-active-tree-id', id)
      else window.localStorage.removeItem('ft-active-tree-id')
    } catch { /* ignore quota */ }
    set({ activeTreeId: id })
  },
  addTree: async (tree) => {
    const localId = `tree-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: FamilyTree = { ...tree, id: localId }
    set((s) => ({ trees: [...s.trees, optimistic] }))
    try {
      const { data, error } = await supabase
        .from('family_trees')
        .insert(tree)
        .select('*')
        .single()
      if (!error && data) {
        set((s) => ({ trees: s.trees.map((t) => (t.id === localId ? (data as FamilyTree) : t)) }))
        return data as FamilyTree
      }
    } catch { /* offline / no table — keep optimistic row */ }
    return optimistic
  },
  updateTree: async (id, patch) => {
    set((s) => ({ trees: s.trees.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
    try { await supabase.from('family_trees').update(patch).eq('id', id) } catch { /* ignore */ }
  },
  deleteTree: async (id) => {
    set((s) => ({
      trees: s.trees.filter((t) => t.id !== id),
      activeTreeId: s.activeTreeId === id ? null : s.activeTreeId,
    }))
    try { await supabase.from('family_trees').delete().eq('id', id) } catch { /* ignore */ }
  },
}))
