import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang, type Translations } from '../../i18n/useT'
import { Avatar } from '../MemberCard'
import type { Member } from '../../types'
import { buildFamilyGraph, solveGenerations } from '../../layout'
import { getParentMap, resolveLineage } from '../../lib/lineage'
import { applyTreeFilters } from './applyTreeFilters'
import type { FilterState } from './AdvancedFilter'

interface GenGroup {
  generation: number
  label: string
  members: Member[]
}

export default function SchematicView({ filters }: { filters?: FilterState }) {
  const { members: allMembers, relationships, selectedMemberId, setSelectedMemberId, activeTreeId } =
    useFamilyStore()
  const { t } = useLang()

  // Per-tree isolation — the schematic used to show ALL trees mixed.
  const members = useMemo(
    () =>
      activeTreeId == null
        ? allMembers.filter((m) => !m.tree_id)
        : allMembers.filter((m) => m.tree_id === activeTreeId),
    [allMembers, activeTreeId],
  )

  // Same filter pipeline as the tree view (lineage, search, hidden…).
  const visible = useMemo(() => {
    if (!filters) return { members, relationships }
    const parentMap = getParentMap(members, relationships)
    const lineageById = new Map<string, ReturnType<typeof resolveLineage>>()
    for (const m of members) lineageById.set(m.id, resolveLineage(m, parentMap))
    return applyTreeFilters(members, relationships, filters, lineageById)
  }, [members, relationships, filters])

  const genLabels = [t.genGreatGrandparents, t.genGrandparents, t.genParents, t.genMine, t.genChildren, t.genGrandchildren]

  const groups = useMemo<GenGroup[]>(() => {
    if (visible.members.length === 0) return []
    // ONE source of truth for "which generation am I": the layout
    // engine's unit-based solver. A married-in spouse with no recorded
    // parents lands on their partner's row (couples are one unit) —
    // the old local BFS used to put them in generation 0.
    const graph = buildFamilyGraph({ members: visible.members, relationships: visible.relationships })
    const { genOfUnit } = solveGenerations(graph)
    const byGen = new Map<number, Member[]>()
    for (const m of visible.members) {
      const unitId = graph.unitOfMember.get(m.id)
      const g = unitId != null ? genOfUnit.get(unitId) ?? 0 : 0
      if (!byGen.has(g)) byGen.set(g, [])
      byGen.get(g)!.push(m)
    }
    return Array.from(byGen.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([gen, mems]) => ({
        generation: gen,
        label: genLabels[gen] ?? `${t.genLabel} ${gen + 1}`,
        members: mems,
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, t])

  if (members.length === 0) {
    return <div className="flex items-center justify-center h-full pt-20 text-[#8E8E93] text-sf-subhead">{t.noMembers}</div>
  }

  return (
    <div className="px-5 pt-6 pb-4 space-y-6">
      {groups.map((group, gi) => (
        <motion.div key={group.generation} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: gi * 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-black/10 to-transparent" />
            <span className="text-sf-caption font-semibold text-[#8E8E93] uppercase tracking-wider px-2">{group.label}</span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-black/10 to-transparent" />
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {group.members.map((member, mi) => {
              const isSelected = selectedMemberId === member.id
              const isDeceased = !!member.death_date
              return (
                <motion.button key={member.id} onClick={() => setSelectedMemberId(isSelected ? null : member.id)}
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: gi * 0.05 + mi * 0.03, duration: 0.3 }}
                  whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
                  className={`flex items-center gap-3 p-3 rounded-2xl border text-left transition-all duration-200 ${
                    isSelected ? 'bg-[#007AFF]/10 border-[#007AFF]/40 shadow-sm' : 'bg-white/60 border-black/5 hover:bg-white/90 hover:shadow-sm'
                  } ${isDeceased ? 'opacity-70' : ''}`}>
                  <div className="relative">
                    <Avatar member={member} size="md" />
                    {isDeceased && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-[#8E8E93]/20 rounded-full flex items-center justify-center">
                        <span className="text-[8px] text-[#8E8E93]">†</span>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-sf-subhead font-semibold truncate ${isSelected ? 'text-[#007AFF]' : 'text-[#1C1C1E]'}`}>
                      {member.first_name} {member.last_name}
                    </p>
                    {member.birth_date && (
                      <p className="text-sf-caption text-[#8E8E93] truncate">
                        {new Date(member.birth_date).getFullYear()}
                        {member.death_date ? ` – ${new Date(member.death_date).getFullYear()}` : ''}
                      </p>
                    )}
                    <RelationshipBadge memberId={member.id} t={t} />
                  </div>
                </motion.button>
              )
            })}
          </div>
        </motion.div>
      ))}

      {/* Legend */}
      <div className="flex items-center gap-4 pt-2 flex-wrap">
        {[
          { color: '#007AFF', dash: false, label: t.legendParentChild },
          { color: '#5AC8FA', dash: true, label: t.legendSpouse },
          { color: '#34C759', dash: false, label: t.legendSibling },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <svg width="20" height="8">
              <line x1="0" y1="4" x2="20" y2="4" stroke={l.color} strokeWidth="1.5" strokeDasharray={l.dash ? '4,2' : undefined} />
            </svg>
            <span className="text-sf-caption2 text-[#8E8E93]">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RelationshipBadge({ memberId, t }: { memberId: string; t: Translations }) {
  const relationships = useFamilyStore((s) => s.relationships)
  const count = relationships.filter((r) => r.member_a_id === memberId || r.member_b_id === memberId).length
  if (count === 0) return null
  return (
    <p className="text-[10px] text-[#8E8E93] mt-0.5">
      {count} {count !== 1 ? t.connections : t.connection}
    </p>
  )
}
