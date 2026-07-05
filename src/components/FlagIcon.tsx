import { isCountryCode, isHeritageToken } from '../lib/countries'

/**
 * The single renderer for member origin flags. Every flag in the app
 * goes through here:
 *
 *   - ISO country code ('IL') → flag-icons CSS sprite (SVG assets; we
 *     deliberately avoid emoji flags — Windows Chrome renders them as
 *     plain letters).
 *   - Heritage token ('jewish') → inline SVG symbol (Star of David).
 *   - Anything else → renders nothing, so stale/unknown values are
 *     harmless.
 */
export default function FlagIcon({
  code,
  size = 16,
  title,
}: {
  code: string | null | undefined
  size?: number
  title?: string
}) {
  if (isCountryCode(code)) {
    return (
      <span
        className={`fi fi-${code.toLowerCase()} rounded-[3px] shadow-sm`}
        style={{ fontSize: size, lineHeight: 1 }}
        role="img"
        aria-label={title ?? code}
        title={title ?? code}
      />
    )
  }
  if (isHeritageToken(code)) {
    // 'jewish' → Star of David. Sized like the flags so rows align.
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        role="img"
        aria-label={title ?? code}
      >
        <title>{title ?? code}</title>
        <path
          d="M12 3L4.2 16.5h15.6L12 3z"
          stroke="#2B6BFF"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M12 21L4.2 7.5h15.6L12 21z"
          stroke="#2B6BFF"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return null
}
