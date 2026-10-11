/**
 * scripts/build-icons.mjs
 *
 * Generates all icon assets needed by electron-builder from docs/assets/logo.png.
 *
 * Outputs:
 *   build/icon.png     – 512×512 PNG  (Linux AppImage + builder source)
 *   build/icon.ico     – multi-size ICO containing 16/32/48/64/128/256 px (Windows)
 *   build/icon.icns    – macOS ICNS bundle containing standard icon set sizes
 *
 * Run:  node scripts/build-icons.mjs
 * This is also called by `npm run build:icons` and pre-dist hooks.
 *
 * Requires: sharp (devDependency)
 */

import sharp from 'sharp'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const src = path.join(root, 'docs', 'assets', 'logo.png')
const outDir = path.join(root, 'build')

if (!fs.existsSync(src)) {
  console.error('Source image not found:', src)
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })

// ── 1. icon.png (512×512) ──────────────────────────────────────────────────
const iconPng = path.join(outDir, 'icon.png')
await sharp(src).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(iconPng)
console.log('wrote build/icon.png')

// ── 2. icon.ico (Windows — multi-size ICO) ────────────────────────────────
// ICO format: header (6 bytes) + directory entries (16 bytes each) + image data
const ICO_SIZES = [16, 32, 48, 64, 128, 256]

async function makePngBuffer(size) {
  return sharp(src)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

const pngBuffers = await Promise.all(ICO_SIZES.map(makePngBuffer))

// Build ICO binary manually — each image stored as raw PNG inside the ICO
const HEADER_SIZE = 6
const DIR_ENTRY_SIZE = 16
const dirSize = HEADER_SIZE + ICO_SIZES.length * DIR_ENTRY_SIZE

// ICO header
const header = Buffer.alloc(HEADER_SIZE)
header.writeUInt16LE(0, 0)                  // reserved
header.writeUInt16LE(1, 2)                  // type: 1 = ICO
header.writeUInt16LE(ICO_SIZES.length, 4)   // image count

// Calculate offsets
const offsets = []
let dataOffset = dirSize
for (const buf of pngBuffers) {
  offsets.push(dataOffset)
  dataOffset += buf.length
}

// Build directory
const directory = Buffer.alloc(ICO_SIZES.length * DIR_ENTRY_SIZE)
for (let i = 0; i < ICO_SIZES.length; i++) {
  const size = ICO_SIZES[i]
  const buf = pngBuffers[i]
  const entry = i * DIR_ENTRY_SIZE
  directory.writeUInt8(size >= 256 ? 0 : size, entry)       // width (0 = 256)
  directory.writeUInt8(size >= 256 ? 0 : size, entry + 1)   // height
  directory.writeUInt8(0, entry + 2)                         // color count
  directory.writeUInt8(0, entry + 3)                         // reserved
  directory.writeUInt16LE(1, entry + 4)                      // color planes
  directory.writeUInt16LE(32, entry + 6)                     // bits per pixel
  directory.writeUInt32LE(buf.length, entry + 8)             // size of image data
  directory.writeUInt32LE(offsets[i], entry + 12)            // offset to image data
}

const icoPath = path.join(outDir, 'icon.ico')
fs.writeFileSync(icoPath, Buffer.concat([header, directory, ...pngBuffers]))
console.log('wrote build/icon.ico')

// ── 3. icon.icns (macOS) ──────────────────────────────────────────────────
// ICNS format: 4-byte magic + 4-byte total length + concatenated icon chunks
// Each chunk: 4-byte OSType + 4-byte chunk length (including header) + data

// Standard ICNS OSTypes (PNG-compressed, supported on macOS 10.7+)
const ICNS_TYPES = [
  { osType: 'icp4', size: 16 },
  { osType: 'icp5', size: 32 },
  { osType: 'icp6', size: 64 },
  { osType: 'ic07', size: 128 },
  { osType: 'ic08', size: 256 },
  { osType: 'ic09', size: 512 },
  { osType: 'ic10', size: 1024 },
]

async function makeIcnsChunk({ osType, size }) {
  const imgBuf = await sharp(src)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const header = Buffer.alloc(8)
  header.write(osType, 0, 'ascii')
  header.writeUInt32BE(imgBuf.length + 8, 4)
  return Buffer.concat([header, imgBuf])
}

const icnsChunks = await Promise.all(ICNS_TYPES.map(makeIcnsChunk))
const icnsBody = Buffer.concat(icnsChunks)
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns', 0, 'ascii')
icnsHeader.writeUInt32BE(icnsBody.length + 8, 4)
const icnsPath = path.join(outDir, 'icon.icns')
fs.writeFileSync(icnsPath, Buffer.concat([icnsHeader, icnsBody]))
console.log('wrote build/icon.icns')

console.log('\nAll icons generated successfully in build/')
