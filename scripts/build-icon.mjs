// Generates two assets from a single authored source:
//
//   public/icon-app.png        — 512×512 PNG, soft cyan→white gradient
//                                tile behind the glyph. Used by the PWA
//                                manifest + Apple touch icon (anywhere
//                                an OS draws the icon on its own
//                                background — home screen, install
//                                prompt, splash).
//
//   public/icon-app-glyph.png  — 1024×1024 PNG, transparent background,
//                                glyph only. Used everywhere INSIDE the
//                                app (BrandMark in headers, Landing
//                                hero) so the mark sits on whatever
//                                surface it's rendered over.
//
// Source: public/icon-app-source.png — the authored glyph on a flat
// white background. The white surround is removed via a luminance-keyed
// alpha mask, then composited onto the gradient tile for the OS icon.

import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE     = resolve(__dirname, '..', 'public', 'icon-app-source.png')
const OUT_TILE   = resolve(__dirname, '..', 'public', 'icon-app.png')
const OUT_GLYPH  = resolve(__dirname, '..', 'public', 'icon-app-glyph.png')
const SIZE = 512
const RADIUS = 112

async function knockWhiteOut(inputBuffer) {
  // Each near-white pixel becomes fully transparent; coloured pixels
  // keep their RGB and gain an alpha proportional to how far they sit
  // from white. The smooth ramp preserves anti-aliasing on stroke
  // edges so the glyph doesn't fringe when composited on a coloured
  // background later.
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const minC = Math.min(r, g, b)
    // 255 → 0 alpha, 192 → fully opaque, with a smooth in-between.
    const alpha = Math.min(255, Math.max(0, (255 - minC) * 4))
    data[i + 3] = alpha
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer()
}

async function run() {
  // ── Glyph asset: transparent-bg PNG, 1024×1024 source preserved ──
  const sourceMeta = await sharp(SOURCE).metadata()
  const glyphSize = Math.max(sourceMeta.width ?? 1024, sourceMeta.height ?? 1024)
  const glyphSquare = await sharp(SOURCE)
    .resize(glyphSize, glyphSize, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .toBuffer()
  const glyphTransparent = await knockWhiteOut(glyphSquare)
  writeFileSync(OUT_GLYPH, glyphTransparent)
  console.log(`wrote ${OUT_GLYPH} (${glyphTransparent.length} bytes)`)

  // ── Tile asset: gradient rounded square + glyph centred on top ──
  const bgSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stop-color="#FFFFFF"/>
          <stop offset="55%" stop-color="#E6F7F8"/>
          <stop offset="100%" stop-color="#BEEBEE"/>
        </linearGradient>
      </defs>
      <rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="url(#g)"/>
    </svg>
  `
  const bg = await sharp(Buffer.from(bgSvg)).png().toBuffer()
  const inner = Math.round(SIZE * 0.82)
  const glyphForTile = await sharp(glyphTransparent)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  const offset = Math.round((SIZE - inner) / 2)
  const tile = await sharp(bg)
    .composite([{ input: glyphForTile, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(OUT_TILE, tile)
  console.log(`wrote ${OUT_TILE} (${tile.length} bytes)`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
