import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Factor } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../../lib/supabase'
import { useLang, isRTL } from '../../i18n/useT'
import { useCloseOnBack } from '../../hooks/useCloseOnBack'

/**
 * Account-security modal — opt-in TOTP two-factor (owner request:
 * "authenticator verification, only for whoever chooses to secure
 * their account"). Wraps Supabase's native MFA API:
 *
 *   enroll → QR + manual secret → user scans with any authenticator
 *   app → enters the 6-digit code → factor verified. From then on,
 *   every password login is held at the MfaChallengeGate (App.tsx)
 *   until a fresh code is entered.
 *
 * Demo mode renders an explanatory placeholder — there's no backend
 * to enroll against.
 */
type Stage = 'list' | 'enroll' | 'verify'

export default function SecuritySettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const [stage, setStage] = useState<Stage>('list')
  const [factors, setFactors] = useState<Factor[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enrollData, setEnrollData] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')

  useCloseOnBack(open, onClose)

  // Reset the wizard each time the modal opens — adjusted during
  // render (react-hooks v7 forbids sync setState inside effects).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setStage('list')
      setError(null)
      setCode('')
      setEnrollData(null)
    }
  }

  // Load verified factors on open; sweep stale UNVERIFIED leftovers
  // from abandoned enrollments so they don't block a fresh enroll.
  useEffect(() => {
    if (!open || !isSupabaseConfigured) return
    ;(async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase.auth.mfa.listFactors()
        if (error) throw error
        const all = data?.all ?? []
        for (const f of all) {
          if (f.status === 'unverified') {
            try { await supabase.auth.mfa.unenroll({ factorId: f.id }) } catch { /* stale — ignore */ }
          }
        }
        setFactors(all.filter((f) => f.status === 'verified'))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'error')
      } finally {
        setLoading(false)
      }
    })()
  }, [open])

  const startEnroll = async () => {
    setError(null)
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator' })
      if (error) throw error
      if (!data) throw new Error('enroll failed')
      const totp = (data as unknown as { totp: { qr_code: string; secret: string } }).totp
      setEnrollData({ id: data.id, qr: totp.qr_code, secret: totp.secret })
      setStage('enroll')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error')
    } finally {
      setLoading(false)
    }
  }

  const verifyEnrollment = async () => {
    if (!enrollData || code.trim().length < 6) return
    setError(null)
    setLoading(true)
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enrollData.id })
      if (chErr) throw chErr
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: enrollData.id,
        challengeId: ch.id,
        code: code.trim(),
      })
      if (vErr) throw vErr
      const { data } = await supabase.auth.mfa.listFactors()
      setFactors((data?.all ?? []).filter((f) => f.status === 'verified'))
      setEnrollData(null)
      setCode('')
      setStage('list')
    } catch {
      setError(t.mfaCodeWrong)
    } finally {
      setLoading(false)
    }
  }

  const disable = async (factorId: string) => {
    if (!window.confirm(t.mfaDisableConfirm)) return
    setLoading(true)
    setError(null)
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId })
      if (error) throw error
      setFactors((fs) => fs.filter((f) => f.id !== factorId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          dir={rtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm max-h-[min(640px,calc(100vh-48px))] overflow-y-auto rounded-3xl bg-white shadow-glass-lg p-5 space-y-4"
          >
            <header className="flex items-center justify-between">
              <h2 className="text-sf-headline font-bold text-[#1C1C1E] flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-[#34C759]/12 flex items-center justify-center">
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path d="M7.5 1.5l5 2v3.6c0 3-2.1 5.6-5 6.4-2.9-.8-5-3.4-5-6.4V3.5l5-2z" stroke="#34C759" strokeWidth="1.4" strokeLinejoin="round" />
                    <path d="M5.3 7.5l1.5 1.5 2.9-3" stroke="#34C759" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {t.securityTitle}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={t.faqClose}
                className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#636366] active:scale-95 transition"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2L10 10M10 2L2 10" stroke="#636366" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            {!isSupabaseConfigured ? (
              <p className="text-[12.5px] text-[#8E8E93] leading-relaxed">{t.securityDemoNote}</p>
            ) : stage === 'list' ? (
              <>
                <p className="text-[12.5px] text-[#636366] leading-relaxed">{t.mfaIntro}</p>
                {factors.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-2xl bg-[#34C759]/8 px-3.5 py-3">
                      <span className="w-2 h-2 rounded-full bg-[#34C759]" aria-hidden />
                      <span className="text-[13px] font-semibold text-[#1C1C1E]">{t.mfaEnabled}</span>
                    </div>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => disable(factors[0].id)}
                      className="w-full py-2.5 rounded-2xl bg-[#FF3B30]/10 text-[#FF3B30] text-sf-subhead font-bold disabled:opacity-40"
                    >
                      {t.mfaDisable}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={startEnroll}
                    className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-[#34C759] to-[#30D158] text-white text-sf-subhead font-bold disabled:opacity-40"
                  >
                    {loading ? '…' : t.mfaEnable}
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="text-[12.5px] text-[#636366] leading-relaxed">{t.mfaScanQr}</p>
                {enrollData && (
                  <div className="flex flex-col items-center gap-3">
                    <img
                      src={`data:image/svg+xml;utf8,${encodeURIComponent(enrollData.qr)}`}
                      alt="QR"
                      className="w-44 h-44 rounded-2xl border border-black/8 bg-white"
                    />
                    <p className="text-[10.5px] text-[#8E8E93] text-center break-all px-2" dir="ltr">
                      {t.mfaManualKey}: <span className="font-mono">{enrollData.secret}</span>
                    </p>
                  </div>
                )}
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder={t.mfaCodePlaceholder}
                  className="w-full rounded-2xl bg-[#F2F2F7] px-4 py-3 text-center text-[20px] tracking-[0.4em] font-bold text-[#1C1C1E] outline-none focus:ring-2 focus:ring-[#34C759]/40"
                  dir="ltr"
                />
                <button
                  type="button"
                  disabled={code.length < 6 || loading}
                  onClick={verifyEnrollment}
                  className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-[#34C759] to-[#30D158] text-white text-sf-subhead font-bold disabled:opacity-40"
                >
                  {loading ? '…' : t.mfaVerifyAndEnable}
                </button>
              </>
            )}

            {error && (
              <p className="text-sf-footnote text-[#FF3B30] bg-[#FF3B30]/8 rounded-lg px-3 py-2">{error}</p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
