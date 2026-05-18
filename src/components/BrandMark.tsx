/**
 * InfiniTree brand glyph (v2). Vector copy of public/favicon.svg,
 * inlined so it can be sized fluidly without a network round-trip.
 * Used anywhere the brand mark appears in-app (Landing header, Auth
 * header, Dashboard top bar). The full-size PWA icon + tab favicon
 * live as standalone files in /public.
 */
type Props = {
  size?: number
  className?: string
}

export default function BrandMark({ size = 32, className }: Props) {
  const gradId = `infinitree-grad`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%"  stopColor="#4ED88E" />
          <stop offset="40%" stopColor="#1FBEC4" />
          <stop offset="100%" stopColor="#1A7AC9" />
        </linearGradient>
      </defs>

      <g
        transform="translate(32 32)"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Canopy branches */}
        <path d="M 0 -8 C -1 -14, -2 -20, 0 -24" strokeWidth="2.2" />
        <path d="M -1 -12 C -8 -16, -14 -18, -16 -22" strokeWidth="1.8" />
        <path d="M  1 -12 C  8 -16,  14 -18,  16 -22" strokeWidth="1.8" />
        <path d="M -1 -10 C -5 -16, -7 -20, -7 -25" strokeWidth="1.6" />
        <path d="M  1 -10 C  5 -16,  7 -20,  7 -25" strokeWidth="1.6" />

        {/* Leaf tips */}
        <g fill={`url(#${gradId})`} stroke="none">
          <ellipse cx="0"   cy="-26" rx="2.2" ry="3.5" />
          <ellipse cx="-7"  cy="-26" rx="2"   ry="3"   transform="rotate(-20 -7 -26)" />
          <ellipse cx="7"   cy="-26" rx="2"   ry="3"   transform="rotate(20 7 -26)" />
          <ellipse cx="-15" cy="-22" rx="2"   ry="3"   transform="rotate(-50 -15 -22)" />
          <ellipse cx="15"  cy="-22" rx="2"   ry="3"   transform="rotate(50 15 -22)" />
        </g>

        {/* Infinity loop */}
        <path
          d="M 0 -7 C -11 -7, -17 -1, -17 5 C -17 11, -11 14, -3 9 C 0 7, 0 7, 3 9 C 11 14, 17 11, 17 5 C 17 -1, 11 -7, 0 -7 Z"
          strokeWidth="2.4"
        />

        {/* Roots */}
        <path d="M 0 15 C -1 19, -2 23, 0 26" strokeWidth="2" />
        <path d="M -1 17 C -5 20, -8 22, -10 24" strokeWidth="1.5" />
        <path d="M  1 17 C  5 20,  8 22,  10 24" strokeWidth="1.5" />
        <path d="M -1 20 C -3 22, -4 24, -4 26" strokeWidth="1.2" />
        <path d="M  1 20 C  3 22,  4 24,  4 26" strokeWidth="1.2" />
      </g>
    </svg>
  )
}
