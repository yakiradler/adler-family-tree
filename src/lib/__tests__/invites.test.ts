import { describe, it, expect } from 'vitest'
import {
  CODE_ALPHABET, generateCode, expiryToIso, shareInviteDraft,
  isInviteActive, pickReusableShareInvite, pickPersonalShareInvite,
  SHARE_CODE_EXPIRY_DAYS,
} from '../invites'
import type { TreeInvite } from '../../types'

const DAY = 86_400_000
const NOW = Date.parse('2026-06-11T12:00:00Z')

function invite(over: Partial<TreeInvite> = {}): TreeInvite {
  return {
    id: `i-${Math.random()}`,
    code: 'AAAAA-BBBBB',
    tree_id: 't1',
    created_by: 'admin1',
    created_for: null,
    expires_at: new Date(NOW + 10 * DAY).toISOString(),
    uses_left: null,
    created_at: new Date(NOW - DAY).toISOString(),
    ...over,
  }
}

describe('generateCode', () => {
  it('matches the ABCDE-12345 shape and avoids 0/O/1/I', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateCode()
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/)
      for (const ch of code.replace('-', '')) {
        expect(CODE_ALPHABET).toContain(ch)
      }
    }
  })
})

describe('expiryToIso', () => {
  it('never → null', () => {
    expect(expiryToIso('never', NOW)).toBeNull()
  })
  it('7d/30d/90d land on the exact day', () => {
    expect(Date.parse(expiryToIso('7d', NOW)!)).toBe(NOW + 7 * DAY)
    expect(Date.parse(expiryToIso('30d', NOW)!)).toBe(NOW + 30 * DAY)
    expect(Date.parse(expiryToIso('90d', NOW)!)).toBe(NOW + 90 * DAY)
  })
})

describe('shareInviteDraft', () => {
  it('30-day expiry, unlimited uses, optional created_for', () => {
    const d = shareInviteDraft('t1', 'owner1', NOW)
    expect(Date.parse(d.expires_at!)).toBe(NOW + SHARE_CODE_EXPIRY_DAYS * DAY)
    expect(d.uses_left).toBeNull()
    expect(d.created_for).toBeNull()
    expect(d.tree_id).toBe('t1')
    const personal = shareInviteDraft('t1', 'admin1', NOW, 'user9')
    expect(personal.created_for).toBe('user9')
  })
})

describe('isInviteActive', () => {
  it('active when unexpired with uses left (or unlimited)', () => {
    expect(isInviteActive(invite(), NOW)).toBe(true)
    expect(isInviteActive(invite({ uses_left: 3 }), NOW)).toBe(true)
    expect(isInviteActive(invite({ expires_at: null }), NOW)).toBe(true)
  })
  it('inactive when expired or exhausted', () => {
    expect(isInviteActive(invite({ expires_at: new Date(NOW - 1).toISOString() }), NOW)).toBe(false)
    expect(isInviteActive(invite({ uses_left: 0 }), NOW)).toBe(false)
  })
})

describe('pickReusableShareInvite / pickPersonalShareInvite', () => {
  const rows: TreeInvite[] = [
    invite({ id: 'old-generic', created_at: new Date(NOW - 5 * DAY).toISOString() }),
    invite({ id: 'new-generic', created_at: new Date(NOW - DAY).toISOString() }),
    invite({ id: 'expired', expires_at: new Date(NOW - 1).toISOString() }),
    invite({ id: 'personal', created_for: 'user9', created_at: new Date(NOW).toISOString() }),
    invite({ id: 'other-tree', tree_id: 't2' }),
  ]

  it('reusable = newest active generic code for the tree', () => {
    expect(pickReusableShareInvite(rows, 't1', NOW)?.id).toBe('new-generic')
  })

  it('personal codes never count as reusable generics', () => {
    const onlyPersonal = rows.filter((r) => r.id === 'personal' || r.id === 'expired')
    expect(pickReusableShareInvite(onlyPersonal, 't1', NOW)).toBeNull()
  })

  it('personal lookup matches user + tree and skips expired', () => {
    expect(pickPersonalShareInvite(rows, 't1', 'user9', NOW)?.id).toBe('personal')
    expect(pickPersonalShareInvite(rows, 't1', 'someone-else', NOW)).toBeNull()
    expect(pickPersonalShareInvite(rows, 't2', 'user9', NOW)).toBeNull()
  })
})
