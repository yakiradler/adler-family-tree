/**
 * InfiniTree brand glyph — renders the authored logo asset
 * (`public/icon-app.png`) at the requested pixel size. Used wherever
 * the standalone glyph appears in-app (Landing header, Auth modal,
 * Dashboard top bar). The wordmark version `public/logo-full.png` is
 * embedded directly via <img> in marketing surfaces.
 *
 * We size the <img> with explicit width/height attrs so the browser
 * reserves space before the asset decodes (avoids layout shift), and
 * we mark it eager because the brand glyph is always above the fold.
 */
type Props = {
  size?: number
  className?: string
}

export default function BrandMark({ size = 32, className }: Props) {
  return (
    <img
      src="/icon-app.png"
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
