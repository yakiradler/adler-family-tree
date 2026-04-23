import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang } from '../../i18n/useT'
import { Avatar } from '../MemberCard'
import type { Member } from '../../types'

interface TimelineEvent {
  year: number
  month?: number
  day?: number
  type: 'birth' | 'death'
  member: Member
  label: string
  description: string
}

export default function TimelineView() {
  const { members, relationships, setSelectedMemberId } = useFamilyStore()
  const { t, lang } = useLang()

  const events = useMemo<TimelineEvent[]>(() => {
    const evts: TimelineEvent[] = []
    members.forEach((m) => {
      if (m.birth_date) {
        const d = new Date(m.birth_date)
        evts.push({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), type: 'birth', member: m, label: `${m.first_name} ${m.last_name} ${t.eventBorn}`, description: m.bio ?? '' })
      }
      if (m.death_date) {
        const d = new Date(m.death_date)
        evts.push({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), type: 'death', member: m, label: `${m.first_name} ${m.last_name} ${t.eventDied}`, description: '' })
      }
    })
    return evts.sort((a, b) => a.year - b.year || (a.month ?? 0) - (b.month ?? 0))
  }, [members, relationships, t])

  if (events.length === 0) {
    return <div className="flex items-center justify-center h-full pt-20 text-[#8E8E93] text-sf-subhead px-6 text-center">{t.timelineEmpty}</div>
  }

  let lastYear = 0

  return (
    <div className="px-5 pt-6 pb-4">
      <div className="relative">
        <div className="absolute left-[28px] top-0 bottom-0 w-px bg-gradient-to-b from-[#007AFF]/40 via-[#5856D6]/30 to-transparent" />
        <div className="space-y-1">
          {events.map((evt, i) => {
            const showYear = evt.year !== lastYear
            lastYear = evt.year
            return (
              <motion.div key={`${evt.member.id}-${evt.type}`}>
                {showYear && (
                  <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.3 }}
                    className="flex items-center gap-3 py-3">
                    <div className="w-14 flex-shrink-0 flex items-center justify-center">
                      <span className="text-sf-headline font-bold text-[#1C1C1E]">{evt.year}</span>
                    </div>
                  </motion.div>
                )}
                <motion.button onClick={() => setSelectedMemberId(evt.member.id)}
                  initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 + 0.02, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ x: 2 }} whileTap={{ scale: 0.98 }}
                  className="flex items-start gap-4 py-2 pl-0 w-full text-left group">
                  <div className="relative flex-shrink-0 w-14 flex items-start justify-center pt-1">
                    <div className={`w-3 h-3 rounded-full border-2 border-white shadow-sm transition-transform group-hover:scale-125 ${
                      evt.type === 'birth' ? 'bg-[#34C759]' : 'bg-[#8E8E93]'
                    }`} />
                  </div>
                  <div className="flex-1 glass rounded-2xl p-3 pr-4 flex items-center gap-3 shadow-glass-sm group-hover:shadow-glass transition-shadow">
                    <Avatar member={evt.member} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sf-subhead font-semibold text-[#1C1C1E] leading-tight">{evt.label}</p>
                      {evt.month !== undefined && (
                        <p className="text-sf-caption text-[#8E8E93] mt-0.5">
                          {new Date(evt.year, evt.month, evt.day).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { month: 'long', day: 'numeric' })}
                        </p>
                      )}
                      {evt.description && <p className="text-sf-caption text-[#636366] mt-1 line-clamp-2">{evt.description}</p>}
                    </div>
                    <EventIcon type={evt.type} />
                  </div>
                </motion.button>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function EventIcon({ type }: { type: 'birth' | 'death' }) {
  if (type === 'birth') {
    return (
      <div className="w-7 h-7 rounded-full bg-[#34C759]/10 flex items-center justify-center flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 2v10M2 7h10" stroke="#34C759" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    )
  }
  return (
    <div className="w-7 h-7 rounded-full bg-[#8E8E93]/10 flex items-center justify-center flex-shrink-0">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 4v3l2 2" stroke="#8E8E93" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="7" r="5" stroke="#8E8E93" strokeWidth="1.2" />
      </svg>
    </div>
  )
}
