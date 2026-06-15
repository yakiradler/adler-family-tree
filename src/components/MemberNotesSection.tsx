import { useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import { fileToDownscaledDataURL } from '../lib/imageResize'
import type { MemberNote, MemberNoteKind } from '../types'

/**
 * "Memories + comments" section that lives at the bottom of every
 * profile (used to be a separate tab; we promoted it to an
 * always-visible block per a direct user request — "memories
 * should appear in the profile, not only when you click memories").
 *
 * Composition:
 *   • Newest-first feed of all notes for this member.
 *   • A tiny "+ הוסף זיכרון / תגובה" link at the bottom that, when
 *     tapped, expands a composer *just above the link*. The user's
 *     mental model is "I want to add something here", so the form
 *     materialises right where they click.
 *   • The composer collapses again on Cancel or after a successful
 *     post, keeping the section unobtrusive when not in use.
 *
 * Write permission: any signed-in user with a profile.
 * Delete permission: the note's author OR admin role.
 *
 * Edit is intentionally not in v1 — once a note is posted others may
 * have already read it; if the user wants to amend they post a
 * follow-up. Keeps the audit trail honest.
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

export default function MemberNotesSection({ memberId }: Props) {
  const { notes, profile, deleteNote } = useFamilyStore()
  const { t, lang } = useLang()
  const [composerOpen, setComposerOpen] = useState(false)
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

  const remove = async (id: string) => {
    setConfirmDelete(null)
    await deleteNote(id)
  }

  return (
    <div className="px-4 pb-3 pt-1">
      {/* Section title — small, lowercase tracking, mirrors the
          existing "biography" / "lineage" labels in the about tab so
          the new block feels like part of the panel's grammar. */}
      <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-2 px-1">
        {t.notesTab}
        {list.length > 0 && (
          <span className="ms-1.5 text-[#C7C7CC] font-normal">
            · {list.length}
          </span>
        )}
      </p>

      {/* Comment box — Facebook/chat style. A rounded "write a comment"
          bubble with the user's avatar sits at the top (above the
          reactions bar) and invites a quick note; tapping it expands the
          full composer (text, photo, memory/comment toggle, send). */}
      {canWrite ? (
        <div className="mb-3">
          <AnimatePresence initial={false} mode="wait">
            {composerOpen ? (
              <motion.div
                key="composer"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <NoteComposer
                  memberId={memberId}
                  onDone={() => setComposerOpen(false)}
                  onCancel={() => setComposerOpen(false)}
                />
              </motion.div>
            ) : (
              <motion.button
                key="bubble"
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setComposerOpen(true)}
                className="w-full flex items-center gap-2 bg-white border border-black/10 rounded-full ps-1.5 pe-3 py-1.5 shadow-sm active:scale-[0.99] transition"
              >
                <span className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 bg-gradient-to-br from-[#007AFF] to-[#32ADE6] flex items-center justify-center text-white text-[11px] font-bold">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (profile?.full_name ?? '?').charAt(0).toUpperCase()
                  )}
                </span>
                <span className="flex-1 text-start text-[12px] text-[#8E8E93] truncate">{t.notesBubblePlaceholder}</span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0" aria-hidden="true">
                  <path d="M2.5 12V14H4.5L13 5.5L11 3.5L2.5 12Z" fill="#007AFF" />
                </svg>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <p className="mb-2 text-center text-[10px] text-[#8E8E93]">{t.notesLoginToWrite}</p>
      )}

      {/* Feed — always rendered (no extra click needed). */}
      {list.length === 0 ? (
        <p className="text-[11px] text-[#8E8E93] px-1 leading-snug">{t.notesNoneYet}</p>
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

      {/* Inline delete confirmation — kept simple (no modal) so a
          quick "oh I didn't mean that" is one tap away. */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="mt-2 bg-[#FF3B30]/10 border border-[#FF3B30]/30 rounded-2xl p-2.5 flex items-center gap-2"
          >
            <p className="flex-1 text-[11px] font-semibold text-[#FF3B30]">{t.notesDeleteConfirm}</p>
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="px-2.5 py-1 rounded-lg bg-white text-[#1C1C1E] text-[11px] font-semibold"
            >
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
}

/**
 * The composer is its own component so it has its own local state
 * (draft body, image, kind toggle) and resets cleanly when the
 * parent unmounts it on collapse.
 */
function NoteComposer({
  memberId,
  onDone,
  onCancel,
}: {
  memberId: string
  onDone: () => void
  onCancel: () => void
}) {
  const { profile, addNote } = useFamilyStore()
  const { t } = useLang()
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<MemberNoteKind>('comment')
  const [posting, setPosting] = useState(false)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onPickImage = async (file: File | undefined) => {
    if (!file) return
    setImageBusy(true)
    try {
      const dataUrl = await fileToDownscaledDataURL(file)
      setImageDataUrl(dataUrl)
    } catch {
      // Silently ignore — user can re-pick.
    } finally {
      setImageBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const post = async () => {
    // Allow an image-only post (no body) so the user can drop a
    // family photo without forcing a caption.
    if (!profile || (!body.trim() && !imageDataUrl) || posting) return
    setPosting(true)
    try {
      await addNote({
        member_id: memberId,
        author_id: profile.id,
        author_name: profile.full_name || t.notesAuthorAnonymous,
        body: body.trim(),
        kind,
        image_url: imageDataUrl,
      })
      setBody('')
      setImageDataUrl(null)
      onDone()
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="bg-[#F2F2F7] rounded-2xl p-2.5 space-y-2">
      {/* Kind toggle — same visual language as the panel's tab bar
          so it reads as part of the same UI family. */}
      <div className="flex items-center gap-1 bg-white rounded-xl p-0.5">
        {(['comment', 'memory'] as MemberNoteKind[]).map((k) => (
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
        autoFocus
        className="w-full bg-white rounded-xl p-2.5 text-[12px] text-[#1C1C1E] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]/40 resize-none"
      />

      {/* Image preview — shown only when one has been picked. */}
      {imageDataUrl && (
        <div className="relative rounded-xl overflow-hidden bg-white">
          <img
            src={imageDataUrl}
            alt=""
            className="block w-full max-h-48 object-cover"
          />
          <button
            type="button"
            onClick={() => setImageDataUrl(null)}
            aria-label={t.notesImageRemove}
            title={t.notesImageRemove}
            className="absolute top-1.5 end-1.5 w-7 h-7 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center transition"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPickImage(e.target.files?.[0])}
      />

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={imageBusy || posting}
          aria-label={t.notesImageAdd}
          title={t.notesImageAdd}
          className="w-9 h-9 rounded-xl bg-white text-[#007AFF] active:scale-95 transition disabled:opacity-50 flex items-center justify-center"
        >
          {imageBusy ? (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <rect x="2.5" y="5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
              <path d="M7 5l1.5-2h3L13 5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              <circle cx="10" cy="11" r="3" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          )}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={posting}
            className="px-2.5 py-1.5 rounded-xl text-[#636366] text-[12px] font-semibold disabled:opacity-50"
          >
            {t.notesComposerCancel}
          </button>
          <button
            type="button"
            onClick={post}
            disabled={(!body.trim() && !imageDataUrl) || posting}
            className="px-3 py-1.5 rounded-xl bg-[#007AFF] text-white text-[12px] font-bold active:scale-95 transition disabled:opacity-40 disabled:active:scale-100"
          >
            {posting ? '…' : t.notesAddBtn}
          </button>
        </div>
      </div>
    </div>
  )
}

function NoteRow({
  note, lang, t, canDelete, onAskDelete,
}: {
  note: MemberNote
  lang: 'he' | 'en'
  t: { notesKindMemory: string; notesKindComment: string; notesAuthorAnonymous: string; notesDelete: string; notesPendingApproval: string }
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
          {note.status === 'pending' && (
            <span className="flex-shrink-0 text-[9px] font-bold rounded-full px-1.5 py-0.5 bg-[#FF9F0A]/15 text-[#B25F00]">
              {t.notesPendingApproval}
            </span>
          )}
          <span className="text-[11px] font-bold text-[#1C1C1E] truncate">
            {note.author_name || t.notesAuthorAnonymous}
          </span>
        </div>
        <span className="flex-shrink-0 text-[10px] text-[#8E8E93]">
          {formatRelative(note.created_at, lang)}
        </span>
      </div>
      {note.body && (
        <p className="text-[12px] text-[#1C1C1E] leading-relaxed whitespace-pre-wrap">
          {note.body}
        </p>
      )}
      {note.image_url && (
        <button
          type="button"
          onClick={() => window.open(note.image_url ?? '', '_blank', 'noopener,noreferrer')}
          className={`block w-full rounded-xl overflow-hidden bg-[#F2F2F7] active:scale-[0.98] transition ${note.body ? 'mt-2' : ''}`}
          aria-label="open image"
        >
          <img
            src={note.image_url}
            alt=""
            loading="lazy"
            className="block w-full max-h-56 object-cover"
          />
        </button>
      )}
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
