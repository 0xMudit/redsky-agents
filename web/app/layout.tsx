import type { Metadata } from 'next'
import './globals.css'

// Resolve the canonical site URL so OpenGraph/Twitter images have an absolute
// base. Prefers an explicit public URL, then Vercel's own host, then localhost.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Red Sky · AI Teammates',
  description:
    'Grok Bot–style local AI teammates that run entirely on your machine. Powered by OpenCode.',
  openGraph: {
    type: 'website',
    title: 'Red Sky · AI Teammates',
    description: 'Grok Bot–style local AI teammates that run entirely on your machine.',
    images: ['/icon.png'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
