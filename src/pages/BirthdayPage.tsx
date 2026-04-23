import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL, type Translations } from '../i18n/useT'
import { getRingGradient, getFallbackGradient, PersonAvatarIcon } from '../components/MemberNode'
import type { Member } from '../types'

interface Props { demoMode: boolean }

type CalMode = 'gregorian' | 'hebrew' | 'both'

interface BirthdayEntry {
  member: Member
  daysUntil: number
  nextDate: Date
  calendar: 'gregorian' | 'hebrew'
  turning: number | null
}

function getUpcomingBirthdays(members: Member[], mode: CalMode): BirthdayEntry[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const entries: BirthdayEntry[] = []

  for (const m of members) {
    if (m.death_date) continue
    if ((mode === 'gregorian' || mode === 'both') && m.birth_date) {
      const bd = new Date(m.birth_date)
      const next = new Date(today.getFullYear(), bd.getMonth(), bd.getDate())
      if (next < today) next.setFullYear(today.getFullYear() + 1)
      const diff = Math.round((next.getTime() - today.getTime()) / 86400000)
      entries.push({
        member: m, daysUntil: diff, nextDate: next,
        calendar: 'gregorian', turning: next.getFullYear() - bd.getFullYear(),
      })
    }
    if ((mode === 'hebrew' || mode === 'both') && m.hebrew_birth_date && m.birth_date) {
      const bd = new Date(m.birth_date)
      const next = new Date(today.getFullYear(), bd.getMonth(), bd.getDate())
      if (next < today) next.setFullYear(today.getFullYear() + 1)
      const diff = Math.round((next.getTime() - today.getTime()) / 86400000)
      entries.push({
        member: m, daysUntil: diff, nextDate: next,
        calendar: 'hebrew', turning: next.getFullYear() - bd.getFullYear(),
      })
    }
  }
  return entries.sort((a, b) => a.daysUntil - b.daysUntil)
}

function groupByMonth(entries: BirthdayEntry[], lang: 'he' | 'en') {
  const groups = new Map<string, { label: string; items: BirthdayEntry[] }>()
  for (const e of entries) {
    const key = `${e.nextDate.getFullYear()}-${e.nextDate.getMonth()}`
    const label = e.nextDate.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', {
      month: 'long', year: 'numeric',
    })
    if (!groups.has(key)) groups.set(key, { label, items: [] })
    groups.get(key)!.items.push(e)
  }
  return [...groups.values()]
}

