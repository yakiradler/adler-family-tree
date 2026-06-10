import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL, type Translations } from '../i18n/useT'
import { PLANS, effectivePlan, trialDaysLeft } from '../lib/plans'
import type { PlanId } from '../types'

/**
 * Pricing / plans page — the public face of the Phase A funnel.
 * Reachable without auth (so the landing can link here); the CTAs
 * route visitors to signup, free users into the self-service 14-day
 * family trial, and paid upgrades into a request the admin fulfils
 * manually (no payment processing yet — owner decision).
 */
interface TierView {
  id: PlanId
  name: string
  features: string[]
  highlight?: boolean
}

export default function PricingPage({ isAuth }: { isAuth: boolean }) {
  const navigate = useNavigate()
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const { myPlan, fetchMyPlan, startFamilyTrial, profile, addFeedback } = useFamilyStore()
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isAuth) fetchMyPlan()
  }, [isAuth, fetchMyPlan])

  const current = effectivePlan(myPlan).id
  const daysLeft = trialDaysLeft(myPlan)

  const tiers: TierView[] = [
    {
      id: 'free',
      name: t.planFree,
      features: [t.pricingFeatTrees1, t.pricingFeatMembers30, t.pricingFeatLeavesGift],
    },
    {
      id: 'family',
      name: t.planFamily,
      features: [t.pricingFeatTreesUnlimited, t.pricingFeatMembers250, t.pricingFeatLeaves100],
      highlight: true,
    },
    {
      id: 'premium',
      name: t.planPremium,
      features: [t.pricingFeatTreesUnlimited, t.pricingFeatMembersUnlimited, t.pricingFeatLeaves300, t.pricingFeatPriority],
    },
  ]

  const handleCta = async (tier: PlanId) => {
    if (!isAuth) {
      navigate('/login?signup=1')
      return
    }
    if (busy || tier === 'free' || tier === current) return
    setBusy(true)
    try {
      // Free → family: self-service trial, once per account.
      if (tier === 'family' && current === 'free' && !myPlan?.trial_ends_at) {
        const ok = await startFamilyTrial()
        setNotice(ok ? t.pricingTrialStarted : t.pricingUpgradeSent)
        if (ok) return
      }
      // Paid upgrade (or trial already used): lands in the admin's
      // reports tab — he applies the plan manually in Phase A.
      await addFeedback({
        author_id: profile?.id ?? 'anonymous',
        author_name: profile?.full_name ?? 'אנונימי',
        category: 'question',
        body: `בקשת שדרוג למסלול ${tier === 'family' ? t.planFamily : t.planPremium}`,
        context: '#/pricing',
      })
      setNotice(t.pricingUpgradeSent)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="min-h-screen bg-mesh-gradient pb-16">
      <div className="max-w-3xl mx-auto px-4 pt-6">
        <button
          type="button"
          onClick={() => navigate(isAuth ? '/home' : '/')}
          className="glass px-3 py-1.5 rounded-xl text-sf-caption font-semibold text-[#636366] hover:text-[#1C1C1E] transition mb-6"
        >
          {rtl ? '→ ' : '← '}{t.pricingBack}
        </button>

        <div className="text-center mb-8">
          <h1 className="text-sf-title1 text-[#1C1C1E]" style={{ fontSize: 30 }}>{t.pricingTitle}</h1>
          <p className="text-sf-subhead text-[#636366] mt-1">{t.pricingSubtitle}</p>
          {daysLeft != null && (
            <p className="mt-2 inline-block px-3 py-1 rounded-full bg-[#34C759]/12 text-[#34C759] text-[12px] font-bold">
              {t.planTrialDaysLeft.replace('{days}', String(daysLeft))}
            </p>
          )}
        </div>

        {notice && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 text-center text-sf-subhead font-semibold text-[#34C759] bg-[#34C759]/10 rounded-2xl px-4 py-3"
          >
            {notice}
          </motion.p>
        )}

        <div className="grid sm:grid-cols-3 gap-4 items-stretch">
          {tiers.map((tier, i) => (
            <TierCard
              key={tier.id}
              tier={tier}
              t={t}
              index={i}
              price={PLANS[tier.id].priceMonthlyILS}
              isCurrent={isAuth && current === tier.id}
              busy={busy}
              ctaLabel={ctaLabel(tier.id, current, isAuth, !!myPlan?.trial_ends_at, t)}
              onCta={() => handleCta(tier.id)}
            />
          ))}
        </div>

        <p className="text-center text-[11.5px] text-[#8E8E93] mt-6 leading-relaxed">
          {t.pricingFootnote}
        </p>
      </div>
    </div>
  )
}

function ctaLabel(
  tier: PlanId,
  current: PlanId,
  isAuth: boolean,
  trialUsed: boolean,
  t: Translations,
): string | null {
  if (!isAuth) return tier === 'free' ? t.pricingStartFree : t.pricingStartTrial
  if (tier === current) return null // badge instead
  if (tier === 'free') return null
  if (tier === 'family' && current === 'free' && !trialUsed) return t.pricingStartTrial
  return t.pricingRequestUpgrade
}

function TierCard({
  tier, t, index, price, isCurrent, busy, ctaLabel, onCta,
}: {
  tier: TierView
  t: Translations
  index: number
  price: number
  isCurrent: boolean
  busy: boolean
  ctaLabel: string | null
  onCta: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`relative flex flex-col rounded-3xl p-5 shadow-glass ${
        tier.highlight
          ? 'bg-gradient-to-b from-[#007AFF]/8 to-white border-2 border-[#007AFF]/30'
          : 'glass-strong'
      }`}
    >
      {tier.highlight && (
        <span className="absolute -top-3 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-3 py-0.5 rounded-full bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-[10.5px] font-bold whitespace-nowrap">
          {t.pricingPopular}
        </span>
      )}
      <h2 className="text-sf-headline font-bold text-[#1C1C1E]">{tier.name}</h2>
      <p className="mt-1 mb-3">
        <span className="text-[26px] font-extrabold text-[#1C1C1E]" dir="ltr">
          {price === 0 ? '₪0' : `₪${price.toFixed(2)}`}
        </span>
        <span className="text-[11px] text-[#8E8E93]"> / {t.pricingPerMonth}</span>
      </p>
      <ul className="space-y-2 flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[12.5px] text-[#3C3C43]">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="mt-0.5 flex-shrink-0">
              <path d="M2.5 7l3 3 5-6" stroke="#34C759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-4">
        {isCurrent ? (
          <span className="block w-full text-center py-2.5 rounded-2xl bg-[#34C759]/10 text-[#34C759] text-sf-subhead font-bold">
            {t.pricingCurrent}
          </span>
        ) : ctaLabel ? (
          <button
            type="button"
            disabled={busy}
            onClick={onCta}
            className={`w-full py-2.5 rounded-2xl text-sf-subhead font-bold transition active:scale-[0.98] disabled:opacity-50 ${
              tier.highlight
                ? 'bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white'
                : 'bg-[#1C1C1E] text-white'
            }`}
          >
            {busy ? '…' : ctaLabel}
          </button>
        ) : null}
      </div>
    </motion.div>
  )
}
