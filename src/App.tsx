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

  const { setProfile, fetchMembers, fetchRelationships, fetchEditRequests } = useFamilyStore()
  const { lang } = useLang()
  const dir = isRTL(lang) ? 'rtl' : 'ltr'

  // Seed demo data + persist edits across refreshes.
  //
  // In demo mode there's no Supabase backing the store, so a refresh
  // wipes everything to the original seed (which is why the user kept
  // seeing נתנאל reappear after marking him as ex). To make demo edits
  // sticky we now mirror members/relationships/trees to localStorage and
  // restore them on mount; the seed only loads on first run (or if the
  // user explicitly clears the cache via admin → system → "Clear cache").
  useEffect(() => {
    if (!demoMode) return
    const STORAGE_KEY = 'ft-demo-state-v1'
    useFamilyStore.getState().setProfile({
      id: 'demo',
      full_name: lang === 'he' ? 'משפחת אדלר' : 'Adler Family',
      role: 'admin',
    })

    // 1) Restore from localStorage if present, otherwise seed.
    let restored = false
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as {
          members?: typeof ADLER_MEMBERS
          relationships?: typeof ADLER_RELATIONSHIPS
          trees?: unknown[]
        }
        if (parsed.members && parsed.relationships) {
          useFamilyStore.setState({
            members: parsed.members,
            relationships: parsed.relationships,
            trees: (parsed.trees as never[]) ?? [],
          })
          restored = true
        }
      }
    } catch { /* corrupted localStorage — fall through to seed */ }

    if (!restored) {
      useFamilyStore.setState({ members: ADLER_MEMBERS, relationships: ADLER_RELATIONSHIPS })
    }

    // 2) Subscribe to mutations and persist after every change.
    const unsubscribe = useFamilyStore.subscribe((state, prev) => {
      if (
        state.members === prev.members &&
        state.relationships === prev.relationships &&
        state.trees === prev.trees
      ) return
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            members: state.members,
            relationships: state.relationships,
            trees: state.trees,
          }),
        )
      } catch { /* quota exceeded — fail silently */ }
    })
    return unsubscribe
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

  return (
    <div dir={dir} className="min-h-screen">
      <HashRouter>
        <ThemeShell>
          <Routes>
            {/*
              Routing model:
              - "/"           → Marketing Landing for ALL visitors.
              - "/home"       → Dashboard (auth required).
              - "/onboarding" → OnboardingWizard (auth required).
                                Reachable from a banner on Dashboard or
                                directly via Landing CTAs / link.
              - "/login"      → Auth page (login + signup tabs).
              - "/tree", "/birthdays", "/admin" → in-app routes (auth required).
              The wizard is intentionally NOT a hard gate. A user who
              hasn't finished onboarding can still browse the dashboard
              and pick up the wizard whenever they like — every protected
              route renders normally; an "incomplete profile" banner
              nudges them when relevant.
            */}
            <Route path="/" element={<Landing />} />
            <Route
              path="/login"
              element={
                isAuth
                  ? <Navigate to="/home" replace />
                  : <Auth demoMode={demoMode} onDemoEnter={() => setDemoEntered(true)} />
              }
            />
            <Route
              path="/onboarding"
              element={!isAuth ? <Navigate to="/login" replace /> : <OnboardingWizard />}
            />
            <Route
              path="/home"
              element={!isAuth ? <Navigate to="/login" replace /> : <Dashboard demoMode={demoMode} />}
            />
            <Route
              path="/tree"
              element={!isAuth ? <Navigate to="/login" replace /> : <TreePage demoMode={demoMode} />}
            />
            <Route
              path="/birthdays"
              element={!isAuth ? <Navigate to="/login" replace /> : <BirthdayPage demoMode={demoMode} />}
            />
            <Route
              path="/admin"
              element={!isAuth ? <Navigate to="/login" replace /> : <AdminDashboard />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ThemeShell>
      </HashRouter>
    </div>
  )
}
