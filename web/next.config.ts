import type { NextConfig } from 'next'

// Pin the workspace root to this app so the sibling repo-root lockfile is not
// mistaken for it. Everything this app builds lives under web/ (see
// scripts/sync-vendor.mjs, which vendor-copies the shared UI in before build).
const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
