import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { translations, type Lang } from './translations'

export type Translations = { [K in keyof typeof translations.he]: string }

interface LangState {
  lang: Lang
  setLang: (lang: Lang) => void
  toggleLang: () => void
  t: Translations
}

export const useLang = create<LangState>()(
  persist(
    (set, get) => ({
      lang: 'he',
      t: translations.he,
      setLang: (lang) => set({ lang, t: translations[lang] }),
      toggleLang: () => {
        const next: Lang = get().lang === 'he' ? 'en' : 'he'
        set({ lang: next, t: translations[next] })
      },
    }),
    { name: 'family-tree-lang' },
  ),
)

export function isRTL(lang: Lang) {
  return lang === 'he'
}
