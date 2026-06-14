import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang, isRTL, type Translations } from '../../i18n/useT'
import MemberNode from '../MemberNode'
import QuickAddRelativeModal, { type RelativeDirection } from '../QuickAddRelativeModal'
import type { Member } from '../../types'
import { CARD } from '../../layout'
import type { FilterState } from './AdvancedFilter'
import FocusedCentricView from './FocusedCentricView'
import TreeMiniMap from './TreeMiniMap'
import Tooltip from '../Tooltip'
import { useTreeLayout } from './tree/useTreeLayout'
import { useCloseOnBack } from '../../hooks/useCloseOnBack'
import { useViewport } from './tree/useViewport'
import ConnectorsLayer from './tree/ConnectorsLayer'
import IssuesBanner from './tree/IssuesBanner'
import QuickAddButtons from './tree/QuickAddButtons'
import ExportMenu from './tree/ExportMenu'

/**
 * Main tree canvas — a thin orchestrator over the layout engine.
 *
 * All geometry (positions, connectors, generation rows) comes from
 * src/layout/computeLayout; this component only renders the result and
 * wires pan/zoom, selection, edit-mode quick-add and the chrome.
 * The cards and the SVG share ONE coordinate space (engine output is
 * origin-normalized) — there is no offsetX compensation anywhere.
 */
