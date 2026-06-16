import type { StatusMedia } from './photoUpload'

/**
 * Save a feed status's attached media to the user's device. Fetches each
 * URL as a blob and triggers an anchor download (so the browser saves it
 * instead of navigating). Data URLs (demo mode) download directly without
 * a fetch. Best-effort: a single failed item doesn't abort the rest.
 */
export async function downloadStatusMedia(media: StatusMedia[]): Promise<void> {
  for (let i = 0; i < media.length; i++) {
    const m = media[i]
    try {
      await downloadOne(m, i)
    } catch (err) {
      console.warn('[downloadStatusMedia] failed for', m.url, err)
    }
  }
}

async function downloadOne(m: StatusMedia, index: number): Promise<void> {
  const ext = m.type === 'video' ? 'mp4' : 'jpg'
  const name = `infinitree-${Date.now()}-${index + 1}.${ext}`

  // Data URLs (demo / inline) can be downloaded as-is.
  let href = m.url
  let revoke = false
  if (!m.url.startsWith('data:')) {
    const res = await fetch(m.url)
    const blob = await res.blob()
    href = URL.createObjectURL(blob)
    revoke = true
  }

  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 4000)
}
