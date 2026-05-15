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
  /** Tier the user requested during onboarding (admin grants the actual role). */
  requested_role?: UserRole | null
  /** Granular per-feature flags managed by admin for `master` users. */
  master_permissions?: MasterPermissions
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

export interface Member {
  id: string
  first_name: string
  last_name: string
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
  gender?: Gender
  birth_order?: number
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
  created_by: string
  created_at?: string
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
