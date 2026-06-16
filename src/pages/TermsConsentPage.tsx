import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import BrandMark from '../components/BrandMark'

/**
 * First-login step 1 of 2: terms of service + email-marketing consent.
 * Email only — there is NO SMS channel, stated explicitly. On accept we
 * stamp profiles.terms_accepted_at (+ marketing_consent) and move to the
 * pricing gate. The App.tsx gate keeps the user here until terms are
 * accepted, so this can't be skipped on first login.
 */
export default function TermsConsentPage() {
  const navigate = useNavigate()
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const { profile, updateProfileById } = useFamilyStore()
  const [agree, setAgree] = useState(false)
  const [marketing, setMarketing] = useState(true)
  const [busy, setBusy] = useState(false)

  const accept = async () => {
    if (!agree || !profile || busy) return
    setBusy(true)
    try {
      await updateProfileById(profile.id, {
        terms_accepted_at: new Date().toISOString(),
        marketing_consent: marketing,
      })
      navigate('/pricing', { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="min-h-screen bg-mesh-gradient flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md glass-strong rounded-3xl shadow-glass-lg p-6"
      >
        <div className="flex flex-col items-center text-center mb-4">
          <div className="w-12 h-12 rounded-2xl bg-white shadow ring-1 ring-cyan-100 flex items-center justify-center overflow-hidden mb-2">
            <BrandMark size={48} />
          </div>
          <h1 className="text-sf-title2 font-bold text-[#1C1C1E]">{t.termsTitle}</h1>
          <p className="text-[12.5px] text-[#636366] mt-1 leading-relaxed">{t.termsIntro}</p>
        </div>

        {/* Scrollable terms body */}
        <div className="rounded-2xl bg-white/70 border border-white/60 p-3 max-h-52 overflow-y-auto text-[12px] text-[#3C3C43] leading-relaxed space-y-2">
          <p>{t.termsBody1}</p>
          <p>{t.termsBody2}</p>
          <p>{t.termsBody3}</p>
        </div>

        {/* Consents */}
        <label className="flex items-start gap-2.5 mt-4 cursor-pointer">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-[#007AFF] flex-shrink-0" />
          <span className="text-[12.5px] text-[#1C1C1E] leading-snug">{t.termsAgree}</span>
        </label>
        <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-[#34C759] flex-shrink-0" />
          <span className="text-[12.5px] text-[#1C1C1E] leading-snug">
            {t.termsMarketing}
            <span className="block text-[11px] text-[#8E8E93] mt-0.5">{t.termsNoSms}</span>
          </span>
        </label>

        <button
          type="button"
          onClick={accept}
          disabled={!agree || busy}
          className="mt-5 w-full py-3 rounded-2xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-sf-subhead font-bold disabled:opacity-40 active:scale-[0.98] transition shadow-md"
        >
          {busy ? '…' : t.termsContinue}
        </button>
      </motion.div>
    </div>
  )
}
