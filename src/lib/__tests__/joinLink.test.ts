import { describe, it, expect } from 'vitest'
import { buildJoinUrl, parseJoinCode } from '../joinLink'
import { iconStoragePath } from '../imageResize'

describe('buildJoinUrl + parseJoinCode round-trip', () => {
  it('builds the hash-router join URL', () => {
    expect(buildJoinUrl('https://infinitree.vercel.app', 'ABCDE-23456'))
      .toBe('https://infinitree.vercel.app/#/join?code=ABCDE-23456')
    expect(buildJoinUrl('https://infinitree.vercel.app/', 'ABCDE-23456'))
      .toBe('https://infinitree.vercel.app/#/join?code=ABCDE-23456')
  })

  it('parses the code back out of the search string', () => {
    expect(parseJoinCode('?code=ABCDE-23456')).toBe('ABCDE-23456')
    expect(parseJoinCode('?utm=x&code=ABCDE-23456&y=1')).toBe('ABCDE-23456')
  })

  it('normalizes case and trims', () => {
    expect(parseJoinCode('?code=abcde-23456')).toBe('ABCDE-23456')
    expect(parseJoinCode('?code=%20ABCDE-23456%20')).toBe('ABCDE-23456')
  })

  it('rejects garbage, wrong shapes and missing params', () => {
    expect(parseJoinCode('?code=hello')).toBeNull()
    expect(parseJoinCode('?code=ABCDE23456')).toBeNull()      // no dash
    expect(parseJoinCode('?code=ABCD1-23456')).toBeNull()     // 1 not in alphabet
    expect(parseJoinCode('?other=x')).toBeNull()
    expect(parseJoinCode('')).toBeNull()
    expect(parseJoinCode(null)).toBeNull()
    expect(parseJoinCode('?code=%E2%28')).toBeNull()          // malformed encoding survives
  })
})

describe('iconStoragePath', () => {
  it('anchors the tree id as the first path segment (storage RLS contract)', () => {
    const p = iconStoragePath('t-123', 'webp', 1700000000000)
    expect(p).toBe('t-123/icon-1700000000000.webp')
    expect(p.split('/')[0]).toBe('t-123')
  })
  it('strips a leading dot from the extension', () => {
    expect(iconStoragePath('t', '.jpg', 1)).toBe('t/icon-1.jpg')
  })
})
