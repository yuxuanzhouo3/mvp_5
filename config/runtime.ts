export type RuntimeLanguage = "zh" | "en";

const DEFAULT_RUNTIME_LANGUAGE: RuntimeLanguage = "zh";

function normalizeLanguage(value: unknown): RuntimeLanguage {
  if (typeof value !== "string") {
    return DEFAULT_RUNTIME_LANGUAGE;
  }

  return value.trim().toLowerCase().startsWith("en") ? "en" : "zh";
}

function readProcessLanguageEnv() {
  if (typeof process === "undefined" || !process.env) {
    return undefined;
  }

  return (
    process.env["APP_DEFAULT_LANGUAGE"] ||
    process.env["DEFAULT_LANGUAGE"] ||
    process.env["NEXT_PUBLIC_DEFAULT_LANGUAGE"]
  );
}

export function getServerRuntimeLanguage(): RuntimeLanguage {
  return normalizeLanguage(readProcessLanguageEnv());
}

export function getClientRuntimeLanguage(): RuntimeLanguage {
  if (typeof document !== "undefined") {
    const rootLanguage =
      document.documentElement.getAttribute("data-default-language") ||
      document.documentElement.lang;

    if (rootLanguage) {
      return normalizeLanguage(rootLanguage);
    }
  }

  return normalizeLanguage(readProcessLanguageEnv());
}

export function getRuntimeLanguage(): RuntimeLanguage {
  return typeof window === "undefined"
    ? getServerRuntimeLanguage()
    : getClientRuntimeLanguage();
}

export function isDomesticRuntimeLanguage(
  language: RuntimeLanguage = getRuntimeLanguage(),
) {
  return language === "zh";
}
