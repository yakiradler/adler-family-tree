import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang, isRTL } from '../../i18n/useT'

/**
 * Global upsell toast. The store's addMember/addTree plan gates fire a
 * `ft-plan-gate` window event when a limit blocks the action; this
 * listener (mounted once inside the router) surfaces it with a link to
 * the pricing page. Auto-dismisses after a few seconds.
 */
export default function PlanGateToast() {
  const navigate = useNavigate()
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const [kind, setKind] = useState<'members' | 'trees' | null>(null)

  useEffect(() => {
    let timer = 0
    const onGate = (e: Event) => {
      const detail = (e as CustomEvent<{ kind?: 'members' | 'trees' }>).detail
      setKind(detail?.kind ?? 'members')
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setKind(null), 7000)
    }
    window.addEventListener('ft-plan-gate', onGate)
    return () => {
      window.removeEventListener('ft-plan-gate', onGate)
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <AnimatePresence>
      {kind && (
        <div className="fixed inset-x-0 top-14 z-[120] flex justify-center px-4 pointer-events-none" dir={rtl ? 'rtl' : 'ltr'}>
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto max-w-sm w-full rounded-2xl bg-white shadow-glass-lg border border-black/5 p-3.5 flex items-start gap-2.5"
          >
            <span className="text-lg leading-none mt-0.5" aria-hidden>🌳</span>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] text-[#3C3C43] leading-snug">
                {kind === 'members' ? t.planGateMembers : t.planGateTrees}
              </p>
              <button
                type="button"
                onClick={() => { setKind(null); navigate('/pricing') }}
                className="mt-1.5 text-[12px] font-bold text-[#007AFF]"
              >
                {t.planGateCta}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setKind(null)}
              aria-label={t.faqClose}
              className="w-6 h-6 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#636366] flex-shrink-0"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M2 2L10 10M10 2L2 10" stroke="#636366" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
