import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang } from '../i18n/useT'

/**
 * Lightweight "saved" / "save failed" toast that listens to the
 * persistence events the App-level localStorage subscriber dispatches.
 *
 * The user reported "nothing persists across refresh" while the under-
 * lying writes were actually succeeding — there was no visual
 * confirmation, so a successful write was indistinguishable from a
 * silent failure. This component closes that gap:
 *
 *   • `ft-saved`        → green pill "נשמר" for ~1.4s
 *   • `ft-save-failed`  → red pill "שגיאת שמירה" until dismissed,
 *                          with an explanatory hint (quota / unknown)
 */
type State =
  | { kind: 'idle' }
  | { kind: 'saved'; at: number }
  | { kind: 'failed'; reason: 'quota' | 'unknown'; at: number }

export default function PersistenceIndicator() {
  const { lang } = useLang()
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => {
    const onSaved = () => setState({ kind: 'saved', at: Date.now() })
    const onFailed = (e: Event) => {
      const reason = (e as CustomEvent<{ reason: 'quota' | 'unknown' }>).detail?.reason ?? 'unknown'
      setState({ kind: 'failed', reason, at: Date.now() })
    }
    window.addEventListener('ft-saved', onSaved)
    window.addEventListener('ft-save-failed', onFailed)
    return () => {
      window.removeEventListener('ft-saved', onSaved)
      window.removeEventListener('ft-save-failed', onFailed)
    }
  }, [])

  // Auto-dismiss the green toast after a moment.
  useEffect(() => {
    if (state.kind !== 'saved') return
    const id = window.setTimeout(() => setState({ kind: 'idle' }), 1400)
    return () => window.clearTimeout(id)
  }, [state])

  const heText = (kind: 'saved' | 'quota' | 'unknown'): string => {
    if (kind === 'saved') return 'נשמר'
    if (kind === 'quota') return 'אין מקום בזיכרון — תמונות הוסרו'
    return 'שגיאת שמירה'
  }
  const enText = (kind: 'saved' | 'quota' | 'unknown'): string => {
    if (kind === 'saved') return 'Saved'
    if (kind === 'quota') return 'Storage full — photos dropped'
    return 'Save failed'
  }
  const text = (kind: 'saved' | 'quota' | 'unknown') => (lang === 'he' ? heText(kind) : enText(kind))

  return (
    <AnimatePresence>
      {state.kind !== 'idle' && (
        <motion.div
          key={`${state.kind}-${state.at}`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold shadow-lg"
          style={
            state.kind === 'saved'
              ? { background: '#34C759', color: '#FFFFFF' }
              : { background: '#FF3B30', color: '#FFFFFF' }
          }
          role={state.kind === 'failed' ? 'alert' : 'status'}
          aria-live={state.kind === 'failed' ? 'assertive' : 'polite'}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            {state.kind === 'saved' ? (
              <path d="M2.5 6.5l2.5 2.5L9.5 4" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M2 2l8 8M10 2l-8 8" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
            )}
          </svg>
          {state.kind === 'saved'
            ? text('saved')
            : text(state.reason === 'quota' ? 'quota' : 'unknown')}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
