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
import { useEffect, useMemo, useState } from 'react'
import AdvancedFilter, { DEFAULT_FILTERS, type FilterState } from '../components/views/AdvancedFilter'
import { useBrowserZoom } from '../hooks/useBrowserZoom'
import { useHorizontalSwipe } from '../hooks/useHorizontalSwipe'
import Tooltip from '../components/Tooltip'
import TutorialOverlay, { type TourStep } from '../components/TutorialOverlay'
import { shouldAutoShowTutorial, recordTutorialShown } from '../lib/tutorialState'

interface Props { demoMode: boolean }

export default function TreePage({ demoMode }: Props) {
  const {
    selectedMemberId, setSelectedMemberId, profile,
    members: allMembers, relationships, activeTreeId, viewMode, setViewMode,
    treeControlsExpanded, setTreeControlsExpanded,
    treeFullscreen,
    trees,
    isFocusedMode,
  } = useFamilyStore()
  // Hide top chrome when EITHER fullscreen OR focused mode is on.
  // The focused-mode overlay carries its own header so a second top
  // bar floating above it was confusing the user into clicking the
  // hamburger as the "exit" button.
  const hideChrome = treeFullscreen || isFocusedMode

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

  // Tutorial overlay tailored to the TREE page itself. The user said
  // a guided walkthrough is "even more important" here than on the
  // dashboard because the tree has the most controls.
  //
  // Auto-launches once on the user's first visit to the tree (separate
  // localStorage key from the dashboard tour) and is replayable from
  // the new "?" button next to the search icon.
  const TREE_TUTORIAL_KEY = 'ft-tree-tutorial-seen'
  const [treeTutorialOpen, setTreeTutorialOpen] = useState(false)
  useEffect(() => {
    if (viewMode !== 'tree') return
    if (!shouldAutoShowTutorial(TREE_TUTORIAL_KEY)) return
    const id = window.setTimeout(() => {
      setTreeTutorialOpen(true)
      recordTutorialShown(TREE_TUTORIAL_KEY)
    }, 700)
    return () => window.clearTimeout(id)
  }, [viewMode])
  const closeTreeTutorial = () => setTreeTutorialOpen(false)
  // Tutorial step generator. Some of the new steps require the
  // hamburger to be EXPANDED (so the filter / focus / density chips
  // are visible). We achieve that via the `onEnter` callback which
  // flips `treeControlsExpanded` on the relevant steps. Closing chips
  // again when the user moves past is intentional — keeps the next
  // canvas-level step uncluttered.
  const treeTutorialSteps: TourStep[] = useMemo(() => {
    const openChips = () => setTreeControlsExpanded(true)
    const closeChips = () => setTreeControlsExpanded(false)
    if (lang === 'he') {
      return [
        { selector: 'tree-title', title: '🌳 שם המשפחה', body: 'כאן רואים את שם המשפחה של העץ הפעיל (למשל "משפחת אדלר") ואת מספר החברים בו.', side: 'bottom', onEnter: closeChips },
        { selector: 'tree-add', title: '➕ הוסף חבר משפחה', body: 'לחיצה תפתח טופס מהיר להוספת חבר משפחה חדש לעץ הפעיל.', side: 'bottom', onEnter: closeChips },
        { selector: 'tree-search', title: '🔍 חיפוש בעץ', body: 'מחפש בן או בת משפחה לפי שם בתוך כל העץ — גם אם הם מחוץ למסך כרגע.', side: 'bottom', onEnter: closeChips },
        { selector: 'tree-switcher', title: '🌿 מעבר בין עצים', body: 'אם יש לכם כמה עצי משפחה (אבא, אמא, בני זוג), אפשר לעבור ביניהם מכאן.', side: 'bottom', onEnter: closeChips },
        { selector: 'tree-hamburger', title: '☰ אפשרויות תצוגה', body: 'הכפתור הזה פותח שלושה כלים חזקים: סינון מתקדם, מיקוד דינמי, ותצוגה ממוקדת. נראה אותם עכשיו.', side: 'bottom', onEnter: closeChips },
        // Steps that highlight the chips REQUIRE the hamburger open.
        { selector: 'tree-chip-filter', title: '🔍 סינון מתקדם', body: 'מסנן את העץ לפי שושלת (כהן/לוי), חיפוש שם, מיקוד באדם, הצגת גרושים/נפטרים ועוד. הסינון תקף גם בתרשים ובציר הזמן.', side: 'bottom', onEnter: openChips },
        { selector: 'tree-chip-focus', title: '🎯 מיקוד דינמי', body: 'תצוגה ממוקדת על אדם אחד ומשפחתו הקרובה (הורים, בני זוג, אחים, ילדים) — נהדר להבין דור אחד.', side: 'bottom', onEnter: openChips },
        { selector: 'tree-chip-density', title: '▤ תצוגה ממוקדת/מלאה', body: 'ממוקדת מראה רק 3 דורות (הורים+אגו+ילדים) עם חצים להרחיב למעלה/למטה. מלאה מראה את הכל בבת אחת.', side: 'bottom', onEnter: openChips },
        { selector: 'tree-zoom', title: '🔎 זום + מסך מלא', body: 'הגדלה והקטנה עם הכפתורים — או, חשוב מאוד, עם **שתי אצבעות במגע** (pinch). כפתור הריבועים נכנס למסך מלא.', side: 'left', onEnter: closeChips },
        { selector: 'tree-nav-tab-tree', title: '🌳 תצוגת עץ', body: 'התצוגה הגרפית של עץ המשפחה — מה שאתם רואים כרגע. כאן רוב הפעולות.', side: 'top', onEnter: closeChips },
        { selector: 'tree-nav-tab-schematic', title: '📊 תרשים', body: 'תצוגה סכמטית בלוקים — שימושית להבנת מבנה הענפים והעברה ביניהם.', side: 'top', onEnter: closeChips },
        { selector: 'tree-nav-tab-timeline', title: '⏳ ציר זמן', body: 'אירועי המשפחה (לידות, נישואין, פטירות) על ציר כרונולוגי.', side: 'top', onEnter: closeChips },
        { selector: 'tree-nav-layout', title: '🎨 פריסת העץ', body: 'איך העץ מצויר: קלאסי (אנכי), גריד, קשת, מדורג. כל פריסה מתאימה למצב אחר.', side: 'top', onEnter: closeChips },
      ]
    }
    return [
      { selector: 'tree-title', title: '🌳 Family name', body: 'Shows the active tree\'s family name and member count.', side: 'bottom', onEnter: closeChips },
      { selector: 'tree-add', title: '➕ Add a member', body: 'Opens a quick form to add a new family member.', side: 'bottom', onEnter: closeChips },
      { selector: 'tree-search', title: '🔍 Search', body: 'Find anyone by name — even members off-screen right now.', side: 'bottom', onEnter: closeChips },
      { selector: 'tree-switcher', title: '🌿 Switch trees', body: 'Toggle between linked family trees you belong to.', side: 'bottom', onEnter: closeChips },
      { selector: 'tree-hamburger', title: '☰ View options', body: 'Opens three power tools: advanced filter, focused mode, density. Let\'s look at them.', side: 'bottom', onEnter: closeChips },
      { selector: 'tree-chip-filter', title: '🔍 Advanced filter', body: 'Filter by lineage (Kohen/Levi), name search, focus on a person, hide deceased / former spouses, and more. Applies to schematic + timeline too.', side: 'bottom', onEnter: openChips },
      { selector: 'tree-chip-focus', title: '🎯 Focused mode', body: 'Zooms into one person and their immediate family (parents, spouses, siblings, children).', side: 'bottom', onEnter: openChips },
      { selector: 'tree-chip-density', title: '▤ Compact / full', body: 'Compact shows just 3 generations with ▲/▼ to grow. Full shows everything at once.', side: 'bottom', onEnter: openChips },
      { selector: 'tree-zoom', title: '🔎 Zoom + fullscreen', body: 'Zoom with the buttons — or, importantly, with **two-finger pinch** on touch. The arrows-icon opens fullscreen.', side: 'left', onEnter: closeChips },
      { selector: 'tree-nav-tab-tree', title: '🌳 Tree view', body: 'The visual family tree — what you\'re looking at now. Most actions live here.', side: 'top', onEnter: closeChips },
      { selector: 'tree-nav-tab-schematic', title: '📊 Schematic', body: 'Block-style schematic — great for understanding branch structure.', side: 'top', onEnter: closeChips },
      { selector: 'tree-nav-tab-timeline', title: '⏳ Timeline', body: 'Family events (births, marriages, deaths) on a chronological axis.', side: 'top', onEnter: closeChips },
      { selector: 'tree-nav-layout', title: '🎨 Layout', body: 'Pick how the tree is drawn: classic, grid, arc, or staggered.', side: 'top', onEnter: closeChips },
    ]
  }, [lang, setTreeControlsExpanded])

  // Auto-pick the first available tree when nothing is active. Without
  // this, /tree would show an empty canvas after migration 011 (every
  // member now belongs to SOME tree — none have tree_id IS NULL — so
  // the previous "activeTreeId == null → orphans" branch matches
  // nothing). The first tree wins deterministically; the user can
  // switch via the TreeSwitcher.
  useEffect(() => {
    if (activeTreeId != null) return
    // Prefer any tree the current user already loaded; otherwise
    // derive one from the first member's tree_id so demo mode (which
    // seeds members but not trees) still renders something.
    const treeId =
      useFamilyStore.getState().trees[0]?.id
      ?? allMembers.find((m) => m.tree_id)?.tree_id
      ?? null
    if (treeId) useFamilyStore.getState().setActiveTreeId(treeId)
  }, [activeTreeId, allMembers])

  const members = useMemo(
    () =>
      // Strict per-tree isolation: a member is shown if and only if
      // their tree_id matches the active tree. The legacy "null = main
      // tree" branch is gone — migration 011 made tree_id NOT NULL.
      activeTreeId == null
        ? []
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

      {/* Floating top bar — hidden in fullscreen mode AND while
          the focused-centric overlay is on.
          Switched from `absolute` to `fixed` so the back-arrow stays
          docked at the top of the viewport even when the user pans
          the tree canvas. Added the `safe-top` shim so on mobile
          PWAs the bar doesn't get tucked under the OS status bar —
          a real user reported "I can't see the white top bar with
          the back button" on the standalone-installed app. */}
      {!hideChrome && (
      <div className="fixed top-0 left-0 right-0 z-40 px-3 pt-3 safe-top no-print" style={demoMode ? { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)' } : undefined}>
        <div className="glass-strong rounded-2xl px-3 py-2 flex items-center gap-3 shadow-glass-sm max-w-[600px] mx-auto">
          <Tooltip content={t.tipBackHome} placement="bottom" align="start">
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => navigate('/home')}
              aria-label={t.tipBackHome}
              className="w-8 h-8 rounded-xl bg-white/70 flex items-center justify-center border border-white/60">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d={isRTL(lang) ? 'M5 3l4 4-4 4' : 'M9 3L5 7l4 4'} stroke="#636366" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.button>
          </Tooltip>
          <div className="flex-1 min-w-0" data-tour="tree-title">
            <h1 className="text-sf-headline font-bold text-[#1C1C1E] leading-none flex items-center gap-2">
              <span>🌳</span>
              {/* Family surname takes the prominent slot — used to
                  show only "תצוגת עץ" + the user's name. The user
                  asked for the family name to appear (e.g.
                  "משפחת אדלר") so it reads like a real heading. */}
              {/* Allow the family name to render in full — truncation
                  hurt more than it helped (users saw "משפחת...").
                  break-words lets the heading wrap on truly narrow
                  screens instead of being cut off. */}
              <span className="break-words">{familyDisplayName ?? t.viewTree}</span>
            </h1>
            <p className="text-[11px] text-[#8E8E93] mt-0.5 truncate">
              {members.length} {t.dashMembers}
              {profile?.full_name ? ` · ${profile.full_name}` : ''}
            </p>
          </div>
          {/* Tree switcher visible on every viewport so mobile users can
              navigate between linked family trees too. The compact
              variant collapses well into the top bar. */}
          <div data-tour="tree-switcher">
            <TreeSwitcher />
          </div>
          {/* The "?" tutorial button used to live here but it
              squeezed the family-name into ellipsis on narrow
              phones. Replay is now reachable from the floating
              hamburger panel below (see the "Tutorial" pill). */}
          <Tooltip content={t.tipSearch} placement="bottom">
            <motion.button
              data-tour="tree-search"
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
            <motion.button
              data-tour="tree-add"
              whileTap={{ scale: 0.93 }}
              onClick={() => setAddOpen(true)}
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
            {!hideChrome && (
            <div className={`fixed z-30 no-print ${isRTL(lang) ? 'left-3' : 'right-3'}`} style={{ top: 'calc(env(safe-area-inset-top, 0px) + 88px)' }} data-tour="tree-hamburger">
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
            {treeControlsExpanded && !hideChrome && (
              <AdvancedFilter
                filters={filters}
                onChange={setFilters}
                members={members}
                relationships={relationships}
                matchedCount={matchedCount}
              />
            )}

            {/* Tutorial replay pill — only visible when the hamburger
                is expanded. Previously a "?" pill in the top chrome
                bar, but it was eating the family-name's space. Now
                lives next to the hamburger so the top bar stays
                clean and the user finds it together with the other
                advanced controls. */}
            {treeControlsExpanded && !hideChrome && (
              // Minimal "?" icon — sits below the rest of the hamburger
              // pills so the user finds it last in the vertical stack.
              // top:280 lands AFTER the density chip (which is at 228 +
              // ~52px button height including its outline shadow), with
              // a small gap so the icon doesn't overlap the chip on
              // mobile. The previous offset (232) overlapped by 4px.
              <div className={`fixed z-30 no-print ${isRTL(lang) ? 'left-3' : 'right-3'}`} style={{ top: 'calc(env(safe-area-inset-top, 0px) + 280px)' }}>
                <Tooltip content={t.tipTreeTutorial} placement="bottom" align="end">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    onClick={() => setTreeTutorialOpen(true)}
                    aria-label={t.tipTreeTutorial}
                    className="w-9 h-9 rounded-full bg-white/95 border border-white/70 shadow-glass text-[#007AFF] flex items-center justify-center hover:bg-white transition"
                  >
                    <span className="text-base font-bold" aria-hidden>?</span>
                  </motion.button>
                </Tooltip>
              </div>
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

      {/* Interactive tree-page tutorial. Auto-launches on the user's
          very first visit to the tree (different localStorage key
          from the Dashboard tour so each gets a fresh discovery) and
          can be replayed any time via the "?" button in the top bar. */}
      <TutorialOverlay
        open={treeTutorialOpen}
        steps={treeTutorialSteps}
        onClose={closeTreeTutorial}
      />
    </div>
  )
}
