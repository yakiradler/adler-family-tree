import { useState } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../../lib/supabase'
import { useLang, isRTL } from '../../i18n/useT'

/**
 * Set-a-new-password screen. Rendered by App.tsx instead of the router
 * when the session arrived through a password-recovery link (the
 * PASSWORD_RECOVERY auth event) — the user lands here straight from
 * the email and chooses a fresh password.
 */
export default function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async () => {
    setError(null)
    if (pass1.length < 8) {
      setError(t.resetTooShort)
      return
    }
    if (pass1 !== pass2) {
      setError(t.resetMismatch)
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pass1 })
      if (error) throw error
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="min-h-screen bg-mesh-gradient flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-xs rounded-3xl bg-white shadow-glass-lg p-6 space-y-4 text-center"
      >
        {done ? (
          <>
            <span className="mx-auto w-12 h-12 rounded-2xl bg-[#34C759]/12 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#34C759" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h1 className="text-sf-headline font-bold text-[#1C1C1E]">{t.resetDone}</h1>
            <button
              type="button"
              onClick={onDone}
              className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-sf-subhead font-bold"
            >
              {t.resetContinue}
            </button>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-sf-headline font-bold text-[#1C1C1E]">{t.resetTitle}</h1>
              <p className="text-[12px] text-[#8E8E93] mt-1 leading-relaxed">{t.resetDesc}</p>
            </div>
            <input
              autoFocus
              type="password"
              autoComplete="new-password"
              value={pass1}
              onChange={(e) => setPass1(e.target.value)}
              placeholder={t.resetNewPassword}
              className="input-field"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={pass2}
              onChange={(e) => setPass2(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={t.resetConfirmPassword}
              className="input-field"
            />
            {error && (
              <p className="text-sf-footnote text-[#FF3B30] bg-[#FF3B30]/8 rounded-lg px-3 py-2">{error}</p>
            )}
            <button
              type="button"
              disabled={busy || !pass1 || !pass2}
              onClick={submit}
              className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-sf-subhead font-bold disabled:opacity-40"
            >
              {busy ? '…' : t.resetSubmit}
            </button>
          </>
        )}
      </motion.div>
    </div>
  )
}
