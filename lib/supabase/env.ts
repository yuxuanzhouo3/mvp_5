/**
 * 环境变量读取工具
 * 兼容不同部署平台和命名方式
 */

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value && value.trim() !== "") {
      return value;
    }
  }
  return undefined;
}

export function getSupabaseUrlFromEnv(): string | undefined {
  return firstNonEmpty(
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

export function getSupabaseAnonKeyFromEnv(): string | undefined {
  return firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_ANON_KEY,
  );
}

