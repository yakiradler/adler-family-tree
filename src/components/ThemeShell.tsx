import type { ReactNode } from 'react'
import { useRouteTheme, themeStyleVars } from '../lib/routeTheme'

interface Props {
  children: ReactNode
}

/**
 * Wraps the route tree with the active per-route theme. Must be rendered
 * inside the router so `useLocation()` resolves. Applies CSS variables on
 * a full-bleed div with a tinted gradient that smoothly transitions when
 * the user navigates between top-level routes.
 *
 * Components opt into the active accent with `var(--accent)` /
 * `var(--accent-soft)` — no React context plumbing required.
 */
export default function ThemeShell({ children }: Props) {
  const theme = useRouteTheme()
  return (
    <div
      className="min-h-screen relative"
      style={themeStyleVars(theme)}
      data-theme={theme.key}
    >
      {/* Soft radial glow overlay for depth — uses the route's accent tint */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-0"
        style={{
          background:
            `radial-gradient(60% 50% at 20% 0%, var(--glow) 0%, transparent 70%),` +
            `radial-gradient(50% 40% at 100% 100%, var(--glow) 0%, transparent 70%)`,
          transition: 'background 600ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
      <div className="relative z-10 min-h-screen">{children}</div>
    </div>
  )
}
