import { describe, it, expect } from 'vitest'
import { applyTreeFilters } from '../applyTreeFilters'
import type { FilterState } from '../AdvancedFilter'
import type { Member, Relationship } from '../../../types'
import type { LineageInfo } from '../../../lib/lineage'

// Golden tests pinning the filter pipeline's behaviour. These rules
// are user-facing contracts (what is VISIBLE on the tree) — any change
// to applyTreeFilters must consciously update these expectations.

function m(id: string, props: Partial<Member> = {}): Member {
  return { id, first_name: id, last_name: 'T', gender: 'male', created_by: 't', ...props }
}
function pc(id: string, parent: string, child: string): Relationship {
  return { id, member_a_id: parent, member_b_id: child, type: 'parent-child' }
}
function sp(id: string, a: string, b: string, status: Relationship['status'] = 'current'): Relationship {
  return { id, member_a_id: a, member_b_id: b, type: 'spouse', status }
}

const DEFAULTS: FilterState = {
  lineage: 'all',
  search: '',
  hideDeceased: false,
  showFormerSpouses: false,
  showHidden: false,
  focusMemberId: null,
  pathFromId: null,
  pathToId: null,
}

function lineageMap(
  members: Member[],
  overrides: Record<string, Partial<LineageInfo>> = {},
): Map<string, LineageInfo> {
  const map = new Map<string, LineageInfo>()
  for (const mem of members) {
    map.set(mem.id, {
      lineage: null,
      byAdlerRule: false,
      showBadge: false,
      daughterOf: null,
      ...overrides[mem.id],
    })
  }
  return map
}

function run(
  members: Member[],
  relationships: Relationship[],
  filters: Partial<FilterState> = {},
  lineage?: Map<string, LineageInfo>,
) {
  return applyTreeFilters(
    members,
    relationships,
    { ...DEFAULTS, ...filters },
    lineage ?? lineageMap(members),
  )
}

describe('applyTreeFilters — visibility contracts', () => {
  it('no filters → everyone stays (standalone founders included)', () => {
    const members = [m('a'), m('b'), m('loner')]
    const rels = [sp('r1', 'a', 'b')]
    const out = run(members, rels)
    expect(out.members.map((x) => x.id).sort()).toEqual(['a', 'b', 'loner'])
  })

  it('hidden members disappear unless showHidden', () => {
    const members = [m('dad'), m('mom', { gender: 'female' }), m('kid'), m('ghost', { hidden: true })]
    const rels = [sp('r1', 'dad', 'mom'), pc('r2', 'dad', 'kid'), pc('r3', 'mom', 'kid')]
    expect(run(members, rels).members.map((x) => x.id)).not.toContain('ghost')
    expect(run(members, rels, { showHidden: true }).members.map((x) => x.id)).toContain('ghost')
  })

  it('children of a hidden ancestor still render (strong preservation)', () => {
    // grandpa hidden; father+kid must survive the cascade.
    const members = [m('grandpa', { hidden: true }), m('father'), m('kid')]
    const rels = [pc('r1', 'grandpa', 'father'), pc('r2', 'father', 'kid')]
    const ids = run(members, rels).members.map((x) => x.id)
    expect(ids).toContain('father')
    expect(ids).toContain('kid')
    expect(ids).not.toContain('grandpa')
  })

  it('lineage filter is male-line only (showBadge gate)', () => {
    const members = [m('kohen'), m('daughter', { gender: 'female' })]
    const lin = lineageMap(members, {
      kohen: { lineage: 'kohen', showBadge: true },
      daughter: { lineage: 'kohen', showBadge: false, daughterOf: 'kohen' },
    })
    const ids = run(members, [], { lineage: 'kohen' }, lin).members.map((x) => x.id)
    expect(ids).toContain('kohen')
    expect(ids).not.toContain('daughter')
  })

  it('search matches first/last/nickname, case-insensitive', () => {
    const members = [m('a', { first_name: 'יקיר' }), m('b', { first_name: 'דנה', nickname: 'דני' })]
    expect(run(members, [], { search: 'יקיר' }).members.map((x) => x.id)).toEqual(['a'])
    expect(run(members, [], { search: 'דני' }).members.map((x) => x.id)).toEqual(['b'])
  })

  it('hideDeceased removes the dead but keeps living descendants', () => {
    const members = [m('dead', { death_date: '2000-01-01' }), m('alive')]
    const rels = [pc('r1', 'dead', 'alive')]
    const ids = run(members, rels, { hideDeceased: true }).members.map((x) => x.id)
    expect(ids).toEqual(['alive'])
  })

  it('an ex with VISIBLE children is never pruned (strong preservation)', () => {
    const members = [
      m('mom', { gender: 'female' }),
      m('momHusband'),
      m('ex'),
      m('kid'),
    ]
    const rels = [
      sp('r1', 'mom', 'momHusband'),
      sp('r2', 'mom', 'ex', 'ex'),
      pc('r3', 'mom', 'kid'),
      pc('r4', 'ex', 'kid'),
    ]
    expect(run(members, rels).members.map((x) => x.id)).toContain('ex')
    expect(run(members, rels, { showFormerSpouses: true }).members.map((x) => x.id)).toContain('ex')
  })

  it('a married-in ex whose ties are all dead is pruned', () => {
    // ex has a (hidden) parent in the DB, the marriage is over and
    // childless — without pruning they'd float as a free root subtree.
    const members = [m('me'), m('ex'), m('exDad', { hidden: true })]
    const rels = [
      sp('r1', 'me', 'ex', 'ex'),
      pc('r2', 'exDad', 'ex'),
    ]
    const out = run(members, rels)
    expect(out.members.map((x) => x.id)).toContain('me')
    expect(out.members.map((x) => x.id)).not.toContain('ex')
  })

  it('focus mode keeps ancestors, descendants and in-scope spouses', () => {
    const members = [
      m('grandpa'), m('dad'), m('me'), m('wife', { gender: 'female' }),
      m('kid'), m('unrelated'),
    ]
    const rels = [
      pc('r1', 'grandpa', 'dad'),
      pc('r2', 'dad', 'me'),
      sp('r3', 'me', 'wife'),
      pc('r4', 'me', 'kid'),
    ]
    const ids = run(members, rels, { focusMemberId: 'me' }).members.map((x) => x.id).sort()
    expect(ids).toEqual(['dad', 'grandpa', 'kid', 'me', 'wife'])
  })

  it('path mode shows exactly the connecting chain', () => {
    const members = [m('a'), m('b'), m('c'), m('d')]
    const rels = [pc('r1', 'a', 'b'), pc('r2', 'b', 'c'), pc('r3', 'a', 'd')]
    const ids = run(members, rels, { pathFromId: 'c', pathToId: 'd' }).members.map((x) => x.id).sort()
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })
})
