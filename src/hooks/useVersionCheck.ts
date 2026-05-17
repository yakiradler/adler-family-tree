import { useEffect, useState } from 'react'

/**
 * Polls the server's `version.json` (written at build time by the
 * inline Vite plugin in vite.config.ts) and flips `updateAvailable`
 * to true once we see a different version than the one this bundle
 * was built with.
 *
 * Cadence:
 *   • An initial check ~5 s after mount (gives the app a moment to
 *     boot before adding any network noise).
 *   • Every 60 s while the tab is open + visible.
 *   • An immediate check whenever the tab regains focus — this is
 *     the common case for "I left the tab open overnight, come
 *     back, see the prompt".
 *
 * Server-side, version.json is excluded from the service worker's
 * cache (see public/sw.js) so the response is always fresh.
 *
 * The hook never throws — every fetch path falls back to "no
 * update" so a temporary offline / 404 / parse error never spuriously
 * prompts a refresh.
 */

interface VersionPayload {
  version?: string | null
  builtAt?: string
  offline?: boolean
}

const POLL_INTERVAL_MS = 60_000
const INITIAL_DELAY_MS = 5_000

export function useVersionCheck(): {
  updateAvailable: boolean
  serverVersion: string | null
  serverBuiltAt: string | null
} {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [serverVersion, setServerVersion] = useState<string | null>(null)
  const [serverBuiltAt, setServerBuiltAt] = useState<string | null>(null)

  useEffect(() => {
    // Resolve relative to the document base so /adler-family-tree/
    // works in production and `/` works in dev — same trick we use
    // for the manifest/icons.
    const versionUrl = new URL(
      'version.json',
      document.baseURI || window.location.href,
    ).toString()

    let cancelled = false

    const check = async () => {
      if (cancelled) return
      try {
        const res = await fetch(`${versionUrl}?t=${Date.now()}`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = (await res.json()) as VersionPayload
        if (cancelled) return
        if (data.offline) return
        if (!data.version) return
        setServerVersion(data.version)
        if (data.builtAt) setServerBuiltAt(data.builtAt)
        // Compare with the build-time constant. Inequality covers
        // both upgrades and (theoretical) rollbacks — either is a
        // version mismatch worth surfacing.
        if (data.version !== __BUILD_VERSION__) {
          setUpdateAvailable(true)
        }
      } catch {
        // Network blip — try again on the next interval.
      }
    }

    const initialId = window.setTimeout(check, INITIAL_DELAY_MS)
    const intervalId = window.setInterval(check, POLL_INTERVAL_MS)

    // Re-check the moment a user returns to the tab. Common case:
    // they left it open overnight and a deploy happened.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    return () => {
      cancelled = true
      window.clearTimeout(initialId)
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [])

  return { updateAvailable, serverVersion, serverBuiltAt }
}
