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
import VersionUpdateModal from './components/VersionUpdateModal'
import DialogHost from './components/ui/DialogHost'
import NotificationToast from './components/notifications/NotificationToast'
import { alertDialog } from './lib/confirm'
import DevEnvBanner from './components/DevEnvBanner'
import MfaChallengeGate from './components/security/MfaChallengeGate'
import NewPasswordScreen from './components/security/NewPasswordScreen'
import PlanGateToast from './components/plan/PlanGateToast'
import BottomNav from './components/BottomNav'
import { ADLER_MEMBERS, ADLER_RELATIONSHIPS, ADLER_TREES } from './data/adlerFamily'
import { isPendingOnboarding, clearPendingOnboarding, markPendingOnboarding } from './lib/pendingOnboarding'
import { useNotificationPolling } from './hooks/useNotificationPolling'
import { readPendingJoinCode } from './lib/joinLink'
import { hasAcceptedTermsLocal, hasAckedPlanLocal } from './lib/firstRunGate'
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
const PricingPage = lazy(() => import('./pages/PricingPage'))
const TermsConsentPage = lazy(() => import('./pages/TermsConsentPage'))
const FamilyFeedPage = lazy(() => import('./pages/FamilyFeedPage'))
const JoinPage = lazy(() => import('./pages/JoinPage'))

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_URL !== ''

