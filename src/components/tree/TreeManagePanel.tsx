import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase, isSupabaseConfigured } from '../../lib/supabase'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang, isRTL } from '../../i18n/useT'
import { useCloseOnBack } from '../../hooks/useCloseOnBack'
import { confirmDialog } from '../../lib/confirm'
import { isAdmin } from '../../lib/permissions'
import type { TreeRole } from '../../types'

interface AccessRow { user_id: string; role: TreeRole; full_name: string; is_minor: boolean }
interface PendingNote { id: string; author_name: string; body: string; member_id: string }

/**
 * Per-tree OWNER management space (two-axis model). One place to: see who
 * is on the tree + their role, change/revoke roles, flag minors, and
 * approve content a minor posted (held pending). Gated to the tree's owner
 * or a platform admin; the DB RLS (021/023) is the real boundary.
 */
export default function TreeManagePanel({
  open, onClose, treeId, treeName,
}: {
  open: boolean
  onClose: () => void
  treeId: string
  treeName: string
}) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const { profile, myTreeRoles, members, setTreeMemberRole, revokeTreeMember, setMinor, approveNote, deleteNote } = useFamilyStore()
  const canManage = isAdmin(profile) || myTreeRoles[treeId] === 'owner'

  const [rows, setRows] = useState<AccessRow[]>([])
  const [pending, setPending] = useState<PendingNote[]>([])

  useCloseOnBack(open, onClose)

  useEffect(() => {
    if (!open || !canManage || !isSupabaseConfigured) return
    let cancelled = false
    void (async () => {
      try {
        const { data: ta } = await supabase
          .from('tree_access').select('user_id, role').eq('tree_id', treeId)
        const accessRows = (ta ?? []) as { user_id: string; role: TreeRole }[]
        const ids = accessRows.map((r) => r.user_id)
        let profilesById: Record<string, { full_name: string; is_minor: boolean }> = {}
        if (ids.length) {
          const { data: profs } = await supabase
            .from('profiles').select('id, full_name, is_minor').in('id', ids)
          profilesById = Object.fromEntries(
            ((profs ?? []) as { id: string; full_name: string | null; is_minor: boolean | null }[])
              .map((p) => [p.id, { full_name: p.full_name ?? '', is_minor: !!p.is_minor }]),
          )
        }
        const { data: notes } = await supabase
          .from('member_notes').select('id, author_name, body, member_id').eq('status', 'pending')
        const treeMemberIds = new Set(members.filter((m) => m.tree_id === treeId).map((m) => m.id))
        if (cancelled) return
        setRows(accessRows.map((r) => ({
          user_id: r.user_id, role: r.role,
          full_name: profilesById[r.user_id]?.full_name ?? '—',
          is_minor: profilesById[r.user_id]?.is_minor ?? false,
        })))
        setPending(((notes ?? []) as PendingNote[]).filter((n) => treeMemberIds.has(n.member_id)))
      } catch { /* defensive — degrade to empty lists */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canManage, treeId])

  if (!open) return null

  const ROLE_OPTS: { key: TreeRole; label: string }[] = [
    { key: 'viewer', label: t.treeRoleViewer },
    { key: 'editor', label: t.treeRoleEditor },
    { key: 'owner', label: t.treeRoleOwner },
  ]

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          dir={rtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 30, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-glass-lg max-h-[88vh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-white/95 backdrop-blur px-5 py-3 border-b border-black/5 flex items-center justify-between">
              <div className="min-w-0">
                <h2 className="text-sf-headline font-bold text-[#1C1C1E] truncate">{t.treeManageTitle}</h2>
                <p className="text-[11px] text-[#8E8E93] truncate">{treeName}</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close"
                className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#636366]">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="#636366" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            </div>

            {!canManage ? (
              <p className="p-6 text-center text-sf-subhead text-[#8E8E93]">—</p>
            ) : (
              <div className="p-4 space-y-5">
                {/* Members & roles */}
                <section>
                  <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wide mb-2">{t.treeManageMembers}</p>
                  {rows.length === 0 ? (
                    <p className="text-sf-footnote text-[#8E8E93] py-2">{t.treeManageNoMembers}</p>
                  ) : (
                    <div className="space-y-2">
                      {rows.map((r) => (
                        <div key={r.user_id} className="bg-[#F2F2F7] rounded-2xl p-3">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="text-sf-subhead font-semibold text-[#1C1C1E] truncate">{r.full_name}</span>
                            <button type="button" onClick={() => { void (async () => {
                                if (!(await confirmDialog({ message: t.treeManageRevokeConfirm, danger: true }))) return
                                void revokeTreeMember(r.user_id, treeId)
                                setRows((s) => s.filter((x) => x.user_id !== r.user_id))
                              })() }}
                              className="text-[11px] font-semibold text-[#FF3B30]">{t.treeManageRevoke}</button>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1 bg-white rounded-xl p-0.5 flex gap-0.5">
                              {ROLE_OPTS.map((opt) => (
                                <button key={opt.key} type="button"
                                  onClick={() => { void setTreeMemberRole(r.user_id, treeId, opt.key); setRows((s) => s.map((x) => x.user_id === r.user_id ? { ...x, role: opt.key } : x)) }}
                                  className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition ${r.role === opt.key ? 'bg-[#007AFF]/10 text-[#007AFF]' : 'text-[#8E8E93]'}`}>
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                            <button type="button"
                              onClick={() => { void setMinor(r.user_id, !r.is_minor, profile?.id ?? null); setRows((s) => s.map((x) => x.user_id === r.user_id ? { ...x, is_minor: !x.is_minor } : x)) }}
                              aria-pressed={r.is_minor}
                              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition ${r.is_minor ? 'bg-[#FF9F0A]/15 border-[#FF9F0A]/40 text-[#B25F00]' : 'bg-white border-[#E5E5EA] text-[#8E8E93]'}`}>
                              {t.treeManageMinor}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Pending content approval (minor moderation) */}
                <section>
                  <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wide mb-2">{t.treeManagePending}</p>
                  {pending.length === 0 ? (
                    <p className="text-sf-footnote text-[#8E8E93] py-2">{t.treeManageNoPending}</p>
                  ) : (
                    <div className="space-y-2">
                      {pending.map((n) => (
                        <div key={n.id} className="bg-[#FFF8EC] border border-[#FF9F0A]/25 rounded-2xl p-3">
                          <p className="text-[11px] font-bold text-[#B25F00] mb-1">{n.author_name}</p>
                          <p className="text-sf-footnote text-[#1C1C1E] whitespace-pre-wrap mb-2">{n.body}</p>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => { void approveNote(n.id); setPending((s) => s.filter((x) => x.id !== n.id)) }}
                              className="flex-1 py-2 rounded-xl bg-[#34C759] text-white text-[12px] font-bold">{t.treeManageApprove}</button>
                            <button type="button" onClick={() => { void deleteNote(n.id); setPending((s) => s.filter((x) => x.id !== n.id)) }}
                              className="flex-1 py-2 rounded-xl bg-[#FF3B30]/10 text-[#FF3B30] text-[12px] font-bold">{t.treeManageReject}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
