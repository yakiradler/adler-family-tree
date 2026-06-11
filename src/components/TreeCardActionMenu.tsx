import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { isAdmin } from '../lib/permissions'
import { pickPersonalShareInvite } from '../lib/invites'
import { unseenShareCodeIds } from '../lib/notifications'
import { buildJoinUrl } from '../lib/joinLink'
import { fileToIconBlob, fileToDownscaledDataURL, iconStoragePath } from '../lib/imageResize'
import type { TreeInvite } from '../types'

/**
 * Long-press / right-click action sheet for a tree card on the
 * Dashboard.
 *
 * Sharing is role-aware (pilot round 2):
 *   • tree owner / admin → "create share code": mints (or reuses) a
 *     30-day code on the spot and shows it with a copy button — no
 *     more "requesting" a code from yourself.
 *   • everyone else → "request share code" files an access_request;
 *     once approved, a code minted FOR them shows up right here (and
 *     in their notification inbox), so it's always recoverable.
 * The remaining rows stay surfaced with a "coming soon" pill while
 * their backends land.
 */
interface Props {
  open: boolean
  onClose: () => void
  target: { id: string | null; name: string } | null
}

export default function TreeCardActionMenu({ open, onClose, target }: Props) {
  const { t, lang } = useLang()
  const { profile, submitAccessRequest, trees, mintShareCode, updateTree } = useFamilyStore()
  const notifications = useFamilyStore((s) => s.notifications)
  const markNotificationsRead = useFamilyStore((s) => s.markNotificationsRead)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minted, setMinted] = useState<TreeInvite | null>(null)
  const [personal, setPersonal] = useState<TreeInvite | null>(null)
  const [copied, setCopied] = useState(false)
  const [iconBusy, setIconBusy] = useState(false)
  const [iconDone, setIconDone] = useState(false)
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const tree = target?.id ? trees.find((tr) => tr.id === target.id) ?? null : null
  // The implicit main tree (id === null) has no tree_invites row to
  // hang a code on — sharing stays request-only there.
  const canMint = Boolean(
    tree && profile && (isAdmin(profile) || tree.created_by === profile.id),
  )

  // Member opening the menu: surface the code that was minted FOR
  // them (share-code approval flow) and clear the card's red balloon.
  useEffect(() => {
    if (!open || !target?.id || !profile || canMint) return
    const unseen = unseenShareCodeIds(notifications, target.id)
    if (unseen.length > 0) void markNotificationsRead(unseen)
    if (!isSupabaseConfigured) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('tree_invites')
        .select('*')
        .eq('tree_id', target.id)
        .eq('created_for', profile.id)
        .order('created_at', { ascending: false })
        .limit(5)
      if (cancelled) return
      setPersonal(pickPersonalShareInvite((data ?? []) as TreeInvite[], target.id!, profile.id))
    })()
    return () => { cancelled = true }
    // notifications intentionally omitted: re-running on every poll
    // would refetch invites for an open sheet with no visual change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.id, profile?.id, canMint])

  const close = () => {
    setSent(false)
    setError(null)
    setBusy(false)
    setMinted(null)
    setPersonal(null)
    setCopied(false)
    setIconBusy(false)
    setIconDone(false)
    setLinkBusy(false)
    setLinkCopied(false)
    onClose()
  }

  // ── Custom tree icon (owner/admin) ────────────────────────────────
  // Downscale to a 256px square client-side, upload to the public
  // tree-icons bucket, persist the URL on the tree row. Demo mode
  // stores a small data-URI locally instead.
  const onIconFile = async (file: File | null) => {
    if (!file || !target?.id) return
    setIconBusy(true)
    setError(null)
    try {
      if (!isSupabaseConfigured) {
        const dataUrl = await fileToDownscaledDataURL(file)
        await updateTree(target.id, { icon_url: dataUrl })
      } else {
        const { blob, contentType, ext } = await fileToIconBlob(file)
        const path = iconStoragePath(target.id, ext, Date.now())
        const { error: upErr } = await supabase.storage
          .from('tree-icons')
          .upload(path, blob, { contentType })
        if (upErr) throw upErr
        const { data: pub } = supabase.storage.from('tree-icons').getPublicUrl(path)
        if (!pub?.publicUrl) throw new Error('no public url')
        await updateTree(target.id, { icon_url: pub.publicUrl })
      }
      setIconDone(true)
      window.setTimeout(close, 1200)
    } catch (e) {
      console.warn('[tree-icon] upload failed', e)
      setError(t.treeIconFailed)
    } finally {
      setIconBusy(false)
    }
  }

  // ── External share link (owner/admin) ─────────────────────────────
  // Same 30-day code as the direct mint, wrapped in a /#/join URL so
  // one tap covers signup + join.
  const copyShareLink = async () => {
    if (!target?.id) return
    setLinkBusy(true)
    setError(null)
    try {
      const invite = await mintShareCode(target.id)
      if (!invite) throw new Error('mint failed')
      const url = buildJoinUrl(window.location.origin, invite.code)
      try {
        await navigator.clipboard.writeText(url)
      } catch {
        window.prompt(t.treeMenuShareLink, url)
      }
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2500)
    } catch {
      setError(lang === 'he' ? 'יצירת הקישור נכשלה — נסו שוב' : 'Creating the link failed — try again')
    } finally {
      setLinkBusy(false)
    }
  }

  const createShareCode = async () => {
    if (!target?.id) return
    setBusy(true)
    setError(null)
    try {
      const invite = await mintShareCode(target.id)
      if (!invite) {
        throw new Error(lang === 'he' ? 'יצירת הקוד נכשלה — נסו שוב' : 'Creating the code failed — try again')
      }
      setMinted(invite)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const requestShareCode = async () => {
    if (!target || !profile) return
    setBusy(true)
    setError(null)
    try {
      // Reuse the existing access_requests pipeline — the admin's
      // pending-requests list already surfaces these.  We park the
      // intent + target tree in `answers` so the admin can tell at a
      // glance that this is a share-code ask, not a join-tree ask.
      const ok = await submitAccessRequest({
        requested_role: (profile.role as 'user' | 'master' | 'admin' | 'guest') ?? 'user',
        invite_code: null,
        answers: {
          intent: 'request_share_code',
          target_tree_id: target.id,
          target_tree_name: target.name,
          requested_at: new Date().toISOString(),
        },
      })
      if (!ok) throw new Error('request did not reach the server')
      setSent(true)
      window.setTimeout(close, 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      window.prompt(t.notifCopyCode, code)
    }
  }

  const shownCode = minted ?? personal

  return (
    <AnimatePresence>
      {open && target && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/45 backdrop-blur-sm no-print"
          onClick={close}
        >
          <motion.div
            initial={{ y: 60, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-3xl bg-white shadow-2xl overflow-hidden"
          >
            <div className="relative h-20 bg-gradient-to-br from-[#34C759] to-[#007AFF] flex items-center justify-center">
              <span className="text-4xl" aria-hidden>🌳</span>
            </div>

            <div className="px-5 pt-4 pb-5">
              <h2 className="text-sf-title2 font-bold text-[#1C1C1E] text-center">
                {lang === 'he'
                  ? `אפשרויות לעץ "${target.name}"`
                  : `Options for "${target.name}"`}
              </h2>

              {/* The code card — either the one just minted (owner) or
                  the one minted FOR this member on approval. */}
              {shownCode && (
                <div className="mt-4 rounded-2xl bg-[#34C759]/10 border border-[#34C759]/25 p-4 text-center">
                  <p className="text-[12px] font-semibold text-[#1C7C36] mb-2">
                    {minted ? t.treeMenuCodeReady : t.treeMenuYourCode}
                  </p>
                  <button
                    type="button"
                    onClick={() => void copyCode(shownCode.code)}
                    className="inline-flex items-center gap-2 rounded-xl bg-white border border-black/8 px-3.5 py-2 font-mono text-[17px] font-bold tracking-wider text-[#1C1C1E] shadow-sm active:scale-[0.97] transition"
                    dir="ltr"
                  >
                    {shownCode.code}
                    <span className="text-[11px] text-[#007AFF] font-sans font-semibold">
                      {copied ? t.notifCodeCopied : t.notifCopyCode}
                    </span>
                  </button>
                  {shownCode.expires_at && (
                    <p className="text-[11px] text-[#636366] mt-2">
                      {t.treeMenuCodeExpires}{' '}
                      {new Date(shownCode.expires_at).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US')}
                    </p>
                  )}
                </div>
              )}

              {sent ? (
                <div className="mt-5 rounded-2xl bg-[#34C759]/12 p-4 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-[#1C7C36] text-sf-subhead font-bold">
                    <svg width="16" height="16" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6.5l2.5 2.5L9.5 4" stroke="#1C7C36" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t.treeMenuRequestSent}
                  </div>
                  <p className="text-[12px] text-[#3C3C43] mt-1.5">
                    {t.treeMenuRequestSentHint}
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {canMint ? (
                    !minted && (
                      <ActionRow
                        icon="🔑"
                        label={t.treeMenuCreateCode}
                        hint={t.treeMenuCreateCodeHint}
                        onClick={createShareCode}
                        busy={busy}
                      />
                    )
                  ) : (
                    !personal && (
                      <ActionRow
                        icon="🔑"
                        label={t.treeMenuRequestCode}
                        hint={t.treeMenuRequestCodeHint}
                        onClick={requestShareCode}
                        busy={busy}
                      />
                    )
                  )}
                  {canMint ? (
                    <>
                      {/* Hidden file input — the ActionRow proxies to it. */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          void onIconFile(e.target.files?.[0] ?? null)
                          e.target.value = ''
                        }}
                      />
                      <ActionRow
                        icon="🖼️"
                        label={iconDone ? t.treeIconUpdated : t.treeMenuChangeIcon}
                        hint={iconBusy ? t.treeIconUploading : t.treeMenuChangeIconHint}
                        onClick={() => fileInputRef.current?.click()}
                        busy={iconBusy}
                      />
                      <ActionRow
                        icon="🔗"
                        label={linkCopied ? t.treeMenuShareLinkCopied : t.treeMenuShareLink}
                        hint={t.treeMenuShareLinkHint}
                        onClick={copyShareLink}
                        busy={linkBusy}
                      />
                    </>
                  ) : (
                    <>
                      <ActionRow
                        icon="🖼️"
                        label={t.treeMenuChangeIcon}
                        hint={t.treeMenuChangeIconHint}
                        comingSoon
                      />
                      <ActionRow
                        icon="🔗"
                        label={t.treeMenuShareLink}
                        hint={t.treeMenuShareLinkHint}
                        comingSoon
                      />
                    </>
                  )}
                  <ActionRow
                    icon="🌲"
                    label={t.treeMenuDepthLimit}
                    hint={t.treeMenuDepthLimitHint}
                    comingSoon
                  />
                </div>
              )}

              {error && (
                <p className="text-[12px] text-[#FF3B30] mt-3 text-center">
                  {error}
                </p>
              )}

              {!sent && (
                <button
                  type="button"
                  onClick={close}
                  className="mt-4 w-full py-2.5 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold active:scale-[0.98] transition"
                >
                  {t.treeMenuClose}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ActionRow({
  icon, label, hint, onClick, comingSoon, busy,
}: {
  icon: string
  label: string
  hint?: string
  onClick?: () => void
  comingSoon?: boolean
  busy?: boolean
}) {
  const disabled = comingSoon || busy
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={[
        'w-full text-start flex items-center gap-3 px-3 py-2.5 rounded-2xl transition',
        disabled
          ? 'bg-[#F2F2F7] text-[#8E8E93] cursor-not-allowed'
          : 'bg-[#F2F2F7] hover:bg-[#E5E5EA] active:scale-[0.98] text-[#1C1C1E]',
      ].join(' ')}
    >
      <span className="text-xl flex-shrink-0" aria-hidden>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sf-subhead font-semibold leading-tight">
          {label}
        </span>
        {hint && (
          <span className="block text-[11px] text-[#8E8E93] mt-0.5 leading-tight">
            {hint}
          </span>
        )}
      </span>
      {comingSoon && (
        <span className="text-[10px] font-bold text-[#5E5CE6] bg-[#5E5CE6]/12 rounded-full px-2 py-0.5 flex-shrink-0">
          ⏳
        </span>
      )}
      {busy && (
        <span className="text-[11px] text-[#636366] flex-shrink-0">…</span>
      )}
    </button>
  )
}