// OAuth (Google) sends the user back to `/#access_token=…`. supabase-js
// consumes + strips that hash, which leaves the HashRouter on `/` — the
// marketing landing — so the pilot users thought sign-in had failed and
// "bounced them back to the start". Capture the marker at module-load
// time (BEFORE supabase-js strips it); an effect below then drops the
// signed-in user straight into /home. Password-recovery links also
// carry access_token but must keep going to the NewPasswordScreen wall,
// so they're excluded.
let oauthReturnPending =
  typeof window !== 'undefined' &&
  /[#&]access_token=/.test(window.location.hash) &&
  !window.location.hash.includes('type=recovery')

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(SUPABASE_CONFIGURED)
  const [demoMode] = useState(!SUPABASE_CONFIGURED)
  // `demoMode` is the *capability* flag (Supabase not wired). `demoEntered`
  // is the *session* flag — the user chose to step inside the demo from the
  // landing/auth screen. Without this split, first-time visitors would skip
  // the marketing landing entirely whenever Supabase wasn't configured.
  const [demoEntered, setDemoEntered] = useState(false)

  const { setProfile, fetchMembers, fetchRelationships, fetchEditRequests, fetchTrees, fetchMyPlan } = useFamilyStore()
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
    // Per-user storage key so signing out of one account and into
    // another doesn't leak the previous user's local data (including
    // the seeded Adler family) into the new session. The demo bucket
    // is a single shared key because demo has no real identity.
    // v5 bumps the per-user bucket again because stages 0-3 of the
    // base-rebuild changed the seed shape (7-member nuclear family
    // instead of 84 across 4 generations) AND introduced the
    // tree_id NOT NULL invariant. Old snapshots could resurrect the
    // 84-member population client-side even though the server already
    // restructured. Demo mode bucket also bumps to ft-state-v4 so a
    // returning demo visitor sees the new nuclear seed immediately
    // rather than the legacy 84-member fixture they cached.
    // v6 bumps after the layout-engine rewrite: any snapshot captured
    // under the old engine could still contain stale relationship rows
    // from now-deleted trees ("טסט יקיר" etc.) — the new engine treats
    // every relationship row as authoritative, so we force-flush so the
    // store rehydrates strictly from what RLS returns.
    // Demo bucket bumps to v7 with the 10-generation pilot seed — a
    // returning demo visitor must get the new fixture, so the old demo
    // snapshots are intentionally NOT migrated (no legacy hydration).
    const STORAGE_KEY = demoMode
      ? 'ft-state-v7'
      : `ft-state-v6-${session?.user?.id ?? 'anon'}`
    const LEGACY_KEYS: string[] = []

    // Keys from retired features + retired demo snapshots — removed
    // unconditionally so stale data doesn't linger.
    for (const k of [
      'ft-tree-layout-mode', 'ft-tree-density',
      'ft-state-v5', 'ft-state-v4', 'ft-state-v3',
      'ft-demo-state-v2', 'ft-demo-state-v1',
    ]) {
      try { window.localStorage.removeItem(k) } catch { /* ignore */ }
    }

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
        // Same defensive default for `feedback` (help "?" reports).
        feedback: (Array.isArray((parsed as { feedback?: unknown }).feedback)
          ? (parsed as { feedback: unknown[] }).feedback
          : []) as never[],
        // Demo plan object (subscription Phase A) — null lets the
        // PlanCard's fetchMyPlan synthesize the free-tier default.
        myPlan: ((parsed as { myPlan?: unknown }).myPlan ?? null) as never,
      })
      restored = true
    }

    // First run for a new session: in DEMO mode we still seed the
    // Adler family so first-time visitors immediately see a populated
    // demo. In Supabase auth mode the store starts EMPTY — the seed
    // is a privacy leak (every authenticated user would otherwise
    // inherit the demo family as their own), and fetchMembers will
    // load only what RLS allows for this user.
    if (!restored) {
      useFamilyStore.setState({
        members: demoMode ? ADLER_MEMBERS : [],
        relationships: demoMode ? ADLER_RELATIONSHIPS : [],
        // Seed demo trees so the per-tree filter has something to
        // anchor on. Without this, TreePage's "auto-pick first tree"
        // useEffect would fall through to the (now empty) main-tree
        // branch and show an empty canvas.
        trees: demoMode ? ADLER_TREES : [],
        notes: [],
        feedback: [],
      })
      // Auto-select the demo tree as active so /tree renders the
      // seed without forcing the user through a tree-picker first.
      if (demoMode) {
        useFamilyStore.getState().setActiveTreeId(ADLER_TREES[0].id)
      }
    }

    // Mirror mutations to localStorage. We use reference equality so
    // unrelated state changes (selectedMemberId, viewport) don't write.
    // Failures (quota exceeded, private-mode) are SURFACED to the user
    // via a custom event so the UI can flash a "save failed" toast —
    // we used to swallow them silently, which is why a refresh would
    // wipe a user's edits without any warning.
    // base64 data URIs from FileReader photo uploads blow past the
    // 5-10MB localStorage quota almost immediately on phones — a few
    // gallery photos and the quota toast starts firing every save.
    // Strip them BY DESIGN: the canonical store is Supabase / the
    // in-memory store; localStorage is just a fast hydration cache,
    // not a photo archive. http(s):// URLs (Supabase-hosted) are
    // tiny and preserved.
    const stripDataUriPhotos = <T extends { photos?: unknown; photo_url?: unknown }>(m: T): T => {
      const cleaned: T = { ...m }
      if (typeof m.photo_url === 'string' && m.photo_url.startsWith('data:')) {
        ;(cleaned as { photo_url?: unknown }).photo_url = undefined
      }
      if (Array.isArray(m.photos)) {
        const filtered = (m.photos as unknown[]).filter(
          (p) => typeof p !== 'string' || !p.startsWith('data:'),
        )
        ;(cleaned as { photos?: unknown }).photos = filtered
      }
      return cleaned
    }

    const write = () => {
      const s = useFamilyStore.getState()
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            v: 3,
            ts: Date.now(),
            members: s.members.map(stripDataUriPhotos),
            relationships: s.relationships,
            trees: s.trees,
            notes: s.notes,
            feedback: s.feedback,
            myPlan: s.myPlan,
          }),
        )
        for (const k of LEGACY_KEYS) window.localStorage.removeItem(k)
        // NOTE: autosave is intentionally SILENT — it runs on every state
        // change (incl. data loads) so dispatching 'ft-saved' here made
        // the green "נשמר" pill flash constantly. The pill now fires only
        // from explicit user saves (see lib/saved.ts → notifySaved()).
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
                feedback: s.feedback,
              }),
            )
          } catch { /* still won't fit — give up */ }
        }
      }
    }

    // PERF: the snapshot above stringifies the WHOLE dataset (all members,
    // relationships, notes…). Doing that synchronously on every state change
    // janks the UI and made saving feel slow — badly so on iPhone. We
    // DEBOUNCE it: rapid successive changes (typing, bulk adds, data loads)
    // coalesce into a single write ~700ms after activity settles. A flush()
    // runs the pending write immediately on unload/cleanup so nothing is lost.
    let writeTimer: number | null = null
    const flush = () => {
      if (writeTimer != null) { window.clearTimeout(writeTimer); writeTimer = null }
      write()
    }
    const scheduleWrite = () => {
      if (writeTimer != null) window.clearTimeout(writeTimer)
      writeTimer = window.setTimeout(() => { writeTimer = null; write() }, 700)
    }

    const unsubscribe = useFamilyStore.subscribe((state, prev) => {
      if (
        state.members === prev.members &&
        state.relationships === prev.relationships &&
        state.trees === prev.trees &&
        state.notes === prev.notes &&
        state.feedback === prev.feedback &&
        state.myPlan === prev.myPlan
      ) return
      scheduleWrite()
    })

    // Safety net: flush to localStorage whenever the user navigates away,
    // closes the tab, or backgrounds the app (iOS Safari fires pagehide /
    // visibilitychange but often NOT beforeunload, so we listen to all).
    const onUnload = () => flush()
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('pagehide', onUnload)
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onVisibility)

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
      flush() // persist any pending debounced change before tearing down
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('pagehide', onUnload)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // Re-run on user-id change so a sign-out/sign-in into a different
    // account re-keys localStorage and hydrates THAT user's data
    // instead of inheriting the previous user's local snapshot. Adding
    // STORAGE_KEY itself to the deps would loop — the effect writes
    // localStorage on every mutation, which would re-fire the effect.
  }, [demoMode, session?.user?.id])

  // Password-recovery flow: the email link lands the user back here
  // with a recovery session; instead of the app, they get the
  // set-a-new-password screen until they choose one.
  const [recoveryMode, setRecoveryMode] = useState(false)

  // Supabase auth
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Post-OAuth landing: once the session from the URL hash is in, route
  // the user INTO the app instead of leaving them on the marketing page
  // (or, worse, the login screen). One-shot per page load.
  useEffect(() => {
    if (authLoading || !session || !oauthReturnPending) return
    oauthReturnPending = false
    // A stashed join code (external share link → login round-trip)
    // outranks the default landing: finish the join first.
    window.location.hash = readPendingJoinCode() ? '#/join' : '#/home'
  }, [authLoading, session])

  useEffect(() => {
    if (!session || !SUPABASE_CONFIGURED) return
    const load = async () => {
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      // Account-suspension gate. The admin "remove user" flow sets
      // profiles.deleted_at to now() instead of hard-deleting the
      // row, which gives a 30-day restore window. If the user tries
      // to log in within that window we force a sign-out + flash
      // the suspension notice. The trigger in migration 006 auto-
      // clears deleted_at after 30 days so they can sign in again.
      const deletedAt = (data as { deleted_at?: string | null } | null)?.deleted_at
      if (deletedAt) {
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
        const ageMs = Date.now() - new Date(deletedAt).getTime()
        if (ageMs < thirtyDaysMs) {
          try { await supabase.auth.signOut() } catch { /* ignore */ }
          await alertDialog({
            message:
              'החשבון שלך הושעה על ידי המנהל. אם זו טעות, פנה למנהל לשחזור.\n\n' +
              'Your account has been suspended by an admin. Contact them to restore it.',
          })
          return
        }
      }
      setProfile(data ?? {
        id: session.user.id,
        full_name: session.user.user_metadata?.full_name ?? session.user.email ?? 'User',
        role: 'user',
      })
      // Fresh signups get routed through the onboarding wizard. The
      // email-signup path sets the pending flag in Auth.tsx, but OAuth
      // (Google) can't — the page redirects away before we know whether
      // this account is new. "Created in the last 10 minutes and not
      // onboarded" is the provider-agnostic signal; old accounts with a
      // legacy null onboarded_at are untouched.
      const createdAtMs = new Date(session.user.created_at).getTime()
      if (
        Number.isFinite(createdAtMs) &&
        Date.now() - createdAtMs < 10 * 60_000 &&
        !(data as { onboarded_at?: string | null } | null)?.onboarded_at
      ) {
        markPendingOnboarding()
      }
      fetchMembers(); fetchRelationships(); fetchEditRequests(); fetchTrees(); fetchMyPlan()
      // Which trees were shared with me — feeds the personal-dashboard
      // scoping (scopePersonalTrees) and the tree switcher.
      useFamilyStore.getState().fetchMyTreeAccess()
    }
    load()
    // The store actions are stable zustand references — listing them
    // satisfies exhaustive-deps without changing when the effect runs.
  }, [session, fetchEditRequests, fetchMembers, fetchRelationships, fetchTrees, fetchMyPlan, setProfile])

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

  // Admins / masters never need to walk through onboarding — they
  // were promoted by DB action, not by self-service signup, and the
  // wizard's purpose (collecting role + tree-join intent for admin
  // review) doesn't apply to someone who's already past that step.
  // Subscribing to the store here picks up the role transition the
  // moment Supabase hydrates the profile, so a privileged user who
  // got swept into /onboarding by a stale signup flag is bounced out
  // automatically.
  const profile = useFamilyStore((s) => s.profile)
  useEffect(() => {
    if (profile && (profile.role === 'admin' || profile.role === 'master')) {
      if (isPendingOnboarding()) clearPendingOnboarding()
    }
  }, [profile])

  // ── MFA assurance gate ─────────────────────────────────────────────
  // A password login on an account with a verified TOTP factor yields
  // an AAL1 session that must be upgraded to AAL2. The gate replaces
  // the ENTIRE router until the code is entered, so enforcement can't
  // be bypassed by typing a URL. Reset-on-session-change is adjusted
  // during render (react-hooks v7 forbids sync setState in effects);
  // the async AAL probe sets state from its callback, which is fine.
  // Notification inbox freshness — on load, focus return + 60s while
  // visible. Lives here (not in Dashboard) so the badge is warm on
  // every route.
  useNotificationPolling(SUPABASE_CONFIGURED && !!session)

  const [mfaGate, setMfaGate] = useState(false)
  const [prevSession, setPrevSession] = useState<Session | null>(session)
  if (session !== prevSession) {
    setPrevSession(session)
    setMfaGate(false)
  }
  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !session) return
    let cancelled = false
    supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      .then(({ data }) => {
        if (!cancelled && data) {
          setMfaGate(data.nextLevel === 'aal2' && data.currentLevel !== 'aal2')
        }
      })
      .catch(() => { /* AAL probe failed — don't lock the user out */ })
    return () => { cancelled = true }
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

  // Recovery-link wall: choose a new password before anything else.
  if (SUPABASE_CONFIGURED && recoveryMode && session) {
    return (
      <div dir={dir}>
        <NewPasswordScreen onDone={() => setRecoveryMode(false)} />
      </div>
    )
  }

  // Second-factor wall — see the mfaGate block above for why this
  // renders INSTEAD of the router.
  if (SUPABASE_CONFIGURED && session && mfaGate) {
    return (
      <div dir={dir}>
        <MfaChallengeGate onVerified={() => setMfaGate(false)} />
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
  // First-login flow (migration 028): real authed users must accept the
  // terms (+email consent) and pass the pricing gate before reaching the
  // app. Demo users are exempt. The flags live on the profile so the
  // flow runs once per account and survives reloads/new devices.
  const gateProfile = demoMode ? null : profile
  // "Done" if EITHER the DB flag is set OR the device-local fallback is
  // set. The fallback covers legacy accounts whose profiles.id != auth.uid()
  // (their self-update is RLS-blocked, so the DB flag never persisted and
  // the gate used to re-open on every refresh).
  const termsDone = !!gateProfile?.terms_accepted_at || hasAcceptedTermsLocal()
  const planDone = !!gateProfile?.plan_acked_at || hasAckedPlanLocal()
  const needsTerms = isAuth && !!gateProfile && !termsDone
  const needsPlan = isAuth && !!gateProfile && termsDone && !planDone

  return (
    <div dir={dir} className="min-h-screen">
      {/* Non-production deployments get a coloured banner at the very
          top so it's impossible to mistake the dev/preview site for
          the real app. Renders nothing in production. */}
      <DevEnvBanner />
      {/* Persistence toast — fixed-positioned, listens for save events
          dispatched by the store-subscriber. */}
      <PersistenceIndicator />
      {/* Add-to-home-screen banner. Self-gates on standalone mode +
          user dismissal, so it only shows up when there's something
          to actually install. */}
      <InstallPrompt />
      {/* "New version available" celebration modal. Polls
          /version.json in the background and pops once per fresh
          deploy — see useVersionCheck for the cadence. */}
      <VersionUpdateModal />
      {/* In-app confirm/alert dialogs (replaces window.confirm/alert). */}
      <DialogHost />
      <HashRouter>
        <ThemeShell>
          {/* Plan-limit upsell toast — fed by ft-plan-gate events from
              the store's addMember/addTree gates. Inside the router so
              its "see plans" button can navigate. */}
          <PlanGateToast />
          {/* Pops a transient card when a new notification arrives so the
              admin notices without opening the bell. */}
          <NotificationToast />
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
            {/* Pricing is public — part of the marketing funnel. CTAs
                inside route unauthenticated visitors to signup. For a
                first-login user it doubles as gate step 2 (forced); if
                they haven't accepted terms yet, bounce to /terms first. */}
            <Route
              path="/pricing"
              element={
                isAuth && needsTerms
                  ? <Navigate to="/terms" replace />
                  : <PricingPage isAuth={isAuth} forced={needsPlan} />
              }
            />
            {/* First-login gate step 1: terms + email consent. */}
            <Route
              path="/terms"
              element={
                !isAuth ? <Navigate to="/" replace />
                : !needsTerms ? <Navigate to={needsPlan ? '/pricing' : '/home'} replace />
                : <TermsConsentPage />
              }
            />
            <Route
              path="/login"
              element={
                isAuth
                  ? <Navigate to={readPendingJoinCode() ? '/join' : '/home'} replace />
                  : <Auth demoMode={demoMode} onDemoEnter={() => setDemoEntered(true)} />
              }
            />
            {/* External share-link landing — public on purpose: it
                stashes the code and routes guests through /login. */}
            <Route path="/join" element={<JoinPage isAuth={isAuth} />} />
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
              element={
                !isAuth ? <Navigate to="/" replace />
                : needsTerms ? <Navigate to="/terms" replace />
                : needsPlan ? <Navigate to="/pricing" replace />
                : <OnboardingWizard />
              }
            />
            <Route
              path="/home"
              element={
                !isAuth ? <Navigate to="/" replace />
                : needsTerms ? <Navigate to="/terms" replace />
                : needsPlan ? <Navigate to="/pricing" replace />
                : needsOnboarding ? <Navigate to="/onboarding" replace />
                : <Dashboard demoMode={demoMode} />
              }
            />
            <Route
              path="/tree"
              element={
                !isAuth ? <Navigate to="/" replace />
                : needsTerms ? <Navigate to="/terms" replace />
                : needsPlan ? <Navigate to="/pricing" replace />
                : needsOnboarding ? <Navigate to="/onboarding" replace />
                : <TreePage demoMode={demoMode} />
              }
            />
            <Route
              path="/feed"
              element={
                !isAuth ? <Navigate to="/" replace />
                : needsTerms ? <Navigate to="/terms" replace />
                : needsPlan ? <Navigate to="/pricing" replace />
                : needsOnboarding ? <Navigate to="/onboarding" replace />
                : <FamilyFeedPage demoMode={demoMode} />
              }
            />
            <Route
              path="/birthdays"
              element={
                !isAuth ? <Navigate to="/" replace />
                : needsTerms ? <Navigate to="/terms" replace />
                : needsPlan ? <Navigate to="/pricing" replace />
                : needsOnboarding ? <Navigate to="/onboarding" replace />
                : <BirthdayPage demoMode={demoMode} />
              }
            />
            <Route
              path="/admin"
              element={
                !isAuth ? <Navigate to="/" replace />
                : needsTerms ? <Navigate to="/terms" replace />
                : needsPlan ? <Navigate to="/pricing" replace />
                : needsOnboarding ? <Navigate to="/onboarding" replace />
                // Platform super-admin only. Previously ANY authenticated
                // user could render the dashboard (RLS blocked mutations but
                // the UI leaked) — close that gap here.
                : profile?.role !== 'admin' ? <Navigate to="/home" replace />
                : <AdminDashboard />
              }
            />
            <Route
              path="/scan"
              element={
                !isAuth ? <Navigate to="/" replace />
                : needsTerms ? <Navigate to="/terms" replace />
                : needsPlan ? <Navigate to="/pricing" replace />
                : needsOnboarding ? <Navigate to="/onboarding" replace />
                : <Navigate to="/home" replace />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          {/* Instagram-style bottom nav — self-gates to the 3 main tabs. */}
          <BottomNav isAuth={isAuth} />
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
