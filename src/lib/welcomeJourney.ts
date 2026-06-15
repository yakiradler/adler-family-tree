/** First-login welcome-journey "seen" flag (one-time per device). */
const SEEN_KEY = 'ft-welcome-journey-v1'

export function hasSeenWelcomeJourney(): boolean {
  try { return window.localStorage.getItem(SEEN_KEY) === '1' } catch { return true }
}

export function markWelcomeJourneySeen(): void {
  try { window.localStorage.setItem(SEEN_KEY, '1') } catch { /* quota — accept */ }
}
