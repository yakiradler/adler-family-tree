import { useLang, isRTL } from '../i18n/useT'

/**
 * Visible "you're on a non-production deployment" banner.
 *
 * Visible whenever the running build is not production. Detection
 * uses (in priority order):
 *   1. VITE_APP_ENV env var — explicit override. Set to "production"
 *      in Vercel's Production environment, anything else (or unset)
 *      in Preview / Development.
 *   2. import.meta.env.DEV — true on `npm run dev` locally.
 *   3. Hostname heuristic — anything other than the bare production
 *      domain is treated as non-production. Conservative: if the env
 *      var isn't configured yet, the banner errs on the side of
 *      "warn the user".
 *
 * The banner shows BOTH the env name and a short reassurance:
 * "this is the sandbox, family data is isolated". That second line
 * relies on Vercel having distinct Supabase creds per environment —
 * see DEVELOPMENT.md for the one-time setup.
 */

const PRODUCTION_HOSTS = new Set([
  'infinitree.vercel.app',
  // Add a custom production domain here when one's wired up.
])

function detectEnv(): 'production' | 'preview' | 'development' {
  const explicit = (import.meta.env as Record<string, string | undefined>).VITE_APP_ENV
  if (explicit === 'production') return 'production'
  if (explicit === 'preview') return 'preview'
  if (explicit === 'development') return 'development'

  if (import.meta.env.DEV) return 'development'

  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (PRODUCTION_HOSTS.has(host)) return 'production'
    // Vercel-style preview hostnames look like:
    //   infinitree-<branch-hash>-yakiradler.vercel.app
    if (host.endsWith('.vercel.app')) return 'preview'
  }

  // Default: be cautious — if we can't tell, surface the banner so a
  // mis-deployed build never silently masquerades as production.
  return 'preview'
}

export default function DevEnvBanner() {
  const { lang } = useLang()
  const rtl = isRTL(lang)
  const env = detectEnv()

  if (env === 'production') return null

  const isLocal = env === 'development'
  const bg = isLocal ? 'bg-[#FF9F0A]' : 'bg-[#FF453A]'
  const label = isLocal
    ? (rtl ? 'סביבת פיתוח מקומית' : 'Local Development')
    : (rtl ? 'סביבת בדיקה (Preview)' : 'Preview / Staging')
  const reassurance = rtl
    ? 'נתוני המשפחה האמיתיים מוגנים — סביבה זו מבודדת.'
    : 'Real family data is safe — this environment is isolated.'

  return (
    <div
      role="status"
      dir={rtl ? 'rtl' : 'ltr'}
      className={`${bg} text-white text-center text-[11px] font-semibold py-1 px-3 flex items-center justify-center gap-2 select-none`}
      style={{ letterSpacing: 0.2 }}
    >
      <span>🧪 {label}</span>
      <span className="opacity-80 hidden sm:inline">·</span>
      <span className="opacity-90 hidden sm:inline">{reassurance}</span>
    </div>
  )
}
