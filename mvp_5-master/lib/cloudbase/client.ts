"use client";

import cloudbaseCore from "@cloudbase/app";
import { registerAuth } from "@cloudbase/auth";
import { registerMySQL } from "@cloudbase/mysql";

type CloudbaseApp = ReturnType<typeof cloudbaseCore.init>;

let cloudbaseInstance: CloudbaseApp | null = null;
let hasRegisteredCloudbaseModules = false;

function ensureCloudbaseModules() {
  if (hasRegisteredCloudbaseModules) {
    return;
  }
  registerAuth(cloudbaseCore as unknown as never);
  registerMySQL(cloudbaseCore as unknown as never);
  hasRegisteredCloudbaseModules = true;
}

function readCloudbaseConfig() {
  const env =
    process.env.NEXT_PUBLIC_CLOUDBASE_ENV_ID ||
    process.env.NEXT_PUBLIC_WECHAT_CLOUDBASE_ID ||
    "";
  const region = process.env.NEXT_PUBLIC_CLOUDBASE_REGION || "ap-shanghai";
  const accessKey =
    process.env.NEXT_PUBLIC_CLOUDBASE_ACCESS_KEY ||
    process.env.NEXT_PUBLIC_CLOUDBASE_API_KEY ||
    "";

  return {
    env: env.trim(),
    region: region.trim(),
    accessKey: accessKey.trim() || undefined,
  };
}

export function getCloudbaseConfigError(): string | null {
  const { env } = readCloudbaseConfig();
  if (!env) {
    return "CloudBase 未配置：缺少 NEXT_PUBLIC_CLOUDBASE_ENV_ID";
  }
  return null;
}

export function getCloudbaseApp(): CloudbaseApp {
  if (cloudbaseInstance) {
    return cloudbaseInstance;
  }

  const configError = getCloudbaseConfigError();
  if (configError) {
    throw new Error(configError);
  }

  ensureCloudbaseModules();
  const { env, region, accessKey } = readCloudbaseConfig();
  cloudbaseInstance = cloudbaseCore.init(
    accessKey
      ? {
          env,
          region,
          accessKey,
        }
      : {
          env,
          region,
        },
  );

  return cloudbaseInstance;
}

export function getCloudbaseAuth() {
  return getCloudbaseApp().auth({ persistence: "local" });
}
