import { create } from 'zustand'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { canApproveEditRequests, isAdmin } from '../lib/permissions'
import { resolveRequestTreeId } from '../lib/accessRequests'
import { gateAddMember, gateAddTree, SIGNUP_GIFT_LEAVES, TRIAL_DAYS } from '../lib/plans'
import { isShareCodeRequest, mergeNotificationLists } from '../lib/notifications'
import { shareInviteDraft, pickReusableShareInvite, generateCode } from '../lib/invites'
import type {
  Member, Relationship, EditRequest, ViewMode, Profile,
  AccessRequest, UserRole, FamilyTree, MemberNote, FeedbackItem, UserPlan,
  NotificationItem, TreeInvite,
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

// A write the server REJECTED outright (RLS: 0 rows matched). Unlike
// reportSupabaseFailure this is not "saved locally, will sync later" —
// the optimistic state was rolled back, so the toast must say the edit
// was refused, not that it's pending.
function reportSupabaseRejection(op: string) {
  if (typeof window === 'undefined' || !isSupabaseConfigured) return
  console.warn(`[supabase rejected ${op}] 0 rows affected — RLS denied the write`)
  window.dispatchEvent(new CustomEvent('ft-supabase-rejected', { detail: { op } }))
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
  /** Regular-user path: propose a member edit for admin approval. */
  submitEditRequest: (
    targetMemberId: string,
    changeData: Record<string, unknown>,
  ) => Promise<boolean>

  // ── Onboarding + RBAC (Phase C/D) ───────────────────────────────────
  accessRequests: AccessRequest[]
  fetchAccessRequests: () => Promise<void>
  /**
   * Returns true when the request row reached the server (or demo
   * mode, where local-only IS success). False = the admin will never
   * see it — callers must tell the user instead of faking success.
   */
  submitAccessRequest: (
    payload: Pick<AccessRequest, 'requested_role' | 'answers' | 'invite_code'>,
  ) => Promise<boolean>
  /** Tree ids the current user holds a tree_access row for. */
  myTreeAccessIds: string[]
  fetchMyTreeAccess: () => Promise<void>

  // ── Notifications (migration 014) ───────────────────────────────────
  notifications: NotificationItem[]
  /** Last 30 + all unread (cap 200), merged + deduped. */
  fetchNotifications: () => Promise<void>
  markNotificationsRead: (ids: string[]) => Promise<void>
  markAllNotificationsRead: () => Promise<void>

  /**
   * Get a share code for a tree the caller owns (or is admin of):
   * reuses the newest active generic code, else mints a fresh 30-day
   * one. Returns null when the mint is refused (RLS / offline).
   */
  mintShareCode: (treeId: string) => Promise<TreeInvite | null>

  /**
   * Redeem an invite code: validate, burn a use (capped codes), grant
   * tree_access, switch the active tree and refresh data. Shared by
   * JoinTreeModal and the /join deep-link route.
   */
  joinTreeWithCode: (code: string) => Promise<{ ok: true; treeId: string | null } | { ok: false }>
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
  deleteTree: (id: string) => Promise<{ ok: boolean }>
  fetchTrees: () => Promise<void>

  // ── Tree layout mode (lifted from TreeView) ────────────────────────
  // Used to live as local state in TreeView, but the bottom-nav
  // island now exposes a "פריסה" picker that needs to read + write the
  // same value, so it had to come up here. Hydrated from localStorage
  // on first read so a user's preferred layout survives page loads.

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

  // ── Subscription plan + leaves (Phase A — see lib/plans.ts) ────────
  myPlan: UserPlan | null
  fetchMyPlan: () => Promise<void>
  /** Atomic leaf charge; true when it went through. */
  spendLeaves: (cost: number, reason: string) => Promise<boolean>
  startFamilyTrial: () => Promise<boolean>

  // ── Feedback (help "?" → bug report / question to the admin) ───────
  /** Admin-facing list; regular users only ever append via addFeedback. */
  feedback: FeedbackItem[]
  fetchFeedback: () => Promise<void>
  addFeedback: (
    item: Pick<FeedbackItem, 'author_id' | 'author_name' | 'category' | 'body' | 'context'>,
  ) => Promise<FeedbackItem | null>
  updateFeedback: (id: string, patch: Partial<FeedbackItem>) => Promise<void>
  deleteFeedback: (id: string) => Promise<void>
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
    // ── Plan gate (non-admins) ───────────────────────────────────────
    // Free tier: each member beyond the cap costs a leaf; with no
    // leaves left the add is refused and a global upsell toast fires
    // (PlanGateToast listens for ft-plan-gate). Admin accounts are
    // exempt — the owner curates demo/family data without burning
    // tokens.
    if (!isAdmin(get().profile)) {
      const gate = gateAddMember(get().myPlan, get().members.length)
      if (!gate.allowed) {
        window.dispatchEvent(new CustomEvent('ft-plan-gate', { detail: { kind: 'members' } }))
        return null
      }
      if (gate.leafCost > 0) {
        const charged = await get().spendLeaves(gate.leafCost, 'extra-member')
        if (!charged) {
          window.dispatchEvent(new CustomEvent('ft-plan-gate', { detail: { kind: 'members' } }))
          return null
        }
      }
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
    const prev = get().members.find((m) => m.id === id)
    set((s) => ({
      members: s.members.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    }))
    if (!isSupabaseConfigured) return
    // `.select('id')` turns an RLS-swallowed write (error=null, 0 rows)
    // into something detectable. Without it the pilot saw "נשמר" while
    // the server silently kept the old values — and the next fetch
    // wiped the local edit. On a confirmed miss we roll the optimistic
    // state back and surface a rejection toast instead of lying.
    const rollback = () => {
      if (!prev) return
      set((s) => ({ members: s.members.map((m) => (m.id === id ? prev : m)) }))
    }
    try {
      const { data, error } = await supabase
        .from('members').update(updates).eq('id', id).select('id')
      if (error) {
        rollback()
        reportSupabaseFailure('updateMember', error)
      } else if (!data || data.length === 0) {
        rollback()
        reportSupabaseRejection('updateMember')
      }
    } catch (err) {
      rollback()
      reportSupabaseFailure('updateMember', err)
    }
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

  submitEditRequest: async (targetMemberId, changeData) => {
    const me = get().profile
    if (!me) return false
    // Optimistic append so a demo admin (or the requester themselves,
    // pre-refresh) sees the proposal immediately in the requests tab.
    const member = get().members.find((m) => m.id === targetMemberId)
    const localId = `er-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: EditRequest = {
      id: localId,
      requester_id: me.id,
      requester_name: me.full_name,
      target_member_id: targetMemberId,
      target_member_name: member ? `${member.first_name} ${member.last_name}` : undefined,
      change_data: changeData,
      status: 'pending',
      created_at: new Date().toISOString(),
    }
    set((s) => ({ editRequests: [optimistic, ...s.editRequests] }))
    if (!isSupabaseConfigured) return true
    try {
      const { error } = await supabase.from('edit_requests').insert({
        requester_id: me.id,
        target_member_id: targetMemberId,
        change_data: changeData,
        status: 'pending',
      })
      if (error) {
        reportSupabaseFailure('submitEditRequest', error)
        return false
      }
      return true
    } catch (err) {
      reportSupabaseFailure('submitEditRequest', err)
      return false
    }
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
    if (!me) return false
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
    if (!isSupabaseConfigured) return true
    try {
      const { data, error } = await supabase.from('access_requests').insert({
        requester_id: me.id,
        requested_role,
        answers,
        invite_code: invite_code ?? null,
        status: 'pending',
      }).select().single()
      if (error) {
        // Drop the optimistic row — a request the admin can never see
        // must not sit in the requester's UI looking "pending".
        set((s) => ({ accessRequests: s.accessRequests.filter((r) => r.id !== localId) }))
        reportSupabaseFailure('submitAccessRequest', error)
        return false
      }
      if (data) {
        set((s) => ({
          accessRequests: s.accessRequests.map((r) =>
            r.id === localId ? (data as AccessRequest) : r,
          ),
        }))
      }
      return true
    } catch (err) {
      set((s) => ({ accessRequests: s.accessRequests.filter((r) => r.id !== localId) }))
      reportSupabaseFailure('submitAccessRequest', err)
      return false
    }
  },

  // ── Per-user tree access (which trees were shared with ME) ─────────
  // Drives the personal dashboard scoping: owned trees + these. Kept
  // separate from `trees` because for admins the RLS tree list is
  // "everything in the system", which must NOT leak into their
  // personal rail.
  myTreeAccessIds: [],
  fetchMyTreeAccess: async () => {
    if (!isSupabaseConfigured) return
    const me = get().profile
    if (!me) return
    try {
      const { data, error } = await supabase
        .from('tree_access')
        .select('tree_id')
        .eq('user_id', me.id)
      if (error) {
        reportSupabaseFailure('fetchMyTreeAccess', error, 'read')
        return
      }
      set({ myTreeAccessIds: (data ?? []).map((r: { tree_id: string }) => r.tree_id) })
    } catch (err) {
      reportSupabaseFailure('fetchMyTreeAccess', err, 'read')
    }
  },

  // ── Notifications (migration 014) ───────────────────────────────────
  // Two queries keep this scale-safe: the latest page for history plus
  // ALL unread (capped) so the badge never under-counts when more than
  // a page of notifications piled up between visits.
  notifications: [],
  fetchNotifications: async () => {
    if (!isSupabaseConfigured) return
    const me = get().profile
    if (!me) return
    try {
      const [recent, unread] = await Promise.all([
        supabase
          .from('notifications')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('notifications')
          .select('*')
          .is('read_at', null)
          .order('created_at', { ascending: false })
          .limit(200),
      ])
      if (recent.error || unread.error) {
        reportSupabaseFailure('fetchNotifications', recent.error ?? unread.error, 'read')
        return
      }
      set({
        notifications: mergeNotificationLists(
          (recent.data ?? []) as NotificationItem[],
          (unread.data ?? []) as NotificationItem[],
        ),
      })
    } catch (err) {
      reportSupabaseFailure('fetchNotifications', err, 'read')
    }
  },

  markNotificationsRead: async (ids) => {
    if (ids.length === 0) return
    const readAt = new Date().toISOString()
    const idSet = new Set(ids)
    set((s) => ({
      notifications: s.notifications.map((n) =>
        idSet.has(n.id) && n.read_at == null ? { ...n, read_at: readAt } : n,
      ),
    }))
    if (!isSupabaseConfigured) return
    const me = get().profile
    if (!me) return
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: readAt })
        .in('id', ids)
        .eq('user_id', me.id)
        .is('read_at', null)
      if (error) reportSupabaseFailure('markNotificationsRead', error)
    } catch (err) {
      reportSupabaseFailure('markNotificationsRead', err)
    }
  },

  markAllNotificationsRead: async () => {
    const unreadIds = get().notifications.filter((n) => n.read_at == null).map((n) => n.id)
    await get().markNotificationsRead(unreadIds)
  },

  joinTreeWithCode: async (code) => {
    const trimmed = code.trim()
    if (!trimmed || !isSupabaseConfigured) return { ok: false as const }
    try {
      // Redemption runs entirely server-side (migration 015). The
      // redeemer is neither the code's creator nor its target, so they
      // have no SELECT/UPDATE rights on tree_invites — the SECURITY
      // DEFINER redeem_invite() RPC validates the code, burns a use on
      // capped codes, and writes the tree_access grant for us. An empty
      // result set means the code was missing / expired / exhausted.
      const { data, error } = await supabase.rpc('redeem_invite', { p_code: trimmed })
      if (error) {
        reportSupabaseFailure('joinTreeWithCode', error)
        return { ok: false as const }
      }
      const row = Array.isArray(data) ? data[0] : data
      if (!row) return { ok: false as const } // invalid / expired / used up
      const treeId = (row as { redeemed_tree_id: string | null }).redeemed_tree_id ?? null
      if (treeId) get().setActiveTreeId(treeId)
      await Promise.all([
        get().fetchMembers(), get().fetchRelationships(),
        get().fetchTrees(), get().fetchMyTreeAccess(),
      ])
      return { ok: true as const, treeId }
    } catch (err) {
      reportSupabaseFailure('joinTreeWithCode', err)
      return { ok: false as const }
    }
  },

  mintShareCode: async (treeId) => {
    const me = get().profile
    if (!me) return null
    // Demo mode: synthetic local code so the flow is exercisable.
    if (!isSupabaseConfigured) {
      const draft = shareInviteDraft(treeId, me.id)
      return { ...draft, id: `local-${Date.now()}`, created_at: new Date().toISOString() }
    }
    try {
      // Reuse the newest active generic code for this tree — repeated
      // long-presses must not pile up rows.
      const { data: existing } = await supabase
        .from('tree_invites')
        .select('*')
        .eq('tree_id', treeId)
        .is('created_for', null)
        .order('created_at', { ascending: false })
        .limit(10)
      const reusable = pickReusableShareInvite((existing ?? []) as TreeInvite[], treeId)
      if (reusable) return reusable

      const draft = shareInviteDraft(treeId, me.id)
      const first = await supabase.from('tree_invites').insert(draft).select('*').single()
      if (!first.error && first.data) return first.data as TreeInvite
      // Unique collision on `code` — re-roll once.
      const retry = await supabase
        .from('tree_invites')
        .insert({ ...draft, code: generateCode() })
        .select('*')
        .single()
      if (!retry.error && retry.data) return retry.data as TreeInvite
      reportSupabaseFailure('mintShareCode', retry.error ?? first.error)
      return null
    } catch (err) {
      reportSupabaseFailure('mintShareCode', err)
      return null
    }
  },

  decideAccessRequest: async (id, decision, grantedRole) => {
    // App-level admin gate. RLS still authoritative server-side; this
    // mirrors that policy locally so the action is rejected before any
    // optimistic state change in demo mode.
    if (!isAdmin(get().profile)) return
    const req = get().accessRequests.find(r => r.id === id)
    const decidedAt = new Date().toISOString()
    // ── Resolve which tree the requester asked for ──────────────────
    // Approving used to flip the request row + role and stop there: no
    // tree_access row was ever written, so the requester "was approved"
    // into nothing — no tree, no code, no feedback (pilot bug). Resolve
    // the target tree (answers.target_tree_id / target_tree_name, else
    // the invite code via tree_invites) and grant access below.
    let grantTreeId: string | null = null
    if (decision === 'approved' && req) {
      grantTreeId = resolveRequestTreeId(req, get().trees)
      if (!grantTreeId && req.invite_code && isSupabaseConfigured) {
        try {
          const { data: inv } = await supabase
            .from('tree_invites')
            .select('tree_id')
            .eq('code', req.invite_code.trim())
            .maybeSingle()
          grantTreeId = (inv as { tree_id: string | null } | null)?.tree_id ?? null
        } catch { /* unresolvable code — role grant still proceeds */ }
      }
    }
    // ── Share-code requests: mint the code BEFORE flipping status ────
    // The on_access_request_decided trigger (migration 014) embeds the
    // newest active code minted FOR the requester into their approval
    // notification — so the invite row must be committed first. On
    // mint failure we continue: the requester still gets an approval
    // notification, just without a code.
    if (
      decision === 'approved' && req && grantTreeId &&
      isShareCodeRequest(req) && isSupabaseConfigured
    ) {
      const me = get().profile
      const draft = shareInviteDraft(grantTreeId, me?.id ?? '', Date.now(), req.requester_id)
      try {
        const { error: mintErr } = await supabase.from('tree_invites').insert(draft)
        if (mintErr) {
          // Most common cause: unique collision on `code`. Re-roll once.
          const retry = await supabase
            .from('tree_invites')
            .insert({ ...draft, code: generateCode() })
          if (retry.error) reportSupabaseFailure('decideAccessRequest:mint', retry.error)
        }
      } catch (err) {
        reportSupabaseFailure('decideAccessRequest:mint', err)
      }
    }
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
    // ── Grant DB-level tree access ───────────────────────────────────
    // Mirrors what JoinTreeModal does for direct codes: without this
    // row the RLS in migration 008/009 keeps the tree invisible to the
    // requester no matter what their role says.
    if (decision === 'approved' && req && grantTreeId && isSupabaseConfigured) {
      try {
        // ignoreDuplicates (ON CONFLICT DO NOTHING) — tree_access has
        // INSERT policies but no UPDATE policy, so a DO UPDATE upsert
        // would be RLS-rejected when the grant already exists.
        const { error: gErr } = await supabase
          .from('tree_access')
          .upsert(
            { user_id: req.requester_id, tree_id: grantTreeId, role: 'member' },
            { onConflict: 'user_id,tree_id', ignoreDuplicates: true },
          )
        if (gErr) reportSupabaseFailure('decideAccessRequest:grant', gErr)
      } catch (err) {
        reportSupabaseFailure('decideAccessRequest:grant', err)
      }
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
    set((s) => {
      const next = { ...s.treeViewport, ...patch }
      // Refuse non-finite values — a NaN scale used to freeze the tree.
      if (![next.tx, next.ty, next.scale].every(Number.isFinite)) return s
      // Drop epsilon-identical writes so effect→store→effect feedback
      // loops are structurally impossible.
      const cur = s.treeViewport
      if (
        next.initialised === cur.initialised &&
        Math.abs(next.tx - cur.tx) < 0.01 &&
        Math.abs(next.ty - cur.ty) < 0.01 &&
        Math.abs(next.scale - cur.scale) < 0.0001
      ) {
        return s
      }
      return { treeViewport: next }
    }),
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
    // Plan gate: the free tier includes a single tree (admins exempt).
    if (!isAdmin(get().profile) && !gateAddTree(get().myPlan, get().trees.length)) {
      window.dispatchEvent(new CustomEvent('ft-plan-gate', { detail: { kind: 'trees' } }))
      return null
    }
    const localId = `tree-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: FamilyTree = { ...tree, id: localId }
    set((s) => ({ trees: [...s.trees, optimistic] }))
    // Demo mode (no backend): the optimistic row IS the tree.
    if (!isSupabaseConfigured) return optimistic

    const rollback = () => set((s) => ({ trees: s.trees.filter((t) => t.id !== localId) }))
    try {
      const { data, error } = await supabase
        .from('family_trees')
        .insert(tree)
        .select('*')
        .single()
      if (error) {
        // CRITICAL: never keep a server-rejected tree as a local-only
        // "ghost". The old code fell through to `return optimistic`, so
        // a failed insert left a tree with a fake `tree-…` id in the UI —
        // and every member later added to it carried that non-existent
        // tree_id, so its insert failed the FK and surfaced the
        // "saved locally, sync failed" toast on every add. Roll back and
        // report so the user knows the tree wasn't actually created.
        rollback()
        reportSupabaseFailure('addTree', error)
        return null
      }
      set((s) => ({ trees: s.trees.map((t) => (t.id === localId ? (data as FamilyTree) : t)) }))
      return data as FamilyTree
    } catch (err) {
      rollback()
      reportSupabaseFailure('addTree', err)
      return null
    }
  },
  updateTree: async (id, patch) => {
    // Optimistic local update kept even on server failure (a rename
    // shouldn't snap back), but we now surface a sync failure instead of
    // swallowing it silently.
    set((s) => ({ trees: s.trees.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
    if (!isSupabaseConfigured) return
    try {
      const { error } = await supabase.from('family_trees').update(patch).eq('id', id)
      if (error) reportSupabaseFailure('updateTree', error)
    } catch (err) { reportSupabaseFailure('updateTree', err) }
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
    // Snapshot everything we touch so a server rejection can be rolled
    // back cleanly. The old version optimistically removed the tree and
    // then swallowed the Supabase result — when the DELETE was rejected
    // (RLS denied, or the FK conflict below) the tree vanished from the
    // UI and silently reappeared on the next refresh. Now we surface the
    // failure and restore state.
    const prevState = {
      trees: get().trees,
      activeTreeId: get().activeTreeId,
      members: get().members,
      relationships: get().relationships,
    }
    const treeToRemove = prevState.trees.find((t) => t.id === id)
    if (!treeToRemove) return { ok: true } // already gone — nothing to do

    // Members that live in this tree, plus the relationships touching
    // them — removed together so the local tree state stays consistent.
    const treeMemberIds = new Set(
      prevState.members.filter((m) => m.tree_id === id).map((m) => m.id),
    )
    set((s) => ({
      trees: s.trees.filter((t) => t.id !== id),
      activeTreeId: s.activeTreeId === id ? null : s.activeTreeId,
      members: s.members.filter((m) => m.tree_id !== id),
      relationships: s.relationships.filter(
        (r) => !treeMemberIds.has(r.member_a_id) && !treeMemberIds.has(r.member_b_id),
      ),
    }))

    if (!isSupabaseConfigured) return { ok: true } // demo mode — local only

    const rollback = () => set(prevState)
    try {
      // Delete the tree's members FIRST. `members.tree_id` became
      // NOT NULL in migration 011, but the FK is still ON DELETE SET
      // NULL — so deleting a non-empty tree tries to null a NOT-NULL
      // column and the whole DELETE is rejected. Removing the members
      // (their relationships cascade away via the members FK) lets the
      // tree delete cleanly. The UI only exposes tree-deletion to
      // admins, who bypass RLS on both tables.
      if (treeMemberIds.size > 0) {
        const { error: mErr } = await supabase.from('members').delete().eq('tree_id', id)
        if (mErr) {
          rollback()
          console.warn('[deleteTree] member purge failed:', mErr)
          reportSupabaseRejection('deleteTree')
          return { ok: false }
        }
      }
      const { data, error } = await supabase
        .from('family_trees')
        .delete()
        .eq('id', id)
        .select('id')
      if (error) {
        rollback()
        console.warn('[deleteTree] failed:', error)
        reportSupabaseRejection('deleteTree')
        return { ok: false }
      }
      if (!data || data.length === 0) {
        // 0 rows + no error = RLS silently denied the delete (caller is
        // neither owner nor admin). This is the exact case that used to
        // fail invisibly.
        rollback()
        reportSupabaseRejection('deleteTree')
        return { ok: false }
      }
      return { ok: true }
    } catch (err) {
      rollback()
      console.warn('[deleteTree] threw:', err)
      reportSupabaseRejection('deleteTree')
      return { ok: false }
    }
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

  // ── Subscription plan + leaves ──────────────────────────────────────
  // Live: all self-service mutations go through SECURITY DEFINER RPCs
  // (migration 013) so a user can never self-grant a tier or leaves.
  // Demo: a local plan object, persisted by the App.tsx snapshot.
  myPlan: null,
  fetchMyPlan: async () => {
    if (!isSupabaseConfigured) {
      if (!get().myPlan) {
        set({
          myPlan: {
            user_id: get().profile?.id ?? 'demo',
            plan: 'free',
            leaves: SIGNUP_GIFT_LEAVES,
            trial_ends_at: null,
          },
        })
      }
      return
    }
    try {
      const { data, error } = await supabase.rpc('get_my_plan')
      if (error) {
        reportSupabaseFailure('fetchMyPlan', error, 'read')
        return
      }
      if (data) set({ myPlan: data as UserPlan })
    } catch (err) { reportSupabaseFailure('fetchMyPlan', err, 'read') }
  },
  spendLeaves: async (cost, reason) => {
    const cur = get().myPlan
    if (!isSupabaseConfigured) {
      if (!cur || cur.leaves < cost) return false
      set({ myPlan: { ...cur, leaves: cur.leaves - cost } })
      return true
    }
    try {
      const { data, error } = await supabase.rpc('spend_leaves', { cost, why: reason })
      if (error) {
        reportSupabaseFailure('spendLeaves', error)
        return false
      }
      if (typeof data === 'number' && data >= 0) {
        if (cur) set({ myPlan: { ...cur, leaves: data } })
        return true
      }
      return false // -1 = insufficient balance
    } catch (err) {
      reportSupabaseFailure('spendLeaves', err)
      return false
    }
  },
  startFamilyTrial: async () => {
    const cur = get().myPlan
    if (!isSupabaseConfigured) {
      // Demo: one trial ever — a non-null trial_ends_at means it was used.
      if (!cur || cur.plan !== 'free' || cur.trial_ends_at) return false
      set({
        myPlan: {
          ...cur,
          plan: 'family',
          trial_ends_at: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
        },
      })
      return true
    }
    try {
      const { data, error } = await supabase.rpc('start_family_trial')
      if (error) {
        reportSupabaseFailure('startFamilyTrial', error)
        return false
      }
      if (data) {
        set({ myPlan: data as UserPlan })
        return true
      }
      return false
    } catch (err) {
      reportSupabaseFailure('startFamilyTrial', err)
      return false
    }
  },

  // ── Feedback ───────────────────────────────────────────────────────
  // Same optimistic pattern as notes. In demo mode the optimistic row
  // is the source of truth and the App.tsx localStorage subscriber
  // persists it, so the demo admin sees their own test reports too.
  feedback: [],
  fetchFeedback: async () => {
    if (!isSupabaseConfigured) return
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      reportSupabaseFailure('fetchFeedback', error, 'read')
      return
    }
    if (!Array.isArray(data)) return
    const serverRows = data as FeedbackItem[]
    const serverIds = new Set(serverRows.map((f) => f.id))
    // Preserve mid-flight optimistic rows (synthetic `fb-` ids).
    const localOptimistic = get().feedback.filter(
      (f) => f.id.startsWith('fb-') && !serverIds.has(f.id),
    )
    set({ feedback: [...serverRows, ...localOptimistic] })
  },
  addFeedback: async (item) => {
    const localId = `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: FeedbackItem = {
      ...item,
      id: localId,
      status: 'open',
      created_at: new Date().toISOString(),
    }
    set((s) => ({ feedback: [optimistic, ...s.feedback] }))
    if (!isSupabaseConfigured) return optimistic
    try {
      const { data, error } = await supabase
        .from('feedback')
        .insert({
          author_id: item.author_id,
          author_name: item.author_name,
          category: item.category,
          body: item.body,
          context: item.context ?? null,
        })
        .select()
        .single()
      if (error) reportSupabaseFailure('addFeedback', error)
      if (data) {
        set((s) => ({
          feedback: s.feedback.map((f) => (f.id === localId ? (data as FeedbackItem) : f)),
        }))
        return data as FeedbackItem
      }
    } catch (err) { reportSupabaseFailure('addFeedback', err) }
    return optimistic
  },
  updateFeedback: async (id, patch) => {
    set((s) => ({
      feedback: s.feedback.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }))
    if (!isSupabaseConfigured) return
    try {
      const { error } = await supabase.from('feedback').update(patch).eq('id', id)
      if (error) reportSupabaseFailure('updateFeedback', error)
    } catch (err) { reportSupabaseFailure('updateFeedback', err) }
  },
  deleteFeedback: async (id) => {
    set((s) => ({ feedback: s.feedback.filter((f) => f.id !== id) }))
    if (!isSupabaseConfigured) return
    try {
      const { error } = await supabase.from('feedback').delete().eq('id', id)
      if (error) reportSupabaseFailure('deleteFeedback', error)
    } catch (err) { reportSupabaseFailure('deleteFeedback', err) }
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
