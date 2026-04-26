import { motion } from 'framer-motion'
import type { Member } from '../types'
import type { LineageInfo } from '../lib/lineage'
import type { SecondaryPartner } from './views/treeLayout'
import LineageBadge from './LineageBadge'
import { useLang } from '../i18n/useT'

// Instagram-story-style tree node: photo-ring above a white card with
// name + date range. Designed to be readable at the default tree scale
// while staying compact enough to fit many generations.

interface Props {
  member: Member
  size?: number // avatar diameter, px
  highlighted?: boolean
  onClick?: () => void
  variant?: 'default' | 'compact'
  /**
   * Resolved lineage for this member (computed once per render at the
   * parent level — see src/lib/lineage.ts). When omitted we fall back to
   * `member.lineage` without the Adler auto-rule, which is safe but
   * slightly less accurate.
   */
  lineage?: LineageInfo
  /**
   * Ex / deceased partners — rendered as a smaller circle row beneath the
   * card. They do NOT affect layout slot width (the layout engine handles
   * vertical spacing instead — see treeLayout.ts genOverflow).
   */
  secondaryPartners?: SecondaryPartner[]
  onSecondarySelect?: (memberId: string) => void
}

export function getRingGradient(m: Member): string {
  // Modern iridescent story rings with rich 4-stop gradients for depth.
  //  male   → royal blue → electric violet → cyan highlight
  //  female → rose-coral → pink → lavender → azure highlight
  //  other  → teal → azure
  if (m.gender === 'male')
    return 'linear-gradient(135deg, #0052FF 0%, #2B6BFF 30%, #6C47FF 65%, #19C6FF 100%)'
  if (m.gender === 'female')
    return 'linear-gradient(135deg, #FF3D88 0%, #FF5EAE 30%, #B46BFF 65%, #5AC8FA 100%)'
  return 'linear-gradient(135deg, #06D6A0 0%, #32ADE6 55%, #0052FF 100%)'
}

/** Soft ambient glow that surrounds each avatar — gender-tinted */
export function getRingShadow(m: Member): string {
  if (m.gender === 'male')
    return '0 10px 26px rgba(45,110,255,0.32), 0 2px 6px rgba(0,0,0,0.08)'
  if (m.gender === 'female')
    return '0 10px 26px rgba(255,80,160,0.30), 0 2px 6px rgba(0,0,0,0.08)'
  return '0 10px 26px rgba(50,173,230,0.30), 0 2px 6px rgba(0,0,0,0.08)'
}

export function getFallbackGradient(m: Member): string {
  // Tailwind classes for avatar silhouette background (when no photo).
  // Gradients stay within a single hue family on the bottom edge so we
  // don't get the "mystery cyan quarter" the user reported (the previous
  // female palette ended in `sky-400`, which clipped at the avatar
  // bottom-edge looked like a stray decoration).
  if (m.gender === 'male') return 'from-[#3463E8] via-[#5B6FFF] to-[#3F2BB3]'
  if (m.gender === 'female') return 'from-[#FF5EAE] via-[#E94A9C] to-[#A93388]'
  return 'from-[#06D6A0] via-[#0BA887] to-[#0A6B5B]'
}

export function getInitials(first: string, last: string) {
  const f = (first || '').trim().charAt(0)
  const l = (last || '').trim().charAt(0)
  return (f + l).toUpperCase() || '·'
}

/**
 * Gender-aware silhouette avatar used when no photo exists.
 *
 * Both glyphs are drawn at viewBox 0..24 with a fully-grounded body
 * line at y=22 so neither figure ends in mid-air (the previous female
 * silhouette had a translucent torso outline that several users
 * compared to a ghost). Distinguishing cues:
 *   • female — round ponytail mass behind the head, neck-to-shoulder
 *     curve scoops in then flares to a wide V (a dress-like outline).
 *   • male   — flat hairline cap, straight neck, square shoulders.
 */
