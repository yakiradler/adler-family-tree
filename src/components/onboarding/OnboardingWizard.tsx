import { useState, useRef, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang } from '../../i18n/useT'
import { supabase } from '../../lib/supabase'
import type { UserRole, Lineage } from '../../types'

/**
 * Four-step onboarding wizard. Shown by App.tsx after the very first
 * login (i.e. when `profile.onboarded_at` is null). Persists answers via:
 *   - profiles.full_name / bio / avatar_url / requested_role / onboarded_at
 *   - access_requests row (with personal details in `answers` JSON, so the
 *     admin sees them when reviewing and can copy them onto the user's
 *     Member record on approval)
 *
 * Step layout:
 *   1 — Join (invite code or new tree)
 *   2 — Personal details   ← required: first/last name, email, birth date
 *   3 — Bio + avatar
 *   4 — Family role / access
 *   5 — Submitted (terminal)
 *
 * The wizard never grants permissions itself — admin approval in the
 * Phase D dashboard is what flips `profiles.role`.
 */
type Step = 1 | 2 | 3 | 4 | 5  // 5 = "submitted, waiting" terminal state

type JoinChoice = '' | 'invite' | 'new'

interface AnswerState {
  joinChoice: JoinChoice
  inviteCode: string
  // Personal details (step 2)
  firstName: string
  lastName: string
  email: string          // pre-filled from auth, read-only
  birthDate: string      // YYYY-MM-DD
  maidenName: string
  gender: '' | 'male' | 'female'
  phone: string
  lineage: '' | Lineage
  // Bio + avatar (step 3)
  bio: string
  avatar_url: string
  // Access (step 4)
  relationship: '' | 'self' | 'partner' | 'friend' | 'other'
  purpose: '' | 'browse' | 'contribute' | 'manage'
  requestedRole: '' | UserRole
}

const blank: AnswerState = {
  joinChoice: '',
  inviteCode: '',
  firstName: '',
  lastName: '',
  email: '',
  birthDate: '',
  maidenName: '',
  gender: '',
  phone: '',
  lineage: '',
  bio: '',
  avatar_url: '',
  relationship: '',
  purpose: '',
  requestedRole: '',
}

const TOTAL_STEPS = 4

