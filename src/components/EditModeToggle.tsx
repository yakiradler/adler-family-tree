import { motion } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import { canManageRelationships } from '../lib/permissions'
import Tooltip from './Tooltip'

/**
 * Floating "Edit Mode" toggle that controls whether per-card "+"
 * buttons appear next to every member on the tree.
 *
 * Lives in the bottom-right corner so it sits clear of the top bar
 * AND the bottom navigation island (which carries layout / view
 * controls). The pencil icon swaps to an X when active so the same
 * button always exits the mode it entered.
 *
 * Gated by `canManageRelationships` so a guest (read-only) never
 * sees a toggle that wouldn't do anything for them. Admins and
 * masters always see it; plain `user` accounts see it because the
 * downstream RelationshipManager / addMember calls still gate per-
 * member edit permissions — a user can only quick-add to their own
 * nuclear family, but the toggle itself is harmless to show.
 */
export default function EditModeToggle() {
  const { t } = useLang()
  const isEditMode = useFamilyStore((s) => s.isEditMode)
  const setEditMode = useFamilyStore((s) => s.setEditMode)
  const profile = useFamilyStore((s) => s.profile)

  // Hide for read-only roles. We use the no-context overload here on
  // purpose: the toggle decision isn't per-member; once on, individual
  // "+" clicks still re-check permissions with the anchor's context.
  if (!canManageRelationships(profile)) return null

  return (
    <div className="fixed bottom-4 start-4 z-40 no-print" data-tour="tree-edit-mode">
      <Tooltip content={isEditMode ? t.exitEditMode : t.editMode} placement="top">
        <motion.button
          type="button"
          onClick={() => setEditMode(!isEditMode)}
          whileTap={{ scale: 0.92 }}
          aria-label={isEditMode ? t.exitEditMode : t.editMode}
          aria-pressed={isEditMode}
          className={`relative w-12 h-12 rounded-full flex items-center justify-center shadow-glass transition ${
            isEditMode
              ? 'bg-[#FF3B30] text-white'
              : 'glass-strong text-[#007AFF]'
          }`}
        >
          {isEditMode ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M11.5 1.5l3 3-9 9H2.5V10.5l9-9z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          )}
          {/* Small live indicator dot — pulses gently when edit mode is
              on, gives a peripheral cue without forcing the user to
              parse the icon. */}
          {isEditMode && (
            <motion.span
              aria-hidden
              className="absolute -top-0.5 -end-0.5 w-3 h-3 rounded-full bg-white border-2 border-[#FF3B30]"
              animate={{ scale: [1, 1.25, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </motion.button>
      </Tooltip>
    </div>
  )
}
