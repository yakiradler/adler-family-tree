/*
 * Adler Family Tree — service worker
 *
 * Goals (in priority order):
 *   1. Make the app load instantly from cache on repeat visits.
 *   2. Make it survive an offline / spotty-network reload — the user
 *      can still open the app and browse their tree (writes to
 *      Supabase will fail but the optimistic store + localStorage
 *      persistence keep the UI responsive).
 *   3. Never serve a stale HTML file once a new version is deployed —
 *      we use network-first for navigations so updates land on the
 *      next page load.
 *
 * Strategy:
 *   • Hashed assets under /assets/ — cache-first (filenames change
 *     when content changes, so cached entries are immutable).
 *   • HTML navigations — network-first, fall back to the cached
 *     index when offline.
 *   • Everything else (icons, manifest, favicons) — stale-while-
 *     revalidate so a refresh picks up changes without forcing a
 *     network round-trip.
 *
 * Versioning:
 *   Bump CACHE_VERSION whenever the SW logic itself changes so old
 *   clients drop their stale caches on activate. Asset hashes already
 *   handle per-build cache busting; this is for SW upgrades only.
 */
const CACHE_VERSION = 'v1'
const CACHE_NAME = `adler-tree-${CACHE_VERSION}`

// Pre-cache the SPA entry so an offline cold-start still boots the
// shell. Other pages are reached via HashRouter, so they all share
// this one HTML file.
const APP_SHELL = ['./', './manifest.webmanifest', './favicon.svg', './icon-app.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // `{cache: 'reload'}` bypasses the HTTP cache so we don't lock
      // in a stale shell on first SW install.
      cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' })))
    ),
  )
  // Take over immediately; no need to wait for all tabs to close.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('adler-tree-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Never intercept Supabase / third-party calls — let the app
  // handle online-only behaviour for those itself.
  if (url.origin !== self.location.origin) return

  // Skip range / partial requests; respondWith can't satisfy them
  // from cache reliably.
  if (req.headers.has('range')) return

  const isHashedAsset = url.pathname.includes('/assets/')
  const isNavigation = req.mode === 'navigate'

  if (isHashedAsset) {
    // Cache-first — these are content-hashed, so the cached copy is
    // always exactly the right bytes for the version that requested
    // them.
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const clone = res.clone()
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone))
            }
            return res
          }),
      ),
    )
    return
  }

  if (isNavigation) {
    // Network-first so newly-deployed HTML lands without a manual
    // refresh storm. Fall back to the cached shell when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone))
          }
          return res
        })
        .catch(async () => {
          const cached = await caches.match(req)
          if (cached) return cached
          // SPA fallback — every route ultimately renders the shell.
          const shell = await caches.match('./')
          return (
            shell ||
            new Response('offline', {
              status: 503,
              statusText: 'offline',
              headers: { 'content-type': 'text/plain' },
            })
          )
        }),
    )
    return
  }

  // Everything else — stale-while-revalidate. Serve the cache copy
  // immediately if we have one, fetch in the background to refresh.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone))
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
