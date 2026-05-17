import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import TreeView from '../components/views/TreeView'
import SchematicView from '../components/views/SchematicView'
import TimelineView from '../components/views/TimelineView'
import MemberPanel from '../components/MemberPanel'
import Navigation from '../components/Navigation'
import AddMemberModal from '../components/AddMemberModal'
import TreeSearchModal from '../components/TreeSearchModal'
import TreeSwitcher from '../components/TreeSwitcher'
import { useMemo, useState } from 'react'
import AdvancedFilter, { DEFAULT_FILTERS, type FilterState } from '../components/views/AdvancedFilter'
import { useBrowserZoom } from '../hooks/useBrowserZoom'
import { useHorizontalSwipe } from '../hooks/useHorizontalSwipe'
import Tooltip from '../components/Tooltip'

interface Props { demoMode: boolean }

export default function TreePage({ demoMode }: Props) {
  const {
    selectedMemberId, setSelectedMemberId, profile,
    members: allMembers, relationships, activeTreeId, viewMode, setViewMode,
    treeControlsExpanded, setTreeControlsExpanded,
    treeFullscreen,
    trees,
  } = useFamilyStore()

  // Horizontal-swipe toggle between schematic and timeline. The tree
  // view is intentionally OFF the swipe map — it carries its own
  // pan/zoom gestures and we don't want a stray flick to yank the
  // user out of a tree they're navigating.
  const swipeBetweenSchematicAndTimeline = useHorizontalSwipe(
    () => {
      setViewMode(viewMode === 'schematic' ? 'timeline' : 'schematic')
    },
    { enabled: viewMode === 'schematic' || viewMode === 'timeline' },
  )
  const { t, lang } = useLang()
  const dir = isRTL(lang) ? 'rtl' : 'ltr'
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [matchedCount, setMatchedCount] = useState(0)
  // Browser-zoom counter-scale. At 200% page zoom the fixed-positioned
  // MemberPanel would otherwise inflate to 720+ physical pixels and
  // dominate the viewport. We apply an inverse transform so the panel
  // stays at a roughly constant physical size regardless of zoom.
  const browserZoom = useBrowserZoom()

  const members = useMemo(
    () =>
      activeTreeId == null
        ? allMembers.filter((m) => !m.tree_id)
        : allMembers.filter((m) => m.tree_id === activeTreeId),
    [allMembers, activeTreeId],
  )

  // Family display name for the top bar. Named trees use their own
  // `name`; the implicit main tree resolves to "משפחת {surname}"
  // computed from the most common last name in the pool (mirrors the
  // same logic used on the Dashboard's tree cards).
  const familyDisplayName = useMemo(() => {
    if (activeTreeId != null) {
      const named = trees.find((tr) => tr.id === activeTreeId)
      return named?.name ?? null
    }
    const counts = new Map<string, number>()
    for (const m of members) {
      const ln = (m.last_name ?? '').trim()
      if (!ln) continue
      counts.set(ln, (counts.get(ln) ?? 0) + 1)
    }
    let best: { name: string; n: number } | null = null
    for (const [name, n] of counts) {
      if (!best || n > best.n) best = { name, n }
    }
    if (!best) return null
    return lang === 'he' ? `משפחת ${best.name}` : `${best.name} Family`
  }, [activeTreeId, trees, members, lang])

  return (
    <div dir={dir} className="min-h-screen bg-[#F2F2F7]">
      {/* Demo banner hidden for clean UX */}

      {/* Floating top bar — hidden in fullscreen mode. */}
      {!treeFullscreen && (
      <div className="absolute top-0 left-0 right-0 z-30 px-3 pt-3 no-print" style={{ top: demoMode ? 20 : 0 }}>
        <div className="glass rounded-2xl px-3 py-2 flex items-center gap-3 shadow-glass-sm max-w-[600px] mx-auto">
          <Tooltip content={t.tipBackHome} placement="bottom" align="start">
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => navigate('/home')}
              aria-label={t.tipBackHome}
              className="w-8 h-8 rounded-xl bg-white/70 flex items-center justify-center border border-white/60">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d={isRTL(lang) ? 'M5 3l4 4-4 4' : 'M9 3L5 7l4 4'} stroke="#636366" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.button>
          </Tooltip>
          <div className="flex-1 min-w-0">
            <h1 className="text-sf-headline font-bold text-[#1C1C1E] leading-none flex items-center gap-2">
              <span>🌳</span>
              {/* Family surname takes the prominent slot — used to
                  show only "תצוגת עץ" + the user's name. The user
                  asked for the family name to appear (e.g.
                  "משפחת אדלר") so it reads like a real heading. */}
              <span className="truncate">{familyDisplayName ?? t.viewTree}</span>
            </h1>
            <p className="text-[11px] text-[#8E8E93] mt-0.5 truncate">
              {members.length} {t.dashMembers}
              {profile?.full_name ? ` · ${profile.full_name}` : ''}
            </p>
          </div>
          {/* Tree switcher visible on every viewport so mobile users can
              navigate between linked family trees too. The compact
              variant collapses well into the top bar. */}
          <TreeSwitcher />
          <Tooltip content={t.tipSearch} placement="bottom">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setSearchOpen(true)}
              aria-label={t.tipSearch}
              className="w-8 h-8 rounded-xl bg-white/70 flex items-center justify-center border border-white/60 hover:bg-white/90 transition"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="6" cy="6" r="4.2" stroke="#636366" strokeWidth="1.6" />
                <path d="M9.2 9.2l2.6 2.6" stroke="#636366" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </motion.button>
          </Tooltip>
          <Tooltip content={t.tipAddMember} placement="bottom" align="end">
            <motion.button whileTap={{ scale: 0.93 }} onClick={() => setAddOpen(true)}
              aria-label={t.tipAddMember}
              className="w-8 h-8 bg-gradient-to-br from-[#007AFF] to-[#32ADE6] rounded-xl flex items-center justify-center shadow-md">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="white" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </motion.button>
          </Tooltip>
        </div>
      </div>
      )}

      {/* Tree canvas + side panel */}
      <div className="relative">
        {viewMode === 'tree' && (
          <>
            <TreeView filters={filters} onMatchedCount={setMatchedCount} />

            {/* Floating-controls hamburger.
                The three tree-page chips (Focused-Centric, Filters,
                Density) used to sit at the top of the canvas as
                separate pills — a mess on mobile. They're all hidden
                by default now and this single button reveals them.
                The button itself moves with the visibility state so
                its label is unambiguous. */}
            {!treeFullscreen && (
            <div className={`absolute z-30 no-print top-[72px] ${isRTL(lang) ? 'left-3' : 'right-3'}`}>
            <Tooltip content={t.tipTreeControlsToggle} placement="bottom" align="end">
            <motion.button
              type="button"
              onClick={() => setTreeControlsExpanded(!treeControlsExpanded)}
              data-tree-hamburger
              whileTap={{ scale: 0.94 }}
              aria-label={treeControlsExpanded ? t.treeControlsClose : t.treeControlsOpen}
              className={`w-10 h-10 rounded-full shadow-glass flex items-center justify-center transition ${
                treeControlsExpanded
                  ? 'bg-[#1C1C1E] text-white'
                  : 'bg-white/95 text-[#1C1C1E] border border-white/70 hover:bg-white'
              }`}
            >
              <motion.svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                animate={{ rotate: treeControlsExpanded ? 90 : 0 }}
                transition={{ duration: 0.18 }}
              >
                {treeControlsExpanded ? (
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                ) : (
                  <>
                    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </>
                )}
              </motion.svg>
            </motion.button>
            </Tooltip>
            </div>
            )}

            {/* AdvancedFilter — hidden by default; revealed via the
                same hamburger as the other tree-page chips. */}
            {treeControlsExpanded && !treeFullscreen && (
              <AdvancedFilter
                filters={filters}
                onChange={setFilters}
                members={members}
                relationships={relationships}
                matchedCount={matchedCount}
              />
            )}
          </>
        )}
        {/* Filter pill also lives over the schematic + timeline
            views per the user's request — sometimes the easiest way
            to drill into a sub-set ("kohanim only", "born before
            1970", …) is to apply the filter regardless of which
            visualization you're looking at. The chip is hidden by
            default and surfaced when the floating-controls
            hamburger is expanded, matching the tree view. */}
        {(viewMode === 'schematic' || viewMode === 'timeline')
          && treeControlsExpanded
          && !treeFullscreen && (
          <AdvancedFilter
            filters={filters}
            onChange={setFilters}
            members={members}
            relationships={relationships}
            matchedCount={matchedCount}
          />
        )}
        {/* Hamburger button on the schematic / timeline views too,
            so the user can summon the filter chip the same way as on
            the tree. */}
        {(viewMode === 'schematic' || viewMode === 'timeline') && !treeFullscreen && (
          <div className={`absolute z-30 no-print top-[72px] ${isRTL(lang) ? 'left-3' : 'right-3'}`}>
            <Tooltip content={t.tipTreeControlsToggle} placement="bottom" align="end">
              <motion.button
                type="button"
                onClick={() => setTreeControlsExpanded(!treeControlsExpanded)}
                whileTap={{ scale: 0.94 }}
                aria-label={treeControlsExpanded ? t.treeControlsClose : t.treeControlsOpen}
                className={`w-10 h-10 rounded-full shadow-glass flex items-center justify-center transition ${
                  treeControlsExpanded
                    ? 'bg-[#1C1C1E] text-white'
                    : 'bg-white/95 text-[#1C1C1E] border border-white/70 hover:bg-white'
                }`}
              >
                <motion.svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  animate={{ rotate: treeControlsExpanded ? 90 : 0 }}
                  transition={{ duration: 0.18 }}
                >
                  {treeControlsExpanded ? (
                    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  ) : (
                    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  )}
                </motion.svg>
              </motion.button>
            </Tooltip>
          </div>
        )}
        {/* Schematic + Timeline share a swipe-to-toggle gesture (see
            useHorizontalSwipe). Each view animates in with a slide
            so the gesture has a satisfying visual payoff; the
            AnimatePresence key matches viewMode so React swaps
            cleanly rather than dual-mounting. */}
        <AnimatePresence mode="wait" initial={false}>
          {viewMode === 'schematic' && (
            <motion.div
              key="schematic"
              {...swipeBetweenSchematicAndTimeline}
              initial={{ opacity: 0, x: isRTL(lang) ? -40 : 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isRTL(lang) ? 40 : -40 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-y-auto"
              style={{ paddingTop: 72, paddingBottom: 120, minHeight: '100vh', touchAction: 'pan-y' }}
            >
              <SchematicView />
            </motion.div>
          )}
          {viewMode === 'timeline' && (
            <motion.div
              key="timeline"
              {...swipeBetweenSchematicAndTimeline}
              initial={{ opacity: 0, x: isRTL(lang) ? 40 : -40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isRTL(lang) ? -40 : 40 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-y-auto"
              style={{ paddingTop: 72, paddingBottom: 120, minHeight: '100vh', touchAction: 'pan-y' }}
            >
              <TimelineView />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {selectedMemberId && !treeFullscreen && (
            <motion.div
              key="panel-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedMemberId(null)}
              className="fixed inset-0 bg-black/15 backdrop-blur-[2px] z-40 md:bg-transparent md:backdrop-blur-0 no-print"
            />
          )}
          {selectedMemberId && !treeFullscreen && (
            <motion.div
              key="panel"
              initial={{ opacity: 0, x: isRTL(lang) ? -40 : 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isRTL(lang) ? -40 : 40 }}
              transition={{ type: 'spring', stiffness: 350, damping: 32 }}
              // Mobile: full-width sheet anchored above the nav island
              // so the LAST action button is always reachable (the
              // previous bottom-4 + 560 px tall stack hid behind the
              // navigation, making the delete row unreachable on a
              // 700 px phone).
              //
              // Desktop: same width as mobile (≈ 380 px) and pinned
              // to the side. The user explicitly asked for the
              // desktop panel to match mobile dimensions so the tree
              // alongside it remains legible.
              //
              // `transform: scale(1/zoom)` still counters browser
              // zoom so a Ctrl++ user doesn't get a panel that eats
              // the viewport.
              className={`fixed z-50 w-[calc(100vw-24px)] max-w-[380px] bottom-[128px] md:bottom-auto md:top-20 no-print ${
                isRTL(lang) ? 'left-3 md:left-4' : 'right-3 md:right-4'
              }`}
              style={{
                // Explicit `height` (not just max-height) so the inner
                // panel has a defined box to size against. Without it
                // the inner `flex-1 overflow-y-auto` body never had a
                // concrete height and a tall profile got stuck with no
                // scrolling. min() with the viewport keeps it from
                // ever spilling off the screen on a small phone.
                height: 'min(640px, calc(100vh - 220px))',
                maxHeight: 'min(640px, calc(100vh - 220px))',
                transform: browserZoom > 1 ? `scale(${1 / browserZoom})` : undefined,
                transformOrigin: isRTL(lang) ? 'top left' : 'top right',
              }}
            >
              <MemberPanel onClose={() => setSelectedMemberId(null)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AddMemberModal open={addOpen} onClose={() => setAddOpen(false)} />
      <TreeSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      {!treeFullscreen && (
        <div className="no-print">
          <Navigation />
        </div>
      )}
    </div>
  )
}
