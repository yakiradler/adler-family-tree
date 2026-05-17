import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

// Single source of truth for the build version: a unix timestamp
// captured at config-resolution time. Same value is embedded in the
// JS bundle (via `define`) AND written out as version.json next to
// the bundle (via the inline plugin below) so the client can
// compare its own baked-in version against what the server is
// currently serving and surface an "update available" prompt.
const BUILD_VERSION = String(Date.now())
const BUILT_AT_ISO = new Date().toISOString()

/**
 * Inline plugin — writes dist/version.json on every build. The file
 * is tiny (~80 bytes) and lets the running app poll for new deploys
 * without pulling the whole HTML and parsing script tags. The
 * service worker is configured to bypass its cache for this path so
 * the response is always fresh.
 */
function writeVersionJsonPlugin(): Plugin {
  return {
    name: 'adler-tree:write-version-json',
    apply: 'build',
    closeBundle() {
      const outFile = resolve(__dirname, 'dist', 'version.json')
      mkdirSync(dirname(outFile), { recursive: true })
      writeFileSync(
        outFile,
        JSON.stringify(
          { version: BUILD_VERSION, builtAt: BUILT_AT_ISO },
          null,
          2,
        ),
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), writeVersionJsonPlugin()],
  base: process.env.GITHUB_ACTIONS ? '/adler-family-tree/' : '/',
  define: {
    // Available in source as `__BUILD_VERSION__` / `__BUILT_AT__`.
    // See src/types/global.d.ts for the type declarations.
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
    __BUILT_AT__: JSON.stringify(BUILT_AT_ISO),
  },
})
