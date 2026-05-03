import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import type { FamilyTree } from '../types/index'

/**
 * Tree switcher — a Slack-style workspace picker for households that
 * track multiple connected trees side by side (paternal / maternal /
 * spouse's family). The active tree filters the rendered population
 * across the whole shell. The "main" tree is implicit and always
 * present (it's the bucket for every member without an explicit
 * `tree_id`).
 */
export default function TreeSwitcher({
  variant = 'compact',
}: {
  variant?: 'compact' | 'full'
}) {
  const { trees, activeTreeId, setActiveTreeId, addTree, deleteTree, profile } = useFamilyStore()
  const { t, lang } = useLang()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftDesc, setDraftDesc] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<FamilyTree | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = activeTreeId ? trees.find((t) => t.id === activeTreeId) : null
  const activeLabel = active?.name ?? t.treeSwitcherDefault
  const activeColor = active?.color ?? '#007AFF'

  const submitNew = async () => {
    if (!draftName.trim()) return
    const created = await addTree({
      name: draftName.trim(),
      description: draftDesc.trim() || undefined,
      color: '#5E5CE6',
      created_by: profile?.id ?? 'demo',
    })
    if (created) setActiveTreeId(created.id)
    setCreating(false)
    setDraftName('')
    setDraftDesc('')
    setOpen(false)
  }

  const confirmDeleteTree = async () => {
    if (!deleteTarget) return
    await deleteTree(deleteTarget.id)
    setDeleteTarget(null)
  }

  return (
    <div ref={rootRef} className={variant === 'full' ? 'w-full' : 'relative'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={activeLabel}
        className={`flex items-center gap-1.5 rounded-2xl bg-white/85 backdrop-blur border border-white/60 shadow-sm py-1.5 px-2 sm:px-3 text-[12px] font-semibold text-[#1C1C1E] hover:bg-white transition flex-shrink-0 ${
          variant === 'full' ? 'w-full justify-between' : ''
        }`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: activeColor }}
            aria-hidden
          />
          {/* Hide the label on the smallest viewports so the top-bar
              doesn't overflow; the colored dot + caret are enough hint. */}
          <span className="truncate hidden sm:inline max-w-[120px]">
            {activeLabel}
          </span>
        </span>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path d="M2 4l3.5 3L9 4" stroke="#636366" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute z-30 mt-2 w-[280px] rounded-2xl bg-white/95 backdrop-blur-2xl border border-white/60 shadow-glass-lg p-2"
            style={{ right: 0 } as React.CSSProperties}
          >
            <p className="px-2 pt-1 pb-2 text-[10px] font-bold uppercase tracking-wider text-[#8E8E93]">
              {t.treeSwitcherTitle}
            </p>

            {/* Default / main tree row */}
            <TreeRow
              label={t.treeSwitcherDefault}
              hint={t.treeSwitcherDefaultHint}
              color="#007AFF"
              active={activeTreeId === null}
              onClick={() => {
                setActiveTreeId(null)
                setOpen(false)
              }}
            />

            {/* Custom trees */}
            {trees.map((tt) => (
              <div key={tt.id} className="flex items-center gap-1">
                <div className="flex-1 min-w-0">
                  <TreeRow
                    label={tt.name}
                    hint={tt.description}
                    color={tt.color ?? '#5E5CE6'}
                    active={activeTreeId === tt.id}
                    onClick={() => {
                      setActiveTreeId(tt.id)
                      setOpen(false)
                    }}
                  />
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    title={t.treeDeleteTree}
                    aria-label={t.treeDeleteTree}
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(tt) }}
                    className="flex-shrink-0 w-7 h-7 rounded-xl flex items-center justify-center text-[#FF3B30]/60 hover:text-[#FF3B30] hover:bg-[#FF3B30]/8 transition"
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                      <path d="M2.5 3.5h8M5 3.5V2.5h3v1M4.5 3.5v6.5h4V3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </div>
            ))}

            {/* Create-tree form */}
            <div className="mt-1 border-t border-black/5 pt-2 px-2">
              {creating ? (
                <div className="space-y-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder={t.treeSwitcherNewName}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-[#F2F2F7] text-[12px] outline-none focus:ring-2 focus:ring-[#5E5CE6]/40"
                  />
                  <input
                    type="text"
                    value={draftDesc}
                    onChange={(e) => setDraftDesc(e.target.value)}
                    placeholder={t.treeSwitcherNewDesc}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-[#F2F2F7] text-[11.5px] outline-none focus:ring-2 focus:ring-[#5E5CE6]/40"
                  />
                  <div className="flex gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => { setCreating(false); setDraftName(''); setDraftDesc('') }}
                      className="flex-1 py-1.5 rounded-xl bg-[#F2F2F7] text-[#1C1C1E] text-[11.5px] font-semibold"
                    >
                      {lang === 'he' ? 'ביטול' : 'Cancel'}
                    </button>
                    <button
                      type="button"
                      onClick={submitNew}
                      disabled={!draftName.trim()}
                      className="flex-1 py-1.5 rounded-xl bg-gradient-to-r from-[#5E5CE6] to-[#BF5AF2] text-white text-[11.5px] font-semibold disabled:opacity-50"
                    >
                      {lang === 'he' ? 'שמור' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-[12px] font-semibold text-[#5E5CE6] hover:bg-[#5E5CE6]/8 transition"
                >
                  <span aria-hidden>＋</span>
                  {t.treeSwitcherCreate}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete-tree confirmation ── */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="mx-6 rounded-3xl bg-white shadow-glass-lg p-6 space-y-4 w-full max-w-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#FF3B30]/10 flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M3.5 5h11M7 5V3.5h4V5M6.5 5v9h5V5" stroke="#FF3B30" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <p className="text-sf-subhead font-bold text-[#1C1C1E]">{t.treeDeleteTree}</p>
                  <p className="text-[11px] text-[#636366] font-semibold mt-0.5">{deleteTarget.name}</p>
                </div>
              </div>
              <p className="text-sf-footnote text-[#3C3C43] leading-relaxed">{t.treeDeleteTreeConfirm}</p>
              <div className={`flex gap-2 ${lang === 'he' ? 'flex-row-reverse' : ''}`}>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-2.5 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold"
                >
                  {lang === 'he' ? 'ביטול' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteTree}
                  className="flex-1 py-2.5 rounded-2xl bg-[#FF3B30] text-white text-sf-subhead font-bold"
                >
                  {lang === 'he' ? 'מחק' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TreeRow({
  label, hint, color, active, onClick,
}: {
  label: string
  hint?: string
  color: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      aria-current={active ? 'true' : undefined}
      className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-start transition ${
        active ? 'bg-[#5E5CE6]/8' : 'hover:bg-[#F2F2F7]'
      }`}
    >
      <span
        className="mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ background: color }}
        aria-hidden
      />
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-semibold text-[#1C1C1E] truncate">{label}</span>
        {hint && (
          <span className="block text-[10.5px] text-[#8E8E93] mt-0.5 leading-snug">{hint}</span>
        )}
      </span>
      {active && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0 mt-0.5">
          <path d="M3 7l3 3 5-6" stroke="#5E5CE6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
