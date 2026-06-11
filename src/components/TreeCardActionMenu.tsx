import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'

/**
 * Long-press / right-click action sheet for a tree card on the
 * Dashboard.  The only action that's actually wired today is
 * "request share code" — it files an access_request with an
 * `intent: 'request_share_code'` marker that the admin can act on by
 * minting a tree_invites code via InviteCodeManager.  The other rows
 * stay surfaced (with a "coming soon" pill) so the affordance is
 * discoverable while the backend lands.
 */
interface Props {
  open: boolean
  onClose: () => void
  target: { id: string | null; name: string } | null
}

export default function TreeCardActionMenu({ open, onClose, target }: Props) {
  const { t, lang } = useLang()
  const { profile, submitAccessRequest } = useFamilyStore()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setSent(false)
    setError(null)
    setBusy(false)
    onClose()
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
                  <ActionRow
                    icon="🔑"
                    label={t.treeMenuRequestCode}
                    hint={t.treeMenuRequestCodeHint}
                    onClick={requestShareCode}
                    busy={busy}
                  />
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
