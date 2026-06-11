import { useEffect } from 'react'
import { useFamilyStore } from '../store/useFamilyStore'
import { isSupabaseConfigured } from '../lib/supabase'

/**
 * Keeps the notification slice fresh without realtime infrastructure:
 * fetch on session start, on tab focus / visibility return, and on a
 * 60s interval while the tab is visible. Cheap (two small indexed
 * queries) and scale-safe; the upgrade path is a supabase realtime
 * channel filtered on user_id — deliberately not added yet.
 */
export function useNotificationPolling(active: boolean) {
  const fetchNotifications = useFamilyStore((s) => s.fetchNotifications)

  useEffect(() => {
    if (!active || !isSupabaseConfigured) return
    fetchNotifications()

    const onWake = () => {
      if (document.visibilityState === 'visible') fetchNotifications()
    }
    window.addEventListener('focus', onWake)
    document.addEventListener('visibilitychange', onWake)
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchNotifications()
    }, 60_000)
    return () => {
      window.removeEventListener('focus', onWake)
      document.removeEventListener('visibilitychange', onWake)
      window.clearInterval(id)
    }
  }, [active, fetchNotifications])
}
