"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RuntimeLanguage } from "@/config/runtime";

interface LanguageContextValue {
  currentLanguage: RuntimeLanguage;
  setCurrentLanguage: (language: RuntimeLanguage) => void;
  isDomesticVersion: boolean;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined,
);

export function LanguageProvider({
  children,
  defaultLanguage,
}: {
  children: ReactNode;
  defaultLanguage: RuntimeLanguage;
}) {
  const isDomesticVersion = defaultLanguage === "zh";
  const storageKey = `mornstudio-language-${defaultLanguage}`;
  const [currentLanguage, setCurrentLanguage] = useState<RuntimeLanguage>(
    defaultLanguage,
  );

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved === "zh" || saved === "en") {
      setCurrentLanguage(saved);
      return;
    }

    setCurrentLanguage(defaultLanguage);
  }, [defaultLanguage, storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, currentLanguage);
    document.documentElement.lang = currentLanguage;
    document.documentElement.setAttribute("data-default-language", defaultLanguage);
  }, [currentLanguage, defaultLanguage, storageKey]);

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
