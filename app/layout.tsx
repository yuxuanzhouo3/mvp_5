import React from 'react'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { DEFAULT_LANGUAGE, IS_DOMESTIC_VERSION, APP_CONFIG } from '@/config'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: IS_DOMESTIC_VERSION ? 'MornGPT - 全能AI内容生成平台' : 'MornGPT - All-in-One AI Generator Platform',
  description: APP_CONFIG.description,
  keywords: IS_DOMESTIC_VERSION
    ? 'MornGPT, AI生成器, 内容创作, 文本生成, 图像生成, 音频生成, 视频生成'
    : 'MornGPT, AI generator, content creation, text generation, image generation, audio generation, video generation',
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
    <html lang={DEFAULT_LANGUAGE} className="dark">
      <body className={inter.className}>
        {children}
      </body>
    </html>
  )
}
