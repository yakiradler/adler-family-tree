/**
 * "Pending onboarding" flag.
 *
 * A small localStorage cell that distinguishes a brand-new SIGNUP
 * session from a plain LOGIN. The route guard in App.tsx only forces
 * /onboarding when this flag is set, so returning users aren't dragged
 * through the wizard every time they sign in — a regression that hit
 * after the initial gate landed because legacy profile rows pre-date
 * the `onboarded_at` column and therefore look "un-onboarded" to the
 * naive null-check.
 *
 * Write path:
 *   • Auth.tsx — set on a successful signup (both demo + Supabase).
 *
 * Clear path:
 *   • OnboardingWizard.tsx — cleared once the wizard's submit handler
 *     finishes persisting the user's choices, immediately before the
 *     terminal "submitted" step renders.
 *
 * Read path:
 *   • App.tsx — listens for the custom `ft-pending-onboarding-changed`
 *     event (fired by the helpers below) plus the native `storage`
 *     event for cross-tab consistency, then re-evaluates the gate.
 */

const KEY = 'ft-pending-onboarding'
const EVT = 'ft-pending-onboarding-changed'

export function markPendingOnboarding(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, '1')
    // Custom event so same-tab listeners pick the change up
    // immediately. The native `storage` event only fires in OTHER
    // tabs, which is useless for the tab that just signed up.
    window.dispatchEvent(new Event(EVT))
  } catch { /* quota — extremely unlikely for one byte */ }
}

export function clearPendingOnboarding(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(KEY)
    window.dispatchEvent(new Event(EVT))
  } catch { /* ignore */ }
}

export function isPendingOnboarding(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(KEY) === '1'
}
