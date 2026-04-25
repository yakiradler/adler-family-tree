import type { LineageInfo } from '../lib/lineage'

/**
 * Lineage badge — Kohen (gold crown) or Levi (silver lyre).
 *
 * Two render modes:
 *   • inline  — used inside the name row (legacy callers, profile page).
 *   • ring    — Instagram-verified-style overlay clipped to the avatar
 *               ring. Used on tree cards. Caller positions the wrapper.
 *
 * Halachic gate: the badge ONLY renders when `info.showBadge` is true,
 * which is only set for males with resolved Kohen/Levi lineage. Daughters
 * of Kohanim/Levi'im are surfaced through `info.daughterOf` and rendered
 * as text in the profile, not as a crown.
 */
export default function LineageBadge({
  info,
  size = 12,
  title,
  variant = 'inline',
}: {
  info: LineageInfo
  size?: number
  title?: string
  variant?: 'inline' | 'ring'
}) {
  if (!info.showBadge || !info.lineage || info.lineage === 'israel') return null

  const isKohen = info.lineage === 'kohen'
  const label = title ?? (isKohen ? 'Kohen' : 'Levi')

  // Ring variant — circular chip with white border, sits on the avatar
  // ring corner like an Instagram verified checkmark.
  if (variant === 'ring') {
    const chip = size + 6
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="absolute z-20 pointer-events-none flex items-center justify-center rounded-full shadow-md"
        style={{
          width: chip,
          height: chip,
          // top-end corner of the avatar — caller wraps this in a relative
          // positioned avatar container.
          top: -2,
          insetInlineEnd: -2,
          background: isKohen
            ? 'linear-gradient(135deg,#FFE27A 0%,#F5B82E 55%,#B77A08 100%)'
            : 'linear-gradient(135deg,#C6D4FF 0%,#6C7DF5 60%,#3E44B8 100%)',
          border: '2px solid #FFFFFF',
        }}
      >
        {isKohen ? <CrownGlyph size={size} /> : <LyreGlyph size={size} />}
      </span>
    )
  }

  // Inline variant — original SVG kept for the name row.
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center align-middle shrink-0"
      style={{ width: size + 4, height: size + 4 }}
    >
      {isKohen ? <CrownInline size={size} /> : <LyreInline size={size} />}
    </span>
  )
}

// ─── Inline (full-color) glyphs ──────────────────────────────────────────

function CrownInline({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <defs>
        <linearGradient id="kohen-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE27A" />
          <stop offset="55%" stopColor="#F5B82E" />
          <stop offset="100%" stopColor="#B77A08" />
        </linearGradient>
      </defs>
      <path
        d="M2 6.5 L4.5 10 L6.5 6 L8 10 L9.5 6 L11.5 10 L14 6.5 L13 12 H3 Z"
        fill="url(#kohen-gold)"
        stroke="#8A5A00"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      <circle cx="4.5" cy="7" r="0.8" fill="#E21B5A" />
      <circle cx="8" cy="7" r="0.9" fill="#1F70E0" />
      <circle cx="11.5" cy="7" r="0.8" fill="#1BA864" />
      <rect x="2.5" y="12" width="11" height="1.4" rx="0.5" fill="#8A5A00" />
    </svg>
  )
}

function LyreInline({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <defs>
        <linearGradient id="levi-silver" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C6D4FF" />
          <stop offset="60%" stopColor="#6C7DF5" />
          <stop offset="100%" stopColor="#3E44B8" />
        </linearGradient>
      </defs>
      <rect x="9" y="2.5" width="1.3" height="9" fill="url(#levi-silver)" rx="0.4" />
      <path d="M10.3 2.5 C 13 3.5, 13 6, 10.3 7" stroke="url(#levi-silver)" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <ellipse cx="6.8" cy="11.2" rx="2.6" ry="1.9" fill="url(#levi-silver)" stroke="#2D3592" strokeWidth="0.5" transform="rotate(-18 6.8 11.2)" />
    </svg>
  )
}

// ─── Ring (mono-white) glyphs — drawn on top of the colored chip ────────

function CrownGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.5 7 L5 10 L7 6 L8 10 L9 6 L11 10 L13.5 7 L12.5 12 H3.5 Z"
        fill="white"
        stroke="rgba(0,0,0,0.25)"
        strokeWidth="0.4"
        strokeLinejoin="round"
      />
      <rect x="3.2" y="11.8" width="9.6" height="1.2" rx="0.4" fill="white" />
    </svg>
  )
}

function LyreGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="9" y="2.8" width="1.2" height="8.4" fill="white" rx="0.4" />
      <path d="M10.2 2.8 C 12.6 3.6, 12.6 5.8, 10.2 6.8" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <ellipse cx="6.8" cy="11" rx="2.4" ry="1.7" fill="white" transform="rotate(-18 6.8 11)" />
    </svg>
  )
}
