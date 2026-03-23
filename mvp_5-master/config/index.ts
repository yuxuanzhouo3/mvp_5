import {
  getServerRuntimeLanguage,
  isDomesticRuntimeLanguage,
} from "@/config/runtime";

export const DEFAULT_LANGUAGE = getServerRuntimeLanguage();
export const IS_DOMESTIC_VERSION = isDomesticRuntimeLanguage(DEFAULT_LANGUAGE);

export const APP_CONFIG = {
  name: "MornStudio",
  description: IS_DOMESTIC_VERSION
    ? "????????????????"
    : "Unified platform for multimedia generation, editing and AI detection",
  url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
};

export const DATABASE_CONFIG = {
  domestic: {
    provider: "cloudbase",
    apiBaseUrl: "/api/domestic",
    envId: process.env.CLOUDBASE_ENV_ID || "",
  },
  international: {
    provider: "supabase",
    apiBaseUrl: "/api/international",
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  },
};

export const getCurrentDatabaseConfig = () => {
  return IS_DOMESTIC_VERSION ? DATABASE_CONFIG.domestic : DATABASE_CONFIG.international;
};
