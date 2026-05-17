import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang } from '../i18n/useT'

/**
 * Add-to-Home-Screen nudge.
 *
 * On Chrome / Edge / Android (anything that fires
 * `beforeinstallprompt`) we capture the event and surface our own
 * styled banner with an "Install" button — much friendlier than the
 * generic browser chrome.
 *
 * On iOS Safari the API doesn't exist, so we show a tiny visual hint
 * pointing to the share button + "Add to Home Screen" instead. The
 * hint only renders on iOS user-agents that haven't already added the
 * app (we detect standalone mode via the navigator.standalone flag +
 * the display-mode media query).
 *
 * Dismissed state is persisted to localStorage so we don't pester a
 * user who has already said "not now". Resetting the flag is a manual
 * localStorage tweak; the prompt naturally stops appearing once the
 * app is actually installed because `beforeinstallprompt` won't fire
 * for installed PWAs and the iOS standalone check excludes the
 * post-install case.
 */

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  prompt: () => Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISS_KEY = 'ft-install-prompt-dismissed'

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // iOS sets navigator.standalone; modern browsers use the media query.
  const navStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  const mq = window.matchMedia('(display-mode: standalone)').matches
  return navStandalone || mq
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent)
}

export default function InstallPrompt() {
  const { lang } = useLang()
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOSHint, setShowIOSHint] = useState(false)
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  })

  useEffect(() => {
    if (dismissed || isStandalone()) return

    const onBefore = (e: Event) => {
      // Chrome's default behaviour is to show its own mini-banner once,
      // then hide it. Preventing the default lets us show OUR banner
      // exactly when we want to, with our own styling.
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBefore)

    // iOS gets the manual hint — but only after a small delay so it
    // doesn't slap a banner on the very first paint.
    if (isIOS()) {
      const t = setTimeout(() => setShowIOSHint(true), 4000)
      return () => {
        window.removeEventListener('beforeinstallprompt', onBefore)
        clearTimeout(t)
      }
    }

    return () => window.removeEventListener('beforeinstallprompt', onBefore)
  }, [dismissed])

  const dismiss = () => {
    try { window.localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
    setDismissed(true)
    setDeferred(null)
    setShowIOSHint(false)
  }

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    // Either way, hide the banner — accepted means installed, dismissed
    // means "not now". The browser won't re-fire beforeinstallprompt
    // for the same site for a while anyway.
    if (outcome === 'accepted') {
      // Don't persist dismissal — they accepted. We just hide the UI
      // because the app is now installed.
      setDeferred(null)
    } else {
      dismiss()
    }
  }

  // ── Render branches ────────────────────────────────────────────────
  // Nothing to render if user opted out / already installed.
  if (dismissed) return null

  // Branch A: native install prompt available (Android Chrome / Edge).
  if (deferred) {
    return (
      <AnimatePresence>
        <motion.div
          key="install-banner"
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 32 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-4 inset-x-4 z-[60] mx-auto max-w-[420px]"
        >
          <div className="glass-strong shadow-glass-lg rounded-2xl p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#007AFF] to-[#32ADE6] flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 3v10M5 9l5 5 5-5M3 17h14" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sf-subhead font-bold text-[#1C1C1E] leading-tight">
                {lang === 'he' ? 'התקן כאפליקציה' : 'Install as an app'}
              </p>
              <p className="text-[11px] text-[#636366] leading-snug truncate">
                {lang === 'he'
                  ? 'גישה מהירה ממסך הבית, גם בלי חיבור'
                  : 'Quick access from your home screen, even offline'}
              </p>
            </div>
            <button
              type="button"
              onClick={install}
              className="px-3 py-1.5 rounded-xl bg-[#007AFF] text-white text-[12px] font-bold active:scale-95 transition"
            >
              {lang === 'he' ? 'התקן' : 'Install'}
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label={lang === 'he' ? 'סגור' : 'Dismiss'}
              className="w-7 h-7 rounded-full text-[#8E8E93] hover:bg-black/5 flex items-center justify-center flex-shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    )
  }

  // Branch B: iOS hint (no programmatic install API).
  if (showIOSHint) {
    return (
      <AnimatePresence>
        <motion.div
          key="ios-hint"
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 32 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-4 inset-x-4 z-[60] mx-auto max-w-[420px]"
        >
          <div className="glass-strong shadow-glass-lg rounded-2xl p-3 flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#007AFF] to-[#32ADE6] flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 3v10M6 7l4-4 4 4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="3" y="11" width="14" height="6" rx="1.5" stroke="white" strokeWidth="1.8" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sf-subhead font-bold text-[#1C1C1E] leading-tight">
                {lang === 'he' ? 'הוסף למסך הבית' : 'Add to Home Screen'}
              </p>
              <p className="text-[11px] text-[#636366] leading-snug">
                {lang === 'he'
                  ? 'לחץ על אייקון השיתוף ⬆ ובחר "הוסף למסך הבית"'
                  : 'Tap the share icon ⬆ then "Add to Home Screen"'}
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label={lang === 'he' ? 'סגור' : 'Dismiss'}
              className="w-7 h-7 rounded-full text-[#8E8E93] hover:bg-black/5 flex items-center justify-center flex-shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    )
  }

  return null
}
