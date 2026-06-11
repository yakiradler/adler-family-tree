import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import {
  parseJoinCode, readPendingJoinCode, clearPendingJoinCode, stashPendingJoinCode,
} from '../lib/joinLink'

/**
 * Deep-link landing for external share links: `/#/join?code=ABCDE-12345`.
 *
 * Signed-in → redeem the code once (ref-guarded against StrictMode
 * double-effects) and land on the tree. Signed-out → stash the code in
 * localStorage and bounce through /login; App.tsx's post-auth redirects
 * come back here to finish the job.
 */
export default function JoinPage({ isAuth }: { isAuth: boolean }) {
  const { t, lang } = useLang()
  const dir = isRTL(lang) ? 'rtl' : 'ltr'
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const joinTreeWithCode = useFamilyStore((s) => s.joinTreeWithCode)
  // "failed" only flips from the async redeem callback; the no-code
  // case is derived at render so the effect never sets state directly.
  const [failed, setFailed] = useState(false)
  const startedRef = useRef(false)

  // URL param first; the localStorage stash covers the login round-trip
  // (the hash query is lost on the way through the auth screens).
  const code = parseJoinCode(params.toString() ? `?${params.toString()}` : '')
    ?? readPendingJoinCode()

  useEffect(() => {
    if (startedRef.current || !code) return
    startedRef.current = true
    if (!isAuth) {
      stashPendingJoinCode(code)
      navigate('/login', { replace: true })
      return
    }
    void (async () => {
      const result = await joinTreeWithCode(code)
      clearPendingJoinCode()
      if (result.ok) navigate('/tree', { replace: true })
      else setFailed(true)
    })()
  }, [code, isAuth, joinTreeWithCode, navigate])

  const state: 'joining' | 'invalid' = failed || !code ? 'invalid' : 'joining'

  return (
    <div dir={dir} className="min-h-screen bg-mesh-gradient flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm rounded-3xl bg-white/90 backdrop-blur shadow-2xl p-8 text-center"
      >
        {state === 'joining' ? (
          <>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-9 h-9 mx-auto border-2 border-[#34C759]/25 border-t-[#34C759] rounded-full"
            />
            <p className="mt-4 text-sf-subhead font-semibold text-[#1C1C1E]">
              🌳 {t.joinPageJoining}
            </p>
          </>
        ) : (
          <>
            <div className="w-14 h-14 mx-auto rounded-2xl bg-[#FF9F0A]/15 flex items-center justify-center text-2xl">
              🔑
            </div>
            <p className="mt-3 text-sf-subhead font-bold text-[#1C1C1E]">{t.joinPageInvalid}</p>
            <p className="mt-1.5 text-[12.5px] text-[#636366] leading-relaxed">{t.joinPageInvalidHint}</p>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="mt-5 w-full py-2.5 rounded-2xl bg-[#007AFF] text-white text-sf-subhead font-bold active:scale-[0.98] transition"
            >
              {t.joinPageGoHome}
            </button>
          </>
        )}
      </motion.div>
    </div>
  )
}
