import { create } from 'zustand'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { canApproveEditRequests, isAdmin } from '../lib/permissions'
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

// Inserts guarded by member_visible_to() occasionally hit a transient
// RLS visibility race: a member committed moments earlier isn't yet
// visible to the policy check on the very next insert, so it's rejected
// even though the same insert succeeds a beat later. The add-relative
// flow (create member → immediately link it) is the classic trigger,
// and a single retry wasn't always enough — the link silently failed
// and vanished on the next refresh. Retry a few times with growing
// backoff before giving up.
async function insertWithRetry<T>(
  attempt: () => PromiseLike<{ data: T | null; error: unknown }>,
  delays: number[] = [250, 600, 1200, 2000],
): Promise<{ data: T | null; error: unknown }> {
  let res = await attempt()
  let i = 0
  while (res.error && i < delays.length) {
    await new Promise((r) => setTimeout(r, delays[i++]))
    res = await attempt()
  }
  return res
}

// ─── Relationship tombstones ──────────────────────────────────────────
// IDs of relationships the user has explicitly deleted in this session
// (via `deleteRelationship`). `fetchRelationships` consults this set
// before merging server data with local optimistic rows, so a row the
// user just deleted can't come back from the dead — both via a re-fetch
// before the DELETE landed (server still has it) and via a stale
// localStorage snapshot (local UUID row never reconciled). We keep this
// outside Zustand state because it must not trigger UI re-renders and
// its lifetime is the JS module (not persisted).
const deletedRelationshipIds = new Set<string>()

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
  // ── Tree edit mode (per-card + buttons) ───────────────────────────
  // When true, MemberNode renders four small "+" buttons around each
  // card (top=parent, end=spouse, bottom=child, start=sibling) that
  // open a quick-add popover. Default off so casual browsing isn't
  // crowded with editing chrome. Persisted to localStorage so
  // switching between tabs (/home → /tree) keeps the mode active.
  isEditMode: boolean
  setEditMode: (v: boolean) => void
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
    // ── Hydration policy ──────────────────────────────────────────────
    // Demo mode (no Supabase configured): localStorage IS the source of
    // truth — there's nowhere else to fetch from, so we skip the
    // network call entirely if we have anything local.
    //
    // Supabase mode: always re-fetch on login. Previously this function
    // exited early as soon as `current.length > 0 && (ownsAny ||
    // isAdmin)`, which meant an admin whose localStorage held stale
    // demo data NEVER consulted Supabase — every edit they made was
    // applied to the leaked snapshot, never to the real DB, and they
    // worked on phantom data until they cleared storage. We force-
    // fetch instead and merge: server rows are authoritative; local
    // optimistic writes (with synthetic `mem-` IDs that the server
    // doesn't know about yet) are preserved so in-flight edits don't
    // get clobbered mid-flight.
    const me = get().profile
    const current = get().members

    if (!isSupabaseConfigured) {
      if (current.length > 0) {
        set({ isLoading: false })
        return
      }
      // Demo mode with empty local — nothing else to do.
      set({ isLoading: false })
      return
    }

    // Non-admin with rows but none they own: residual leakage from
    // pre-RLS state. Drop before fetching so RLS authoritatively
    // returns what they're allowed to see. (Renamed local from
    // `isAdmin` to `meIsAdmin` to avoid colliding with the function
    // imported from lib/permissions.)
    const meIsAdmin = me?.role === 'admin'
    const ownsAny = me ? current.some((m) => m.created_by === me.id) : false
    if (current.length > 0 && !ownsAny && !meIsAdmin && me) {
      set({ members: [], relationships: [] })
    }

    set({ isLoading: true })
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .order('birth_date', { ascending: true })
    if (error) {
      reportSupabaseFailure('fetchMembers', error, 'read')
      set({ isLoading: false })
      return
    }
    if (!Array.isArray(data)) {
      set({ isLoading: false })
      return
    }
    if (data.length === 0) {
      // Server returned an empty set. Could be a brand-new account or
      // an RLS-scoped read with no allowed rows. Keep whatever local
      // optimistic rows we have so an in-flight create isn't wiped,
      // but drop server-authoritative rows that no longer exist.
      const localOptimistic = current.filter((m) => m.id.startsWith('mem-'))
      set({ members: localOptimistic, isLoading: false })
      return
    }
    const serverRows = data as Member[]
    const serverIds = new Set(serverRows.map((m) => m.id))
    // Preserve any synthetic-id local rows the server doesn't know
    // about yet (mid-flight optimistic creates). Server rows take
    // precedence for everything they cover.
    const localOptimistic = current.filter(
      (m) => m.id.startsWith('mem-') && !serverIds.has(m.id),
    )
    set({ members: [...serverRows, ...localOptimistic], isLoading: false })
  },

  fetchRelationships: async () => {
    // Always pull from the server when reachable.  Previous build had
    // an early-exit if any local rows existed, which permanently
    // stranded users whose original seedSkeletonFamily INSERTs were
    // RLS-blocked: their local store cached an empty relationships
    // array (or partially-failed optimistic ones), and the early-exit
    // prevented a recovery fetch from picking up the heal.  We now
    // fetch every time; if the server returns a non-empty result we
    // merge it with any *unsynced* optimistic rows (those with the
    // local `rel-` id prefix) so that mid-flight edits aren't lost.
    const { data, error } = await supabase.from('relationships').select('*')
    if (error) {
      reportSupabaseFailure('fetchRelationships', error, 'read')
      return
    }
    if (!Array.isArray(data)) return
    if (data.length === 0) {
      // Server returned empty — could be RLS blocking or a fresh
      // account.  Keep whatever is local rather than wiping pending
      // optimistic edits.
      return
    }
    const serverRows = data as Relationship[]
    const serverIds = new Set(serverRows.map((r) => r.id))
    // Preserve ANY local row the server doesn't have — not just ones
    // with the `rel-` prefix.  Some optimistic rows acquire a UUID
    // (e.g. a previous Supabase success that later orphaned because
    // its member was wiped by an RLS race), and dropping those silently
    // lost the spouse link between יחזקאל and שיינדל on the live tree.
    //
    // Guard against resurrection: a row in `deletedRelationshipIds`
    // was explicitly deleted by the user this session. Even if our
    // local UUID row still exists in `get().relationships` (because
    // the optimistic delete and a concurrent fetch raced), don't
    // bring it back. Server side this row is either already gone or
    // about to be — either way the user's intent was DELETE.
    const localOptimistic = get().relationships.filter(
      (r) => !serverIds.has(r.id) && !deletedRelationshipIds.has(r.id),
    )
    // Once the server confirms a tombstoned row is gone (i.e. it's
    // missing from serverIds), we can prune the tombstone. Keeping
    // them indefinitely would slowly leak memory for long sessions.
    for (const id of deletedRelationshipIds) {
      if (!serverIds.has(id)) deletedRelationshipIds.delete(id)
    }
    set({ relationships: [...serverRows, ...localOptimistic] })
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
    // ── tree_id enforcement ──────────────────────────────────────────
    // Every member MUST belong to a tree (migration 011). If the
    // caller forgot to pass tree_id, fall back to the activeTreeId
    // from the store so the caller's omission doesn't leak the member
    // into "the implicit main tree" — which is the bug that prompted
    // the rewrite. In demo mode we tolerate a synthetic 'demo-default'
    // bucket so the local seed continues to work without a tree row.
    const activeTreeId = get().activeTreeId
    const effectiveTreeId =
      member.tree_id ?? activeTreeId ?? (isSupabaseConfigured ? null : 'demo-default')
    if (isSupabaseConfigured && !effectiveTreeId) {
      // Supabase mode + no active tree + caller didn't pass one → refuse.
      // Surface to the UI so the user knows to pick a tree first.
      reportSupabaseFailure('addMember', new Error('No active tree — pick or create one first'))
      return null
    }
    const payload: Omit<Member, 'id'> = { ...member, tree_id: effectiveTreeId }

    // Optimistic insert. If Supabase responds with a row we reconcile
    // the synthetic id; otherwise the local row stays — guaranteeing
    // the UI always reflects the user's action even offline.
    const localId = `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: Member = { ...payload, id: localId } as Member
    set((s) => ({ members: [...s.members, optimistic] }))
    // Demo mode — keep the optimistic row, there's no backend to sync to.
    if (!isSupabaseConfigured) return optimistic

    // Same transient RLS visibility race as addRelationship: when members
    // are added back-to-back the visibility-check helper can race the
    // previous tuple's commit and reject. Retry with growing backoff.
    const tryInsert = () => supabase.from('members').insert(payload).select().single()
    try {
      const { data, error } = await insertWithRetry(tryInsert)
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
    // ── Sanity guards ────────────────────────────────────────────────
    // (a) Self-edges are always nonsense — refuse them early so a
    //     misclick doesn't poison the relationships table.
    if (rel.member_a_id === rel.member_b_id) {
      // eslint-disable-next-line no-console
      console.warn('[addRelationship] refusing self-edge', rel)
      return
    }
    // (b) Cycle detection for parent-child. If the proposed child is
    //     already an ancestor of the proposed parent, this edge would
    //     form a loop in the parent-child graph — breaking generation
    //     math, the layout fixpoint, and any UI that walks ancestors.
    //     Walking from the proposed parent upward is O(N) on a
    //     reasonably sized tree.
    if (rel.type === 'parent-child') {
      const allRels = get().relationships
      const seen = new Set<string>([rel.member_a_id])
      const stack = [rel.member_a_id]
      let cycle = false
      while (stack.length && !cycle) {
        const cur = stack.pop()!
        for (const r of allRels) {
          if (r.type !== 'parent-child') continue
          if (r.member_b_id !== cur) continue
          const parent = r.member_a_id
          if (parent === rel.member_b_id) { cycle = true; break }
          if (seen.has(parent)) continue
          seen.add(parent)
          stack.push(parent)
        }
      }
      if (cycle) {
        // eslint-disable-next-line no-console
        console.warn(
          '[addRelationship] refusing parent-child edge that would create a cycle',
          rel,
        )
        return
      }
    }

    // Optimistic insert with a synthetic id; if Supabase returns a real
    // row, swap our local one for it so the id stays in sync.
    const localId = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: Relationship = { ...rel, id: localId }
    set((s) => ({ relationships: [...s.relationships, optimistic] }))
    // Demo mode has no backend — the optimistic edge is the source of
    // truth, so don't attempt (and pointlessly retry) a network insert.
    if (!isSupabaseConfigured) return

    const rollback = () =>
      set((s) => ({ relationships: s.relationships.filter((r) => r.id !== localId) }))

    const tryInsert = async () => supabase.from('relationships').insert(rel).select().single()
    try {
      const { data, error } = await insertWithRetry(tryInsert)
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[addRelationship] failed after retries:', error, rel)
        // Roll back the optimistic edge. Leaving it would show a "saved"
        // link that never reached the server — it vanishes on the next
        // refresh and silently breaks the tree. Rolling back + the error
        // toast tells the user the link didn't save so they can retry.
        rollback()
        reportSupabaseFailure('addRelationship', error)
        return
      }
      if (data) {
        set((s) => ({
          relationships: s.relationships.map((r) =>
            r.id === localId ? (data as Relationship) : r,
          ),
        }))
      }
    } catch (err) {
      rollback()
      reportSupabaseFailure('addRelationship', err)
    }
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
    // Tombstone BEFORE optimistic removal — if a concurrent fetch races
    // with our DELETE, the merge in fetchRelationships will see the ID
    // in the tombstone set and skip resurrecting it.
    deletedRelationshipIds.add(id)
    set((s) => ({ relationships: s.relationships.filter((r) => r.id !== id) }))
    try {
      const { error } = await supabase.from('relationships').delete().eq('id', id)
      if (error) reportSupabaseFailure('deleteRelationship', error)
    } catch (err) { reportSupabaseFailure('deleteRelationship', err) }
  },

  approveEditRequest: async (requestId) => {
    const req = get().editRequests.find((r) => r.id === requestId)
    if (!req) return
    // RBAC gate: app-level check that the caller is permitted to approve.
    // Supabase RLS is the source of truth, but per AGENTS.md the app
    // must also gate so a misconfigured RLS doesn't silently expose the
    // action.
    if (!canApproveEditRequests(get().profile)) return
    // Optimistic: drop the request locally + apply the member patch so
    // the admin sees their approval land immediately, even in demo mode
    // (no Supabase) or when RLS later rejects the write.
    set((s) => ({
      editRequests: s.editRequests.filter((r) => r.id !== requestId),
      members: s.members.map((m) =>
        m.id === req.target_member_id
          ? ({ ...m, ...(req.change_data as Partial<Member>) })
          : m,
      ),
    }))
    let memberOk = false
    try {
      const { error: mErr } = await supabase
        .from('members')
        .update(req.change_data)
        .eq('id', req.target_member_id)
      if (mErr) reportSupabaseFailure('approveEditRequest:member', mErr)
      else memberOk = true
    } catch (err) {
      reportSupabaseFailure('approveEditRequest:member', err)
    }
    // Only mark the request approved if the member write actually
    // landed — otherwise an admin retry has something to retry.
    if (memberOk) {
      try {
        const { error: rErr } = await supabase
          .from('edit_requests')
          .update({ status: 'approved' })
          .eq('id', requestId)
        if (rErr) reportSupabaseFailure('approveEditRequest:request', rErr)
      } catch (err) {
        reportSupabaseFailure('approveEditRequest:request', err)
      }
    }
    // Refresh from the server so any constraints / triggers that
    // shape the result (computed columns, defaults) are reflected.
    await get().fetchMembers()
  },

  rejectEditRequest: async (requestId) => {
    if (!canApproveEditRequests(get().profile)) return
    // Optimistic drop first; Supabase status update is best-effort.
    set((s) => ({ editRequests: s.editRequests.filter((r) => r.id !== requestId) }))
    try {
      const { error } = await supabase
        .from('edit_requests')
        .update({ status: 'rejected' })
        .eq('id', requestId)
      if (error) reportSupabaseFailure('rejectEditRequest', error)
    } catch (err) {
      reportSupabaseFailure('rejectEditRequest', err)
    }
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
    // App-level admin gate. RLS still authoritative server-side; this
    // mirrors that policy locally so the action is rejected before any
    // optimistic state change in demo mode.
    if (!isAdmin(get().profile)) return
    const req = get().accessRequests.find(r => r.id === id)
    const decidedAt = new Date().toISOString()
    // Optimistic update first so the admin sees the decision land
    // instantly even when Supabase is offline or RLS-blocked.
    set((s) => ({
      accessRequests: s.accessRequests.map(r =>
        r.id === id ? { ...r, status: decision, decided_at: decidedAt } : r,
      ),
    }))
    try {
      const { error: aErr } = await supabase
        .from('access_requests')
        .update({ status: decision, decided_at: decidedAt })
        .eq('id', id)
      if (aErr) reportSupabaseFailure('decideAccessRequest:request', aErr)
    } catch (err) {
      reportSupabaseFailure('decideAccessRequest:request', err)
    }
    if (decision === 'approved' && req) {
      const role = grantedRole ?? req.requested_role
      try {
        const { error: pErr } = await supabase
          .from('profiles')
          .update({ role })
          .eq('id', req.requester_id)
        if (pErr) {
          reportSupabaseFailure('decideAccessRequest:profile', pErr)
        } else {
          // If the admin just approved their OWN request (e.g. they
          // self-promoted from `user` to `master` for testing) the
          // local profile slice has to reflect the new role too,
          // otherwise the UI keeps gating them out of master-only
          // features until next reload.
          const me = get().profile
          if (me?.id === req.requester_id) {
            set({ profile: { ...me, role } })
          }
        }
      } catch (err) {
        reportSupabaseFailure('decideAccessRequest:profile', err)
      }
    }
  },

  completeOnboarding: async (patch) => {
    const me = get().profile
    if (!me) return
    const finalPatch: Partial<Profile> = {
      ...patch,
      onboarded_at: new Date().toISOString(),
    }
    // Local first so the dashboard banner disappears immediately even
    // when Supabase is offline / RLS hasn't propagated.
    set({ profile: { ...me, ...finalPatch } })
    try {
      const { error } = await supabase
        .from('profiles')
        .update(finalPatch)
        .eq('id', me.id)
      if (error) reportSupabaseFailure('completeOnboarding', error)
    } catch (err) {
      reportSupabaseFailure('completeOnboarding', err)
    }
  },

  updateProfileById: async (id, patch) => {
    // Update local mirror first so the UI reflects the change without
    // waiting for the network round-trip. Admin tools update OTHER
    // users' profiles too, in which case AdminDashboard re-fetches its
    // `users` list on success.
    const me = get().profile
    if (me?.id === id) set({ profile: { ...me, ...patch } })
    try {
      const { error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', id)
      if (error) reportSupabaseFailure('updateProfileById', error)
    } catch (err) {
      reportSupabaseFailure('updateProfileById', err)
    }
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

  // ── Edit-mode toggle ─────────────────────────────────────────────
  // Hydrated from localStorage so a tab switch (/home ↔ /tree)
  // doesn't drop the user back to view-only.
  isEditMode:
    typeof window !== 'undefined'
      ? window.localStorage.getItem('ft-edit-mode') === '1'
      : false,
  setEditMode: (isEditMode) => {
    try {
      if (isEditMode) window.localStorage.setItem('ft-edit-mode', '1')
      else window.localStorage.removeItem('ft-edit-mode')
    } catch { /* ignore quota */ }
    set({ isEditMode })
  },
}))

// Debug-only: expose the store on window so devtools can audit state
// when chasing layout bugs (e.g. why spousesOf misses a pair).
if (typeof window !== 'undefined') {
  ;(window as unknown as {
    __ftStore?: {
      get: () => FamilyState
      set: (patch: Partial<FamilyState>) => void
    }
  }).__ftStore = {
    get: () => useFamilyStore.getState(),
    set: (patch) => useFamilyStore.setState(patch),
  }
}
