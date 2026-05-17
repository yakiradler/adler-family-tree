import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import { supabase } from '../lib/supabase'
import { isAdmin, isOnboarded } from '../lib/permissions'
import { getRingGradient, getFallbackGradient, PersonAvatarIcon } from '../components/MemberNode'
import AIScanModal from '../components/ai/AIScanModal'
import ComingSoonModal from '../components/ComingSoonModal'
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
  const { t, lang, toggleLang } = useLang()
  const dir = isRTL(lang) ? 'rtl' : 'ltr'
  const navigate = useNavigate()
  const [aiScanOpen, setAiScanOpen] = useState(false)
  // Two "coming soon" placeholder features the user wants visible in
  // the UI now so the affordance exists; the modal explains what's
  // coming and when. Wired to actual backends in a follow-up.
  const [aiTreeFromTextOpen, setAiTreeFromTextOpen] = useState(false)
  const [aiPhotoEnhanceOpen, setAiPhotoEnhanceOpen] = useState(false)

  const upcoming = useMemo(() => getUpcomingBirthdays(members), [members])
  const generations = useMemo(() => computeGenerations(members, relationships), [members, relationships])
  const founders = useMemo(() => computeBranchFounders(members, relationships), [members, relationships])

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
      isMain: boolean
    }[] = []

    const mainPool = members.filter((m) => !m.tree_id)
    if (mainPool.length > 0) {
      const ln = dominantSurname(mainPool)
      summaries.push({
        id: null,
        name: ln
          ? (lang === 'he' ? `עץ משפחת ${ln}` : `${ln} Family Tree`)
          : (lang === 'he' ? 'עץ המשפחה הראשי' : 'Main Family Tree'),
        count: mainPool.length,
        color: '#007AFF',
        isMain: true,
      })
    }

    trees.forEach((tr, i) => {
      const pool = members.filter((m) => m.tree_id === tr.id)
      summaries.push({
        id: tr.id,
        name: tr.name || (lang === 'he' ? 'עץ ללא שם' : 'Unnamed tree'),
        count: pool.length,
        color: tr.color ?? palette[(i + 1) % palette.length]!,
        isMain: false,
      })
    })

    return summaries
  }, [members, trees, lang])

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

      {/* ─── HERO ─── */}
      <div className="relative px-4 pt-5 pb-6 max-w-lg mx-auto">
        {/* Top row: logo / date / actions */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#007AFF] to-[#5856D6] shadow-lg flex items-center justify-center">
              <span className="text-xl">🌳</span>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8E8E93] leading-none">
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
          </div>
        </div>

        {/* Family emblem + tagline */}
        <motion.div
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
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06 }}
          className="mt-6 grid grid-cols-3 gap-2"
        >
          {[
            { value: members.length, label: t.dashMembers, color: '#007AFF', bg: 'from-[#007AFF]/10 to-[#32ADE6]/10' },
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
      </div>

      <div className="px-4 space-y-5 max-w-lg mx-auto">
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
                    setActiveTreeId(tree.id)
                    navigate('/tree')
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
                    <svg width="34" height="34" viewBox="0 0 32 32" fill="none" aria-hidden>
                      <circle cx="16" cy="9" r="3.4" fill="white" opacity="0.95" />
                      <circle cx="8" cy="20" r="3" fill="white" opacity="0.78" />
                      <circle cx="24" cy="20" r="3" fill="white" opacity="0.78" />
                      <line x1="16" y1="12.4" x2="8" y2="17" stroke="white" strokeWidth="1.4" strokeOpacity="0.7" strokeLinecap="round" />
                      <line x1="16" y1="12.4" x2="24" y2="17" stroke="white" strokeWidth="1.4" strokeOpacity="0.7" strokeLinecap="round" />
                    </svg>
                    {/* Member count pill — tucked in the corner so
                        the user can tell at a glance which tree is
                        biggest without opening it. */}
                    <span
                      className="absolute -bottom-1 -end-1 bg-white rounded-full px-1.5 py-0.5 text-[9px] font-bold shadow-sm"
                      style={{ color: tree.color }}
                    >
                      {tree.count}
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
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2 }}
        >
          <div className="flex items-center gap-2 mb-3 px-1">
            <h3 className="text-sf-subhead font-bold text-[#1C1C1E]">{t.dashApps}</h3>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <AppTile
              icon="🌳"
              label={lang === 'he' ? 'עץ משפחה' : 'Family Tree'}
              gradient="from-[#007AFF] to-[#32ADE6]"
              onClick={() => navigate('/tree')}
            />
            <AppTile
              icon="🎂"
              label={lang === 'he' ? 'ימי הולדת' : 'Birthdays'}
              gradient="from-[#32ADE6] to-[#5AC8FA]"
              onClick={() => navigate('/birthdays')}
            />
            <AppTile
              icon="✨"
              label={t.aiScanTitle}
              gradient="from-[#5E5CE6] to-[#BF5AF2]"
              onClick={() => setAiScanOpen(true)}
            />
            {/* "Coming soon" tiles — flagged visually with a small
                "בקרוב" badge in the corner. Tapping opens a friendly
                modal that explains what the feature will do; the
                actual backend hookup is a follow-up commit. */}
            <AppTile
              icon="📝"
              label={t.aiTreeFromTextLabel}
              gradient="from-[#FF9F0A] to-[#FF375F]"
              onClick={() => setAiTreeFromTextOpen(true)}
              comingSoon
              tooltip={t.aiComingSoonTip}
            />
            <AppTile
              icon="🖼"
              label={t.aiPhotoEnhanceLabel}
              gradient="from-[#34C759] to-[#30B454]"
              onClick={() => setAiPhotoEnhanceOpen(true)}
              comingSoon
              tooltip={t.aiComingSoonTip}
            />
            {isAdmin(profile) && (
              <AppTile
                icon="⚙️"
                label={lang === 'he' ? 'ניהול' : 'Admin'}
                gradient="from-[#5AC8FA] to-[#64D2FF]"
                onClick={() => navigate('/admin')}
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

      {/* "Coming soon" placeholders — same component, different copy
          per feature. Backend hookup lands in a follow-up commit. */}
      <ComingSoonModal
        open={aiTreeFromTextOpen}
        onClose={() => setAiTreeFromTextOpen(false)}
        icon="📝"
        title={t.aiTreeFromTextLabel}
        description={t.aiTreeFromTextDesc}
        bullets={[t.aiTreeFromTextBullet1, t.aiTreeFromTextBullet2, t.aiTreeFromTextBullet3]}
        gradient="from-[#FF9F0A] to-[#FF375F]"
      />
      <ComingSoonModal
        open={aiPhotoEnhanceOpen}
        onClose={() => setAiPhotoEnhanceOpen(false)}
        icon="🖼"
        title={t.aiPhotoEnhanceLabel}
        description={t.aiPhotoEnhanceDesc}
        bullets={[t.aiPhotoEnhanceBullet1, t.aiPhotoEnhanceBullet2, t.aiPhotoEnhanceBullet3]}
        gradient="from-[#34C759] to-[#30B454]"
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
  icon, label, gradient, onClick, comingSoon, tooltip,
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
}) {
  return (
    <motion.button
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      title={tooltip}
      className="glass-strong rounded-3xl p-3 flex flex-col items-center gap-2 shadow-glass active:shadow-glass-sm transition relative"
    >
      {comingSoon && (
        <span className="absolute top-1.5 end-1.5 rounded-full bg-[#FF9F0A] text-white text-[9px] font-bold px-1.5 py-0.5 shadow-sm">
          {/* No translation needed — same word reads in both locales
              when paired with the emoji.  */}
          🚀
        </span>
      )}
      <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md ${comingSoon ? 'opacity-90' : ''}`}>
        <span className="text-xl">{icon}</span>
      </div>
      <p className="text-[12px] font-semibold text-[#1C1C1E] text-center leading-tight">{label}</p>
    </motion.button>
  )
}