export default function BirthdayPage(_props: Props) {
  const { members, setSelectedMemberId } = useFamilyStore()
  const { t, lang } = useLang()
  const dir = isRTL(lang) ? 'rtl' : 'ltr'
  const navigate = useNavigate()
  const [mode, setMode] = useState<CalMode>('both')

  const entries = useMemo(() => getUpcomingBirthdays(members, mode), [members, mode])
  const groups = useMemo(() => groupByMonth(entries, lang), [entries, lang])

  const withDates = members.filter(m => m.birth_date).length
  const totalCelebrants = entries.length

  return (
    <div dir={dir} className="min-h-screen bg-mesh-gradient pb-10">
      {/* Demo banner hidden for clean UX */}

      {/* Top bar */}
      <div className="px-4 pt-3 pb-2 max-w-lg mx-auto">
        <div className="glass rounded-2xl px-3 py-2 flex items-center gap-3 shadow-glass-sm">
          <motion.button
            whileTap={{ scale: 0.9 }} onClick={() => navigate('/')}
            className="w-8 h-8 rounded-xl bg-white/70 flex items-center justify-center border border-white/60"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d={isRTL(lang) ? 'M5 3l4 4-4 4' : 'M9 3L5 7l4 4'} stroke="#636366" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
          <div className="flex-1">
            <h1 className="text-sf-headline font-bold text-[#1C1C1E] leading-none flex items-center gap-2">
              <span>🎂</span> {t.birthdaysTitle}
            </h1>
            <p className="text-[11px] text-[#8E8E93] mt-0.5">{t.birthdaysSubtitle}</p>
          </div>
        </div>
      </div>

      <div className="px-4 space-y-4 max-w-lg mx-auto">
        {/* Hero card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative overflow-hidden rounded-3xl p-5 shadow-glass text-white"
          style={{ background: 'linear-gradient(135deg, #007AFF 0%, #32ADE6 55%, #5AC8FA 100%)' }}
        >
          <div className="absolute -top-10 -right-8 w-36 h-36 bg-white/15 rounded-full blur-2xl" />
          <div className="absolute -bottom-12 -left-6 w-36 h-36 bg-white/10 rounded-full blur-2xl" />
          <div className="relative flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold opacity-90">{t.birthdaysSubtitle}</p>
              <p className="text-4xl font-bold leading-none mt-1">{totalCelebrants}</p>
              <p className="text-[13px] opacity-90 mt-1">
                {totalCelebrants === 1 ? t.birthdaysCount1 : t.birthdaysCountN}
              </p>
            </div>
            <div className="text-6xl opacity-90">🎂</div>
          </div>
        </motion.div>

        {/* Filter tabs */}
        <div className="glass rounded-2xl p-1 flex gap-1 shadow-glass-sm">
          {([
            ['both', t.birthdaysBoth],
            ['gregorian', t.birthdaysGregorian],
            ['hebrew', t.birthdaysHebrew],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`flex-1 py-1.5 rounded-xl text-[12px] font-semibold transition-all ${
                mode === key ? 'bg-[#007AFF] text-white shadow-sm' : 'text-[#636366]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Empty vs content */}
        {entries.length === 0 ? (
          <div className="glass-strong rounded-3xl p-8 text-center shadow-glass">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-br from-[#007AFF]/15 to-[#5AC8FA]/15 flex items-center justify-center mb-3">
              <span className="text-3xl">🗓️</span>
            </div>
            <p className="text-sf-subhead font-semibold text-[#1C1C1E]">{t.dashNoBirthdays}</p>
            <p className="text-sf-caption text-[#8E8E93] mt-1">
              {withDates === 0
                ? t.birthdaysNoData
                : t.dashNoBirthdaysHint}
            </p>
          </div>
        ) : (
          <AnimatePresence>
            {groups.map((group, gi) => (
              <motion.div
                key={group.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: gi * 0.04, duration: 0.35 }}
                className="glass-strong rounded-3xl p-4 shadow-glass"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#007AFF]/15 to-[#5AC8FA]/15 flex items-center justify-center">
                    <span className="text-sm">📅</span>
                  </div>
                  <h3 className="text-sf-subhead font-bold text-[#1C1C1E]">{group.label}</h3>
                  <span className="text-[11px] text-[#8E8E93] ml-auto font-medium">
                    {group.items.length}
                  </span>
                </div>
                <div className="space-y-1">
                  {group.items.map((e, i) => (
                    <BirthdayRow
                      key={`${e.member.id}-${e.calendar}-${i}`}
                      entry={e} lang={lang} t={t}
                      onClick={() => { setSelectedMemberId(e.member.id); navigate('/tree') }}
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

function BirthdayRow({
  entry, lang, t, onClick,
}: {
  entry: BirthdayEntry; lang: 'he' | 'en'; t: Translations; onClick: () => void
}) {
  const { member, daysUntil, nextDate, calendar, turning } = entry
  const badge =
    daysUntil === 0
      ? { bg: 'bg-[#FF3B30]/12', text: 'text-[#FF3B30]', label: '🎉' }
      : daysUntil <= 7
      ? { bg: 'bg-[#32ADE6]/12', text: 'text-[#32ADE6]', label: `+${daysUntil}` }
      : { bg: 'bg-[#34C759]/12', text: 'text-[#34C759]', label: `+${daysUntil}` }

  const dateLabel = nextDate.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', {
    month: 'long', day: 'numeric',
  })

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-[#F2F2F7] transition text-start"
    >
      <div className="rounded-full flex-shrink-0" style={{ padding: 2, background: getRingGradient(member) }}>
        <div className="rounded-full bg-white p-[1.5px]">
          <div className="w-10 h-10 rounded-full overflow-hidden">
            {member.photo_url ? (
              <img src={member.photo_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(member)} flex items-center justify-center`}>
                <PersonAvatarIcon gender={member.gender} size={40} />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sf-subhead font-semibold text-[#1C1C1E] truncate">
          {member.first_name} {member.last_name}
        </p>
        <p className="text-[11px] text-[#8E8E93] truncate">
          {calendar === 'hebrew' && member.hebrew_birth_date ? member.hebrew_birth_date : dateLabel}
          {turning !== null && ` · ${t.birthdaysTurning} ${turning}`}
        </p>
      </div>
      <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
    </motion.button>
  )
}
