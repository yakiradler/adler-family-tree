import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../../lib/supabase'
import { useLang, isRTL } from '../../i18n/useT'

/**
 * Full-screen gate shown when a signed-in session still needs its
 * second factor (AAL1 with a verified TOTP factor → next level AAL2).
 * Rendered by App.tsx INSTEAD of the router, so no protected route can
 * be reached until the code is entered — enforcement lives here, not
 * in the login form.
 */
export default function MfaChallengeGate({ onVerified }: { onVerified: () => void }) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.auth.mfa.listFactors()
      const totp = (data?.totp ?? []).find((f) => f.status === 'verified')
      setFactorId(totp?.id ?? null)
    })()
  }, [])

  const submit = async () => {
    if (!factorId || code.length < 6 || busy) return
    setBusy(true)
    setError(null)
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId })
      if (chErr) throw chErr
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code })
      if (vErr) throw vErr
      onVerified()
    } catch {
      setError(t.mfaCodeWrong)
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    try { await supabase.auth.signOut() } catch { /* ignore */ }
    // App.tsx clears the gate when the session drops.
  }

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="min-h-screen bg-mesh-gradient flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-xs rounded-3xl bg-white shadow-glass-lg p-6 space-y-4 text-center"
      >
        <span className="mx-auto w-12 h-12 rounded-2xl bg-[#34C759]/12 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 15 15" fill="none">
            <path d="M7.5 1.5l5 2v3.6c0 3-2.1 5.6-5 6.4-2.9-.8-5-3.4-5-6.4V3.5l5-2z" stroke="#34C759" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M5.3 7.5l1.5 1.5 2.9-3" stroke="#34C759" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <h1 className="text-sf-headline font-bold text-[#1C1C1E]">{t.mfaGateTitle}</h1>
          <p className="text-[12px] text-[#8E8E93] mt-1 leading-relaxed">{t.mfaGateDesc}</p>
        </div>
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={t.mfaCodePlaceholder}
          className="w-full rounded-2xl bg-[#F2F2F7] px-4 py-3 text-center text-[22px] tracking-[0.4em] font-bold text-[#1C1C1E] outline-none focus:ring-2 focus:ring-[#34C759]/40"
          dir="ltr"
        />
        {error && (
          <p className="text-sf-footnote text-[#FF3B30] bg-[#FF3B30]/8 rounded-lg px-3 py-2">{error}</p>
        )}
        <button
          type="button"
          disabled={code.length < 6 || busy || !factorId}
          onClick={submit}
          className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-[#34C759] to-[#30D158] text-white text-sf-subhead font-bold disabled:opacity-40"
        >
          {busy ? '…' : t.mfaGateSubmit}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="text-[12px] text-[#8E8E93] font-semibold hover:text-[#1C1C1E] transition"
        >
          {t.mfaGateCancel}
        </button>
      </motion.div>
    </div>
  )
}
