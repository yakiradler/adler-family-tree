// Filter model for the tree view — extracted from AdvancedFilter.tsx so
// the component file only exports components (react-refresh requirement
// for Vite fast refresh). Behaviour is pinned by the golden tests in
// __tests__/applyTreeFilters.test.ts.

/**
 * Advanced filter state for the tree view. Filters apply BEFORE the
 * layout engine — filtered-out members + their dangling relationships are
 * stripped, so the resulting tree only contains matches. This keeps the
 * tree compact when zooming in on a sub-population.
 */
export interface FilterState {
  lineage: 'all' | 'kohen' | 'levi'
  showFormerSpouses: boolean
  hideDeceased: boolean
  /** Surface members manually flagged `hidden` so the user can review
   *  and restore them — Instagram blocked-list pattern. Off by default. */
  showHidden: boolean
  search: string
  /** When set, only this member's blood line (ancestors + descendants) renders. */
  focusMemberId: string | null
  /** "Family path" mode — when both ids are set, the tree narrows to
   *  the shortest chain of relations that connects them, so the user
   *  can see at a glance how two people in the family are related. */
  pathFromId: string | null
  pathToId: string | null
}

export const DEFAULT_FILTERS: FilterState = {
  lineage: 'all',
  showFormerSpouses: false,
  hideDeceased: false,
  showHidden: false,
  search: '',
  focusMemberId: null,
  pathFromId: null,
  pathToId: null,
}

export function isDefaultFilter(f: FilterState): boolean {
  return (
    f.lineage === 'all' &&
    !f.showFormerSpouses &&
    !f.hideDeceased &&
    !f.showHidden &&
    f.search.trim() === '' &&
    f.focusMemberId === null &&
    f.pathFromId === null &&
    f.pathToId === null
  )
}
