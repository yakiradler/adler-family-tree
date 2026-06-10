import { useLang } from '../../../i18n/useT'
import type { RelativeDirection } from '../../QuickAddRelativeModal'

/**
 * Four "+" buttons that surround a member card in edit mode. Each
 * targets a different relation (parent above, child below, spouse at
 * the end, sibling at the start — RTL-aware via logical positioning).
 *
 * Buttons live OUTSIDE the MemberNode <button> (it's invalid to nest
 * <button>s) and stopPropagation on click so a "+" tap doesn't also
 * select the underlying card. Absolutely positioned relative to the
 * member's wrapper <motion.div>, so they follow the card's spring
 * animation when the layout updates.
 */
export default function QuickAddButtons({
  onAdd,
}: {
  onAdd: (direction: RelativeDirection) => void
}) {
  const { t } = useLang()
  const cls =
    'absolute w-6 h-6 rounded-full bg-white/95 text-[#007AFF] shadow-sm ring-1 ring-[#007AFF]/25 flex items-center justify-center text-[15px] leading-none font-bold opacity-80 hover:opacity-100 hover:scale-110 active:scale-95 transition-all duration-150 z-20 pointer-events-auto'
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden={false}>
      <button
        type="button"
        title={t.addParent}
        aria-label={t.addParent}
        onClick={(e) => { e.stopPropagation(); onAdd('parent') }}
        className={cls}
        style={{ top: -12, left: '50%', transform: 'translateX(-50%)' }}
      >+</button>
      <button
        type="button"
        title={t.addChild}
        aria-label={t.addChild}
        onClick={(e) => { e.stopPropagation(); onAdd('child') }}
        className={cls}
        style={{ bottom: -12, left: '50%', transform: 'translateX(-50%)' }}
      >+</button>
      <button
        type="button"
        title={t.addSibling}
        aria-label={t.addSibling}
        onClick={(e) => { e.stopPropagation(); onAdd('sibling') }}
        className={cls}
        style={{ insetInlineStart: -12, top: '50%', transform: 'translateY(-50%)' }}
      >+</button>
      <button
        type="button"
        title={t.addSpouse}
        aria-label={t.addSpouse}
        onClick={(e) => { e.stopPropagation(); onAdd('spouse') }}
        className={cls}
        style={{ insetInlineEnd: -12, top: '50%', transform: 'translateY(-50%)' }}
      >+</button>
    </div>
  )
}
