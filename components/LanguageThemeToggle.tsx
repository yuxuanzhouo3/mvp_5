"use client";

import React from "react";
import type { UILanguage } from "@/lib/ui-text";

interface LanguageThemeToggleProps {
  currentLanguage: UILanguage;
  setCurrentLanguage: (language: UILanguage) => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  languageSwitchToEn: string;
  languageSwitchToZh: string;
  switchToLight: string;
  switchToDark: string;
}

const iconBaseClass = "h-4 w-4 text-gray-900 dark:text-[#ececf1]";

const LanguageThemeToggle: React.FC<LanguageThemeToggleProps> = ({
  currentLanguage,
  setCurrentLanguage,
  isDarkMode,
  toggleTheme,
  languageSwitchToEn,
  languageSwitchToZh,
  switchToLight,
  switchToDark,
}) => {
  return (
    <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#565869]/50 rounded-md p-1">
      <button
        type="button"
        onClick={() =>
          setCurrentLanguage(currentLanguage === "zh" ? "en" : "zh")
        }
        className="h-7 w-7 rounded text-[10px] font-semibold text-gray-900 dark:text-[#ececf1] hover:bg-white dark:hover:bg-[#40414f] transition-colors"
        title={currentLanguage === "zh" ? languageSwitchToEn : languageSwitchToZh}
        aria-label={
          currentLanguage === "zh" ? languageSwitchToEn : languageSwitchToZh
        }
      >
        {currentLanguage === "zh" ? "EN" : "中"}
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        className="h-7 w-7 rounded flex items-center justify-center hover:bg-white dark:hover:bg-[#40414f] transition-colors"
        title={isDarkMode ? switchToLight : switchToDark}
        aria-label={isDarkMode ? switchToLight : switchToDark}
      >
        {isDarkMode ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={iconBaseClass}
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={iconBaseClass}
          >
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
          </svg>
        )}
      </button>
    </div>
  );
};

export default LanguageThemeToggle;

