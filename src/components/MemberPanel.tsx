import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import { getRingGradient, getFallbackGradient, PersonAvatarIcon } from './MemberNode'
import EditMemberModal from './EditMemberModal'
import JumpToFamilyTreeButton from './JumpToFamilyTreeButton'
import RelationshipManager from './RelationshipManager'
import LineageBadge from './LineageBadge'
import { canEditMember, canManageRelationships } from '../lib/permissions'
import { buildParentMap, resolveLineage } from '../lib/lineage'
import type { Member, SpouseStatus } from '../types'

interface Props {
  onClose: () => void
}

function getHeaderGradient(_m?: Member) {
  // Unified blue/cyan gradient for all profiles (system theme)
  return 'from-[#007AFF] via-[#32ADE6] to-[#5AC8FA]'
}

function formatDate(iso: string | undefined, lang: 'he' | 'en') {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch { return iso }
}

export default function MemberPanel({ onClose }: Props) {
  const { members, relationships, selectedMemberId, setSelectedMemberId, profile, deleteMember, deleteRelationship, updateMember, addMember, trees } = useFamilyStore()
  const { t, lang } = useLang()
  const [tab, setTab] = useState<'about' | 'family' | 'photos'>('about')
  const [editOpen, setEditOpen] = useState(false)
  const [relOpen, setRelOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copyToTreeOpen, setCopyToTreeOpen] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copyDone, setCopyDone] = useState(false)

  const member = useMemo(
    () => members.find(m => m.id === selectedMemberId) ?? null,
    [members, selectedMemberId],
  )

  const { currentSpouses, formerSpouses, parents, children, siblings, spouses } = useMemo(() => {
    if (!member) return {
      currentSpouses: [], formerSpouses: [],
      parents: [], children: [], siblings: [], spouses: [],
    }
    const spouseRels = relationships.filter(
      r => r.type === 'spouse' && (r.member_a_id === member.id || r.member_b_id === member.id),
    )
    const otherId = (r: { member_a_id: string; member_b_id: string }) =>
      r.member_a_id === member.id ? r.member_b_id : r.member_a_id

    const byId = (id: string) => members.find(m => m.id === id)

    // Group by status; treat null/undefined as 'current' for back-compat.
    const cur: Member[] = []
    const former: { member: Member; status: SpouseStatus }[] = []
    for (const r of spouseRels) {
      const m = byId(otherId(r))
      if (!m) continue
      const s = (r.status ?? 'current') as SpouseStatus
      if (s === 'current') cur.push(m)
      else former.push({ member: m, status: s })
    }

    const parentIds = relationships
      .filter(r => r.type === 'parent-child' && r.member_b_id === member.id)
      .map(r => r.member_a_id)
    const childIds = relationships
      .filter(r => r.type === 'parent-child' && r.member_a_id === member.id)
      .map(r => r.member_b_id)
    const siblingSet = new Set<string>()
    for (const pid of parentIds) {
      for (const r of relationships) {
        if (r.type === 'parent-child' && r.member_a_id === pid && r.member_b_id !== member.id) {
          siblingSet.add(r.member_b_id)
        }
      }
    }

    return {
      currentSpouses: cur,
      formerSpouses: former,
      parents: parentIds.map(byId).filter(Boolean) as Member[],
      children: [...new Set(childIds)].map(byId).filter(Boolean) as Member[],
      siblings: [...siblingSet].map(byId).filter(Boolean) as Member[],
      spouses: [...cur, ...former.map(f => f.member)],
    }
  }, [member, members, relationships])

  // Descendants by generation depth — used by the stat pills so a
  // grandparent shows {ילדים, נכדים}, a great-grandparent additionally
  // shows {נינים}, and so on. Walks the parent-child DAG breadth-first
  // and bucketises by depth so each member is counted exactly once.
  const descendantsByGen = useMemo(() => {
    const out: number[] = []
    if (!member) return out
    let frontier = new Set<string>([member.id])
    const visited = new Set<string>([member.id])
    // Cap at 5 generations down — anything deeper is mostly noise on
    // small screens and rarely meaningful for a family tree CRM.
    for (let depth = 0; depth < 5; depth++) {
      const next = new Set<string>()
      for (const id of frontier) {
        for (const r of relationships) {
          if (r.type !== 'parent-child' || r.member_a_id !== id) continue
          if (!visited.has(r.member_b_id)) {
            visited.add(r.member_b_id)
            next.add(r.member_b_id)
          }
        }
      }
      if (next.size === 0) break
      out.push(next.size)
      frontier = next
    }
    return out
  }, [member, relationships])

  // Lineage info — male-only badge + daughterOf marker.
  const lineageInfo = useMemo(() => {
    if (!member) return null
    const parentMap = buildParentMap(members, relationships)
    return resolveLineage(member, parentMap)
  }, [member, members, relationships])

  if (!member) return null

  // ── Phase D RBAC gates ───────────────────────────────────────────────
  // The `nuclearFamilyIds` set lets `canEditMember` permit users to edit
  // their parents/children/spouses without admin rights.
  const nuclearFamilyIds = new Set<string>([
    ...spouses.map(s => s.id),
    ...parents.map(p => p.id),
    ...children.map(c => c.id),
  ])
  const editAllowed = canEditMember(profile, {
    targetMemberId: member.id,
    nuclearFamilyIds,
    // ownMemberId is not yet wired into Profile; nuclearFamilyIds covers the
    // "edit your immediate family" case until that link is added.
  })
  const relAllowed = canManageRelationships(profile)
  // Delete is admin-only — destructive, can't be undone.
  const deleteAllowed = profile?.role === 'admin'

  const handleCopyToTree = async (targetTreeId: string | null) => {
    if (!member || copying) return
    setCopying(true)
    const { id: _id, ...fields } = member
    await addMember({ ...fields, tree_id: targetTreeId ?? undefined, created_by: profile?.id ?? 'demo' })
    setCopying(false)
    setCopyToTreeOpen(false)
    setCopyDone(true)
    setTimeout(() => setCopyDone(false), 2500)
  }

  const handleDelete = async () => {
    if (!member || deleting) return
    setDeleting(true)
    // First remove all relationships that involve this member so the tree
    // doesn't end up with dangling references.
    const memberRels = relationships.filter(
      r => r.member_a_id === member.id || r.member_b_id === member.id,
    )
    await Promise.all(memberRels.map(r => deleteRelationship(r.id)))
    await deleteMember(member.id)
    setDeleting(false)
    setDeleteConfirmOpen(false)
    onClose()
  }

  const age = member.birth_date
    ? (member.death_date
      ? new Date(member.death_date).getFullYear() - new Date(member.birth_date).getFullYear()
      : new Date().getFullYear() - new Date(member.birth_date).getFullYear())
    : null
  const isDeceased = !!member.death_date
  const photos = member.photos && member.photos.length > 0
    ? member.photos
    : (member.photo_url ? [member.photo_url] : [])

  const relationCount = spouses.length + parents.length + children.length + siblings.length

  return (
    <div
      className="glass-strong rounded-[24px] shadow-glass-lg flex flex-col bg-white relative"
      style={{ maxHeight: 'calc(100vh - 120px)' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ─── HEADER cover ─── */}
      {/* Header height + radius reduced (h-28→h-20, 28→24px) along with
          the avatar below to make the whole panel feel substantially
          tighter — a recurring user complaint that earlier max-width
          trims didn't fully resolve. */}
      <div className={`relative bg-gradient-to-br ${getHeaderGradient(member)} h-20 flex-shrink-0 rounded-t-[24px] overflow-hidden`}>
        {/* soft decorative blobs */}
        <div className="absolute -top-8 -right-8 w-28 h-28 bg-white/15 rounded-full blur-2xl" />
        <div className="absolute -bottom-10 -left-6 w-24 h-24 bg-white/10 rounded-full blur-2xl" />

        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onClose}
          className={`absolute top-2 ${isRTL(lang) ? 'left-2' : 'right-2'} w-7 h-7 rounded-full bg-black/30 backdrop-blur flex items-center justify-center hover:bg-black/45 transition z-20`}
          aria-label={t.relClose ?? 'Close'}
          title={t.relClose ?? 'Close'}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </motion.button>
      </div>

      {/* ─── AVATAR: floats between header and body, NEVER clipped ───
          Avatar shrunk from 112×112 → 72×72 to keep the panel compact;
          marginTop also trimmed (-56 → -36) to match the new header
          height (h-20). Icon size + ring padding scaled in proportion
          so the visual ring looks balanced at the smaller radius. */}
      <div className="relative flex-shrink-0 flex justify-center" style={{ marginTop: -36, zIndex: 10 }}>
        <div
          className="rounded-full shadow-xl"
          style={{ padding: 2.5, background: getRingGradient(member) }}
        >
          <div className="rounded-full bg-white p-[2px]">
            <div className="w-[72px] h-[72px] rounded-full overflow-hidden relative">
              {member.photo_url ? (
                <img
                  src={member.photo_url}
                  alt={`${member.first_name} ${member.last_name}`}
                  className={`w-full h-full object-cover ${isDeceased ? 'grayscale' : ''}`}
                />
              ) : (
                <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(member)} flex items-center justify-center`}>
                  <PersonAvatarIcon gender={member.gender} size={72} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── SCROLL BODY ─── */}
      <div className="flex-1 overflow-y-auto rounded-b-[24px]">
        <div className="px-4 pt-2 flex flex-col items-center text-center">
          <div className="w-full">
            <h2 className="text-sf-headline font-bold text-[#1C1C1E] leading-tight">
              {member.first_name} {member.last_name}
            </h2>
            {/* "לבית X" — surfaces the maiden name right under the
                official name. The user asked for a way to see this in
                the profile rather than only in the search match. */}
            {member.maiden_name && (
              <p className="text-sf-caption text-[#8E8E93] mt-0.5 italic">
                {lang === 'he' ? `לבית ${member.maiden_name}` : `née ${member.maiden_name}`}
              </p>
            )}
            {member.nickname && (
              <p className="text-sf-subhead text-[#636366] mt-0.5">"{member.nickname}"</p>
            )}
            <div className="flex items-center justify-center gap-3 mt-2 text-sf-caption text-[#8E8E93] flex-wrap">
              {age !== null && (
                <span className="flex items-center gap-1">
                  <span>🎂</span>
                  {isDeceased
                    ? `${new Date(member.birth_date!).getFullYear()} – ${new Date(member.death_date!).getFullYear()}`
                    : `${t.age} ${age}`}
                </span>
              )}
              {isDeceased && (
                <span className="bg-[#8E8E93]/15 text-[#636366] rounded-full px-2 py-0.5 text-[10px] font-semibold">
                  ז״ל
                </span>
              )}
              {member.gender && (
                <span className="text-sm">{member.gender === 'male' ? '♂' : '♀'}</span>
              )}
            </div>

            {/* Hidden-from-tree affordance — shown only on members the
                user (or an admin) explicitly flagged hidden. Mirrors the
                Instagram / WhatsApp pattern: the data stays put, but the
                tree treats them as removed and the panel surfaces a
                one-tap restore. We gate the restore on the same edit
                permission as every other field on this card. */}
            {member.hidden && (
              <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 bg-[#FF9F0A]/15 text-[#9A5A00] rounded-full px-2.5 py-1 text-[11px] font-semibold">
                  <span aria-hidden>🙈</span>
                  {t.panelHiddenBadge}
                </span>
                {editAllowed && (
                  <button
                    type="button"
                    onClick={() => updateMember(member.id, { hidden: false })}
                    className="inline-flex items-center gap-1 bg-[#34C759] hover:bg-[#30B454] text-white rounded-full px-3 py-1 text-[11px] font-semibold shadow-sm transition active:scale-95"
                  >
                    <span aria-hidden>👁️</span>
                    {t.panelRestoreToTree}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quick stat pills — primary row. Tightened gutters + outer
            padding to keep the row inside the 260-px-wide panel
            without each pill turning into a single column. */}
        <div className="px-4 mt-3 grid grid-cols-3 gap-1.5">
          <StatPill value={relationCount} label={t.family} />
          <StatPill value={children.length} label={t.genChildren} />
          <StatPill value={photos.length} label={t.photos} />
        </div>
        {/* Descendant generations — only shown when there's at least
            one grandchild. The labels evolve down the line:
            ילדים → נכדים → נינים → בני־נינים → דור 5+. We skip depth=0
            (children — already in the primary row) and start at depth=1. */}
        {descendantsByGen.length > 1 && (
          <div className="px-4 mt-1.5 grid grid-cols-4 gap-1.5">
            {descendantsByGen.slice(1).map((count, i) => {
              const label =
                i === 0 ? t.descendantsGen1
                : i === 1 ? t.descendantsGen2
                : i === 2 ? t.descendantsGen3
                : t.descendantsGen4
              return <StatPill key={i} value={count} label={label} />
            })}
          </div>
        )}

        {/* Tabs */}
        <div className="px-4 mt-3">
          <div className="flex gap-1 bg-[#F2F2F7] rounded-2xl p-1">
            {([
              ['about', t.about],
              ['family', t.family],
              ['photos', t.photos],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 py-1.5 px-2 rounded-xl text-[12px] font-semibold transition-all ${
                  tab === key ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#8E8E93]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="px-4 py-3 pb-2">
          <AnimatePresence mode="wait">
            {tab === 'about' && (
              <motion.div
                key="about"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="space-y-2.5"
              >
                {member.birth_date && (
                  <InfoRow icon="🎂" label={t.bornLabel} value={formatDate(member.birth_date, lang)} sub={member.hebrew_birth_date} />
                )}
                {member.death_date && (
                  <InfoRow icon="🕯️" label={t.diedLabel} value={formatDate(member.death_date, lang)} sub={member.hebrew_death_date} />
                )}
                {member.bio && (
                  <div className="bg-[#F2F2F7] rounded-2xl p-3">
                    <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1.5">{t.biography}</p>
                    <p className="text-sf-footnote text-[#1C1C1E] leading-relaxed whitespace-pre-wrap">
                      {member.bio}
                    </p>
                  </div>
                )}
                {/* Lineage line — Kohen / Levi for males or "Daughter of a Kohen / Levi" for females. */}
                {lineageInfo && (lineageInfo.showBadge || lineageInfo.daughterOf) && (
                  <div className="flex items-center gap-2 bg-gradient-to-r from-[#FFF6D6] to-[#FFEAB2] rounded-2xl p-3">
                    {lineageInfo.showBadge && (
                      <span className="relative w-7 h-7 inline-flex items-center justify-center">
                        <LineageBadge info={lineageInfo} size={14} variant="ring" />
                      </span>
                    )}
                    <div className="flex-1">
                      <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide">{t.lineageLabel}</p>
                      <p className="text-sf-footnote font-bold text-[#8A5A00]">
                        {lineageInfo.showBadge && lineageInfo.lineage === 'kohen' && t.lineageKohen}
                        {lineageInfo.showBadge && lineageInfo.lineage === 'levi' && t.lineageLevi}
                        {!lineageInfo.showBadge && lineageInfo.daughterOf === 'kohen' && t.lineageDaughterOfKohen}
                        {!lineageInfo.showBadge && lineageInfo.daughterOf === 'levi' && t.lineageDaughterOfLevi}
                      </p>
                    </div>
                  </div>
                )}
                {/* Maiden / former last name — surface when set. */}
                {member.maiden_name && (
                  <InfoRow icon="🌸" label={t.maidenNameLabel} value={member.maiden_name} />
                )}
                {!member.birth_date && !member.death_date && !member.bio && !member.maiden_name && !lineageInfo?.showBadge && !lineageInfo?.daughterOf && (
                  <EmptyTab icon="📝" text={t.panelNoInfo} />
                )}
              </motion.div>
            )}

            {tab === 'family' && (
              <motion.div
                key="family"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="space-y-4"
              >
                {currentSpouses.length > 0 && (
                  <FamilySection title={t.relSpouse} members={currentSpouses} onMemberClick={setSelectedMemberId} />
                )}
                {formerSpouses.length > 0 && (
                  <FormerSpouseSection
                    title={t.formerSpousesLabel}
                    items={formerSpouses}
                    t={t}
                    onMemberClick={setSelectedMemberId}
                  />
                )}
                {parents.length > 0 && (
                  <FamilySection title={t.panelParents} members={parents} onMemberClick={setSelectedMemberId} />
                )}
                {children.length > 0 && (
                  <ChildrenShowcase title={`${t.genChildren} (${children.length})`} members={children} onMemberClick={setSelectedMemberId} />
                )}
                {siblings.length > 0 && (
                  <FamilySection title={t.relSibling} members={siblings} onMemberClick={setSelectedMemberId} />
                )}
                {relationCount === 0 && <EmptyTab icon="👥" text={t.panelNoFamily} />}
              </motion.div>
            )}

            {tab === 'photos' && (
              <motion.div
                key="photos"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                {photos.length === 0 ? (
                  <EmptyTab icon="📷" text={t.panelNoPhotos} />
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {photos.map((url, i) => (
                      <motion.div
                        key={i}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        className="aspect-square rounded-xl overflow-hidden bg-[#F2F2F7]"
                      >
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Action buttons: full-width stacked rows so labels are always readable */}
        {(editAllowed || relAllowed || deleteAllowed || member.last_name) && (
          <div className="px-4 pb-4 pt-1 space-y-1.5">
            {/* Surname-aware tree jump — only renders if the member's
                surname doesn't match the active tree (handled inside
                the component). Lets families navigate between linked
                trees without leaving the profile card. */}
            <JumpToFamilyTreeButton member={member} />
            {editAllowed && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              aria-label={t.panelEdit}
              title={t.panelEdit}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-sf-subhead font-bold active:scale-[0.98] transition flex items-center justify-center gap-2 shadow-md"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2.5 12V14H4.5L13 5.5L11 3.5L2.5 12Z" fill="white" />
              </svg>
              <span>{t.panelEdit}</span>
            </button>
            )}
            {relAllowed && (
            <button
              type="button"
              onClick={() => setRelOpen(true)}
              aria-label={t.relManageBtn}
              title={t.relManageBtn}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-[#5AC8FA] to-[#64D2FF] text-white text-sf-subhead font-bold active:scale-[0.98] transition flex items-center justify-center gap-2 shadow-md"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="5" cy="4" r="2" fill="white" />
                <circle cx="11" cy="4" r="2" fill="white" />
                <path d="M1.5 13.5c0-2.2 1.6-3.5 3.5-3.5s3.5 1.3 3.5 3.5M7.5 13.5c0-2.2 1.6-3.5 3.5-3.5s3.5 1.3 3.5 3.5" stroke="white" strokeWidth="1.3" strokeLinecap="round" fill="none" />
              </svg>
              <span>{t.relManageBtn}</span>
            </button>
            )}
            {/* ── Copy to another tree ── */}
            {editAllowed && (
            <button
              type="button"
              onClick={() => { setCopyToTreeOpen(true); setCopyDone(false) }}
              aria-label={t.panelCopyToTree}
              title={t.panelCopyToTree}
              className="w-full py-2.5 rounded-2xl border border-[#5AC8FA]/40 text-[#0A84FF] text-sf-subhead font-semibold active:scale-[0.98] transition flex items-center justify-center gap-2 hover:bg-[#0A84FF]/5"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <rect x="2" y="4.5" width="8" height="8.5" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5 4.5V3A1.5 1.5 0 0 1 6.5 1.5h5.5A1.5 1.5 0 0 1 13.5 3v8.5A1.5 1.5 0 0 1 12 11.5h-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span>{copyDone ? t.panelCopyToTreeDone : t.panelCopyToTree}</span>
            </button>
            )}
            {/* ── Delete (admin-only, destructive) ── */}
            {deleteAllowed && (
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              aria-label={t.panelDeleteMember}
              title={t.panelDeleteMember}
              className="w-full py-2.5 rounded-2xl border border-[#FF3B30]/30 text-[#FF3B30] text-sf-subhead font-semibold active:scale-[0.98] transition flex items-center justify-center gap-2 hover:bg-[#FF3B30]/5"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <path d="M3 4h9M6 4V2.5h3V4M5.5 4v7.5h4V4" stroke="#FF3B30" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{t.panelDeleteMember}</span>
            </button>
            )}
          </div>
        )}
      </div>

      <EditMemberModal open={editOpen} onClose={() => setEditOpen(false)} member={member} />
      <RelationshipManager open={relOpen} onClose={() => setRelOpen(false)} member={member} />

      {/* ── Copy to tree dialog ── */}
      <AnimatePresence>
        {copyToTreeOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center rounded-[28px] bg-black/40 backdrop-blur-sm"
            onClick={() => !copying && setCopyToTreeOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="mx-4 w-full rounded-3xl bg-white shadow-glass-lg p-5 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-[#0A84FF]/10 flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="5" width="9" height="9" rx="2" stroke="#0A84FF" strokeWidth="1.5" />
                    <path d="M5 5V3.5A1.5 1.5 0 0 1 6.5 2H13A1.5 1.5 0 0 1 14.5 3.5V11A1.5 1.5 0 0 1 13 12.5h-1.5" stroke="#0A84FF" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <p className="text-sf-subhead font-bold text-[#1C1C1E]">{t.panelCopyToTreeTitle}</p>
                  <p className="text-[11px] text-[#636366] font-semibold mt-0.5">{member.first_name} {member.last_name}</p>
                </div>
              </div>
              <p className="text-sf-footnote text-[#636366] leading-relaxed">{t.panelCopyToTreeNote}</p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {/* Main tree option — only when member is in a named tree */}
                {member.tree_id && (
                  <button
                    type="button"
                    disabled={copying}
                    onClick={() => handleCopyToTree(null)}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl bg-[#F2F2F7] hover:bg-[#E5E5EA] transition text-start disabled:opacity-50"
                  >
                    <div className="w-6 h-6 rounded-full bg-[#8E8E93] flex-shrink-0" />
                    <p className="text-sf-subhead font-semibold text-[#1C1C1E]">{t.panelCopyToTreeMain}</p>
                  </button>
                )}
                {trees
                  .filter((tr) => tr.id !== member.tree_id)
                  .map((tr) => (
                    <button
                      key={tr.id}
                      type="button"
                      disabled={copying}
                      onClick={() => handleCopyToTree(tr.id)}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl bg-[#F2F2F7] hover:bg-[#E5E5EA] transition text-start disabled:opacity-50"
                    >
                      <div
                        className="w-6 h-6 rounded-full flex-shrink-0"
                        style={{ background: tr.color ?? '#8E8E93' }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sf-subhead font-semibold text-[#1C1C1E] truncate">{tr.name}</p>
                        {tr.description && (
                          <p className="text-[10px] text-[#8E8E93] truncate">{tr.description}</p>
                        )}
                      </div>
                      {copying && <svg className="animate-spin w-4 h-4 text-[#8E8E93]" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeDasharray="30 14" /></svg>}
                    </button>
                  ))
                }
                {/* No targets available */}
                {!member.tree_id && trees.length === 0 && (
                  <p className="text-center text-sf-footnote text-[#8E8E93] py-4">
                    {t.treeSwitcherCreate}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={copying}
                onClick={() => setCopyToTreeOpen(false)}
                className="w-full py-2.5 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold disabled:opacity-50"
              >
                {t.panelDeleteConfirmNo}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete confirmation dialog ── */}
      <AnimatePresence>
        {deleteConfirmOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center rounded-[28px] bg-black/40 backdrop-blur-sm"
            onClick={() => !deleting && setDeleteConfirmOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="mx-4 rounded-3xl bg-white shadow-glass-lg p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#FF3B30]/10 flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M3.5 5h11M7 5V3.5h4V5M6.5 5v9h5V5" stroke="#FF3B30" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <p className="text-sf-subhead font-bold text-[#1C1C1E]">{t.panelDeleteConfirmTitle}</p>
                  <p className="text-[11px] text-[#636366] font-semibold mt-0.5">
                    {member.first_name} {member.last_name}
                  </p>
                </div>
              </div>
              <p className="text-sf-footnote text-[#3C3C43] leading-relaxed">
                {t.panelDeleteConfirmBody}
              </p>
              <div className={`flex gap-2 ${isRTL(lang) ? 'flex-row-reverse' : ''}`}>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmOpen(false)}
                  disabled={deleting}
                  className="flex-1 py-2.5 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold disabled:opacity-50"
                >
                  {t.panelDeleteConfirmNo}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 py-2.5 rounded-2xl bg-[#FF3B30] text-white text-sf-subhead font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {deleting ? (
                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="5.5" stroke="white" strokeWidth="2" strokeDasharray="20 14" />
                    </svg>
                  ) : null}
                  {t.panelDeleteConfirmYes}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function StatPill({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-[#F2F2F7] rounded-2xl py-2 text-center">
      <p className="text-lg font-bold text-[#1C1C1E] leading-none">{value}</p>
      <p className="text-[10px] text-[#8E8E93] font-medium mt-0.5">{label}</p>
    </div>
  )
}

function InfoRow({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3 bg-[#F2F2F7] rounded-2xl p-3">
      <span className="text-lg leading-none pt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide">{label}</p>
        <p className="text-sf-subhead text-[#1C1C1E] mt-0.5">{value}</p>
        {sub && <p className="text-sf-caption text-[#636366] mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function EmptyTab({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="text-center py-8">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-[#F2F2F7] flex items-center justify-center mb-2">
        <span className="text-2xl">{icon}</span>
      </div>
      <p className="text-sf-footnote text-[#8E8E93]">{text}</p>
    </div>
  )
}

function ChildrenShowcase({
  title, members, onMemberClick,
}: {
  title: string
  members: Member[]
  onMemberClick: (id: string) => void
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-2 px-1">{title}</p>
      <div className="grid grid-cols-3 gap-2">
        {members.map(m => {
          const by = m.birth_date ? new Date(m.birth_date).getFullYear() : null
          const dy = m.death_date ? new Date(m.death_date).getFullYear() : null
          const dateLabel = by ? (dy ? `${by}–${dy}` : `${by}`) : null
          return (
            <motion.button
              key={m.id}
              whileTap={{ scale: 0.96 }}
              whileHover={{ y: -2 }}
              onClick={() => onMemberClick(m.id)}
              className="bg-white rounded-2xl border border-black/5 shadow-sm p-2 flex flex-col items-center gap-1 hover:shadow-md transition"
            >
              <div className="rounded-full" style={{ padding: 2, background: getRingGradient(m) }}>
                <div className="rounded-full bg-white p-[1.5px]">
                  <div className="w-14 h-14 rounded-full overflow-hidden">
                    {m.photo_url ? (
                      <img src={m.photo_url} alt="" className={`w-full h-full object-cover ${m.death_date ? 'grayscale' : ''}`} />
                    ) : (
                      <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(m)} flex items-center justify-center`}>
                        <PersonAvatarIcon gender={m.gender} size={56} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-[11px] font-bold text-[#1C1C1E] leading-tight text-center truncate w-full mt-1">
                {m.first_name}
              </p>
              {m.last_name && (
                <p className="text-[10px] text-[#636366] leading-tight text-center truncate w-full -mt-0.5">
                  {m.last_name}
                </p>
              )}
              {dateLabel && (
                <p className="text-[9px] text-[#8E8E93] font-medium leading-tight">{dateLabel}</p>
              )}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Former spouses (divorced / widowed) — surfaced ONLY inside the profile,
 * never on the tree. Uses a subdued tone to keep painful family history
 * unobtrusive while still making it accessible. Each entry shows a small
 * status pill ("גירושין" / "אלמן/ה") next to the name.
 */
function FormerSpouseSection({
  title, items, t, onMemberClick,
}: {
  title: string
  items: { member: Member; status: SpouseStatus }[]
  t: { statusDivorced: string; statusWidowed: string }
  onMemberClick: (id: string) => void
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-2 px-1">{title}</p>
      <div className="space-y-1.5">
        {items.map(({ member: m, status }) => {
          const isDeceased = status === 'deceased'
          return (
            <motion.button
              key={m.id}
              whileTap={{ scale: 0.97 }}
              onClick={() => onMemberClick(m.id)}
              className="w-full flex items-center gap-3 p-2 rounded-2xl bg-[#F8F8FA] hover:bg-[#F2F2F7] transition-colors"
            >
              <div className="rounded-full" style={{ padding: 1.5, background: isDeceased ? 'linear-gradient(135deg,#9CA3AF,#6B7280)' : getRingGradient(m), opacity: isDeceased ? 1 : 0.85 }}>
                <div className="rounded-full bg-white p-[1px]">
                  <div className="w-9 h-9 rounded-full overflow-hidden">
                    {m.photo_url ? (
                      <img src={m.photo_url} alt="" className={`w-full h-full object-cover ${isDeceased ? 'grayscale' : ''}`} />
                    ) : (
                      <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(m)} flex items-center justify-center ${isDeceased ? 'grayscale' : ''}`}>
                        <PersonAvatarIcon gender={m.gender} size={36} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <p className="flex-1 text-start text-sf-footnote font-medium text-[#1C1C1E] truncate">
                {m.first_name} {m.last_name}
              </p>
              <span
                className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${
                  isDeceased
                    ? 'bg-[#1F2937]/10 text-[#1F2937]'
                    : 'bg-[#FF9F0A]/15 text-[#FF9F0A]'
                }`}
              >
                {isDeceased ? t.statusWidowed : t.statusDivorced}
              </span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

function FamilySection({
  title, members, onMemberClick,
}: {
  title: string
  members: Member[]
  onMemberClick: (id: string) => void
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-2 px-1">{title}</p>
      <div className="grid grid-cols-4 gap-2">
        {members.map(m => (
          <motion.button
            key={m.id}
            whileTap={{ scale: 0.95 }}
            onClick={() => onMemberClick(m.id)}
            className="flex flex-col items-center gap-1 p-1 rounded-2xl hover:bg-[#F2F2F7] transition-colors"
          >
            <div className="rounded-full" style={{ padding: 1.5, background: getRingGradient(m) }}>
              <div className="rounded-full bg-white p-[1px]">
                <div className="w-11 h-11 rounded-full overflow-hidden">
                  {m.photo_url ? (
                    <img src={m.photo_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(m)} flex items-center justify-center`}>
                      <PersonAvatarIcon gender={m.gender} size={44} />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <p className="text-[10px] font-medium text-[#1C1C1E] text-center leading-tight truncate w-full">
              {m.first_name}
            </p>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
