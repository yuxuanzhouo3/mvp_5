import React from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import {
  getServerRuntimeLanguage,
  isDomesticRuntimeLanguage,
} from "@/config/runtime";
import { LanguageProvider } from "@/context/LanguageContext";
import { getAppDisplayName } from "@/lib/app-branding";

export async function generateMetadata(): Promise<Metadata> {
  const appDisplayName = await getAppDisplayName();
  const defaultLanguage = getServerRuntimeLanguage();
  const isDomesticVersion = isDomesticRuntimeLanguage(defaultLanguage);

  return {
    title: isDomesticVersion
      ? `${appDisplayName} - 多媒体AI创作平台`
      : `${appDisplayName} - Multimedia AI Creation Platform`,
    description: isDomesticVersion
      ? "统一的多媒体生成、编辑与AI检测平台"
      : "Unified platform for multimedia generation, editing and AI detection",
    keywords: isDomesticVersion
      ? `${appDisplayName}, AI生成, AI编辑, 多媒体生成, 图片, 视频, 文档, AI检测`
      : `${appDisplayName}, AI creation, AI editing, multimedia generation, image, video, document, detection`,
    authors: [{ name: `${appDisplayName} Team` }],
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const defaultLanguage = getServerRuntimeLanguage();

  return (
    <html lang={defaultLanguage} data-default-language={defaultLanguage}>
      <body>
        <LanguageProvider defaultLanguage={defaultLanguage}>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
