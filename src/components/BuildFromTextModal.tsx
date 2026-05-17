import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import {
  parseTreeText,
  commitParseResult,
  type ParseResult,
  type ParsedMember,
} from '../lib/treeTextParser'
import type { Member } from '../types'

/**
 * "Build tree from text" modal — the local-parser path of the hybrid
 * approach (Option A). The user pastes a semi-structured description
 * of their family in Hebrew or English, we run it through the
 * regex-based parser in `lib/treeTextParser.ts`, show a preview of
 * everyone + every edge we identified, and on confirm materialise the
 * result via the optimistic CRUD actions on `useFamilyStore`.
 *
 * No external AI calls — this ships entirely in the existing bundle so
 * the user can try it even when Supabase / network are offline.
 *
 * When `anchorMember` is provided (opened from MemberPanel), every new
 * member with no parent in the preview is wired as a child / spouse /
 * parent of the anchor based on a header the user types ("ילדים:" /
 * "בני זוג:" / "הורים:"). When no anchor is provided (opened from the
 * Dashboard tile) the parsed tree is added as a standalone subtree.
 */

interface Props {
  open: boolean
  onClose: () => void
  /** When set, the modal frames the prompt as "add relatives to X" and
   *  parents/children/spouses in the parse result get linked back to
   *  this member. */
  anchorMember?: Member | null
  /** Called after successful commit with the count of created members. */
  onAdded?: (count: number) => void
}

