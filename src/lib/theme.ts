/**
 * App appearance: Light (default) or Dark (night) mode.
 *
 * Implemented as a `dark` class on <html> + a dark-mode CSS layer in
 * index.css that re-tints the shared surfaces (page background, glass
 * cards, white panels, primary/secondary text, light chips). Brand
 * gradients and emoji are intentionally left as-is so the app keeps its
 * identity at night. Persisted per-device in localStorage and applied
 * before first paint (main.tsx) to avoid a flash.
 */

export type ThemeId = 'light' | 'dark'

export const THEMES: { id: ThemeId; labelKey: 'themeLight' | 'themeDark'; icon: string }[] = [
  { id: 'light', labelKey: 'themeLight', icon: '☀️' },
  { id: 'dark', labelKey: 'themeDark', icon: '🌙' },
]

const KEY = 'ft-theme'

export function getTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch { /* SSR / privacy mode */ }
  return 'light'
}

export function setTheme(theme: ThemeId): void {
  try { localStorage.setItem(KEY, theme) } catch { /* ignore */ }
  applyTheme(theme)
}

export function applyTheme(theme: ThemeId): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/** Call once at startup to apply the saved theme before first paint. */
export function applyStoredTheme(): void {
  applyTheme(getTheme())
}
