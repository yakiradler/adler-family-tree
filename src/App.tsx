import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { supabase } from './lib/supabase'
import { useFamilyStore } from './store/useFamilyStore'
import { useLang, isRTL } from './i18n/useT'
import Auth from './pages/Auth'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import TreePage from './pages/TreePage'
import BirthdayPage from './pages/BirthdayPage'
import AdminDashboard from './components/admin/AdminDashboard'
import ThemeShell from './components/ThemeShell'
import OnboardingWizard from './components/onboarding/OnboardingWizard'
import { isOnboarded } from './lib/permissions'
import { ADLER_MEMBERS, ADLER_RELATIONSHIPS } from './data/adlerFamily'
import type { Session } from '@supabase/supabase-js'

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_URL !== ''

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(SUPABASE_CONFIGURED)
  const [demoMode] = useState(!SUPABASE_CONFIGURED)
  // `demoMode` is the *capability* flag (Supabase not wired). `demoEntered`
  // is the *session* flag — the user chose to step inside the demo from the
  // landing/auth screen. Without this split, first-time visitors would skip
  // the marketing landing entirely whenever Supabase wasn't configured.
  const [demoEntered, setDemoEntered] = useState(false)

  const { profile, setProfile, fetchMembers, fetchRelationships, fetchEditRequests } = useFamilyStore()
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

  const isAuth = (demoMode && demoEntered) || !!session
  // Onboarding gate: real authenticated users (not demo) who have a profile
  // loaded but no `onboarded_at` timestamp still need to complete the wizard
  // before any in-app route renders. Profile may briefly be null while
  // loading; we only treat the wizard as needed once we have a profile.
  const needsOnboarding =
    !demoMode && !!session && !!profile && !isOnboarded(profile)

  // Helper: where should an authenticated user land after login?
  const homeOrOnboarding = needsOnboarding ? '/onboarding' : '/home'

  return (
    <div dir={dir} className="min-h-screen">
      <HashRouter>
        <ThemeShell>
          <Routes>
            {/*
              Routing model:
              - "/"           → Marketing Landing for ALL visitors
                                (authed or not). The Landing's CTAs and
                                Quick-Access menu route smartly based on
                                auth + onboarding state.
              - "/home"       → Dashboard. Requires auth; if not onboarded,
                                redirects to /onboarding.
              - "/onboarding" → Onboarding wizard. Requires auth.
              - "/login"      → Auth page (login + signup tabs).
            */}
            <Route path="/" element={<Landing />} />
            <Route
              path="/login"
              element={
                isAuth
                  ? <Navigate to={homeOrOnboarding} replace />
                  : <Auth demoMode={demoMode} onDemoEnter={() => setDemoEntered(true)} />
              }
            />
            <Route
              path="/onboarding"
              element={
                !isAuth
                  ? <Navigate to="/login" replace />
                  : needsOnboarding
                  ? <OnboardingWizard />
                  : <Navigate to="/home" replace />
              }
            />
            <Route
              path="/home"
              element={
                !isAuth
                  ? <Navigate to="/login" replace />
                  : needsOnboarding
                  ? <Navigate to="/onboarding" replace />
                  : <Dashboard demoMode={demoMode} />
              }
            />
            <Route
              path="/tree"
              element={
                !isAuth
                  ? <Navigate to="/login" replace />
                  : needsOnboarding
                  ? <Navigate to="/onboarding" replace />
                  : <TreePage demoMode={demoMode} />
              }
            />
            <Route
              path="/birthdays"
              element={
                !isAuth
                  ? <Navigate to="/login" replace />
                  : needsOnboarding
                  ? <Navigate to="/onboarding" replace />
                  : <BirthdayPage demoMode={demoMode} />
              }
            />
            <Route
              path="/admin"
              element={
                !isAuth
                  ? <Navigate to="/login" replace />
                  : needsOnboarding
                  ? <Navigate to="/onboarding" replace />
                  : <AdminDashboard />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ThemeShell>
      </HashRouter>
    </div>
  )
}
