import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Separate Vitest config — the project's main vite.config.ts pulls
// the Rolldown-backed Vite, while Vitest bundles a different Vite
// build, and TypeScript can't reconcile the two Plugin types. Kept
// here so the boundary is explicit and the production build config
// stays untouched.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/main.tsx', 'src/types/**'],
    },
  },
})
