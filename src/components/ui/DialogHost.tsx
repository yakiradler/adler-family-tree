import { useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { subscribeDialog, getDialog, closeDialog } from '../../lib/confirm'
import { useLang, isRTL } from '../../i18n/useT'

/**
 * Single mount point (in App.tsx) for the imperative confirm/alert dialogs
 * (see lib/confirm.ts). Renders the current request as an on-brand glass
 * modal — replacing the OS window.confirm/alert popups.
 */
export default function DialogHost() {
  const req = useSyncExternalStore(subscribeDialog, getDialog, getDialog)
  const { t, lang } = useLang()
  const rtl = isRTL(lang)

  return (
    <AnimatePresence>
      {req && (
        <motion.div
          key={req.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          dir={rtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-5"
          // Tapping the backdrop dismisses: cancel for a confirm, OK for an alert.
          onClick={() => closeDialog(req.mode === 'alert')}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 12 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-3xl bg-white shadow-glass-lg p-5 text-center"
          >
            {req.title && (
              <h2 className="text-sf-headline font-bold text-[#1C1C1E] mb-1">{req.title}</h2>
            )}
            <p className="text-sf-subhead text-[#3A3A3C] leading-relaxed whitespace-pre-wrap">
              {req.message}
            </p>
            <div className="flex gap-2 pt-4">
              {req.mode === 'confirm' && (
                <button
                  type="button"
                  onClick={() => closeDialog(false)}
                  className="flex-1 rounded-xl border border-[#E5E5EA] bg-white px-3 py-2.5 text-sf-callout font-semibold text-[#636366] active:scale-95 transition"
                >
                  {req.cancelLabel ?? t.cancel}
                </button>
              )}
              <button
                type="button"
                autoFocus
                onClick={() => closeDialog(true)}
                className={`flex-1 rounded-xl px-3 py-2.5 text-sf-callout font-semibold text-white active:scale-95 transition ${
                  req.danger ? 'bg-[#FF3B30]' : 'bg-[#007AFF]'
                }`}
              >
                {req.confirmLabel ?? (req.mode === 'alert' ? t.dialogOk : t.dialogConfirm)}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
