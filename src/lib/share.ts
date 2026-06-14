/**
 * One-tap sharing. Uses the device's native share sheet (Web Share API)
 * so a phone user can send a link straight into WhatsApp / Messages /
 * Mail — the channel an Israeli family actually uses — instead of the old
 * "copied to clipboard, now go find the app and paste" dance. Falls back
 * to clipboard on desktop / unsupported browsers.
 *
 * Returns what happened so the caller can show the right feedback:
 *   'shared'  — native sheet handled it (or the user cancelled it)
 *   'copied'  — fell back to clipboard
 *   'failed'  — neither worked (caller should show the raw URL)
 */
export type ShareResult = 'shared' | 'copied' | 'failed'

export async function shareOrCopy(opts: {
  url: string
  title?: string
  text?: string
}): Promise<ShareResult> {
  const { url, title, text } = opts

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch (e) {
      // User dismissed the sheet — that's a deliberate no-op, not an error,
      // so don't fall through to clipboard (which would feel like a glitch).
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared'
      // Any other failure (e.g. activation lost on strict iOS) → clipboard.
    }
  }

  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