export default function BuildFromTextModal({ open, onClose, anchorMember, onAdded }: Props) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const { addMember, addRelationship, profile, activeTreeId } = useFamilyStore()

  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [committing, setCommitting] = useState(false)
  const [committed, setCommitted] = useState<number | null>(null)

  // Reset transient state every time we close the modal — otherwise
  // re-opening would show the previous preview.
  const handleClose = () => {
    setText('')
    setParsed(null)
    setCommitting(false)
    setCommitted(null)
    onClose()
  }

  const handleParse = () => {
    const res = parseTreeText(text)
    setParsed(res)
    setCommitted(null)
  }

  const handleClear = () => {
    setText('')
    setParsed(null)
    setCommitted(null)
  }

  const memberRows = useMemo<ParsedMember[]>(() => parsed?.members ?? [], [parsed])

  const handleCommit = async () => {
    if (!parsed || committing) return
    setCommitting(true)
    try {
      const { created } = await commitParseResult(parsed, {
        addMember,
        addRelationship,
        authorId: profile?.id ?? 'demo-user',
        treeId: activeTreeId,
      })

      // If we were anchored to an existing member, link every parsed
      // "root" (someone the parser didn't attach to a parent) to the
      // anchor. We treat the anchor as the parent unless the user used
      // explicit `הורים:` headers — but the parser does not currently
      // assign a role to the anchor, so we just connect each root as
      // a child of the anchor, which matches the common case (the
      // user is filling in their own descendants).
      if (anchorMember && created > 0) {
        const tempIdToReal = new Map<string, string>()
        // Rebuild the mapping by name — `commitParseResult` doesn't
        // surface the id map, but the optimistic insert produced rows
        // with the same first/last name; we can fetch the current
        // members list and match. This is best-effort: if names
        // collide we just skip the auto-link.
        const fresh = useFamilyStore.getState().members
        for (const pm of parsed.members) {
          const match = fresh.find(
            (m) => m.first_name === pm.firstName
              && (!pm.lastName || m.last_name === pm.lastName)
              && (!pm.birthYear || (m.birth_date ?? '').startsWith(String(pm.birthYear))),
          )
          if (match) tempIdToReal.set(pm.tempId, match.id)
        }

        // Roots in the parse graph = parsed members with no incoming
        // parent-child edge. Those are the ones we attach to the anchor.
        const hasParentIn = new Set(
          parsed.relationships
            .filter((r) => r.type === 'parent-child')
            .map((r) => r.toTempId),
        )
        const roots = parsed.members.filter((m) => !hasParentIn.has(m.tempId))
        for (const root of roots) {
          const realId = tempIdToReal.get(root.tempId)
          if (!realId) continue
          await addRelationship({
            member_a_id: anchorMember.id,
            member_b_id: realId,
            type: 'parent-child',
            parent_type: 'bio',
          })
        }
      }

      setCommitted(created)
      onAdded?.(created)
    } finally {
      setCommitting(false)
    }
  }

  // Pre-fill helper note shown when anchored.
  const anchorName = anchorMember
    ? `${anchorMember.first_name} ${anchorMember.last_name ?? ''}`.trim()
    : ''
  const anchorNote = anchorMember
    ? t.btfPreFillNote.replace('{name}', anchorName)
    : ''
  const successMsg =
    committed !== null
      ? t.btfCommitSuccess.replace('{count}', String(committed))
      : ''

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          dir={rtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-sm no-print"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 32, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 32, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl max-h-[92vh] rounded-3xl bg-white shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header banner */}
            <div className="relative h-24 bg-gradient-to-br from-[#FF9F0A] to-[#FF375F] flex items-center justify-center">
              <div className="text-5xl" aria-hidden>📝</div>
              <button
                type="button"
                onClick={handleClose}
                className="absolute top-3 end-3 w-9 h-9 rounded-full bg-white/95 text-[#1C1C1E] text-lg font-bold flex items-center justify-center shadow active:scale-95 transition"
                aria-label={lang === 'he' ? 'סגור' : 'Close'}
              >
                ×
              </button>
            </div>

            {/* Body — vertical column with scroll */}
            <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-4">
              <div className="text-center">
                <h2 className="text-sf-title2 font-bold text-[#1C1C1E]">
                  {anchorMember
                    ? `${t.btfMemberPrefix} ${anchorName}`
                    : t.btfTitle}
                </h2>
                <p className="text-sf-subhead text-[#636366] leading-relaxed mt-1.5">
                  {anchorMember ? anchorNote : t.btfSubtitle}
                </p>
              </div>

              {/* Writing tips — collapsed by default on the smallest
                  screens so we don't push the textarea off-screen. */}
              <details className="rounded-2xl bg-[#F2F2F7] open:bg-[#E5E5EA] transition">
                <summary className="cursor-pointer select-none px-4 py-2.5 text-sf-footnote font-semibold text-[#1C1C1E] flex items-center gap-2">
                  <span>💡</span>
                  <span>{t.btfHintsTitle}</span>
                </summary>
                <ul className="px-5 pb-3 text-sf-footnote text-[#3C3C43] space-y-1">
                  <li>• {t.btfHint1}</li>
                  <li>• {t.btfHint2}</li>
                  <li>• {t.btfHint3}</li>
                  <li>• {t.btfHint4}</li>
                </ul>
              </details>

              {/* Free-form textarea — placeholder shows a full worked
                  example so the user has something to copy & adapt. */}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t.btfPlaceholder}
                rows={9}
                dir={rtl ? 'rtl' : 'ltr'}
                className="w-full rounded-2xl border border-[#E5E5EA] bg-[#FAFAFA] p-3.5 text-sf-body text-[#1C1C1E] placeholder:text-[#AEAEB2] resize-y focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:border-[#007AFF]/40 transition leading-relaxed font-mono"
              />

              {/* Action row — Parse + Clear, layout flips for RTL */}
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={!text.trim()}
                  className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-sf-subhead font-bold active:scale-[0.98] transition shadow-md disabled:opacity-40 disabled:active:scale-100"
                >
                  {t.btfParseBtn}
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={!text && !parsed}
                  className="px-4 py-3 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold active:scale-[0.98] transition disabled:opacity-40 disabled:active:scale-100"
                >
                  {t.btfClearText}
                </button>
              </div>

              {/* Preview */}
              {parsed && (
                <div className="space-y-3">
                  <h3 className="text-sf-headline font-bold text-[#1C1C1E]">
                    {t.btfPreviewTitle}
                  </h3>

                  {memberRows.length === 0 ? (
                    <div className="rounded-2xl bg-[#FFF4E5] border border-[#FFCC80] p-3 text-sf-footnote text-[#8A4B00]">
                      {t.btfNoMembers}
                    </div>
                  ) : (
                    <>
                      <PreviewCard
                        title={`${t.btfMembersFound} (${memberRows.length})`}
                        accent="#34C759"
                      >
                        <ul className="space-y-1.5">
                          {memberRows.map((m) => (
                            <li key={m.tempId} className="flex items-baseline gap-2 text-sf-footnote">
                              <span className="font-semibold text-[#1C1C1E]">
                                {m.firstName} {m.lastName ?? ''}
                              </span>
                              {m.birthYear && (
                                <span className="text-[#8E8E93]">· {m.birthYear}</span>
                              )}
                              {m.maidenName && (
                                <span className="text-[#8E8E93]">
                                  ({lang === 'he' ? 'לבית' : 'née'} {m.maidenName})
                                </span>
                              )}
                              {m.gender && (
                                <span className="text-xs text-[#AEAEB2]">
                                  {m.gender === 'male' ? '♂' : '♀'}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </PreviewCard>

                      {parsed.relationships.length > 0 && (
                        <PreviewCard
                          title={`${t.btfRelsFound} (${parsed.relationships.length})`}
                          accent="#007AFF"
                        >
                          <ul className="space-y-1 text-sf-footnote">
                            {parsed.relationships.map((r, i) => {
                              const a = memberRows.find((m) => m.tempId === r.fromTempId)
                              const b = memberRows.find((m) => m.tempId === r.toTempId)
                              if (!a || !b) return null
                              const label = r.type === 'parent-child' ? t.btfRelParent : t.btfRelSpouse
                              const arrow = r.type === 'parent-child' ? '→' : '↔'
                              return (
                                <li key={i} className="flex items-center gap-2">
                                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10.5px] font-semibold text-[#3C3C43]">
                                    {label}
                                  </span>
                                  <span className="text-[#1C1C1E]">{a.firstName}</span>
                                  <span className="text-[#AEAEB2]">{arrow}</span>
                                  <span className="text-[#1C1C1E]">{b.firstName}</span>
                                </li>
                              )
                            })}
                          </ul>
                        </PreviewCard>
                      )}

                      {parsed.warnings.length > 0 && (
                        <PreviewCard title={t.btfWarnings} accent="#FF9F0A">
                          <ul className="space-y-1 text-sf-footnote text-[#8A4B00]">
                            {parsed.warnings.map((w, i) => (
                              <li key={i}>• {w}</li>
                            ))}
                          </ul>
                        </PreviewCard>
                      )}

                      {parsed.questions.length > 0 && (
                        <PreviewCard title={t.btfQuestions} accent="#5E5CE6">
                          <ul className="space-y-1 text-sf-footnote text-[#3C3C43]">
                            {parsed.questions.map((q) => (
                              <li key={q.id}>• {q.message}</li>
                            ))}
                          </ul>
                        </PreviewCard>
                      )}
                    </>
                  )}
                </div>
              )}

              {committed !== null && (
                <div className="rounded-2xl bg-[#E8F8EE] border border-[#34C759]/40 p-3 text-sf-footnote text-[#1B5E20] text-center font-semibold">
                  ✓ {successMsg}
                </div>
              )}
            </div>

            {/* Sticky footer with the commit CTA — only shown once we
                have at least one parsed member ready to add. */}
            {parsed && memberRows.length > 0 && committed === null && (
              <div className="border-t border-[#E5E5EA] p-4 bg-white/95 backdrop-blur">
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={committing}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#34C759] to-[#30B454] text-white text-sf-subhead font-bold active:scale-[0.98] transition shadow-md disabled:opacity-60"
                >
                  {committing ? t.btfCommitting : t.btfCommit} ({memberRows.length})
                </button>
              </div>
            )}

            {committed !== null && (
              <div className="border-t border-[#E5E5EA] p-4 bg-white/95 backdrop-blur">
                <button
                  type="button"
                  onClick={handleClose}
                  className="w-full py-3 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold active:scale-[0.98] transition"
                >
                  {lang === 'he' ? 'סגור' : 'Close'}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── PreviewCard — tiny presentational subcomponent ──────────────────

function PreviewCard({
  title,
  accent,
  children,
}: {
  title: string
  accent: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-2xl border p-3"
      style={{
        borderColor: `${accent}40`,
        background: `${accent}0D`,
      }}
    >
      <div
        className="text-xs font-bold uppercase tracking-wide mb-1.5"
        style={{ color: accent }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}
