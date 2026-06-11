import type { FamilyTree, Profile } from '../types'

/**
 * Trees that belong on someone's PERSONAL surfaces (dashboard rail,
 * tree switcher): trees they created plus trees explicitly shared with
 * them via tree_access.
 *
 * For non-admins the server already enforces exactly this (RLS,
 * migration 009), so the list passes through untouched — important
 * because `myTreeAccessIds` loads async and must not transiently hide
 * a joined tree. Admins are the exception: their RLS bypass returns
 * EVERY tree in the system (needed for the admin panel), which used to
 * leak random users' trees into the admin's own dashboard. Here we
 * narrow admins to the same owned+shared rule as everyone else; the
 * admin panel keeps querying the full list itself.
 */
export function scopePersonalTrees(
  trees: FamilyTree[],
  profile: Profile | null | undefined,
  myTreeAccessIds: string[],
  demoMode: boolean,
): FamilyTree[] {
  if (demoMode || !profile || profile.role !== 'admin') return trees
  const shared = new Set(myTreeAccessIds)
  return trees.filter((t) => t.created_by === profile.id || shared.has(t.id))
}
