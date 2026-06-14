import { useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import { useCloseOnBack } from '../hooks/useCloseOnBack'
import { PersonAvatarIcon } from './MemberNode'
import { getRingGradient, getFallbackGradient } from './memberVisuals'
import type { Member, Gender, Lineage } from '../types'
import { uploadMemberPhoto } from '../lib/photoUpload'
import { isSupabaseConfigured } from '../lib/supabase'

interface Props {
  open: boolean
  onClose: () => void
  member: Member
  /**
   * Regular-user path: the same form, but saving SUBMITS an edit
   * request for admin approval instead of writing the member directly
   * (the requester has no edit rights on this member).
   */
  suggestMode?: boolean
}

interface FormState {
  first_name: string
  last_name: string
  maiden_name: string
  nickname: string
  bio: string
  birth_date: string
  death_date: string
  hebrew_birth_date: string
  hebrew_death_date: string
  gender: Gender | ''
  birth_order: string
  lineage: Lineage | ''
  photo_url: string
  photos: string[]
  hidden: boolean
  connector_parent_id: string | ''
  phone: string
  email: string
  facebook: string
  instagram: string
}

function fromMember(m: Member): FormState {
  return {
    first_name: m.first_name ?? '',
    last_name: m.last_name ?? '',
    maiden_name: m.maiden_name ?? '',
    nickname: m.nickname ?? '',
    bio: m.bio ?? '',
    birth_date: m.birth_date ?? '',
    death_date: m.death_date ?? '',
    hebrew_birth_date: m.hebrew_birth_date ?? '',
    hebrew_death_date: m.hebrew_death_date ?? '',
    gender: (m.gender as Gender | undefined) ?? '',
    birth_order: m.birth_order != null ? String(m.birth_order) : '',
    lineage: (m.lineage ?? '') as Lineage | '',
    photo_url: m.photo_url ?? '',
    photos: m.photos ? [...m.photos] : [],
    hidden: !!m.hidden,
    connector_parent_id: m.connector_parent_id ?? '',
    phone: m.contact?.phone ?? '',
    email: m.contact?.email ?? '',
    facebook: m.contact?.facebook ?? '',
    instagram: m.contact?.instagram ?? '',
  }
}

export default function EditMemberModal({ open, onClose, member, suggestMode = false }: Props) {
  const { updateMember, submitEditRequest, members, relationships } = useFamilyStore()
  // Parents of this member — used by the "connector parent" picker so
  // the user can choose which parent the descending tree-line draws
  // from (default: mother).
  const parents = useMemo(
    () =>
      relationships
        .filter((r) => r.type === 'parent-child' && r.member_b_id === member.id)
        .map((r) => members.find((m) => m.id === r.member_a_id))
        .filter(Boolean) as Member[],
    [relationships, members, member.id],
  )
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  // Phone back button closes the modal instead of leaving the page.
  useCloseOnBack(open, onClose)
  const [form, setForm] = useState<FormState>(() => fromMember(member))
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const profileInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  // Reset form each time a new member is opened — done during render
  // (React's "adjust state during render" pattern) instead of an effect,
  // so the old member's values never reach a committed frame.
  const [prevReset, setPrevReset] = useState<{ open: boolean; member: Member }>({ open, member })
  if (prevReset.open !== open || prevReset.member !== member) {
    setPrevReset({ open, member })
    if (open) setForm(fromMember(member))
  }

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(f => ({ ...f, [key]: value }))

  // Photos upload to Supabase Storage and we persist only the URL —
  // never the raw base64 we used to keep (multi-MB rows, lost on reload).
  const onProfilePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    try {
      patch('photo_url', await uploadMemberPhoto(file, member.tree_id))
    } finally {
      setPhotoBusy(false)
    }
  }

  const onGalleryAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setPhotoBusy(true)
    try {
      const urls = await Promise.all(files.map((f) => uploadMemberPhoto(f, member.tree_id)))
      setForm(f => ({ ...f, photos: [...f.photos, ...urls] }))
    } finally {
      setPhotoBusy(false)
    }
  }

  const removeGalleryPhoto = (idx: number) => {
    setForm(f => ({ ...f, photos: f.photos.filter((_, i) => i !== idx) }))
  }

  const promoteToProfile = (idx: number) => {
    setForm(f => {
      const next = [...f.photos]
      const [img] = next.splice(idx, 1)
      // Demote current profile photo into gallery if present
      if (f.photo_url) next.unshift(f.photo_url)
      return { ...f, photo_url: img, photos: next }
    })
  }

  const handleSave = async () => {
    setSaving(true)
    const parsedOrder = form.birth_order.trim() === '' ? null : parseInt(form.birth_order, 10)
    const changes = {
      first_name: form.first_name.trim() || member.first_name,
      last_name: form.last_name.trim(),
      maiden_name: form.maiden_name.trim() || undefined,
      nickname: form.nickname.trim() || undefined,
      bio: form.bio.trim() || undefined,
      birth_date: form.birth_date || undefined,
      death_date: form.death_date || undefined,
      hebrew_birth_date: form.hebrew_birth_date.trim() || undefined,
      hebrew_death_date: form.hebrew_death_date.trim() || undefined,
      gender: (form.gender as Gender) || undefined,
      birth_order: parsedOrder != null && !isNaN(parsedOrder) ? parsedOrder : null,
      lineage: (form.lineage as Lineage) || null,
      photo_url: form.photo_url || undefined,
      photos: form.photos.length ? form.photos : undefined,
      hidden: form.hidden,
      connector_parent_id: form.connector_parent_id || null,
      contact: (() => {
        const c = {
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          facebook: form.facebook.trim() || undefined,
          instagram: form.instagram.trim() || undefined,
        }
        // null (not undefined) so clearing every field actually persists.
        return Object.values(c).some(Boolean) ? c : null
      })(),
    }
    if (suggestMode) {
      // No edit rights on this member — the change lands in the admin's
      // requests tab instead of being written directly.
      const sent = await submitEditRequest(member.id, changes)
      setSaving(false)
      if (sent) window.alert(t.editSuggestSent)
      onClose()
      return
    }
    await updateMember(member.id, changes)
    setSaving(false)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/35 backdrop-blur-sm z-[95]"
          />
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            dir={rtl ? 'rtl' : 'ltr'}
            // z-[100] sits above the floating Navigation island (z-50)
            // and the layout/tutorial pills (z-30). Previously this was
            // z-80, but a stacking-context quirk on iOS let the black
            // Navigation island render visually above the modal anyway.
            className="fixed inset-x-3 top-[5vh] bottom-[5vh] z-[100] max-w-md mx-auto flex flex-col glass-strong rounded-3xl shadow-glass-lg overflow-hidden bg-white"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative flex items-center justify-between px-5 py-3 border-b border-[#E5E5EA]/80 bg-white/80 backdrop-blur">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sf-subhead font-medium text-[#636366] rounded-lg active:bg-[#F2F2F7]"
              >
                {t.cancel}
              </button>
              <h3 className="text-sf-subhead font-bold text-[#1C1C1E]">{t.editProfileTitle}</h3>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 text-sf-subhead font-bold text-[#007AFF] rounded-lg active:bg-[#007AFF]/10 disabled:opacity-60"
              >
                {saving ? t.editSaving : suggestMode ? t.editSuggestSubmit : t.save}
              </button>
            </div>

            {/* Body — `min-h-0` is critical: without it the flex child
                refuses to shrink, the `overflow-y-auto` never engages,
                and long forms (full member edit) get clipped at the
                modal's bottom edge with no way to scroll to the rest of
                the fields. */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-5">
              {/* Profile photo uploader */}
              <div className="flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => profileInputRef.current?.click()}
                  className="relative group"
                  aria-label={t.editChangeProfilePhoto}
                >
                  <div
                    className="rounded-full shadow-xl"
                    style={{ padding: 3.5, background: getRingGradient(member) }}
                  >
                    <div className="rounded-full bg-white p-[3px]">
                      <div className="w-28 h-28 rounded-full overflow-hidden relative">
                        {form.photo_url ? (
                          <img src={form.photo_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(member)} flex items-center justify-center`}>
                            <PersonAvatarIcon gender={form.gender || member.gender} size={112} />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-white text-sf-caption font-semibold">✎</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-[#007AFF] border-2 border-white shadow flex items-center justify-center">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2 10.5V12h1.5L12 3.5 10.5 2 2 10.5z" fill="white" />
                    </svg>
                  </div>
                </button>
                <input
                  ref={profileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onProfilePhotoChange}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => profileInputRef.current?.click()}
                    disabled={photoBusy}
                    className="text-[#007AFF] text-sf-footnote font-semibold disabled:opacity-50"
                  >
                    {photoBusy ? '…' : form.photo_url ? t.editChangeProfilePhoto : t.editSetProfilePhoto}
                  </button>
                  {form.photo_url && (
                    <>
                      <span className="text-[#C7C7CC]">·</span>
                      <button
                        type="button"
                        onClick={() => patch('photo_url', '')}
                        className="text-[#FF3B30] text-sf-footnote font-semibold"
                      >
                        {t.editRemove}
                      </button>
                    </>
                  )}
                </div>
                {/* Warning when any photo on this member is still a base64
                    data: URI. In configured mode photos upload to Supabase
                    Storage and persist as URLs; this warning only applies
                    in demo/offline mode, where inline images can't survive
                    a reload. Tell the user so they don't think it vanished. */}
                {!isSupabaseConfigured && (
                  (form.photo_url && form.photo_url.startsWith('data:')) ||
                  form.photos.some((p) => p.startsWith('data:'))
                ) && (
                  <div className="mx-1 mt-1 px-3 py-2 rounded-xl bg-[#FFCC00]/15 border border-[#FFCC00]/30 text-[11px] text-[#8E6E00] leading-snug max-w-[18rem] text-center">
                    {lang === 'he'
                      ? 'תמונה זו נשמרת בזיכרון בלבד — סגירת הטאב או רענון הדף ימחקו אותה (אחסון תמונות ב-Supabase עדיין לא פעיל). השתמש בקישור http/https לתמונה שצריכה להישמר.'
                      : 'This photo is in-memory only — closing the tab or refreshing will lose it (Supabase Storage uploads aren’t wired yet). Use an http/https image URL for photos that need to persist.'}
                  </div>
                )}
              </div>

              {/* Details */}
              <Section title={t.editDetails}>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t.firstName}>
                    <input
                      className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                      value={form.first_name}
                      onChange={e => patch('first_name', e.target.value)}
                    />
                  </Field>
                  <Field label={t.lastName}>
                    <input
                      className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                      value={form.last_name}
                      onChange={e => patch('last_name', e.target.value)}
                    />
                  </Field>
                </div>
                <Field label={t.maidenNameLabel}>
                  <input
                    className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                    value={form.maiden_name}
                    onChange={e => patch('maiden_name', e.target.value)}
                  />
                </Field>
                <Field label={t.editNickname}>
                  <input
                    className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                    value={form.nickname}
                    onChange={e => patch('nickname', e.target.value)}
                  />
                </Field>
                <Field label={t.birthOrderLabel}>
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    placeholder="1, 2, 3…"
                    className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                    value={form.birth_order}
                    onChange={e => patch('birth_order', e.target.value)}
                  />
                  <span className="text-[10px] text-[#8E8E93] mt-1 block px-1">{t.birthOrderHint}</span>
                </Field>
                <Field label={t.gender}>
                  <div className="flex gap-2">
                    {(['male', 'female'] as const).map(g => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => patch('gender', form.gender === g ? '' : g)}
                        className={`flex-1 py-2 rounded-xl text-sf-subhead font-medium transition-colors ${
                          form.gender === g
                            ? g === 'male'
                              ? 'bg-[#007AFF] text-white shadow-sm'
                              : 'bg-[#FF2D55] text-white shadow-sm' // pink for female, matches AddMemberModal
                            : 'bg-[#F2F2F7] text-[#636366]'
                        }`}
                      >
                        {g === 'male' ? t.genderMale : t.genderFemale}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label={t.lineage}>
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
                          onClick={() => patch('lineage', opt.key)}
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
                </Field>
                <Field label={t.biography}>
                  <textarea
                    className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition resize-none min-h-[84px]"
                    rows={3}
                    placeholder={t.bioPlaceholder}
                    value={form.bio}
                    onChange={e => patch('bio', e.target.value)}
                  />
                </Field>

                {/* ── Contact + social links ── */}
                <div className="pt-1">
                  <p className="text-[11px] font-bold text-[#8E8E93] mb-1.5 uppercase tracking-wide">
                    {t.editContactSection}
                  </p>
                  <div className="space-y-2">
                    <Field label={t.editPhone}>
                      <input
                        type="tel"
                        inputMode="tel"
                        dir="ltr"
                        value={form.phone}
                        onChange={(e) => patch('phone', e.target.value)}
                        placeholder={t.editPhonePlaceholder}
                        className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                      />
                    </Field>
                    <Field label={t.editEmail}>
                      <input
                        type="email"
                        inputMode="email"
                        dir="ltr"
                        autoCapitalize="none"
                        autoCorrect="off"
                        value={form.email}
                        onChange={(e) => patch('email', e.target.value)}
                        placeholder={t.editEmailPlaceholder}
                        className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                      />
                    </Field>
                    <Field label={t.editFacebook}>
                      <input
                        type="text"
                        dir="ltr"
                        autoCapitalize="none"
                        value={form.facebook}
                        onChange={(e) => patch('facebook', e.target.value)}
                        placeholder={t.editSocialPlaceholder}
                        className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                      />
                    </Field>
                    <Field label={t.editInstagram}>
                      <input
                        type="text"
                        dir="ltr"
                        autoCapitalize="none"
                        value={form.instagram}
                        onChange={(e) => patch('instagram', e.target.value)}
                        placeholder={t.editSocialPlaceholder}
                        className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                      />
                    </Field>
                  </div>
                </div>

                {/* Connector-parent picker — only meaningful when both
                    parents are known. Renders the parent's gender icon
                    so the user can tell mother from father at a glance. */}
                {parents.length >= 2 && (
                  <Field label={t.editConnectorParent}>
                    <select
                      value={form.connector_parent_id}
                      onChange={(e) => patch('connector_parent_id', e.target.value)}
                      className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                    >
                      <option value="">{t.editConnectorParentAuto}</option>
                      {parents.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.gender === 'female' ? '♀' : p.gender === 'male' ? '♂' : '·'}{' '}
                          {p.first_name} {p.last_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                {/* Privacy / discreet hide */}
                <Field label={t.editPrivacyLabel}>
                  <button
                    type="button"
                    onClick={() => patch('hidden', !form.hidden)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[12.5px] font-semibold transition border ${
                      form.hidden
                        ? 'bg-[#1F2937] text-white border-transparent'
                        : 'bg-[#F2F2F7] text-[#636366] border-transparent hover:bg-[#E5E5EA]'
                    }`}
                    aria-pressed={form.hidden}
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{form.hidden ? '🙈' : '👁️'}</span>
                      {t.editHideFromTree}
                    </span>
                    <span
                      aria-hidden
                      className={`w-9 h-5 rounded-full relative transition ${
                        form.hidden ? 'bg-[#FF9F0A]' : 'bg-[#C7C7CC]'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                          form.hidden ? 'left-4.5 right-0.5' : 'left-0.5'
                        }`}
                        style={{ left: form.hidden ? 18 : 2 }}
                      />
                    </span>
                  </button>
                  <p className="text-[10.5px] text-[#8E8E93] mt-1.5 leading-snug">
                    {t.editHideFromTreeHint}
                  </p>
                </Field>
              </Section>

              {/* Dates */}
              <Section title={t.editDates}>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t.birthDate}>
                    <input
                      type="date"
                      className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                      value={form.birth_date}
                      onChange={e => patch('birth_date', e.target.value)}
                    />
                  </Field>
                  <Field label={t.deathDate}>
                    <input
                      type="date"
                      className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                      value={form.death_date}
                      onChange={e => patch('death_date', e.target.value)}
                    />
                  </Field>
                </div>
                <Field label={t.editHebrewBirth}>
                  <input
                    className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                    placeholder={t.editHebrewPlaceholder}
                    value={form.hebrew_birth_date}
                    onChange={e => patch('hebrew_birth_date', e.target.value)}
                  />
                </Field>
                {form.death_date && (
                  <Field label={t.editHebrewDeath}>
                    <input
                      className="w-full bg-[#F2F2F7] border border-transparent rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white focus:border-[#007AFF]/30 transition"
                      placeholder={t.editHebrewPlaceholder}
                      value={form.hebrew_death_date}
                      onChange={e => patch('hebrew_death_date', e.target.value)}
                    />
                  </Field>
                )}
              </Section>

              {/* Gallery */}
              <Section
                title={t.editGallery}
                action={
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={photoBusy}
                    className="text-[#007AFF] text-sf-footnote font-semibold flex items-center gap-1 disabled:opacity-50"
                  >
                    <span className="text-base leading-none">＋</span>
                    {photoBusy ? '…' : t.editAddPhoto}
                  </button>
                }
              >
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  // `capture="environment"` makes iOS Safari + Android
                  // Chrome offer the rear-camera option alongside
                  // "Choose from Library" — letting mobile users
                  // shoot a fresh photo for the gallery without
                  // detouring through the camera app first. Ignored
                  // on desktop browsers.
                  capture="environment"
                  className="hidden"
                  onChange={onGalleryAdd}
                />
                {form.photos.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="w-full rounded-2xl border-2 border-dashed border-[#C7C7CC] py-6 flex flex-col items-center gap-1 text-[#8E8E93] hover:bg-[#F2F2F7] transition"
                  >
                    <span className="text-2xl">📷</span>
                    <span className="text-sf-footnote font-medium">{t.editNoGallery}</span>
                  </button>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {form.photos.map((url, i) => (
                      <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-[#F2F2F7] group">
                        <img src={url} alt="" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => promoteToProfile(i)}
                            className="w-7 h-7 rounded-full bg-white/95 flex items-center justify-center text-sf-caption"
                            title={t.editSetProfilePhoto}
                          >
                            👤
                          </button>
                          <button
                            type="button"
                            onClick={() => removeGalleryPhoto(i)}
                            className="w-7 h-7 rounded-full bg-[#FF3B30] flex items-center justify-center"
                            title={t.editRemove}
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Save (mobile sticky fallback) */}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn-primary w-full mt-2 disabled:opacity-60"
              >
                {saving ? t.editSaving : suggestMode ? t.editSuggestSubmit : t.editSaveChanges}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function Section({
  title, action, children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h4 className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wide">{title}</h4>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-[#8E8E93] mb-1 block px-1">{label}</span>
      {children}
    </label>
  )
}
