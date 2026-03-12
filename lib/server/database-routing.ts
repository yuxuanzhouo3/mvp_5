import "server-only";

import type { AdminSourceScope } from "@/lib/admin/source-scope";
import { getCloudBaseAdminApp } from "@/lib/server/cloudbase-connector";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type DatabaseBackend = "cloudbase" | "supabase";

type UploadOptions = {
  contentType?: string;
  upsert?: boolean;
};

type StorageUploadResult = {
  data: {
    path: string;
    fullPath: string;
  } | null;
  error: { message: string } | null;
};

type StoragePublicUrlResult = {
  data: { publicUrl: string | null };
  error: { message: string } | null;
};

type StorageBucketClient = {
  upload: (
    objectPath: string,
    fileBody: Buffer,
    options?: UploadOptions,
  ) => Promise<StorageUploadResult>;
  getPublicUrl: (objectPath: string) => Promise<StoragePublicUrlResult>;
};

type StorageClient = {
  from: (bucketName: string) => StorageBucketClient;
};

export type RoutedAdminDbClient = {
  backend: DatabaseBackend;
  from: (tableName: string) => any;
  storage: StorageClient;
};

let cachedCloudbaseClient: RoutedAdminDbClient | null = null;
let cloudbaseInitPromise: Promise<RoutedAdminDbClient> | null = null;
let cachedSupabaseClient: RoutedAdminDbClient | null = null;

function formatUtcDateTimeForSql(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function isIsoDateTimeString(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    return false;
  }

  return Number.isFinite(Date.parse(normalized));
}

function normalizeCloudbaseValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return formatUtcDateTimeForSql(value);
  }
  if (typeof value === "string" && isIsoDateTimeString(value)) {
    return formatUtcDateTimeForSql(new Date(value));
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}

function normalizeCloudbaseMutationPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeCloudbaseMutationPayload(item));
  }
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).map(([key, value]) => [
      key,
      normalizeCloudbaseValue(value),
    ]),
  );
}

function wrapCloudbaseTableClient(tableClient: any) {
  return new Proxy(tableClient, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if ((prop === "insert" || prop === "update") && typeof value === "function") {
        return (payload: unknown, ...rest: unknown[]) =>
          value.call(target, normalizeCloudbaseMutationPayload(payload), ...rest);
      }
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });
}

function toReadableError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