export default function TreeView({
  filters,
  onMatchedCount,
  onAddFirst,
}: {
  filters: FilterState
  onMatchedCount?: (n: number) => void
  /** Opens the add-member flow from the empty-state CTA. */
  onAddFirst?: () => void
}) {
  const {
    members: allMembers, relationships,
    selectedMemberId, setSelectedMemberId,
    activeTreeId, trees,
    treeControlsExpanded,
    treeFullscreen, setTreeFullscreen,
    openTreePopover, setOpenTreePopover,
    isFocusedMode, setIsFocusedMode,
    isEditMode,
  } = useFamilyStore()

  const [quickAdd, setQuickAdd] = useState<{
    anchor: Member
    direction: RelativeDirection
  } | null>(null)
  const activeTree = activeTreeId == null ? null : trees.find((tr) => tr.id === activeTreeId) ?? null

  // Per-tree isolation: the engine only ever sees the active tree.
  const members = useMemo(
    () =>
      activeTreeId == null
        ? allMembers.filter((m) => !m.tree_id)
        : allMembers.filter((m) => m.tree_id === activeTreeId),
    [allMembers, activeTreeId],
  )
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  // ── Layout pipeline: filters → engine (validated in dev) ──────────
  const { result, lineageById, filteredCount } = useTreeLayout(members, relationships, filters)
  useEffect(() => { onMatchedCount?.(filteredCount) }, [filteredCount, onMatchedCount])

  // ── Focused-Centric mode ───────────────────────────────────────────
  const [activeFocusId, setActiveFocusId] = useState<string | null>(null)
  const showFocusPicker = openTreePopover === 'focusPicker'
  const setShowFocusPicker = (next: boolean | ((v: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(showFocusPicker) : next
    setOpenTreePopover(value ? 'focusPicker' : null)
  }
  const [pickerQuery, setPickerQuery] = useState('')
  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    const pool = q
      ? members.filter(m => `${m.first_name} ${m.last_name}`.toLowerCase().includes(q))
      : members
    return pool.slice(0, 10)
  }, [members, pickerQuery])
  // Phone back button: close the focus picker, or exit focused mode,
  // instead of navigating off the tree.
  useCloseOnBack(showFocusPicker, () => setOpenTreePopover(null))
  useCloseOnBack(isFocusedMode, () => setIsFocusedMode(false))

  const enterFocusMode = (id: string) => {
    setActiveFocusId(id)
    setIsFocusedMode(true)
    setShowFocusPicker(false)
    setPickerQuery('')
  }

  // ── Viewport (pan/zoom/fit) — gesture moves never re-render React ──
  const viewport = useViewport({
    wrapRef,
    canvasRef,
    bounds: result.bounds,
    nodeCount: result.nodes.length,
    activeTreeId,
  })

  // When the selection lands on a member that's off-screen (search,
  // quick-add of a new relative), glide the camera to them instead of
  // ever re-fitting the whole tree under the user's feet.
  useEffect(() => {
    if (!selectedMemberId) return
    const node = result.nodes.find((n) => n.member.id === selectedMemberId)
    if (!node) return
    const cx = node.x + CARD.W / 2
    const cy = node.y + CARD.H / 2
    if (!viewport.isPointVisible(cx, cy)) viewport.panToPoint(cx, cy)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMemberId, result])

  // Wrapper pixel size for the minimap viewport rectangle.
  const [viewportSize, setViewportSize] = useState({ w: 1024, h: 720 })
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setViewportSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (members.length === 0) return <EmptyState t={t} treeName={activeTree?.name ?? null} onAdd={onAddFirst} />

  return (
    <div
      ref={wrapRef}
      {...viewport.handlers}
      onMouseLeave={viewport.handlers.onMouseUp}
      onTouchCancel={viewport.handlers.onTouchEnd}
      className="w-full relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
      style={{
        // `dvh` (dynamic viewport height) tracks the visible area as the
        // mobile browser's address bar shows/hides and respects the
        // notch — `vh` froze at the largest size and squeezed the canvas
        // under the OS bars on phones.
        height: 'calc(100dvh - 80px)',
        touchAction: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        background:
          'radial-gradient(at 12% 8%, rgba(120,170,255,0.35) 0px, transparent 50%),' +
          'radial-gradient(at 92% 12%, rgba(255,140,200,0.28) 0px, transparent 55%),' +
          'radial-gradient(at 78% 92%, rgba(120,255,220,0.25) 0px, transparent 55%),' +
          'radial-gradient(at 8% 96%, rgba(180,130,255,0.30) 0px, transparent 55%),' +
          'linear-gradient(135deg, #F4F7FF 0%, #FBF7FF 55%, #FFF5FA 100%)',
      }}
    >
      <div
        className="absolute inset-0 opacity-35 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(100,120,150,0.55) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      <div
        ref={canvasRef}
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: result.bounds.width,
          height: result.bounds.height,
          transform: `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`,
          transformOrigin: '0 0',
        }}
      >
        <ConnectorsLayer
          edges={result.edges}
          width={result.bounds.width}
          height={result.bounds.height}
        />

        {result.nodes.map(({ member, x, y, secondaryPartners }) => (
          <motion.div
            key={member.id}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1, left: x, top: y }}
            transition={{
              opacity: { duration: 0.25, delay: Math.min(0.3, y / 2000) },
              scale:   { duration: 0.25, delay: Math.min(0.3, y / 2000) },
              left: { type: 'spring', stiffness: 180, damping: 26 },
              top:  { type: 'spring', stiffness: 180, damping: 26 },
            }}
            className="absolute"
            style={{ width: CARD.W, height: CARD.H }}
          >
            <MemberNode
              member={member}
              size={CARD.AVATAR}
              highlighted={selectedMemberId === member.id}
              onClick={() => setSelectedMemberId(member.id)}
              lineage={lineageById.get(member.id)}
              secondaryPartners={secondaryPartners}
              onSecondarySelect={(id) => setSelectedMemberId(id)}
              dataMemberId={member.id}
            />
            {isEditMode && (
              <QuickAddButtons
                onAdd={(direction) => setQuickAdd({ anchor: member, direction })}
              />
            )}
          </motion.div>
        ))}
      </div>

      <QuickAddRelativeModal
        open={quickAdd !== null}
        onClose={() => setQuickAdd(null)}
        anchor={quickAdd?.anchor ?? null}
        direction={quickAdd?.direction ?? 'parent'}
      />

      {/* Data-problem banner — the engine reports instead of crashing. */}
      <IssuesBanner issues={result.issues} />

      {!treeFullscreen && (
        <ExportMenu t={t} result={result} title={activeTree?.name ?? 'InfiniTree'} />
      )}

      {/* Zoom / fit / fullscreen stack — bottom-right. The fit button is
          back: it is now a one-shot pure computation with NaN guards, so
          hammering it is safe by construction. */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 z-30 no-print" data-tour="tree-zoom">
        {!treeFullscreen && (
          <>
            <Tooltip content={t.tipZoomIn} placement="left">
              <button
                onClick={() => viewport.zoomBy(1.2)}
                className="w-10 h-10 rounded-full glass-strong shadow-glass flex items-center justify-center text-[#007AFF] font-bold text-lg active:scale-95 transition"
                aria-label={t.tipZoomIn}
              >+</button>
            </Tooltip>
            <Tooltip content={t.tipZoomOut} placement="left">
              <button
                onClick={() => viewport.zoomBy(1 / 1.2)}
                className="w-10 h-10 rounded-full glass-strong shadow-glass flex items-center justify-center text-[#007AFF] font-bold text-lg active:scale-95 transition"
                aria-label={t.tipZoomOut}
              >−</button>
            </Tooltip>
            <Tooltip content={t.tipFitToView} placement="left">
              <button
                onClick={viewport.fit}
                className="w-10 h-10 rounded-full glass-strong shadow-glass flex items-center justify-center text-[#007AFF] active:scale-95 transition"
                aria-label={t.tipFitToView}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </Tooltip>
          </>
        )}
        <Tooltip content={treeFullscreen ? t.tipFullscreenExit : t.tipFullscreenEnter} placement="left">
          <motion.button
            type="button"
            onClick={() => setTreeFullscreen(!treeFullscreen)}
            whileTap={{ scale: 0.93 }}
            aria-label={treeFullscreen ? t.tipFullscreenExit : t.tipFullscreenEnter}
            className={`w-10 h-10 rounded-full shadow-glass flex items-center justify-center transition ${
              treeFullscreen
                ? 'bg-[#1C1C1E] text-white'
                : 'glass-strong text-[#007AFF]'
            }`}
          >
            {treeFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 2v3H3M10 2v3h3M6 14v-3H3M10 14v-3h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </motion.button>
        </Tooltip>
      </div>

      {/* Bird's-eye minimap — bottom-left. Desktop/tablet only: on a phone
          the 88px map showed a handful of 2px dots (no navigation value)
          while competing with the OS back-swipe edge — pinch-to-zoom-out is
          the natural overview gesture there. */}
      {result.nodes.length >= 4 && !treeFullscreen && (
        <div className="no-print hidden sm:block">
          <TreeMiniMap
            nodes={result.nodes}
            canvasW={result.bounds.width}
            canvasH={result.bounds.height}
            tx={viewport.tx}
            ty={viewport.ty}
            scale={viewport.scale}
            viewportW={viewportSize.w}
            viewportH={viewportSize.h}
            scalePercent={viewport.scale * 100}
            onNavigate={(newTx, newTy) => viewport.panTo(newTx, newTy)}
          />
        </div>
      )}

      {/* Focused-Centric mode button — second slot beneath the filter
          chip (144 + ~40px chip + gap). */}
      {members.length > 0 && treeControlsExpanded && (
        <div
          // Same open-state z bump as the filter chip: the person picker
          // must paint above the "?" help chip below it.
          className={`absolute no-print ${showFocusPicker ? 'z-[60]' : 'z-20'}`}
          style={{ top: 196, [rtl ? 'left' : 'right']: 12 } as React.CSSProperties}
          data-tour="tree-chip-focus"
        >
          <Tooltip content={t.tipFocusedCentric} placement="bottom">
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                if (isFocusedMode) {
                  setIsFocusedMode(false)
                } else if (selectedMemberId) {
                  enterFocusMode(selectedMemberId)
                } else {
                  setShowFocusPicker(s => !s)
                }
              }}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 shadow-glass font-semibold text-[12.5px] border transition ${
                isFocusedMode
                  ? 'bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white border-transparent'
                  : 'bg-white/95 text-[#1C1C1E] border-white/70 hover:bg-white'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="2.8" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 2" />
              </svg>
              <span>{t.focusedEnterBtn}</span>
            </motion.button>
          </Tooltip>

          {/* Person picker — appears when no member is selected */}
          <AnimatePresence>
            {showFocusPicker && !isFocusedMode && (
              <motion.div
                key="focus-picker"
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.14 }}
                className="absolute mt-2 w-64 bg-white rounded-2xl shadow-lg border border-black/8 overflow-hidden"
                style={{ [rtl ? 'left' : 'right']: 0 } as React.CSSProperties}
              >
                <div className="px-3 pt-3 pb-2">
                  <input
                    autoFocus
                    type="text"
                    value={pickerQuery}
                    onChange={e => setPickerQuery(e.target.value)}
                    placeholder={lang === 'he' ? 'חפש בן/בת משפחה…' : 'Search member…'}
                    className="w-full text-[13px] px-3 py-2 bg-[#F2F2F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                    dir="auto"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-[#F2F2F7]">
                  {pickerResults.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => enterFocusMode(m.id)}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-[#F2F2F7] transition text-right"
                    >
                      <div
                        className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold"
                        style={{ background: m.gender === 'female' ? 'linear-gradient(135deg,#FF5EAE,#B46BFF)' : 'linear-gradient(135deg,#2B6BFF,#19C6FF)' }}
                      >
                        {m.first_name.charAt(0)}
                      </div>
                      <span className="font-semibold text-[13px] text-[#1C1C1E] truncate">
                        {m.first_name} {m.last_name}
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Focused-Centric overlay */}
      {isFocusedMode && activeFocusId && (
        <div className="absolute inset-0" style={{ zIndex: 25 }}>
          <FocusedCentricView
            allMembers={members}
            allRelationships={relationships}
            initialFocusId={activeFocusId}
            lineageById={lineageById}
            onSelectMember={(id) => setSelectedMemberId(id)}
            onExit={() => setIsFocusedMode(false)}
          />
        </div>
      )}
    </div>
  )
}

function EmptyState({ t, treeName, onAdd }: {
  t: Translations
  treeName: string | null
  onAdd?: () => void
}) {
  const title = treeName
    ? t.treeEmptyTitleWithName.replace('{name}', treeName)
    : t.treeEmptyTitle
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center gap-4 text-center px-8 pt-20">
      <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-3xl flex items-center justify-center">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="10" r="5" fill="#007AFF" opacity="0.6" />
          <circle cx="10" cy="28" r="4" fill="#5856D6" opacity="0.5" />
          <circle cx="30" cy="28" r="4" fill="#5856D6" opacity="0.5" />
          <path d="M20 15v8M20 23L10 25M20 23L30 25" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div>
        <h3 className="text-sf-title3 text-[#1C1C1E] mb-1">{title}</h3>
        <p className="text-sf-subhead text-[#8E8E93]">{t.treeEmptyDesc}</p>
      </div>
      {/* Big central "+" — the empty tree used to offer no obvious way
          to start; the only entry point was the small + in the top bar,
          which first-time users missed (owner request: "make starting a
          new tree easy"). */}
      {onAdd && (
        <motion.button
          type="button"
          onClick={onAdd}
          whileTap={{ scale: 0.93 }}
          aria-label={t.treeEmptyAddFirst}
          className="mt-2 flex flex-col items-center gap-2 group"
        >
          <span className="w-16 h-16 rounded-full bg-gradient-to-br from-[#007AFF] to-[#32ADE6] shadow-lg flex items-center justify-center group-hover:scale-105 transition">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <path d="M13 4v18M4 13h18" stroke="white" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-sf-subhead font-semibold text-[#007AFF]">{t.treeEmptyAddFirst}</span>
        </motion.button>
      )}
    </motion.div>
  )
}
