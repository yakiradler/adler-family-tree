import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import { isAdmin } from '../lib/permissions'
import { displayName } from '../lib/memberName'
import { nextHebrewBirthday } from '../lib/hebrewDate'
import { confirmDialog } from '../lib/confirm'
import { uploadStatusMedia, type StatusMedia } from '../lib/photoUpload'
import { downloadStatusMedia } from '../lib/downloadMedia'
import ActionsMenu, { type ActionItem } from '../components/ui/ActionsMenu'

interface Props { demoMode: boolean }

type FeedItem =
  | { kind: 'status'; id: string; author: string; body: string; media: StatusMedia[]; at: number; mine: boolean; canDelete: boolean }
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
    profile, members, trees, activeTreeId, myTreeRoles,
    statuses, fetchStatuses, addStatus, deleteStatus,
  } = useFamilyStore()

  const treeId = activeTreeId ?? trees[0]?.id ?? null
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [media, setMedia] = useState<StatusMedia[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
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
        media: s.media ?? [],
        at: new Date(s.created_at).getTime(),
        mine: !!profile && s.author_id === profile.id,
        // Only the uploader, the tree owner, or an admin may remove a post.
        canDelete: (!!profile && s.author_id === profile.id)
          || myTreeRoles[s.tree_id] === 'owner'
          || isAdmin(profile),
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
  }, [statuses, treeMembers, profile, lang, now, myTreeRoles])

  const pickMedia = async (files: FileList | null) => {
    if (!files || files.length === 0 || !treeId) return
    setUploading(true)
    try {
      const picked: StatusMedia[] = []
      for (const file of Array.from(files).slice(0, 4)) {
        const m = await uploadStatusMedia(file, treeId)
        if (m) picked.push(m)
        else if (file.type.startsWith('video/')) await confirmDialog({ message: t.feedVideoTooBig, danger: false })
      }
      if (picked.length) setMedia((prev) => [...prev, ...picked].slice(0, 4))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const post = async () => {
    if ((!draft.trim() && media.length === 0) || posting || !treeId) return
    setPosting(true)
    try {
      const ok = await addStatus(treeId, draft, media)
      if (ok) { setDraft(''); setMedia([]) }
    } finally { setPosting(false) }
  }

  const remove = async (id: string) => {
    if (await confirmDialog({ message: t.feedDeleteConfirm, danger: true })) await deleteStatus(id)
  }

  // Build the ⋯ menu for a status: download (when it has media) + delete
  // (only for the uploader / tree owner / admin). Phase 3 adds the
  // "who can view" / "hide from" items here.
  const statusMenuItems = (it: Extract<FeedItem, { kind: 'status' }>): ActionItem[] => {
    const out: ActionItem[] = []
    if (it.media.length > 0) {
      out.push({
        key: 'download',
        label: t.feedDownload,
        icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 2v8M4 7l3.5 3.5L11 7M3 12.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
        onSelect: () => void downloadStatusMedia(it.media),
      })
    }
    if (it.canDelete) {
      out.push({
        key: 'delete',
        label: t.feedDelete,
        danger: true,
        icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 4h9M5.5 4V2.5h4V4M4.5 4v8h6V4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
        onSelect: () => void remove(it.id),
      })
    }
    return out
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
              {/* Picked media previews */}
              {media.length > 0 && (
                <div className="grid grid-cols-4 gap-1.5 mt-2">
                  {media.map((m, i) => (
                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-black/5">
                      {m.type === 'video'
                        ? <video src={m.url} className="w-full h-full object-cover" muted />
                        : <img src={m.url} alt="" className="w-full h-full object-cover" />}
                      <button type="button" onClick={() => setMedia((p) => p.filter((_, j) => j !== i))}
                        className="absolute top-0.5 end-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-[11px] flex items-center justify-center">×</button>
                      {m.type === 'video' && <span className="absolute bottom-0.5 start-0.5 text-[10px]">🎬</span>}
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => void pickMedia(e.target.files)}
              />
              <div className="flex items-center justify-between mt-2">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading || media.length >= 4}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-[13px] font-semibold disabled:opacity-40 active:scale-95 transition">
                  <span aria-hidden>🖼️</span> {uploading ? t.feedUploading : t.feedAddMedia}
                </button>
                <button type="button" onClick={post} disabled={(!draft.trim() && media.length === 0) || posting || uploading}
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
                      className="glass-strong rounded-2xl p-3.5 shadow-glass-sm overflow-hidden"
                    >
                      {it.kind === 'status' ? (
                        <>
                          {/* Instagram-style header */}
                          <div className="flex items-center gap-2.5">
                            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-[#007AFF] to-[#5AC8FA] text-white flex items-center justify-center text-[13px] font-bold flex-shrink-0">
                              {it.author.trim().charAt(0) || '·'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-bold text-[#1C1C1E] truncate leading-tight">{it.author}</p>
                              <p className="text-[10px] text-[#8E8E93] leading-tight">{timeAgo(it.at, lang)}</p>
                            </div>
                            <ActionsMenu ariaLabel={t.feedActions} items={statusMenuItems(it)} />
                          </div>
                          {/* Media — edge-to-edge within the card */}
                          {it.media.length > 0 && (
                            <div className={`-mx-3.5 mt-2.5 ${it.media.length > 1 ? 'grid grid-cols-2 gap-0.5' : ''} bg-black/5`}>
                              {it.media.map((m, i) => (
                                m.type === 'video' ? (
                                  <video key={i} src={m.url} controls playsInline
                                    className={`w-full ${it.media.length === 1 ? 'max-h-[70vh]' : 'aspect-square'} object-cover bg-black`} />
                                ) : (
                                  <img key={i} src={m.url} alt=""
                                    className={`w-full ${it.media.length === 1 ? 'max-h-[70vh]' : 'aspect-square'} object-cover`} />
                                )
                              ))}
                            </div>
                          )}
                          {it.body && (
                            <p className="text-[13px] text-[#3C3C43] mt-2 whitespace-pre-wrap leading-relaxed">{it.body}</p>
                          )}
                          <StatusCommentThread statusId={it.id} canModerate={it.canDelete} />
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

/**
 * Collapsible comment thread under a status. Comments are fetched lazily
 * on first expand (keeps the feed light). Anyone with tree access can
 * comment; a comment can be removed by its author or by whoever can
 * moderate the post (tree owner / admin — passed in as `canModerate`).
 */
function StatusCommentThread({ statusId, canModerate }: { statusId: string; canModerate: boolean }) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const profile = useFamilyStore((s) => s.profile)
  const comments = useFamilyStore((s) => s.statusComments[statusId])
  const { fetchComments, addComment, deleteComment } = useFamilyStore()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const list = comments ?? []
  const count = list.length

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && comments === undefined) void fetchComments(statusId)
  }

  const submit = async () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    try { if (await addComment(statusId, text)) setDraft('') }
    finally { setBusy(false) }
  }

  const removeComment = async (id: string) => {
    if (await confirmDialog({ message: t.feedCommentDeleteConfirm, danger: true })) await deleteComment(id, statusId)
  }

  return (
    <div className="mt-2.5 pt-2 border-t border-black/5">
      <button type="button" onClick={toggle}
        className="flex items-center gap-1 text-[11px] font-semibold text-[#8E8E93] active:scale-95 transition">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M2 3.5h10v6H6l-2.5 2v-2H2v-6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
        {t.feedCommentsToggle}{count > 0 ? ` · ${count}` : ''}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {count === 0 ? (
            <p className="text-[11px] text-[#8E8E93]">{t.feedCommentsNone}</p>
          ) : (
            list.map((c) => {
              const canDel = (!!profile && c.author_id === profile.id) || canModerate
              return (
                <div key={c.id} className="flex items-start gap-2">
                  <span className="w-6 h-6 rounded-full bg-gradient-to-br from-[#8E8E93] to-[#AEAEB2] text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {(c.author_name.trim().charAt(0)) || '·'}
                  </span>
                  <div className="flex-1 min-w-0 bg-[#F2F2F7] rounded-2xl px-3 py-1.5">
                    <p className="text-[11px] font-bold text-[#1C1C1E] leading-tight">
                      {c.author_name || '—'}
                      <span className="ms-1.5 text-[9px] text-[#8E8E93] font-medium">{timeAgo(new Date(c.created_at).getTime(), lang)}</span>
                    </p>
                    <p className="text-[12px] text-[#3C3C43] whitespace-pre-wrap leading-snug">{c.body}</p>
                  </div>
                  {canDel && (
                    <button type="button" onClick={() => void removeComment(c.id)}
                      aria-label={t.feedDelete}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[#8E8E93] hover:text-[#FF3B30] hover:bg-[#FF3B30]/8 transition flex-shrink-0 text-[14px] leading-none">×</button>
                  )}
                </div>
              )
            })
          )}

          {profile && (
            <div className="flex items-center gap-2 pt-0.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
                placeholder={t.feedCommentPlaceholder}
                dir={rtl ? 'rtl' : 'ltr'}
                className="flex-1 min-w-0 bg-[#F2F2F7] rounded-2xl px-3 py-2 text-[12px] text-[#1C1C1E] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]/40"
              />
              <button type="button" onClick={() => void submit()} disabled={!draft.trim() || busy}
                className="px-3 py-2 rounded-2xl bg-[#007AFF] text-white text-[12px] font-bold disabled:opacity-40 active:scale-95 transition flex-shrink-0">
                {busy ? '…' : t.feedComment}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
