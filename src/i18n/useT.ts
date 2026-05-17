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

/**
 * Why `partialize` is non-obvious: the persisted state used to
 * include `t` itself, which meant a returning visitor with a stale
 * localStorage snapshot got the OLD translations object even after
 * we shipped new keys — and any newly-added `t.something` rendered
 * as empty in the UI. Persist only `lang`; rebuild `t` from the
 * live `translations` import on every load and on every setLang.
 */
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
    {
      name: 'family-tree-lang',
      // Only persist the language preference itself. `t` is derived.
      partialize: (state) => ({ lang: state.lang }) as Partial<LangState>,
      // `merge` runs every page load, so this is the spot to defend
      // against legacy snapshots that captured the entire (older)
      // translations object — we ignore whatever `t` they stored and
      // always recompute from the live import. This is what unstuck
      // empty UI labels after newly-added keys shipped.
      merge: (persistedState, currentState) => {
        const lang =
          (persistedState as Partial<LangState> | undefined)?.lang ??
          currentState.lang
        return {
          ...currentState,
          lang,
          t: translations[lang],
        }
      },
    },
  ),
)

export function isRTL(lang: Lang) {
  return lang === 'he'
}
