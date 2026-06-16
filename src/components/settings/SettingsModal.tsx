import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLang, isRTL } from '../../i18n/useT'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useCloseOnBack } from '../../hooks/useCloseOnBack'
import { supabase, isSupabaseConfigured } from '../../lib/supabase'
import { THEMES, getTheme, setTheme, type ThemeId } from '../../lib/theme'
import { uploadMemberPhoto } from '../../lib/photoUpload'
import SecuritySettingsModal from '../security/SecuritySettingsModal'
import EditMemberModal from '../EditMemberModal'

/**
 * Per-user "Settings" hub (owner request). One place for the basics:
 * app language, color theme, display name, password, and two-factor
 * auth (which moved here from the standalone header shield). Built as a
 * centered modal to match the app's other sheets; opened from the gear
 * button in the Dashboard header.
 */
export default function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang, toggleLang } = useLang()
  const rtl = isRTL(lang)
  const { profile, setProfile, updateProfileById, members, activeTreeId } = useFamilyStore()

  const [theme, setThemeState] = useState<ThemeId>(getTheme())
  const [name, setName] = useState(profile?.full_name ?? '')
  const [nameSaved, setNameSaved] = useState(false)
  const [curPwd, setCurPwd] = useState('')
  const [pwd, setPwd] = useState('')
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [editMyCardOpen, setEditMyCardOpen] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  // The member row that represents this user (their "own card"), if linked.
  const myMember = profile?.linked_member_id
    ? members.find((m) => m.id === profile.linked_member_id) ?? null
    : null

  useCloseOnBack(open, onClose)

  const pickTheme = (id: ThemeId) => { setThemeState(id); setTheme(id) }

  const pickAvatar = async (file: File | null) => {
    if (!file || !profile) return
    setAvatarBusy(true)
    try {
      const url = await uploadMemberPhoto(file, activeTreeId)
      await updateProfileById(profile.id, { avatar_url: url })
      setProfile({ ...profile, avatar_url: url })
    } finally {
      setAvatarBusy(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  const saveName = async () => {
    const next = name.trim()
    if (!profile || !next || next === profile.full_name) return
    setBusy(true)
    try {
      await updateProfileById(profile.id, { full_name: next })
      setProfile({ ...profile, full_name: next })
      setNameSaved(true)
      window.setTimeout(() => setNameSaved(false), 2000)
    } finally {
      setBusy(false)
    }
  }

  const changePassword = async () => {
    setPwdMsg(null)
    if (!curPwd.trim()) { setPwdMsg({ ok: false, text: t.settingsCurrentPasswordNeeded }); return }
    if (pwd.trim().length < 6) { setPwdMsg({ ok: false, text: t.settingsPasswordTooShort }); return }
    if (!isSupabaseConfigured) { setPwdMsg({ ok: false, text: t.securityDemoNote }); return }
    setBusy(true)
    try {
      // Verify the CURRENT password by re-authenticating before changing it
      // (Supabase's updateUser doesn't check the old password on its own).
      const { data: u } = await supabase.auth.getUser()
      const email = u.user?.email
      if (!email) { setPwdMsg({ ok: false, text: t.settingsPasswordError }); return }
      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: curPwd.trim() })
      if (signErr) { setPwdMsg({ ok: false, text: t.settingsCurrentPasswordWrong }); return }
      const { error } = await supabase.auth.updateUser({ password: pwd.trim() })
      if (error) { setPwdMsg({ ok: false, text: t.settingsPasswordError }); return }
      setCurPwd(''); setPwd('')
      setPwdMsg({ ok: true, text: t.settingsPasswordChanged })
    } catch {
      setPwdMsg({ ok: false, text: t.settingsPasswordError })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          dir={rtl ? 'rtl' : 'ltr'}
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-glass-lg max-h-[90vh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-white/95 backdrop-blur px-5 py-3 border-b border-black/5 flex items-center justify-between z-10">
              <h2 className="text-sf-headline font-bold text-[#1C1C1E] flex items-center gap-2">
                <span aria-hidden>⚙️</span> {t.settingsTitle}
              </h2>
              <button type="button" onClick={onClose} aria-label={t.faqClose}
                className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#636366] active:scale-95 transition">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="#636366" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            </div>

            <div className="p-4 space-y-5">
              {/* My profile — avatar (profile picture) + edit personal details. */}
              <section>
                <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wide mb-2">{t.settingsMyProfile}</p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarBusy}
                    aria-label={t.settingsChangePhoto}
                    className="relative w-16 h-16 rounded-full overflow-hidden bg-gradient-to-br from-[#007AFF] to-[#5AC8FA] text-white flex items-center justify-center text-xl font-bold flex-shrink-0 active:scale-95 transition"
                  >
                    {profile?.avatar_url
                      ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <span>{(profile?.full_name ?? '·').trim().charAt(0)}</span>}
                    <span className="absolute bottom-0 inset-x-0 bg-black/45 text-[8px] py-0.5 leading-none">{avatarBusy ? '…' : '📷'}</span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#1C1C1E] truncate">{profile?.full_name}</p>
                    <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarBusy}
                      className="text-[12px] text-[#007AFF] font-semibold">{t.settingsChangePhoto}</button>
                    {myMember && (
                      <button type="button" onClick={() => setEditMyCardOpen(true)}
                        className="block text-[12px] text-[#007AFF] font-semibold mt-0.5">{t.settingsEditMyDetails}</button>
                    )}
                  </div>
                </div>
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => void pickAvatar(e.target.files?.[0] ?? null)} />
              </section>

              {/* Language */}
              <section>
                <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wide mb-2">{t.settingsLanguage}</p>
                <div className="bg-[#F2F2F7] rounded-2xl p-1 flex gap-1">
                  {(['he', 'en'] as const).map((lng) => (
                    <button key={lng} type="button"
                      onClick={() => { if (lang !== lng) toggleLang() }}
                      className={`flex-1 py-2 rounded-xl text-[13px] font-semibold transition ${lang === lng ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#636366]'}`}>
                      {lng === 'he' ? 'עברית' : 'English'}
                    </button>
                  ))}
                </div>
              </section>

              {/* Color theme */}
              <section>
                <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wide mb-2">{t.settingsTheme}</p>
                <div className="grid grid-cols-2 gap-2">
                  {THEMES.map((th) => {
                    const active = theme === th.id
                    const swatch = th.id === 'dark'
                      ? 'bg-gradient-to-br from-[#1C1C1E] to-[#3A3A3C]'
                      : 'bg-gradient-to-br from-[#FFFFFF] to-[#E5E5EA] border border-[#E5E5EA]'
                    return (
                      <button key={th.id} type="button" onClick={() => pickTheme(th.id)}
                        className={`flex items-center gap-2 rounded-2xl border p-2.5 transition ${active ? 'border-[#007AFF] bg-[#007AFF]/5' : 'border-[#E5E5EA] bg-white'}`}>
                        <span className={`w-7 h-7 rounded-full ${swatch} shadow-sm flex items-center justify-center text-[13px]`} aria-hidden>{th.icon}</span>
                        <span className="text-[13px] font-semibold text-[#1C1C1E]">{t[th.labelKey]}</span>
                        {active && <span className="ms-auto text-[#007AFF] text-sm">✓</span>}
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* Display name */}
              <section>
                <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wide mb-2">{t.settingsDisplayName}</p>
                <div className="flex gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="flex-1 bg-[#F2F2F7] rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                  />
                  <button type="button" onClick={saveName} disabled={busy || !name.trim() || name.trim() === profile?.full_name}
                    className="px-4 rounded-xl bg-[#007AFF] text-white text-[13px] font-bold disabled:opacity-40">
                    {nameSaved ? '✓' : t.settingsSave}
                  </button>
                </div>
              </section>

              {/* Password */}
              {isSupabaseConfigured && (
                <section>
                  <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wide mb-2">{t.settingsPassword}</p>
                  <div className="space-y-2">
                    <input
                      type="password"
                      value={curPwd}
                      onChange={(e) => setCurPwd(e.target.value)}
                      placeholder={t.settingsCurrentPassword}
                      autoComplete="current-password"
                      className="w-full bg-[#F2F2F7] rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                    />
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={pwd}
                        onChange={(e) => setPwd(e.target.value)}
                        placeholder={t.settingsNewPassword}
                        autoComplete="new-password"
                        className="flex-1 bg-[#F2F2F7] rounded-xl px-3 py-2 text-sf-subhead text-[#1C1C1E] outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                      />
                      <button type="button" onClick={changePassword} disabled={busy || !curPwd.trim() || pwd.trim().length < 6}
                        className="px-4 rounded-xl bg-[#007AFF] text-white text-[13px] font-bold disabled:opacity-40">
                        {t.settingsChangePassword}
                      </button>
                    </div>
                  </div>
                  {pwdMsg && (
                    <p className={`text-[12px] mt-1.5 ${pwdMsg.ok ? 'text-[#1F7A3A]' : 'text-[#FF3B30]'}`}>{pwdMsg.text}</p>
                  )}
                </section>
              )}

              {/* Two-factor auth (moved here from the header shield) */}
              {isSupabaseConfigured && (
                <section>
                  <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wide mb-2">{t.settings2FA}</p>
                  <button type="button" onClick={() => setSecurityOpen(true)}
                    className="w-full flex items-center gap-3 rounded-2xl bg-[#F2F2F7] p-3 text-start hover:bg-[#EAEAEF] transition">
                    <span className="w-9 h-9 rounded-xl bg-[#34C759]/12 flex items-center justify-center flex-shrink-0">
                      <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
                        <path d="M7.5 1.5l5 2v3.6c0 3-2.1 5.6-5 6.4-2.9-.8-5-3.4-5-6.4V3.5l5-2z" stroke="#34C759" strokeWidth="1.4" strokeLinejoin="round" />
                        <path d="M5.3 7.5l1.5 1.5 2.9-3" stroke="#34C759" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-semibold text-[#1C1C1E]">{t.securityTitle}</span>
                      <span className="block text-[11px] text-[#8E8E93] leading-snug">{t.settings2FAHint}</span>
                    </span>
                    <span className="text-[#C7C7CC]">{rtl ? '‹' : '›'}</span>
                  </button>
                </section>
              )}
            </div>
          </motion.div>

          <SecuritySettingsModal open={securityOpen} onClose={() => setSecurityOpen(false)} />
          {myMember && (
            <EditMemberModal open={editMyCardOpen} onClose={() => setEditMyCardOpen(false)} member={myMember} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
