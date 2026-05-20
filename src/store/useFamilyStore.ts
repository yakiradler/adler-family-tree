import { create } from 'zustand'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import type {
  Member, Relationship, EditRequest, ViewMode, Profile,
  AccessRequest, UserRole, FamilyTree, MemberNote,
} from '../types'

// Surface Supabase failures to the UI. The "נשמר מקומית — סנכרון
// לשרת נכשל" toast only makes sense for WRITES (the user did an
// action, we kept it locally, but it didn't propagate). For READS —
// fetchMembers / fetchEditRequests / fetchAccessRequests — there's
// nothing to "save locally"; an RLS-blocked fetch just means the
// app couldn't load some data, which is a different UX concern.
//
// A real user reported the toast popping up on every page navigation:
// landing the dashboard fired fetchEditRequests, RLS blocked it for
// non-admins, the toast appeared, they navigated to /tree, same
// failure surfaced again. The page-by-page toast was misleading
// ("nothing was 'saved locally' — it was a read") AND noisy.
//
// Split the helper:
//   • `kind: 'read'`  → console.warn only. No UI surface.
//   • `kind: 'write'` → throttled toast (≤ 1 per 20s) on real configs;
//                       silent in demo mode (local-only is expected).
const REMOTE_FAIL_THROTTLE_MS = 20_000
let lastRemoteFailureAt = 0

