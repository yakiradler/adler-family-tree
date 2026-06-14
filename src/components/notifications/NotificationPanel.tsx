import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang, type Translations } from '../../i18n/useT'
import { alertDialog } from '../../lib/confirm'
import { isAdmin } from '../../lib/permissions'
import { notificationDisplay, unreadCount } from '../../lib/notifications'
import { useCloseOnBack } from '../../hooks/useCloseOnBack'
import type { NotificationItem } from '../../types'

/**
 * Persistent notification inbox — bottom sheet (same overlay pattern
 * as TreeCardActionMenu). Rows are rendered from type+data via
 * notificationDisplay so they localize live. Items the user has had on
 * screen for a moment get marked read automatically; approval rows
 * with a share code expose a copy button so the code is always
 * recoverable here, not just in a transient toast.
 */
interface Props {
  open: boolean
  onClose: () => void
}

export default function NotificationPanel({ open, onClose }: Props) {
  const { t, lang } = useLang()
  const navigate = useNavigate()
  const profile = useFamilyStore((s) => s.profile)
  const notifications = useFamilyStore((s) => s.notifications)
  const markAllNotificationsRead = useFamilyStore((s) => s.markAllNotificationsRead)
  const fetchNotifications = useFamilyStore((s) => s.fetchNotifications)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useCloseOnBack(open, onClose)

  // Fresh data the moment the sheet opens; unread rows soak for a
  // beat so the user SEES what was new before the dots clear.
  useEffect(() => {
    if (!open) return
    fetchNotifications()
    const id = window.setTimeout(() => { void markAllNotificationsRead() }, 1500)
    return () => window.clearTimeout(id)
  }, [open, fetchNotifications, markAllNotificationsRead])

  const copyCode = async (n: NotificationItem) => {
    const code = typeof n.data?.code === 'string' ? n.data.code : ''
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopiedId(n.id)
      window.setTimeout(() => setCopiedId(null), 1600)
    } catch {
      void alertDialog({ title: t.notifCopyCode, message: code })
    }
  }

  const admin = isAdmin(profile)
  const unread = unreadCount(notifications)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="ntf-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/45 backdrop-blur-sm no-print"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 60, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-3xl bg-white shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-sf-title2 font-bold text-[#1C1C1E]">
                🔔 {t.notifTitle}
              </h2>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => { void markAllNotificationsRead() }}
                  className="text-[12px] font-semibold text-[#007AFF]"
                >
                  {t.notifMarkAllRead}
                </button>
              )}
            </div>

            <div className="max-h-[55vh] overflow-y-auto px-3 pb-3 space-y-1.5">
              {notifications.length === 0 ? (
                <p className="text-center text-[13px] text-[#8E8E93] py-10">
                  {t.notifEmpty}
                </p>
              ) : (
                notifications.map((n) => {
                  const d = notificationDisplay(n)
                  const text = renderText(t, d.key, d.params)
                  const hasCode = n.type === 'request_approved' && typeof n.data?.code === 'string' && n.data.code
                  const clickable = d.navigatesToAdmin && admin
                  return (
                    <div
                      key={n.id}
                      role={clickable ? 'button' : undefined}
                      onClick={clickable ? () => { onClose(); navigate('/admin') } : undefined}
                      className={[
                        'rounded-2xl px-3 py-2.5 flex items-start gap-2.5',
                        n.read_at == null ? 'bg-[#007AFF]/8' : 'bg-[#F2F2F7]',
                        clickable ? 'cursor-pointer hover:bg-[#E5E5EA] transition' : '',
                      ].join(' ')}
                    >
                      <span className="text-lg flex-shrink-0" aria-hidden>{d.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] text-[#1C1C1E] leading-snug">{text}</p>
                        {hasCode && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void copyCode(n) }}
                            className="mt-1.5 inline-flex items-center gap-1.5 rounded-xl bg-white border border-black/8 px-2.5 py-1 font-mono text-[12px] font-bold text-[#1C1C1E]"
                            dir="ltr"
                          >
                            {String(n.data.code)}
                            <span className="text-[10px] text-[#007AFF] font-sans font-semibold">
                              {copiedId === n.id ? t.notifCodeCopied : t.notifCopyCode}
                            </span>
                          </button>
                        )}
                        <p className="text-[10.5px] text-[#8E8E93] mt-0.5">
                          {relativeTime(n.created_at, lang)}
                        </p>
                      </div>
                      {n.read_at == null && (
                        <span className="w-2 h-2 rounded-full bg-[#007AFF] flex-shrink-0 mt-1.5" aria-hidden />
                      )}
                    </div>
                  )
                })
              )}
            </div>

            <div className="px-5 pb-5">
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold active:scale-[0.98] transition"
              >
                {t.treeMenuClose}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Substitute {name}/{tree}/{code} placeholders in the i18n string. */
function renderText(
  t: Translations,
  key: keyof Translations,
  params: { name?: string; tree?: string; code?: string },
): string {
  let s = String(t[key])
  s = s.replace('{name}', params.name ?? '')
  s = s.replace('{tree}', params.tree ?? '')
  s = s.replace('{code}', params.code ?? '')
  // Tidy what empty params leave behind: doubled spaces and dangling
  // "•" separators ("... מאת יוני • " when the tree name is unknown).
  return s
    .replace(/\s*•\s*(?=—|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function relativeTime(iso: string, lang: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return lang === 'he' ? 'עכשיו' : 'now'
  if (mins < 60) return lang === 'he' ? `לפני ${mins} דק׳` : `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return lang === 'he' ? `לפני ${hours} שע׳` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  return lang === 'he' ? `לפני ${days} ימים` : `${days}d ago`
}
