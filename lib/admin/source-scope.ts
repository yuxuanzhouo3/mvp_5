export type AdminSourceScope = "cn" | "global";

export function getAdminSourceScope(): AdminSourceScope {
  const language = (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "en")
    .trim()
    .toLowerCase();

  if (language.startsWith("zh")) {
    return "cn";
  }
  return "global";
}

export function getAdminSourceLabel(source: AdminSourceScope) {
  return source === "cn" ? "国内版" : "国际版";
}

export function normalizeSource(value: string | null | undefined): AdminSourceScope {
  return value === "cn" ? "cn" : "global";
}

