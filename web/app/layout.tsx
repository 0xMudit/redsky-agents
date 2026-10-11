import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
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
