import { useEffect, useRef } from 'react'

/**
 * Makes the phone's back button close the topmost open overlay (panel,
 * modal, popover) instead of leaving the page — an owner request: "back
 * from an open profile should return to the tree, not to the home page".
 *
 * Mechanics: ONE sentinel history entry guards any number of stacked
 * overlays (a per-overlay entry would desync when React unmounts parent
 * and child overlays in the same commit). A module-level stack tracks
 * open overlays; a back press closes the top one and re-arms the
 * sentinel while any remain.
 *
 * The tricky part is that `history.back()` is ASYNC: when the last
 * overlay closes through its own UI we issue a back() to consume the
 * sentinel, but a new overlay can register before that pop lands (e.g.
 * the tree-switcher popover closing in the same commit that opens the
 * delete-confirm dialog). `pendingConsumes` counts our own in-flight
 * back() calls so their popstates are swallowed, and arming is deferred
 * until they land — otherwise we'd push a sentinel on top of a doomed
 * entry and the bookkeeping would point at the wrong history slot.
 *
 * HashRouter only reacts to hash CHANGES, and the sentinel keeps the
 * URL identical — so router navigation is never affected.
 */

interface OverlayEntry {
  id: number
  close: () => void
}

const stack: OverlayEntry[] = []
let nextId = 1
let sentinelActive = false
let pendingConsumes = 0
let listenerInstalled = false

function hasSentinelState(): boolean {
  const cur = (window.history.state ?? {}) as { __ftOverlay?: boolean }
  return !!cur.__ftOverlay
}

function armSentinel() {
  if (sentinelActive) return
  // A self-issued back() is still in flight — pushing now would stack a
  // sentinel on top of the entry that pop is about to remove. The
  // popstate handler re-arms once the consume lands.
  if (pendingConsumes > 0) return
  // Preserve whatever state the router stored for this entry; only tag it.
  const base = (window.history.state ?? {}) as Record<string, unknown>
  window.history.pushState({ ...base, __ftOverlay: true }, '')
  sentinelActive = true
}

function ensureListener() {
  if (listenerInstalled || typeof window === 'undefined') return
  listenerInstalled = true
  window.addEventListener('popstate', () => {
    if (pendingConsumes > 0) {
      // Our own back() landed — swallow it, and re-arm if overlays
      // opened while it was in flight.
      pendingConsumes--
      if (stack.length > 0) armSentinel()
      return
    }
    if (!sentinelActive || stack.length === 0) return
    // A real user back press consumed the sentinel entry.
    sentinelActive = false
    const top = stack.pop()
    top?.close()
    // More overlays still open → push a fresh sentinel so the NEXT back
    // also closes an overlay rather than leaving the page.
    if (stack.length > 0) armSentinel()
  })
}

function register(close: () => void): number {
  ensureListener()
  const id = nextId++
  stack.push({ id, close })
  armSentinel()
  return id
}

function unregister(id: number) {
  const idx = stack.findIndex((e) => e.id === id)
  if (idx === -1) return // already removed by the popstate handler
  stack.splice(idx, 1)
  if (stack.length > 0 || !sentinelActive) return
  // Last overlay closed through its own UI (X button / backdrop): the
  // sentinel entry is still on the history stack — consume it so the
  // next back press doesn't no-op. Guard: if the app already navigated
  // elsewhere (overlay unmounted by a route change), the current entry
  // is the router's, not our sentinel — going back would yank the user
  // off the page they just navigated to.
  sentinelActive = false
  if (hasSentinelState()) {
    pendingConsumes++
    window.history.back()
  }
}

/**
 * Hook an overlay's open state to the back button. While `open` is
 * true, the next back press calls `onClose` instead of navigating.
 * Safe to stack — back closes overlays top-down, one per press.
 */
export function useCloseOnBack(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  // Keep the latest close callback without re-registering the overlay
  // (ref write happens in an effect — react-hooks v7 forbids render-time
  // ref mutation).
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    const id = register(() => closeRef.current())
    return () => unregister(id)
  }, [open])
}
