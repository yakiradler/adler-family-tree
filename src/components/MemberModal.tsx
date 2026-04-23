import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import { Avatar } from './MemberCard'
import type { Member } from '../types'

export default function MemberModal() {
  const { selectedMemberId, members, relationships, setSelectedMemberId, updateMember } = useFamilyStore()
  const { t } = useLang()
  const member = members.find((m) => m.id === selectedMemberId)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Partial<Member>>({})
  const photoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (member) setForm(member)
    setEditing(false)
  }, [member])

  if (!member) return null

  const relatives = relationships
    .filter((r) => r.member_a_id === member.id || r.member_b_id === member.id)
    .map((r) => {
      const otherId = r.member_a_id === member.id ? r.member_b_id : r.member_a_id
      const other = members.find((m) => m.id === otherId)
      return other ? { member: other, type: r.type } : null
    })
    .filter(Boolean) as { member: Member; type: string }[]

  const handleSave = async () => {
    const { id: _id, ...updates } = form as Member
    await updateMember(member.id, updates)
    setEditing(false)
  }

  const relLabel = (type: string) => {
    if (type === 'parent-child') return t.relParentChild
    if (type === 'spouse') return t.relSpouse
    return t.relSibling
  }

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => setSelectedMemberId(null)}
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
      />
      <motion.div
        key="modal"
        initial={{ opacity: 0, y: '100%' }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        className="fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] flex flex-col"
      >
        <div className="glass-strong rounded-t-[2rem] flex flex-col overflow-hidden shadow-glass-lg mx-1">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-black/15 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-center gap-4 px-5 pt-3 pb-4 border-b border-black/5">
            <Avatar member={member} size="lg" />
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="flex gap-2">
                  <input
                    value={form.first_name ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                    className="input-field text-sf-headline font-semibold py-2"
                    placeholder={t.firstName}
                  />
                  <input
                    value={form.last_name ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                    className="input-field text-sf-headline font-semibold py-2"
                    placeholder={t.lastName}
                  />
                </div>
              ) : (
                <h2 className="text-sf-title3 text-[#1C1C1E]">
                  {member.first_name} {member.last_name}
                </h2>
              )}
              {!editing && member.birth_date && (
                <p className="text-sf-subhead text-[#8E8E93] mt-0.5">
                  {t.bornLabel}{' '}
                  {new Date(member.birth_date).toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' })}
                  {member.death_date &&
                    ` · ${t.diedLabel} ${new Date(member.death_date).toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' })}`}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <motion.button whileTap={{ scale: 0.93 }} onClick={() => setEditing(false)} className="btn-secondary py-2 px-3 text-sf-subhead">
                    {t.cancel}
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.93 }} onClick={handleSave} className="btn-primary py-2 px-3 text-sf-subhead">
                    {t.save}
                  </motion.button>
                </>
              ) : (
                <>
                  <motion.button whileTap={{ scale: 0.93 }} onClick={() => setEditing(true)} className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="#636366" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.93 }} onClick={() => setSelectedMemberId(null)} className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 2l8 8M10 2L2 10" stroke="#636366" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </motion.button>
                </>
              )}
            </div>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto flex-1 p-5 space-y-5 pb-safe-bottom">
            {editing && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sf-caption text-[#8E8E93] mb-1 block">{t.birthDate}</label>
                    <input type="date" value={form.birth_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))} className="input-field py-2" />
                  </div>
                  <div>
                    <label className="text-sf-caption text-[#8E8E93] mb-1 block">{t.deathDate}</label>
                    <input type="date" value={form.death_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, death_date: e.target.value || undefined }))} className="input-field py-2" />
                  </div>
                </div>
                <div>
                  <label className="text-sf-caption text-[#8E8E93] mb-1 block">{t.biography}</label>
                  <textarea value={form.bio ?? ''} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} className="input-field py-2 resize-none" rows={3} placeholder={t.bioPlaceholder} />
                </div>
                <div>
                  <label className="text-sf-caption text-[#8E8E93] mb-1 block">{t.gender}</label>
                  <div className="flex gap-2">
                    {(['male', 'female'] as const).map(g => (
                      <button key={g} type="button"
                        onClick={() => setForm(f => ({ ...f, gender: f.gender === g ? undefined : g }))}
                        className={`flex-1 py-2 rounded-xl text-sf-subhead font-medium transition-colors ${
                          form.gender === g
                            ? g === 'male' ? 'bg-blue-500 text-white' : 'bg-pink-500 text-white'
                            : 'bg-[#F2F2F7] text-[#636366]'
                        }`}>
                        {g === 'male' ? t.genderMale : t.genderFemale}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sf-caption text-[#8E8E93] mb-1 block">{t.photo}</label>
                  <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = ev => setForm(f => ({ ...f, photo_url: ev.target?.result as string }))
                      reader.readAsDataURL(file)
                    }} />
                  <div className="flex gap-2 items-center">
                    {form.photo_url && (
                      <img src={form.photo_url} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-white shadow" />
                    )}
                    <button type="button" onClick={() => photoInputRef.current?.click()}
                      className="flex-1 py-2 rounded-xl bg-[#F2F2F7] text-[#636366] text-sf-subhead font-medium hover:bg-[#E5E5EA] transition-colors">
                      {form.photo_url ? t.changePhoto : t.uploadPhoto}
                    </button>
                    {form.photo_url && (
                      <button type="button" onClick={() => setForm(f => ({ ...f, photo_url: undefined }))}
                        className="w-9 h-9 rounded-xl bg-[#FF3B30]/10 flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 2l8 8M10 2L2 10" stroke="#FF3B30" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {!editing && member.bio && (
              <div>
                <p className="section-title px-0">{t.about}</p>
                <p className="text-sf-body text-[#3A3A3C] leading-relaxed">{member.bio}</p>
              </div>
            )}

            {relatives.length > 0 && (
              <div>
                <p className="section-title px-0 mb-3">{t.family}</p>
                <div className="space-y-2">
                  {relatives.map(({ member: rel, type }) => (
                    <motion.button
                      key={rel.id}
                      onClick={() => setSelectedMemberId(rel.id)}
                      whileTap={{ scale: 0.97 }}
                      className="flex items-center gap-3 w-full p-3 rounded-2xl bg-[#F2F2F7]/60 hover:bg-[#F2F2F7] transition-colors text-left"
                    >
                      <Avatar member={rel} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sf-subhead font-medium text-[#1C1C1E] truncate">{rel.first_name} {rel.last_name}</p>
                        <p className="text-sf-caption text-[#8E8E93]">{relLabel(type)}</p>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M6 4l4 4-4 4" stroke="#C7C7CC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </motion.button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