export function PersonAvatarIcon({ gender, size }: { gender?: 'male' | 'female'; size: number }) {
  // Fill ~80% of the circle so the figure reads cleanly even at low zoom.
  const s = Math.round(size * 0.8)
  if (gender === 'female') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* Hair mass behind the head — bigger than the head itself, with
            two side lobes so it visibly reads as a hair shape (vs. a
            generic blob that looked spectral in the previous version). */}
        <path
          d="M5.4 11.8c0-3.9 3-7 6.6-7s6.6 3.1 6.6 7c0 1.4-0.4 2.6-1.1 3.6h-11c-0.7-1-1.1-2.2-1.1-3.6z"
          fill="white"
        />
        {/* Hair side lobes (frames cheeks) */}
        <path d="M6 11c-0.5 1.5-0.7 3-0.4 4.5l1.6 0.5v-5z" fill="white" />
        <path d="M18 11c0.5 1.5 0.7 3 0.4 4.5l-1.6 0.5v-5z" fill="white" />
        {/* Face — sits slightly forward of the hair mass */}
        <circle cx="12" cy="9.6" r="3.4" fill="white" />
        {/* Dress / shoulders — V-shape that flares to bottom for an
            obviously feminine outline. Solid fill, no see-through arc. */}
        <path
          d="M7.5 15.5c-2.5 1.5-4 4-4 6.5h17c0-2.5-1.5-5-4-6.5l-2 1c-0.6 0.3-1.4 0.5-2.5 0.5s-1.9-0.2-2.5-0.5l-2-1z"
          fill="white"
        />
      </svg>
    )
  }
  // Male / default — short hair + broader shoulders
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* Short hair cap that hugs the top of the head */}
      <path d="M7.4 7.4c0.6-2.5 2.4-4.2 4.6-4.2s4 1.7 4.6 4.2c-1-0.4-2.6-0.8-4.6-0.8s-3.6 0.4-4.6 0.8z" fill="white" />
      {/* Head */}
      <circle cx="12" cy="9.6" r="3.5" fill="white" />
      {/* Squarer shoulders, grounded at y=22 */}
      <path d="M3.8 22v-1.4c0-3 3.6-5.2 8.2-5.2s8.2 2.2 8.2 5.2V22h-16.4z" fill="white" />
    </svg>
  )
}

