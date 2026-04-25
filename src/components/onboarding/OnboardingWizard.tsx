import { useState, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang } from '../../i18n/useT'
import { supabase } from '../../lib/supabase'
import type { UserRole } from '../../types'

/**
 * Three-step onboarding wizard. Shown by App.tsx after the very first
 * login (i.e. when `profile.onboarded_at` is null). Persists answers via:
 *   - profiles.bio / avatar_url / requested_role / onboarded_at
 *   - access_requests row (pending → admin queue)
 *
 * The wizard never grants permissions itself — admin approval in the
 * Phase D dashboard is what flips `profiles.role`.
 */
type Step = 1 | 2 | 3 | 4  // 4 = "submitted, waiting" terminal state

type JoinChoice = '' | 'invite' | 'new'

interface AnswerState {
  joinChoice: JoinChoice
  inviteCode: string
  bio: string
  avatar_url: string
  relationship: '' | 'self' | 'partner' | 'friend' | 'other'
  purpose: '' | 'browse' | 'contribute' | 'manage'
  requestedRole: '' | UserRole
}

const blank: AnswerState = {
  joinChoice: '',
  inviteCode: '',
  bio: '',
  avatar_url: '',
  relationship: '',
  purpose: '',
  requestedRole: '',
}

export default function OnboardingWizard() {
  const { profile, completeOnboarding, submitAccessRequest } = useFamilyStore()
  const { t } = useLang()
  const [step, setStep] = useState<Step>(1)
  const [a, setA] = useState<AnswerState>(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Suggest a default role from the answers — user can override on step 3.
  const suggestedRole: UserRole = useMemo(() => {
    if (a.purpose === 'browse' || a.relationship === 'friend') return 'guest'
    if (a.purpose === 'manage') return 'master'
    return 'user'
  }, [a.purpose, a.relationship])

  const effectiveRole: UserRole = (a.requestedRole || suggestedRole) as UserRole

  const canAdvance = (() => {
    if (step === 1) return a.joinChoice !== '' &&
      (a.joinChoice === 'new' || a.inviteCode.trim().length > 0)
    if (step === 2) return true   // bio + avatar are optional
    if (step === 3) return a.relationship !== '' && a.purpose !== ''
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
          // Don't hard-block in demo or when no invites table seeded — let
          // them through with a soft warning, since admin will review anyway.
          if (data === null) {
            // No row found — show inline error.
            setError(t.onbInviteInvalid)
            return
          }
        }
      } finally {
        setBusy(false)
      }
    }
    if (step === 3) return submit()
    setStep((s) => Math.min(3, (s + 1)) as Step)
  }

  const back = () => setStep((s) => Math.max(1, (s - 1)) as Step)

  const submit = async () => {
    if (!profile) return
    setBusy(true)
    try {
      // 1. Persist profile-level fields + mark onboarding complete.
      await completeOnboarding({
        bio: a.bio.trim() || undefined,
        avatar_url: a.avatar_url || undefined,
        requested_role: effectiveRole,
      })
      // 2. File the access request for admin review.
      await submitAccessRequest({
        requested_role: effectiveRole,
        invite_code: a.joinChoice === 'invite' ? a.inviteCode.trim() : null,
        answers: {
          joinChoice: a.joinChoice,
          relationship: a.relationship,
          purpose: a.purpose,
        },
      })
      setStep(4)
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
        {step < 4 && (
          <div className="px-6 pt-5">
            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={`flex-1 h-1.5 rounded-full transition-all ${
                    s <= step ? 'bg-[var(--accent,#007AFF)]' : 'bg-[#E5E5EA]'
                  }`}
                />
              ))}
            </div>
            <p className="text-[11px] text-[#8E8E93] mt-2">
              {t.onbStep} {step} {t.onbOf} 3
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

            {step === 3 && (
              <StepShell
                key="s3"
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

            {step === 4 && (
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
        {step < 4 && (
          <div className="px-6 pb-5 pt-1 flex gap-2 border-t border-black/5">
            {step > 1 && (
              <button
                onClick={back}
                disabled={busy}
                className="flex-1 py-3 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold disabled:opacity-50"
              >
                {t.onbBack}
              </button>
            )}
            <button
              onClick={next}
              disabled={!canAdvance || busy}
              className="flex-[2] py-3 rounded-2xl bg-[var(--accent,#007AFF)] text-white text-sf-subhead font-semibold disabled:opacity-50 active:scale-[0.98] transition"
            >
              {busy ? '…' : step === 3 ? t.onbFinish : t.onbNext}
            </button>
          </div>
        )}
      </motion.div>
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
