import { cp, rm, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Vendor the shared UI source (renderer/src) and shared types/helpers into
// web/vendor so this app is self-contained at build time. Keeping the copies
// generated (and gitignored) means ../renderer/src stays the single source of
// truth, while avoiding Node's ancestor-only module resolution problems for
// the sibling web/node_modules.

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '..')
const repoRoot = path.resolve(webRoot, '..')
const vendor = path.join(webRoot, 'vendor')

const copies = [
  [path.join(repoRoot, 'renderer', 'src'), path.join(vendor, 'renderer', 'src')],
  [path.join(repoRoot, 'shared'), path.join(vendor, 'shared')],
]

const missing = copies.filter(([from]) => !existsSync(from))

// The desktop sources live one level up in the repo. A Vercel CLI deploy
// uploads only web/, so on the build machine those paths don't exist — keep the
// vendored copy that was uploaded instead (it matches ../renderer/src at build
// time). Normal local and git-based builds still re-sync from source.
if (missing.length) {
  if (existsSync(vendor) && existsSync(path.join(vendor, 'renderer', 'src'))) {
    console.warn(`[sync-vendor] sources not found (${missing.map(([from]) => from).join(', ')}); keeping uploaded vendor copy`)
    process.exit(0)
  }
  console.error(`[sync-vendor] missing source directory: ${missing[0][0]}`)
  process.exit(1)
}

await rm(vendor, { recursive: true, force: true })

for (const [from, to] of copies) {
  await mkdir(path.dirname(to), { recursive: true })
  await cp(from, to, { recursive: true })
}

console.log('[sync-vendor] vendored renderer/src and shared into web/vendor')
