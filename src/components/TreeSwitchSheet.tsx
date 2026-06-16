import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import { useCloseOnBack } from '../hooks/useCloseOnBack'
import { scopePersonalTrees } from '../lib/treeScope'
import { isSupabaseConfigured } from '../lib/supabase'

/**
 * Instagram-style account switcher, but for family trees. A bottom sheet
 * listing every tree the user belongs to (their "tree profiles"); tapping
 * one switches the active tree across the whole shell — no logout, no page
 * reload, exactly like swapping Instagram accounts.
 *
 * Shares the SAME data path and store actions as the top-bar `TreeSwitcher`
 * dropdown (scopePersonalTrees + setActiveTreeId + addTree) so the two
 * surfaces never diverge. Deliberately switch-only: tree management /
 * deletion stays on the dashboard long-press (owner decision) to avoid
 * duplicating the delete-confirm flow here.
 */
export default function TreeSwitchSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { t, lang } = useLang()
  const rtl = lang === 'he'
  const { trees: allTrees, activeTreeId, setActiveTreeId, addTree, profile } = useFamilyStore()
  const myTreeAccessIds = useFamilyStore((s) => s.myTreeAccessIds)
  const members = useFamilyStore((s) => s.members)
  const trees = scopePersonalTrees(allTrees, profile, myTreeAccessIds, !isSupabaseConfigured)

  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')

  // Phone back button closes the sheet instead of leaving the page.
  useCloseOnBack(open, onClose)

  // The implicit "main tree" row only matters for legacy accounts that
  // still have members with no tree_id (impossible after migration 011).
  const hasMainBucket = members.some((m) => !m.tree_id)

  const pick = (id: string | null) => {
    setActiveTreeId(id)
    onClose()
  }

  const submitNew = async () => {
    const name = draftName.trim()
    if (!name) return
    const created = await addTree({
      name,
      color: '#5E5CE6',
      created_by: profile?.id ?? 'demo',
    })
    if (created) setActiveTreeId(created.id)
    setCreating(false)
    setDraftName('')
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          // Above the bottom nav (z-40) and the top-bar switcher (z-60).
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 backdrop-blur-sm"
          onClick={onClose}
          dir={rtl ? 'rtl' : 'ltr'}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg rounded-t-3xl bg-white/95 backdrop-blur-2xl border-t border-white/60 shadow-glass-lg pb-[max(env(safe-area-inset-bottom),1rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grabber */}
            <div className="flex justify-center pt-2.5 pb-1">
              <span className="w-9 h-1 rounded-full bg-black/15" aria-hidden />
            </div>

            <p className="px-5 pt-1 pb-2 text-[11px] font-bold uppercase tracking-wider text-[#8E8E93]">
              {t.treeSwitcherTitle}
            </p>

            <div className="px-3 max-h-[55vh] overflow-y-auto">
              {hasMainBucket && (
                <SheetRow
                  label={t.treeSwitcherDefault}
                  color="#007AFF"
                  active={activeTreeId === null}
                  onClick={() => pick(null)}
                />
              )}

              {trees.map((tt) => (
                <SheetRow
                  key={tt.id}
                  label={tt.name}
                  hint={tt.description}
                  color={tt.color ?? '#5E5CE6'}
                  active={activeTreeId === tt.id}
                  onClick={() => pick(tt.id)}
                />
              ))}

              {/* Add a new tree */}
              <div className="mt-1 border-t border-black/5 pt-2">
                {creating ? (
                  <div className="px-2 space-y-2 pb-1">
                    <input
                      autoFocus
                      type="text"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder={t.treeSwitcherNewName}
                      className="w-full px-3 py-2.5 rounded-2xl bg-[#F2F2F7] text-[13px] outline-none focus:ring-2 focus:ring-[#5E5CE6]/40"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setCreating(false); setDraftName('') }}
                        className="flex-1 py-2.5 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-[13px] font-semibold"
                      >
                        {rtl ? 'ביטול' : 'Cancel'}
                      </button>
                      <button
                        type="button"
                        onClick={submitNew}
                        disabled={!draftName.trim()}
                        className="flex-1 py-2.5 rounded-2xl bg-gradient-to-r from-[#5E5CE6] to-[#BF5AF2] text-white text-[13px] font-semibold disabled:opacity-50"
                      >
                        {rtl ? 'שמור' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-[13px] font-semibold text-[#5E5CE6] hover:bg-[#5E5CE6]/8 transition"
                  >
                    <span className="w-10 h-10 rounded-full bg-[#5E5CE6]/10 flex items-center justify-center text-lg leading-none" aria-hidden>＋</span>
                    {t.treeSwitcherCreate}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function SheetRow({
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
      aria-current={active ? 'true' : undefined}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-start transition ${
        active ? 'bg-[#5E5CE6]/8' : 'hover:bg-[#F2F2F7]'
      }`}
    >
      {/* IG-style circular avatar; the active tree gets a colored ring. */}
      <span
        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[15px] font-bold flex-shrink-0"
        style={{
          background: color,
          boxShadow: active ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : undefined,
        }}
        aria-hidden
      >
        {label.trim().charAt(0) || '·'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-semibold text-[#1C1C1E] truncate">{label}</span>
        {hint && <span className="block text-[11px] text-[#8E8E93] mt-0.5 truncate">{hint}</span>}
      </span>
      {active && (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="flex-shrink-0">
          <circle cx="9" cy="9" r="9" fill="#5E5CE6" />
          <path d="M5 9.5l2.5 2.5 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
