import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'

/**
 * One-time explainer for edit mode. The four per-card "+" buttons are
 * compact by design, which left first-time editors guessing which
 * relative each one adds (owner request: "make it clear what every
 * plus does"). This balloon pops every time edit mode turns ON until
 * the user explicitly confirms with "got it" — after that it never
 * returns (localStorage flag), keeping repeat editing friction-free.
 */
const DISMISS_KEY = 'ft-editmode-coach-dismissed'

function alreadyDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    // Private mode — show it, worst case it repeats.
    return false
  }
}

export default function EditModeCoachMark() {
  const isEditMode = useFamilyStore((s) => s.isEditMode)
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  // Visible whenever edit mode turns ON and the user hasn't confirmed
  // yet. Adjusted during render (same pattern as TreeSearchModal's
  // open-reset) instead of an effect — react-hooks v7 forbids the
  // setState-in-effect version.
  const [visible, setVisible] = useState(() => isEditMode && !alreadyDismissed())
  const [prevEdit, setPrevEdit] = useState(isEditMode)
  if (isEditMode !== prevEdit) {
    setPrevEdit(isEditMode)
    setVisible(isEditMode && !alreadyDismissed())
  }

  const dismiss = () => {
    try { window.localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore quota */ }
    setVisible(false)
  }

  // Direction glyphs are tiny inline SVGs (no emoji per code style).
  // SVG paths do NOT mirror with dir=rtl, so the side arrows are picked
  // per language to match the labels: sibling sits at inline-START
  // (right in Hebrew, left in English), spouse at inline-END.
  const ARROW_RIGHT = 'M3 7h8M7.5 3.5L11 7l-3.5 3.5'
  const ARROW_LEFT = 'M11 7H3M6.5 3.5L3 7l3.5 3.5'
  const rows: { key: string; label: string; arrow: string }[] = [
    { key: 'parent',  label: t.editCoachParent,  arrow: 'M7 11V3M3.5 6.5L7 3l3.5 3.5' },
    { key: 'child',   label: t.editCoachChild,   arrow: 'M7 3v8M3.5 7.5L7 11l3.5-3.5' },
    { key: 'sibling', label: t.editCoachSibling, arrow: rtl ? ARROW_RIGHT : ARROW_LEFT },
    { key: 'spouse',  label: t.editCoachSpouse,  arrow: rtl ? ARROW_LEFT : ARROW_RIGHT },
  ]

  return (
    <AnimatePresence>
      {visible && (
        // Flex wrapper instead of translate-centring — framer-motion owns
        // the card's transform for the entry animation.
        <div className="fixed inset-x-0 bottom-[128px] z-[70] flex justify-center px-4 pointer-events-none no-print">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto w-full max-w-[340px] rounded-3xl bg-white/95 backdrop-blur-2xl border border-white/60 shadow-glass-lg p-4 space-y-3"
            role="dialog"
            aria-label={t.editCoachTitle}
          >
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-[#007AFF]/10 flex items-center justify-center flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2v10M2 7h10" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <div>
                <p className="text-sf-subhead font-bold text-[#1C1C1E]">{t.editCoachTitle}</p>
                <p className="text-[11px] text-[#8E8E93] leading-snug">{t.editCoachIntro}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              {rows.map((row) => (
                <div key={row.key} className="flex items-center gap-2.5 rounded-xl bg-[#F2F2F7] px-3 py-2">
                  <span className="relative w-6 h-6 rounded-full bg-white ring-1 ring-[#007AFF]/25 text-[#007AFF] flex items-center justify-center flex-shrink-0">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d={row.arrow} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="text-[12px] font-semibold text-[#3C3C43] leading-snug">{row.label}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-sf-subhead font-bold active:scale-[0.98] transition"
            >
              {t.editCoachGotIt}
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
