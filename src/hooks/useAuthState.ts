import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_URL !== ''

/**
 * Lightweight auth state for components that need to render different
 * affordances based on whether the visitor is signed in (Landing CTAs,
 * QuickAccessMenu). Distinct from the App-level auth gate — this one
 * is read-only and never blocks rendering.
 *
 * `target` is the path the user should land on when they tap a generic
 * "go to my area" button: `/home` if signed in + onboarded, `/onboarding`
 * if signed in but not yet onboarded, `/login` otherwise.
 */
export function useAuthState() {
  const [hasSession, setHasSession] = useState<boolean>(false)

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return
    let active = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active) setHasSession(!!session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_e, s) => active && setHasSession(!!s),
    )
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  // In demo mode the route guards live in App (demoEntered flag), so a
  // safe default is to route generic "personal area" buttons to /login
  // when there's no real session — /login then redirects to /home if the
  // user already stepped into the demo, or shows the Auth screen
  // (which offers "continue as demo").
  const isAuth = hasSession
  const target = isAuth ? '/home' : '/login'

  return { isAuth, target }
}
