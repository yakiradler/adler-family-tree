import { useState } from 'react'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang } from '../../i18n/useT'
import { unreadCount } from '../../lib/notifications'
import NotificationPanel from './NotificationPanel'

/**
 * Header bell — same visual family as the shield/security button next
 * to it. The red badge counts unread notifications (capped at "9+").
 * Tapping opens the persistent NotificationPanel bottom sheet.
 */
export default function NotificationBell() {
  const { t } = useLang()
  const notifications = useFamilyStore((s) => s.notifications)
  const [open, setOpen] = useState(false)
  const unread = unreadCount(notifications)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t.notifTitle}
        aria-label={t.notifBellAria}
        className="relative w-8 h-8 bg-white/70 backdrop-blur border border-white/50 rounded-xl flex items-center justify-center hover:bg-white/90 transition"
      >
        <span className="text-[15px]" aria-hidden>🔔</span>
        {unread > 0 && (
          <span
            className="absolute -top-1.5 -end-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF3B30] text-white text-[10px] font-bold flex items-center justify-center shadow"
            aria-label={`${unread}`}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <NotificationPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}
