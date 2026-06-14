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
  | { kind: 'rejected'; op: string; at: number }

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
    // Server refused the write (RLS) and the optimistic change was
    // rolled back — different from remote-failed, where the change is
    // kept locally and may sync later.
    const onRejected = (e: Event) => {
      const detail = (e as CustomEvent<{ op: string }>).detail
      setState({ kind: 'rejected', op: detail?.op ?? 'unknown', at: Date.now() })
    }
    window.addEventListener('ft-saved', onSaved)
    window.addEventListener('ft-save-failed', onFailed)
    window.addEventListener('ft-supabase-failed', onRemoteFailed)
    window.addEventListener('ft-supabase-rejected', onRejected)
    return () => {
      window.removeEventListener('ft-saved', onSaved)
      window.removeEventListener('ft-save-failed', onFailed)
      window.removeEventListener('ft-supabase-failed', onRemoteFailed)
      window.removeEventListener('ft-supabase-rejected', onRejected)
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
      // Longer dwell — this one now carries a diagnostic detail line the
      // user may want to read or screenshot.
      const id = window.setTimeout(() => setState({ kind: 'idle' }), 9000)
      return () => window.clearTimeout(id)
    }
    if (state.kind === 'rejected') {
      const id = window.setTimeout(() => setState({ kind: 'idle' }), 4500)
      return () => window.clearTimeout(id)
    }
  }, [state])

  // The "rejected" toast is reused by several write paths, so its
  // wording is op-aware: a denied tree deletion reads very differently
  // from a denied profile edit.
  const rejectedOp = state.kind === 'rejected' ? state.op : ''
  const isTreeDelete = rejectedOp === 'deleteTree'
  // Adds/edits scoped to a tree the user can't write to (a viewer or a
  // test account on someone else's tree). This is the friendly form of
  // what used to surface as the scary orange "server sync failed".
  const isTreeEdit = ['addMember', 'addRelationship', 'addTree', 'updateTree'].includes(rejectedOp)
  const heText = (kind: 'saved' | 'quota' | 'unknown' | 'remote' | 'rejected'): string => {
    if (kind === 'saved') return 'נשמר'
    if (kind === 'quota') return 'אין מקום בזיכרון — תמונות הוסרו'
    if (kind === 'remote') return 'נשמר מקומית — סנכרון לשרת נכשל'
    if (kind === 'rejected') {
      if (isTreeDelete) return 'מחיקת העץ נכשלה — ייתכן שאין לך הרשאה'
      if (isTreeEdit) return 'אין לך הרשאה לערוך את העץ הזה'
      return 'השמירה נדחתה — אין לך הרשאה לערוך פרופיל זה'
    }
    return 'שגיאת שמירה'
  }
  const enText = (kind: 'saved' | 'quota' | 'unknown' | 'remote' | 'rejected'): string => {
    if (kind === 'saved') return 'Saved'
    if (kind === 'quota') return 'Storage full — photos dropped'
    if (kind === 'remote') return 'Saved locally — server sync failed'
    if (kind === 'rejected') {
      if (isTreeDelete) return "Couldn't delete the tree — you may lack permission"
      if (isTreeEdit) return "You don't have permission to edit this tree"
      return 'Save refused — you lack permission to edit this profile'
    }
    return 'Save failed'
  }
  const text = (kind: 'saved' | 'quota' | 'unknown' | 'remote' | 'rejected') => (lang === 'he' ? heText(kind) : enText(kind))

  return (
    <AnimatePresence>
      {state.kind !== 'idle' && (
        <motion.div
          key={`${state.kind}-${state.at}`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold shadow-lg no-print"
          style={
            state.kind === 'saved'
              ? { background: '#34C759', color: '#FFFFFF' }
              : state.kind === 'remote-failed'
                ? { background: '#FF9F0A', color: '#FFFFFF' }
                : { background: '#FF3B30', color: '#FFFFFF' }
          }
          role={state.kind === 'saved' ? 'status' : 'alert'}
          aria-live={state.kind === 'saved' ? 'polite' : 'assertive'}
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
          {state.kind === 'remote-failed' ? (
            // Self-diagnosing: the headline stays human-friendly, but we
            // also surface the raw server error + which write failed, so
            // a sync problem can be pinpointed (e.g. a missing column /
            // policy on the live DB) instead of guessed at.
            <span className="flex flex-col items-start leading-tight">
              <span>{text('remote')}</span>
              {state.message && state.message !== 'unknown' && (
                <span className="font-normal opacity-90 text-[10px] mt-0.5 max-w-[78vw] break-words">
                  {state.op}: {state.message}
                </span>
              )}
            </span>
          ) : state.kind === 'saved'
            ? text('saved')
            : state.kind === 'rejected'
              ? text('rejected')
              : text(state.reason === 'quota' ? 'quota' : 'unknown')}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
