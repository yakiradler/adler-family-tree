import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import { getRingGradient, getFallbackGradient, PersonAvatarIcon } from './MemberNode'
import EditMemberModal from './EditMemberModal'
import RelationshipManager from './RelationshipManager'
import type { Member } from '../types'

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
  const { members, relationships, selectedMemberId, setSelectedMemberId, profile } = useFamilyStore()
  const { t, lang } = useLang()
  const [tab, setTab] = useState<'about' | 'family' | 'photos'>('about')
  const [editOpen, setEditOpen] = useState(false)
  const [relOpen, setRelOpen] = useState(false)

  const member = useMemo(
    () => members.find(m => m.id === selectedMemberId) ?? null,
    [members, selectedMemberId],
  )

  const { spouses, parents, children, siblings } = useMemo(() => {
    if (!member) return { spouses: [], parents: [], children: [], siblings: [] }
    const spouseIds = relationships
      .filter(r => r.type === 'spouse' && (r.member_a_id === member.id || r.member_b_id === member.id))
      .map(r => (r.member_a_id === member.id ? r.member_b_id : r.member_a_id))
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
    const byId = (id: string) => members.find(m => m.id === id)
    return {
      spouses: spouseIds.map(byId).filter(Boolean) as Member[],
      parents: parentIds.map(byId).filter(Boolean) as Member[],
      children: [...new Set(childIds)].map(byId).filter(Boolean) as Member[],
      siblings: [...siblingSet].map(byId).filter(Boolean) as Member[],
    }
  }, [member, members, relationships])

  if (!member) return null

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
      className="glass-strong rounded-[28px] shadow-glass-lg overflow-hidden flex flex-col bg-white"
      style={{ maxHeight: 'calc(100vh - 120px)' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ─── HEADER cover (taller to fully seat the avatar) ─── */}
      <div className={`relative bg-gradient-to-br ${getHeaderGradient(member)} h-36 flex-shrink-0 overflow-hidden`}>
        {/* soft decorative blobs */}
        <div className="absolute -top-8 -right-8 w-28 h-28 bg-white/15 rounded-full blur-2xl" />
        <div className="absolute -bottom-10 -left-6 w-24 h-24 bg-white/10 rounded-full blur-2xl" />

        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onClose}
          className={`absolute top-3 ${isRTL(lang) ? 'left-3' : 'right-3'} w-9 h-9 rounded-full bg-black/30 backdrop-blur flex items-center justify-center hover:bg-black/45 transition`}
          aria-label={t.relClose ?? 'Close'}
          title={t.relClose ?? 'Close'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </motion.button>
      </div>

      {/* ─── SCROLL BODY ─── */}
      <div className="flex-1 overflow-y-auto">
        {/* Profile photo + identity (centered, avatar seated inside the header) */}
        <div className="px-5 -mt-16 flex flex-col items-center text-center">
          <div
            className="rounded-full shadow-xl"
            style={{ padding: 3.5, background: getRingGradient(member) }}
          >
            <div className="rounded-full bg-white p-[3px]">
              <div className="w-28 h-28 rounded-full overflow-hidden relative">
                {member.photo_url ? (
                  <img
                    src={member.photo_url}
                    alt={`${member.first_name} ${member.last_name}`}
                    className={`w-full h-full object-cover ${isDeceased ? 'grayscale' : ''}`}
                  />
                ) : (
                  <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(member)} flex items-center justify-center`}>
                    <PersonAvatarIcon gender={member.gender} size={112} />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 w-full">
            <h2 className="text-sf-title2 font-bold text-[#1C1C1E] leading-tight">
              {member.first_name} {member.last_name}
            </h2>
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
          </div>
        </div>

        {/* Quick stat pills */}
        <div className="px-5 mt-4 grid grid-cols-3 gap-2">
          <StatPill value={relationCount} label={t.family} />
          <StatPill value={children.length} label={t.genChildren} />
          <StatPill value={photos.length} label={t.photos} />
        </div>

        {/* Tabs */}
        <div className="px-5 mt-4">
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
        <div className="px-5 py-4 pb-2">
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
                {!member.birth_date && !member.death_date && !member.bio && (
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
                {spouses.length > 0 && (
                  <FamilySection title={t.relSpouse} members={spouses} onMemberClick={setSelectedMemberId} />
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
        {profile?.role === 'admin' && (
          <div className="px-5 pb-5 pt-1 space-y-2">
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
          </div>
        )}
      </div>

      <EditMemberModal open={editOpen} onClose={() => setEditOpen(false)} member={member} />
      <RelationshipManager open={relOpen} onClose={() => setRelOpen(false)} member={member} />
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
