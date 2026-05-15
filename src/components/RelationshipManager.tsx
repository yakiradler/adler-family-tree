import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import { getRingGradient, getFallbackGradient, PersonAvatarIcon } from './MemberNode'
import { canManageRelationships } from '../lib/permissions'
import type { Member, Gender, RelationshipType, SpouseStatus, ParentType, Relationship } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  member: Member
}

type TabKey = 'parents' | 'spouses' | 'children' | 'siblings'

export default function RelationshipManager({ open, onClose, member }: Props) {
  const { members, relationships, addRelationship, updateRelationship, deleteRelationship, addMember, profile } =
    useFamilyStore()
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const [tab, setTab] = useState<TabKey>('parents')
  const [picker, setPicker] = useState<RelationshipType | null>(null)
  const [pickerKind, setPickerKind] = useState<'parent' | 'spouse' | 'child' | null>(null)
  const [search, setSearch] = useState('')
  const [creatingNew, setCreatingNew] = useState(false)
  const [newFirst, setNewFirst] = useState('')
  const [newLast, setNewLast] = useState('')
  const [newGender, setNewGender] = useState<Gender | ''>('')
  // When the picker is opened for a SPOUSE, this controls whether the
  // resulting relationship is recorded as current / ex / deceased. Default
  // is 'current' so behavior matches pre-Phase B exactly.
  const [spouseStatusDraft, setSpouseStatusDraft] = useState<SpouseStatus>('current')
  const [parentTypeDraft, setParentTypeDraft] = useState<ParentType>('bio')
  const [busy, setBusy] = useState(false)
  // Brief visual confirmation that a change was persisted. The store is
  // optimistic + Supabase try/catch, so by the time we render this the
  // mutation has already landed in local state. Fades out after 2.2s.
  const [savedTick, setSavedTick] = useState(0)
  const flashSaved = () => setSavedTick((n) => n + 1)
  useEffect(() => {
    if (!savedTick) return
    const id = window.setTimeout(() => setSavedTick(0), 2200)
    return () => window.clearTimeout(id)
  }, [savedTick])

  // Derived relatives
  const { parents, spouses, children, siblings, parentRels, spouseRels, childRels } = useMemo(() => {
    const parentRels = relationships.filter(
      r => r.type === 'parent-child' && r.member_b_id === member.id,
    )
    const childRels = relationships.filter(
      r => r.type === 'parent-child' && r.member_a_id === member.id,
    )
    const spouseRels = relationships.filter(
      r => r.type === 'spouse' && (r.member_a_id === member.id || r.member_b_id === member.id),
    )
    const parentIds = new Set(parentRels.map(r => r.member_a_id))
    const childIds = new Set(childRels.map(r => r.member_b_id))
    const spouseIds = new Set(
      spouseRels.map(r => (r.member_a_id === member.id ? r.member_b_id : r.member_a_id)),
    )
    // siblings: same parents, not me, not child of me
    const siblingIds = new Set<string>()
    for (const pid of parentIds) {
      for (const r of relationships) {
        if (r.type === 'parent-child' && r.member_a_id === pid && r.member_b_id !== member.id) {
          siblingIds.add(r.member_b_id)
        }
      }
    }
    const byId = (id: string) => members.find(m => m.id === id)
    return {
      parents: [...parentIds].map(byId).filter(Boolean) as Member[],
      children: [...childIds].map(byId).filter(Boolean) as Member[],
      spouses: [...spouseIds].map(byId).filter(Boolean) as Member[],
      siblings: [...siblingIds].map(byId).filter(Boolean) as Member[],
      parentRels, spouseRels, childRels,
    }
  }, [members, relationships, member.id])

  if (!open) return null
  // Reuse the same `isAdmin` variable name (it now means
  // "can manage relationships" via the centralised permission helper —
  // admins always pass; users + masters with the toggle pass).
  const isAdmin = canManageRelationships(profile)

  // Candidates for picker
  const takenIds = new Set<string>([
    member.id,
    ...parents.map(p => p.id),
    ...children.map(c => c.id),
    ...spouses.map(s => s.id),
  ])
  const pickerResults = members
    .filter(m => !takenIds.has(m.id))
    .filter(m => {
      const s = search.trim().toLowerCase()
      if (!s) return true
      return (
        `${m.first_name} ${m.last_name}`.toLowerCase().includes(s) ||
        (m.nickname ?? '').toLowerCase().includes(s)
      )
    })
    .slice(0, 30)

  const closePicker = () => {
    setPicker(null); setPickerKind(null); setSearch('')
    setCreatingNew(false); setNewFirst(''); setNewLast(''); setNewGender('')
    setSpouseStatusDraft('current'); setParentTypeDraft('bio')
  }

  const linkExisting = async (otherId: string) => {
    if (!pickerKind || busy) return
    setBusy(true)
    try {
      const pt = parentTypeDraft !== 'bio' ? parentTypeDraft : undefined
      if (pickerKind === 'parent') {
        await addRelationship({ type: 'parent-child', member_a_id: otherId, member_b_id: member.id, parent_type: pt })
      } else if (pickerKind === 'child') {
        await addRelationship({ type: 'parent-child', member_a_id: member.id, member_b_id: otherId, parent_type: pt })
      } else if (pickerKind === 'spouse') {
        await addRelationship({
          type: 'spouse',
          member_a_id: member.id,
          member_b_id: otherId,
          status: spouseStatusDraft,
        })
      }
      flashSaved()
      closePicker()
    } finally {
      setBusy(false)
    }
  }

  const createAndLink = async () => {
    if (!newFirst.trim() || busy) return
    setBusy(true)
    try {
      const created = await addMember({
        first_name: newFirst.trim(),
        last_name: newLast.trim() || member.last_name,
        gender: (newGender || undefined) as Gender | undefined,
        created_by: profile?.id ?? 'demo',
      })
      if (created) {
        const pt = parentTypeDraft !== 'bio' ? parentTypeDraft : undefined
        if (pickerKind === 'parent') {
          await addRelationship({ type: 'parent-child', member_a_id: created.id, member_b_id: member.id, parent_type: pt })
        } else if (pickerKind === 'child') {
          await addRelationship({ type: 'parent-child', member_a_id: member.id, member_b_id: created.id, parent_type: pt })
        } else if (pickerKind === 'spouse') {
          await addRelationship({
            type: 'spouse',
            member_a_id: member.id,
            member_b_id: created.id,
            status: spouseStatusDraft,
          })
        }
        flashSaved()
      }
      closePicker()
    } finally {
      setBusy(false)
    }
  }

  const removeRel = async (relId: string) => {
    if (!window.confirm(t.relConfirmRemove)) return
    await deleteRelationship(relId)
    flashSaved()
  }

  const findParentRel = (parentId: string) =>
    parentRels.find(r => r.member_a_id === parentId)?.id
  const findChildRel = (childId: string) =>
    childRels.find(r => r.member_b_id === childId)?.id

  const dir = rtl ? 'rtl' : 'ltr'

  return (
    <AnimatePresence>
      <motion.div
        key="rel-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={onClose}
        dir={dir}
      >
        <motion.div
          key="rel-sheet"
          initial={{ y: 40, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          onClick={e => e.stopPropagation()}
          className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        >
          {/* Saved-toast — fades in/out for ~2.2s after each successful
              relationship mutation. Anchored at the top so it floats over
              the colourful header without obscuring the close button. */}
          <AnimatePresence>
            {savedTick > 0 && (
              <motion.div
                key={`saved-${savedTick}`}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                role="status"
                aria-live="polite"
                className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#34C759] text-white text-[12px] font-bold shadow-lg pointer-events-none"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 6.5l2.5 2.5L9.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t.relSavedToast}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Header */}
          <div className="relative px-5 pt-4 pb-3 bg-gradient-to-br from-[#007AFF] via-[#32ADE6] to-[#5AC8FA] text-white">
            <div className="absolute -top-10 -right-6 w-28 h-28 bg-white/15 rounded-full blur-2xl" />
            <div className="relative flex items-start gap-3">
              <div className="rounded-full flex-shrink-0" style={{ padding: 2, background: 'rgba(255,255,255,0.6)' }}>
                <div className="rounded-full bg-white p-[1.5px]">
                  <div className="w-12 h-12 rounded-full overflow-hidden">
                    {member.photo_url ? (
                      <img src={member.photo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(member)} flex items-center justify-center`}>
                        <PersonAvatarIcon gender={member.gender} size={48} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sf-headline font-bold leading-tight">{t.relTitle}</h2>
                <p className="text-[12px] opacity-90 mt-0.5 truncate">
                  {member.first_name} {member.last_name} · {t.relSubtitle}
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center"
                aria-label={t.relClose}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 3l8 8M11 3l-8 8" stroke="white" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="px-4 pt-3">
            <div className="bg-[#F2F2F7] rounded-2xl p-1 flex gap-1">
              {([
                ['parents', t.relTabParents, parents.length],
                ['spouses', t.relTabSpouses, spouses.length],
                ['children', t.relTabChildren, children.length],
                ['siblings', t.relTabSiblings, siblings.length],
              ] as const).map(([key, label, n]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex-1 py-1.5 rounded-xl text-[12px] font-semibold transition-all ${
                    tab === key ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#636366]'
                  }`}
                >
                  {label} <span className="opacity-60">({n})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {tab === 'parents' && (
              <RelList
                list={parents}
                findRelId={findParentRel}
                emptyLabel={t.relNoParents}
                onRemove={removeRel}
                isAdmin={isAdmin}
                lang={lang}
                getRelBadge={(id) => {
                  const rel = parentRels.find(r => r.member_a_id === id)
                  if (rel?.parent_type === 'step') return t.relStepBadge
                  if (rel?.parent_type === 'adoptive') return t.relAdoptiveBadge
                  return null
                }}
              />
            )}
            {tab === 'spouses' && (
              <SpouseList
                list={spouses}
                spouseRels={spouseRels}
                memberId={member.id}
                emptyLabel={t.relNoSpouses}
                onRemove={removeRel}
                onChangeStatus={async (relId, status) => {
                  await updateRelationship(relId, { status })
                  flashSaved()
                }}
                isAdmin={isAdmin}
                lang={lang}
                t={t}
              />
            )}
            {tab === 'children' && (
              <RelList
                list={children}
                findRelId={findChildRel}
                emptyLabel={t.relNoChildren}
                onRemove={removeRel}
                isAdmin={isAdmin}
                lang={lang}
                getRelBadge={(id) => {
                  const rel = childRels.find(r => r.member_b_id === id)
                  if (rel?.parent_type === 'step') return t.relStepBadge
                  if (rel?.parent_type === 'adoptive') return t.relAdoptiveBadge
                  return null
                }}
              />
            )}
            {tab === 'siblings' && (
              <RelList
                list={siblings}
                findRelId={() => undefined}
                emptyLabel={t.relNoSiblings}
                onRemove={() => {}}
                isAdmin={false}
                lang={lang}
                readOnly
              />
            )}
          </div>

          {/* Add buttons */}
          {isAdmin && tab !== 'siblings' && (
            <div className="px-4 pb-4 pt-1 border-t border-black/5 bg-white">
              <button
                onClick={() => {
                  if (tab === 'parents') { setPicker('parent-child'); setPickerKind('parent') }
                  if (tab === 'spouses') { setPicker('spouse'); setPickerKind('spouse') }
                  if (tab === 'children') { setPicker('parent-child'); setPickerKind('child') }
                }}
                className="w-full py-2.5 rounded-2xl bg-[#007AFF] text-white text-sf-subhead font-semibold active:scale-[0.98] transition flex items-center justify-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2v10M2 7h10" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {tab === 'parents' ? t.relAddParent : tab === 'spouses' ? t.relAddSpouse : t.relAddChild}
              </button>
            </div>
          )}

          {/* Picker overlay */}
          <AnimatePresence>
            {picker && (
              <motion.div
                key="picker"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                className="absolute inset-0 bg-white flex flex-col"
              >
                {/* Picker header */}
                <div className="px-4 pt-4 pb-2 flex items-center gap-2 border-b border-black/5">
                  <button
                    onClick={closePicker}
                    className="w-8 h-8 rounded-xl bg-[#F2F2F7] flex items-center justify-center"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d={rtl ? 'M5 3l4 4-4 4' : 'M9 3L5 7l4 4'} stroke="#636366" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <h3 className="text-sf-subhead font-bold text-[#1C1C1E]">
                    {pickerKind === 'parent' ? t.relAddParent : pickerKind === 'spouse' ? t.relAddSpouse : t.relAddChild}
                  </h3>
                </div>

                {/* Spouse status selector — only visible when adding a spouse.
                    Defaults to 'current' which matches pre-Phase B behavior. */}
                {pickerKind === 'spouse' && (
                  <div className="px-4 pt-3">
                    <p className="text-[11px] text-[#8E8E93] mb-1.5">{t.spouseStatus}</p>
                    <div className="bg-[#F2F2F7] rounded-2xl p-1 flex gap-1">
                      {(['current', 'ex', 'deceased'] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => setSpouseStatusDraft(s)}
                          className={`flex-1 py-1.5 rounded-xl text-[12px] font-semibold transition-all ${
                            spouseStatusDraft === s
                              ? 'bg-white text-[#1C1C1E] shadow-sm'
                              : 'text-[#636366]'
                          }`}
                        >
                          {s === 'current' ? t.spouseStatusCurrent
                           : s === 'ex' ? t.spouseStatusEx
                           : t.spouseStatusDeceased}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Parent type — bio / step / adoptive */}
                {(pickerKind === 'parent' || pickerKind === 'child') && (
                  <div className="px-4 pt-3">
                    <p className="text-[11px] text-[#8E8E93] mb-1.5">{t.relParentTypeLabel}</p>
                    <div className="bg-[#F2F2F7] rounded-2xl p-1 flex gap-1">
                      {(['bio', 'step', 'adoptive'] as const).map(pt => (
                        <button
                          key={pt}
                          onClick={() => setParentTypeDraft(pt)}
                          className={`flex-1 py-1.5 rounded-xl text-[12px] font-semibold transition-all ${
                            parentTypeDraft === pt
                              ? 'bg-white text-[#1C1C1E] shadow-sm'
                              : 'text-[#636366]'
                          }`}
                        >
                          {pt === 'bio' ? t.relParentTypeBio
                           : pt === 'step' ? t.relParentTypeStep
                           : t.relParentTypeAdoptive}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search */}
                <div className="px-4 pt-3">
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t.relSearchPlaceholder}
                    className="w-full px-4 py-2.5 rounded-2xl bg-[#F2F2F7] text-sf-body text-[#1C1C1E] placeholder-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]"
                  />
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
                  {pickerResults.length === 0 && !creatingNew ? (
                    <div className="text-center py-8 text-[#8E8E93] text-sf-caption">
                      {t.relCreateNew}
                    </div>
                  ) : (
                    pickerResults.map(m => (
                      <button
                        key={m.id}
                        onClick={() => linkExisting(m.id)}
                        disabled={busy}
                        className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-[#F2F2F7] transition text-start disabled:opacity-50"
                      >
                        <div className="rounded-full flex-shrink-0" style={{ padding: 2, background: getRingGradient(m) }}>
                          <div className="rounded-full bg-white p-[1.5px]">
                            <div className="w-9 h-9 rounded-full overflow-hidden">
                              {m.photo_url ? (
                                <img src={m.photo_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(m)} flex items-center justify-center`}>
                                  <PersonAvatarIcon gender={m.gender} size={36} />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 text-start">
                          <p className="text-sf-subhead font-semibold text-[#1C1C1E] truncate">
                            {m.first_name} {m.last_name}
                          </p>
                          {m.birth_date && (
                            <p className="text-[11px] text-[#8E8E93]">
                              {new Date(m.birth_date).getFullYear()}
                              {m.death_date ? ` – ${new Date(m.death_date).getFullYear()}` : ''}
                            </p>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>

                {/* Create new */}
                <div className="px-4 pb-4 pt-2 border-t border-black/5 space-y-2">
                  {!creatingNew ? (
                    <button
                      onClick={() => setCreatingNew(true)}
                      className="w-full py-2.5 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold active:scale-[0.98] transition flex items-center justify-center gap-2"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M7 2v10M2 7h10" stroke="#1C1C1E" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      {t.relCreateNew}
                    </button>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          placeholder={t.relCreateNewFirst}
                          value={newFirst}
                          onChange={e => setNewFirst(e.target.value)}
                          className="px-3 py-2 rounded-xl bg-[#F2F2F7] text-sf-body outline-none focus:ring-2 focus:ring-[#007AFF]"
                        />
                        <input
                          placeholder={t.relCreateNewLast}
                          value={newLast}
                          onChange={e => setNewLast(e.target.value)}
                          className="px-3 py-2 rounded-xl bg-[#F2F2F7] text-sf-body outline-none focus:ring-2 focus:ring-[#007AFF]"
                        />
                      </div>
                      <div className="flex gap-2">
                        {(['male', 'female'] as const).map(g => (
                          <button
                            key={g}
                            onClick={() => setNewGender(newGender === g ? '' : g)}
                            className={`flex-1 py-1.5 rounded-xl text-[12px] font-semibold transition-all ${
                              newGender === g
                                ? g === 'male' ? 'bg-[#007AFF] text-white' : 'bg-[#5AC8FA] text-white'
                                : 'bg-[#F2F2F7] text-[#636366]'
                            }`}
                          >
                            {g === 'male' ? t.relGenderMale : t.relGenderFemale}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setCreatingNew(false); setNewFirst(''); setNewLast(''); setNewGender('') }}
                          className="flex-1 py-2 rounded-xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold"
                        >
                          {t.relCancel}
                        </button>
                        <button
                          onClick={createAndLink}
                          disabled={!newFirst.trim() || busy}
                          className="flex-1 py-2 rounded-xl bg-[#007AFF] text-white text-sf-subhead font-semibold disabled:opacity-50"
                        >
                          {t.relCreateAndLink}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function RelList({
  list, findRelId, emptyLabel, onRemove, isAdmin, lang, readOnly, getRelBadge,
}: {
  list: Member[]
  findRelId: (id: string) => string | undefined
  emptyLabel: string
  onRemove: (relId: string) => void
  isAdmin: boolean
  lang: 'he' | 'en'
  readOnly?: boolean
  getRelBadge?: (memberId: string) => string | null
}) {
  const { setSelectedMemberId } = useFamilyStore()
  if (list.length === 0) {
    return (
      <div className="text-center py-10 px-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[#F2F2F7] flex items-center justify-center mb-2">
          <span className="text-2xl">👥</span>
        </div>
        <p className="text-sf-caption text-[#8E8E93]">{emptyLabel}</p>
      </div>
    )
  }
  return (
    <>
      {list.map(m => {
        const relId = findRelId(m.id)
        return (
          <div
            key={m.id}
            className="flex items-center gap-3 p-2 rounded-2xl bg-[#F9F9FB] hover:bg-[#F2F2F7] transition"
          >
            <button
              onClick={() => setSelectedMemberId(m.id)}
              className="flex items-center gap-3 flex-1 text-start min-w-0"
            >
              <div className="rounded-full flex-shrink-0" style={{ padding: 2, background: getRingGradient(m) }}>
                <div className="rounded-full bg-white p-[1.5px]">
                  <div className="w-10 h-10 rounded-full overflow-hidden">
                    {m.photo_url ? (
                      <img src={m.photo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(m)} flex items-center justify-center`}>
                        <PersonAvatarIcon gender={m.gender} size={40} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sf-subhead font-semibold text-[#1C1C1E] truncate flex items-center gap-1.5">
                  {m.first_name} {m.last_name}
                  {getRelBadge?.(m.id) && (
                    <span className="px-1.5 py-0.5 rounded-full bg-[#FF9F0A]/15 text-[#FF9F0A] text-[9px] font-bold flex-shrink-0">
                      {getRelBadge(m.id)}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-[#8E8E93]">
                  {m.birth_date
                    ? `${new Date(m.birth_date).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { year: 'numeric', month: 'short' })}`
                    : (m.nickname ?? '')}
                </p>
              </div>
            </button>
            {!readOnly && isAdmin && relId && (
              <button
                onClick={() => onRemove(relId)}
                className="w-8 h-8 rounded-xl bg-[#FF3B30]/10 hover:bg-[#FF3B30]/20 text-[#FF3B30] flex items-center justify-center flex-shrink-0"
                aria-label="Remove"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 3l8 8M11 3l-8 8" stroke="#FF3B30" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * Spouse-specific list. Each row exposes a 3-way status pill (current /
 * ex / deceased) so the user can reclassify a relationship without
 * deleting + re-adding it. The status is persisted to the relationships
 * table and the tree layout reads it on next render.
 */
function SpouseList({
  list, spouseRels, memberId, emptyLabel, onRemove, onChangeStatus,
  isAdmin, lang, t,
}: {
  list: Member[]
  spouseRels: Relationship[]
  memberId: string
  emptyLabel: string
  onRemove: (relId: string) => void
  onChangeStatus: (relId: string, status: SpouseStatus) => Promise<void>
  isAdmin: boolean
  lang: 'he' | 'en'
  t: {
    spouseStatusCurrent: string
    spouseStatusEx: string
    spouseStatusDeceased: string
  }
}) {
  const { setSelectedMemberId } = useFamilyStore()
  if (list.length === 0) {
    return (
      <div className="text-center py-10 px-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[#F2F2F7] flex items-center justify-center mb-2">
          <span className="text-2xl">💍</span>
        </div>
        <p className="text-sf-caption text-[#8E8E93]">{emptyLabel}</p>
      </div>
    )
  }

  // Map spouseId → relationship row, so we can read & write status.
  const relByPartner = new Map<string, Relationship>()
  for (const r of spouseRels) {
    const otherId = r.member_a_id === memberId ? r.member_b_id : r.member_a_id
    relByPartner.set(otherId, r)
  }

  return (
    <>
      {list.map(m => {
        const rel = relByPartner.get(m.id)
        const status: SpouseStatus = (rel?.status as SpouseStatus) ?? 'current'
        return (
          <div
            key={m.id}
            className="flex flex-col gap-2 p-2 rounded-2xl bg-[#F9F9FB] hover:bg-[#F2F2F7] transition"
          >
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedMemberId(m.id)}
                className="flex items-center gap-3 flex-1 text-start min-w-0"
              >
                <div className="rounded-full flex-shrink-0" style={{ padding: 2, background: getRingGradient(m) }}>
                  <div className="rounded-full bg-white p-[1.5px]">
                    <div className="w-10 h-10 rounded-full overflow-hidden">
                      {m.photo_url ? (
                        <img src={m.photo_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(m)} flex items-center justify-center`}>
                          <PersonAvatarIcon gender={m.gender} size={40} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sf-subhead font-semibold text-[#1C1C1E] truncate">
                    {m.first_name} {m.last_name}
                  </p>
                  <p className="text-[11px] text-[#8E8E93]">
                    {m.birth_date
                      ? `${new Date(m.birth_date).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { year: 'numeric', month: 'short' })}`
                      : (m.nickname ?? '')}
                  </p>
                </div>
              </button>
              {isAdmin && rel && (
                <button
                  onClick={() => onRemove(rel.id)}
                  className="w-8 h-8 rounded-xl bg-[#FF3B30]/10 hover:bg-[#FF3B30]/20 text-[#FF3B30] flex items-center justify-center flex-shrink-0"
                  aria-label="Remove"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 3l8 8M11 3l-8 8" stroke="#FF3B30" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
            {/* Status pill row */}
            {isAdmin && rel && (
              <div className="bg-white rounded-xl p-1 flex gap-1 border border-black/5">
                {(['current', 'ex', 'deceased'] as const).map(s => {
                  const active = status === s
                  const label =
                    s === 'current' ? t.spouseStatusCurrent
                    : s === 'ex' ? t.spouseStatusEx
                    : t.spouseStatusDeceased
                  // Color cue: current=blue, ex=amber, deceased=slate
                  const activeBg =
                    s === 'current' ? 'bg-[#007AFF] text-white'
                    : s === 'ex' ? 'bg-[#FF9F0A] text-white'
                    : 'bg-[#1F2937] text-white'
                  return (
                    <button
                      key={s}
                      onClick={() => onChangeStatus(rel.id, s)}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                        active ? activeBg : 'text-[#636366] hover:bg-[#F2F2F7]'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
            {(!isAdmin || !rel) && status !== 'current' && (
              <span className="self-start text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#1F2937]/10 text-[#1F2937]">
                {status === 'ex' ? t.spouseStatusEx : t.spouseStatusDeceased}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}
