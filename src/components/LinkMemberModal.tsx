import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import { useCloseOnBack } from '../hooks/useCloseOnBack'
import { displayName, nameHaystack } from '../lib/memberName'
import type { Member } from '../types'

/**
 * "Link to the same person in another tree" — two steps inside one small
 * modal: pick a tree (only trees the viewer can see, minus the current
 * one), then search that tree's members and confirm. Creates a
 * member_links row (migration 036).
 */
export default function LinkMemberModal({
  open,
  onClose,
  member,
}: {
  open: boolean
  onClose: () => void
  member: Member
}) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const { members, trees, memberLinks, addMemberLink } = useFamilyStore()
  const [treeId, setTreeId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  useCloseOnBack(open, onClose)

  // Reset when reopened (adjust-state-during-render pattern used across
  // the app's modals).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) { setTreeId(null); setQuery('') }
  }

  const alreadyLinkedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const l of memberLinks) {
      if (l.member_a_id === member.id) ids.add(l.member_b_id)
      if (l.member_b_id === member.id) ids.add(l.member_a_id)
    }
    return ids
  }, [memberLinks, member.id])

  const otherTrees = trees.filter((tr) => tr.id !== member.tree_id)

  const candidates = useMemo(() => {
    if (!treeId) return []
    const q = query.trim().toLowerCase()
    return members
      .filter((m) => m.tree_id === treeId && m.id !== member.id && !alreadyLinkedIds.has(m.id))
      .filter((m) => !q || nameHaystack(m).includes(q))
      .slice(0, 20)
  }, [members, treeId, query, member.id, alreadyLinkedIds])

  const pick = async (other: Member) => {
    if (busy) return
    setBusy(true)
    const ok = await addMemberLink(member.id, other.id)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          dir={rtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-5">
              <h2 className="text-sf-headline font-bold text-[#1C1C1E] flex items-center gap-2">
                <span aria-hidden>🔗</span> {t.linkModalTitle}
              </h2>
              <p className="text-[12px] text-[#8E8E93] mt-1 leading-snug">
                {t.linkModalDesc.replace('{name}', displayName(member, lang))}
              </p>

              {/* Step 1 — pick the other tree */}
              <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wide mt-4 mb-1.5">
                {t.linkModalPickTree}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {otherTrees.map((tr) => (
                  <button
                    key={tr.id}
                    type="button"
                    onClick={() => setTreeId(tr.id)}
                    className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition ${
                      treeId === tr.id
                        ? 'bg-[#5E5CE6] text-white'
                        : 'bg-[#F2F2F7] text-[#636366] hover:bg-[#EAEAEF]'
                    }`}
                  >
                    {tr.name}
                  </button>
                ))}
              </div>

              {/* Step 2 — find the person */}
              {treeId && (
                <div className="mt-3">
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t.linkModalSearchPlaceholder}
                    className="w-full bg-[#F2F2F7] rounded-2xl px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[#5E5CE6]/40"
                    dir="auto"
                  />
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-2xl bg-[#F2F2F7]/60 divide-y divide-white">
                    {candidates.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void pick(m)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-start hover:bg-white transition disabled:opacity-50"
                      >
                        <span
                          className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center text-white text-[10px] font-bold"
                          style={{ background: m.gender === 'female' ? 'linear-gradient(135deg,#FF5EAE,#B46BFF)' : 'linear-gradient(135deg,#2B6BFF,#19C6FF)' }}
                          aria-hidden
                        >
                          {m.photo_url
                            ? <img src={m.photo_url} alt="" className="w-full h-full object-cover" />
                            : (m.first_name ?? '·').charAt(0)}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-medium text-[#1C1C1E] truncate">
                            {displayName(m, lang)}
                          </span>
                          {m.birth_date && (
                            <span className="block text-[10.5px] text-[#8E8E93]">
                              {new Date(m.birth_date).getFullYear()}
                            </span>
                          )}
                        </span>
                        <span className="text-[#5E5CE6] text-[11px] font-bold">{t.linkModalConfirm}</span>
                      </button>
                    ))}
                    {candidates.length === 0 && (
                      <p className="px-3 py-3 text-[12px] text-[#8E8E93]">{t.memberSearchNoMatches}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-full text-[13px] font-semibold text-[#636366] hover:bg-[#F2F2F7] transition"
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
