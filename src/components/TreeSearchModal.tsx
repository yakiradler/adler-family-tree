import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import { getRingGradient, getFallbackGradient, PersonAvatarIcon } from './MemberNode'
import type { Member } from '../types'

/**
 * Tree-page search modal: a focused, accessible name lookup that the
 * user wanted surfaced as a *standalone* button on the top-bar — the
 * existing search field hidden inside the AdvancedFilter popover wasn't
 * discoverable enough.
 *
 * Behaviour:
 *   - Opens with auto-focused input.
 *   - Live results across first / last / maiden names (case-insensitive,
 *     diacritics-tolerant via `localeCompare`).
 *   - Clicking a result selects the member (so the side panel opens)
 *     and closes the modal.
 *   - Escape and click-outside close.
 */
export default function TreeSearchModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { members, setSelectedMemberId } = useFamilyStore()
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')

  // Reset + focus on each open.
  useEffect(() => {
    if (!open) return
    setQuery('')
    const tid = setTimeout(() => inputRef.current?.focus(), 60)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(tid)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      // No query → show first 12 members alphabetically as a starting set
      // so the panel never looks empty.
      return [...members]
        .sort((a, b) =>
          `${a.first_name} ${a.last_name}`.localeCompare(
            `${b.first_name} ${b.last_name}`,
            lang === 'he' ? 'he' : 'en',
          ),
        )
        .slice(0, 12)
    }
    return members
      .filter((m) => {
        const hay = [
          m.first_name,
          m.last_name,
          (m as Member & { maiden_name?: string }).maiden_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 30)
  }, [members, query, lang])

  const pick = (m: Member) => {
    setSelectedMemberId(m.id)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
          />
          <motion.div
            key="panel"
            role="dialog"
            aria-label={t.treeSearchTitle}
            initial={{ opacity: 0, y: -20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            // Horizontal centering via inset-x-0 + mx-auto sidesteps the
            // `translate-x-1/2` quirk under RTL `dir`, where the translate
            // direction is logical and pushes the panel off-screen.
            className="fixed inset-x-4 top-[12vh] mx-auto z-50 w-[calc(100vw-32px)] max-w-md rounded-3xl bg-white/95 backdrop-blur-2xl border border-white/60 shadow-2xl overflow-hidden"
            dir={rtl ? 'rtl' : 'ltr'}
          >
            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b border-black/5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[18px]" aria-hidden>🔍</span>
                <h2 className="text-sf-headline font-bold text-[#1C1C1E]">
                  {t.treeSearchTitle}
                </h2>
              </div>
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.treeSearchPlaceholder}
                className="w-full bg-[#F2F2F7] rounded-2xl px-4 py-3 text-[14px] text-[#1C1C1E] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]/40 transition"
              />
              <p className="text-[11px] text-[#8E8E93] mt-1.5">
                {t.treeSearchHint}
              </p>
            </div>

            {/* Results */}
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {results.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="text-[36px] mb-2 opacity-50">🌫️</div>
                  <p className="text-sf-subhead text-[#636366] font-medium">
                    {t.treeSearchEmpty}
                  </p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {results.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => pick(m)}
                        className="w-full flex items-center gap-3 px-2.5 py-2 rounded-2xl hover:bg-[#F2F2F7] active:bg-[#E5E5EA] transition text-start"
                      >
                        <Avatar member={m} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-[#1C1C1E] truncate">
                            {m.first_name} {m.last_name}
                          </p>
                          <p className="text-[11px] text-[#8E8E93] truncate">
                            {[
                              m.lineage && m.lineage !== 'israel'
                                ? m.lineage === 'kohen'
                                  ? '👑 ' + (lang === 'he' ? 'כהן' : 'Kohen')
                                  : '🎵 ' + (lang === 'he' ? 'לוי' : 'Levi')
                                : null,
                              m.birth_date
                                ? new Date(m.birth_date).getFullYear()
                                : null,
                              m.death_date ? '🕯️' : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                          className="flex-shrink-0 opacity-40"
                        >
                          <path
                            d={rtl ? 'M9 3L5 7l4 4' : 'M5 3l4 4-4 4'}
                            stroke="#8E8E93"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function Avatar({ member }: { member: Member }) {
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
            <div
              className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(member)} flex items-center justify-center`}
            >
              <PersonAvatarIcon gender={member.gender} size={36} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
