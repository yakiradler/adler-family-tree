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

// ─── Tree icon uploads (tree-icons storage bucket) ───────────────────
// Icons render at 60px, so a 256px centred square is plenty — keeps
// the bucket tiny at thousands of trees.

export const ICON_MAX_DIM = 256

export interface IconBlob {
  blob: Blob
  contentType: string
  ext: string
}

/** Storage object path: `<treeId>/icon-<ts>.<ext>`. The tree id as the
 *  FIRST path segment is the storage-RLS ownership anchor
 *  (split_part(name,'/',1), migration 014). Pure, unit-tested. */
export function iconStoragePath(treeId: string, ext: string, ts: number): string {
  return `${treeId}/icon-${ts}.${ext.replace(/^\./, '')}`
}

/**
 * Downscale to a centred square crop and encode as webp, falling back
 * to jpeg (Safari's canvas silently returns png when asked for webp,
 * which would triple the size). Uses the same FileReader+Image decode
 * path as fileToDownscaledDataURL above — createImageBitmap is missing
 * on older iOS Safari.
 */
/** Storage object path for a member photo: `<treeId>/p-<rand>-<ts>.<ext>`.
 *  The tree id as the FIRST path segment is the storage-RLS ownership
 *  anchor (split_part(name,'/',1), migration 018) — write access mirrors
 *  tree write access. `rand` keeps concurrent uploads from colliding.
 *  Pure + unit-tested. */
export function photoStoragePath(treeId: string, ext: string, ts: number, rand: string): string {
  return `${treeId}/p-${rand}-${ts}.${ext.replace(/^\./, '')}`
}

/**
 * Downscale a photo (aspect-ratio preserved, max 1280px long edge) and
 * encode as webp, falling back to jpeg (Safari's canvas silently returns
 * png for webp, which would balloon the size). Returns a Blob for direct
 * Storage upload — the persistent counterpart to fileToDownscaledDataURL,
 * which is only for inline/demo fallback. Same FileReader+Image decode
 * path (createImageBitmap is missing on older iOS Safari).
 */
export async function fileToPhotoBlob(file: File, maxDim: number = MAX_DIMENSION): Promise<IconBlob> {
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

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  const tryEncode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))

  let blob = await tryEncode('image/webp', JPEG_QUALITY)
  if (!blob || blob.type !== 'image/webp') {
    blob = await tryEncode('image/jpeg', JPEG_QUALITY)
    if (!blob) throw new Error('image encode failed')
    return { blob, contentType: 'image/jpeg', ext: 'jpg' }
  }
  return { blob, contentType: 'image/webp', ext: 'webp' }
}

export async function fileToIconBlob(file: File, maxDim: number = ICON_MAX_DIM): Promise<IconBlob> {
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

  const side = Math.min(img.width, img.height)
  const target = Math.min(maxDim, side)
  const canvas = document.createElement('canvas')
  canvas.width = target
  canvas.height = target
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, target, target)
  // Centred square crop, scaled down.
  const sx = (img.width - side) / 2
  const sy = (img.height - side) / 2
  ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target)

  const tryEncode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))

  let blob = await tryEncode('image/webp', 0.85)
  if (!blob || blob.type !== 'image/webp') {
    blob = await tryEncode('image/jpeg', 0.85)
    if (!blob) throw new Error('image encode failed')
    return { blob, contentType: 'image/jpeg', ext: 'jpg' }
  }
  return { blob, contentType: 'image/webp', ext: 'webp' }
}
