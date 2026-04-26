import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang, isRTL } from '../../i18n/useT'
import type { Member } from '../../types'

/**
 * Advanced filter state for the tree view. Filters apply BEFORE the
 * layout engine — filtered-out members + their dangling relationships are
 * stripped, so the resulting tree only contains matches. This keeps the
 * tree compact when zooming in on a sub-population.
 */
export interface FilterState {
  lineage: 'all' | 'kohen' | 'levi'
  showFormerSpouses: boolean
  hideDeceased: boolean
  search: string
  /** When set, only this member's blood line (ancestors + descendants) renders. */
  focusMemberId: string | null
}

export const DEFAULT_FILTERS: FilterState = {
  lineage: 'all',
  showFormerSpouses: false,
  hideDeceased: false,
  search: '',
  focusMemberId: null,
}

export function isDefaultFilter(f: FilterState): boolean {
  return (
    f.lineage === 'all' &&
    !f.showFormerSpouses &&
    !f.hideDeceased &&
    f.search.trim() === '' &&
    f.focusMemberId === null
  )
}

export default function AdvancedFilter({
  filters,
  onChange,
  members,
  matchedCount,
}: {
  filters: FilterState
  onChange: (next: FilterState) => void
  members: Member[]
  matchedCount: number
}) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const [open, setOpen] = useState(false)
  const active = !isDefaultFilter(filters)
  const focusedMember = filters.focusMemberId
    ? members.find(m => m.id === filters.focusMemberId)
    : null

  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch })

  return (
    <div
      className="absolute top-3 z-20"
      style={{ [rtl ? 'right' : 'left']: 12 } as React.CSSProperties}
    >
      <motion.button
        type="button"
        onClick={() => setOpen(o => !o)}
        whileTap={{ scale: 0.95 }}
        aria-label={t.filterTitle}
        title={t.filterTitle}
        className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 shadow-glass font-semibold text-[12.5px] border transition ${
          active
            ? 'bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white border-transparent'
            : 'bg-white/95 text-[#1C1C1E] border-white/70 hover:bg-white'
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M2 3h10M3.5 7h7M5.5 11h3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <span>{t.filterTitle}</span>
        {active && (
          <span className="bg-white/25 rounded-full px-1.5 text-[10px] font-bold">
            {matchedCount}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="mt-2 glass-strong rounded-2xl shadow-glass p-3 w-[280px] space-y-3"
          >
            {/* Lineage segmented control */}
            <div>
              <p className="text-[10px] font-semibold text-[#8E8E93] uppercase mb-1.5">
                {t.lineageLabel}
              </p>
              <div className="bg-[#F2F2F7] rounded-xl p-1 flex gap-1">
                {([
                  ['all', t.filterAll, ''],
                  ['kohen', t.filterKohanim, '👑'],
                  ['levi', t.filterLeviim, '🎵'],
                ] as const).map(([key, label, icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => set({ lineage: key })}
                    aria-pressed={filters.lineage === key}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                      filters.lineage === key
                        ? 'bg-white text-[#1C1C1E] shadow-sm'
                        : 'text-[#636366]'
                    }`}
                  >
                    {icon && <span className="mr-1">{icon}</span>}
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Toggles */}
            <FilterToggle
              label={t.filterShowFormer}
              icon="💔"
              checked={filters.showFormerSpouses}
              onChange={(v) => set({ showFormerSpouses: v })}
            />
            <FilterToggle
              label={t.filterHideDeceased}
              icon="🕯️"
              checked={filters.hideDeceased}
              onChange={(v) => set({ hideDeceased: v })}
            />

            {/* Name search */}
            <div>
              <p className="text-[10px] font-semibold text-[#8E8E93] uppercase mb-1.5">
                {t.filterSearch}
              </p>
              <input
                value={filters.search}
                onChange={(e) => set({ search: e.target.value })}
                placeholder={t.filterSearch}
                className="w-full bg-[#F2F2F7] rounded-xl px-3 py-2 text-[12px] text-[#1C1C1E] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]/40"
              />
            </div>

            {/* Focus picker */}
            <div>
              <p className="text-[10px] font-semibold text-[#8E8E93] uppercase mb-1.5">
                {t.filterFocusPerson}
              </p>
              <select
                value={filters.focusMemberId ?? ''}
                onChange={(e) =>
                  set({ focusMemberId: e.target.value || null })
                }
                className="w-full bg-[#F2F2F7] rounded-xl px-3 py-2 text-[12px] text-[#1C1C1E] outline-none focus:ring-2 focus:ring-[#007AFF]/40"
              >
                <option value="">— {t.filterAll} —</option>
                {[...members]
                  .sort((a, b) =>
                    `${a.first_name} ${a.last_name}`.localeCompare(
                      `${b.first_name} ${b.last_name}`,
                    ),
                  )
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.first_name} {m.last_name}
                    </option>
                  ))}
              </select>
              {focusedMember && (
                <button
                  type="button"
                  onClick={() => set({ focusMemberId: null })}
                  className="mt-1 text-[10px] text-[#FF3B30] font-semibold hover:underline"
                >
                  {t.filterFocusClear}
                </button>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-1 border-t border-[#E5E5EA]">
              <span className="text-[10px] text-[#8E8E93]">
                {matchedCount} {t.filterMatchedCount}
              </span>
              <button
                type="button"
                onClick={() => onChange(DEFAULT_FILTERS)}
                disabled={!active}
                className="text-[11px] font-semibold text-[#FF3B30] disabled:opacity-30"
              >
                {t.filterReset}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function FilterToggle({
  label, icon, checked, onChange,
}: {
  label: string
  icon: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[11px] font-semibold transition ${
        checked
          ? 'bg-[#34C759]/15 text-[#34C759]'
          : 'bg-[#F2F2F7] text-[#636366] hover:bg-[#E5E5EA]'
      }`}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden>{icon}</span>
        {label}
      </span>
      <span
        aria-hidden
        className={`w-8 h-5 rounded-full relative transition ${
          checked ? 'bg-[#34C759]' : 'bg-[#C7C7CC]'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
            checked ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  )
}