function reportSupabaseFailure(op: string, err: unknown, kind: 'read' | 'write' = 'write') {
  if (typeof window === 'undefined') return
  const message =
    err instanceof Error ? err.message
    : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message)
    : 'unknown'
  // eslint-disable-next-line no-console
  console.warn(`[supabase ${kind} ${op}]`, err)

  if (kind === 'read') return                   // read failure — log only
  if (!isSupabaseConfigured) return             // demo mode — local-only is expected

  const now = Date.now()
  if (now - lastRemoteFailureAt < REMOTE_FAIL_THROTTLE_MS) return
  lastRemoteFailureAt = now

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
  fetchTrees: () => Promise<void>

  // ── Tree layout mode (lifted from TreeView) ────────────────────────
  // Used to live as local state in TreeView, but the bottom-nav
  // island now exposes a "פריסה" picker that needs to read + write the
  // same value, so it had to come up here. Hydrated from localStorage
  // on first read so a user's preferred layout survives page loads.
  layoutMode: 'classic' | 'grid' | 'arc' | 'staggered'
  setLayoutMode: (m: 'classic' | 'grid' | 'arc' | 'staggered') => void

  // ── Tree-view floating-controls visibility ─────────────────────────
  // The Focused-Centric / Filters / Density chips at the top of the
  // tree page used to clutter the mobile viewport with three separate
  // pills. They now live behind a single hamburger button; this flag
  // is the shared open/close state both TreeView and TreePage read so
  // all three reveal in lockstep.
  treeControlsExpanded: boolean
  setTreeControlsExpanded: (v: boolean) => void

  // ── Tree fullscreen ────────────────────────────────────────────────
  treeFullscreen: boolean
  setTreeFullscreen: (v: boolean) => void

  // ── Single-source-of-truth for which tree-view popover is open ─────
  // The advanced-filter popover and the focused-centric picker used to
  // overlap each other on screen because each managed its own local
  // open state. Centralising the "what's open" decision here lets one
  // popover automatically close the other when it opens.
  openTreePopover: 'filter' | 'focusPicker' | null
  setOpenTreePopover: (v: 'filter' | 'focusPicker' | null) => void

  // Focused-Centric overlay state. Lifted from TreeView so TreePage
  // can hide its own chrome while focus mode is on, otherwise the
  // stale hamburger sits above the focused view and confuses people.
  isFocusedMode: boolean
  setIsFocusedMode: (v: boolean) => void
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
    // ── localStorage is the source of truth, but only for owned rows ─
    // We hydrate the store from localStorage in App.tsx, then trust
    // the local snapshot — Supabase is only consulted to seed an empty
    // store. That avoided wiping local edits when RLS returned [] or
    // an older snapshot.
    //
    // The "trust local" rule has one critical exception: if the local
    // snapshot has rows but NONE of them are owned by the current
    // user, the snapshot leaked in from somewhere else (a prior demo
    // session, a localStorage version migration, the pre-RLS Adler
    // seed surviving on a returning visitor's machine). Skipping the
    // server fetch in that case would let the leaked rows persist
    // forever. Force-fetch from the server so RLS gets a chance to
    // return the empty / scoped set the user is actually entitled to.
    const me = get().profile
    const current = get().members
    const ownsAny = me ? current.some((m) => m.created_by === me.id) : false
    if (current.length > 0 && ownsAny) {
      set({ isLoading: false })
      return
    }
    if (current.length > 0 && !ownsAny && me) {
      // Local rows exist but none are mine — they're leakage. Drop
      // them before the server fetch so the next render reflects
      // exactly what RLS authorises.
      set({ members: [], relationships: [] })
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
    const { data, error } = await supabase
      .from('edit_requests')
      .select(`*, profiles:requester_id(full_name), members:target_member_id(first_name, last_name)`)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) {
      // Surface this — previously the admin would see "no requests"
      // forever even when the backend was returning errors (RLS
      // blocked, table missing). We now log + keep whatever optimistic
      // state was there before so the UI doesn't silently empty out.
      reportSupabaseFailure('fetchEditRequests', error, 'read')
      return
    }

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
    // Cascade locally: orphaned relationships pointing at a deleted
    // member would otherwise leave the layout engine with dangling
    // edges, producing ghost / overlapping cards on the next render.
    // Supabase itself cascades via `on delete cascade` in schema.sql,
    // so we don't need a second DB call for relationships.
    set((s) => ({
      members: s.members.filter((m) => m.id !== id),
      relationships: s.relationships.filter(
        (r) => r.member_a_id !== id && r.member_b_id !== id,
      ),
      selectedMemberId: s.selectedMemberId === id ? null : s.selectedMemberId,
    }))
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
    const { data, error } = await supabase
      .from('access_requests')
      .select(`*, profiles:requester_id(full_name)`)
      .order('created_at', { ascending: false })
    if (error) {
      reportSupabaseFailure('fetchAccessRequests', error, 'read')
      return  // keep optimistic state intact
    }
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
    // Optimistic write first so the admin instantly sees the request
    // even in demo mode (where Supabase returns nothing) and even when
    // the backend INSERT fails because of RLS / missing table. The
    // request id is synthetic; if Supabase comes back with a real
    // row we reconcile below.
    const localId = `ar-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: AccessRequest = {
      id: localId,
      requester_id: me.id,
      requester_name: me.full_name ?? 'Unknown',
      requested_role,
      answers,
      invite_code: invite_code ?? null,
      status: 'pending',
      created_at: new Date().toISOString(),
    }
    set((s) => ({ accessRequests: [optimistic, ...s.accessRequests] }))
    try {
      const { data, error } = await supabase.from('access_requests').insert({
        requester_id: me.id,
        requested_role,
        answers,
        invite_code: invite_code ?? null,
        status: 'pending',
      }).select().single()
      if (error) {
        reportSupabaseFailure('submitAccessRequest', error)
        return
      }
      if (data) {
        set((s) => ({
          accessRequests: s.accessRequests.map((r) =>
            r.id === localId ? (data as AccessRequest) : r,
          ),
        }))
      }
    } catch (err) {
      reportSupabaseFailure('submitAccessRequest', err)
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
  fetchTrees: async () => {
    // Trees the current user has access to.  RLS on family_trees
    // (migration 009) limits visible rows to those the user owns or
    // has a tree_access entry for.  Admins see everything via the
    // is_admin bypass.  We replace the in-memory list wholesale so a
    // joined-via-code tree shows up immediately.
    try {
      const { data, error } = await supabase
        .from('family_trees')
        .select('*')
        .order('created_at', { ascending: true })
      if (error) {
        reportSupabaseFailure('fetchTrees', error, 'read')
        return
      }
      if (Array.isArray(data)) set({ trees: data as FamilyTree[] })
    } catch (err) {
      reportSupabaseFailure('fetchTrees', err, 'read')
    }
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
          image_url: optimistic.image_url ?? null,
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

  // ── Layout mode (hydrated from localStorage) ───────────────────────
  layoutMode:
    typeof window !== 'undefined'
      ? (() => {
          const v = window.localStorage.getItem('ft-tree-layout-mode')
          return v === 'grid' || v === 'arc' || v === 'staggered' ? v : 'classic'
        })()
      : 'classic',
  setLayoutMode: (m) => {
    try { window.localStorage.setItem('ft-tree-layout-mode', m) } catch { /* ignore */ }
    set({ layoutMode: m })
  },

  // ── Tree-view floating-controls visibility ─────────────────────────
  treeControlsExpanded: false,
  setTreeControlsExpanded: (treeControlsExpanded) => set({ treeControlsExpanded }),

  // ── Tree fullscreen ────────────────────────────────────────────────
  // When true, ALL floating chrome (top bar, panels, nav island,
  // floating chips, zoom/export controls) is hidden so the user has
  // an unobstructed view of the tree. A small "exit" button stays
  // pinned in the same spot the fullscreen toggle lives so the user
  // can always get back to the chrome.
  treeFullscreen: false,
  setTreeFullscreen: (treeFullscreen) => set({ treeFullscreen }),

  openTreePopover: null,
  setOpenTreePopover: (openTreePopover) => set({ openTreePopover }),

  // Focused-Centric overlay flag. Lifted from TreeView so TreePage
  // can hide its own chrome (top bar, hamburger) while the focused
  // view is on top — used to leave a stale X-button (the hamburger
  // close glyph) floating and the user couldn't tell which control
  // exits focus mode.
  isFocusedMode: false,
  setIsFocusedMode: (isFocusedMode) => set({ isFocusedMode }),
}))
