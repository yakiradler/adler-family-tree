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
  | { kind: 'remote-failed'; op: string; message: string; at: number }

export default function PersistenceIndicator() {
  const { lang } = useLang()
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => {
    const onSaved = () => setState({ kind: 'saved', at: Date.now() })
    const onFailed = (e: Event) => {
      const reason = (e as CustomEvent<{ reason: 'quota' | 'unknown' }>).detail?.reason ?? 'unknown'
      setState({ kind: 'failed', reason, at: Date.now() })
    }
    // Supabase write failure — the change is kept locally (so the
    // current session looks fine) but it didn't propagate to the
    // backend, so a different device or a cache-cleared refresh
    // would not see it. Surface this so the user can take action
    // (re-login, ask admin to fix RLS, etc.).
    const onRemoteFailed = (e: Event) => {
      const detail = (e as CustomEvent<{ op: string; message: string }>).detail
      setState({
        kind: 'remote-failed',
        op: detail?.op ?? 'unknown',
        message: detail?.message ?? 'unknown',
        at: Date.now(),
      })
    }
    window.addEventListener('ft-saved', onSaved)
    window.addEventListener('ft-save-failed', onFailed)
    window.addEventListener('ft-supabase-failed', onRemoteFailed)
    return () => {
      window.removeEventListener('ft-saved', onSaved)
      window.removeEventListener('ft-save-failed', onFailed)
      window.removeEventListener('ft-supabase-failed', onRemoteFailed)
    }
  }, [])

  // Auto-dismiss the green toast after a moment. The remote-failed
  // toast also auto-dismisses after a longer pause so it's noticeable
  // but doesn't pin the screen.
  useEffect(() => {
    if (state.kind === 'saved') {
      const id = window.setTimeout(() => setState({ kind: 'idle' }), 1400)
      return () => window.clearTimeout(id)
    }
    if (state.kind === 'remote-failed') {
      const id = window.setTimeout(() => setState({ kind: 'idle' }), 4500)
      return () => window.clearTimeout(id)
    }
  }, [state])

  const heText = (kind: 'saved' | 'quota' | 'unknown' | 'remote'): string => {
    if (kind === 'saved') return 'נשמר'
    if (kind === 'quota') return 'אין מקום בזיכרון — תמונות הוסרו'
    if (kind === 'remote') return 'נשמר מקומית — סנכרון לשרת נכשל'
    return 'שגיאת שמירה'
  }
  const enText = (kind: 'saved' | 'quota' | 'unknown' | 'remote'): string => {
    if (kind === 'saved') return 'Saved'
    if (kind === 'quota') return 'Storage full — photos dropped'
    if (kind === 'remote') return 'Saved locally — server sync failed'
    return 'Save failed'
  }
  const text = (kind: 'saved' | 'quota' | 'unknown' | 'remote') => (lang === 'he' ? heText(kind) : enText(kind))

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
              : state.kind === 'remote-failed'
                ? { background: '#FF9F0A', color: '#FFFFFF' }
                : { background: '#FF3B30', color: '#FFFFFF' }
          }
          role={state.kind === 'failed' || state.kind === 'remote-failed' ? 'alert' : 'status'}
          aria-live={state.kind === 'failed' || state.kind === 'remote-failed' ? 'assertive' : 'polite'}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            {state.kind === 'saved' ? (
              <path d="M2.5 6.5l2.5 2.5L9.5 4" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            ) : state.kind === 'remote-failed' ? (
              <path d="M6 3v3.5M6 8.2v.3" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
            ) : (
              <path d="M2 2l8 8M10 2l-8 8" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
            )}
          </svg>
          {state.kind === 'saved'
            ? text('saved')
            : state.kind === 'remote-failed'
              ? text('remote')
              : text(state.reason === 'quota' ? 'quota' : 'unknown')}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
