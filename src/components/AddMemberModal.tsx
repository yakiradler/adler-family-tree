import { useState, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import { useCloseOnBack } from '../hooks/useCloseOnBack'
import type { Gender, Lineage } from '../types'
import { linkRelative, type RelativeDirection } from '../lib/relatives'
import { uploadMemberPhoto } from '../lib/photoUpload'

interface Props {
  open: boolean
  onClose: () => void
}

export default function AddMemberModal({ open, onClose }: Props) {
  const {
    addMember, addRelationship, relationships,
    members, selectedMemberId, profile, activeTreeId,
  } = useFamilyStore()
  const { t, lang } = useLang()
  // Phone back button closes the modal instead of leaving the page.
  useCloseOnBack(open, onClose)
  const [form, setForm] = useState({ first_name: '', last_name: '', maiden_name: '', birth_date: '', death_date: '', bio: '', photo_url: '', gender: '' as Gender | '', birth_order: '', lineage: '' as Lineage | '' })
  const [loading, setLoading] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // ── Relationship wiring ───────────────────────────────────────────
  // Every member must connect to the tree so nobody ends up "floating".
  // The only exception is the very first member of an (otherwise empty)
  // tree — they're the founding root. When the active tree already has
  // members, the user must pick an existing relative + a relation type,
  // and we wire it up via the same linkRelative() helper the per-card
  // "+" buttons use.
  const treeMembers = useMemo(
    () =>
      activeTreeId == null
        ? members.filter((m) => !m.tree_id)
        : members.filter((m) => m.tree_id === activeTreeId),
    [members, activeTreeId],
  )
  const needsRelation = treeMembers.length > 0
  const [relDirection, setRelDirection] = useState<RelativeDirection | ''>('')
  const [anchorId, setAnchorId] = useState<string>('')
  const [relSearch, setRelSearch] = useState('')
  // Default the anchor to the currently-selected member (if it's in this
  // tree); an explicit pick overrides it.
  const effectiveAnchorId =
    anchorId ||
    (selectedMemberId && treeMembers.some((m) => m.id === selectedMemberId) ? selectedMemberId : '')
  const anchorMember = treeMembers.find((m) => m.id === effectiveAnchorId) ?? null
  // A "sibling" only connects if the anchor has at least one parent (the
  // new member inherits them). Without that the sibling would float, so
  // we treat the relation as incomplete and steer the user elsewhere.
  const anchorHasParents = relationships.some(
    (r) => r.type === 'parent-child' && r.member_b_id === effectiveAnchorId,
  )
  const siblingWouldFloat = relDirection === 'sibling' && !anchorHasParents
  const relComplete =
    !needsRelation || (relDirection !== '' && anchorMember != null && !siblingWouldFloat)
  const anchorResults = useMemo(() => {
    const q = relSearch.trim().toLowerCase()
    const pool = q
      ? treeMembers.filter((m) => `${m.first_name} ${m.last_name ?? ''}`.toLowerCase().includes(q))
      : treeMembers
    return pool.slice(0, 8)
  }, [treeMembers, relSearch])

  const resetAndClose = () => {
    setForm({ first_name: '', last_name: '', maiden_name: '', birth_date: '', death_date: '', bio: '', photo_url: '', gender: '', birth_order: '', lineage: '' })
    setRelDirection('')
    setAnchorId('')
    setRelSearch('')
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return
    // Guard against a disconnected add: in a non-empty tree a relation
    // is mandatory so the new member can never end up floating.
    if (needsRelation && (!relComplete || !anchorMember || relDirection === '')) return
    setLoading(true)
    const parsedOrder = form.birth_order.trim() === '' ? undefined : parseInt(form.birth_order, 10)
    const created = await addMember({
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
      // Inherit the active tree so the new member shows up in the
      // current tree view. Without this the row lands with tree_id=null
      // and TreeView's `activeTreeId === null ? main pool : === activeTreeId`
      // filter hides them from any non-main tree the user is viewing.
      tree_id: activeTreeId ?? undefined,
    })
    // Wire the new member into the tree so it isn't a floating node.
    if (created && needsRelation && anchorMember && relDirection !== '') {
      await linkRelative({ created, anchor: anchorMember, direction: relDirection, addRelationship, relationships })
    }
    setLoading(false)
    resetAndClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={resetAndClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[95]"
          />
          {/* Centering wrapper.  We previously used `top-1/2
              -translate-y-1/2` on the motion.div itself, but Framer
              Motion's `animate={{ y: 0 }}` writes the `transform`
              property directly and clobbers the Tailwind translate —
              the modal landed pinned to top:50%/no shift, so its
              bottom half sat below the viewport and the user couldn't
              scroll to the footer fields.  Wrapping in a flexbox
              centerer keeps positioning and animation independent. */}
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              className="w-full max-w-sm max-h-[90vh] overflow-y-auto pointer-events-auto"
            >
            <div className="glass-strong rounded-3xl p-5 shadow-glass-lg">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sf-title3 text-[#1C1C1E]">{t.addMemberTitle}</h3>
                <motion.button whileTap={{ scale: 0.9 }} onClick={resetAndClose} className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center">
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
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''  // allow re-picking the same file
                      if (!file) return
                      // Upload to Storage and keep only the URL — never the
                      // raw multi-MB base64 we used to persist into the row.
                      setPhotoBusy(true)
                      try {
                        const url = await uploadMemberPhoto(file, activeTreeId)
                        setForm(f => ({ ...f, photo_url: url }))
                      } finally {
                        setPhotoBusy(false)
                      }
                    }} />
                  <div className="flex gap-2 items-center">
                    {form.photo_url && (
                      <img src={form.photo_url} alt="" className="w-10 h-10 rounded-full object-cover border-2 border-white shadow" />
                    )}
                    <button type="button" onClick={() => photoInputRef.current?.click()} disabled={photoBusy}
                      className="flex-1 py-2 rounded-xl bg-[#F2F2F7] text-[#636366] text-sf-subhead font-medium hover:bg-[#E5E5EA] transition-colors disabled:opacity-50">
                      {photoBusy ? '…' : form.photo_url ? t.changePhoto : t.uploadPhoto}
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

                {/* Relationship — mandatory once the tree has members so a
                    new person can never be added as a floating, unconnected
                    node. Skipped only for the very first member of a tree. */}
                {needsRelation && (
                  <div className="rounded-2xl bg-[#F2F2F7]/70 p-3 space-y-2">
                    <label className="text-sf-caption font-semibold text-[#1C1C1E] block">
                      {lang === 'he' ? 'איך הוא/היא מתחבר/ת למשפחה?' : 'How do they connect?'}
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {([
                        ['parent', t.addParent],
                        ['child', t.addChild],
                        ['spouse', t.addSpouse],
                        ['sibling', t.addSibling],
                      ] as const).map(([dir, label]) => (
                        <button
                          key={dir}
                          type="button"
                          onClick={() => setRelDirection(dir)}
                          className={`py-2 rounded-xl text-sf-caption font-semibold transition-colors ${
                            relDirection === dir ? 'bg-[#007AFF] text-white' : 'bg-white text-[#636366]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={relSearch}
                      onChange={(e) => setRelSearch(e.target.value)}
                      placeholder={lang === 'he' ? 'חפש בן/בת משפחה…' : 'Search member…'}
                      className="input-field py-2"
                      dir="auto"
                    />
                    <div className="max-h-32 overflow-y-auto rounded-xl bg-white divide-y divide-[#F2F2F7]">
                      {anchorResults.map((m) => {
                        const sel = m.id === effectiveAnchorId
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setAnchorId(m.id)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-start transition ${
                              sel ? 'bg-[#007AFF]/10' : 'hover:bg-[#F2F2F7]'
                            }`}
                          >
                            <span
                              className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold"
                              style={{ background: m.gender === 'female' ? 'linear-gradient(135deg,#FF5EAE,#B46BFF)' : 'linear-gradient(135deg,#2B6BFF,#19C6FF)' }}
                            >
                              {m.first_name.charAt(0)}
                            </span>
                            <span className="text-[13px] font-medium text-[#1C1C1E] truncate">
                              {m.first_name} {m.last_name}
                            </span>
                            {sel && <span className="ms-auto text-[#007AFF] text-xs">✓</span>}
                          </button>
                        )
                      })}
                      {anchorResults.length === 0 && (
                        <div className="px-3 py-2 text-[12px] text-[#8E8E93]">
                          {lang === 'he' ? 'לא נמצאו בני משפחה' : 'No matches'}
                        </div>
                      )}
                    </div>
                    {siblingWouldFloat && (
                      <p className="text-[11px] text-[#FF3B30]">
                        {lang === 'he'
                          ? 'לבן המשפחה שבחרת אין הורים רשומים — בחר/י קשר אחר (הורה/בן-זוג/ילד) כדי לחבר.'
                          : 'The selected member has no recorded parents — pick another relation (parent/spouse/child) to connect.'}
                      </p>
                    )}
                  </div>
                )}

                <motion.button type="submit" disabled={loading || !relComplete} whileTap={{ scale: 0.97 }} className="btn-primary w-full flex items-center justify-center gap-2 mt-1 disabled:opacity-50">
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
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
