import { motion, AnimatePresence } from 'framer-motion'
import { useLang } from '../i18n/useT'

/**
 * Friendly "this feature is on the way" modal.
 *
 * We render the entry points for AI-powered features (build a tree
 * from prose, upscale + colourise old photos) NOW so the user can
 * see them on the Dashboard and on every profile, but the actions
 * themselves rely on a backend that isn't wired yet (Edge Function +
 * external model). Tapping the placeholder pops this modal explaining
 * what's coming and roughly when.
 *
 * Reused across the Dashboard tiles and the per-profile action
 * buttons so the messaging stays consistent. The icon + colour are
 * passed in so each feature gets its own visual identity.
 */

interface Props {
  open: boolean
  onClose: () => void
  /** Big emoji at the top of the modal. */
  icon: string
  /** Localised title — e.g. "בנה עץ מטקסט". */
  title: string
  /** 2-3 line plain-language summary of what the feature will do. */
  description: string
  /** Optional bullet list of capabilities. */
  bullets?: string[]
  /** Tailwind gradient classes for the header banner.  */
  gradient?: string
}

export default function ComingSoonModal({
  open,
  onClose,
  icon,
  title,
  description,
  bullets,
  gradient = 'from-[#5E5CE6] to-[#BF5AF2]',
}: Props) {
  const { lang } = useLang()

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm no-print"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.85, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-3xl bg-white shadow-2xl overflow-hidden"
          >
            {/* Header banner with the feature's icon + a "Coming
                Soon" ribbon in the top corner. */}
            <div className={`relative h-28 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
              <motion.span
                initial={{ scale: 0, rotate: -15 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.08, type: 'spring', stiffness: 280, damping: 14 }}
                className="text-5xl"
                aria-hidden
              >
                {icon}
              </motion.span>
              <div className="absolute top-3 end-3 rounded-full bg-white/95 px-2.5 py-1 text-[10.5px] font-bold text-[#5E5CE6] shadow">
                {lang === 'he' ? 'בקרוב 🚀' : 'Coming soon 🚀'}
              </div>
            </div>

            <div className="p-6 text-center">
              <h2 className="text-sf-title2 font-bold text-[#1C1C1E]">{title}</h2>
              <p className="text-sf-subhead text-[#636366] leading-relaxed mt-2">
                {description}
              </p>
              {bullets && bullets.length > 0 && (
                <ul className="text-sf-footnote text-[#3C3C43] mt-4 space-y-1.5 text-start max-w-xs mx-auto">
                  {bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-[#34C759] mt-0.5">✓</span>
                      <span className="flex-1">{b}</span>
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                onClick={onClose}
                className="mt-5 w-full py-3 rounded-2xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-sf-subhead font-bold active:scale-[0.98] transition shadow-md"
              >
                {lang === 'he' ? 'הבנתי, אחכה' : "Got it, I'll wait"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
