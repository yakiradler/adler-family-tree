import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import { supabase } from '../lib/supabase'
import { isAdmin, isOnboarded } from '../lib/permissions'
import { scopePersonalTrees } from '../lib/treeScope'
import { countUnreadAdminInbox, hasUnseenShareCode } from '../lib/notifications'
import AccessRequestStatusToast from '../components/AccessRequestStatusToast'
import NotificationBell from '../components/notifications/NotificationBell'
import { PersonAvatarIcon } from '../components/MemberNode'
import { getRingGradient, getFallbackGradient } from '../components/memberVisuals'
import AIScanModal from '../components/ai/AIScanModal'
import BuildFromTextModal from '../components/BuildFromTextModal'
import BrandMark from '../components/BrandMark'
import TutorialOverlay, { type TourStep } from '../components/TutorialOverlay'
import JoinTreeModal from '../components/JoinTreeModal'
import SecuritySettingsModal from '../components/security/SecuritySettingsModal'
import PlanCard from '../components/plan/PlanCard'
import { LEAF_COSTS } from '../lib/plans'
import TreeCardActionMenu from '../components/TreeCardActionMenu'
import type { Member, Relationship } from '../types'

interface Props { demoMode: boolean }

// ─── Helpers ────────────────────────────────────────────────────────────────

function getUpcomingBirthdays(members: Member[], days = 60) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return members
    .filter(m => m.birth_date && !m.death_date)
    .map(m => {
      const bd = new Date(m.birth_date!)
      const next = new Date(today.getFullYear(), bd.getMonth(), bd.getDate())
      if (next < today) next.setFullYear(today.getFullYear() + 1)
      const diff = Math.round((next.getTime() - today.getTime()) / 86400000)
      return { member: m, daysUntil: diff, nextDate: next }
    })
    .filter(x => x.daysUntil <= days)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 5)
}

/** Max generation depth in the DAG. Handles married-in roots correctly. */
function computeGenerations(members: Member[], relationships: Relationship[]): number {
  const parentsOf = new Map<string, string[]>()
  for (const r of relationships) {
    if (r.type !== 'parent-child') continue
    if (!parentsOf.has(r.member_b_id)) parentsOf.set(r.member_b_id, [])
    parentsOf.get(r.member_b_id)!.push(r.member_a_id)
  }
  const gen = new Map<string, number>()
  members.forEach(m => gen.set(m.id, 0))
  let changed = true
  while (changed) {
    changed = false
    for (const m of members) {
      const parents = parentsOf.get(m.id) ?? []
      if (parents.length === 0) continue
      const newGen = Math.max(...parents.map(p => gen.get(p) ?? 0)) + 1
      if (newGen > (gen.get(m.id) ?? 0)) { gen.set(m.id, newGen); changed = true }
    }
  }
  const max = Math.max(0, ...gen.values())
  return max + 1
}

/** Find the branch founders: children of the single ancestor couple with
 * the largest descendant tree (ignores married-in ancestors with no siblings). */
