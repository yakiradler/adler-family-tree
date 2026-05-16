import { useEffect, useState } from 'react'

/**
 * Best-effort browser-zoom factor (1 = 100%, 2 = 200%, etc.).
 *
 * Browser zoom scales every CSS pixel, which inflates fixed-positioned
 * UI like the MemberPanel until it dominates the viewport. We can't
 * opt out of zoom in pure CSS, but we can detect it and apply an
 * inverse `transform: scale()` to keep specific overlays at a roughly
 * constant physical size.
 *
 * Detection strategy: compare `window.outerWidth` (real device pixels
 * of the browser window) against `window.innerWidth` (the CSS-pixel
 * viewport the page sees). On desktop Chrome / Edge / Firefox at 100%
 * zoom the two are equal once you subtract scrollbar width; at 200%
 * zoom outerWidth stays roughly the same while innerWidth halves.
 *
 * Caveats:
 *   • Returns 1 on mobile (visual viewport behaves differently and
 *     pinch-zoom is the user's prerogative, not something we override).
 *   • Returns 1 when devtools are docked sideways (innerWidth shrinks
 *     but that's "real" extra chrome, not zoom).
 *   • Clamped to [1, 3] so a glitchy reading can't blow up the layout.
 *
 * Intentionally conservative — when in doubt, return 1 and let the
 * default CSS apply.
 */
export function useBrowserZoom(): number {
  const [zoom, setZoom] = useState<number>(1)

  useEffect(() => {
    const update = () => {
      // Skip on touch primary devices — pinch-zoom there is intentional
      // and visualViewport handles it natively.
      if (
        typeof window === 'undefined' ||
        !window.matchMedia('(pointer: fine)').matches
      ) {
        setZoom(1)
        return
      }
      const ow = window.outerWidth
      const iw = window.innerWidth
      if (!ow || !iw) {
        setZoom(1)
        return
      }
      const raw = ow / iw
      // Below ~1.1 we treat as "no zoom" to avoid jittery scaling from
      // scrollbar / devtools width differences. Above 3x we clamp.
      const clamped = raw < 1.1 ? 1 : Math.min(3, raw)
      setZoom(clamped)
    }

    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return zoom
}
