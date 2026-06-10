import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { LayoutIssue } from '../../../layout'
import { useLang } from '../../../i18n/useT'

/**
 * Surfaces data problems the engine demoted instead of crashing on
 * (cycles, double current-spouses, unroutable links…). The owner's
 * rule: fail VISIBLY — a reported issue beats a member silently
 * misplaced or a frozen page.
 */
export default function IssuesBanner({ issues }: { issues: LayoutIssue[] }) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  if (issues.length === 0 || dismissed) return null

  const kindLabel = (kind: LayoutIssue['kind']): string => {
    switch (kind) {
      case 'cycle': return t.treeIssueCycle
      case 'multiple-current-spouses': return t.treeIssueMultipleSpouses
      case 'invalid-edge': return t.treeIssueInvalidEdge
      case 'unroutable-edge': return t.treeIssueUnroutable
      case 'unplaced': return t.treeIssueUnplaced
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute z-30 no-print inset-x-0 top-[72px] flex justify-center pointer-events-none px-3"
    >
      <div className="pointer-events-auto max-w-md w-full bg-[#FFF8E6]/95 border border-[#FF9F0A]/40 rounded-2xl shadow-glass overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <span className="w-6 h-6 rounded-full bg-[#FF9F0A]/15 flex items-center justify-center flex-shrink-0">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L15 14H1L8 2z" stroke="#FF9F0A" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M8 7v3M8 12.2v.2" stroke="#FF9F0A" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex-1 text-start text-[12px] font-bold text-[#7A5300]"
          >
            {t.treeIssuesTitle.replace('{count}', String(issues.length))}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={t.treeMenuClose}
            className="w-6 h-6 rounded-full hover:bg-black/5 flex items-center justify-center text-[#7A5300]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <AnimatePresence>
          {open && (
            <motion.ul
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="overflow-hidden border-t border-[#FF9F0A]/20"
            >
              {issues.map((issue, i) => (
                <li key={i} className="px-4 py-2 text-[11.5px] text-[#7A5300] border-b border-[#FF9F0A]/10 last:border-b-0">
                  <span className="font-bold">{kindLabel(issue.kind)}</span>
                  <span className="block text-[10.5px] opacity-80 mt-0.5" dir="auto">{issue.message}</span>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
