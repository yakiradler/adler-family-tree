import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import type { Gender, Lineage } from '../types'

interface Props {
  open: boolean
  onClose: () => void
}

export default function AddMemberModal({ open, onClose }: Props) {
  const { addMember, profile } = useFamilyStore()
  const { t } = useLang()
  const [form, setForm] = useState({ first_name: '', last_name: '', maiden_name: '', birth_date: '', death_date: '', bio: '', photo_url: '', gender: '' as Gender | '', birth_order: '', lineage: '' as Lineage | '' })
  const [loading, setLoading] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return
    setLoading(true)
    const parsedOrder = form.birth_order.trim() === '' ? undefined : parseInt(form.birth_order, 10)
    await addMember({
      first_name: form.first_name,
      last_name: form.last_name,
      maiden_name: form.maiden_name.trim() || undefined,
      birth_date: form.birth_date || undefined,
      death_date: form.death_date || undefined,
      bio: form.bio || undefined,
      photo_url: form.photo_url || undefined,
      gender: (form.gender as Gender) || undefined,
      birth_order: parsedOrder != null && !isNaN(parsedOrder) ? parsedOrder : undefined,
      lineage: (form.lineage as Lineage) || null,
      created_by: profile.id,
    })
    setLoading(false)
    setForm({ first_name: '', last_name: '', maiden_name: '', birth_date: '', death_date: '', bio: '', photo_url: '', gender: '', birth_order: '', lineage: '' })
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-sm mx-auto max-h-[90vh] overflow-y-auto max-h-[90vh] overflow-y-auto"
          >
            <div className="glass-strong rounded-3xl p-5 shadow-glass-lg">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sf-title3 text-[#1C1C1E]">{t.addMemberTitle}</h3>
                <motion.button whileTap={{ scale: 0.9 }} onClick={onClose} className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 2l8 8M10 2L2 10" stroke="#636366" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </motion.button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <input required placeholder={t.firstName} value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} className="input-field py-2.5" />
                  <input required placeholder={t.lastName} value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} className="input-field py-2.5" />
                </div>
                <div>
                  <label className="text-sf-caption text-[#8E8E93] mb-1 block">{t.maidenNameLabel}</label>
                  <input placeholder={t.maidenNameLabel} value={form.maiden_name} onChange={(e) => setForm((f) => ({ ...f, maiden_name: e.target.value }))} className="input-field py-2.5" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-sf-caption text-[#8E8E93] mb-1 block">{t.birthDate}</label>
                    <input type="date" value={form.birth_date} onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))} className="input-field py-2" />
                  </div>
                  <div>
                    <label className="text-sf-caption text-[#8E8E93] mb-1 block">{t.deathDate}</label>
                    <input type="date" value={form.death_date} onChange={(e) => setForm((f) => ({ ...f, death_date: e.target.value }))} className="input-field py-2" />
                  </div>
                </div>
                <textarea placeholder={t.bioOptional} value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} className="input-field resize-none py-2" rows={2} />

                {/* Birth order */}
                <div>
                  <label className="text-sf-caption text-[#8E8E93] mb-1 block">{t.birthOrderLabel}</label>
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    placeholder="1, 2, 3…"
                    value={form.birth_order}
                    onChange={(e) => setForm(f => ({ ...f, birth_order: e.target.value }))}
                    className="input-field py-2"
                  />
                  <p className="text-[10px] text-[#8E8E93] mt-1">{t.birthOrderHint}</p>
                </div>

                {/* Gender */}
                <div>
                  <label className="text-sf-caption text-[#8E8E93] mb-1 block">{t.gender}</label>
                  <div className="flex gap-2">
                    {(['male', 'female'] as const).map(g => (
                      <button key={g} type="button"
                        onClick={() => setForm(f => ({ ...f, gender: f.gender === g ? '' : g }))}
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

                {/* Lineage (שושלת) */}
                <div>
                  <label className="text-sf-caption text-[#8E8E93] mb-1 block">{t.lineage}</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {([
                      { key: '', label: t.lineageAuto, cls: 'from-[#E5E5EA] to-[#E5E5EA]' },
                      { key: 'kohen', label: t.lineageKohen, cls: 'from-amber-400 to-yellow-500' },
                      { key: 'levi', label: t.lineageLevi, cls: 'from-indigo-400 to-blue-600' },
                      { key: 'israel', label: t.lineageIsrael, cls: 'from-emerald-400 to-teal-500' },
                    ] as const).map(opt => {
                      const active = form.lineage === opt.key
                      return (
                        <button key={opt.key || 'auto'} type="button"
                          onClick={() => setForm(f => ({ ...f, lineage: opt.key }))}
                          className={`py-2 rounded-xl text-sf-caption font-semibold transition-colors ${
                            active
                              ? `bg-gradient-to-br ${opt.cls} text-white shadow-sm`
                              : 'bg-[#F2F2F7] text-[#636366]'
                          }`}>
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Photo upload */}
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
                      <img src={form.photo_url} alt="" className="w-10 h-10 rounded-full object-cover border-2 border-white shadow" />
                    )}
                    <button type="button" onClick={() => photoInputRef.current?.click()}
                      className="flex-1 py-2 rounded-xl bg-[#F2F2F7] text-[#636366] text-sf-subhead font-medium hover:bg-[#E5E5EA] transition-colors">
                      {form.photo_url ? t.changePhoto : t.uploadPhoto}
                    </button>
                    {form.photo_url && (
                      <button type="button" onClick={() => setForm(f => ({ ...f, photo_url: '' }))}
                        className="w-9 h-9 rounded-xl bg-[#FF3B30]/10 flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 2l8 8M10 2L2 10" stroke="#FF3B30" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                <motion.button type="submit" disabled={loading} whileTap={{ scale: 0.97 }} className="btn-primary w-full flex items-center justify-center gap-2 mt-1">
                  {loading ? (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 2v12M2 8h12" stroke="white" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                  {t.addBtn}
                </motion.button>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
