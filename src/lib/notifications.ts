import type {
  AccessRequest, EditRequest, FeedbackItem, NotificationItem,
} from '../types'

/**
 * Pure helpers for the notification center + admin unified inbox.
 * Display text stays in translations.ts — `notificationDisplay` only
 * picks the i18n key and its params, so rows localize live with the
 * language toggle.
 */

export function unreadCount(list: NotificationItem[]): number {
  return list.reduce((n, item) => n + (item.read_at == null ? 1 : 0), 0)
}

/**
 * Merge the "recent page" and "all unread" query results: dedupe by
 * id (unread rows can appear in both), newest first.
 */
export function mergeNotificationLists(
  recent: NotificationItem[],
  unread: NotificationItem[],
): NotificationItem[] {
  const byId = new Map<string, NotificationItem>()
  for (const n of [...recent, ...unread]) byId.set(n.id, n)
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export interface NotificationDisplay {
  /** translations.ts key for the row text. */
  key:
    | 'notifTypeAccessRequest'
    | 'notifTypeShareCodeRequest'
    | 'notifTypeEditRequest'
    | 'notifTypeFeedback'
    | 'notifApprovedWithCode'
    | 'notifApproved'
    | 'notifRejected'
  icon: string
  /** Values the UI substitutes into the text. */
  params: { name?: string; tree?: string; code?: string }
  /** Tapping the row sends admins to the panel. */
  navigatesToAdmin: boolean
}

export function notificationDisplay(n: NotificationItem): NotificationDisplay {
  const d = n.data ?? {}
  const name = typeof d.requester_name === 'string' && d.requester_name
    ? d.requester_name
    : typeof d.author_name === 'string' ? d.author_name : undefined
  const tree = typeof d.tree_name === 'string' && d.tree_name ? d.tree_name : undefined
  const code = typeof d.code === 'string' && d.code ? d.code : undefined
  switch (n.type) {
    case 'access_request':
      return { key: 'notifTypeAccessRequest', icon: '🚪', params: { name, tree }, navigatesToAdmin: true }
    case 'share_code_request':
      return { key: 'notifTypeShareCodeRequest', icon: '🔑', params: { name, tree }, navigatesToAdmin: true }
    case 'edit_request':
      return { key: 'notifTypeEditRequest', icon: '✏️', params: { name }, navigatesToAdmin: true }
    case 'feedback':
      return { key: 'notifTypeFeedback', icon: '🐞', params: { name }, navigatesToAdmin: true }
    case 'request_approved':
      return code
        ? { key: 'notifApprovedWithCode', icon: '🎉', params: { tree, code }, navigatesToAdmin: false }
        : { key: 'notifApproved', icon: '🎉', params: { tree }, navigatesToAdmin: false }
    case 'request_rejected':
      return { key: 'notifRejected', icon: '🙏', params: { tree }, navigatesToAdmin: false }
  }
}

export function isShareCodeRequest(req: Pick<AccessRequest, 'answers'>): boolean {
  return (req.answers as Record<string, unknown> | null | undefined)?.intent === 'request_share_code'
}

export interface AdminInboxCounts {
  edits: number
  access: number
  shareCodes: number
  reports: number
  total: number
}

/** Pending work for the admin, by queue. */
export function adminInboxCounts(
  editRequests: Pick<EditRequest, 'status'>[],
  accessRequests: Pick<AccessRequest, 'status' | 'answers'>[],
  feedback: Pick<FeedbackItem, 'status'>[],
): AdminInboxCounts {
  const edits = editRequests.filter((r) => r.status === 'pending').length
  const pendingAccess = accessRequests.filter((r) => r.status === 'pending')
  const shareCodes = pendingAccess.filter((r) => isShareCodeRequest(r)).length
  const access = pendingAccess.length - shareCodes
  const reports = feedback.filter((f) => f.status === 'open').length
  return { edits, access, shareCodes, reports, total: edits + access + shareCodes + reports }
}

const ADMIN_TYPES = new Set(['access_request', 'share_code_request', 'edit_request', 'feedback'])

/** Unread admin-bound notifications — the badge on the "ניהול" tile. */
export function countUnreadAdminInbox(notifications: NotificationItem[]): number {
  return notifications.filter((n) => n.read_at == null && ADMIN_TYPES.has(n.type)).length
}

/**
 * Red dot on a tree card: an unread approval notification that carries
 * a code for THIS tree.
 */
export function hasUnseenShareCode(
  notifications: NotificationItem[],
  treeId: string | null,
): boolean {
  if (!treeId) return false
  return notifications.some(
    (n) =>
      n.type === 'request_approved' &&
      n.read_at == null &&
      typeof n.data?.code === 'string' &&
      n.data.code !== '' &&
      n.data?.tree_id === treeId,
  )
}

/** Ids of unread approval notifications for a tree — marked read when the member opens the menu and sees the code. */
export function unseenShareCodeIds(
  notifications: NotificationItem[],
  treeId: string | null,
): string[] {
  if (!treeId) return []
  return notifications
    .filter(
      (n) =>
        n.type === 'request_approved' &&
        n.read_at == null &&
        n.data?.tree_id === treeId,
    )
    .map((n) => n.id)
}
