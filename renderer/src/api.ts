import type { RedSkyApi } from './types'
import { createDemoApi } from './demoApi'

// The bridge is `window.redsky` — provided by the Electron preload in the
// desktop app, or injected by the web build (web/lib/webApi.ts) before this
// module loads. In a plain browser tab with neither, fall back to the in-memory
// demo so the UI still renders with fixtures.
export const api: RedSkyApi = window.redsky ?? createDemoApi()

export type { ReviewMode } from './types'
