import React from 'react'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'MornGPT - All-in-One AI Generator Platform',
  description: 'Generate text, images, audio, and video content with AI in one place. Professional, creative, and powerful content generation platform.',
  keywords: 'MornGPT, AI generator, content creation, text generation, image generation, audio generation, video generation',
  authors: [{ name: 'MornGPT Team' }],
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        {children}
      </body>
    </html>
  )
} 