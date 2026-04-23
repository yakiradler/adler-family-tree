import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useLang } from '../i18n/useT'

type AuthMode = 'login' | 'signup'

interface Props { demoMode?: boolean }

export default function Auth({ demoMode = false }: Props) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const { t, lang, toggleLang } = useLang()

  const dir = lang === 'he' ? 'rtl' : 'ltr'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      if (demoMode) {
        // No real backend yet — simulate success and route to demo dashboard so
        // the user still experiences the full flow end-to-end.
        await new Promise((r) => setTimeout(r, 450))
        if (mode === 'signup') {
          setSuccess(lang === 'he'
            ? 'רישום הודגם בהצלחה! ברגע ש-Supabase יחובר, הנתונים ייסגנכרנו באמת.'
            : 'Signup demo successful! Once Supabase is connected, accounts will sync for real.')
          await new Promise((r) => setTimeout(r, 900))
        }
        navigate('/')
        return
      }
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
        if (error) throw error
        setSuccess(t.authCheckEmail)
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div dir={dir} className="min-h-screen bg-mesh-gradient flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/80 via-white/40 to-purple-50/60" />

      {/* Language toggle */}
      <motion.button
        whileTap={{ scale: 0.93 }}
        onClick={toggleLang}
        className="absolute top-5 right-5 glass px-3 py-1.5 rounded-xl text-sf-caption font-semibold text-[#636366] hover:text-[#1C1C1E] transition-colors z-10"
      >
        {lang === 'he' ? 'EN' : 'עב'}
      </motion.button>

      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="w-16 h-16 bg-gradient-to-br from-[#007AFF] to-[#32ADE6] rounded-3xl mx-auto mb-4 flex items-center justify-center shadow-lg shadow-blue-200">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="10" r="4" fill="white" opacity="0.9" />
              <circle cx="8" cy="22" r="3.5" fill="white" opacity="0.7" />
              <circle cx="24" cy="22" r="3.5" fill="white" opacity="0.7" />
              <line x1="16" y1="14" x2="8" y2="19" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
              <line x1="16" y1="14" x2="24" y2="19" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
            </svg>
          </motion.div>
          <h1 className="text-sf-title2 text-[#1C1C1E]">{t.authTitle}</h1>
          <p className="text-sf-subhead text-[#8E8E93] mt-1">
            {mode === 'login' ? t.authSubLogin : t.authSubSignup}
          </p>
        </div>

        <div className="glass rounded-3xl p-6 shadow-glass-lg">
          <div className="flex bg-[#F2F2F7] rounded-xl p-1 mb-6">
            {(['login', 'signup'] as AuthMode[]).map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(null) }}
                className="relative flex-1 text-sf-subhead font-medium py-2 transition-colors duration-200">
                {mode === m && (
                  <motion.div layoutId="auth-tab" className="absolute inset-0 bg-white rounded-[0.6rem] shadow-sm"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
                )}
                <span className={`relative z-10 ${mode === m ? 'text-[#1C1C1E]' : 'text-[#8E8E93]'}`}>
                  {m === 'login' ? t.authTabLogin : t.authTabSignup}
                </span>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <AnimatePresence>
              {mode === 'signup' && (
                <motion.div key="fullname" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}>
                  <input type="text" placeholder={t.authFullName} value={fullName}
                    onChange={(e) => setFullName(e.target.value)} required className="input-field" />
                </motion.div>
              )}
            </AnimatePresence>
            <input type="email" placeholder={t.authEmail} value={email}
              onChange={(e) => setEmail(e.target.value)} required className="input-field" />
            <input type="password" placeholder={t.authPassword} value={password}
              onChange={(e) => setPassword(e.target.value)} required className="input-field" />

            <AnimatePresence>
              {error && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="text-sf-footnote text-[#FF3B30] bg-[#FF3B30]/8 rounded-lg px-3 py-2">{error}</motion.p>
              )}
              {success && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="text-sf-footnote text-[#34C759] bg-[#34C759]/8 rounded-lg px-3 py-2">{success}</motion.p>
              )}
            </AnimatePresence>

            <motion.button type="submit" disabled={loading} whileTap={{ scale: 0.97 }}
              className="btn-primary w-full mt-2 flex items-center justify-center gap-2">
              {loading && (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {mode === 'login' ? t.authSubmitLogin : t.authSubmitSignup}
            </motion.button>
          </form>
        </div>

        <p className="text-center text-sf-footnote text-[#8E8E93] mt-6">{t.authTagline}</p>

        {demoMode && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-[12px] text-[#007AFF] font-semibold underline decoration-[#007AFF]/40 underline-offset-2 hover:decoration-[#007AFF] transition"
            >
              {lang === 'he' ? 'המשך כהדגמה (ללא הרשמה)' : 'Continue as demo (no signup)'}
            </button>
            <p className="text-[10px] text-[#8E8E93] text-center max-w-[260px] leading-relaxed px-4">
              {lang === 'he'
                ? 'כרגע אין חיבור ל-Supabase. עם חיבור, ההרשמה תהיה אמיתית ומסונכרנת בין מכשירים.'
                : 'Supabase not yet connected. Once wired up, signup will be real and synced across devices.'}
            </p>
          </div>
        )}
      </motion.div>
    </div>
  )
}
