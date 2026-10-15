import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'renderer',
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./renderer/src', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
    // Target the Chromium version that ships with Electron 37 (Chrome 130).
    // This unlocks modern JS features (top-level await, import.meta, etc.)
    // and lets esbuild skip transpiling down to older targets.
    target: ['chrome130', 'es2023'],
    // Inline assets smaller than 8 kB (reduces HTTP round-trips for small icons).
    assetsInlineLimit: 8192,
    // Raise the default 500 kB warning threshold — Electron bundles are local,
    // so the network cost that drove that limit does not apply here.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Manual chunk splitting: keep vendor libraries in separate chunks so
        // app code re-hashes independently of library updates. Also prevents
        // Vite from bundling everything into one giant chunk that takes longer
        // to parse on startup.
        manualChunks(id) {
          // React + React-DOM: most-used, change rarely.
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react'
          }
          // Radix primitives: large but stable.
          if (id.includes('@radix-ui')) {
            return 'vendor-radix'
          }
          // Ionicons: icon font + web component, rarely changes.
          if (id.includes('ionicons')) {
            return 'vendor-ionicons'
          }
          // @fontsource: font CSS + woff2, large, never changes.
          if (id.includes('@fontsource')) {
            return 'vendor-fonts'
          }
          // marked + dompurify: markdown rendering.
          if (id.includes('marked') || id.includes('dompurify')) {
            return 'vendor-markdown'
          }
          // lucide-react: icon library.
          if (id.includes('lucide-react')) {
            return 'vendor-lucide'
          }
        },
      },
    },
    // Enable source maps only for production builds where you need debug info.
    // For dev builds (npm start) this is irrelevant, but for dist builds it
    // avoids generating huge .map files that slow the build.
    sourcemap: process.env.REDSKY_SOURCEMAP === '1',
    // CSS code splitting: each async chunk gets its own CSS file, reducing
    // the initial CSS parse cost for code not yet needed.
    cssCodeSplit: true,
    // Minify with esbuild (faster than terser, good enough for Electron).
    minify: 'esbuild',
  },
  server: { port: 5173, strictPort: true },
})
