import { describe, it, expect } from 'vitest'
import {
  unreadCount, mergeNotificationLists, notificationDisplay,
  isShareCodeRequest, adminInboxCounts, hasUnseenShareCode, unseenShareCodeIds,
} from '../notifications'
import type { NotificationItem } from '../../types'

function notif(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: `n-${Math.random()}`,
    user_id: 'u1',
    type: 'access_request',
    data: {},
    read_at: null,
    created_at: '2026-06-11T10:00:00Z',
    ...over,
  }
}

describe('unreadCount + mergeNotificationLists', () => {
  it('counts only unread', () => {
    expect(unreadCount([
      notif(), notif({ read_at: '2026-06-11T11:00:00Z' }), notif(),
    ])).toBe(2)
  })

  it('merge dedupes by id and sorts newest first', () => {
    const a = notif({ id: 'x', created_at: '2026-06-10T09:00:00Z' })
    const b = notif({ id: 'y', created_at: '2026-06-11T09:00:00Z' })
    const merged = mergeNotificationLists([a, b], [a])
    expect(merged.map((n) => n.id)).toEqual(['y', 'x'])
  })
})

describe('notificationDisplay', () => {
  it('maps admin-bound types to admin navigation', () => {
    const d = notificationDisplay(notif({
      type: 'share_code_request',
      data: { requester_name: 'יוני', tree_name: 'משפחת אדלר' },
    }))
    expect(d.key).toBe('notifTypeShareCodeRequest')
    expect(d.params).toEqual({ name: 'יוני', tree: 'משפחת אדלר' })
    expect(d.navigatesToAdmin).toBe(true)
  })

  it('approval with a code surfaces the code; without falls back', () => {
    const withCode = notificationDisplay(notif({
      type: 'request_approved',
      data: { code: 'ABCDE-12345', tree_name: 'משפחת אדלר' },
    }))
    expect(withCode.key).toBe('notifApprovedWithCode')
    expect(withCode.params.code).toBe('ABCDE-12345')
    const noCode = notificationDisplay(notif({ type: 'request_approved', data: {} }))
    expect(noCode.key).toBe('notifApproved')
  })
})

describe('adminInboxCounts', () => {
  it('splits pending work into queues', () => {
    const counts = adminInboxCounts(
      [{ status: 'pending' }, { status: 'approved' }],
      [
        { status: 'pending', answers: {} },
        { status: 'pending', answers: { intent: 'request_share_code' } },
        { status: 'rejected', answers: {} },
      ],
      [{ status: 'open' }, { status: 'resolved' }],
    )
    expect(counts).toEqual({ edits: 1, access: 1, shareCodes: 1, reports: 1, total: 4 })
  })

  it('isShareCodeRequest tolerates missing answers', () => {
    expect(isShareCodeRequest({ answers: undefined as never })).toBe(false)
  })
})

describe('tree-card share-code dot', () => {
  const rows = [
    notif({ id: 'a', type: 'request_approved', data: { code: 'X', tree_id: 't1' } }),
    notif({ id: 'b', type: 'request_approved', data: { code: 'Y', tree_id: 't2' }, read_at: '2026-06-11T11:00:00Z' }),
    notif({ id: 'c', type: 'request_rejected', data: { tree_id: 't1' } }),
  ]

  it('dot only for unread approvals carrying a code for that tree', () => {
    expect(hasUnseenShareCode(rows, 't1')).toBe(true)
    expect(hasUnseenShareCode(rows, 't2')).toBe(false) // read
    expect(hasUnseenShareCode(rows, null)).toBe(false)
  })

  it('unseenShareCodeIds returns the approval ids to mark read', () => {
    expect(unseenShareCodeIds(rows, 't1')).toEqual(['a'])
  })
})