export default function OnboardingWizard() {
  const { profile, completeOnboarding, submitAccessRequest } = useFamilyStore()
  const { t } = useLang()
  const [step, setStep] = useState<Step>(1)
  const [a, setA] = useState<AnswerState>(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Pre-fill name + email from existing auth state. Splitting full_name on
  // the first space is a sensible default — user can edit either field.
  // Email comes from the auth user record (read-only in the UI).
  useEffect(() => {
    if (!profile) return
    const fullName = profile.full_name ?? ''
    const [first, ...rest] = fullName.trim().split(/\s+/)
    setA((s) => ({
      ...s,
      firstName: s.firstName || first || '',
      lastName: s.lastName || rest.join(' '),
    }))
    void supabase.auth.getUser().then(({ data }) => {
      const e = data.user?.email
      if (e) setA((s) => ({ ...s, email: s.email || e }))
    })
  }, [profile])

  // Suggest a default role from the answers — user can override on step 4.
  const suggestedRole: UserRole = useMemo(() => {
    if (a.purpose === 'browse' || a.relationship === 'friend') return 'guest'
    if (a.purpose === 'manage') return 'master'
    return 'user'
  }, [a.purpose, a.relationship])

  const effectiveRole: UserRole = (a.requestedRole || suggestedRole) as UserRole

  const canAdvance = (() => {
    if (step === 1) return a.joinChoice !== '' &&
      (a.joinChoice === 'new' || a.inviteCode.trim().length > 0)
    if (step === 2) return (
      a.firstName.trim().length > 0 &&
      a.lastName.trim().length > 0 &&
      a.email.trim().length > 0 &&
      a.birthDate.trim().length > 0
    )
    if (step === 3) return true   // bio + avatar are optional
    if (step === 4) return a.relationship !== '' && a.purpose !== ''
    return false
  })()

  const next = async () => {
    setError(null)
    if (step === 1 && a.joinChoice === 'invite') {
      // Validate invite code against tree_invites (any active row matches).
      setBusy(true)
      try {
        const { data } = await supabase
          .from('tree_invites')
          .select('id, expires_at, uses_left')
          .eq('code', a.inviteCode.trim())
          .maybeSingle()
        const valid =
          !!data &&
          (data.expires_at == null || new Date(data.expires_at) > new Date()) &&
          (data.uses_left == null || data.uses_left > 0)
        if (!valid) {
          if (data === null) {
            setError(t.onbInviteInvalid)
            return
          }
        }
      } finally {
        setBusy(false)
      }
    }
    if (step === 4) return submit()
    setStep((s) => Math.min(TOTAL_STEPS, (s + 1)) as Step)
  }

  const back = () => setStep((s) => Math.max(1, (s - 1)) as Step)

  const submit = async () => {
    if (!profile) return
    setBusy(true)
    try {
      const fullName = `${a.firstName.trim()} ${a.lastName.trim()}`.trim()
      // 1. Persist profile-level fields + mark onboarding complete.
      await completeOnboarding({
        full_name: fullName || profile.full_name,
        bio: a.bio.trim() || undefined,
        avatar_url: a.avatar_url || undefined,
        requested_role: effectiveRole,
      })
      // 2. File the access request for admin review. Personal details are
      //    parked in `answers.personal` so the reviewing admin can copy
      //    them onto the matching Member record when approving.
      await submitAccessRequest({
        requested_role: effectiveRole,
        invite_code: a.joinChoice === 'invite' ? a.inviteCode.trim() : null,
        answers: {
          joinChoice: a.joinChoice,
          relationship: a.relationship,
          purpose: a.purpose,
          personal: {
            first_name: a.firstName.trim(),
            last_name: a.lastName.trim(),
            email: a.email.trim(),
            birth_date: a.birthDate,
            maiden_name: a.maidenName.trim() || null,
            gender: a.gender || null,
            phone: a.phone.trim() || null,
            lineage: a.lineage || null,
          },
        },
      })
      setStep(5)
    } finally {
      setBusy(false)
    }
  }

  const onPickFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) =>
      setA((s) => ({ ...s, avatar_url: e.target?.result as string }))
    reader.readAsDataURL(file)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="w-full max-w-md bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/60 overflow-hidden"
      >
        {/* Progress strip */}
        {step <= TOTAL_STEPS && (
          <div className="px-6 pt-5">
            <div className="flex items-center gap-1.5">
              {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
                <div
                  key={s}
                  className={`flex-1 h-1.5 rounded-full transition-all ${
                    s <= step ? 'bg-[var(--accent,#007AFF)]' : 'bg-[#E5E5EA]'
                  }`}
                />
              ))}
            </div>
            <p className="text-[11px] text-[#8E8E93] mt-2">
              {t.onbStep} {step} {t.onbOf} {TOTAL_STEPS}
            </p>
          </div>
        )}

        <div className="p-6 pt-4">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <StepShell
                key="s1"
                title={t.onbStep1Title}
                desc={t.onbStep1Desc}
              >
                <ChoiceCard
                  selected={a.joinChoice === 'invite'}
                  onClick={() => setA((s) => ({ ...s, joinChoice: 'invite' }))}
                  title={t.onbJoinExisting}
                  desc={t.onbJoinExistingHint}
                  icon="🔑"
                />
                {a.joinChoice === 'invite' && (
                  <div className="-mt-1">
                    <label className="text-[11px] text-[#8E8E93] block mb-1">
                      {t.onbInviteCodeLabel}
                    </label>
                    <input
                      autoFocus
                      type="text"
                      value={a.inviteCode}
                      onChange={(e) =>
                        setA((s) => ({ ...s, inviteCode: e.target.value }))
                      }
                      placeholder={t.onbInviteCodePlaceholder}
                      className="w-full px-4 py-2.5 rounded-2xl bg-[#F2F2F7] text-sf-body text-[#1C1C1E] placeholder-[#8E8E93] outline-none focus:ring-2 focus:ring-[var(--accent,#007AFF)] uppercase tracking-wider"
                    />
                    {error && (
                      <p className="text-[11px] text-[#FF3B30] mt-1.5">{error}</p>
                    )}
                  </div>
                )}
                <ChoiceCard
                  selected={a.joinChoice === 'new'}
                  onClick={() => setA((s) => ({ ...s, joinChoice: 'new' }))}
                  title={t.onbCreateNew}
                  desc={t.onbCreateNewHint}
                  icon="🌱"
                />
              </StepShell>
            )}

            {step === 2 && (
              <StepShell
                key="s2"
                title={t.onbStepPersonalTitle}
                desc={t.onbStepPersonalDesc}
              >
                {/* Required block */}
                <div className="grid grid-cols-2 gap-2">
                  <Field
                    label={t.onbFirstName}
                    required
                    requiredHint={t.onbRequiredHint}
                  >
                    <input
                      type="text"
                      autoFocus
                      value={a.firstName}
                      onChange={(e) => setA((s) => ({ ...s, firstName: e.target.value }))}
                      className="onb-input"
                    />
                  </Field>
                  <Field
                    label={t.onbLastName}
                    required
                    requiredHint={t.onbRequiredHint}
                  >
                    <input
                      type="text"
                      value={a.lastName}
                      onChange={(e) => setA((s) => ({ ...s, lastName: e.target.value }))}
                      className="onb-input"
                    />
                  </Field>
                </div>
                <Field
                  label={t.onbEmailLabel}
                  required
                  requiredHint={t.onbRequiredHint}
                >
                  <input
                    type="email"
                    value={a.email}
                    onChange={(e) => setA((s) => ({ ...s, email: e.target.value }))}
                    readOnly={!!a.email}
                    className="onb-input read-only:bg-[#F9F9FB] read-only:text-[#636366]"
                  />
                </Field>
                <Field
                  label={t.onbBirthDate}
                  required
                  requiredHint={t.onbRequiredHint}
                >
                  <input
                    type="date"
                    value={a.birthDate}
                    onChange={(e) => setA((s) => ({ ...s, birthDate: e.target.value }))}
                    className="onb-input"
                  />
                </Field>

                {/* Optional block */}
                <div className="pt-2 border-t border-black/5 space-y-2.5">
                  <Field
                    label={t.onbMaidenNameField}
                    hint={t.onbMaidenNameHint}
                    requiredHint={t.onbOptionalHint}
                  >
                    <input
                      type="text"
                      value={a.maidenName}
                      onChange={(e) => setA((s) => ({ ...s, maidenName: e.target.value }))}
                      className="onb-input"
                    />
                  </Field>
                  <Field label={t.onbGenderLabel} requiredHint={t.onbOptionalHint}>
                    <div className="grid grid-cols-2 gap-1.5">
                      {([
                        ['male', t.onbGenderMale],
                        ['female', t.onbGenderFemale],
                      ] as const).map(([key, lbl]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setA((s) => ({ ...s, gender: key }))}
                          className={`py-2 rounded-xl text-[12px] font-semibold transition ${
                            a.gender === key
                              ? 'bg-[var(--accent,#007AFF)] text-white'
                              : 'bg-[#F2F2F7] text-[#636366] hover:bg-[#E5E5EA]'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label={t.onbPhone} requiredHint={t.onbOptionalHint}>
                    <input
                      type="tel"
                      value={a.phone}
                      onChange={(e) => setA((s) => ({ ...s, phone: e.target.value }))}
                      className="onb-input"
                      dir="ltr"
                    />
                  </Field>
                  <Field
                    label={t.onbLineageOnbLabel}
                    hint={t.onbLineageOnbHint}
                    requiredHint={t.onbOptionalHint}
                  >
                    <div className="grid grid-cols-4 gap-1.5">
                      {([
                        ['', t.onbLineageOnbNone],
                        ['kohen', t.onbLineageOnbKohen],
                        ['levi', t.onbLineageOnbLevi],
                        ['israel', t.onbLineageOnbIsrael],
                      ] as const).map(([key, lbl]) => (
                        <button
                          key={key || 'none'}
                          type="button"
                          onClick={() => setA((s) => ({ ...s, lineage: key }))}
                          className={`py-2 rounded-xl text-[11px] font-semibold transition ${
                            a.lineage === key
                              ? 'bg-[var(--accent,#007AFF)] text-white'
                              : 'bg-[#F2F2F7] text-[#636366] hover:bg-[#E5E5EA]'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
              </StepShell>
            )}

            {step === 3 && (
              <StepShell
                key="s3"
                title={t.onbStep2Title}
                desc={t.onbStep2Desc}
              >
                <div>
                  <label className="text-[11px] text-[#8E8E93] block mb-1">
                    {t.onbBio}
                  </label>
                  <textarea
                    value={a.bio}
                    onChange={(e) => setA((s) => ({ ...s, bio: e.target.value }))}
                    placeholder={t.onbBioPlaceholder}
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-2xl bg-[#F2F2F7] text-sf-body text-[#1C1C1E] placeholder-[#8E8E93] outline-none focus:ring-2 focus:ring-[var(--accent,#007AFF)] resize-none"
                  />
                </div>
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) onPickFile(f)
                    }}
                  />
                  <div className="flex items-center gap-3">
                    {a.avatar_url ? (
                      <img
                        src={a.avatar_url}
                        alt=""
                        className="w-14 h-14 rounded-full object-cover border-2 border-white shadow"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-[#F2F2F7] flex items-center justify-center text-2xl">
                        👤
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="flex-1 py-2.5 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold active:scale-[0.98] transition"
                    >
                      {a.avatar_url ? t.onbAvatarChange : t.onbAvatarUpload}
                    </button>
                  </div>
                </div>
              </StepShell>
            )}

            {step === 4 && (
              <StepShell
                key="s4"
                title={t.onbStep3Title}
                desc={t.onbStep3Desc}
              >
                <QuestionGroup
                  label={t.onbQ_relationship}
                  options={[
                    ['self', t.onbQ_relationship_self],
                    ['partner', t.onbQ_relationship_partner],
                    ['friend', t.onbQ_relationship_friend],
                    ['other', t.onbQ_relationship_other],
                  ]}
                  value={a.relationship}
                  onChange={(v) => setA((s) => ({ ...s, relationship: v as AnswerState['relationship'] }))}
                />
                <QuestionGroup
                  label={t.onbQ_purpose}
                  options={[
                    ['browse', t.onbQ_purpose_browse],
                    ['contribute', t.onbQ_purpose_contribute],
                    ['manage', t.onbQ_purpose_manage],
                  ]}
                  value={a.purpose}
                  onChange={(v) => setA((s) => ({ ...s, purpose: v as AnswerState['purpose'] }))}
                />
                <RoleSelector
                  current={effectiveRole}
                  onChange={(r) => setA((s) => ({ ...s, requestedRole: r }))}
                  t={t}
                />
              </StepShell>
            )}

            {step === 5 && (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-8"
              >
                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-4 text-3xl">
                  ✓
                </div>
                <h2 className="text-sf-title2 font-bold text-[#1C1C1E]">{t.onbSubmitted}</h2>
                <p className="text-sf-subhead text-[#636366] mt-2">{t.onbSubmittedDesc}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        {step <= TOTAL_STEPS && (
          <div className="px-6 pb-5 pt-1 flex gap-2 border-t border-black/5">
            {step > 1 && (
              <button
                onClick={back}
                disabled={busy}
                className="flex items-center justify-center gap-1.5 flex-1 py-3 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold disabled:opacity-50 active:scale-[0.98] transition"
              >
                <BackArrow />
                {t.onbBack}
              </button>
            )}
            <button
              onClick={next}
              disabled={!canAdvance || busy}
              className="flex-[2] py-3 rounded-2xl bg-[var(--accent,#007AFF)] text-white text-sf-subhead font-semibold disabled:opacity-50 active:scale-[0.98] transition"
            >
              {busy ? '…' : step === TOTAL_STEPS ? t.onbFinish : t.onbNext}
            </button>
          </div>
        )}
      </motion.div>

      {/* Tiny stylesheet for the recurring text-input look — keeps the JSX
          above readable without dragging Tailwind's @apply into a global. */}
      <style>{`
        .onb-input {
          width: 100%;
          padding: 0.625rem 1rem;
          border-radius: 1rem;
          background: #F2F2F7;
          color: #1C1C1E;
          outline: none;
          transition: box-shadow 0.15s ease;
        }
        .onb-input::placeholder { color: #8E8E93; }
        .onb-input:focus {
          box-shadow: 0 0 0 2px var(--accent, #007AFF);
        }
      `}</style>
    </div>
  )
}

function BackArrow() {
  // Direction-agnostic chevron — flips automatically in RTL via [dir]
  // selector inheritance from the document.
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden
      style={{ transform: 'scaleX(var(--rtl-flip, 1))' }}>
      <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Field({
  label, hint, required, requiredHint, children,
}: {
  label: string
  hint?: string
  required?: boolean
  requiredHint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-[11px] font-semibold text-[#1C1C1E]">
          {label}
          {required && <span className="text-[#FF3B30] ms-1">*</span>}
        </label>
        {requiredHint && (
          <span className={`text-[10px] ${required ? 'text-[#FF3B30]' : 'text-[#8E8E93]'}`}>
            {requiredHint}
          </span>
        )}
      </div>
      {children}
      {hint && <p className="text-[10px] text-[#8E8E93] mt-1">{hint}</p>}
    </div>
  )
}

function StepShell({
  title, desc, children,
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.18 }}
      className="space-y-3"
    >
      <h2 className="text-sf-title2 font-bold text-[#1C1C1E]">{title}</h2>
      <p className="text-sf-footnote text-[#636366]">{desc}</p>
      <div className="space-y-3 pt-2">{children}</div>
    </motion.div>
  )
}

function ChoiceCard({
  selected, onClick, title, desc, icon,
}: {
  selected: boolean
  onClick: () => void
  title: string
  desc: string
  icon: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full p-4 rounded-2xl border-2 transition-all text-start flex items-start gap-3 ${
        selected
          ? 'border-[var(--accent,#007AFF)] bg-[var(--accent-soft,rgba(0,122,255,0.08))]'
          : 'border-transparent bg-[#F9F9FB] hover:bg-[#F2F2F7]'
      }`}
    >
      <span className="text-2xl flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sf-subhead font-semibold text-[#1C1C1E]">{title}</p>
        <p className="text-[11px] text-[#636366] mt-0.5">{desc}</p>
      </div>
      {selected && (
        <div className="w-5 h-5 rounded-full bg-[var(--accent,#007AFF)] text-white flex items-center justify-center text-[10px] flex-shrink-0">
          ✓
        </div>
      )}
    </button>
  )
}

function QuestionGroup({
  label, options, value, onChange,
}: {
  label: string
  options: Array<readonly [string, string]>
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-[11px] text-[#8E8E93] block mb-1.5">{label}</label>
      <div className="grid grid-cols-2 gap-1.5">
        {options.map(([key, lbl]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`py-2 px-2 rounded-xl text-[12px] font-semibold transition-all ${
              value === key
                ? 'bg-[var(--accent,#007AFF)] text-white'
                : 'bg-[#F2F2F7] text-[#636366] hover:bg-[#E5E5EA]'
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  )
}

function RoleSelector({
  current, onChange, t,
}: {
  current: UserRole
  onChange: (r: UserRole) => void
  t: {
    onbRoleGuest: string; onbRoleGuestDesc: string
    onbRoleUser: string;  onbRoleUserDesc: string
    onbRoleMaster: string; onbRoleMasterDesc: string
  }
}) {
  return (
    <div className="space-y-1.5">
      {([
        ['guest', t.onbRoleGuest, t.onbRoleGuestDesc],
        ['user', t.onbRoleUser, t.onbRoleUserDesc],
        ['master', t.onbRoleMaster, t.onbRoleMasterDesc],
      ] as const).map(([role, lbl, desc]) => {
        const active = current === role
        return (
          <button
            key={role}
            type="button"
            onClick={() => onChange(role as UserRole)}
            className={`w-full p-3 rounded-xl border text-start transition-all ${
              active
                ? 'border-[var(--accent,#007AFF)] bg-[var(--accent-soft,rgba(0,122,255,0.08))]'
                : 'border-black/5 bg-white hover:bg-[#F9F9FB]'
            }`}
          >
            <p className="text-[13px] font-semibold text-[#1C1C1E]">{lbl}</p>
            <p className="text-[11px] text-[#636366] mt-0.5">{desc}</p>
          </button>
        )
      })}
    </div>
  )
}
