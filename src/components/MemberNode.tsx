import { motion } from 'framer-motion'
import type { Member } from '../types'

// Instagram-story-style tree node: photo-ring above a white card with
// name + date range. Designed to be readable at the default tree scale
// while staying compact enough to fit many generations.

interface Props {
  member: Member
  size?: number // avatar diameter, px
  highlighted?: boolean
  onClick?: () => void
  variant?: 'default' | 'compact'
}

export function getRingGradient(m: Member): string {
  // Blue-family story rings. Gender distinguished by hue/saturation:
  //  male   → deep blue → indigo
  //  female → cyan → lighter sky
  //  other  → teal → azure
  if (m.gender === 'male') return 'linear-gradient(135deg, #0A84FF 0%, #007AFF 55%, #5E5CE6 100%)'
  if (m.gender === 'female') return 'linear-gradient(135deg, #5AC8FA 0%, #64D2FF 55%, #30B0E6 100%)'
  return 'linear-gradient(135deg, #30D1C5 0%, #32ADE6 55%, #007AFF 100%)'
}

export function getFallbackGradient(m: Member): string {
  // Tailwind classes — blue/cyan theme, gender still distinguishable
  if (m.gender === 'male') return 'from-blue-500 to-indigo-500'
  if (m.gender === 'female') return 'from-sky-400 to-cyan-500'
  return 'from-teal-400 to-sky-500'
}

export function getInitials(first: string, last: string) {
  const f = (first || '').trim().charAt(0)
  const l = (last || '').trim().charAt(0)
  return (f + l).toUpperCase() || '·'
}

/** Gender-aware silhouette avatar used when no photo exists. */
export function PersonAvatarIcon({ gender, size }: { gender?: 'male' | 'female'; size: number }) {
  // Size the SVG to fill ~70% of the circle; white fill on gradient bg.
  const s = Math.round(size * 0.7)
  if (gender === 'female') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* Hair back */}
        <path d="M4.5 18.5c0-5 2.7-8.5 7.5-8.5s7.5 3.5 7.5 8.5v2.5H4.5v-2.5z" fill="white" opacity="0.85" />
        {/* Head */}
        <circle cx="12" cy="8" r="4.2" fill="white" />
        {/* Hair top */}
        <path d="M7.4 8.3c0-3 2-5.3 4.6-5.3s4.6 2.3 4.6 5.3c-1.4-1.3-2.9-1.9-4.6-1.9-1.7 0-3.2 0.6-4.6 1.9z" fill="white" />
        {/* Shoulders */}
        <path d="M4 22c0-4 3.5-7 8-7s8 3 8 7" fill="white" />
      </svg>
    )
  }
  // Male / default
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="4" fill="white" />
      <path d="M4 22c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="white" />
    </svg>
  )
}

export default function MemberNode({ member, size = 72, highlighted, onClick, variant = 'default' }: Props) {
  const deceased = !!member.death_date
  const birthYear = member.birth_date ? new Date(member.birth_date).getFullYear() : null
  const deathYear = member.death_date ? new Date(member.death_date).getFullYear() : null
  const labelDate = birthYear
    ? deathYear
      ? `${birthYear} – ${deathYear}`
      : `${birthYear}`
    : null

  const compact = variant === 'compact'
  const ringThickness = 2.75
  const innerPad = 2
  const avatarSize = size

  // The card sits partly underneath the avatar, photo overlaps the top edge.
  // Overall node width is driven by the card.
  const cardWidth = compact ? avatarSize + 24 : avatarSize + 48
  const overlap = Math.round(avatarSize * 0.38) // how much avatar overlaps card

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -3, scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      className="relative flex flex-col items-center no-select group"
      style={{ width: cardWidth }}
    >
      {/* Story ring with photo */}
      <div
        className={`relative rounded-full z-10 ${highlighted ? 'ring-4 ring-[#007AFF]/30' : ''}`}
        style={{
          padding: ringThickness,
          background: getRingGradient(member),
          boxShadow: highlighted
            ? '0 10px 26px rgba(0,122,255,0.38)'
            : '0 6px 16px rgba(0,0,0,0.14)',
        }}
      >
        <div
          className="rounded-full bg-white"
          style={{ padding: innerPad }}
        >
          <div
            className="rounded-full overflow-hidden relative"
            style={{ width: avatarSize, height: avatarSize }}
          >
            {member.photo_url ? (
              <img
                src={member.photo_url}
                alt={`${member.first_name} ${member.last_name}`}
                className={`w-full h-full object-cover transition ${deceased ? 'grayscale opacity-80' : ''}`}
              />
            ) : (
              <div
                className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(member)} flex items-center justify-center`}
              >
                <PersonAvatarIcon gender={member.gender} size={avatarSize} />
              </div>
            )}

            {deceased && (
              <div className="absolute bottom-0 inset-x-0 flex justify-center pb-1">
                <span className="text-[9px] bg-black/60 text-white px-1.5 py-[1px] rounded-full font-bold leading-none">
                  ז״ל
                </span>
              </div>
            )}

            {/* Gender dot */}
            {member.gender && (
              <div
                className="absolute bottom-0 w-5 h-5 rounded-full border-2 border-white flex items-center justify-center text-[10px] leading-none"
                style={{
                  [member.gender === 'male' ? 'right' : 'left']: -2,
                  bottom: -2,
                  background: member.gender === 'male' ? '#007AFF' : '#5AC8FA',
                  color: 'white',
                } as React.CSSProperties}
              >
                {member.gender === 'male' ? '♂' : '♀'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Card with name + dates (photo overlaps its top edge) */}
      <div
        className="relative bg-white rounded-2xl border border-black/5 shadow-md pt-1 pb-2 px-2.5"
        style={{
          marginTop: -overlap,
          paddingTop: overlap + 6,
          width: cardWidth,
        }}
      >
        <p
          className="font-bold text-[#1C1C1E] leading-tight text-center truncate"
          style={{ fontSize: compact ? 11 : 12.5 }}
          title={`${member.first_name} ${member.last_name}`}
        >
          {member.first_name}
        </p>
        {member.last_name && (
          <p
            className="text-[#636366] leading-tight text-center truncate"
            style={{ fontSize: compact ? 9.5 : 10.5 }}
          >
            {member.last_name}
          </p>
        )}
        {labelDate && (
          <p
            className="text-[#8E8E93] leading-tight text-center mt-0.5 font-medium"
            style={{ fontSize: compact ? 9 : 10 }}
          >
            {labelDate}
          </p>
        )}
      </div>
    </motion.button>
  )
}
