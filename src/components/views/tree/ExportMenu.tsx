import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Translations } from '../../../i18n/useT'
import type { LayoutResult } from '../../../layout'
import Tooltip from '../../Tooltip'
import { exportTreeAsPNG, printTree } from '../../../lib/treeExport'

/**
 * Floating "Export" button + popover (print → PDF, or PNG download).
 * Anchored bottom-right above the zoom controls; hidden during print.
 */
export default function ExportMenu({
  t,
  result,
  title,
}: {
  t: Translations
  result: LayoutResult
  title: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const doPNG = async () => {
    if (busy) return
    setBusy(true)
    setOpen(false)
    try {
      await exportTreeAsPNG({ result, title })
    } finally {
      setBusy(false)
    }
  }

  const doPrint = () => {
    setOpen(false)
    // Defer one tick so the popover's close animation doesn't end up
    // in the printed snapshot — and so the no-print CSS has settled.
    setTimeout(() => printTree(), 50)
  }

  return (
    <div className="absolute bottom-4 right-4 z-20 no-print" style={{ transform: 'translateY(-196px)' }}>
      <div className="relative">
        <AnimatePresence>
          {open && (
            <motion.div
              key="export-popover"
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="absolute bottom-12 right-0 w-52 glass-strong shadow-glass-lg rounded-2xl p-1.5 flex flex-col gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={doPrint}
                disabled={busy}
                className="flex items-center gap-2 w-full px-2.5 py-2 rounded-xl text-start hover:bg-[#007AFF]/10 transition disabled:opacity-50"
              >
                <span className="w-7 h-7 rounded-lg bg-[#007AFF]/10 flex items-center justify-center flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect x="3" y="2" width="10" height="5" stroke="#007AFF" strokeWidth="1.4" />
                    <rect x="2" y="7" width="12" height="5" rx="1" stroke="#007AFF" strokeWidth="1.4" />
                    <rect x="4" y="10" width="8" height="4" stroke="#007AFF" strokeWidth="1.4" />
                  </svg>
                </span>
                <span className="text-[12px] font-semibold text-[#1C1C1E]">{t.exportPrint}</span>
              </button>
              <button
                type="button"
                onClick={doPNG}
                disabled={busy}
                className="flex items-center gap-2 w-full px-2.5 py-2 rounded-xl text-start hover:bg-[#34C759]/10 transition disabled:opacity-50"
              >
                <span className="w-7 h-7 rounded-lg bg-[#34C759]/12 flex items-center justify-center flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="#34C759" strokeWidth="1.4" />
                    <circle cx="6" cy="7" r="1.2" fill="#34C759" />
                    <path d="M2 11l3.5-3 3 2.5L11 7l3 3v3H2v-2z" fill="#34C759" fillOpacity="0.35" />
                  </svg>
                </span>
                <span className="text-[12px] font-semibold text-[#1C1C1E]">{t.exportPNG}</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <Tooltip content={t.tipExport} placement="left">
          <motion.button
            type="button"
            whileTap={{ scale: 0.93 }}
            onClick={() => setOpen((o) => !o)}
            aria-label={t.exportBtn}
            className="w-10 h-10 rounded-full glass-strong shadow-glass flex items-center justify-center active:scale-95 transition relative"
          >
            {busy ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#007AFF" strokeOpacity="0.3" strokeWidth="3" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="#007AFF" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v8M5 7l3 3 3-3" stroke="#007AFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" stroke="#007AFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </motion.button>
        </Tooltip>
      </div>
    </div>
  )
}
