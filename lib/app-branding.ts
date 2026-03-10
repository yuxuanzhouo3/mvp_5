import "server-only";

import { APP_CONFIG } from "@/config";
import { getRoutedRuntimeDbClient } from "@/lib/server/database-routing";

export const APP_DISPLAY_NAME_SETTING_KEY = "app_display_name";
export const APP_DISPLAY_NAME_MAX_LENGTH = 64;
export const APP_DISPLAY_NAME_FALLBACK = APP_CONFIG.name;

export function normalizeDisplayName(input: unknown) {
  if (typeof input !== "string") {
    return "";
  }

  return input.replace(/\s+/g, " ").trim();
}

export function resolveDisplayName(input: unknown) {
  const normalized = normalizeDisplayName(input);
  if (!normalized) {
    return APP_DISPLAY_NAME_FALLBACK;
  }
  return normalized.slice(0, APP_DISPLAY_NAME_MAX_LENGTH);
}

export async function getAppDisplayName() {
  const db = await getRoutedRuntimeDbClient();
  if (!db) {
    return APP_DISPLAY_NAME_FALLBACK;
  }

  const { data, error } = await db
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", APP_DISPLAY_NAME_SETTING_KEY)
    .maybeSingle();

  if (error) {
    return APP_DISPLAY_NAME_FALLBACK;
  }

  return resolveDisplayName(data?.setting_value);
}
