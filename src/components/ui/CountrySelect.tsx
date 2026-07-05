import { useMemo, useRef, useState } from 'react'
import { useLang } from '../../i18n/useT'
import {
  COUNTRY_CODES,
  HERITAGE_TOKENS,
  countryHaystack,
  countryName,
  isHeritageToken,
} from '../../lib/countries'
import FlagIcon from '../FlagIcon'

/**
 * Searchable country (or heritage-symbol) picker for the member origin
 * flags. Bilingual search — typing either the Hebrew or the English
 * country name matches. Renders as a button showing the current value;
 * tapping opens an inline dropdown with a search box.
 *
 * `withHeritageTokens` prepends the non-country symbols ("Jewish" →
 * Star of David) for the heritage field.
 */
export default function CountrySelect({
  value,
  onChange,
  placeholder,
  withHeritageTokens = false,
}: {
  value: string | null | undefined
  onChange: (code: string | null) => void
  placeholder: string
  withHeritageTokens?: boolean
}) {
  const { t, lang } = useLang()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const heritageLabel = (token: string) =>
    token === 'jewish' ? t.heritageJewish : token

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const tokens = withHeritageTokens
      ? HERITAGE_TOKENS.filter(
          (tok) => !q || heritageLabel(tok).toLowerCase().includes(q) || tok.includes(q),
        )
      : []
    const countries = COUNTRY_CODES.filter((c) => !q || countryHaystack(c).includes(q))
      // Sort by the active language's name so the list reads naturally.
      .sort((a, b) => countryName(a, lang).localeCompare(countryName(b, lang), lang))
    return { tokens, countries: countries.slice(0, 60) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, lang, withHeritageTokens, t])

  const currentLabel = value
    ? isHeritageToken(value)
      ? heritageLabel(value)
      : countryName(value, lang)
    : null

  const pick = (code: string | null) => {
    onChange(code)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 bg-[#F2F2F7] rounded-xl px-3 py-2 text-start text-sf-subhead text-[#1C1C1E] outline-none focus:ring-2 focus:ring-[#007AFF]/40"
      >
        {value ? (
          <>
            <FlagIcon code={value} size={16} title={currentLabel ?? undefined} />
            <span className="flex-1 truncate">{currentLabel}</span>
            <span
              role="button"
              tabIndex={0}
              aria-label={t.countryNone}
              onClick={(e) => { e.stopPropagation(); pick(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); pick(null) } }}
              className="text-[#8E8E93] hover:text-[#FF3B30] px-1"
            >
              ×
            </span>
          </>
        ) : (
          <span className="flex-1 text-[#8E8E93] truncate">{placeholder}</span>
        )}
        <span className="text-[#C7C7CC] text-[10px]" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 inset-x-0 rounded-2xl bg-white shadow-xl border border-black/5 overflow-hidden">
          <div className="p-2 border-b border-black/5">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.countrySearchPlaceholder}
              className="w-full bg-[#F2F2F7] rounded-xl px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-[#007AFF]/40"
              dir="auto"
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {results.tokens.map((tok) => (
              <button
                key={tok}
                type="button"
                onClick={() => pick(tok)}
                className="w-full flex items-center gap-2 px-3 py-2 text-start text-[13px] hover:bg-[#F2F2F7] transition"
              >
                <FlagIcon code={tok} size={15} />
                <span className="flex-1 truncate font-medium">{heritageLabel(tok)}</span>
                {value === tok && <span className="text-[#007AFF] text-xs">✓</span>}
              </button>
            ))}
            {results.tokens.length > 0 && results.countries.length > 0 && (
              <div className="h-px bg-black/5 mx-3" aria-hidden />
            )}
            {results.countries.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => pick(c)}
                className="w-full flex items-center gap-2 px-3 py-2 text-start text-[13px] hover:bg-[#F2F2F7] transition"
              >
                <FlagIcon code={c} size={15} />
                <span className="flex-1 truncate">{countryName(c, lang)}</span>
                {value === c && <span className="text-[#007AFF] text-xs">✓</span>}
              </button>
            ))}
            {results.tokens.length === 0 && results.countries.length === 0 && (
              <p className="px-3 py-3 text-[12px] text-[#8E8E93]">{t.memberSearchNoMatches}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
