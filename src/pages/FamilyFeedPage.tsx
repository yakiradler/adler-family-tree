import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import { isAdmin } from '../lib/permissions'
import { displayName } from '../lib/memberName'
import { nextHebrewBirthday } from '../lib/hebrewDate'
import { confirmDialog } from '../lib/confirm'

interface Props { demoMode: boolean }

type FeedItem =
  | { kind: 'status'; id: string; author: string; body: string; at: number; mine: boolean; canDelete: boolean }
  | { kind: 'newMember'; id: string; name: string; at: number }
  | { kind: 'birthday'; id: string; name: string; at: number; inDays: number }

/**
 * The "family network" feed (bottom-nav tab 2). Members post short
 * statuses to the active tree; the feed also weaves in auto updates —
 * newly added relatives and upcoming birthdays — so there's always
 * something to see. Tree-scoped.
 */
export default function FamilyFeedPage(_props: Props) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const {
    profile, members, trees, activeTreeId,
    statuses, fetchStatuses, addStatus, deleteStatus,
  } = useFamilyStore()

  const treeId = activeTreeId ?? trees[0]?.id ?? null
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  // Snapshot "now" once (lazy initializer keeps the memo below pure).
  const [now] = useState(() => Date.now())

  useEffect(() => {
    if (treeId) void fetchStatuses(treeId)
  }, [treeId, fetchStatuses])

  const treeMembers = useMemo(
    () => members.filter((m) => (treeId ? m.tree_id === treeId : true)),
    [members, treeId],
  )

  const items = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = []
    // 1. Posted statuses.
    for (const s of statuses) {
      out.push({
        kind: 'status', id: s.id, author: s.author_name || '—', body: s.body,
        at: new Date(s.created_at).getTime(),
        mine: !!profile && s.author_id === profile.id,
        canDelete: (!!profile && s.author_id === profile.id) || isAdmin(profile),
      })
    }
    // 2. Recently added relatives (last 30 days).
    const monthAgo = now - 30 * 86400000
    for (const m of treeMembers) {
      const created = m.created_at ? new Date(m.created_at).getTime() : 0
      if (created && created >= monthAgo) {
        out.push({ kind: 'newMember', id: `nm-${m.id}`, name: displayName(m, lang), at: created })
      }
    }
    // 3. Upcoming birthdays (next 21 days, by the real Hebrew anniversary).
    const today = new Date(now); today.setHours(0, 0, 0, 0)
    for (const m of treeMembers) {
      if (m.death_date || !m.birth_date) continue
      const heb = nextHebrewBirthday(m.birth_date, today)
      if (!heb) continue
      const inDays = Math.round((heb.nextDate.getTime() - today.getTime()) / 86400000)
      if (inDays >= 0 && inDays <= 21) {
        out.push({ kind: 'birthday', id: `bd-${m.id}`, name: displayName(m, lang), at: heb.nextDate.getTime(), inDays })
      }
    }
    // Newest first; birthdays sort by soonest (their `at` is a future date,
    // so they naturally float to the top — fine for a "what's coming" feel).
    return out.sort((a, b) => b.at - a.at)
  }, [statuses, treeMembers, profile, lang, now])

  const post = async () => {
    if (!draft.trim() || posting || !treeId) return
    setPosting(true)
    try {
      const ok = await addStatus(treeId, draft)
      if (ok) setDraft('')
    } finally { setPosting(false) }
  }

  const remove = async (id: string) => {
    if (await confirmDialog({ message: t.feedDeleteConfirm, danger: true })) await deleteStatus(id)
  }

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="min-h-screen bg-mesh-gradient pb-24">
      <div className="max-w-lg mx-auto px-4 pt-4">
        <header className="flex items-center justify-between mb-4">
          <h1 className="text-sf-title2 font-bold text-[#1C1C1E]">🌐 {t.feedTitle}</h1>
        </header>

        {!treeId ? (
          <div className="glass-strong rounded-3xl p-6 text-center">
            <p className="text-sf-subhead font-semibold text-[#1C1C1E]">{t.feedNoTreeTitle}</p>
            <p className="text-[12px] text-[#8E8E93] mt-1">{t.feedNoTreeHint}</p>
          </div>
        ) : (
          <>
            {/* Composer */}
            <div className="glass-strong rounded-3xl p-3 mb-4 shadow-glass">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t.feedComposePlaceholder}
                rows={2}
                className="w-full bg-[#F2F2F7] rounded-2xl px-3.5 py-2.5 text-[13px] text-[#1C1C1E] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]/40 resize-none"
              />
              <div className="flex justify-end mt-2">
                <button type="button" onClick={post} disabled={!draft.trim() || posting}
                  className="px-5 py-2 rounded-2xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-[13px] font-bold disabled:opacity-40 active:scale-[0.98] transition">
                  {posting ? '…' : t.feedPost}
                </button>
              </div>
            </div>

            {/* Feed */}
            {items.length === 0 ? (
              <div className="glass rounded-3xl p-6 text-center">
                <p className="text-[13px] text-[#8E8E93]">{t.feedEmpty}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <AnimatePresence initial={false}>
                  {items.map((it) => (
                    <motion.div
                      key={it.id}
                      layout
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="glass-strong rounded-2xl p-3.5 shadow-glass-sm"
                    >
                      {it.kind === 'status' ? (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-bold text-[#1C1C1E]">{it.author}</span>
                            <span className="text-[10px] text-[#8E8E93]">{timeAgo(it.at, lang)}</span>
                          </div>
                          <p className="text-[13px] text-[#3C3C43] mt-1 whitespace-pre-wrap leading-relaxed">{it.body}</p>
                          {it.canDelete && (
                            <button type="button" onClick={() => remove(it.id)}
                              className="text-[11px] text-[#FF3B30] font-semibold mt-1.5">{t.feedDelete}</button>
                          )}
                        </>
                      ) : it.kind === 'newMember' ? (
                        <p className="text-[13px] text-[#1C1C1E]">
                          <span aria-hidden>🌱 </span>
                          <span className="font-semibold">{it.name}</span> {t.feedJoined}
                          <span className="block text-[10px] text-[#8E8E93] mt-0.5">{timeAgo(it.at, lang)}</span>
                        </p>
                      ) : (
                        <p className="text-[13px] text-[#1C1C1E]">
                          <span aria-hidden>🎂 </span>
                          <span className="font-semibold">{it.name}</span>{' '}
                          {it.inDays === 0 ? t.feedBirthdayToday : t.feedBirthdayIn.replace('{days}', String(it.inDays))}
                        </p>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function timeAgo(ms: number, lang: 'he' | 'en'): string {
  const diff = Date.now() - ms
  const day = 86400000
  if (diff < 3600000) return lang === 'he' ? 'הרגע' : 'just now'
  if (diff < day) { const h = Math.floor(diff / 3600000); return lang === 'he' ? `לפני ${h} שעות` : `${h}h ago` }
  const d = Math.floor(diff / day)
  if (d <= 30) return lang === 'he' ? `לפני ${d} ימים` : `${d}d ago`
  return new Date(ms).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { day: 'numeric', month: 'short' })
}
