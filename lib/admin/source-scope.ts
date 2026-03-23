import { getServerRuntimeLanguage } from "@/config/runtime";

export type AdminSourceScope = "cn" | "global";

export function getAdminSourceScope(): AdminSourceScope {
  const language = getServerRuntimeLanguage();
  return language.startsWith("zh") ? "cn" : "global";
}

export function getAdminSourceLabel(source: AdminSourceScope) {
  return source === "cn" ? "???" : "???";
}

export function normalizeSource(value: string | null | undefined): AdminSourceScope {
  return value === "cn" ? "cn" : "global";
}
