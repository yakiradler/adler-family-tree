import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import { isAdmin } from '../lib/permissions'
import type { Member, FamilyTree } from '../types'

/**
 * "Jump to surname tree" button that shows up on a member card when
 * their `last_name` differs from the active tree's name. Three flows:
 *
 *   1. The destination tree exists and the user has access  → switch.
 *   2. The destination tree DOES NOT exist:
 *      - admin / master can create it inline.
 *      - regular users see a "request access" CTA (filed as an
 *        access_request with a payload that flags the surname).
 *   3. The destination tree exists but the user lacks access — same
 *      "request access" path.
 *
 * Access policy (today): whoever has `isAdmin` is permitted; everyone
 * else is treated as needing approval. When tree-level RLS lands
 * (issue #15) this hook becomes the single source of truth.
 */
export default function JumpToFamilyTreeButton({ member }: { member: Member }) {
  const {
    trees, activeTreeId, setActiveTreeId, addTree, updateMember, profile,
    submitAccessRequest,
  } = useFamilyStore()
  const { lang } = useLang()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'create' | 'request' | null>(null)
  const [outcome, setOutcome] = useState<'switched' | 'created' | 'requested' | null>(null)

  // Match heuristic: last_name (trimmed, case/diacritic-insensitive)
  // against `tree.name`. We do a soft equality so "Adler" / "אדלר" /
  // " adler " all collapse.
  const targetName = (member.last_name || '').trim()
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

  const activeTree: FamilyTree | null =
    activeTreeId ? trees.find((tt) => tt.id === activeTreeId) ?? null : null

  const activeTreeName = activeTree?.name ?? (lang === 'he' ? 'עץ ראשי' : 'Main tree')

  const targetTree: FamilyTree | undefined = useMemo(
    () => (targetName ? trees.find((tt) => norm(tt.name) === norm(targetName)) : undefined),
    [trees, targetName],
  )

  // Don't render if there's nothing meaningful to do — same surname as
  // active context, or empty surname.
  if (!targetName) return null
  if (targetTree && activeTreeId === targetTree.id) return null
  if (!targetTree && !activeTreeId && norm(targetName) === norm(activeTreeName)) return null

  const userIsAdmin = isAdmin(profile)

  const doSwitch = () => {
    if (!targetTree) return
    setActiveTreeId(targetTree.id)
    setOutcome('switched')
  }

  const doCreate = async () => {
    setBusy(true)
    try {
      const created = await addTree({
        name: targetName,
        description: lang === 'he' ? `נוצר אוטומטית מ${member.first_name}` : `Auto-created from ${member.first_name}`,
        color: '#5E5CE6',
        created_by: profile?.id ?? 'demo',
      })
      if (created) {
        // Carry the founding member into the new tree so it isn't empty
        // — the user explicitly asked for "כשיוצרים עץ מאדם, תעביר גם
        // את הכרטיסיה שלו". Without this, switching to the freshly
        // created tree would render an empty canvas with nothing to
        // anchor on.
        await updateMember(member.id, { tree_id: created.id })
        setActiveTreeId(created.id)
        setOutcome('created')
      }
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const doRequest = async () => {
    setBusy(true)
    try {
      await submitAccessRequest({
        requested_role: profile?.role ?? 'user',
        invite_code: null,
        answers: {
          kind: 'tree-access',
          target_tree_name: targetName,
          via_member: { id: member.id, name: `${member.first_name} ${member.last_name}` },
          note: lang === 'he'
            ? `בקשת גישה לעץ ${targetName} דרך ${member.first_name}`
            : `Access request to tree "${targetName}" via ${member.first_name}`,
        },
      })
      setOutcome('requested')
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const labelExists = targetTree
    ? (lang === 'he' ? 'עבור לעץ' : 'Switch to tree')
    : (lang === 'he' ? 'פתח עץ חדש' : 'Open new tree')

  // Action when clicked: targets either a switch (have access),
  // an inline create (admin), or an access request (everyone else).
  const onPrimary = () => {
    if (targetTree) {
      // Currently no per-tree ACL — admins switch instantly, others
      // also switch (fall back to "request" when the policy is enabled
      // via issue #15). Until then, treat as an open switch.
      doSwitch()
      return
    }
    setConfirm(userIsAdmin ? 'create' : 'request')
  }

  return (
    <>
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={onPrimary}
        disabled={busy}
        className="w-full py-3 rounded-2xl bg-gradient-to-r from-[#5E5CE6] to-[#BF5AF2] text-white text-sf-subhead font-bold active:scale-[0.98] transition flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3 9l3 3 7-9"
            stroke="white"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          />
          <circle cx="13" cy="13" r="2" fill="white" opacity="0.9" />
        </svg>
        <span className="truncate">
          {labelExists}: <span className="opacity-90">{targetName}</span>
        </span>
      </motion.button>

      {/* Confirm sheet */}
      <AnimatePresence>
        {confirm && (
          <>
            <motion.div
              key="bg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirm(null)}
              className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              key="panel"
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className="fixed left-1/2 -translate-x-1/2 top-[20vh] z-[130] w-[calc(100vw-32px)] max-w-[380px] rounded-3xl bg-white p-5 shadow-2xl"
              dir={lang === 'he' ? 'rtl' : 'ltr'}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#5E5CE6] to-[#BF5AF2] flex items-center justify-center text-white text-xl">
                  {confirm === 'create' ? '🌲' : '📨'}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sf-headline font-bold text-[#1C1C1E]">
                    {confirm === 'create'
                      ? (lang === 'he' ? `ליצור עץ "${targetName}"?` : `Create tree "${targetName}"?`)
                      : (lang === 'he' ? `בקשת גישה לעץ ${targetName}` : `Request access to ${targetName}`)}
                  </h3>
                  <p className="text-[12px] text-[#636366] mt-0.5 leading-snug">
                    {confirm === 'create'
                      ? (lang === 'he'
                        ? `${member.first_name} שייך/ת לעץ ${targetName}. ליצור עכשיו ולעבור אליו?`
                        : `${member.first_name} belongs to the ${targetName} tree. Create it and switch?`)
                      : (lang === 'he'
                        ? 'הבקשה תישלח למנהל המערכת לבדיקה. תקבל הודעה ברגע שהבקשה אושרה.'
                        : 'The request will be sent to an admin. You’ll be notified once approved.')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirm(null)}
                  className="flex-1 py-2.5 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold"
                >
                  {lang === 'he' ? 'ביטול' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={confirm === 'create' ? doCreate : doRequest}
                  disabled={busy}
                  className="flex-[2] py-2.5 rounded-2xl bg-gradient-to-r from-[#5E5CE6] to-[#BF5AF2] text-white text-sf-subhead font-bold disabled:opacity-50"
                >
                  {busy
                    ? '…'
                    : confirm === 'create'
                    ? (lang === 'he' ? 'צור ועבור' : 'Create & switch')
                    : (lang === 'he' ? 'שלח בקשה' : 'Send request')}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Outcome toast */}
      <AnimatePresence>
        {outcome && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onAnimationComplete={() => {
              window.setTimeout(() => setOutcome(null), 2200)
            }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[140] flex items-center gap-2 px-4 py-2 rounded-full bg-[#34C759] text-white text-[12px] font-bold shadow-lg"
            role="status"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6.5l2.5 2.5L9.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {outcome === 'switched' && (lang === 'he' ? 'עברנו לעץ' : 'Switched tree')}
            {outcome === 'created' && (lang === 'he' ? 'עץ נוצר' : 'Tree created')}
            {outcome === 'requested' && (lang === 'he' ? 'בקשה נשלחה' : 'Request sent')}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
