import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type {
  Member, Relationship, EditRequest, ViewMode, Profile,
  AccessRequest, UserRole, FamilyTree, MemberNote,
} from '../types'

// Surface Supabase write failures to the UI. Until now every mutation
// swallowed errors silently in a try/catch, which is why an
// RLS-blocked update could appear to "save" (optimistic local state +
// green toast) but vanish on refresh once fetchMembers/fetchRelationships
// pulled the unchanged server state back. The PersistenceIndicator
// listens for this event and shows a red "save failed" pill so the
// user knows their change didn't reach the database.
function reportSupabaseFailure(op: string, err: unknown) {
  if (typeof window === 'undefined') return
  const message =
    err instanceof Error ? err.message
    : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message)
    : 'unknown'
  // eslint-disable-next-line no-console
  console.warn(`[supabase ${op}]`, err)
  window.dispatchEvent(
    new CustomEvent('ft-supabase-failed', { detail: { op, message } }),
  )
}

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

  // ── Tree viewport (pan + zoom persistence) ─────────────────────────
  // Preserved across mounts so closing a member panel or re-entering
  // /tree doesn't snap the user back to the auto-fit position. Only
  // resets when the user explicitly hits the "fit" button or when the
  // visible population changes shape.
  treeViewport: { tx: number; ty: number; scale: number; initialised: boolean }
  setTreeViewport: (patch: Partial<{ tx: number; ty: number; scale: number; initialised: boolean }>) => void
  resetTreeViewport: () => void

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

  // ── Member notes (comments + memories) ─────────────────────────────
  /** All notes across all members. Per-member filtering is done in the
   *  consumer (MemberNotesTab) so we keep one canonical list and don't
   *  duplicate state. Persisted via the same localStorage layer as
   *  members/relationships/trees (see App.tsx ft-state-v3). */
  notes: MemberNote[]
  addNote: (note: Omit<MemberNote, 'id' | 'created_at'>) => Promise<MemberNote | null>
  updateNote: (id: string, patch: Partial<MemberNote>) => Promise<void>
  deleteNote: (id: string) => Promise<void>
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
    // ── localStorage is the source of truth ──────────────────────────
    // Original code did `set({ members: data ?? [] })`, which silently
    // wiped local edits whenever Supabase returned [] (RLS, missing
    // table) or its older snapshot. The intermediate "merge" fix kept
    // local-only rows but still let server rows OVERWRITE locally
    // edited rows, so a spouse-status change that didn't make it past
    // RLS got reverted on the next refresh — same bug, subtler form.
    //
    // We now treat the store (hydrated from localStorage in App.tsx)
    // as authoritative. Supabase is only consulted to seed an empty
    // store on first run; after that, fetch never touches existing
    // rows. Admin can force a full reload via the AdminDashboard
    // "refresh store" button if a real cross-device sync is needed.
    const current = get().members
    if (current.length > 0) {
      set({ isLoading: false })
      return
    }
    set({ isLoading: true })
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .order('birth_date', { ascending: true })
    if (error || !Array.isArray(data) || data.length === 0) {
      set({ isLoading: false })
      return
    }
    set({ members: data as Member[], isLoading: false })
  },

  fetchRelationships: async () => {
    // Same authority rule as fetchMembers — only seed an empty store.
    const current = get().relationships
    if (current.length > 0) return
    const { data, error } = await supabase.from('relationships').select('*')
    if (error || !Array.isArray(data) || data.length === 0) return
    set({ relationships: data as Relationship[] })
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
    // Optimistic insert. If Supabase responds with a row we reconcile
    // the synthetic id; otherwise the local row stays — guaranteeing
    // the UI always reflects the user's action even offline.
    const localId = `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: Member = { ...member, id: localId } as Member
    set((s) => ({ members: [...s.members, optimistic] }))
    try {
      const { data, error } = await supabase.from('members').insert(member).select().single()
      if (error) reportSupabaseFailure('addMember', error)
      if (data) {
        set((s) => ({ members: s.members.map((m) => (m.id === localId ? (data as Member) : m)) }))
        return data as Member
      }
    } catch (err) { reportSupabaseFailure('addMember', err) }
    return optimistic
  },

  updateMember: async (id, updates) => {
    // Optimistic local update FIRST so the UI reflects the change even
    // if Supabase isn't reachable (demo mode, transient network blip).
    set((s) => ({
      members: s.members.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    }))
    try {
      const { error } = await supabase.from('members').update(updates).eq('id', id)
      if (error) reportSupabaseFailure('updateMember', error)
    } catch (err) { reportSupabaseFailure('updateMember', err) }
  },

  deleteMember: async (id) => {
    set((s) => ({ members: s.members.filter((m) => m.id !== id) }))
    try {
      const { error } = await supabase.from('members').delete().eq('id', id)
      if (error) reportSupabaseFailure('deleteMember', error)
    } catch (err) { reportSupabaseFailure('deleteMember', err) }
  },

  addRelationship: async (rel) => {
    // Optimistic insert with a synthetic id; if Supabase returns a real
    // row, swap our local one for it so the id stays in sync.
    const localId = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: Relationship = { ...rel, id: localId }
    set((s) => ({ relationships: [...s.relationships, optimistic] }))
    try {
      const { data, error } = await supabase.from('relationships').insert(rel).select().single()
      if (error) reportSupabaseFailure('addRelationship', error)
      if (data) {
        set((s) => ({
          relationships: s.relationships.map((r) =>
            r.id === localId ? (data as Relationship) : r,
          ),
        }))
      }
    } catch (err) { reportSupabaseFailure('addRelationship', err) }
  },

  updateRelationship: async (id, updates) => {
    // Local state first so the spouse-status pill flip in
    // RelationshipManager actually sticks in demo mode (and feels
    // instant in production).
    set((s) => ({
      relationships: s.relationships.map((r) =>
        r.id === id ? { ...r, ...updates } : r,
      ),
    }))
    try {
      const { error } = await supabase.from('relationships').update(updates).eq('id', id)
      if (error) reportSupabaseFailure('updateRelationship', error)
    } catch (err) { reportSupabaseFailure('updateRelationship', err) }
  },

  deleteRelationship: async (id) => {
    set((s) => ({ relationships: s.relationships.filter((r) => r.id !== id) }))
    try {
      const { error } = await supabase.from('relationships').delete().eq('id', id)
      if (error) reportSupabaseFailure('deleteRelationship', error)
    } catch (err) { reportSupabaseFailure('deleteRelationship', err) }
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

  // ── Tree viewport implementation ──────────────────────────────────
  treeViewport: { tx: 0, ty: 0, scale: 1, initialised: false },
  setTreeViewport: (patch) =>
    set((s) => ({ treeViewport: { ...s.treeViewport, ...patch } })),
  resetTreeViewport: () =>
    set({ treeViewport: { tx: 0, ty: 0, scale: 1, initialised: false } }),

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

  // ── Notes ──────────────────────────────────────────────────────────
  // Same optimistic-CRUD pattern as members: write to the local store
  // first so the UI lights up immediately, then try Supabase. Demo
  // mode (no `member_notes` table) just keeps the optimistic row,
  // which the App.tsx localStorage subscriber persists.
  notes: [],
  addNote: async (note) => {
    const localId = `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: MemberNote = {
      ...note,
      id: localId,
      created_at: new Date().toISOString(),
    }
    set((s) => ({ notes: [...s.notes, optimistic] }))
    try {
      const { data, error } = await supabase
        .from('member_notes')
        .insert({
          member_id: optimistic.member_id,
          author_id: optimistic.author_id,
          author_name: optimistic.author_name,
          body: optimistic.body,
          kind: optimistic.kind,
        })
        .select()
        .single()
      if (error) reportSupabaseFailure('addNote', error)
      if (data) {
        set((s) => ({
          notes: s.notes.map((n) => (n.id === localId ? (data as MemberNote) : n)),
        }))
        return data as MemberNote
      }
    } catch (err) { reportSupabaseFailure('addNote', err) }
    return optimistic
  },
  updateNote: async (id, patch) => {
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }))
    try { await supabase.from('member_notes').update(patch).eq('id', id) } catch (err) {
      reportSupabaseFailure('updateNote', err)
    }
  },
  deleteNote: async (id) => {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
    try { await supabase.from('member_notes').delete().eq('id', id) } catch (err) {
      reportSupabaseFailure('deleteNote', err)
    }
  },
}))
