import { useMemo, useState } from 'react'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import { canWriteTree } from '../lib/permissions'
import { displayName } from '../lib/memberName'
import { confirmDialog } from '../lib/confirm'
import LinkMemberModal from './LinkMemberModal'
import type { Member } from '../types'

/**
 * "Also appears in…" — the cross-tree identity section (migration 036).
 * Lists every member row linked to this one as the same person, with a
 * jump button that switches the active tree and opens that profile.
 *
 * Rows whose other side didn't come back from the server (the viewer has
 * no access to that tree — RLS hides the member row, but the link row is
 * visible to EITHER side) render as a muted "no access" line, so the
 * duplicate isn't silently re-created.
 *
 * Renders nothing when there are no links AND the viewer can't create
 * one — the section never adds empty chrome to the panel.
 */
export default function MemberLinksSection({ member }: { member: Member }) {
  const { t, lang } = useLang()
  const {
    members, trees, memberLinks, myTreeRoles,
    setActiveTreeId, setSelectedMemberId, deleteMemberLink,
  } = useFamilyStore()
  const [linkOpen, setLinkOpen] = useState(false)

  const myLinks = useMemo(
    () => memberLinks.filter((l) => l.member_a_id === member.id || l.member_b_id === member.id),
    [memberLinks, member.id],
  )

  const iCanWriteHere = canWriteTree(myTreeRoles[member.tree_id ?? ''])
  // Creating a link requires another tree I can at least see.
  const otherTrees = trees.filter((tr) => tr.id !== member.tree_id)
  const canCreate = iCanWriteHere && otherTrees.length > 0

  if (myLinks.length === 0 && !canCreate) return null

  const jump = (other: Member) => {
    if (other.tree_id) setActiveTreeId(other.tree_id)
    setSelectedMemberId(other.id)
  }

  const unlink = async (linkId: string) => {
    if (!(await confirmDialog({ message: t.unlinkConfirm, danger: true }))) return
    void deleteMemberLink(linkId)
  }

  return (
    <div className="w-full">
      <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wide mb-1.5 text-start">
        {t.panelLinkedProfiles}
      </p>
      <div className="space-y-1.5">
        {myLinks.map((l) => {
          const otherId = l.member_a_id === member.id ? l.member_b_id : l.member_a_id
          const other = members.find((m) => m.id === otherId)
          if (!other) {
            // Link row visible, member row not — the viewer has no access
            // to the other tree.
            return (
              <div key={l.id} className="flex items-center gap-2 rounded-2xl bg-[#F2F2F7]/70 px-3 py-2">
                <span aria-hidden>🔒</span>
                <span className="flex-1 text-[12px] text-[#8E8E93]">{t.linkNoAccessTree}</span>
              </div>
            )
          }
          const otherTree = trees.find((tr) => tr.id === other.tree_id)
          const mayUnlink =
            canWriteTree(myTreeRoles[member.tree_id ?? '']) ||
            canWriteTree(myTreeRoles[other.tree_id ?? ''])
          return (
            <div key={l.id} className="flex items-center gap-2 rounded-2xl bg-[#F2F2F7] px-3 py-2">
              <button
                type="button"
                onClick={() => jump(other)}
                className="flex-1 min-w-0 flex items-center gap-2 text-start active:scale-[0.99] transition"
              >
                <span
                  className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center text-white text-[10px] font-bold"
                  style={{ background: other.gender === 'female' ? 'linear-gradient(135deg,#FF5EAE,#B46BFF)' : 'linear-gradient(135deg,#2B6BFF,#19C6FF)' }}
                  aria-hidden
                >
                  {other.photo_url
                    ? <img src={other.photo_url} alt="" className="w-full h-full object-cover" />
                    : (other.first_name ?? '·').charAt(0)}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold text-[#1C1C1E] truncate">
                    {t.panelLinkedInTree.replace('{name}', otherTree?.name ?? '?')}
                  </span>
                  <span className="block text-[11px] text-[#8E8E93] truncate">
                    {displayName(other, lang)} ↗
                  </span>
                </span>
              </button>
              {mayUnlink && (
                <button
                  type="button"
                  onClick={() => void unlink(l.id)}
                  aria-label={t.unlinkBtn}
                  title={t.unlinkBtn}
                  className="w-7 h-7 rounded-full text-[#8E8E93] hover:text-[#FF3B30] hover:bg-black/5 flex items-center justify-center flex-shrink-0"
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                    <path d="M2 2l9 9M11 2l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          )
        })}
        {canCreate && (
          <button
            type="button"
            onClick={() => setLinkOpen(true)}
            className="w-full flex items-center gap-2 rounded-2xl border border-dashed border-[#C7C7CC] px-3 py-2 text-[12px] font-semibold text-[#5E5CE6] hover:bg-[#5E5CE6]/5 transition"
          >
            <span aria-hidden>🔗</span>
            {t.panelLinkToPerson}
          </button>
        )}
      </div>

      <LinkMemberModal open={linkOpen} onClose={() => setLinkOpen(false)} member={member} />
    </div>
  )
}
