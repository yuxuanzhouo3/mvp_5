/**
 * 统一的时间格式化工具
 * 国内版（zh）显示 UTC+8 北京时间
 * 国际版（en）显示用户本地时区
 */

const IS_DOMESTIC = (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "zh").toLowerCase().startsWith("zh");

/**
 * 格式化日期时间
 * @param dateStr ISO 8601 格式的日期字符串
 * @returns 格式化后的日期时间字符串
 */
export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return "-";

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "-";

  if (IS_DOMESTIC) {
    // 国内版：显示 UTC+8 北京时间
    return date.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } else {
    // 国际版：显示用户本地时区
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
}

/**
 * 格式化日期（不含时间）
 */
export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "-";

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "-";

  if (IS_DOMESTIC) {
    return date.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } else {
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
}
