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
  },
  server: { port: 5173, strictPort: true },
})