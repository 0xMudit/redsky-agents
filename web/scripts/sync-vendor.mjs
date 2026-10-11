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

await rm(vendor, { recursive: true, force: true })

for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.error(`[sync-vendor] missing source directory: ${from}`)
    process.exit(1)
  }
  await mkdir(path.dirname(to), { recursive: true })
  await cp(from, to, { recursive: true })
}

console.log('[sync-vendor] vendored renderer/src and shared into web/vendor')
