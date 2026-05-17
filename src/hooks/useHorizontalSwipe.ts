import { useCallback, useRef } from 'react'

/**
 * Detect a deliberate horizontal swipe on a touch surface.
 *
 * Returns onTouchStart / onTouchEnd handlers you spread onto any
 * element. The hook calls `onSwipe('left' | 'right')` once per
 * gesture, after the touch ends, only if:
 *
 *   • the horizontal travel exceeded MIN_DISTANCE px, AND
 *   • the gesture was at least mostly-horizontal (|dy| ≤ |dx| × 0.7),
 *   • the user didn't fling out for more than MAX_DURATION ms.
 *
 * The vertical-dominance gate is important — the consumer surfaces
 * (SchematicView, TimelineView) scroll vertically, and we DON'T want
 * a normal vertical scroll to also trigger a view swap.
 *
 * Pass `enabled: false` to make the handlers no-ops without having to
 * conditionally spread them.
 */

interface UseHorizontalSwipeOpts {
  enabled?: boolean
  /** Minimum horizontal distance (px) to count as a swipe. */
  minDistance?: number
  /** Maximum gesture duration (ms) — slower drags don't count. */
  maxDuration?: number
}

const DEFAULT_MIN_DISTANCE = 80
const DEFAULT_MAX_DURATION = 800

export function useHorizontalSwipe(
  onSwipe: (direction: 'left' | 'right') => void,
  { enabled = true, minDistance = DEFAULT_MIN_DISTANCE, maxDuration = DEFAULT_MAX_DURATION }: UseHorizontalSwipeOpts = {},
) {
  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)
  const startT = useRef<number>(0)

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return
      if (e.touches.length !== 1) {
        // Multi-touch (pinch zoom etc.) — bail, don't compete.
        startX.current = null
        return
      }
      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
      startT.current = Date.now()
    },
    [enabled],
  )

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return
      if (startX.current === null || startY.current === null) return

      const endTouch = e.changedTouches[0]
      const dx = endTouch.clientX - startX.current
      const dy = endTouch.clientY - startY.current
      const dt = Date.now() - startT.current

      startX.current = null
      startY.current = null

      if (dt > maxDuration) return
      if (Math.abs(dx) < minDistance) return
      // Reject mostly-vertical drags so the underlying scroll keeps
      // working. 0.7 is the cosine-ish threshold where "horizontal"
      // feels intentional.
      if (Math.abs(dy) > Math.abs(dx) * 0.7) return

      onSwipe(dx > 0 ? 'right' : 'left')
    },
    [enabled, maxDuration, minDistance, onSwipe],
  )

  return { onTouchStart, onTouchEnd }
}
