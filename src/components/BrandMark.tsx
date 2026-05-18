/**
 * InfiniTree brand glyph — vector copy of public/favicon.svg, inlined
 * so it can be styled with currentColor / sized fluidly without an
 * extra network round-trip. Use this anywhere the brand mark appears
 * in-app (Landing header, Auth header, install banners). The PWA
 * icon + favicon live as standalone files in /public.
 */
type Props = {
  size?: number
  className?: string
  /** When true, the leaves+roots fall back to the gradient's mid-tone
   *  instead of using the multi-stop gradient. Useful on coloured tile
   *  backgrounds where the full gradient washes out. */
  flat?: boolean
}

export default function BrandMark({ size = 32, className, flat = false }: Props) {
  const gradId = `infinitree-grad-${flat ? 'flat' : 'g'}`
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
          {flat ? (
            <>
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="100%" stopColor="#FFFFFF" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#3CCB89" />
              <stop offset="55%" stopColor="#26B5A6" />
              <stop offset="100%" stopColor="#1A8E96" />
            </>
          )}
        </linearGradient>
      </defs>

      <g
        transform="translate(32 8)"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Canopy */}
        <g fill={`url(#${gradId})`} stroke="none">
          <ellipse cx="0" cy="2" rx="3" ry="5" />
          <ellipse cx="-7" cy="4" rx="3" ry="5" transform="rotate(-25 -7 4)" />
          <ellipse cx="7" cy="4" rx="3" ry="5" transform="rotate(25 7 4)" />
          <ellipse cx="-12" cy="9" rx="3" ry="5" transform="rotate(-45 -12 9)" />
          <ellipse cx="12" cy="9" rx="3" ry="5" transform="rotate(45 12 9)" />
          <ellipse cx="-15" cy="15" rx="3" ry="4" transform="rotate(-65 -15 15)" />
          <ellipse cx="15" cy="15" rx="3" ry="4" transform="rotate(65 15 15)" />
        </g>

        {/* Center stem into infinity */}
        <path d="M0 14 L0 22" strokeWidth="2.5" />

        {/* Infinity loop */}
        <path
          d="M -3 26 C -12 26, -16 32, -16 36 C -16 41, -10 44, -3 40 C 0 38, -3 38, 3 40 C 10 44, 16 41, 16 36 C 16 32, 12 26, 3 26 C 0 28, 3 28, -3 26 Z"
          strokeWidth="2.5"
        />

        {/* Roots */}
        <path d="M0 42 L0 52" strokeWidth="1.8" />
        <path d="M-2 44 C -6 48, -8 51, -10 53" strokeWidth="1.5" />
        <path d="M2 44 C 6 48, 8 51, 10 53" strokeWidth="1.5" />
        <path d="M-1 47 C -3 50, -4 52, -5 53" strokeWidth="1.2" />
        <path d="M1 47 C 3 50, 4 52, 5 53" strokeWidth="1.2" />
      </g>
    </svg>
  )
}
