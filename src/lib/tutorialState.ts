/**
 * Tutorial auto-launch policy: show ONLY on the user's first day,
 * AND at most twice total. After that the tutorial is replayable on
 * demand (via the hamburger button) but never auto-pops.
 *
 * Previously each tour was gated by a plain boolean localStorage
 * flag — once dismissed, gone forever, but it also popped EVERY
 * visit on the first day until dismissed which felt aggressive for
 * a returning user who closed the browser without explicitly
 * dismissing. The structured payload below fixes both.
 */
export interface TutorialMeta {
  /** ISO date (YYYY-MM-DD) of the very first time we auto-shown the tour. */
  firstSeenAt: string
  /** How many times we've auto-shown the tour, capped at 2. */
  shownCount: number
}

const todayIso = () => new Date().toISOString().slice(0, 10)

const read = (key: string): TutorialMeta | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    // Legacy boolean flag — if the user already ran the tour under
    // the old code path, freeze them at shownCount=2 from a past
    // date so the new policy never re-auto-opens.
    if (raw === '1') return { firstSeenAt: '1970-01-01', shownCount: 2 }
    const parsed = JSON.parse(raw) as TutorialMeta
    if (typeof parsed.firstSeenAt === 'string' && typeof parsed.shownCount === 'number') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

const write = (key: string, meta: TutorialMeta) => {
  try { window.localStorage.setItem(key, JSON.stringify(meta)) } catch { /* quota — ignore */ }
}

/**
 * Should the tour auto-launch right now?
 *   • Never shown before  →  yes
 *   • First-day window AND shownCount < 2  →  yes
 *   • Otherwise  →  no
 */
export function shouldAutoShowTutorial(key: string): boolean {
  const meta = read(key)
  if (!meta) return true
  if (meta.shownCount >= 2) return false
  return meta.firstSeenAt === todayIso()
}

/**
 * Record an auto-launch. Increments the count and pins the first-day
 * date if this is the first run.
 */
export function recordTutorialShown(key: string) {
  const meta = read(key)
  const next: TutorialMeta = meta
    ? { ...meta, shownCount: Math.min(2, meta.shownCount + 1) }
    : { firstSeenAt: todayIso(), shownCount: 1 }
  write(key, next)
}
