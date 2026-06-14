import { useEffect } from 'react'
import { useFamilyStore } from '../store/useFamilyStore'

/**
 * Like / emoji reactions on a member (social base, migration 023). Any
 * family member who can see the member — INCLUDING a viewer — can react.
 * Optimistic + defensive in the store: if the member_reactions table
 * isn't present yet, taps are silent no-ops (no crash).
 */
const EMOJIS = ['❤️', '👍', '😂', '🎉', '🙏', '😮']

export default function MemberReactionsBar({ memberId }: { memberId: string }) {
  const reactions = useFamilyStore((s) => s.reactions)
  const fetchReactions = useFamilyStore((s) => s.fetchReactions)
  const toggleReaction = useFamilyStore((s) => s.toggleReaction)
  const profile = useFamilyStore((s) => s.profile)

  useEffect(() => { void fetchReactions() }, [fetchReactions])

  return (
    <div className="flex flex-wrap gap-1.5">
      {EMOJIS.map((e) => {
        const count = reactions.filter((r) => r.member_id === memberId && r.emoji === e).length
        const mine = reactions.some(
          (r) => r.member_id === memberId && r.emoji === e && r.user_id === profile?.id,
        )
        return (
          <button
            key={e}
            type="button"
            onClick={() => toggleReaction(memberId, e)}
            aria-pressed={mine}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[14px] border transition active:scale-95 ${
              mine
                ? 'bg-[#FF2D55]/10 border-[#FF2D55]/40'
                : 'bg-[#F2F2F7] border-transparent hover:bg-[#E5E5EA]'
            }`}
          >
            <span aria-hidden>{e}</span>
            {count > 0 && <span className="text-[11px] font-bold text-[#636366]">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
