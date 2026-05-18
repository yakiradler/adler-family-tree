// One-shot script: bake a soft cyan→white gradient behind the
// authored InfiniTree glyph. The source asset (icon-app-source.png)
// ships with a flat white background, so we use a `multiply` blend
// — the math wipes white pixels out (white × bg = bg) while keeping
// the glyph's coloured strokes intact (colour × bg = darker colour).
// This sidesteps having to hand-craft an alpha mask and preserves
// the authored anti-aliasing.
//
// Outputs `public/icon-app.png` (512×512 rounded square, suitable for
// PWA manifest + Apple touch icon).

import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = resolve(__dirname, '..', 'public', 'icon-app-source.png')
const OUT    = resolve(__dirname, '..', 'public', 'icon-app.png')
const SIZE   = 512
const RADIUS = 112

async function run() {
  // 1) Gradient backdrop — soft diagonal cyan→white, rounded square.
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

  // 2) Resize the glyph to a comfortable inner size. fit:contain
  //    preserves aspect ratio; the extra space gets the same gradient
  //    treatment via `background` set to transparent so the multiply
  //    blend sees only the glyph + its white surround.
  const inner = Math.round(SIZE * 0.82)
  const glyphResized = await sharp(SOURCE)
    .resize(inner, inner, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .toBuffer()

  // 3) Composite with `multiply`: white surround vanishes against the
  //    gradient, coloured glyph rides on top with its hue preserved.
  const offset = Math.round((SIZE - inner) / 2)
  const composed = await sharp(bg)
    .composite([
      { input: glyphResized, top: offset, left: offset, blend: 'multiply' },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer()

  writeFileSync(OUT, composed)
  console.log(`wrote ${OUT} (${composed.length} bytes)`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
