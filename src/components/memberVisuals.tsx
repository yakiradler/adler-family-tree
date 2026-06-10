import type { Member } from '../types'

// Shared avatar/ring visuals for member representations across the app
// (tree nodes, panels, modals, lists). Extracted from MemberNode.tsx so
// that component files only export components — a requirement for Vite's
// fast refresh (react-refresh/only-export-components). The companion
// PersonAvatarIcon component stays in MemberNode.tsx for the same
// reason: putting it here would make THIS file a mixed module.

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
