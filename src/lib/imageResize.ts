/**
 * Downscale + re-encode an image File to a JPEG data URL that fits
 * comfortably in localStorage.
 *
 * Why: notes are persisted as part of the ft-state-v3 payload, which
 * has the usual ~5 MB browser quota. A raw phone photo is 3-6 MB
 * before base64 inflation. Downscaling to MAX_DIMENSION + re-encoding
 * at JPEG_QUALITY brings the typical attachment down to ~80-200 KB,
 * which means a user can post a few dozen attachments without
 * blowing the quota.
 *
 * The original aspect ratio is preserved. We never UPSCALE — small
 * images come through unchanged in dimensions (still re-encoded so
 * we get a consistent JPEG output regardless of the input format).
 */

const MAX_DIMENSION = 1280
const JPEG_QUALITY = 0.82

export async function fileToDownscaledDataURL(file: File): Promise<string> {
  // FileReader → dataURL is the only way to get the bytes into an
  // <img> without going through a network round trip. createImageBitmap
  // would be slightly faster but is missing on older iOS Safari, and
  // the perf delta isn't worth the polyfill surface area.
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'))
    r.readAsDataURL(file)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Image decode failed'))
    i.src = raw
  })

  const { width: w0, height: h0 } = img
  const scale = Math.min(1, MAX_DIMENSION / Math.max(w0, h0))
  const w = Math.round(w0 * scale)
  const h = Math.round(h0 * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  // White background so transparent PNGs encode predictably as JPEG.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}
