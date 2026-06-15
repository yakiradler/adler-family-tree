/**
 * Fire the green "נשמר" / "Saved" pill (PersistenceIndicator).
 *
 * Call this ONLY from explicit user save actions — clicking Save in a
 * form, finishing an inline edit, etc. Background autosave to localStorage
 * is intentionally silent (it runs on every state change, so confirming it
 * each time made the pill flash non-stop).
 */
export function notifySaved(): void {
  try { window.dispatchEvent(new CustomEvent('ft-saved')) } catch { /* SSR / no window */ }
}
