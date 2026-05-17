import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the PWA service worker — production only. We skip it in
// dev because Vite's HMR and service-worker caching fight each other
// (the SW serves a stale chunk, HMR injects a fresh one, the page
// gets a chunk-mismatch error). `import.meta.env.BASE_URL` is `/` in
// dev and `/adler-family-tree/` on gh-pages, so the SW lands beside
// `manifest.webmanifest` with the correct scope automatically.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`
    navigator.serviceWorker
      .register(swUrl, { scope: import.meta.env.BASE_URL })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[sw] registration failed:', err)
      })
  })
}
