import type { LineageInfo } from '../lib/lineage'

/**
 * Small inline badge shown next to a member's name.
 *   Kohen → golden crown
 *   Levi  → musical note (lyre proxy)
 *   Israel / null → nothing
 *
 * Size scales with the parent font so it sits cleanly on member cards
 * at any zoom level. Pure SVG, zero runtime cost — safe for large trees.
 */
export default function LineageBadge({
  info,
  size = 12,
  title,
}: {
  info: LineageInfo
  size?: number
  title?: string
}) {
  if (!info.lineage || info.lineage === 'israel') return null

  if (info.lineage === 'kohen') {
    return (
      <span
        role="img"
        aria-label={title ?? 'Kohen'}
        title={title ?? 'Kohen'}
        className="inline-flex items-center justify-center align-middle shrink-0"
        style={{ width: size + 4, height: size + 4 }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="kohen-gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFE27A" />
              <stop offset="55%" stopColor="#F5B82E" />
              <stop offset="100%" stopColor="#B77A08" />
            </linearGradient>
          </defs>
          {/* Crown body */}
          <path
            d="M2 6.5 L4.5 10 L6.5 6 L8 10 L9.5 6 L11.5 10 L14 6.5 L13 12 H3 Z"
            fill="url(#kohen-gold)"
            stroke="#8A5A00"
            strokeWidth="0.6"
            strokeLinejoin="round"
          />
          {/* Gem dots */}
          <circle cx="4.5" cy="7" r="0.8" fill="#E21B5A" />
          <circle cx="8" cy="7" r="0.9" fill="#1F70E0" />
          <circle cx="11.5" cy="7" r="0.8" fill="#1BA864" />
          {/* Base */}
          <rect x="2.5" y="12" width="11" height="1.4" rx="0.5" fill="#8A5A00" />
        </svg>
      </span>
    )
  }

  // Levi — stylised lyre / musical note.
  return (
    <span
      role="img"
      aria-label={title ?? 'Levi'}
      title={title ?? 'Levi'}
      className="inline-flex items-center justify-center align-middle shrink-0"
      style={{ width: size + 4, height: size + 4 }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="levi-silver" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C6D4FF" />
            <stop offset="60%" stopColor="#6C7DF5" />
            <stop offset="100%" stopColor="#3E44B8" />
          </linearGradient>
        </defs>
        {/* Note stem */}
        <rect
          x="9"
          y="2.5"
          width="1.3"
          height="9"
          fill="url(#levi-silver)"
          rx="0.4"
        />
        {/* Flag */}
        <path
          d="M10.3 2.5 C 13 3.5, 13 6, 10.3 7"
          stroke="url(#levi-silver)"
          strokeWidth="1.3"
          fill="none"
          strokeLinecap="round"
        />
        {/* Head */}
        <ellipse
          cx="6.8"
          cy="11.2"
          rx="2.6"
          ry="1.9"
          fill="url(#levi-silver)"
          stroke="#2D3592"
          strokeWidth="0.5"
          transform="rotate(-18 6.8 11.2)"
        />
      </svg>
    </span>
  )
}
