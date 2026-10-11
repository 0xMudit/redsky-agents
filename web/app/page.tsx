'use client'

import dynamic from 'next/dynamic'
import { createWebApi } from '@/lib/webApi'

// The renderer resolves its bridge as `window.redsky` at module load. The web
// build injects a Groq-backed adapter (which reuses the in-memory demo for
// everything else) *before* the renderer module is evaluated.
if (typeof window !== 'undefined' && !window.redsky) {
  window.redsky = createWebApi()
}

// Loading the renderer client-only with ssr:false keeps its browser-only code
// (window access, DOMPurify, …) off the server.
const App = dynamic(() => import('@renderer/App'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--substrate)',
        color: 'var(--text-tertiary)',
        fontSize: 13,
      }}
    >
      Starting Red Sky…
    </div>
  ),
})

export default function Page(): React.JSX.Element {
  return <App />
}
