import { build as esbuild } from 'esbuild'

// Electron 37 ships Node 22.x, so we can target node22 and get all modern
// JS features without any transpilation overhead. Both bundles are CJS
// (Electron's main process requirement), but tree-shaking still applies to
// the imported modules.

const sharedOptions = {
  bundle: true,
  logLevel: 'info',
  platform: 'node',
  format: 'cjs',
  // node22 = Node 22 LTS. Enables: top-level await, structuredClone, native
  // fetch, node:sqlite, crypto.randomUUID, etc. without polyfills.
  target: 'node22',
  external: ['electron'],
  // Tree-shake: drop unused exports so the bundle is as small as possible.
  treeShaking: true,
  // Inline small dependencies (<4 kB) directly rather than a separate chunk.
  // Reduces the number of require() calls on startup.
  splitting: false,
  // Keep names for readable stack traces without inflating bundle size.
  keepNames: true,
  // Source maps only when explicitly requested (e.g. for debugging a packaged build).
  sourcemap: process.env.REDSKY_SOURCEMAP === '1' ? 'external' : false,
  // Drop debug/trace console calls in production builds to save a tiny bit of
  // runtime overhead. Keep console.warn/error so problems are still visible.
  drop: process.env.NODE_ENV === 'production' ? ['debugger'] : [],
}

await Promise.all([
  esbuild({
    ...sharedOptions,
    entryPoints: ['electron/main.ts'],
    outfile: 'dist/main.js',
  }),
  esbuild({
    ...sharedOptions,
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist/preload.js',
  }),
])

console.log('main + preload built → dist/')
