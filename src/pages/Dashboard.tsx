import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import { supabase } from '../lib/supabase'
import { isAdmin } from '../lib/permissions'
import { getRingGradient, getFallbackGradient, PersonAvatarIcon } from '../components/MemberNode'
import AIScanModal from '../components/ai/AIScanModal'
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
  const { members, relationships, profile, setSelectedMemberId } = useFamilyStore()
  const { t, lang, toggleLang } = useLang()
  const dir = isRTL(lang) ? 'rtl' : 'ltr'
  const navigate = useNavigate()
  const [aiScanOpen, setAiScanOpen] = useState(false)

  const upcoming = useMemo(() => getUpcomingBirthdays(members), [members])
  const generations = useMemo(() => computeGenerations(members, relationships), [members, relationships])
  const founders = useMemo(() => computeBranchFounders(members, relationships), [members, relationships])

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
        {/* ─── BRANCHES RAIL (Instagram stories style) ─── */}
        {founders.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="glass-strong rounded-3xl p-4 shadow-glass"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-base">🌿</span>
                <h3 className="text-sf-subhead font-bold text-[#1C1C1E]">{t.dashBranchesTitle}</h3>
              </div>
              <button onClick={() => navigate('/tree')} className="text-[12px] text-[#007AFF] font-semibold">
                {t.dashSeeAll}
              </button>
            </div>
            <div
              className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1"
              style={{ scrollbarWidth: 'none' }}
            >
              {founders.map((m) => (
                <button
                  key={m.id}
                  onClick={() => openMember(m.id)}
                  className="flex-shrink-0 flex flex-col items-center gap-1.5 no-select"
                  style={{ width: 64 }}
                >
                  <div
                    className="rounded-full shadow-md"
                    style={{ padding: 2.5, background: getRingGradient(m) }}
                  >
                    <div className="rounded-full bg-white p-[2px]">
                      <div className="w-[52px] h-[52px] rounded-full overflow-hidden">
                        {m.photo_url ? (
                          <img src={m.photo_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(m)} flex items-center justify-center`}>
                            <PersonAvatarIcon gender={m.gender} size={52} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="text-[10.5px] font-semibold text-[#1C1C1E] text-center leading-tight truncate w-full">
                    {m.first_name}
                  </p>
                </button>
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

        {/* ─── ABOUT ─── */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.25 }}
          className="glass rounded-3xl p-4 shadow-glass-sm"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-[#5AC8FA]/20 to-[#007AFF]/20 flex items-center justify-center flex-shrink-0">
              <span className="text-base">📖</span>
            </div>
            <div>
              <h3 className="text-sf-subhead font-bold text-[#1C1C1E] mb-1">{t.dashAbout}</h3>
              <p className="text-sf-footnote text-[#636366] leading-relaxed">{t.dashAboutText}</p>
            </div>
          </div>
        </motion.section>
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

function AppTile({ icon, label, gradient, onClick }: { icon: string; label: string; gradient: string; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className="glass-strong rounded-3xl p-3 flex flex-col items-center gap-2 shadow-glass active:shadow-glass-sm transition"
    >
      <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md`}>
        <span className="text-xl">{icon}</span>
      </div>
      <p className="text-[12px] font-semibold text-[#1C1C1E] text-center leading-tight">{label}</p>
    </motion.button>
  )
}

