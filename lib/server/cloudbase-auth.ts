const CHINA_REGIONS = new Set([
  "ap-shanghai",
  "ap-guangzhou",
  "ap-shenzhen-fsi",
  "ap-shanghai-fsi",
  "ap-nanjing",
  "ap-beijing",
  "ap-chengdu",
  "ap-chongqing",
  "ap-hongkong",
]);

export type CloudbaseVerifiedUser = {
  userId: string;
  email: string | null;
};

function readCloudbaseEnvId() {
  return (
    process.env.NEXT_PUBLIC_CLOUDBASE_ENV_ID?.trim() ||
    process.env.NEXT_PUBLIC_WECHAT_CLOUDBASE_ID?.trim() ||
    process.env.WECHAT_CLOUDBASE_ID?.trim() ||
    process.env.CLOUDBASE_ENV_ID?.trim() ||
    ""
  );
}

function readCloudbaseRegion() {
  return (
    process.env.NEXT_PUBLIC_CLOUDBASE_REGION?.trim() ||
    process.env.CLOUDBASE_REGION?.trim() ||
    "ap-shanghai"
  ).toLowerCase();
}

function getCloudbaseAuthOrigin() {
  const envId = readCloudbaseEnvId();
  if (!envId) {
    return null;
  }

  const region = readCloudbaseRegion();
  const host = CHINA_REGIONS.has(region)
    ? `${envId}.api.tcloudbasegateway.com`
    : `${envId}.api.intl.tcloudbasegateway.com`;

  return `https://${host}`;
}

function readStringField(payload: unknown, path: string[]) {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  if (typeof current !== "string") {
    return null;
  }

  const normalized = current.trim();
  return normalized.length > 0 ? normalized : null;
}

function extractUserId(payload: unknown) {
  const candidates = [
    ["uid"],
    ["id"],
    ["sub"],
    ["user", "uid"],
    ["user", "id"],
    ["user", "sub"],
    ["data", "uid"],
    ["data", "id"],
    ["data", "sub"],
    ["data", "user", "uid"],
    ["data", "user", "id"],
    ["data", "user", "sub"],
  ];

  for (const path of candidates) {
    const userId = readStringField(payload, path);
    if (userId) {
      return userId;
    }
  }

  return null;
}

function extractUserEmail(payload: unknown) {
  const candidates = [
    ["email"],
    ["user", "email"],
    ["data", "email"],
    ["data", "user", "email"],
  ];

  for (const path of candidates) {
    const email = readStringField(payload, path);
    if (email) {
      return email.toLowerCase();
    }
  }

  return null;
}

export async function verifyCloudbaseAccessToken(
  accessToken: string,
): Promise<CloudbaseVerifiedUser | null> {
  const token = accessToken.trim();
  if (!token) {
    return null;
  }

  const authOrigin = getCloudbaseAuthOrigin();
  if (!authOrigin) {
    return null;
  }

  const response = await fetch(`${authOrigin}/auth/v1/user/me`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `CloudBase 登录校验失败 (HTTP ${response.status})${
        detail ? `: ${detail}` : ""
      }`,
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const userId = extractUserId(payload);
  if (!userId) {
    return null;
  }

  return {
    userId,
    email: extractUserEmail(payload),
  };
}
