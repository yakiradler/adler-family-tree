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

  // Profile-only side effect — runs on language change so the
  // displayed family name follows the active locale. Members,
  // relationships and trees are owned by the persistence effect below.
  useEffect(() => {
    if (!demoMode) return
    useFamilyStore.getState().setProfile({
      id: 'demo',
      full_name: lang === 'he' ? 'משפחת אדלר' : 'Adler Family',
      role: 'admin',
    })
  }, [demoMode, lang])

  // Persistence — runs in BOTH demo and Supabase modes.
  //
  // In demo mode this is the only persistence layer. In Supabase mode
  // it acts as a fast hydration cache so a refresh shows the user's
  // last-known state instantly while Supabase fetches fresh data
  // asynchronously. This also means a transient Supabase outage no
  // longer wipes the user's recent edits — they survive in localStorage
  // and resync once the backend is reachable again.
  //
  // The effect depends ONLY on `demoMode` so swapping the language
  // doesn't tear down the subscription and briefly run with stale data
  // (an earlier suspect cause of "marked as hidden, refresh, came back").
  useEffect(() => {
    const STORAGE_KEY = 'ft-state-v3'
    const LEGACY_KEYS = ['ft-demo-state-v2', 'ft-demo-state-v1']

    // Migrate / hydrate.
    let restored = false
    const tryParse = (raw: string | null) => {
      if (!raw) return null
      try { return JSON.parse(raw) as { members?: unknown; relationships?: unknown; trees?: unknown } } catch { return null }
    }
    let parsed = tryParse(window.localStorage.getItem(STORAGE_KEY))
    if (!parsed) {
      for (const k of LEGACY_KEYS) {
        const p = tryParse(window.localStorage.getItem(k))
        if (p) { parsed = p; break }
      }
    }
    if (parsed && Array.isArray(parsed.members) && Array.isArray(parsed.relationships)) {
      useFamilyStore.setState({
        members: parsed.members as typeof ADLER_MEMBERS,
        relationships: parsed.relationships as typeof ADLER_RELATIONSHIPS,
        trees: (Array.isArray(parsed.trees) ? parsed.trees : []) as never[],
      })
      restored = true
    }

    // First run + demo mode → seed the Adler family.
    if (!restored && demoMode) {
      useFamilyStore.setState({
        members: ADLER_MEMBERS,
        relationships: ADLER_RELATIONSHIPS,
      })
    }

    // Mirror mutations to localStorage. We use reference equality so
    // unrelated state changes (selectedMemberId, viewport) don't write.
    const write = () => {
      try {
        const s = useFamilyStore.getState()
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            v: 3,
            ts: Date.now(),
            members: s.members,
            relationships: s.relationships,
            trees: s.trees,
          }),
        )
        // Drop legacy entries once we've successfully written v3.
        for (const k of LEGACY_KEYS) window.localStorage.removeItem(k)
      } catch { /* quota / private mode — silent */ }
    }

    const unsubscribe = useFamilyStore.subscribe((state, prev) => {
      if (
        state.members === prev.members &&
        state.relationships === prev.relationships &&
        state.trees === prev.trees
      ) return
      write()
    })

    if (!restored && demoMode) write()
    return unsubscribe
  }, [demoMode])

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
