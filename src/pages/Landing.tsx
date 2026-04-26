import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useLang, isRTL } from '../i18n/useT'
import QuickAccessMenu from '../components/QuickAccessMenu'
import { useAuthState } from '../hooks/useAuthState'

/**
 * Marketing landing page — the unauthenticated entry point.
 *
 * Hero with an animated SVG family-tree backdrop, a primary CTA that
 * sends new visitors into the auth/onboarding flow, and a feature grid
 * highlighting the platform's pillars (living tree, halachic lineage,
 * AI scan, invites, timeline, privacy).
 *
 * Visual language matches the rest of the app: mesh gradient, glass
 * surfaces, SF-style typography, and Apple-grade easing curves on every
 * motion. RTL-safe (uses `insetInlineEnd` rather than `right`).
 */
export default function Landing() {
  const navigate = useNavigate()
  const { t, lang, toggleLang } = useLang()
  const rtl = isRTL(lang)
  const dir = rtl ? 'rtl' : 'ltr'
  const { isAuth, target } = useAuthState()
  // Primary CTA: signed-in users continue into the app (or finish onboarding);
  // visitors are dropped on the signup tab so the funnel is one click long.
  const primaryCtaPath = isAuth ? target : '/login?signup=1'
  const secondaryCtaPath = isAuth ? target : '/login'

  return (
    <div dir={dir} className="relative min-h-screen overflow-hidden bg-mesh-gradient">
      {/* Animated family-tree backdrop */}
      <TreeBackdrop />

      {/* Soft color wash on top of the tree to keep text legible */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/55 via-white/30 to-white/70" />

      {/*
        Top bar — physical positioning so the layout is identical in
        Hebrew and English: logo always visual-left, hamburger menu
        always visual-right (per the explicit user request "hamburger
        on right, logo on left"). Tailwind's `left-*` / `right-*`
        utilities are physical and do not mirror with `dir`.
      */}
      <header className="relative z-20 h-[68px] px-5 sm:px-8">
        <div className="absolute top-1/2 -translate-y-1/2 left-5 sm:left-8 flex items-center gap-2">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-[#007AFF] to-[#32ADE6] flex items-center justify-center shadow-md shadow-blue-200/50">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="10" r="4" fill="white" opacity="0.9" />
              <circle cx="8" cy="22" r="3.5" fill="white" opacity="0.7" />
              <circle cx="24" cy="22" r="3.5" fill="white" opacity="0.7" />
              <line x1="16" y1="14" x2="8" y2="19" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
              <line x1="16" y1="14" x2="24" y2="19" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
            </svg>
          </div>
          <span className="font-semibold text-[15px] text-[#1C1C1E]">{t.appName}</span>
        </div>
        <div className="absolute top-1/2 -translate-y-1/2 right-5 sm:right-8 flex items-center gap-2">
          <QuickAccessMenu variant="glass" />
          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={toggleLang}
            className="glass px-3 py-1.5 rounded-xl text-[12px] font-semibold text-[#636366] hover:text-[#1C1C1E] transition-colors"
          >
            {lang === 'he' ? 'EN' : 'עב'}
          </motion.button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-5 sm:px-8 pt-8 sm:pt-16 pb-20 max-w-5xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="text-[36px] sm:text-[56px] leading-[1.05] font-bold tracking-tight text-[#1C1C1E]">
            {t.landingHeroTitle}
            <br />
            <span className="bg-gradient-to-r from-[#007AFF] via-[#5E5CE6] to-[#FF2D92] bg-clip-text text-transparent">
              {t.landingHeroTitleAccent}
            </span>
          </h1>
          <p className="mt-5 sm:mt-7 text-[15px] sm:text-[18px] leading-relaxed text-[#3A3A3C] max-w-2xl mx-auto">
            {t.landingHeroSubtitle}
          </p>

          <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <motion.button
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate(primaryCtaPath)}
              className="group relative overflow-hidden rounded-full px-7 py-3.5 bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-[15px] font-semibold shadow-lg shadow-blue-300/40"
            >
              <span className="relative z-10 inline-flex items-center gap-2">
                {t.landingCTA}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d={rtl ? 'M9 3L5 7l4 4' : 'M5 3l4 4-4 4'}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <motion.span
                aria-hidden
                className="absolute inset-0 bg-white/20"
                initial={{ x: '-120%' }}
                whileHover={{ x: '120%' }}
                transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
              />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate(secondaryCtaPath)}
              className="glass-strong rounded-full px-6 py-3.5 text-[14px] font-semibold text-[#1C1C1E] hover:bg-white/95 transition"
            >
              {isAuth ? t.landingCTAReturning : t.landingCTASecondary}
            </motion.button>
          </div>
        </motion.div>
      </section>

      {/* Feature grid */}
      <section className="relative z-10 px-5 sm:px-8 pb-24 max-w-6xl mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="text-center text-[22px] sm:text-[30px] font-bold text-[#1C1C1E] mb-8 sm:mb-12"
        >
          {t.landingFeaturesTitle}
        </motion.h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {[
            { icon: '🌳', title: t.landingFeature1Title, body: t.landingFeature1Body, hue: 'from-[#34C759]/15 to-[#30D158]/5' },
            { icon: '👑', title: t.landingFeature2Title, body: t.landingFeature2Body, hue: 'from-[#FFCC00]/20 to-[#FF9500]/5' },
            { icon: '✨', title: t.landingFeature3Title, body: t.landingFeature3Body, hue: 'from-[#5E5CE6]/15 to-[#BF5AF2]/5' },
            { icon: '🔐', title: t.landingFeature4Title, body: t.landingFeature4Body, hue: 'from-[#007AFF]/15 to-[#32ADE6]/5' },
            { icon: '🎂', title: t.landingFeature5Title, body: t.landingFeature5Body, hue: 'from-[#FF375F]/15 to-[#FF2D92]/5' },
            { icon: '🛡️', title: t.landingFeature6Title, body: t.landingFeature6Body, hue: 'from-[#8E8E93]/12 to-[#AEAEB2]/5' },
          ].map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.5, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
              className={`glass rounded-3xl p-5 sm:p-6 bg-gradient-to-br ${f.hue} hover:shadow-glass-lg transition-shadow`}
            >
              <div className="text-[28px] mb-3" aria-hidden>{f.icon}</div>
              <h3 className="text-[16px] font-semibold text-[#1C1C1E] mb-1.5">{f.title}</h3>
              <p className="text-[13px] leading-relaxed text-[#3A3A3C]">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 pb-10 text-center text-[12px] text-[#8E8E93]">
        {t.landingFooterTagline}
      </footer>
    </div>
  )
}

/**
 * Decorative animated family-tree SVG that sits behind the hero text.
 * Generations fade in cascade; faint connector lines breathe; circles
 * gently float. Pointer-events disabled so it never intercepts clicks.
 */
function TreeBackdrop() {
  // Coordinates for a stylised three-generation tree spread across the
  // viewport. Values are in viewBox units (0–1000 wide × 0–700 tall).
  const root = { x: 500, y: 110 }
  const gen2 = [
    { x: 280, y: 300 },
    { x: 720, y: 300 },
  ]
  const gen3 = [
    { x: 140, y: 510 },
    { x: 320, y: 510 },
    { x: 500, y: 510 },
    { x: 680, y: 510 },
    { x: 860, y: 510 },
  ]

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* Soft radial glows */}
      <div className="absolute -top-40 -left-32 w-[460px] h-[460px] rounded-full bg-[#5E5CE6]/15 blur-3xl" />
      <div className="absolute -top-20 -right-20 w-[380px] h-[380px] rounded-full bg-[#32ADE6]/15 blur-3xl" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[460px] rounded-full bg-[#FF2D92]/8 blur-3xl" />

      <svg
        viewBox="0 0 1000 700"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full opacity-[0.55]"
      >
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#007AFF" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#5E5CE6" stopOpacity="0.15" />
          </linearGradient>
          <radialGradient id="nodeGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#32ADE6" stopOpacity="0.55" />
          </radialGradient>
          <radialGradient id="rootGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="100%" stopColor="#FF2D92" stopOpacity="0.65" />
          </radialGradient>
        </defs>

        {/* Connectors root → gen2 */}
        {gen2.map((p, i) => (
          <motion.line
            key={`l1-${i}`}
            x1={root.x}
            y1={root.y}
            x2={p.x}
            y2={p.y}
            stroke="url(#lineGrad)"
            strokeWidth="2"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.2, delay: 0.3 + i * 0.15, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}

        {/* Connectors gen2 → gen3 */}
        {gen3.map((c, i) => {
          // First two children belong under gen2[0], last two under gen2[1],
          // middle child draws to both parents (a "couple's child").
          const parents =
            i < 2 ? [gen2[0]] : i > 2 ? [gen2[1]] : [gen2[0], gen2[1]]
          return parents.map((p, j) => (
            <motion.line
              key={`l2-${i}-${j}`}
              x1={p.x}
              y1={p.y}
              x2={c.x}
              y2={c.y}
              stroke="url(#lineGrad)"
              strokeWidth="1.6"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.0, delay: 0.9 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            />
          ))
        })}

        {/* Spouse line between gen2 pair */}
        <motion.line
          x1={gen2[0].x + 28}
          y1={gen2[0].y}
          x2={gen2[1].x - 28}
          y2={gen2[1].y}
          stroke="#FF2D92"
          strokeWidth="1.4"
          strokeOpacity="0.4"
          strokeDasharray="3 5"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.55 }}
          transition={{ duration: 1.1, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />

        {/* Root node */}
        <FloatingNode cx={root.x} cy={root.y} r={28} fill="url(#rootGrad)" delay={0} />

        {/* Gen 2 nodes */}
        {gen2.map((p, i) => (
          <FloatingNode key={`n2-${i}`} cx={p.x} cy={p.y} r={22} fill="url(#nodeGrad)" delay={0.45 + i * 0.12} />
        ))}

        {/* Gen 3 nodes */}
        {gen3.map((p, i) => (
          <FloatingNode key={`n3-${i}`} cx={p.x} cy={p.y} r={16} fill="url(#nodeGrad)" delay={1.0 + i * 0.08} />
        ))}
      </svg>
    </div>
  )
}

function FloatingNode({
  cx,
  cy,
  r,
  fill,
  delay,
}: {
  cx: number
  cy: number
  r: number
  fill: string
  delay: number
}) {
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{
        opacity: 1,
        scale: 1,
        y: [0, -6, 0],
      }}
      transition={{
        opacity: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] },
        scale: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] },
        y: { duration: 5, delay: delay + 0.6, repeat: Infinity, ease: 'easeInOut' },
      }}
      style={{ transformOrigin: `${cx}px ${cy}px` }}
    >
      <circle cx={cx} cy={cy} r={r + 4} fill="#FFFFFF" opacity="0.35" />
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke="#FFFFFF" strokeWidth="2" strokeOpacity="0.85" />
    </motion.g>
  )
}
