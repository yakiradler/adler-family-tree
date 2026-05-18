/**
 * Export the family tree as a downloadable PNG image.
 *
 * Why client-side canvas: the tree is purely a DOM/SVG composition,
 * and the alternatives (html-to-image, html2canvas, dom-to-image)
 * are all heavy dependencies that would push the bundle past where
 * we want it. Re-drawing the layout into a canvas gives us:
 *   • zero new runtime deps;
 *   • predictable output regardless of font/zoom state;
 *   • a chance to bake in a tasteful title + frame.
 *
 * Quality knobs:
 *   • SCALE = 2 — output is rendered at 2× display pixels so it
 *     looks crisp on retina screens and prints cleanly at A4.
 *   • PNG via canvas.toBlob — preserves transparency-free output
 *     with lossless compression, perfect for WhatsApp / e-mail.
 *
 * Photo handling: the avatar circle is always filled with the
 * member's gender colour. If a photo URL is present we attempt to
 * load it cross-origin; success replaces the colour fill with the
 * actual photo. Failures (CORS, 404, blocked) silently fall back to
 * the colour fill so a single broken image never aborts the export.
 */

import type { Member } from '../types'
import type { LayoutNode } from '../components/views/treeLayout'
import { NODE_W, AVATAR } from '../components/views/treeLayout'

export interface ExportTreeOptions {
  nodes: LayoutNode[]
  lines: { d: string }[]
  spouseLines: { x1: number; x2: number; y: number }[]
  canvasW: number
  canvasH: number
  offsetX: number
  title?: string
  filename?: string
}

