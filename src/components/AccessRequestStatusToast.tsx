import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import { isAdmin } from '../lib/permissions'
import { isSupabaseConfigured } from '../lib/supabase'

/**
 * Requester-side feedback for access requests.
 *
 * The admin's approval used to be invisible to the person who asked —
 * the request row flipped to `approved` server-side and nothing ever
 * told them (pilot bug: "אישרתי בקשת שיתוף אבל הוא לא קיבל שום
 * פידבק"). This banner closes the loop: on dashboard load it pulls
 * the user's own requests (RLS already scopes non-admins to their own
 * rows), and any decision newer than the last acknowledged one gets a
 * one-time banner. Approvals also refresh trees + access so the newly
 * shared tree appears in the rail behind the banner immediately.
 */
const ACK_KEY = 'ft-access-request-ack'

export default function AccessRequestStatusToast() {
  const { lang } = useLang()
  const profile = useFamilyStore((s) => s.profile)
  const accessRequests = useFamilyStore((s) => s.accessRequests)
  const fetchAccessRequests = useFamilyStore((s) => s.fetchAccessRequests)
  const fetchTrees = useFamilyStore((s) => s.fetchTrees)
  const fetchMyTreeAccess = useFamilyStore((s) => s.fetchMyTreeAccess)
  const fetchMembers = useFamilyStore((s) => s.fetchMembers)
  const fetchRelationships = useFamilyStore((s) => s.fetchRelationships)
  const [dismissed, setDismissed] = useState(false)

  // Pull my requests once per dashboard mount. Admins skip — they see
  // the queue itself, and their store slice holds everyone's requests
  // (which must not trip the "your request was decided" banner).
  useEffect(() => {
    if (!isSupabaseConfigured || !profile || isAdmin(profile)) return
    fetchAccessRequests()
  }, [profile, fetchAccessRequests])

  // Derived, not stored: the newest decision the user hasn't seen yet.
  // localStorage is only READ here; the ack write happens in the
  // effect below, after the banner actually rendered.
  const pendingNotice = useMemo(() => {
    if (!profile || isAdmin(profile)) return null
    let ackIso = ''
    try { ackIso = window.localStorage.getItem(ACK_KEY) ?? '' } catch { /* ignore */ }
    const fresh = accessRequests.filter(
      (r) =>
        r.requester_id === profile.id &&
        r.status !== 'pending' &&
        r.decided_at &&
        (!ackIso || (r.decided_at as string) > ackIso),
    )
    if (fresh.length === 0) return null
    return {
      // Approval outranks rejection so a mixed batch leads with the
      // good news (the tree IS available).
      decision: fresh.some((r) => r.status === 'approved') ? ('approved' as const) : ('rejected' as const),
      latestIso: fresh.map((r) => r.decided_at as string).sort().at(-1)!,
    }
  }, [accessRequests, profile])

  // Once a fresh decision is on screen: acknowledge it (so it shows
  // exactly once), hydrate the newly granted tree, and auto-dismiss.
  useEffect(() => {
    if (!pendingNotice) return
    try { window.localStorage.setItem(ACK_KEY, pendingNotice.latestIso) } catch { /* ignore */ }
    if (pendingNotice.decision === 'approved') {
      fetchTrees(); fetchMyTreeAccess(); fetchMembers(); fetchRelationships()
    }
    const id = window.setTimeout(() => setDismissed(true), 8000)
    return () => window.clearTimeout(id)
  }, [pendingNotice, fetchTrees, fetchMyTreeAccess, fetchMembers, fetchRelationships])

  const decision = !dismissed ? pendingNotice?.decision ?? null : null

  const text =
    decision === 'approved'
      ? (lang === 'he'
          ? '🎉 הבקשה שלך אושרה! העץ זמין עכשיו בחשבון שלך'
          : '🎉 Your request was approved! The tree is now available in your account')
      : (lang === 'he'
          ? 'הבקשה שלך נדחתה. אפשר לפנות למנהל המשפחה לפרטים.'
          : 'Your request was declined. Contact the family admin for details.')

  return (
    <AnimatePresence>
      {decision && (
        <motion.button
          type="button"
          onClick={() => setDismissed(true)}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="fixed top-12 left-1/2 -translate-x-1/2 z-[190] max-w-[92vw] rounded-2xl px-4 py-2.5 text-[12.5px] font-bold shadow-xl no-print"
          style={
            decision === 'approved'
              ? { background: '#34C759', color: '#FFFFFF' }
              : { background: '#FF9F0A', color: '#FFFFFF' }
          }
          role="alert"
          aria-live="assertive"
        >
          {text}
        </motion.button>
      )}
    </AnimatePresence>
  )
}
