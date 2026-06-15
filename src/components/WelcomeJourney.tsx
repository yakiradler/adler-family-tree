import { useRef, useState, type TouchEvent as ReactTouchEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang, isRTL } from '../i18n/useT'
import { markWelcomeJourneySeen } from '../lib/welcomeJourney'

/**
 * First-login WELCOME JOURNEY — a one-time, multi-screen intro carousel
 * that walks a brand-new user across the whole app (tree → add relatives
 * → profile → social → notifications) before they dive in. This is the
 * cross-app "first experience"; the per-page 🎓 tutorials (TutorialOverlay)
 * stay for on-demand detail.
 *
 * Shown once per device via a localStorage flag. Swipe or tap to advance.
 */
interface Slide { icon: string; title: string; body: string; grad: string }

export default function WelcomeJourney({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const [i, setI] = useState(0)
  const [dir, setDir] = useState(1)
  const startX = useRef<number | null>(null)

  const slides: Slide[] = [
    { icon: '👋', title: t.welcomeJ1Title, body: t.welcomeJ1Body, grad: 'from-[#007AFF] to-[#5E5CE6]' },
    { icon: '🌳', title: t.welcomeJ2Title, body: t.welcomeJ2Body, grad: 'from-[#34C759] to-[#30D158]' },
    { icon: '➕', title: t.welcomeJ3Title, body: t.welcomeJ3Body, grad: 'from-[#FF9F0A] to-[#FFD60A]' },
    { icon: '👤', title: t.welcomeJ4Title, body: t.welcomeJ4Body, grad: 'from-[#5AC8FA] to-[#64D2FF]' },
    { icon: '💬', title: t.welcomeJ5Title, body: t.welcomeJ5Body, grad: 'from-[#AF52DE] to-[#5E5CE6]' },
    { icon: '🔔', title: t.welcomeJ6Title, body: t.welcomeJ6Body, grad: 'from-[#FF2D55] to-[#FF9500]' },
  ]
  const last = i === slides.length - 1

  const finish = () => { markWelcomeJourneySeen(); onClose() }
  const go = (next: number) => {
    if (next < 0 || next >= slides.length) { if (next >= slides.length) finish(); return }
    setDir(next > i ? 1 : -1)
    setI(next)
  }
  const onTouchStart = (e: ReactTouchEvent) => { startX.current = e.touches[0].clientX }
  const onTouchEnd = (e: ReactTouchEvent) => {
    if (startX.current == null) return
    const dx = e.changedTouches[0].clientX - startX.current
    startX.current = null
    if (Math.abs(dx) < 45) return
    // In RTL the swipe direction is mirrored.
    const forward = rtl ? dx > 0 : dx < 0
    go(forward ? i + 1 : i - 1)
  }

  const s = slides[i]
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-sm p-4"
          dir={rtl ? 'rtl' : 'ltr'}
        >
          <motion.div
            initial={{ y: 30, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md bg-white rounded-3xl shadow-glass-lg overflow-hidden"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div className="flex justify-end p-3 pb-0">
              <button type="button" onClick={finish} className="text-[12px] font-semibold text-[#8E8E93] hover:text-[#1C1C1E] px-2 py-1">
                {t.welcomeJSkip}
              </button>
            </div>

            <div className="px-6 pb-2 min-h-[230px] flex flex-col items-center text-center justify-center">
              <AnimatePresence mode="wait" custom={dir}>
                <motion.div
                  key={i}
                  custom={dir}
                  initial={{ opacity: 0, x: dir * 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: dir * -40 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="flex flex-col items-center"
                >
                  <div className={`w-20 h-20 rounded-3xl bg-gradient-to-br ${s.grad} flex items-center justify-center text-4xl shadow-lg mb-4`}>
                    {s.icon}
                  </div>
                  <h2 className="text-sf-title2 font-extrabold text-[#1C1C1E] mb-2" style={{ fontSize: 22 }}>{s.title}</h2>
                  <p className="text-sf-subhead text-[#3C3C43] leading-relaxed px-2">{s.body}</p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Dots */}
            <div className="flex justify-center gap-1.5 py-3">
              {slides.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => go(idx)}
                  aria-label={`${idx + 1}`}
                  className={`h-2 rounded-full transition-all ${idx === i ? 'w-6 bg-[#007AFF]' : 'w-2 bg-[#D1D1D6]'}`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2 p-4 pt-1">
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => go(i - 1)}
                  className="px-4 py-3 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold active:scale-[0.98] transition"
                >
                  {t.welcomeJBack}
                </button>
              )}
              <button
                type="button"
                onClick={() => (last ? finish() : go(i + 1))}
                className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-sf-subhead font-bold active:scale-[0.98] transition shadow-md"
              >
                {last ? t.welcomeJStart : t.welcomeJNext}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
