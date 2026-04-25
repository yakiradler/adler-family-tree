import { useLocation } from 'react-router-dom'

/**
 * Per-route visual theme. Each route gets a tinted background gradient and
 * an accent color exposed as CSS variables on the top-level wrapper, so any
 * descendant can opt into the active accent via `var(--accent)` without
 * being tightly coupled to the route table.
 *
 * Why CSS vars rather than passing a theme object through React context?
 *  - Cheaper transitions: a single CSS `transition` on the wrapper animates
 *    every dependent style at once.
 *  - Zero re-renders for components that don't otherwise care about theme.
 */
export interface RouteTheme {
  key: string
  /** CSS color (used as --accent and for accent strokes/buttons) */
  accent: string
  /** Soft accent for chips/highlights */
  accentSoft: string
  /** Background gradient stops */
  bgFrom: string
  bgVia: string
  bgTo: string
  /** Mesh-style radial overlay color (rgba) */
  glow: string
}

const THEMES: Record<string, RouteTheme> = {
  dashboard: {
    key: 'dashboard',
    accent: '#7C3AED',          // violet-600
    accentSoft: 'rgba(124,58,237,0.12)',
    bgFrom: '#F5F3FF',          // violet-50
    bgVia: '#EEF2FF',           // indigo-50
    bgTo: '#FDF4FF',            // fuchsia-50
    glow: 'rgba(124,58,237,0.18)',
  },
  tree: {
    key: 'tree',
    accent: '#0066FF',
    accentSoft: 'rgba(0,102,255,0.12)',
    bgFrom: '#EEF6FF',
    bgVia: '#E0F2FE',
    bgTo: '#ECFEFF',
    glow: 'rgba(50,173,230,0.20)',
  },
  birthdays: {
    key: 'birthdays',
    accent: '#F59E0B',          // amber-500
    accentSoft: 'rgba(245,158,11,0.14)',
    bgFrom: '#FFFBEB',          // amber-50
    bgVia: '#FFF1F2',           // rose-50
    bgTo: '#FFF7ED',            // orange-50
    glow: 'rgba(244,114,182,0.18)',
  },
  admin: {
    key: 'admin',
    accent: '#E11D48',          // rose-600
    accentSoft: 'rgba(225,29,72,0.12)',
    bgFrom: '#FFF1F2',          // rose-50
    bgVia: '#FEF2F2',           // red-50
    bgTo: '#FFF7ED',            // orange-50
    glow: 'rgba(225,29,72,0.18)',
  },
  auth: {
    key: 'auth',
    accent: '#0EA5E9',
    accentSoft: 'rgba(14,165,233,0.12)',
    bgFrom: '#F0F9FF',
    bgVia: '#EEF2FF',
    bgTo: '#F5F3FF',
    glow: 'rgba(14,165,233,0.18)',
  },
}

export function themeForPath(pathname: string): RouteTheme {
  if (pathname.startsWith('/tree')) return THEMES.tree
  if (pathname.startsWith('/birthdays')) return THEMES.birthdays
  if (pathname.startsWith('/admin')) return THEMES.admin
  if (pathname.startsWith('/login')) return THEMES.auth
  return THEMES.dashboard
}

export function useRouteTheme(): RouteTheme {
  const { pathname } = useLocation()
  return themeForPath(pathname)
}

/** Returns the CSS-variable style object to spread onto the theme wrapper. */
export function themeStyleVars(theme: RouteTheme): React.CSSProperties {
  return {
    // Custom CSS variables — TS doesn't know about these, so cast.
    ['--accent' as any]: theme.accent,
    ['--accent-soft' as any]: theme.accentSoft,
    ['--bg-from' as any]: theme.bgFrom,
    ['--bg-via' as any]: theme.bgVia,
    ['--bg-to' as any]: theme.bgTo,
    ['--glow' as any]: theme.glow,
    background: `linear-gradient(160deg, ${theme.bgFrom} 0%, ${theme.bgVia} 50%, ${theme.bgTo} 100%)`,
    transition:
      'background 600ms cubic-bezier(0.22, 1, 0.36, 1), color 400ms ease',
  }
}
