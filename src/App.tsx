import { Suspense, lazy, useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { supabase } from './lib/supabase'
import { useFamilyStore } from './store/useFamilyStore'
import { useLang, isRTL } from './i18n/useT'
// Landing stays in the main bundle — it's the entry page and the
// marketing pitch. Everything else is route-split so the initial
// payload shrinks: a user visiting "/" doesn't pay for the tree
// renderer, admin dashboard, AI-scan modal, etc.
import Landing from './pages/Landing'
import ThemeShell from './components/ThemeShell'
import PersistenceIndicator from './components/PersistenceIndicator'
import InstallPrompt from './components/InstallPrompt'
import { ADLER_MEMBERS, ADLER_RELATIONSHIPS } from './data/adlerFamily'
import { isPendingOnboarding } from './lib/pendingOnboarding'
import type { Profile } from './types'
import type { Session } from '@supabase/supabase-js'

// Lazy-loaded routes. Each becomes its own chunk so users only
// download what they actually navigate to.
const Auth = lazy(() => import('./pages/Auth'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const TreePage = lazy(() => import('./pages/TreePage'))
const BirthdayPage = lazy(() => import('./pages/BirthdayPage'))
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard'))
const OnboardingWizard = lazy(() => import('./components/onboarding/OnboardingWizard'))

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

  // Demo profile lifecycle — hydrates from localStorage so a fresh
  // signup's onboarding state survives refresh. Falls back to the
  // pre-filled "demo admin" profile so first-time visitors see the
  // Adler-family demo without any setup. Language switches only
  // update the displayed `full_name` for that default admin; once a
  // real signup happens the user's own name is preserved.
  useEffect(() => {
    if (!demoMode) return
    const DEFAULT_NAME = lang === 'he' ? 'משפחת אדלר' : 'Adler Family'
    let stored: Profile | null = null
    try {
      const raw = window.localStorage.getItem('ft-demo-profile')
      if (raw) stored = JSON.parse(raw) as Profile
    } catch { /* malformed payload — fall through to default */ }
    const next: Profile = stored ?? {
      id: 'demo',
      full_name: DEFAULT_NAME,
      role: 'admin',
      // Pre-onboarded so existing demo visitors aren't forced through
      // the wizard. New signups set this back to null in Auth.tsx.
      onboarded_at: new Date(0).toISOString(),
    }
    // Refresh the default name on language change, but only for the
    // pristine demo admin — never overwrite a real signup's name.
    if (next.id === 'demo') next.full_name = DEFAULT_NAME
    useFamilyStore.getState().setProfile(next)
  }, [demoMode, lang])

  // Persist any demo profile updates so refresh + lang changes don't
  // lose the user's onboarding progress or signup identity. We only
  // mirror to storage in demo mode; Supabase owns the canonical profile
  // when configured.
  useEffect(() => {
    if (!demoMode) return
    const unsubscribe = useFamilyStore.subscribe((state, prev) => {
      if (state.profile === prev.profile) return
      try {
        if (state.profile) {
          window.localStorage.setItem('ft-demo-profile', JSON.stringify(state.profile))
        } else {
          window.localStorage.removeItem('ft-demo-profile')
        }
      } catch { /* quota — ignore, profile is small enough this is rare */ }
    })
    return unsubscribe
  }, [demoMode])

  // Dev-only: expose the store on window for browser-harness debugging
  // (browser DevTools and the Preview MCP test harness can poke at the
  // store without going through the UI). Stripped from production by
  // the import.meta.env.DEV check at build time.
  useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as unknown as { __ftStore?: typeof useFamilyStore }).__ftStore = useFamilyStore
    }
  }, [])

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
    // Treat an empty parsed payload as "no usable state" — early
    // builds occasionally wrote out [] when fetchMembers raced ahead
    // of hydration, and we don't want a stale empty snapshot to
    // suppress the Adler seed forever.
    if (
      parsed &&
      Array.isArray(parsed.members) &&
      parsed.members.length > 0 &&
      Array.isArray(parsed.relationships)
    ) {
      useFamilyStore.setState({
        members: parsed.members as typeof ADLER_MEMBERS,
        relationships: parsed.relationships as typeof ADLER_RELATIONSHIPS,
        trees: (Array.isArray(parsed.trees) ? parsed.trees : []) as never[],
        // `notes` is optional in the snapshot — older payloads predate
        // the feature, so we fall back to an empty list instead of
        // letting `undefined` blow up downstream consumers.
        notes: (Array.isArray((parsed as { notes?: unknown }).notes)
          ? (parsed as { notes: unknown[] }).notes
          : []) as never[],
      })
      restored = true
    }

    // First run (or recovered-from-empty) → seed the Adler family.
    // We seed in BOTH demo and Supabase modes: in production the
    // backing Supabase project is empty, so without a seed the user
    // would land on a blank tree. Supabase mode then enriches /
    // overwrites this only on first sync, never on refresh
    // (see useFamilyStore.fetchMembers).
    if (!restored) {
      useFamilyStore.setState({
        members: ADLER_MEMBERS,
        relationships: ADLER_RELATIONSHIPS,
      })
    }

    // Mirror mutations to localStorage. We use reference equality so
    // unrelated state changes (selectedMemberId, viewport) don't write.
    // Failures (quota exceeded, private-mode) are SURFACED to the user
    // via a custom event so the UI can flash a "save failed" toast —
    // we used to swallow them silently, which is why a refresh would
    // wipe a user's edits without any warning.
    const write = () => {
      const s = useFamilyStore.getState()
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            v: 3,
            ts: Date.now(),
            members: s.members,
            relationships: s.relationships,
            trees: s.trees,
            notes: s.notes,
          }),
        )
        for (const k of LEGACY_KEYS) window.localStorage.removeItem(k)
        window.dispatchEvent(new CustomEvent('ft-saved'))
      } catch (err) {
        const reason =
          err instanceof Error && err.name === 'QuotaExceededError'
            ? 'quota'
            : 'unknown'
        window.dispatchEvent(new CustomEvent('ft-save-failed', { detail: { reason } }))
        // Last-ditch attempt: if quota exceeded, drop the photo arrays
        // (which dwarf everything else) and retry. The user keeps their
        // text data and the failure becomes visible.
        if (reason === 'quota') {
          try {
            window.localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify({
                v: 3,
                ts: Date.now(),
                _photosStripped: true,
                members: s.members.map((m) => ({ ...m, photos: undefined, photo_url: undefined })),
                relationships: s.relationships,
                trees: s.trees,
                notes: s.notes,
              }),
            )
          } catch { /* still won't fit — give up */ }
        }
      }
    }

    const unsubscribe = useFamilyStore.subscribe((state, prev) => {
      if (
        state.members === prev.members &&
        state.relationships === prev.relationships &&
        state.trees === prev.trees &&
        state.notes === prev.notes
      ) return
      write()
    })

    // Safety net: write to localStorage whenever the user navigates away
    // or closes the tab. This catches any mutation that escaped the
    // subscribe callback (e.g. a rapid succession of updates where the
    // subscriber fired between two flushes and the last state wasn't
    // written yet).
    const onUnload = () => write()
    window.addEventListener('beforeunload', onUnload)

    // ALWAYS write once after the effect sets up — this serves two
    // purposes:
    //   • on first run (no prior storage) it writes the seed so the
    //     user's next refresh has something to restore;
    //   • on a v1/v2 → v3 migration it writes the migrated payload
    //     under the new key (and the previous lines also drop the
    //     legacy keys), so the next reload doesn't re-read stale data.
    write()
    return () => {
      unsubscribe()
      window.removeEventListener('beforeunload', onUnload)
    }
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

  // ALL hooks must run BEFORE any conditional early return — otherwise
  // React's hook order changes between renders (authLoading flips) and
  // the app crashes with "Rendered more hooks than during the previous
  // render", which presents to the user as a blank white screen.
  //
  // Subscribe to the pending-onboarding localStorage flag. It's set by
  // Auth.tsx the moment a SIGNUP succeeds and cleared by the wizard's
  // submit handler. Existing-user logins never set the flag, so the
  // wizard never blocks them — fixes the previous regression where
  // returning users were forced through the questionnaire because their
  // (pre-feature) profile.onboarded_at column was null.
  const [pendingOnboarding, setPendingOnboarding] = useState<boolean>(isPendingOnboarding)
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Refresh the flag whenever anything in the app toggles it — most
    // importantly, after wizard submission removes the key.
    const sync = () => setPendingOnboarding(isPendingOnboarding())
    window.addEventListener('ft-pending-onboarding-changed', sync)
    window.addEventListener('storage', sync) // cross-tab safety net
    return () => {
      window.removeEventListener('ft-pending-onboarding-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

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
  // Wizard gate only fires when the user JUST signed up — never on
  // plain logins, even if the existing profile happens to have
  // onboarded_at === null (legacy rows pre-date the wizard). The flag
  // is set inside Auth.tsx immediately after a successful signup and
  // cleared by the wizard's submit handler. See the useState +
  // event-listener pair above for how this flips reactively.
  const needsOnboarding = isAuth && pendingOnboarding

  return (
    <div dir={dir} className="min-h-screen">
      {/* Persistence toast — fixed-positioned, listens for save events
          dispatched by the store-subscriber. */}
      <PersistenceIndicator />
      {/* Add-to-home-screen banner. Self-gates on standalone mode +
          user dismissal, so it only shows up when there's something
          to actually install. */}
      <InstallPrompt />
      <HashRouter>
        <ThemeShell>
          {/* Suspense boundary for the lazy-loaded routes. The fallback
              mirrors the auth-loading spinner so the visual feel stays
              consistent while a route chunk streams in over the
              network. Landing is eagerly imported so this fallback
              only kicks in when the user actually navigates somewhere. */}
          <Suspense fallback={<RouteFallback />}>
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
            {/*
              Protected routes redirect to "/" (the Landing marketing
              page), NOT to "/login". Two reasons:
                • Sign-out should drop the user on the public face of
                  the site, not on a bare auth screen.
                • A logged-out visitor who pastes a deep link should
                  also see the marketing page first; from there they
                  can pick "התחבר" or "הרשמה" themselves.
              Eliminates the sign-out race where the route guard fires
              before the click handler's navigate('/') and momentarily
              flashes /login.
            */}
            <Route
              path="/onboarding"
              element={!isAuth ? <Navigate to="/" replace /> : <OnboardingWizard />}
            />
            <Route
              path="/home"
              element={
                !isAuth ? <Navigate to="/" replace />
                : needsOnboarding ? <Navigate to="/onboarding" replace />
                : <Dashboard demoMode={demoMode} />
              }
            />
            <Route
              path="/tree"
              element={
                !isAuth ? <Navigate to="/" replace />
                : needsOnboarding ? <Navigate to="/onboarding" replace />
                : <TreePage demoMode={demoMode} />
              }
            />
            <Route
              path="/birthdays"
              element={
                !isAuth ? <Navigate to="/" replace />
                : needsOnboarding ? <Navigate to="/onboarding" replace />
                : <BirthdayPage demoMode={demoMode} />
              }
            />
            <Route
              path="/admin"
              element={
                !isAuth ? <Navigate to="/" replace />
                : needsOnboarding ? <Navigate to="/onboarding" replace />
                : <AdminDashboard />
              }
            />
            <Route
              path="/scan"
              element={
                !isAuth ? <Navigate to="/" replace />
                : needsOnboarding ? <Navigate to="/onboarding" replace />
                : <Navigate to="/home" replace />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </ThemeShell>
      </HashRouter>
    </div>
  )
}

/**
 * Suspense fallback for the lazy-loaded routes. Uses the same blue
 * spinner-on-mesh background as the initial auth-loading state so the
 * route hand-off feels seamless. Pulled out into a component so the
 * Suspense JSX stays uncluttered.
 */
function RouteFallback() {
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
