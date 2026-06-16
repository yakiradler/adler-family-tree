/**
 * Basic app color theme (owner request: "system colors — 2 colors,
 * basic for now"). A theme only re-tints the page background mesh
 * gradient — it deliberately does NOT touch component colors, so it
 * can never make text unreadable. Persisted per-device in localStorage
 * and applied as `data-theme` on <html>; index.css carries the
 * per-theme background override.
 */

export type ThemeId = 'blue' | 'green'

export const THEMES: { id: ThemeId; labelKey: 'themeBlue' | 'themeGreen' }[] = [
  { id: 'blue', labelKey: 'themeBlue' },
  { id: 'green', labelKey: 'themeGreen' },
]

const KEY = 'ft-theme'

export function getTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'blue' || v === 'green') return v
  } catch { /* SSR / privacy mode */ }
  return 'blue'
}

export function setTheme(theme: ThemeId): void {
  try { localStorage.setItem(KEY, theme) } catch { /* ignore */ }
  applyTheme(theme)
}

export function applyTheme(theme: ThemeId): void {
  if (typeof document === 'undefined') return
  // Default (blue) needs no attribute — index.css only overrides for green.
  if (theme === 'blue') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

/** Call once at startup to apply the saved theme before first paint. */
export function applyStoredTheme(): void {
  applyTheme(getTheme())
}
