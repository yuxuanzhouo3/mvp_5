import React from "react";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { DEFAULT_LANGUAGE, IS_DOMESTIC_VERSION, APP_CONFIG } from "@/config";
import { LanguageProvider } from "@/context/LanguageContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: IS_DOMESTIC_VERSION
    ? `${APP_CONFIG.name} - 多媒体生成编辑平台`
    : `${APP_CONFIG.name} - Multimedia AI Creation Platform`,
  description: APP_CONFIG.description,
  keywords: IS_DOMESTIC_VERSION
    ? "MornStudio, AI生成, AI编辑, 多媒体创作, 图片生成, 视频生成, 文件生成, AI检测"
    : "MornStudio, AI creation, AI editing, multimedia generation, image, video, document, detection",
  authors: [{ name: "MornStudio Team" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang={DEFAULT_LANGUAGE}>
      <body className={inter.className}>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
