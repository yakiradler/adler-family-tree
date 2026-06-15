import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang } from '../../i18n/useT'
import { notificationDisplay } from '../../lib/notifications'

/**
 * Transient pop-up for a freshly-arrived notification. The bell panel is
 * passive (you have to open it); this surfaces a new unread notification
 * the moment polling picks it up, so the admin actually notices. Tapping
 * an admin-actionable toast jumps to /admin. Auto-dismisses after 6s.
 *
 * Mounted once inside the router (so it can navigate). It records the
 * notification ids present on first render as "already seen" so the
 * existing backlog doesn't toast on load — only genuinely new arrivals.
 */
export default function NotificationToast() {
  const notifications = useFamilyStore((s) => s.notifications)
  const { t } = useLang()
  const navigate = useNavigate()
  const seen = useRef<Set<string> | null>(null)
  const [toast, setToast] = useState<{ id: string; text: string; icon: string; toAdmin: boolean } | null>(null)

  useEffect(() => {
    // First pass: snapshot current ids so we never toast the backlog.
    if (seen.current === null) {
      seen.current = new Set(notifications.map((n) => n.id))
      return
    }
    const fresh = notifications.find((n) => n.read_at == null && !seen.current!.has(n.id))
    if (!fresh) return
    seen.current.add(fresh.id)
    const d = notificationDisplay(fresh)
    const text = String(t[d.key])
      .replace('{name}', d.params.name ?? '')
      .replace('{tree}', d.params.tree ?? '')
      .replace('{code}', d.params.code ?? '')
      .replace(/\s*•\s*(?=—|$)/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    setToast({ id: fresh.id, text, icon: d.icon, toAdmin: d.navigatesToAdmin })
  }, [notifications, t])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(id)
  }, [toast])

  return (
    <AnimatePresence>
      {toast && (
        <motion.button
          key={toast.id}
          type="button"
          initial={{ opacity: 0, y: -24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -24, scale: 0.96 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          onClick={() => { if (toast.toAdmin) { try { sessionStorage.setItem('ft-admin-open-inbox', '1') } catch { /* ignore */ } navigate('/admin') } setToast(null) }}
          className="fixed top-3 inset-x-0 mx-auto z-[200] w-[min(92%,420px)] flex items-center gap-2.5 rounded-2xl bg-white/95 backdrop-blur shadow-glass-lg border border-black/5 px-3.5 py-3 text-start active:scale-[0.99] transition"
          dir="auto"
        >
          <span className="w-9 h-9 rounded-full bg-[#007AFF]/10 flex items-center justify-center flex-shrink-0 text-lg" aria-hidden>
            {toast.icon}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wide mb-0.5">{t.notifNewTitle}</p>
            <p className="text-[12.5px] text-[#1C1C1E] leading-snug line-clamp-2">{toast.text}</p>
          </div>
          <span className="text-[#C7C7CC] text-lg flex-shrink-0" aria-hidden>›</span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
