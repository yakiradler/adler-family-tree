import { useEffect, useMemo } from 'react'
import type { Member, Relationship } from '../../../types'
import { computeLayout, validateLayout, type LayoutResult } from '../../../layout'
import { getParentMap, resolveLineage } from '../../../lib/lineage'
import type { FilterState } from '../AdvancedFilter'
import { applyTreeFilters } from '../applyTreeFilters'

export interface TreeLayoutPipeline {
  result: LayoutResult
  /** Lineage resolved on the FULL tree population (not the filtered
   *  subset) — a hidden Kohen father must still confer status. */
  lineageById: Map<string, ReturnType<typeof resolveLineage>>
  filteredCount: number
}

/**
 * The single data pipeline of the tree view:
 *   tree-scoped members → lineage map → filters → computeLayout.
 * Pure memo chain — no store writes, no side effects (the dev-only
 * invariant check logs but never mutates).
 */
export function useTreeLayout(
  members: Member[],
  relationships: Relationship[],
  filters: FilterState,
): TreeLayoutPipeline {
  const lineageById = useMemo(() => {
    const parentMap = getParentMap(members, relationships)
    const map = new Map<string, ReturnType<typeof resolveLineage>>()
    for (const m of members) map.set(m.id, resolveLineage(m, parentMap))
    return map
  }, [members, relationships])

  const filtered = useMemo(
    () => applyTreeFilters(members, relationships, filters, lineageById),
    [members, relationships, filters, lineageById],
  )

  const result = useMemo(
    () =>
      computeLayout(
        { members: filtered.members, relationships: filtered.relationships },
        { showFormerSpouses: filters.showFormerSpouses },
      ),
    [filtered, filters.showFormerSpouses],
  )

  // Dev-only: every layout the user ever sees has been invariant-checked.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const violations = validateLayout(result)
    for (const v of violations) {
      console.error(`[layout invariant ${v.rule}] ${v.message}`)
    }
  }, [result])

  return { result, lineageById, filteredCount: filtered.members.length }
}
