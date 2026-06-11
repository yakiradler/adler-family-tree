import { describe, it, expect } from 'vitest'
import { resolveRequestTreeId } from '../accessRequests'
import { scopePersonalTrees } from '../treeScope'
import type { FamilyTree, Profile } from '../../types'

const TREES: FamilyTree[] = [
  { id: 't1', name: 'משפחת אדלר', created_by: 'admin1' },
  { id: 't2', name: 'משפחת כרמל', created_by: 'u2' },
]

describe('resolveRequestTreeId', () => {
  it('prefers an explicit target_tree_id (share-code request)', () => {
    expect(resolveRequestTreeId({ answers: { target_tree_id: 't2' } }, TREES)).toBe('t2')
  })

  it('ignores a stale id pointing at a deleted tree', () => {
    expect(resolveRequestTreeId({ answers: { target_tree_id: 'gone' } }, TREES)).toBeNull()
  })

  it('falls back to case/whitespace-insensitive name match (jump-button request)', () => {
    expect(
      resolveRequestTreeId({ answers: { kind: 'tree-access', target_tree_name: '  משפחת אדלר ' } }, TREES),
    ).toBe('t1')
  })

  it('null when nothing resolvable (onboarding code goes through tree_invites instead)', () => {
    expect(resolveRequestTreeId({ answers: {} }, TREES)).toBeNull()
    expect(resolveRequestTreeId({ answers: { target_tree_name: 'לא קיים' } }, TREES)).toBeNull()
  })
})

describe('scopePersonalTrees', () => {
  const admin: Profile = { id: 'admin1', full_name: 'Admin', role: 'admin' }
  const user: Profile = { id: 'u2', full_name: 'User', role: 'user' }

  it('admins see only owned + explicitly shared trees on personal surfaces', () => {
    expect(scopePersonalTrees(TREES, admin, [], false).map((t) => t.id)).toEqual(['t1'])
    expect(scopePersonalTrees(TREES, admin, ['t2'], false).map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('non-admins pass through untouched (server RLS already scoped them)', () => {
    expect(scopePersonalTrees(TREES, user, [], false)).toEqual(TREES)
  })

  it('demo mode passes through', () => {
    expect(scopePersonalTrees(TREES, admin, [], true)).toEqual(TREES)
  })
})
