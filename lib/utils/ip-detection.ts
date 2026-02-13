/**
 * IP 地理位置检测与国家分类库
 */

// 区域类型枚举
export enum RegionType {
  CHINA = "china",
  USA = "usa",
  EUROPE = "europe",
  INDIA = "india",
  SINGAPORE = "singapore",
  OTHER = "other",
}

// 地理检测结果接口
export interface GeoResult {
  region: RegionType;
  countryCode: string;
  currency: string;
  paymentMethods: string[];
  authMethods: string[];
}

// 欧洲国家代码列表（EU + EEA + UK + CH）
export const EUROPEAN_COUNTRIES = [
  // EU 成员国 (27个)
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EEA 非 EU 成员
  "IS", "LI", "NO",
  // 英国（脱欧后仍需遵守部分GDPR）
  "GB",
  // 欧盟未知时返回 EU 代码的兼容
  "EU",
  // 瑞士（虽非EU但数据保护法类似）
  "CH",
];

// 主流市场国家
export const TARGET_MARKETS = {
  CHINA: "CN",
  USA: "US",
  INDIA: "IN",
  SINGAPORE: "SG",
};

/**
 * 根据国家代码获取区域分类
 */
export function getRegionFromCountryCode(countryCode: string): RegionType {
  const code = (countryCode || "").toUpperCase();
  if (code === TARGET_MARKETS.CHINA) return RegionType.CHINA;
  if (code === TARGET_MARKETS.USA) return RegionType.USA;
  if (code === TARGET_MARKETS.INDIA) return RegionType.INDIA;
  if (code === TARGET_MARKETS.SINGAPORE) return RegionType.SINGAPORE;
  if (EUROPEAN_COUNTRIES.includes(code)) return RegionType.EUROPE;
  return RegionType.OTHER;
}

/**
 * 根据区域获取货币
 */
export function getCurrencyByRegion(region: RegionType): string {
  switch (region) {
    case RegionType.CHINA: return "CNY";
    case RegionType.USA: return "USD";
    case RegionType.INDIA: return "INR";
    case RegionType.SINGAPORE: return "SGD";
    case RegionType.EUROPE: return "EUR";
    default: return "USD";
  }
}

/**
 * 根据区域获取支付方式
 */
export function getPaymentMethodsByRegion(region: RegionType): string[] {
  switch (region) {
    case RegionType.CHINA:
      return ["wechat", "alipay"];
    case RegionType.EUROPE:
      return []; // 欧洲地区屏蔽支付
    default:
      return ["stripe", "paypal"];
  }
}

/**
 * 根据区域获取认证方式
 */
export function getAuthMethodsByRegion(region: RegionType): string[] {
  switch (region) {
    case RegionType.CHINA:
      return ["wechat", "email"];
    case RegionType.EUROPE:
      return ["email"]; // GDPR合规
    default:
      return ["google", "email"];
  }
}

/**
 * 检查是否为欧洲国家
 */
export function isEuropeanCountry(countryCode: string): boolean {
  return EUROPEAN_COUNTRIES.includes((countryCode || "").toUpperCase());
}

/**
 * 检查是否为中国
 */
export function isChinaCountry(countryCode: string): boolean {
  return (countryCode || "").toUpperCase() === TARGET_MARKETS.CHINA;
}
