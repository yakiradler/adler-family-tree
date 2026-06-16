export type ViewMode = 'tree' | 'schematic' | 'timeline'
export type RelationshipType = 'parent-child' | 'spouse' | 'sibling'
export type EditRequestStatus = 'pending' | 'approved' | 'rejected'
/**
 * 4-tier RBAC.
 *  - guest:  read-only; needs admin approval to do anything else.
 *  - user:   the standard authenticated member; can edit their own
 *            profile + their nuclear family (spouse, children).
 *  - master: family power-user; granular per-feature toggles live in
 *            profiles.master_permissions, controlled by an admin.
 *  - admin:  full access (root) on the entire system.
 */
export type UserRole = 'guest' | 'user' | 'master' | 'admin'
/**
 * Per-tree role (the real authorization axis, stored in tree_access.role).
 *  - owner:   manages the tree — members, roles, invites, requests, delete.
 *  - editor:  can add/edit members + relationships (the old 'member').
 *  - viewer:  read-only on tree structure; may still engage socially
 *             (comments, reactions, photos-in-comments) + suggest edits.
 */
export type TreeRole = 'owner' | 'editor' | 'viewer'
export type AccessRequestStatus = 'pending' | 'approved' | 'rejected'
export type Gender = 'male' | 'female'
export type Lineage = 'kohen' | 'levi' | 'israel'
/**
 * Relationship status — only meaningful for `type='spouse'`. A current
 * spouse is co-placed adjacent to the member in the tree; ex / deceased
 * partners render as a smaller circle BELOW the member without reserving
 * horizontal slot width (so divorces don't widen subtrees).
 */
export type SpouseStatus = 'current' | 'ex' | 'deceased'
/**
 * Biological / step / adoptive distinction for parent-child relationships.
 * Defaults to 'bio' when absent. Used to label step-parents and adoptive
 * parents in the profile panel and relationship manager — the tree layout
 * treats all three the same (step-parents render as parents).
 */
export type ParentType = 'bio' | 'step' | 'adoptive'

export interface Profile {
  id: string
  full_name: string
  avatar_url?: string
  role: UserRole
  bio?: string
  /** ISO timestamp; absent ⇒ user has not completed onboarding. */
  onboarded_at?: string | null
  /** First-login gate (migration 028): when terms were accepted. */
  terms_accepted_at?: string | null
  /** Opted in to email marketing (email only — never SMS). */
  marketing_consent?: boolean
  /** When the user passed the plans/pricing gate on first login. */
  plan_acked_at?: string | null
  /** Tier the user requested during onboarding (admin grants the actual role). */
  requested_role?: UserRole | null
  /** Granular per-feature flags managed by admin for `master` users. */
  master_permissions?: MasterPermissions
  /** Account is active by default. Admin can flip this to revoke read access. */
  active?: boolean
  /** ISO timestamp of soft-deletion (admin "remove user"). When set
   *  and within the past 30 days, App.tsx refuses to load the
   *  session and signs the user out with a "suspended" notice. */
  deleted_at?: string | null
  /** The `members.id` row that represents this user on the family
   *  tree (their "own card"). Populated during onboarding when the
   *  wizard seeds the "me" node, or manually by an admin from the
   *  user-management dashboard. Null for accounts onboarded before
   *  migration 010 — in that case nuclear-family checks still
   *  apply via `nuclearFamilyIds`, the user just can't self-edit
   *  until they're linked. */
  linked_member_id?: string | null
  /** Parent-managed flag: a minor's social content is held for approval
   *  before it becomes public (migration 023). */
  is_minor?: boolean
  /** The guardian (parent) account responsible for approving this minor. */
  guardian_id?: string | null
}

/**
 * Per-feature toggles for `master` users. Admin flips these from the
 * dashboard. New keys can be added without a migration — the column is
 * jsonb. Defaults to "all-off"; helpers in src/lib/permissions.ts apply
 * sensible fallbacks per role.
 */
export interface MasterPermissions {
  canEditAnyMember?: boolean
  canDeleteMembers?: boolean
  canManageRelationships?: boolean
  canApproveEditRequests?: boolean
  canManageInvites?: boolean
}

export interface AccessRequest {
  id: string
  requester_id: string
  requester_name?: string
  requested_role: UserRole
  answers: Record<string, unknown>
  invite_code?: string | null
  status: AccessRequestStatus
  decided_by?: string | null
  decided_at?: string | null
  created_at: string
}

