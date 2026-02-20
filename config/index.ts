// 读取和规范化环境变量
const envDefaultLang = (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "zh").toLowerCase();
export const DEFAULT_LANGUAGE: string = envDefaultLang === "en" ? "en" : "zh";

// 版本标识
export const IS_DOMESTIC_VERSION = DEFAULT_LANGUAGE === "zh";

// 应用配置
export const APP_CONFIG = {
  name: "MornStudio",
  description: IS_DOMESTIC_VERSION
    ? "多媒体生成、编辑与检测一体化平台"
    : "Unified platform for multimedia generation, editing and AI detection",
  url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
};

// 数据库配置 - 国内外版本隔离
export const DATABASE_CONFIG = {
  domestic: {
    // 国内版本使用 CloudBase (腾讯云开发)
    provider: "cloudbase",
    apiBaseUrl: "/api/domestic",
    // CloudBase 配置将在实际使用时从环境变量读取
    envId: process.env.CLOUDBASE_ENV_ID || "",
  },
  international: {
    // 国际版本使用 Supabase
    provider: "supabase",
    apiBaseUrl: "/api/international",
    // Supabase 配置将在实际使用时从环境变量读取
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  },
};

// 获取当前数据库配置
export const getCurrentDatabaseConfig = () => {
  return IS_DOMESTIC_VERSION ? DATABASE_CONFIG.domestic : DATABASE_CONFIG.international;
};
