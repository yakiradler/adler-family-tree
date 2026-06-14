import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVersionCheck } from '../hooks/useVersionCheck'
import { useLang } from '../i18n/useT'

/**
 * "New version available" celebration modal.
 *
 * Pops once we detect that the server is serving a build different
 * from the one the user is currently running (see useVersionCheck).
 * Surfaces a single primary action — refresh — so the user can pick
 * up the new code without losing the place they were on (a hard
 * reload from inside the running tab is fine here: optimistic store
 * state is mirrored to localStorage on every change, so the only
 * thing they lose is in-flight scroll position).
 *
 * Confetti + firework effect:
 *   • Pure SVG + framer-motion — no new dependencies, sharp on any
 *     DPR, low memory footprint.
 *   • Confetti = 22 little coloured rectangles spawning from above,
 *     each with a random horizontal drift + slight rotation. They
 *     fall through the modal, fade as they go.
 *   • Fireworks = two SVG starbursts behind the card that scale up
 *     and fade — gives a "ta-da" feel without being noisy.
 *   • Per-version dismissal flag in localStorage so the modal doesn't
 *     re-appear on every tab focus once the user has waved it off.
 */

const DISMISSED_VERSIONS_KEY = 'ft-dismissed-versions'
const MAX_REMEMBERED = 20

function rememberDismissal(version: string) {
  try {
    const raw = window.localStorage.getItem(DISMISSED_VERSIONS_KEY)
    const list: string[] = raw ? JSON.parse(raw) : []
    if (!list.includes(version)) list.push(version)
    // Keep the list bounded; old entries fall off so this doesn't
    // grow unbounded across years of deploys.
    while (list.length > MAX_REMEMBERED) list.shift()
    window.localStorage.setItem(DISMISSED_VERSIONS_KEY, JSON.stringify(list))
  } catch { /* quota — fine, user just sees the prompt again */ }
}

function isDismissed(version: string): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISSED_VERSIONS_KEY)
    if (!raw) return false
    const list = JSON.parse(raw) as string[]
    return Array.isArray(list) && list.includes(version)
  } catch { return false }
}

const CONFETTI_COLORS = ['#FF3B30', '#FF9F0A', '#FFD60A', '#34C759', '#5AC8FA', '#0A84FF', '#BF5AF2', '#FF375F']

interface ConfettiPiece {
  id: number
  x: number              // start x (0–100 in %)
  driftX: number         // horizontal drift in px
  rotate: number         // starting rotation
  endRotate: number      // ending rotation
  delay: number          // seconds
  duration: number       // seconds
  color: string
  shape: 'rect' | 'circle'
}

function generateConfetti(count: number): ConfettiPiece[] {
  // Stable across renders for the duration of one open; otherwise the
  // CSS-keyframe analogue would restart whenever React re-rendered.
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    driftX: (Math.random() - 0.5) * 220,
    rotate: Math.random() * 360,
    endRotate: (Math.random() - 0.5) * 720,
    delay: Math.random() * 0.6,
    duration: 2.4 + Math.random() * 1.4,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
    shape: i % 3 === 0 ? 'circle' : 'rect',
  }))
}