function computeBranchFounders(members: Member[], relationships: Relationship[]): Member[] {
  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  for (const r of relationships) {
    if (r.type !== 'parent-child') continue
    if (!parentsOf.has(r.member_b_id)) parentsOf.set(r.member_b_id, [])
    parentsOf.get(r.member_b_id)!.push(r.member_a_id)
    if (!childrenOf.has(r.member_a_id)) childrenOf.set(r.member_a_id, [])
    childrenOf.get(r.member_a_id)!.push(r.member_b_id)
  }

  // Count descendants reachable from each root
  const rootIds = members.filter(m => !parentsOf.has(m.id)).map(m => m.id)
  const descCount = (startId: string): number => {
    const seen = new Set<string>([startId])
    const q = [startId]
    while (q.length > 0) {
      const x = q.shift()!
      for (const c of childrenOf.get(x) ?? []) {
        if (!seen.has(c)) { seen.add(c); q.push(c) }
      }
    }
    return seen.size - 1
  }

  // Pick the root with most descendants as the patriarch
  const patriarch = rootIds
    .map(id => ({ id, count: descCount(id) }))
    .sort((a, b) => b.count - a.count)[0]
  if (!patriarch) return []

  const founderIds = childrenOf.get(patriarch.id) ?? []
  return founderIds
    .map(id => members.find(m => m.id === id))
    .filter(Boolean) as Member[]
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function Dashboard({ demoMode }: Props) {
  const { members, relationships, profile, setSelectedMemberId, trees, setActiveTreeId } = useFamilyStore()
  const myTreeAccessIds = useFamilyStore((s) => s.myTreeAccessIds)
  const fetchMyTreeAccess = useFamilyStore((s) => s.fetchMyTreeAccess)
  const notifications = useFamilyStore((s) => s.notifications)
  // Hydrate the shared-with-me tree list once the profile is known —
  // it feeds scopePersonalTrees below (admin dashboard scoping).
  useEffect(() => {
    if (!demoMode && profile) fetchMyTreeAccess()
  }, [demoMode, profile, fetchMyTreeAccess])
  const { t, lang, toggleLang } = useLang()
  const dir = isRTL(lang) ? 'rtl' : 'ltr'
  const navigate = useNavigate()
  const [aiScanOpen, setAiScanOpen] = useState(false)
  // Two "coming soon" placeholder features the user wants visible in
  // the UI now so the affordance exists; the modal explains what's
  // coming and when. Wired to actual backends in a follow-up.
  const [aiTreeFromTextOpen, setAiTreeFromTextOpen] = useState(false)
  // Long-press / right-click → tree-card context menu. `null` when
  // closed; otherwise carries the tree summary the user invoked on
  // so we can show its name in the sheet title.
  const [treeCardMenuTarget, setTreeCardMenuTarget] = useState<{ id: string | null; name: string } | null>(null)
  // Touch long-press timer for the tree cards.  iOS Safari doesn't
  // reliably fire `contextmenu` on long-press (it shows its own
  // text-selection callout), so we add an explicit 600ms pointer
  // timer that mirrors the desktop right-click behaviour.  Tracking
  // pressFiredRef lets the click handler suppress the navigate-on-tap
  // when the press already opened the menu.
  const treeCardPressTimerRef = useRef<number | null>(null)
  const treeCardPressFiredRef = useRef(false)

  // Tutorial overlay state. Auto-launches once on the user's very
  // first visit (localStorage flag) and otherwise sits behind the
  // manual "Tutorial" tile in the Apps grid below. Skipping or
  // finishing the tour writes the flag so the auto-launch never
  // pops up again.
  const [tutorialOpen, setTutorialOpen] = useState(false)
  // Join-tree-by-code modal — reachable from both the QuickAccessMenu
  // and the new "🔑" tile in the Apps grid below.
  const [joinTreeOpen, setJoinTreeOpen] = useState(false)
  // Account-security modal (opt-in two-factor) — real backend only.
  const [securityOpen, setSecurityOpen] = useState(false)

  // AI actions cost leaves (subscription Phase A; admins exempt):
  // confirm the price → atomic charge → open the tool. A failed charge
  // means an empty balance, surfaced inline.
  const spendLeaves = useFamilyStore((s) => s.spendLeaves)
  const openAiAction = async (kind: 'scan' | 'treeFromText') => {
    const cost = kind === 'scan' ? LEAF_COSTS.aiScan : LEAF_COSTS.aiTreeFromText
    const open = () => (kind === 'scan' ? setAiScanOpen(true) : setAiTreeFromTextOpen(true))
    if (isAdmin(profile)) {
      open()
      return
    }
    if (!window.confirm(t.aiCostConfirm.replace('{n}', String(cost)))) return
    if (await spendLeaves(cost, kind === 'scan' ? 'ai-scan' : 'ai-tree-from-text')) {
      open()
    } else {
      window.alert(t.aiNoLeaves.replace('{n}', String(cost)))
    }
  }
  // The tutorial no longer auto-launches on first paint — it stacked on top
  // of the install prompt + version modal and overwhelmed new users. It stays
  // one tap away via the "🎓" tile and the help menu.
  const closeTutorial = () => setTutorialOpen(false)

  // Tour steps — described in Hebrew first (user's primary locale)
  // with English fallbacks. Selectors target `data-tour` attributes
  // added to anchor elements on the Dashboard + on the tree page.
  const tutorialSteps: TourStep[] = useMemo(() => (
    lang === 'he'
      ? [
          {
            selector: 'dash-hero',
            title: '👋 ברוכים הבאים!',
            body: 'כאן המרכז של המשפחה שלכם. נעבור ביחד על המסכים והכפתורים החשובים — ב-7 שלבים קצרים.',
            side: 'bottom',
          },
          {
            selector: 'dash-stats',
            title: 'תמונת מצב מהירה',
            body: 'מספר החברים, הדורות והענפים — נטען אוטומטית מהעץ שלכם.',
            side: 'bottom',
          },
          {
            selector: 'dash-trees',
            title: '🌿 ענפי המשפחה',
            body: 'כל עץ שאתם חברים בו מופיע כאן ככרטיס. לחיצה תפתח אותו ישר ב"תצוגת עץ".',
            side: 'top',
          },
          {
            selector: 'dash-birthdays',
            title: '🎂 ימי הולדת קרובים',
            body: 'מי חוגג בקרוב? נוצר אוטומטית מתאריכי הלידה של חברי המשפחה.',
            side: 'top',
          },
          {
            selector: 'dash-apps',
            title: '🚀 אפליקציות נוספות',
            body: 'מכאן ניגשים לעץ עצמו, לימי הולדת, ולפיצ\'רי ה-AI (סריקה, בניית עץ מטקסט, שיפור תמונות).',
            side: 'top',
          },
          {
            selector: 'dash-tutorial-tile',
            title: '✨ ההדרכה הזו',
            body: 'תוכלו לחזור על המדריך הזה בכל זמן מהכפתור הזה. אנחנו ממליצים לעבור שוב אחרי שתוסיפו חברי משפחה.',
            side: 'top',
          },
          {
            selector: 'dash-about',
            title: '📖 על המשפחה',
            body: 'הסיפור של המשפחה שלכם. תוכלו לערוך אותו דרך מסך הניהול. וזהו — מוכנים להתחיל לבנות!',
            side: 'bottom',
          },
        ]
      : [
          { selector: 'dash-hero', title: '👋 Welcome!', body: 'This is your family hub. We\'ll walk you through the key screens in 7 short steps.', side: 'bottom' },
          { selector: 'dash-stats', title: 'Quick snapshot', body: 'Member count, generations and branches — auto-derived from your tree.', side: 'bottom' },
          { selector: 'dash-trees', title: '🌿 Family trees', body: 'Every tree you belong to shows up here as a card. Tap one to open it.', side: 'top' },
          { selector: 'dash-birthdays', title: '🎂 Upcoming birthdays', body: 'Who\'s celebrating soon — computed from each member\'s birth date.', side: 'top' },
          { selector: 'dash-apps', title: '🚀 Apps', body: 'Jump into the tree itself, birthdays view, and the AI features.', side: 'top' },
          { selector: 'dash-tutorial-tile', title: '✨ This tutorial', body: 'You can replay this walkthrough any time from this button.', side: 'top' },
          { selector: 'dash-about', title: '📖 About the family', body: 'Your family story. Editable from Admin. That\'s it — let\'s start building!', side: 'bottom' },
        ]
  ), [lang])

  // Visibility gate (same rule as treeSummaries below): everyone —
  // including admins — sees only members of trees they own or that
  // were explicitly shared with them (tree_access). Admins used to
  // bypass this and got every family in the system mixed into their
  // personal dashboard; the admin PANEL still sees all via its own
  // queries. Joined-via-code trees count (the old owned-only filter
  // hid them from the very users who joined). Everything that exposes
  // a member list — birthdays, stats, generation count, branch
  // founders — must respect this filter.
  const scopedTrees = useMemo(
    () => scopePersonalTrees(trees, profile, myTreeAccessIds, demoMode),
    [trees, profile, myTreeAccessIds, demoMode],
  )
  const visibleMembers = useMemo(() => {
    if (demoMode) return members
    const ids = new Set(scopedTrees.map((t) => t.id))
    // Legacy members without tree_id (the pre-multi-tree pool) stay
    // admin-only, same as the main-tree card below.
    const includeMain = isAdmin(profile)
    return members.filter((m) => (m.tree_id != null ? ids.has(m.tree_id) : includeMain))
  }, [members, scopedTrees, profile, demoMode])
  const visibleRelationships = useMemo(() => {
    if (demoMode) return relationships
    const ids = new Set(visibleMembers.map((m) => m.id))
    return relationships.filter((r) => ids.has(r.member_a_id) && ids.has(r.member_b_id))
  }, [relationships, visibleMembers, demoMode])

  const upcoming = useMemo(() => getUpcomingBirthdays(visibleMembers), [visibleMembers])
  const generations = useMemo(() => computeGenerations(visibleMembers, visibleRelationships), [visibleMembers, visibleRelationships])
  const founders = useMemo(() => computeBranchFounders(visibleMembers, visibleRelationships), [visibleMembers, visibleRelationships])

  // ── Tree summaries (replaces the per-person founders rail) ──────────
  // The "branches" section used to show individual people; the user
  // asked for tree-level cards instead. Each summary is one card:
  //
  //   • a named tree from the store → its own row;
  //   • the implicit "main" tree (members with no tree_id) → one row,
  //     labelled by the most common surname inside that population
  //     ("עץ משפחת אדלר" etc.).
  //
  // Each row carries a colour so the cards stay visually distinct in
  // the rail without needing photographs of people on them.
  const treeSummaries = useMemo(() => {
    const dominantSurname = (pool: typeof members): string | null => {
      const counts = new Map<string, number>()
      for (const m of pool) {
        const ln = (m.last_name ?? '').trim()
        if (!ln) continue
        counts.set(ln, (counts.get(ln) ?? 0) + 1)
      }
      let best: { name: string; n: number } | null = null
      for (const [name, n] of counts) {
        if (!best || n > best.n) best = { name, n }
      }
      return best?.name ?? null
    }

    const palette = ['#007AFF', '#5E5CE6', '#34C759', '#FF9F0A', '#FF2D92', '#5AC8FA']
    const summaries: {
      id: string | null
      name: string
      count: number
      color: string
      icon: string | null
      isMain: boolean
    }[] = []

    // Access gate: a non-admin user must only ever see trees they
    // explicitly own. The "main" tree (members without tree_id) is
    // the shared / seeded pool — exposing it to fresh signups was the
    // bug ("any new user lands on the Adler family"). Admins still
    // see everything so they can run the system; demo mode keeps the
    // old behavior so the marketing demo isn't broken.
    const userIsAdmin = isAdmin(profile)
    const canSeeMainTree = demoMode || userIsAdmin

    const mainPool = members.filter((m) => !m.tree_id)
    if (mainPool.length > 0 && canSeeMainTree) {
      const ln = dominantSurname(mainPool)
      summaries.push({
        id: null,
        name: ln
          ? (lang === 'he' ? `עץ משפחת ${ln}` : `${ln} Family Tree`)
          : (lang === 'he' ? 'עץ המשפחה הראשי' : 'Main Family Tree'),
        count: mainPool.length,
        color: '#007AFF',
        icon: null,
        isMain: true,
      })
    }

    // The server already restricts `trees` to ones the current user
    // has access to (owner via family_trees.created_by OR membership via
    // tree_access). Admins are the exception — their RLS bypass returns
    // every tree in the system, so scopePersonalTrees narrows the rail
    // to owned + explicitly-shared, same as everyone else.
    const visibleTrees = scopedTrees
    visibleTrees.forEach((tr, i) => {
      const pool = members.filter((m) => m.tree_id === tr.id)
      summaries.push({
        id: tr.id,
        name: tr.name || (lang === 'he' ? 'עץ ללא שם' : 'Unnamed tree'),
        count: pool.length,
        color: tr.color ?? palette[(i + 1) % palette.length]!,
        icon: tr.icon_url ?? null,
        isMain: false,
      })
    })

    return summaries
  }, [members, scopedTrees, lang, profile, demoMode])

  const today = new Date()
  const dateStr = today.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  const openMember = (id: string) => {
    setSelectedMemberId(id)
    navigate('/tree')
  }

  return (
    <div dir={dir} className="min-h-screen bg-mesh-gradient pb-10">
      {/* Demo banner hidden — the setup hint surfaces only on /login when relevant. */}
      {/* One-shot "your access request was approved/declined" banner. */}
      {!demoMode && <AccessRequestStatusToast />}

      {/* ─── HERO ─── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="relative px-4 pt-5 pb-6 max-w-lg mx-auto"
      >
        {/* Top row: logo / date / actions */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-11 h-11 rounded-2xl bg-white shadow-lg shadow-cyan-200/50 ring-1 ring-cyan-100 flex items-center justify-center overflow-hidden">
              <BrandMark size={44} />
            </div>
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#1C1C1E] leading-none">
                {t.appName}
              </p>
              <p className="text-sf-caption text-[#636366] mt-0.5">{dateStr}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleLang}
              className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-[#636366] bg-white/70 backdrop-blur border border-white/50 shadow-sm hover:bg-white/90 transition min-w-[34px]"
            >
              {lang === 'he' ? 'EN' : 'עב'}
            </button>
            {/* Persistent notification inbox — approvals, requests,
                reports. Hidden in demo mode (no backend rows). */}
            {!demoMode && <NotificationBell />}
            {!demoMode && (
              <button
                onClick={() => setSecurityOpen(true)}
                title={t.securityTitle}
                aria-label={t.securityTitle}
                className="w-8 h-8 bg-white/70 backdrop-blur border border-white/50 rounded-xl flex items-center justify-center hover:bg-white/90 transition"
              >
                <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
                  <path d="M7.5 1.5l5 2v3.6c0 3-2.1 5.6-5 6.4-2.9-.8-5-3.4-5-6.4V3.5l5-2z" stroke="#636366" strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M5.3 7.5l1.5 1.5 2.9-3" stroke="#636366" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {!demoMode && (
              <button
                onClick={async () => { await supabase.auth.signOut(); navigate('/') }}
                title={t.signOut}
                className="w-8 h-8 bg-white/70 backdrop-blur border border-white/50 rounded-xl flex items-center justify-center hover:bg-white/90 transition"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5 7h7M9 5l2 2-2 2M8 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h5" stroke="#636366" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <SecuritySettingsModal open={securityOpen} onClose={() => setSecurityOpen(false)} />
          </div>
        </div>

        {/* Family emblem + tagline */}
        <motion.div
          data-tour="dash-hero"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="text-center"
        >
          <div className="relative inline-flex items-center justify-center mb-3">
            <div
              className="absolute inset-0 rounded-full blur-2xl opacity-60"
              style={{ background: 'radial-gradient(circle, #007AFF 0%, transparent 70%)' }}
            />
            <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-[#007AFF] via-[#32ADE6] to-[#5AC8FA] shadow-2xl flex items-center justify-center">
              <span className="text-4xl">👨‍👩‍👧‍👦</span>
            </div>
          </div>
          <h1 className="text-sf-title1 text-[#1C1C1E] leading-tight" style={{ fontSize: 30 }}>
            {profile?.full_name}
          </h1>
          <p className="text-sf-subhead text-[#636366] mt-1">{t.dashTagline}</p>
        </motion.div>

        {/* Stats strip */}
        <motion.div
          data-tour="dash-stats"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06 }}
          className="mt-6 grid grid-cols-3 gap-2"
        >
          {[
            { value: visibleMembers.length, label: t.dashMembers, color: '#007AFF', bg: 'from-[#007AFF]/10 to-[#32ADE6]/10' },
            { value: generations, label: t.dashGenerations, color: '#32ADE6', bg: 'from-[#32ADE6]/10 to-[#5AC8FA]/10' },
            { value: founders.length, label: t.dashBranches, color: '#5AC8FA', bg: 'from-[#5AC8FA]/10 to-[#64D2FF]/10' },
          ].map((s, i) => (
            <div
              key={i}
              className={`rounded-3xl p-3 text-center bg-gradient-to-br ${s.bg} border border-white/60 backdrop-blur-xl shadow-glass-sm`}
            >
              <p className="text-2xl font-bold leading-none" style={{ color: s.color }}>{s.value}</p>
              <p className="text-[11px] text-[#636366] font-medium mt-1">{s.label}</p>
            </div>
          ))}
        </motion.div>
      </motion.div>

      <div className="px-4 space-y-5 max-w-lg mx-auto">
        {/* ─── MY PLAN (subscription Phase A) ─── */}
        <PlanCard />

        {/* ─── INCOMPLETE-PROFILE BANNER ─── */}
        {!demoMode && profile && !isOnboarded(profile) && (
          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/onboarding')}
            className="w-full text-start glass-strong rounded-3xl p-4 flex items-center gap-3 shadow-glass border border-[#5E5CE6]/25 bg-gradient-to-br from-[#5E5CE6]/8 to-[#BF5AF2]/8 hover:shadow-glass-lg transition"
          >
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#5E5CE6] to-[#BF5AF2] flex items-center justify-center shadow-md flex-shrink-0">
              <span className="text-xl">📝</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sf-subhead font-bold text-[#1C1C1E] leading-tight">{t.dashCompleteProfile}</p>
              <p className="text-sf-caption text-[#636366] mt-0.5">{t.dashCompleteProfileHint}</p>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
              <path d={isRTL(lang) ? 'M9 3L5 7l4 4' : 'M5 3l4 4-4 4'} stroke="#5E5CE6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
        )}

        {/* ─── ABOUT (now ABOVE the branches per user request) ───
            Reframed as a small "hero card" with an animated decorative
            glow + a floating book icon so it carries the Landing-page
            vibe. Sits at the top of the secondary stack so a returning
            visitor reads the family description before scanning the
            tree rail below. */}
        <motion.section
          data-tour="dash-about"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-3xl p-4 shadow-glass border border-white/60"
          style={{
            background:
              'linear-gradient(135deg, rgba(0,122,255,0.10), rgba(94,92,230,0.10) 55%, rgba(255,45,146,0.08))',
            backdropFilter: 'blur(18px) saturate(160%)',
            WebkitBackdropFilter: 'blur(18px) saturate(160%)',
          }}
        >
          {/* Soft radial glows — same palette as Landing's TreeBackdrop
              so the two screens feel like the same family of pages.
              pointer-events-none keeps them out of the click path. */}
          <div className="pointer-events-none absolute -top-16 -start-16 w-44 h-44 rounded-full bg-[#5E5CE6]/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-14 -end-12 w-44 h-44 rounded-full bg-[#FF2D92]/18 blur-3xl" />
          <div className="pointer-events-none absolute top-8 end-8 w-24 h-24 rounded-full bg-[#32ADE6]/20 blur-2xl" />

          <div className="relative flex items-start gap-3">
            <motion.div
              initial={{ scale: 0.6, rotate: -10, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ delay: 0.18, type: 'spring', stiffness: 260, damping: 18 }}
              className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#5AC8FA] to-[#007AFF] flex items-center justify-center flex-shrink-0 shadow-md shadow-blue-300/40"
            >
              <span className="text-lg">📖</span>
            </motion.div>
            <div>
              <h3 className="text-sf-subhead font-bold text-[#1C1C1E] mb-1">{t.dashAbout}</h3>
              <p className="text-sf-footnote text-[#3A3A3C] leading-relaxed">{t.dashAboutText}</p>
            </div>
          </div>
        </motion.section>

        {/* ─── FAMILY TREES RAIL ───
            Used to show individual founders by photo; per a user
            request it now renders one card per TREE (named trees +
            the implicit main tree). Each card carries the tree's
            name ("עץ משפחת אדלר") + a member count, NO faces. The
            row scrolls horizontally so multi-tree households fit
            without redesigning the page. */}
        {treeSummaries.length > 0 && (
          <motion.section
            data-tour="dash-trees"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.12 }}
            className="relative overflow-hidden glass-strong rounded-3xl p-4 shadow-glass"
          >
            {/* Subtle backdrop glow to echo the About card above. */}
            <div className="pointer-events-none absolute -bottom-20 -start-10 w-52 h-52 rounded-full bg-[#007AFF]/12 blur-3xl" />
            <div className="pointer-events-none absolute -top-12 -end-10 w-40 h-40 rounded-full bg-[#34C759]/14 blur-3xl" />

            <div className="relative flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-base">🌿</span>
                <h3 className="text-sf-subhead font-bold text-[#1C1C1E]">{t.dashBranchesTitle}</h3>
              </div>
              <button onClick={() => navigate('/tree')} className="text-[12px] text-[#007AFF] font-semibold">
                {t.dashSeeAll}
              </button>
            </div>
            <div
              className="relative flex gap-3 overflow-x-auto pb-1 -mx-1 px-1"
              style={{ scrollbarWidth: 'none' }}
            >
              {treeSummaries.map((tree, i) => (
                <motion.button
                  key={tree.id ?? 'main'}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.18 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    // Suppress the tap-to-open-tree when the long-press
                    // already opened the action menu — otherwise both
                    // fire and the user lands on the tree instead of
                    // seeing the menu.
                    if (treeCardPressFiredRef.current) {
                      treeCardPressFiredRef.current = false
                      return
                    }
                    setActiveTreeId(tree.id)
                    navigate('/tree')
                  }}
                  onContextMenu={(e) => {
                    // Desktop right-click → action menu directly.
                    e.preventDefault()
                    setTreeCardMenuTarget(tree)
                  }}
                  onPointerDown={(e) => {
                    if (e.pointerType !== 'touch') return
                    treeCardPressFiredRef.current = false
                    if (treeCardPressTimerRef.current != null) {
                      window.clearTimeout(treeCardPressTimerRef.current)
                    }
                    treeCardPressTimerRef.current = window.setTimeout(() => {
                      treeCardPressFiredRef.current = true
                      // Light haptic tick so the long-press registers as
                      // a deliberate action (no-op where unsupported,
                      // e.g. iOS Safari).
                      try { navigator.vibrate?.(10) } catch { /* unsupported */ }
                      setTreeCardMenuTarget(tree)
                    }, 600)
                  }}
                  onPointerUp={() => {
                    if (treeCardPressTimerRef.current != null) {
                      window.clearTimeout(treeCardPressTimerRef.current)
                      treeCardPressTimerRef.current = null
                    }
                  }}
                  onPointerCancel={() => {
                    if (treeCardPressTimerRef.current != null) {
                      window.clearTimeout(treeCardPressTimerRef.current)
                      treeCardPressTimerRef.current = null
                    }
                  }}
                  onPointerMove={() => {
                    // Any finger movement cancels the long-press —
                    // matches native iOS behaviour where dragging
                    // dismisses the long-press menu.
                    if (treeCardPressTimerRef.current != null) {
                      window.clearTimeout(treeCardPressTimerRef.current)
                      treeCardPressTimerRef.current = null
                    }
                  }}
                  className="flex-shrink-0 flex flex-col items-center gap-1.5 no-select rounded-2xl px-2 py-1.5 hover:bg-white/40 transition"
                  style={{ width: 96 }}
                >
                  {/* Tree-glyph "avatar" — a coloured rounded square
                      with a stylised tree silhouette inside. Replaces
                      the person photo so there are no faces in this
                      rail, per the user's instruction. */}
                  <div
                    className="rounded-2xl shadow-md flex items-center justify-center w-[60px] h-[60px] relative"
                    style={{
                      background: `linear-gradient(135deg, ${tree.color}, ${tree.color}AA)`,
                    }}
                  >
                    {/* Custom uploaded icon wins; the silhouette is the
                        fallback. Rounded on the img itself — the parent
                        must NOT clip (the count pill + balloon overflow
                        its corners on purpose). */}
                    {tree.icon ? (
                      <img
                        src={tree.icon}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover rounded-2xl"
                        loading="lazy"
                      />
                    ) : (
                      <svg width="34" height="34" viewBox="0 0 32 32" fill="none" aria-hidden>
                        <circle cx="16" cy="9" r="3.4" fill="white" opacity="0.95" />
                        <circle cx="8" cy="20" r="3" fill="white" opacity="0.78" />
                        <circle cx="24" cy="20" r="3" fill="white" opacity="0.78" />
                        <line x1="16" y1="12.4" x2="8" y2="17" stroke="white" strokeWidth="1.4" strokeOpacity="0.7" strokeLinecap="round" />
                        <line x1="16" y1="12.4" x2="24" y2="17" stroke="white" strokeWidth="1.4" strokeOpacity="0.7" strokeLinecap="round" />
                      </svg>
                    )}
                    {/* Member count pill — tucked in the corner so
                        the user can tell at a glance which tree is
                        biggest without opening it. */}
                    <span
                      className="absolute -bottom-1 -end-1 bg-white rounded-full px-1.5 py-0.5 text-[9px] font-bold shadow-sm"
                      style={{ color: tree.color }}
                    >
                      {tree.count}
                    </span>
                    {/* Share-code balloon — an approved request minted
                        a code for this tree that the user hasn't seen
                        yet. Cleared when the long-press menu (or the
                        notification panel) shows it. */}
                    {hasUnseenShareCode(notifications, tree.id) && (
                      <span
                        className="absolute -top-1 -start-1 w-3.5 h-3.5 rounded-full bg-[#FF3B30] border-2 border-white shadow"
                        aria-hidden
                      />
                    )}
                    {/* Visible "⋯" affordance so the action menu is
                        discoverable without knowing the long-press
                        shortcut. role=button (not a real <button>)
                        because the whole card is already a button and
                        nesting one is invalid HTML. stopPropagation on
                        pointerdown also cancels the card's long-press
                        timer and its tap-to-open-tree. */}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={lang === 'he' ? 'אפשרויות עץ' : 'Tree options'}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        if (treeCardPressTimerRef.current != null) {
                          window.clearTimeout(treeCardPressTimerRef.current)
                          treeCardPressTimerRef.current = null
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        try { navigator.vibrate?.(10) } catch { /* unsupported */ }
                        setTreeCardMenuTarget(tree)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          setTreeCardMenuTarget(tree)
                        }
                      }}
                      className="absolute -top-1.5 -end-1.5 w-6 h-6 rounded-full bg-white shadow-md flex items-center justify-center text-[#636366] active:scale-90 transition cursor-pointer"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
                        <circle cx="3" cy="7" r="1.3" />
                        <circle cx="7" cy="7" r="1.3" />
                        <circle cx="11" cy="7" r="1.3" />
                      </svg>
                    </span>
                  </div>
                  <p
                    className="text-[10.5px] font-semibold text-[#1C1C1E] text-center leading-tight w-full"
                    style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                  >
                    {tree.name}
                  </p>
                </motion.button>
              ))}
            </div>
          </motion.section>
        )}

        {/* ─── UPCOMING BIRTHDAYS ─── */}
        <motion.section
          data-tour="dash-birthdays"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.15 }}
          className="glass-strong rounded-3xl p-4 shadow-glass"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🎂</span>
              <h3 className="text-sf-subhead font-bold text-[#1C1C1E]">{t.dashUpcomingBirthdays}</h3>
            </div>
            <button onClick={() => navigate('/birthdays')} className="text-[12px] text-[#007AFF] font-semibold">
              {t.dashSeeAll}
            </button>
          </div>

          {upcoming.length === 0 ? (
            <div className="py-6 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-[#007AFF]/15 to-[#5AC8FA]/15 flex items-center justify-center mb-2">
                <span className="text-2xl">🗓️</span>
              </div>
              <p className="text-sf-footnote text-[#636366] font-medium">{t.dashNoBirthdays}</p>
              <p className="text-sf-caption text-[#8E8E93] mt-0.5">{t.dashNoBirthdaysHint}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {upcoming.map(({ member, daysUntil, nextDate }) => (
                <button
                  key={member.id}
                  onClick={() => openMember(member.id)}
                  className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-[#F2F2F7]/80 transition text-right"
                >
                  <MiniAvatar member={member} />
                  <div className="flex-1 min-w-0 text-start">
                    <p className="text-sf-subhead font-semibold text-[#1C1C1E] truncate">
                      {member.first_name} {member.last_name}
                    </p>
                    <p className="text-sf-caption text-[#8E8E93]">
                      {nextDate.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { month: 'long', day: 'numeric' })}
                    </p>
                  </div>
                  <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${
                    daysUntil === 0
                      ? 'bg-[#FF3B30]/12 text-[#FF3B30]'
                      : daysUntil <= 7
                      ? 'bg-[#32ADE6]/12 text-[#32ADE6]'
                      : 'bg-[#34C759]/12 text-[#34C759]'
                  }`}>
                    {daysUntil === 0 ? '🎉' : `+${daysUntil}d`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </motion.section>

        {/* ─── APP LAUNCHER ─── */}
        <motion.section
          data-tour="dash-apps"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2 }}
        >
          <div className="flex items-center gap-2 mb-3 px-1">
            <h3 className="text-sf-subhead font-bold text-[#1C1C1E]">{t.dashApps}</h3>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <AppTile
              index={0}
              icon="🌳"
              label={lang === 'he' ? 'עץ משפחה' : 'Family Tree'}
              gradient="from-[#007AFF] to-[#32ADE6]"
              onClick={() => navigate('/tree')}
            />
            <AppTile
              index={1}
              icon="🎂"
              label={lang === 'he' ? 'ימי הולדת' : 'Birthdays'}
              gradient="from-[#32ADE6] to-[#5AC8FA]"
              onClick={() => navigate('/birthdays')}
            />
            <AppTile
              index={2}
              icon="✨"
              label={t.aiScanTitle}
              gradient="from-[#5E5CE6] to-[#BF5AF2]"
              onClick={() => openAiAction('scan')}
            />
            <AppTile
              index={3}
              icon="📝"
              label={t.aiTreeFromTextLabel}
              gradient="from-[#FF9F0A] to-[#FF375F]"
              onClick={() => openAiAction('treeFromText')}
              tooltip={t.btfSubtitle}
            />
            <div data-tour="dash-tutorial-tile">
              <AppTile
                index={5}
                icon="🎓"
                label={lang === 'he' ? 'מצב למידה' : 'Tutorial'}
                gradient="from-[#FFD60A] to-[#FF9F0A]"
                onClick={() => setTutorialOpen(true)}
                tooltip={lang === 'he' ? 'מדריך אינטראקטיבי על המערכת' : 'Interactive guide to the app'}
              />
            </div>
            {/* Join-by-code tile. Mirrors the QuickAccessMenu item
                added earlier — surfaced here too so a user who's
                navigated past the landing menu can still attach
                themselves to a family tree they've been invited to. */}
            <AppTile
              index={6}
              icon="🔑"
              label={t.quickAccessJoinTree}
              gradient="from-[#FF9F0A] to-[#FFD60A]"
              onClick={() => setJoinTreeOpen(true)}
              tooltip={t.quickAccessJoinTreeHint}
            />
            {isAdmin(profile) && (
              <AppTile
                index={7}
                icon="⚙️"
                label={lang === 'he' ? 'ניהול' : 'Admin'}
                gradient="from-[#5AC8FA] to-[#64D2FF]"
                onClick={() => navigate('/admin')}
                badge={countUnreadAdminInbox(notifications)}
              />
            )}
          </div>
        </motion.section>

        {/* The About card used to live here. It was promoted to the
            top of this stack (just under the incomplete-profile
            banner) so a returning visitor reads the family
            description before scanning the tree rail below — that
            request landed with a screenshot showing the section was
            getting buried below the fold. */}
      </div>

      {/* AI Scan modal — mounted at the page root so backdrop covers everything. */}
      <AIScanModal
        open={aiScanOpen}
        onClose={() => setAiScanOpen(false)}
        onAdded={(count) => {
          // Tiny toast-style alert keeps this dependency-free.
          setTimeout(() => alert(`${count} ${t.aiScanAddedCount} ✓`), 50)
        }}
      />

      {/* Build-from-text — local parser modal (no API, ships in main
          bundle). The matching tile launches this directly; the older
          "Coming Soon" placeholder lives on only for the photo-enhance
          tile below, which is still pending an API. */}
      <BuildFromTextModal
        open={aiTreeFromTextOpen}
        onClose={() => setAiTreeFromTextOpen(false)}
        onAdded={(count) => {
          if (count > 0) {
            setTimeout(() => alert(`${count} ${lang === 'he' ? 'אנשים נוספו לעץ ✓' : 'people added to the tree ✓'}`), 50)
          }
        }}
      />

      {/* Interactive tutorial. Launches automatically on first visit
          (localStorage flag) and on-demand from the Apps grid above. */}
      <JoinTreeModal
        open={joinTreeOpen}
        onClose={() => setJoinTreeOpen(false)}
      />

      <TutorialOverlay
        open={tutorialOpen}
        steps={tutorialSteps}
        onClose={closeTutorial}
      />

      {/* Tree-card long-press / right-click menu.  "Request share
          code" is real — it files an access_request the admin picks
          up in their pending list.  The other rows are surfaced with
          a "coming soon" pill so the affordance is discoverable while
          the backends (Supabase Storage for icons, share tokens for
          external links, depth gating) land. */}
      <TreeCardActionMenu
        open={treeCardMenuTarget !== null}
        onClose={() => setTreeCardMenuTarget(null)}
        target={treeCardMenuTarget}
      />
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function MiniAvatar({ member }: { member: Member }) {
  return (
    <div
      className="rounded-full shadow-sm flex-shrink-0"
      style={{ padding: 2, background: getRingGradient(member) }}
    >
      <div className="rounded-full bg-white p-[1.5px]">
        <div className="w-9 h-9 rounded-full overflow-hidden">
          {member.photo_url ? (
            <img src={member.photo_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(member)} flex items-center justify-center`}>
              <PersonAvatarIcon gender={member.gender} size={36} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AppTile({
  icon, label, gradient, onClick, comingSoon, tooltip, index = 0, badge = 0,
}: {
  icon: string
  label: string
  gradient: string
  onClick: () => void
  /** Renders a small "בקרוב" / "soon" ribbon in the corner +
   *  dims the tile slightly so it reads as not-yet-shipped. */
  comingSoon?: boolean
  /** Native title attribute — quick hover hint without pulling in a
   *  custom tooltip component on a low-density grid. */
  tooltip?: string
  /** Position in the grid — drives the staggered fade-in so tiles
   *  ripple onto the dashboard instead of all appearing at once. */
  index?: number
  /** Red counter chip (e.g. pending admin requests). 0 hides it. */
  badge?: number
}) {
  return (
    <motion.button
      // Two-stage entry: each tile fades + slides + scales up, with
      // a stagger keyed to its position in the grid. The cubic-bezier
      // mimics Apple's spring decay so the tiles feel like they
      // settle in, not just appear.
      initial={{ opacity: 0, y: 22, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        delay: 0.08 + index * 0.06,
        duration: 0.55,
        ease: [0.16, 1, 0.3, 1],
      }}
      whileHover={{ y: -6, scale: 1.04 }}
      whileTap={{ scale: 0.94, y: 0 }}
      onClick={onClick}
      title={tooltip}
      // Fixed height locks the grid even when labels wrap to two
      // lines. group + relative wires up the halo + glow tricks
      // below.
      className="group relative h-32 w-full rounded-3xl overflow-hidden focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
    >
      {/* Halo: a soft, oversized blur of the tile's accent gradient
          sitting behind everything else. Scales up on hover so the
          tile looks like it's lighting up the area around it. */}
      <span
        aria-hidden
        className={`absolute -inset-6 rounded-[42px] bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-30 blur-2xl transition-opacity duration-500 pointer-events-none`}
      />

      {/* Tile surface — frosted glass over a faint diagonal tint of
          the accent gradient so each tile carries its own colour
          fingerprint instead of being a uniform white card. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-3xl bg-white/85 backdrop-blur-xl border border-white/70 shadow-glass group-hover:shadow-xl transition-shadow duration-300"
      />
      <span
        aria-hidden
        className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${gradient} opacity-[0.08] group-hover:opacity-[0.16] transition-opacity duration-300 pointer-events-none`}
      />

      {/* "בקרוב" ribbon — sits above the tile surface. */}
      {comingSoon && (
        <span className="absolute top-2 end-2 z-10 rounded-full bg-[#FF9F0A] text-white text-[9px] font-bold px-1.5 py-0.5 shadow-sm">
          🚀
        </span>
      )}

      {/* Pending-work counter (admin tile) — red so it reads as
          "things are waiting for you", capped for sanity. */}
      {badge > 0 && (
        <span className="absolute top-2 start-2 z-10 min-w-[20px] h-5 px-1.5 rounded-full bg-[#FF3B30] text-white text-[11px] font-bold flex items-center justify-center shadow">
          {badge > 9 ? '9+' : badge}
        </span>
      )}

      {/* Foreground — icon + label, stacked + centred. The icon
          chip has its own subtle idle breathing so the grid never
          feels static; phases are offset per tile via `index`. */}
      <span className="relative z-[1] flex h-full flex-col items-center justify-center gap-2 px-2">
        <motion.span
          className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg ${comingSoon ? 'opacity-90' : ''}`}
          animate={{
            scale: [1, 1.03, 1],
            y: [0, -1.5, 0],
          }}
          transition={{
            duration: 4 + (index % 3) * 0.4,
            delay: index * 0.18,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          <span className="text-2xl drop-shadow-sm">{icon}</span>
        </motion.span>
        {/* Label clamps to 2 lines so a longer name does NOT make the
            tile grow vertically. */}
        <p className="text-[12px] font-semibold text-[#1C1C1E] text-center leading-tight line-clamp-2 px-1">
          {label}
        </p>
      </span>
    </motion.button>
  )
}