export default function MemberNode({
  member,
  size = 72,
  highlighted,
  onClick,
  variant = 'default',
  lineage,
  secondaryPartners,
  onSecondarySelect,
}: Props) {
  const { lang } = useLang()
  const deceased = !!member.death_date
  const birthYear = member.birth_date ? new Date(member.birth_date).getFullYear() : null
  const deathYear = member.death_date ? new Date(member.death_date).getFullYear() : null
  const labelDate = birthYear
    ? deathYear
      ? `${birthYear} – ${deathYear}`
      : `${birthYear}`
    : null

  // Effective lineage + display surname (handles Adler → Kahane suffix).
  // Fallback when caller didn't pass a resolved info: respect explicit
  // member.lineage but apply the male-only badge gate so we don't crown
  // women who happen to have a Kohen field set.
  const effLineage: LineageInfo =
    lineage ?? {
      lineage: member.lineage ?? null,
      byAdlerRule: false,
      showBadge: member.gender !== 'female'
        && (member.lineage === 'kohen' || member.lineage === 'levi'),
      daughterOf: member.gender === 'female'
        && (member.lineage === 'kohen' || member.lineage === 'levi')
        ? member.lineage
        : null,
    }
  const displaySurname = effLineage.byAdlerRule
    ? (lang === 'he' ? 'אדלר (כהנא)' : 'Adler (Kahane)')
    : member.last_name

  const compact = variant === 'compact'
  const ringThickness = 3
  const innerPad = 2
  const avatarSize = size

  // The card sits partly underneath the avatar, photo overlaps the top edge.
  // Wider card gives each name breathing room so siblings never collide.
  const cardWidth = compact ? avatarSize + 36 : avatarSize + 72
  const overlap = Math.round(avatarSize * 0.38) // how much avatar overlaps card

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -4, scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      className="relative flex flex-col items-center no-select group"
      style={{ width: cardWidth }}
    >
      {/* Story ring with photo */}
      <div
        className={`relative rounded-full z-10 ${highlighted ? 'ring-4 ring-[#007AFF]/40' : ''}`}
        style={{
          padding: ringThickness,
          background: getRingGradient(member),
          boxShadow: highlighted
            ? '0 14px 34px rgba(0,122,255,0.45), 0 2px 8px rgba(0,0,0,0.1)'
            : getRingShadow(member),
        }}
      >
        {/* IG-verified-style lineage badge — sits on the ring's
            top-trailing corner. Renders only for males with effective
            Kohen / Levi lineage (see LineageInfo.showBadge). */}
        <LineageBadge info={effLineage} size={compact ? 10 : 12} variant="ring" />
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

            {/* Gender is now communicated by the silhouette (or the
                photo) + the gradient ring — the tiny corner badge was
                visually noisy and several users mistook it for a stray
                decoration, so it was removed. */}
          </div>
        </div>
      </div>

      {/* Card with name + dates (photo overlaps its top edge). Layered
          shadows + subtle top-edge gradient for depth without feeling heavy. */}
      <div
        className="relative rounded-[18px] border border-white/70 pt-1 pb-2 px-3"
        style={{
          marginTop: -overlap,
          paddingTop: overlap + 8,
          width: cardWidth,
          background: 'linear-gradient(180deg, #FFFFFF 0%, #FAFBFF 100%)',
          boxShadow:
            '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(17,34,64,0.08), 0 2px 6px rgba(17,34,64,0.05)',
        }}
      >
        {/* Birth-order chip (shown only when defined) */}
        {typeof member.birth_order === 'number' && (
          <div
            className="absolute -top-1.5 right-2 px-1.5 min-w-[18px] h-[18px] rounded-full text-[9px] font-bold text-white flex items-center justify-center shadow-sm"
            style={{
              background:
                member.gender === 'female'
                  ? 'linear-gradient(135deg,#FF5EAE,#B46BFF)'
                  : 'linear-gradient(135deg,#2B6BFF,#6C47FF)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
            }}
            title={`Birth order: ${member.birth_order}`}
          >
            {member.birth_order}
          </div>
        )}

        <p
          className="font-bold text-[#1C1C1E] leading-tight text-center truncate"
          style={{ fontSize: compact ? 11 : 13 }}
          title={`${member.first_name} ${displaySurname}`}
        >
          <span className="truncate">{member.first_name}</span>
        </p>
        {displaySurname && (
          <p
            className="text-[#636366] leading-tight text-center truncate"
            style={{ fontSize: compact ? 9.5 : 10.5 }}
          >
            {displaySurname}
          </p>
        )}
        {labelDate && (
          <p
            className="leading-tight text-center mt-0.5 font-semibold"
            style={{
              fontSize: compact ? 9 : 10,
              background:
                member.gender === 'female'
                  ? 'linear-gradient(90deg,#FF5EAE,#B46BFF)'
                  : 'linear-gradient(90deg,#2B6BFF,#19C6FF)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {labelDate}
          </p>
        )}
      </div>

      {/* Ex / deceased partners — small circles row beneath the card.
          We stop event propagation so clicking a partner doesn't also
          re-trigger the parent member's onClick. */}
      {secondaryPartners && secondaryPartners.length > 0 && (
        <div
          className="mt-1.5 flex items-center justify-center gap-1.5"
          aria-label="ex or deceased partners"
        >
          {secondaryPartners.map(({ member: p, status }) => (
            <SecondaryPartnerBadge
              key={p.id}
              partner={p}
              status={status}
              onClick={(e) => {
                e.stopPropagation()
                onSecondarySelect?.(p.id)
              }}
            />
          ))}
        </div>
      )}
    </motion.button>
  )
}

/**
 * Small avatar circle representing an ex or deceased partner. Placed in
 * a row beneath the main card. Uses a dimmer ring + status icon overlay
 * so the eye instantly distinguishes "former relationship" from a current
 * spouse, which is rendered as a full-size adjacent node.
 */
function SecondaryPartnerBadge({
  partner,
  status,
  onClick,
}: {
  partner: Member
  status: SecondaryPartner['status']
  onClick: (e: React.MouseEvent) => void
}) {
  const SIZE = 36
  const isDeceased = status === 'deceased'
  // Dim the ring slightly for ex (kept color) vs deceased (greyscale).
  const ringStyle: React.CSSProperties = isDeceased
    ? { background: 'linear-gradient(135deg,#9CA3AF,#6B7280)' }
    : { background: getRingGradient(partner), opacity: 0.8 }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(e as unknown as React.MouseEvent)
        }
      }}
      className="relative shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#007AFF)] rounded-full"
      title={`${partner.first_name} ${partner.last_name} · ${status === 'ex' ? 'ex' : '⸸'}`}
      style={{ width: SIZE, height: SIZE }}
    >
      <div
        className="rounded-full"
        style={{ padding: 1.5, ...ringStyle }}
      >
        <div className="rounded-full bg-white p-[1px]">
          <div
            className="rounded-full overflow-hidden"
            style={{ width: SIZE - 5, height: SIZE - 5 }}
          >
            {partner.photo_url ? (
              <img
                src={partner.photo_url}
                alt=""
                className={`w-full h-full object-cover ${isDeceased ? 'grayscale' : ''}`}
              />
            ) : (
              <div
                className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(partner)} flex items-center justify-center ${isDeceased ? 'grayscale' : ''}`}
              >
                <PersonAvatarIcon gender={partner.gender} size={SIZE - 5} />
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Status glyph in the bottom-right corner */}
      <span
        className="absolute -bottom-0.5 -end-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold leading-none border border-white shadow-sm"
        style={{
          background: isDeceased ? '#1F2937' : '#FF9F0A',
          color: 'white',
        }}
        aria-hidden
      >
        {isDeceased ? '✝' : '✕'}
      </span>
    </div>
  )
}
