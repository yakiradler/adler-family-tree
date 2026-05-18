// Generates two assets from the authored InfiniTree glyph:
//
//   public/icon-app.png        — 512×512 PNG, soft cyan→white gradient
//                                tile behind the glyph. Used by the PWA
//                                manifest + Apple touch icon.
//
//   public/icon-app-glyph.png  — square PNG, TRUE TRANSPARENT
//                                background, glyph only. Used in the
//                                Landing hero so the mark floats over
//                                the page background with no card
//                                around it.
//
// Approach: build an alpha mask (white where the glyph is, black
// elsewhere) and apply it to the source via sharp's `composite` with
// `dest-in` blend mode — anywhere the mask is opaque, the source
// shows; anywhere the mask is transparent, the destination becomes
// transparent. This is sharp's canonical pattern for white-knockout
// and produces a real RGBA PNG (the previous `joinChannel` route
// silently dropped the 4th channel on the way to PNG encoding).

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

async function buildTransparentGlyph() {
  // Build the alpha mask: invert the source so white→black/dark→bright,
  // collapse to single-channel grayscale, then boost contrast so anti-
  // aliased strokes carry partial alpha rather than going fully clear.
  // Final mask is opaque (white) where the glyph is, transparent
  // (black) where the source was white background.
  const mask = await sharp(SOURCE)
    .removeAlpha()
    .negate()
    .grayscale()
    .linear(1.8, 0)
    .toColorspace('b-w')
    .toBuffer()

  // Apply the mask via `dest-in`: keep destination (= glyph colours)
  // only where the mask is opaque. Result is the glyph with a real
  // alpha channel and a clean transparent surround.
  return sharp(SOURCE)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function buildGradientTile(glyphBuffer) {
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
  const glyphForTile = await sharp(glyphBuffer)
    .resize(inner, inner, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer()
  const offset = Math.round((SIZE - inner) / 2)
  return sharp(bg)
    .composite([{ input: glyphForTile, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function run() {
  const glyph = await buildTransparentGlyph()
  writeFileSync(OUT_GLYPH, glyph)
  const tile = await buildGradientTile(glyph)
  writeFileSync(OUT_TILE, tile)

  // Sanity-check the glyph really did come out with alpha. Earlier
  // attempts silently produced 3-channel RGB which rendered as a
  // solid black surround in the browser; failing loudly here keeps
  // that regression from sneaking back.
  const meta = await sharp(OUT_GLYPH).metadata()
  if (!meta.hasAlpha || meta.channels !== 4) {
    throw new Error(`icon-app-glyph.png missing alpha channel (channels=${meta.channels}, hasAlpha=${meta.hasAlpha})`)
  }

  console.log(`wrote ${OUT_GLYPH} (${glyph.length} bytes, ${meta.channels}-channel, hasAlpha=${meta.hasAlpha})`)
  console.log(`wrote ${OUT_TILE}  (${tile.length} bytes)`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
