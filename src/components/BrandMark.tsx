import { motion } from 'framer-motion'

/**
 * InfiniTree brand glyph — renders the authored logo asset
 * (`public/icon-app.png`) at the requested pixel size. Used wherever
 * the standalone glyph appears in-app (Landing header, Auth modal,
 * Dashboard top bar). The wordmark version `public/logo-full.png` is
 * embedded directly via <img> in marketing surfaces.
 *
 * A continuous, very subtle scale-pulse + drop-shadow shimmer keeps
 * the mark feeling alive in every header without distracting from
 * the surrounding chrome. Set `static` to opt out (e.g. inside a
 * tooltip where motion would feel out of place).
 */
type Props = {
  size?: number
  className?: string
  /** Disable the idle breathing animation. */
  static?: boolean
}

export default function BrandMark({ size = 32, className, static: noAnim = false }: Props) {
  // In-app surfaces always use the transparent-bg glyph so the mark
  // sits on whatever container/page background it lands on, with no
  // redundant tile around it. The OS home-screen icon (icon-app.png)
  // is a separate asset that keeps the gradient tile baked in.
  if (noAnim) {
    return (
      <img
        src="/icon-app-glyph.png"
        width={size}
        height={size}
        alt="InfiniTree"
        loading="eager"
        decoding="async"
        className={className}
        style={{ display: 'block' }}
      />
    )
  }
  return (
    <motion.img
      src="/icon-app-glyph.png"
      width={size}
      height={size}
      alt="InfiniTree"
      loading="eager"
      decoding="async"
      className={className}
      style={{ display: 'block' }}
      animate={{
        scale: [1, 1.04, 1],
        filter: [
          'drop-shadow(0 0 0 rgba(31,190,196,0))',
          'drop-shadow(0 0 8px rgba(31,190,196,0.35))',
          'drop-shadow(0 0 0 rgba(31,190,196,0))',
        ],
      }}
      transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
}
