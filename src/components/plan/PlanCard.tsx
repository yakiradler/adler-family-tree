import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang } from '../../i18n/useT'
import { effectivePlan, trialDaysLeft } from '../../lib/plans'

/** Small leaf glyph used wherever a leaves balance is shown. */
export function LeafIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M11.8 2.2C7.5 2.4 4.4 3.8 3.2 6.4c-.9 2-.3 4 .6 5.1.3-2 1.3-4.5 4-6.2-2 2-3.2 4.4-3.3 6.6 1.2.5 3.2.7 4.8-.5 2.4-1.8 2.7-6 2.5-9.2z"
        fill="#34C759"
      />
    </svg>
  )
}

/**
 * Dashboard "my plan" card — tier, leaf balance, trial countdown and
 * the door into the pricing funnel. fetchMyPlan here is the single
 * demo-mode entry point that synthesizes the default free plan.
 */
export default function PlanCard() {
  const navigate = useNavigate()
  const { t } = useLang()
  const myPlan = useFamilyStore((s) => s.myPlan)
  const fetchMyPlan = useFamilyStore((s) => s.fetchMyPlan)

  useEffect(() => { fetchMyPlan() }, [fetchMyPlan])

  const def = effectivePlan(myPlan)
  const daysLeft = trialDaysLeft(myPlan)
  const planName =
    def.id === 'free' ? t.planFree : def.id === 'family' ? t.planFamily : t.planPremium

  return (
    <motion.button
      type="button"
      onClick={() => navigate('/pricing')}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="w-full glass-strong rounded-3xl p-4 shadow-glass flex items-center gap-3 hover:bg-white/70 transition text-start"
    >
      <span className="w-10 h-10 rounded-2xl bg-[#34C759]/12 flex items-center justify-center flex-shrink-0">
        <LeafIcon size={20} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sf-subhead font-bold text-[#1C1C1E]">
          {t.planCardTitle}: {planName}
          {daysLeft != null && (
            <span className="ms-2 px-2 py-0.5 rounded-full bg-[#34C759]/12 text-[#34C759] text-[10.5px] font-bold">
              {t.planTrialDaysLeft.replace('{days}', String(daysLeft))}
            </span>
          )}
        </span>
        <span className="block text-[11.5px] text-[#8E8E93] mt-0.5 flex items-center gap-1">
          <LeafIcon size={11} />
          {myPlan?.leaves ?? 0} {t.planLeaves}
        </span>
      </span>
      <span className="px-3 py-1.5 rounded-xl bg-[#007AFF]/10 text-[#007AFF] text-[12px] font-bold flex-shrink-0">
        {t.planUpgradeCta}
      </span>
    </motion.button>
  )
}
