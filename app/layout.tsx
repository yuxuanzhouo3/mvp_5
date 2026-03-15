import React from "react";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import {
  getServerRuntimeLanguage,
  isDomesticRuntimeLanguage,
} from "@/config/runtime";
import { LanguageProvider } from "@/context/LanguageContext";
import { getAppDisplayName } from "@/lib/app-branding";

const inter = Inter({ subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const appDisplayName = await getAppDisplayName();
  const defaultLanguage = getServerRuntimeLanguage();
  const isDomesticVersion = isDomesticRuntimeLanguage(defaultLanguage);

  return {
    title: isDomesticVersion
      ? `${appDisplayName} - ?????????`
      : `${appDisplayName} - Multimedia AI Creation Platform`,
    description: isDomesticVersion
      ? "????????????????"
      : "Unified platform for multimedia generation, editing and AI detection",
    keywords: isDomesticVersion
      ? `${appDisplayName}, AI??, AI??, ?????, ????, ????, ????, AI??`
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
      <body className={inter.className}>
        <LanguageProvider defaultLanguage={defaultLanguage}>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
