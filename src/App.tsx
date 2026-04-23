import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { supabase } from './lib/supabase'
import { useFamilyStore } from './store/useFamilyStore'
import { useLang, isRTL } from './i18n/useT'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import TreePage from './pages/TreePage'
import BirthdayPage from './pages/BirthdayPage'
import AdminDashboard from './components/admin/AdminDashboard'
import { ADLER_MEMBERS, ADLER_RELATIONSHIPS } from './data/adlerFamily'
import type { Session } from '@supabase/supabase-js'

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_URL !== ''

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(SUPABASE_CONFIGURED)
  const [demoMode] = useState(!SUPABASE_CONFIGURED)

  const { setProfile, fetchMembers, fetchRelationships, fetchEditRequests } = useFamilyStore()
  const { lang } = useLang()
  const dir = isRTL(lang) ? 'rtl' : 'ltr'

  // Seed demo data
  useEffect(() => {
    if (!demoMode) return
    useFamilyStore.getState().setProfile({
      id: 'demo',
      full_name: lang === 'he' ? 'משפחת אדלר' : 'Adler Family',
      role: 'admin',
    })
    useFamilyStore.setState({ members: ADLER_MEMBERS, relationships: ADLER_RELATIONSHIPS })
  }, [demoMode, lang])

  // Supabase auth
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session || !SUPABASE_CONFIGURED) return
    const load = async () => {
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      setProfile(data ?? {
        id: session.user.id,
        full_name: session.user.user_metadata?.full_name ?? session.user.email ?? 'User',
        role: 'user',
      })
      fetchMembers(); fetchRelationships(); fetchEditRequests()
    }
    load()
  }, [session])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-mesh-gradient flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-[#007AFF]/20 border-t-[#007AFF] rounded-full"
        />
      </div>
    )
  }

  const isAuth = demoMode || !!session

  return (
    <div dir={dir} className="min-h-screen">
      <HashRouter>
        <Routes>
          <Route path="/login" element={isAuth ? <Navigate to="/" replace /> : <Auth />} />
          <Route path="/" element={isAuth ? <Dashboard demoMode={demoMode} /> : <Navigate to="/login" replace />} />
          <Route path="/tree" element={isAuth ? <TreePage demoMode={demoMode} /> : <Navigate to="/login" replace />} />
          <Route path="/birthdays" element={isAuth ? <BirthdayPage demoMode={demoMode} /> : <Navigate to="/login" replace />} />
          <Route path="/admin" element={isAuth ? <AdminDashboard /> : <Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </div>
  )
}
