import { isDomesticRuntimeLanguage } from "@/config/runtime";

/**
 * ??????????
 * ????zh??? UTC+8 ????
 * ????en?????????
 */

function isDomesticDateFormat() {
  return isDomesticRuntimeLanguage();
}

export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return "-";

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "-";

  if (isDomesticDateFormat()) {
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
  }

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

export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "-";

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "-";

  if (isDomesticDateFormat()) {
    return date.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