const SCALE = 2
const PAD = 80
const TITLE_H = 70

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  m: Member,
  x: number,
  y: number,
  photo: HTMLImageElement | null,
) {
  const cx = x + NODE_W / 2
  const cy = y + AVATAR / 2 + 4

  // Soft drop shadow for the card body. Stroked separately from the
  // fill so the shadow only paints once.
  ctx.save()
  ctx.shadowColor = 'rgba(28, 28, 30, 0.10)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2

  // Card frame — rounded rectangle behind the avatar + text. Width
  // matches NODE_W; height accommodates avatar + name + dates.
  const cardX = x + 4
  const cardY = y - 4
  const cardW = NODE_W - 8
  const cardH = AVATAR + 44
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, cardX, cardY, cardW, cardH, 12)
  ctx.fill()
  ctx.restore()

  // Avatar fill — gender-tinted ring + inner photo or solid fill.
  const ringGrad = ctx.createLinearGradient(
    cx - AVATAR / 2, cy - AVATAR / 2,
    cx + AVATAR / 2, cy + AVATAR / 2,
  )
  if (m.gender === 'female') {
    ringGrad.addColorStop(0, '#FF7AA8')
    ringGrad.addColorStop(1, '#FF375F')
  } else {
    ringGrad.addColorStop(0, '#3D8BFD')
    ringGrad.addColorStop(1, '#0A84FF')
  }
  ctx.fillStyle = ringGrad
  ctx.beginPath()
  ctx.arc(cx, cy, AVATAR / 2, 0, Math.PI * 2)
  ctx.fill()

  if (photo) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, AVATAR / 2 - 2, 0, Math.PI * 2)
    ctx.clip()
    // cover-fit the photo into the circle so portraits don't squish.
    const iw = photo.naturalWidth || photo.width
    const ih = photo.naturalHeight || photo.height
    const aspect = iw / ih
    let dw = AVATAR
    let dh = AVATAR
    if (aspect > 1) dw = AVATAR * aspect
    else dh = AVATAR / aspect
    ctx.drawImage(photo, cx - dw / 2, cy - dh / 2, dw, dh)
    ctx.restore()
  } else {
    // Initials inside the colour fill when there's no photo.
    const initials = [m.first_name?.[0], m.last_name?.[0]]
      .filter(Boolean)
      .join('')
      .toUpperCase()
    if (initials) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
      ctx.font = 'bold 16px system-ui, -apple-system, "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(initials, cx, cy)
    }
  }

  // Name — bold, single line, truncated by the card width.
  ctx.fillStyle = '#1C1C1E'
  ctx.font = 'bold 11px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()
  ctx.fillText(name, cx, cy + AVATAR / 2 + 4, NODE_W - 8)

  // Year range under the name.
  const by = m.birth_date ? new Date(m.birth_date).getFullYear() : null
  const dy = m.death_date ? new Date(m.death_date).getFullYear() : null
  const range = by ? (dy ? `${by}–${dy}` : `${by}`) : ''
  if (range) {
    ctx.fillStyle = '#8E8E93'
    ctx.font = '9px system-ui, -apple-system, "Segoe UI", sans-serif'
    ctx.fillText(range, cx, cy + AVATAR / 2 + 18)
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

export async function exportTreeAsPNG(opts: ExportTreeOptions): Promise<void> {
  const {
    nodes, lines, spouseLines,
    canvasW, canvasH, offsetX,
    title = 'InfiniTree',
    filename,
  } = opts

  const W = canvasW + PAD * 2
  const H = canvasH + PAD * 2 + TITLE_H

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(W * SCALE)
  canvas.height = Math.round(H * SCALE)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    // Extremely rare on modern browsers — but the user gets a
    // graceful failure instead of a silent no-op.
    throw new Error('Canvas 2D context unavailable')
  }
  ctx.scale(SCALE, SCALE)

  // Soft mesh background — picks up the in-app vibe without trying
  // to reproduce every radial-gradient blob.
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#F4F7FF')
  bg.addColorStop(0.55, '#FBF7FF')
  bg.addColorStop(1, '#FFF5FA')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Title bar across the top.
  ctx.fillStyle = '#1C1C1E'
  ctx.font = 'bold 26px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, W / 2, TITLE_H / 2 + 6)

  // Date sub-title.
  ctx.fillStyle = '#8E8E93'
  ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.fillText(
    new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    W / 2,
    TITLE_H - 12,
  )

  // Shift origin into the tree's coordinate space so the cached
  // layout positions (x, y) drop in unchanged.
  ctx.translate(PAD, TITLE_H + PAD)

  // Parent-child connectors — gradient stroke matching the live
  // tree's connector palette.
  ctx.lineWidth = 2.2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#5E5CE6'
  for (const line of lines) {
    try {
      const path = new Path2D(line.d)
      ctx.stroke(path)
    } catch {
      // Malformed path? Skip silently rather than abort the export.
    }
  }

  // Spouse lines — dashed accent.
  ctx.save()
  ctx.strokeStyle = '#FF5EAE'
  ctx.lineWidth = 1.8
  ctx.setLineDash([6, 5])
  for (const sp of spouseLines) {
    ctx.beginPath()
    ctx.moveTo(sp.x1, sp.y)
    ctx.lineTo(sp.x2, sp.y)
    ctx.stroke()
  }
  ctx.restore()

  // Load every photo in parallel BEFORE we start drawing cards.
  // Doing it serially per-card would be O(n) network round trips.
  const photoEntries = await Promise.all(
    nodes.map(async (n) => [
      n.member.id,
      n.member.photo_url ? await loadImage(n.member.photo_url) : null,
    ] as const),
  )
  const photos = new Map(photoEntries)

  for (const node of nodes) {
    const x = node.x + offsetX
    const y = node.y
    drawCard(ctx, node.member, x, y, photos.get(node.member.id) ?? null)
  }

  // Footer credit — tiny + grey, doesn't compete with the tree.
  ctx.translate(-PAD, -(TITLE_H + PAD))
  ctx.fillStyle = '#C7C7CC'
  ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('infinitree', W / 2, H - 14)

  // Trigger the download.
  await new Promise<void>((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve()
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || `adler-tree-${new Date().toISOString().slice(0, 10)}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Release after a tick so Safari has time to start the download
      // before we revoke the object URL out from under it.
      setTimeout(() => {
        URL.revokeObjectURL(url)
        resolve()
      }, 250)
    }, 'image/png')
  })
}

/**
 * Open the browser's print dialog. The @media print rules in
 * index.css hide the chrome (top bar, panels, mini-map, zoom
 * controls, etc.) so the printed page is just the tree canvas.
 * Users can pick "Save as PDF" from the print dialog to get a PDF.
 */
export function printTree(): void {
  window.print()
}