/**
 * Contact + social links shown under the profile's "Contact" section.
 * Stored as a single jsonb column so new networks (TikTok, X, LinkedIn…)
 * can be added later without another migration. All fields optional;
 * handles or full URLs are both accepted (normalized in lib/contactLinks).
 */
export interface MemberContact {
  phone?: string
  email?: string
  facebook?: string
  instagram?: string
}

export interface Member {
  id: string
  /** Primary (Hebrew) name. */
  first_name: string
  last_name: string
  /** Optional English name (for relatives abroad). The UI shows the name
   * matching the active language, falling back to the Hebrew one. */
  first_name_en?: string
  last_name_en?: string
  /** Previous family name (e.g. maiden name). Surfaces only inside the
   * profile panel; never on the tree, so the tree stays compact. */
  maiden_name?: string
  nickname?: string
  birth_date?: string
  death_date?: string
  hebrew_birth_date?: string
  hebrew_death_date?: string
  bio?: string
  photo_url?: string
  photos?: string[]
  /** Contact + social links (phone/email/facebook/instagram). null clears. */
  contact?: MemberContact | null
  gender?: Gender
  /** Sibling order; `null` clears it explicitly (DB column is nullable). */
  birth_order?: number | null
  /**
   * Priestly lineage (שושלת). When unset, an automatic rule still applies
   * for Adler descendants (see lineage.ts → `resolveLineage`).
   */
  lineage?: Lineage | null
  /**
   * Manual privacy switch — when true the member is excluded from the
   * tree layout regardless of any active filter. Useful for cases the
   * family wants to keep on record but not surface on the public tree
   * (e.g. a discreet first ex-spouse). Members linked through a hidden
   * person via parent-child still get connected through their other
   * (visible) parent; the hidden node simply doesn't render.
   */
  hidden?: boolean
  /**
   * Connector preference: which parent the child's tree-line should
   * descend from when both parents are present. Set per-member from
   * the edit dialog. When unset the renderer defaults to the MOTHER
   * (female parent), falling back to the first available parent.
   */
  connector_parent_id?: string | null
  /**
   * Optional grouping for multi-tree households. Members without a
   * tree_id belong to the default ("main") tree. The shell exposes a
   * switcher so the user can navigate between trees they have access
   * to without losing the unified database.
   */
  tree_id?: string | null
  created_by: string
  /** Row creation timestamp (DB default now()). Used by the family feed
   *  to surface recently-added relatives. */
  created_at?: string
}

/**
 * A named family tree — used to group members for households that
 * track several lineages side by side (e.g. paternal + maternal +
 * spouse's family). Members carry a `tree_id`; the active tree
 * filters the rendered population.
 */
export interface FamilyTree {
  id: string
  name: string
  /** Tagline rendered next to the name in the switcher. */
  description?: string
  /** Hex accent — colors the tree connectors and the active dot in the switcher. */
  color?: string
  /** Custom icon image (tree-icons storage bucket); falls back to the SVG silhouette. */
  icon_url?: string | null
  created_by: string
  created_at?: string
}

/** Row in `tree_invites` — a join code for a tree. */
export interface TreeInvite {
  id: string
  code: string
  tree_id: string | null
  created_by?: string | null
  /** Minted FOR this user (share-code approval). UI pointer only — codes stay bearer tokens. */
  created_for?: string | null
  expires_at: string | null
  uses_left: number | null
  note?: string | null
  created_at?: string
}

/**
 * Persistent per-user notification (migration 014). Display text is
 * rendered client-side from `type` + `data` so it follows the UI
 * language; the row stores no strings.
 */
export type NotificationType =
  | 'access_request'      // someone asked to join / get tree access (→ admins)
  | 'share_code_request'  // someone asked for a share code (→ admins)
  | 'edit_request'        // someone proposed a member edit (→ admins)
  | 'feedback'            // someone filed a bug/question report (→ admins)
  | 'request_approved'    // your access request was approved (→ requester)
  | 'request_rejected'    // your access request was declined (→ requester)