export default function VersionUpdateModal() {
  const { updateAvailable, serverVersion } = useVersionCheck()
  const { lang } = useLang()
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Pop the modal when the version check flips to "update available" —
  // adjusted during render instead of an effect. useVersionCheck starts
  // at (false, null), so the transition is always observed.
  const [prevCheck, setPrevCheck] = useState({ updateAvailable, serverVersion })
  if (prevCheck.updateAvailable !== updateAvailable || prevCheck.serverVersion !== serverVersion) {
    setPrevCheck({ updateAvailable, serverVersion })
    if (updateAvailable && serverVersion && !isDismissed(serverVersion)) setOpen(true)
  }

  // Generate confetti once per mount — generateConfetti ignores its
  // surroundings, and a re-render mid-celebration must not re-shuffle
  // the falling bits.
  const [confetti] = useState(() => generateConfetti(28))

  const dismiss = () => {
    if (serverVersion) rememberDismissal(serverVersion)
    setOpen(false)
  }

  const refresh = () => {
    setRefreshing(true)
    // Bulletproof update: drop every cache and pull the newest service
    // worker BEFORE reloading, so a stubborn cached bundle (the "I don't
    // see my update" class of bug) can't survive. Falls through to a plain
    // reload if any step is unavailable/fails.
    void (async () => {
      try {
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map((k) => caches.delete(k)))
        }
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration()
          await reg?.update().catch(() => {})
        }
      } catch { /* best-effort — reload regardless */ }
      window.location.reload()
    })()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="version-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm no-print"
          onClick={dismiss}
        >
          {/* Confetti layer — sits behind the card so the falling
              pieces appear to come from above and "land" on the modal.
              pointer-events-none so clicks pass through to the
              backdrop's dismiss handler. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {confetti.map((p) => (
              <motion.div
                key={p.id}
                initial={{
                  x: 0,
                  y: -40,
                  rotate: p.rotate,
                  opacity: 0,
                }}
                animate={{
                  x: p.driftX,
                  y: typeof window !== 'undefined' ? window.innerHeight + 40 : 1000,
                  rotate: p.rotate + p.endRotate,
                  opacity: [0, 1, 1, 0],
                }}
                transition={{
                  duration: p.duration,
                  delay: p.delay,
                  ease: 'easeIn',
                  times: [0, 0.05, 0.85, 1],
                  repeat: Infinity,
                  repeatDelay: 0.6,
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: `${p.x}%`,
                }}
              >
                {p.shape === 'rect' ? (
                  <div
                    style={{
                      width: 10,
                      height: 14,
                      background: p.color,
                      borderRadius: 2,
                      boxShadow: `0 0 8px ${p.color}55`,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: p.color,
                      boxShadow: `0 0 10px ${p.color}66`,
                    }}
                  />
                )}
              </motion.div>
            ))}
          </div>

          {/* Card */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0, rotate: -4 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-3xl overflow-hidden bg-white shadow-2xl"
          >
            {/* Fireworks behind the header. Two stars on opposite
                corners, each scaling + fading on a long loop so the
                effect breathes without being distracting. */}
            <div className="relative h-32 bg-gradient-to-br from-[#007AFF] via-[#32ADE6] to-[#5AC8FA] overflow-hidden">
              <Firework cx={36} cy={48} color="#FFD60A" delay={0} />
              <Firework cx={220} cy={40} color="#FF7AA8" delay={0.4} />
              <Firework cx={160} cy={92} color="#FFFFFF" delay={0.8} />

              {/* Sparkle icon centre */}
              <motion.div
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.15, type: 'spring', stiffness: 280, damping: 14 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <div className="w-16 h-16 rounded-2xl bg-white/95 shadow-lg flex items-center justify-center">
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
                    <path d="M16 4l2.4 7.4 7.6.4-6 4.7 2.1 7.5L16 19.6 9.9 24l2.1-7.5-6-4.7 7.6-.4L16 4z" fill="url(#sparkle-grad)" />
                    <defs>
                      <linearGradient id="sparkle-grad" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0" stopColor="#FFD60A" />
                        <stop offset="1" stopColor="#FF9F0A" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </motion.div>
            </div>

            <div className="p-6 text-center">
              <h2 className="text-sf-title2 font-bold text-[#1C1C1E]">
                {lang === 'he' ? '✨ גרסה חדשה זמינה!' : '✨ New version available!'}
              </h2>
              <p className="text-sf-subhead text-[#636366] mt-1.5 leading-relaxed">
                {lang === 'he'
                  ? 'הוספנו תיקונים ופיצ״רים חדשים. רענן כדי לעבור לגרסה החדשה — הנתונים שלך נשמרים.'
                  : "We've shipped fixes + new features. Refresh to switch over — your data is preserved."}
              </p>

              <div className="mt-5 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={refresh}
                  disabled={refreshing}
                  className="w-full py-3 rounded-2xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-sf-subhead font-bold active:scale-[0.98] transition flex items-center justify-center gap-2 shadow-md disabled:opacity-70"
                >
                  {refreshing ? (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M2 8a6 6 0 0 1 10.2-4.2M14 8a6 6 0 0 1-10.2 4.2M12 2v3h-3M4 14v-3h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {lang === 'he' ? 'רענן עכשיו' : 'Refresh now'}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  disabled={refreshing}
                  className="w-full py-2.5 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold active:scale-[0.98] transition disabled:opacity-50"
                >
                  {lang === 'he' ? 'אחר כך' : 'Maybe later'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Single firework "starburst" — eight rays radiating from a centre,
 * scaled + faded in a loop. Pure SVG so it doesn't slow the GPU
 * compositor down on low-end phones.
 */
function Firework({ cx, cy, color, delay }: { cx: number; cy: number; color: string; delay: number }) {
  const rays = 8
  return (
    <svg
      width="80"
      height="80"
      viewBox="-40 -40 80 80"
      style={{ position: 'absolute', left: cx - 40, top: cy - 40, pointerEvents: 'none' }}
    >
      {Array.from({ length: rays }, (_, i) => {
        const angle = (i / rays) * Math.PI * 2
        const x2 = Math.cos(angle) * 28
        const y2 = Math.sin(angle) * 28
        return (
          <motion.line
            key={i}
            x1={0}
            y1={0}
            x2={x2}
            y2={y2}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            initial={{ opacity: 0, pathLength: 0 }}
            animate={{ opacity: [0, 1, 0], pathLength: [0, 1, 1] }}
            transition={{
              duration: 1.4,
              delay,
              ease: 'easeOut',
              repeat: Infinity,
              repeatDelay: 1.2,
            }}
          />
        )
      })}
      <motion.circle
        cx={0}
        cy={0}
        r={4}
        fill={color}
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale: [0, 1.4, 0], opacity: [1, 1, 0] }}
        transition={{
          duration: 1.4,
          delay,
          ease: 'easeOut',
          repeat: Infinity,
          repeatDelay: 1.2,
        }}
      />
    </svg>
  )
}
