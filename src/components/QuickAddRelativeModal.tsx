import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang, isRTL } from '../i18n/useT'
import { useCloseOnBack } from '../hooks/useCloseOnBack'
import { useFamilyStore } from '../store/useFamilyStore'
import type { Member, Gender } from '../types'
import { linkRelative, type RelativeDirection } from '../lib/relatives'

export type { RelativeDirection } from '../lib/relatives'

interface Props {
  open: boolean
  onClose: () => void
  /**
   * The member the new relative is being added TO. Tree id + last
   * name are inherited so a sibling added from tree #2 stays in
   * tree #2 and uses the family surname by default.
   */
  anchor: Member | null
  direction: RelativeDirection
}

/**
 * Compact popover for the edit-mode "+" buttons that surround each
 * member card. Lets the user add a parent / sibling / spouse / child
 * in three fields (first name, last name, gender) without going
 * through the full RelationshipManager modal.
 *
 * Behaviour rules:
 *   * The new member always inherits the anchor's tree_id — never
 *     fall back to activeTreeId here. Stage-2 of the rebuild
 *     specifically routes RelationshipManager this way; this popover
 *     is the same flow with less chrome.
 *   * For "sibling" we copy the anchor's existing parents onto the
 *     new member so they appear as a true sibling, not a free-floating
 *     person. If the anchor has zero parents in-tree the sibling is
 *     added as a standalone with a warning toast — there's nothing
 *     to share parents with.
 *   * For "parent" we let the user pick father vs mother explicitly
 *     (the gender field controls how the rest of the tree treats them).
 */
export default function QuickAddRelativeModal({ open, onClose, anchor, direction }: Props) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const { addMember, addRelationship, relationships, setSelectedMemberId } = useFamilyStore()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  // Default gender per direction so the form lands in a sensible
  // state — "parent" defaults blank (user picks father/mother),
  // "spouse" picks the opposite of the anchor when knowable.
  const defaultGender: Gender | '' =
    direction === 'spouse' && anchor?.gender === 'male' ? 'female'
    : direction === 'spouse' && anchor?.gender === 'female' ? 'male'
    : ''
  const [gender, setGender] = useState<Gender | ''>(defaultGender)
  const [busy, setBusy] = useState(false)

  // Phone back button closes the popover instead of leaving the page.
  // Must run BEFORE the early return below — hook order is fixed.
  useCloseOnBack(open && !!anchor, onClose)

  if (!open || !anchor) return null

  const reset = () => {
    setFirstName('')
    setLastName('')
    setGender(defaultGender)
    setBusy(false)
  }
  const handleClose = () => { reset(); onClose() }

  const title = (
    direction === 'parent' ? t.addParent
    : direction === 'sibling' ? t.addSibling
    : direction === 'spouse' ? t.addSpouse
    : t.addChild
  )

  const save = async () => {
    if (!firstName.trim() || busy) return
    setBusy(true)
    try {
      const created = await addMember({
        first_name: firstName.trim(),
        last_name: lastName.trim() || anchor.last_name,
        gender: (gender || undefined) as Gender | undefined,
        // Inherit the anchor's tree explicitly. Falling back to
        // activeTreeId here would re-introduce the leak fixed in
        // stage 2 — the tree the panel is FOR is the source of truth.
        tree_id: anchor.tree_id ?? null,
        created_by: anchor.created_by ?? 'demo',
      })
      if (!created) {
        // addMember refused (e.g. no active tree in Supabase mode).
        // The store already surfaces the error toast; just bail.
        return
      }
      await linkRelative({ created, anchor, direction, addRelationship, relationships })
      // Select the new member — TreeView pans the camera to any
      // selected member that is outside the current viewport, so the
      // user always SEES where their new relative landed.
      setSelectedMemberId(created.id)
      handleClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          dir={rtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 12 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-3xl bg-white shadow-glass-lg p-5 space-y-3"
          >
            <header className="flex items-center justify-between">
              <h2 className="text-sf-headline font-bold text-[#1C1C1E]">
                {title}
              </h2>
              <button
                type="button"
                onClick={handleClose}
                aria-label={t.quickAddCancel}
                className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#636366] active:scale-95 transition"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2L10 10M10 2L2 10" stroke="#636366" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </header>
            <p className="text-[12px] text-[#8E8E93] -mt-1">
              {anchor.first_name} {anchor.last_name}
            </p>

            <label className="block">
              <span className="text-[11px] font-semibold text-[#636366]">{t.quickAddFirstName}</span>
              <input
                autoFocus
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#E5E5EA] bg-white px-3 py-2 text-sf-callout focus:outline-none focus:border-[#007AFF]"
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-semibold text-[#636366]">{t.quickAddLastName}</span>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder={anchor.last_name}
                className="mt-1 w-full rounded-xl border border-[#E5E5EA] bg-white px-3 py-2 text-sf-callout focus:outline-none focus:border-[#007AFF]"
              />
            </label>

            <fieldset>
              <legend className="text-[11px] font-semibold text-[#636366]">
                {direction === 'parent'
                  ? `${t.quickAddGender} (${t.parentTypeFather} / ${t.parentTypeMother})`
                  : t.quickAddGender}
              </legend>
              <div className="mt-1 flex gap-2">
                {(['male', 'female'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender(g)}
                    className={`flex-1 rounded-xl border px-3 py-1.5 text-sf-callout font-semibold transition ${
                      gender === g
                        ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                        : 'border-[#E5E5EA] bg-white text-[#636366]'
                    }`}
                  >
                    {direction === 'parent'
                      ? (g === 'male' ? t.parentTypeFather : t.parentTypeMother)
                      : (g === 'male' ? t.quickAddMale : t.quickAddFemale)}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 rounded-xl border border-[#E5E5EA] bg-white px-3 py-2 text-sf-callout font-semibold text-[#636366] active:scale-95 transition"
              >
                {t.quickAddCancel}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!firstName.trim() || busy}
                className="flex-1 rounded-xl bg-[#007AFF] text-white px-3 py-2 text-sf-callout font-semibold active:scale-95 transition disabled:opacity-50 disabled:active:scale-100"
              >
                {busy ? '…' : t.quickAddSave}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
