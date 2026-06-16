import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang, isRTL } from '../../i18n/useT'
import { useCloseOnBack } from '../../hooks/useCloseOnBack'

export interface VisibilityChoice {
  body?: string
  sharedTreeIds: string[]
  hiddenMemberIds: string[]
}

/**
 * Audience editor for a feed post — "who can view" (approve other
 * connected trees) and "hide from" (specific people). Used in two places:
 * the composer (set before posting; no body field) and the ⋯ menu of an
 * existing post (edit body + audience). The default audience is always
 * "everyone in the current tree"; approvals/hides are additive on top.
 */
export default function StatusVisibilityModal({
  open,
  onClose,
  withBody = false,
  initialBody = '',
  initialSharedTreeIds = [],
  initialHiddenMemberIds = [],
  trees,
  members,
  onSave,
}: {
  open: boolean
  onClose: () => void
  withBody?: boolean
  initialBody?: string
  initialSharedTreeIds?: string[]
  initialHiddenMemberIds?: string[]
  /** Other trees the user may approve (the post's own tree excluded). */
  trees: { id: string; name: string; color?: string }[]
  /** People in the post's tree who can be hidden from. */
  members: { id: string; label: string }[]
  onSave: (choice: VisibilityChoice) => void
}) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const [body, setBody] = useState(initialBody)
  const [shared, setShared] = useState<string[]>(initialSharedTreeIds)
  const [hidden, setHidden] = useState<string[]>(initialHiddenMemberIds)

  useCloseOnBack(open, onClose)

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const save = () => {
    onSave({ body: withBody ? body : undefined, sharedTreeIds: shared, hiddenMemberIds: hidden })
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={onClose}
          dir={rtl ? 'rtl' : 'ltr'}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0.6 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0.6 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-white/97 backdrop-blur-2xl shadow-glass-lg p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sf-subhead font-bold text-[#1C1C1E] mb-3">
              {withBody ? t.feedEditTitle : t.feedAudience}
            </p>

            {withBody && (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="w-full bg-[#F2F2F7] rounded-2xl px-3.5 py-2.5 text-[13px] text-[#1C1C1E] outline-none focus:ring-2 focus:ring-[#007AFF]/40 resize-none mb-4"
              />
            )}

            {/* Who can view: default + approvable trees */}
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#8E8E93] mb-1.5">{t.feedAudience}</p>
            <div className="rounded-2xl bg-[#F2F2F7] px-3.5 py-2.5 text-[12.5px] text-[#3C3C43] mb-2">
              ✓ {t.feedAudienceDefault}
            </div>
            {trees.length > 0 ? (
              <>
                <p className="text-[11px] text-[#8E8E93] mb-1.5">{t.feedAudienceShareTrees}</p>
                <div className="space-y-1 mb-4">
                  {trees.map((tt) => (
                    <Row
                      key={tt.id}
                      label={tt.name}
                      color={tt.color ?? '#5E5CE6'}
                      checked={shared.includes(tt.id)}
                      onClick={() => toggle(shared, setShared, tt.id)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[11px] text-[#8E8E93] mb-4">{t.feedNoOtherTrees}</p>
            )}

            {/* Hide from people */}
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#8E8E93] mb-1.5">{t.feedAudienceHideFrom}</p>
            {members.length > 0 ? (
              <div className="space-y-1 mb-5 max-h-48 overflow-y-auto">
                {members.map((m) => (
                  <Row
                    key={m.id}
                    label={m.label}
                    checked={hidden.includes(m.id)}
                    onClick={() => toggle(hidden, setHidden, m.id)}
                    danger
                  />
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-[#8E8E93] mb-5">{t.feedNoMembers}</p>
            )}

            <div className={`flex gap-2 ${rtl ? 'flex-row-reverse' : ''}`}>
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold">
                {t.feedAudienceCancel}
              </button>
              <button type="button" onClick={save}
                className="flex-1 py-2.5 rounded-2xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-sf-subhead font-bold">
                {t.feedAudienceSave}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Row({
  label, color, checked, onClick, danger,
}: {
  label: string
  color?: string
  checked: boolean
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="checkbox"
      aria-checked={checked}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-start transition ${
        checked ? (danger ? 'bg-[#FF3B30]/8' : 'bg-[#007AFF]/8') : 'hover:bg-[#F2F2F7]'
      }`}
    >
      {color && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} aria-hidden />}
      <span className="flex-1 min-w-0 text-[13px] font-semibold text-[#1C1C1E] truncate">{label}</span>
      <span
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
          checked
            ? (danger ? 'bg-[#FF3B30] border-[#FF3B30]' : 'bg-[#007AFF] border-[#007AFF]')
            : 'border-[#C7C7CC]'
        }`}
        aria-hidden
      >
        {checked && (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M2 5.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  )
}
