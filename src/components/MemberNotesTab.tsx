import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import type { MemberNote, MemberNoteKind } from '../types'

/**
 * Memories + comments tab inside MemberPanel.
 *
 * Why one tab for both: from the user's perspective "I want to write
 * something on Grandpa's profile" is one action — what they write
 * varies in length. We expose a tiny kind toggle (Comment | Memory)
 * that controls the placeholder + the visual tag, but otherwise both
 * land in the same chronological feed so a guest browsing the profile
 * sees the family's collective remembrance in one place.
 *
 * Write permission: any signed-in user with a profile id. Guests
 * (no profile) see read-only.
 *
 * Delete permission: author OR admin. Edit is intentionally not in
 * v1 — once a memory is posted, others may have already read it; if
 * the user wants to amend, they post a follow-up. Keeps the data
 * model honest.
 */

interface Props {
  memberId: string
}

function formatRelative(iso: string, lang: 'he' | 'en'): string {
  // Cheap relative-time formatter — avoids pulling in date-fns just
  // for this. Falls back to a locale date once we're past a week.
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const min = Math.floor(diff / 60_000)
  const hr = Math.floor(diff / 3_600_000)
  const day = Math.floor(diff / 86_400_000)
  if (lang === 'he') {
    if (min < 1) return 'לפני רגע'
    if (min < 60) return `לפני ${min} דק'`
    if (hr < 24) return `לפני ${hr} שעות`
    if (day < 7) return `לפני ${day} ימים`
    return new Date(iso).toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' })
  }
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (hr < 24) return `${hr} h ago`
  if (day < 7) return `${day} d ago`
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function MemberNotesTab({ memberId }: Props) {
  const { notes, profile, addNote, deleteNote } = useFamilyStore()
  const { t, lang } = useLang()
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<MemberNoteKind>('memory')
  const [posting, setPosting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Filter + sort: newest first. Memoised so typing in the composer
  // doesn't re-derive the entire list.
  const list = useMemo(
    () => notes
      .filter((n) => n.member_id === memberId)
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [notes, memberId],
  )

  const canWrite = !!profile?.id
  const isAdmin = profile?.role === 'admin'

  const post = async () => {
    if (!profile || !body.trim() || posting) return
    setPosting(true)
    try {
      await addNote({
        member_id: memberId,
        author_id: profile.id,
        author_name: profile.full_name || t.notesAuthorAnonymous,
        body: body.trim(),
        kind,
      })
      setBody('')
    } finally {
      setPosting(false)
    }
  }

  const remove = async (id: string) => {
    setConfirmDelete(null)
    await deleteNote(id)
  }

  return (
    <div className="space-y-3">
      {/* Composer — only shown for signed-in users with a profile. */}
      {canWrite ? (
        <div className="bg-[#F2F2F7] rounded-2xl p-2.5 space-y-2">
          {/* Kind toggle — same visual language as the panel's tab bar
              so it feels native rather than a one-off control. */}
          <div className="flex items-center gap-1 bg-white rounded-xl p-0.5">
            {(['memory', 'comment'] as MemberNoteKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-semibold transition-all ${
                  kind === k ? 'bg-[#007AFF]/10 text-[#007AFF]' : 'text-[#8E8E93]'
                }`}
              >
                {k === 'memory' ? t.notesKindMemory : t.notesKindComment}
              </button>
            ))}
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t.notesAddPlaceholder}
            rows={3}
            className="w-full bg-white rounded-xl p-2.5 text-[12px] text-[#1C1C1E] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]/40 resize-none"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={post}
              disabled={!body.trim() || posting}
              className="px-3 py-1.5 rounded-xl bg-[#007AFF] text-white text-[12px] font-bold active:scale-95 transition disabled:opacity-40 disabled:active:scale-100"
            >
              {posting ? '…' : t.notesAddBtn}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center py-2">
          <p className="text-[11px] text-[#8E8E93]">{t.notesLoginToWrite}</p>
        </div>
      )}

      {/* Feed */}
      {list.length === 0 ? (
        <div className="text-center py-6">
          <div className="w-10 h-10 mx-auto rounded-2xl bg-[#F2F2F7] flex items-center justify-center mb-1.5">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h8" stroke="#8E8E93" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-[11px] text-[#8E8E93] px-3 leading-snug">{t.notesNoneYet}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {list.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                lang={lang}
                t={t}
                canDelete={isAdmin || n.author_id === profile?.id}
                onAskDelete={() => setConfirmDelete(n.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Inline delete confirmation — kept simple (no modal) so a quick
          "oh I didn't mean that" is one tap away. */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="bg-[#FF3B30]/10 border border-[#FF3B30]/30 rounded-2xl p-2.5 flex items-center gap-2"
          >
            <p className="flex-1 text-[11px] font-semibold text-[#FF3B30]">{t.notesDeleteConfirm}</p>
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="px-2.5 py-1 rounded-lg bg-white text-[#1C1C1E] text-[11px] font-semibold"
            >
              {/* "Cancel" — reuse existing key to skip another translation. */}
              {t.panelDeleteConfirmNo}
            </button>
            <button
              type="button"
              onClick={() => remove(confirmDelete)}
              className="px-2.5 py-1 rounded-lg bg-[#FF3B30] text-white text-[11px] font-bold"
            >
              {t.notesDelete}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  // ── Inline sub-components ────────────────────────────────────────
  // Helper local to this tab so MemberPanel doesn't need to know
  // about the row's internals.
  function NoteRow({
    note, lang, t, canDelete, onAskDelete,
  }: {
    note: MemberNote
    lang: 'he' | 'en'
    t: { notesKindMemory: string; notesKindComment: string; notesAuthorAnonymous: string; notesDelete: string }
    canDelete: boolean
    onAskDelete: () => void
  }) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -8 }}
        transition={{ duration: 0.18 }}
        className="bg-white border border-black/5 rounded-2xl p-2.5 shadow-sm"
      >
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span
              className={`flex-shrink-0 text-[9px] font-bold rounded-full px-1.5 py-0.5 uppercase tracking-wide ${
                note.kind === 'memory'
                  ? 'bg-[#FFEAB2] text-[#8A5A00]'
                  : 'bg-[#007AFF]/12 text-[#007AFF]'
              }`}
            >
              {note.kind === 'memory' ? t.notesKindMemory : t.notesKindComment}
            </span>
            <span className="text-[11px] font-bold text-[#1C1C1E] truncate">
              {note.author_name || t.notesAuthorAnonymous}
            </span>
          </div>
          <span className="flex-shrink-0 text-[10px] text-[#8E8E93]">
            {formatRelative(note.created_at, lang)}
          </span>
        </div>
        <p className="text-[12px] text-[#1C1C1E] leading-relaxed whitespace-pre-wrap">
          {note.body}
        </p>
        {canDelete && (
          <div className="flex justify-end mt-1.5">
            <button
              type="button"
              onClick={onAskDelete}
              className="text-[10px] text-[#FF3B30] font-semibold hover:underline"
            >
              {t.notesDelete}
            </button>
          </div>
        )}
      </motion.div>
    )
  }
}