function normalizePathSegment(input: string) {
  return input.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function buildCloudPath(bucketName: string, objectPath: string) {
  const normalizedBucket = normalizePathSegment(bucketName);
  const normalizedObjectPath = normalizePathSegment(objectPath);
  if (!normalizedBucket) {
    return normalizedObjectPath;
  }
  if (!normalizedObjectPath) {
    return normalizedBucket;
  }
  return `${normalizedBucket}/${normalizedObjectPath}`;
}

function resolveLanguage(input: string | null | undefined) {
  return String(input || "zh").trim().toLowerCase();
}

export function resolveBackendFromLanguage(
  input: string | null | undefined = process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE,
): DatabaseBackend {
  return resolveLanguage(input).startsWith("zh") ? "cloudbase" : "supabase";
}

export function resolveBackendFromScope(sourceScope: AdminSourceScope): DatabaseBackend {
  return sourceScope === "cn" ? "cloudbase" : "supabase";
}

function createSupabaseStorageClient(): StorageClient {
  return {
    from(bucketName: string) {
      return {
        async upload(objectPath: string, fileBody: Buffer, options?: UploadOptions) {
          if (!supabaseAdmin) {
            return {
              data: null,
              error: { message: "Supabase 未配置" },
            };
          }
          const { data, error } = await supabaseAdmin.storage
            .from(bucketName)
            .upload(objectPath, fileBody, options);
          return {
            data: data
              ? {
                  path: data.path || objectPath,
                  fullPath: data.fullPath || data.path || objectPath,
                }
              : null,
            error: error ? { message: error.message || "上传失败" } : null,
          };
        },
        async getPublicUrl(objectPath: string) {
          if (!supabaseAdmin) {
            return {
              data: { publicUrl: null },
              error: { message: "Supabase 未配置" },
            };
          }
          const { data } = supabaseAdmin.storage.from(bucketName).getPublicUrl(objectPath);
          return {
            data: { publicUrl: data?.publicUrl || null },
            error: null,
          };
        },
      };
    },
  };
}

function createCloudbaseStorageClient(app: any): StorageClient {
  return {
    from(bucketName: string) {
      return {
        async upload(objectPath: string, fileBody: Buffer) {
          const cloudPath = buildCloudPath(bucketName, objectPath);
          try {
            const uploadResult = await app.uploadFile({
              cloudPath,
              fileContent: fileBody,
            });
            const fullPath =
              typeof uploadResult?.fileID === "string" && uploadResult.fileID.trim()
                ? uploadResult.fileID
                : cloudPath;
            return {
              data: {
                path: objectPath,
                fullPath,
              },
              error: null,
            };
          } catch (error) {
            return {
              data: null,
              error: {
                message: toReadableError(error, "CloudBase 上传文件失败"),
              },
            };
          }
        },
        async getPublicUrl(objectPath: string) {
          const cloudPath = buildCloudPath(bucketName, objectPath);
          try {
            const metadata = await app.getUploadMetadata({ cloudPath });
            const publicUrl =
              typeof metadata?.data?.download_url === "string"
                ? metadata.data.download_url
                : null;
            return {
              data: { publicUrl },
              error: null,
            };
          } catch (error) {
            return {
              data: { publicUrl: null },
              error: {
                message: toReadableError(error, "CloudBase 读取文件地址失败"),
              },
            };
          }
        },
      };
    },
  };
}

async function getCloudbaseAdminClient(): Promise<RoutedAdminDbClient> {
  if (cachedCloudbaseClient) {
    return cachedCloudbaseClient;
  }
  if (cloudbaseInitPromise) {
    return cloudbaseInitPromise;
  }

  cloudbaseInitPromise = (async () => {
    const app = await getCloudBaseAdminApp();
    const mysql = app.mysql();
    const client: RoutedAdminDbClient = {
      backend: "cloudbase",
      from: (tableName: string) => wrapCloudbaseTableClient(mysql.from(tableName)),
      storage: createCloudbaseStorageClient(app),
    };
    cachedCloudbaseClient = client;
    return client;
  })();

  try {
    return await cloudbaseInitPromise;
  } finally {
    cloudbaseInitPromise = null;
  }
}

function getSupabaseAdminClient(): RoutedAdminDbClient | null {
  if (cachedSupabaseClient) {
    return cachedSupabaseClient;
  }
  const client = supabaseAdmin;
  if (!client) {
    return null;
  }

  cachedSupabaseClient = {
    backend: "supabase",
    from: (tableName: string) => client.from(tableName),
    storage: createSupabaseStorageClient(),
  };

  return cachedSupabaseClient;
}

export async function getRoutedAdminDbClient(
  sourceScope: AdminSourceScope,
): Promise<RoutedAdminDbClient | null> {
  const backend = resolveBackendFromScope(sourceScope);
  if (backend === "cloudbase") {
    try {
      return await getCloudbaseAdminClient();
    } catch (error) {
      console.error(
        "[AdminDB] 初始化 CloudBase 客户端失败:",
        toReadableError(error, "unknown"),
      );
      return null;
    }
  }
  return getSupabaseAdminClient();
}

export async function getRoutedRuntimeDbClient(): Promise<RoutedAdminDbClient | null> {
  const backend = resolveBackendFromLanguage();
  if (backend === "cloudbase") {
    try {
      return await getCloudbaseAdminClient();
    } catch (error) {
      console.error(
        "[RuntimeDB] 初始化 CloudBase 客户端失败:",
        toReadableError(error, "unknown"),
      );
      return null;
    }
  }
  return getSupabaseAdminClient();
}
