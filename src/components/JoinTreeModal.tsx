import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'

/**
 * Standalone "join an existing tree by invite code" modal. Mirrors step 1
 * of the onboarding wizard's invite-code path but is invokable from
 * anywhere in the app (currently the QuickAccessMenu), so a user who
 * already completed onboarding can still attach themselves to another
 * tree later when someone shares a code.
 *
 * Submits an access_request — the tree's admin reviews and approves,
 * which is what actually grants visibility. We don't touch profiles or
 * activeTreeId here; the admin's approval flow handles that.
 */
export default function JoinTreeModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { t } = useLang()
  const { submitAccessRequest } = useFamilyStore()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const reset = () => {
    setCode('')
    setError(null)
    setSuccess(false)
    setBusy(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = async () => {
    setError(null)
    const trimmed = code.trim()
    if (!trimmed) {
      setError(t.onbInviteInvalid)
      return
    }
    setBusy(true)
    try {
      // Same shape of validation as the wizard step 1.
      const { data } = await supabase
        .from('tree_invites')
        .select('id, expires_at, uses_left')
        .eq('code', trimmed)
        .maybeSingle()
      const valid =
        !!data &&
        (data.expires_at == null || new Date(data.expires_at) > new Date()) &&
        (data.uses_left == null || data.uses_left > 0)
      if (!valid) {
        setError(t.onbInviteInvalid)
        return
      }
      await submitAccessRequest({
        requested_role: 'user',
        invite_code: trimmed,
        answers: { source: 'quick-access-menu' },
      })
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <h2 className="text-sf-title-2 font-semibold text-[#1C1C1E]">
                {t.joinTreeModalTitle}
              </h2>
              <p className="text-[12px] text-[#8E8E93] mt-1.5">
                {t.joinTreeModalDesc}
              </p>

              {success ? (
                <div className="mt-5 rounded-2xl bg-[#34C759]/10 p-4 text-[13px] text-[#1C7C36]">
                  {t.joinTreeModalSuccess}
                </div>
              ) : (
                <div className="mt-5 space-y-2">
                  <label className="text-[11px] text-[#8E8E93] block">
                    {t.onbInviteCodeLabel}
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={t.onbInviteCodePlaceholder}
                    className="w-full px-4 py-2.5 rounded-2xl bg-[#F2F2F7] text-sf-body text-[#1C1C1E] placeholder-[#8E8E93] outline-none focus:ring-2 focus:ring-[var(--accent,#007AFF)] uppercase tracking-wider"
                  />
                  {error && (
                    <p className="text-[11px] text-[#FF3B30]">{error}</p>
                  )}
                </div>
              )}

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="px-4 py-2 rounded-full text-[13px] font-semibold text-[#636366] hover:bg-[#F2F2F7] transition"
                >
                  {success ? '×' : t.joinTreeModalCancel}
                </button>
                {!success && (
                  <button
                    type="button"
                    onClick={submit}
                    disabled={busy || code.trim().length === 0}
                    className="px-4 py-2 rounded-full text-[13px] font-semibold text-white bg-[#007AFF] hover:bg-[#0a6fdb] disabled:bg-[#B0B0B5] transition"
                  >
                    {busy ? '...' : t.joinTreeModalSubmit}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
