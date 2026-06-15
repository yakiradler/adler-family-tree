import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang, isRTL } from '../../i18n/useT'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useCloseOnBack } from '../../hooks/useCloseOnBack'
import type { FeedbackCategory } from '../../types'

/**
 * "Report to the admin" form, reachable from the help "?" menu. Saves
 * through the optimistic feedback store action, so it works in demo
 * mode too; in production the row lands in the `feedback` table and
 * surfaces in the admin dashboard's "reports" tab.
 */
export default function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const { profile, addFeedback } = useFamilyStore()
  const [category, setCategory] = useState<FeedbackCategory>('bug')
  const [body, setBody] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  // Phone back button closes the form instead of leaving the page.
  useCloseOnBack(open, onClose)

  const handleClose = () => {
    onClose()
    // Reset AFTER the exit animation would have hidden the content.
    window.setTimeout(() => { setSent(false); setFailed(false); setBody(''); setCategory('bug') }, 250)
  }

  const submit = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    setFailed(false)
    try {
      const ok = await addFeedback({
        author_id: profile?.id ?? null,
        author_name: profile?.full_name ?? 'אנונימי',
        category,
        body: body.trim(),
        context: window.location.hash || null,
      })
      if (ok) setSent(true)
      else setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          dir={rtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-white shadow-glass-lg p-5 space-y-4"
          >
            {sent ? (
              <div className="flex flex-col items-center text-center gap-3 py-4">
                <span className="w-14 h-14 rounded-full bg-[#34C759]/12 flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#34C759" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <p className="text-sf-headline font-bold text-[#1C1C1E]">{t.feedbackSent}</p>
                  <p className="text-[12px] text-[#8E8E93] mt-1 leading-relaxed">{t.feedbackSentDesc}</p>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-1 w-full py-2.5 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold"
                >
                  {t.faqClose}
                </button>
              </div>
            ) : (
              <>
                <header className="flex items-center justify-between">
                  <h2 className="text-sf-headline font-bold text-[#1C1C1E]">{t.feedbackTitle}</h2>
                  <button
                    type="button"
                    onClick={handleClose}
                    aria-label={t.faqClose}
                    className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#636366] active:scale-95 transition"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 2L10 10M10 2L2 10" stroke="#636366" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </header>
                <p className="text-[12px] text-[#8E8E93] -mt-2 leading-relaxed">{t.feedbackDesc}</p>

                <div className="bg-[#F2F2F7] rounded-xl p-1 flex gap-1">
                  {([
                    ['bug', t.feedbackCategoryBug],
                    ['question', t.feedbackCategoryQuestion],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setCategory(key)}
                      className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition ${
                        category === key ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#636366]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <textarea
                  autoFocus
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={category === 'bug' ? t.feedbackPlaceholderBug : t.feedbackPlaceholderQuestion}
                  rows={5}
                  className="w-full rounded-2xl bg-[#F2F2F7] px-3.5 py-3 text-[13px] text-[#1C1C1E] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]/40 resize-none"
                />

                {failed && (
                  <p className="text-[12px] text-[#FF3B30] text-center -mb-1">{t.feedbackError}</p>
                )}

                <button
                  type="button"
                  onClick={submit}
                  disabled={!body.trim() || busy}
                  className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-sf-subhead font-bold disabled:opacity-40 active:scale-[0.98] transition"
                >
                  {busy ? '…' : (failed ? t.feedbackRetry : t.feedbackSend)}
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