export interface NotificationItem {
  id: string
  user_id: string
  type: NotificationType
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export interface Relationship {
  id: string
  member_a_id: string
  member_b_id: string
  type: RelationshipType
  /** Spouse-only. Defaults to 'current' if null/undefined. */
  status?: SpouseStatus | null
  /** Parent-child only. Defaults to 'bio' when absent. */
  parent_type?: ParentType | null
}

export interface EditRequest {
  id: string
  requester_id: string
  requester_name?: string
  target_member_id: string
  target_member_name?: string
  change_data: Record<string, unknown>
  status: EditRequestStatus
  created_at: string
}

/**
 * Subscription + token bank (Phase A — no billing; see lib/plans.ts).
 * One row per auth user in `user_plans`. "Leaves" (עלים) are the
 * action tokens; every grant/spend is mirrored into leaf_transactions
 * for auditing.
 */
export type PlanId = 'free' | 'family' | 'premium'

export interface UserPlan {
  user_id: string
  plan: PlanId
  /** Set while a self-service family trial is running; expired ⇒ behaves as free. */
  trial_ends_at?: string | null
  leaves: number
  leaves_renewed_at?: string | null
  updated_at?: string
}

/**
 * Feedback sent from the help ("?") menu — a bug report or a question
 * addressed to the system admin. Surfaces in the admin dashboard under
 * the "reports" tab; regular users only ever write these, never read
 * others'. `author_name` is denormalised like MemberNote's so the row
 * stays meaningful even if the profile is renamed or deleted.
 */
export type FeedbackCategory = 'bug' | 'question'
export type FeedbackStatus = 'open' | 'resolved'

export interface FeedbackItem {
  id: string
  /** Profiles row of the reporter; null if unresolved (FK is ON DELETE SET NULL). */
  author_id: string | null
  author_name: string
  category: FeedbackCategory
  body: string
  /** Where the report was sent from (route hash) — helps reproduce. */
  context?: string | null
  status: FeedbackStatus
  created_at: string
}

/**
 * A short status / update a member posts to their family tree — the
 * content of the "family network" feed (migration 029). Tree-scoped:
 * everyone with access to the tree sees it.
 */
export interface FamilyStatus {
  id: string
  tree_id: string
  author_id: string | null
  author_name: string
  body: string
  /** Attached photos / videos (migration 030). */
  media?: { url: string; type: 'image' | 'video' }[]
  created_at: string
}

/**
 * A flat comment on a family-feed status (migration 031). Scoped to the
 * status's tree; author_name is denormalised so the thread survives a
 * rename, same as FamilyStatus / MemberNote.
 */
export interface FamilyStatusComment {
  id: string
  status_id: string
  author_id: string | null
  author_name: string
  body: string
  created_at: string
}

/**
 * Note left on a member's profile by a family-tree user — short
 * `comment` (a few sentences) or longer `memory` (anecdote / story).
 * Both render in the same Notes tab; `kind` only changes the visual
 * tag and the default placeholder text in the composer.
 *
 * `author_name` is denormalised at write time so an old note still
 * surfaces its author even after the author's profile.full_name was
 * renamed (or, in demo mode, after a different demo user replaced
 * the profile). Falls back to "אנונימי" if missing.
 */
export type MemberNoteKind = 'comment' | 'memory'

/** A like / emoji reaction by a user on a member (migration 023). */
export interface MemberReaction {
  id: string
  member_id: string
  user_id: string
  emoji: string
  created_at: string
}

export interface MemberNote {
  id: string
  member_id: string
  /** Profile id of whoever wrote the note. */
  author_id: string
  /** Snapshot of the author's name when the note was posted. */
  author_name: string
  /** Plain-text body — no HTML. Newlines are preserved. */
  body: string
  kind: MemberNoteKind
  /** Moderation state (migration 023). Minor-authored notes are 'pending'
   *  (visible only to the author) until a parent/owner approves them. */
  status?: 'public' | 'pending'
  /** Owner/parent who approved a pending note. */
  approved_by?: string | null
  /** ISO timestamp. Used both for sorting and the displayed date. */
  created_at: string
  /**
   * Optional inline image — stored as a data URL in demo mode (so it
   * round-trips through localStorage along with the rest of the note)
   * or as a Supabase Storage public URL once that's wired up. The
   * MemberNotesTab composer caps uploads at ~1 MB and downscales to
   * a sensible max dimension before encoding, to keep the
   * ft-state-v3 payload under the localStorage quota.
   */
  image_url?: string | null
}
