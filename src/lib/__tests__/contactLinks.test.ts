import { describe, it, expect } from 'vitest'
import {
  telHref, whatsappHref, mailtoHref, facebookHref, instagramHref,
} from '../contactLinks'

describe('contactLinks', () => {
  it('builds tel: links and drops junk', () => {
    expect(telHref('050-123-4567')).toBe('tel:0501234567')
    expect(telHref('+972 50 123 4567')).toBe('tel:+972501234567')
    expect(telHref('')).toBeNull()
    expect(telHref(undefined)).toBeNull()
  })

  it('builds wa.me links, treating 10-digit 0-numbers as Israeli', () => {
    expect(whatsappHref('050-123-4567')).toBe('https://wa.me/972501234567')
    expect(whatsappHref('+972501234567')).toBe('https://wa.me/972501234567')
    expect(whatsappHref('')).toBeNull()
  })

  it('builds mailto: links', () => {
    expect(mailtoHref(' me@x.com ')).toBe('mailto:me@x.com')
    expect(mailtoHref('')).toBeNull()
  })

  it('accepts handles or full URLs for socials', () => {
    expect(facebookHref('@yakir')).toBe('https://facebook.com/yakir')
    expect(facebookHref('yakir')).toBe('https://facebook.com/yakir')
    expect(facebookHref('https://facebook.com/yakir')).toBe('https://facebook.com/yakir')
    expect(instagramHref('@yakir')).toBe('https://instagram.com/yakir')
    expect(instagramHref('http://instagram.com/x')).toBe('http://instagram.com/x')
    expect(instagramHref('')).toBeNull()
  })
})
