/**
 * First-login gate persistence (terms + pricing).
 *
 * The canonical record is on the profile (terms_accepted_at /
 * plan_acked_at, migration 028). But some legacy accounts have a
 * profiles row whose id doesn't match auth.uid(), so the self-update
 * is RLS-blocked and the DB flag never sticks — which made the gate
 * re-open on every refresh. To guarantee "once per device" regardless,
 * we ALSO stamp a localStorage flag on completion and treat EITHER
 * source as "done". The gate is a UX step, not a security boundary, so
 * a device-local fallback is safe.
 */
const TERMS_KEY = 'ft-terms-ok'
const PLAN_KEY = 'ft-plan-ok'

function get(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
function set(key: string): void {
  try { localStorage.setItem(key, '1') } catch { /* ignore */ }
}

export const hasAcceptedTermsLocal = () => get(TERMS_KEY)
export const hasAckedPlanLocal = () => get(PLAN_KEY)
export const markTermsAcceptedLocal = () => set(TERMS_KEY)
export const markPlanAckedLocal = () => set(PLAN_KEY)
