import { describe, it, expect } from 'vitest'
import { displayName, displayFirst } from '../memberName'

const both = { first_name: 'יקיר', last_name: 'אדלר', first_name_en: 'Yakir', last_name_en: 'Adler' }
const heOnly = { first_name: 'שרה', last_name: 'כהן' }
const enOnly = { first_name: '', last_name: '', first_name_en: 'John', last_name_en: 'Doe' }

describe('displayName', () => {
  it('picks the language-matching name when both exist', () => {
    expect(displayName(both, 'he')).toBe('יקיר אדלר')
    expect(displayName(both, 'en')).toBe('Yakir Adler')
  })

  it('falls back to the other language when one is missing', () => {
    expect(displayName(heOnly, 'en')).toBe('שרה כהן')
    expect(displayName(enOnly, 'he')).toBe('John Doe')
  })

  it('trims and drops empty parts', () => {
    expect(displayName({ first_name: ' Dana ', last_name: '' }, 'he')).toBe('Dana')
  })
})

describe('displayFirst', () => {
  it('returns the first name for the language with fallback', () => {
    expect(displayFirst(both, 'en')).toBe('Yakir')
    expect(displayFirst(both, 'he')).toBe('יקיר')
    expect(displayFirst(enOnly, 'he')).toBe('John')
  })
})
