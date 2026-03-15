"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_LANGUAGE } from "@/config";

type UILanguage = "zh" | "en";

interface LanguageContextValue {
  currentLanguage: UILanguage;
  setCurrentLanguage: (language: UILanguage) => void;
  isDomesticVersion: boolean;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined,
);

function resolvePreferredLanguage(): UILanguage {
  return DEFAULT_LANGUAGE === "en" ? "en" : "zh";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const preferredLanguage = resolvePreferredLanguage();
  const isDomesticVersion = preferredLanguage === "zh";
  const storageKey = `mornstudio-language-${preferredLanguage}`;
  const [currentLanguage, setCurrentLanguage] = useState<UILanguage>(
    preferredLanguage,
  );

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved === "zh" || saved === "en") {
      setCurrentLanguage(saved);
      return;
    }

    setCurrentLanguage(preferredLanguage);
  }, [preferredLanguage, storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, currentLanguage);
    document.documentElement.lang = currentLanguage;
  }, [currentLanguage, storageKey]);

  const value = useMemo(
    () => ({ currentLanguage, setCurrentLanguage, isDomesticVersion }),
    [currentLanguage, isDomesticVersion],
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}

