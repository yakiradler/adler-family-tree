/**
 * "First login" gate for auto-starting the built-in tutorials
 * (TutorialOverlay). Each page's tutorial auto-opens the first time the
 * user lands on it, then never again automatically — it stays replayable
 * from the 🎓 tile / "?" menu. One flag per page, per device.
 */
const KEY = (page: string) => `ft-tutorial-autostarted-${page}`

/** True the first time only; does NOT mark — read-only. */
export function shouldAutoStartTutorial(page: 'dashboard' | 'tree'): boolean {
  try { return window.localStorage.getItem(KEY(page)) !== '1' } catch { return false }
}

/** Remember that this page's tutorial has auto-started (call on close). */
export function markTutorialAutoStarted(page: 'dashboard' | 'tree'): void {
  try { window.localStorage.setItem(KEY(page), '1') } catch { /* quota — accept */ }
}
