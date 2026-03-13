import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { GenerationItem, GenerationTab } from "@/lib/ai-generation";
import { readGeneratedFile } from "@/lib/generated-files";
import { providerFetch, type ProxyProvider } from "@/lib/provider-http";
import { getCloudBaseAdminApp } from "@/lib/server/cloudbase-connector";
import type {
  DatabaseBackend,
  RoutedAdminDbClient,
} from "@/lib/server/database-routing";
import { supabaseAdmin } from "@/lib/supabase/admin";

const GENERATED_OUTPUT_BUCKET = "generated-outputs";
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 12;

type GenerationSource = "cn" | "global";

type PersistGenerationHistoryInput = {
  db: RoutedAdminDbClient;
  source: GenerationSource;
  userId: string;
  generation: GenerationItem;
  requestParams?: Record<string, unknown> | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

type ListGenerationHistoryInput = {
  db: RoutedAdminDbClient;
  source: GenerationSource;
  userId: string;
  limit?: number;
};

type DeleteGenerationHistoryInput = {
  db: RoutedAdminDbClient;
  source: GenerationSource;
  userId: string;
  taskId: string;
};

type QueryResultLike = {
  data?: unknown;
  error?: { message?: unknown } | null;
};

type AiTaskRow = {
  id?: string | null;
  user_id?: string | null;
  source?: string | null;
  task_type?: string | null;
  model_id?: string | null;
  model_label?: string | null;
  model_provider?: string | null;
  request_prompt?: string | null;
  status?: string | null;
  summary?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

type AiTaskOutputRow = {
  id?: string | null;
  task_id?: string | null;
  user_id?: string | null;
  source?: string | null;
  output_type?: string | null;
  sequence_no?: number | string | null;
  text_content?: string | null;
  file_id?: string | null;
  metadata_json?: unknown;
  created_at?: string | null;
};

type StorageFileRow = {
  id?: string | null;
  user_id?: string | null;
  source?: string | null;
  provider?: string | null;
  bucket_name?: string | null;
  object_key?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  public_url?: string | null;
  metadata_json?: unknown;
  created_at?: string | null;
};

type PersistedAssetUrls = {
  previewUrl: string | null;
  downloadUrl: string | null;
};

type PersistedAssetRecord = {
  fileId: string;
  fileName: string;
  mimeType: string;
  outputType: "text" | "document" | "image" | "audio" | "video";
  sequenceNo: number;
  textContent: string | null;
  metadata: Record<string, unknown> | null;
  urls: PersistedAssetUrls;
};

type AssetFetchTarget = {
  outputType: "text" | "document" | "image" | "audio" | "video";
  sequenceNo: number;
  fetchUrl: string | null;
  fileName: string;
  textContent: string | null;
  metadata: Record<string, unknown> | null;
  provider: GenerationItem["provider"];
};

function formatUtcDateTimeForSql(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function toSourceDateTime(
  backend: DatabaseBackend,
  value?: string | null,
  fallbackDate: Date = new Date(),
) {
  const parsed = value ? new Date(value) : fallbackDate;
  const safeDate = Number.isNaN(parsed.getTime()) ? fallbackDate : parsed;
  return backend === "cloudbase"
    ? formatUtcDateTimeForSql(safeDate)
    : safeDate.toISOString();
}

function normalizeText(input: unknown, fallback = "") {
  if (typeof input !== "string") {
    return fallback;
  }
  const normalized = input.trim();
  return normalized || fallback;
}

function normalizeNullableText(input: unknown) {
  const normalized = normalizeText(input, "");
  return normalized || null;
}

function toQueryErrorMessage(result: unknown) {
  if (!result || typeof result !== "object" || !("error" in result)) {
    return null;
  }

  const error = (result as QueryResultLike).error;
  if (!error || typeof error !== "object") {
    return null;
  }

  const message = error.message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }

  return "unknown";
}

function toQueryRows<T>(result: unknown) {
  if (!result || typeof result !== "object" || !("data" in result)) {
    return [] as T[];
  }

  const data = (result as QueryResultLike).data;
  if (Array.isArray(data)) {
    return data as T[];
  }
  if (data && typeof data === "object") {
    return [data as T];
  }
  return [] as T[];
}

async function queryRows<T>(queryPromise: Promise<unknown>, context: string) {
  const result = await queryPromise;
  const errorMessage = toQueryErrorMessage(result);
  if (errorMessage) {
    throw new Error(`${context}: ${errorMessage}`);
  }
  return toQueryRows<T>(result);
}

async function executeQuery(queryPromise: Promise<unknown>, context: string) {
  const result = await queryPromise;
  const errorMessage = toQueryErrorMessage(result);
  if (errorMessage) {
    throw new Error(`${context}: ${errorMessage}`);
  }
  return result;
}

function sanitizeFileName(input: string, fallback: string) {
  const normalized = normalizeText(input, fallback)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function getFileExtensionFromFileName(fileName: string) {
  const normalized = normalizeText(fileName, "");
  const matched = normalized.match(/\.([a-z0-9]{1,10})$/i);
  return matched?.[1]?.toLowerCase() ?? "";
}

function getFileExtensionFromMimeType(mimeType: string) {
  const normalized = normalizeText(mimeType, "").split(";")[0].toLowerCase();
  const mimeToExtension: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      "xlsx",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/x-markdown": "md",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  return mimeToExtension[normalized] || "";
}

function ensureFileExtension(fileName: string, mimeType: string, fallbackBase: string) {
  const normalizedFileName = sanitizeFileName(fileName, fallbackBase);
  if (getFileExtensionFromFileName(normalizedFileName)) {
    return normalizedFileName;
  }

  const extension = getFileExtensionFromMimeType(mimeType);
  if (!extension) {
    return normalizedFileName;
  }
  return `${normalizedFileName}.${extension}`;
}

function inferFileNameFromUrl(url: string, fallback: string) {
  try {
    const pathname = new URL(url).pathname;
    const tail = pathname.split("/").filter(Boolean).pop();
    if (tail) {
      return sanitizeFileName(decodeURIComponent(tail), fallback);
    }
  } catch {
    // ignore
  }
  return sanitizeFileName(fallback, fallback);
}

function extractFileNameFromContentDisposition(value: string | null) {
  const normalized = normalizeText(value, "");
  if (!normalized) {
    return null;
  }

  const utf8Match = normalized.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return sanitizeFileName(decodeURIComponent(utf8Match[1]), "file");
  }

  const asciiMatch = normalized.match(/filename="?([^";]+)"?/i);
  if (asciiMatch?.[1]) {
    return sanitizeFileName(asciiMatch[1], "file");
  }

  return null;
}

function createTextId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function buildObjectKey(userId: string, taskId: string, sequenceNo: number, fileName: string) {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const safeFileName = sanitizeFileName(fileName, `output-${sequenceNo}`);
  return `${userId}/${yyyy}/${mm}/${dd}/${taskId}/${String(sequenceNo).padStart(2, "0")}-${safeFileName}`;
}

function toIsoString(value: string | null | undefined, fallback: Date) {
  const parsed = value ? new Date(value) : fallback;
  const safeDate = Number.isNaN(parsed.getTime()) ? fallback : parsed;
  return safeDate.toISOString();
}

function parseGenerationProvider(input: unknown): GenerationItem["provider"] {
  const normalized = normalizeText(input, "").toLowerCase();
  if (
    normalized === "aliyun" ||
    normalized === "mistral" ||
    normalized === "replicate" ||
    normalized === "demo" ||
    normalized === "system"
  ) {
    return normalized as GenerationItem["provider"];
  }
  return "system";
}

function parseGenerationType(input: unknown): GenerationTab {
  const normalized = normalizeText(input, "").toLowerCase();
  if (
    normalized === "text" ||
    normalized === "image" ||
    normalized === "video" ||
    normalized === "audio" ||
    normalized === "edit_text" ||
    normalized === "edit_image" ||
    normalized === "edit_audio" ||
    normalized === "edit_video" ||
    normalized === "detect_text" ||
    normalized === "detect_image" ||
    normalized === "detect_audio" ||
    normalized === "detect_video"
  ) {
    return normalized as GenerationTab;
  }
  return "text";
}

function resolveTaskCategoryByGenerationType(type: GenerationTab) {
  if (type.startsWith("edit_")) {
    return "edit";
  }

  if (type.startsWith("detect_")) {
    return "detect";
  }

  return "generate";
}

function safeParseJsonRecord(input: unknown): Record<string, unknown> | null {
  if (!input) {
    return null;
  }
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return null;
}

function resolveProxyProvider(provider: GenerationItem["provider"]): ProxyProvider | null {
  if (provider === "aliyun") {
    return "aliyun";
  }
  if (provider === "mistral") {
    return "mistral";
  }
  if (provider === "replicate") {
    return "replicate";
  }
  return null;
}

function parseTemporaryGeneratedFileUrl(url: string) {
  try {
    const parsed = new URL(url, "http://local.generated");
    const matched = parsed.pathname.match(/\/api\/generated-files\/([^/]+)$/);
    if (!matched?.[1]) {
      return null;
    }
    return {
      fileId: decodeURIComponent(matched[1]),
      downloadName:
        normalizeNullableText(parsed.searchParams.get("downloadName")) || null,
    };
  } catch {
    return null;
  }
}

async function fetchFileBinary(
  url: string,
  fallbackFileName: string,
  provider: GenerationItem["provider"],
) {
  const temporaryFile = parseTemporaryGeneratedFileUrl(url);
  if (temporaryFile?.fileId) {
    const record = readGeneratedFile(temporaryFile.fileId);
    if (!record) {
      throw new Error("临时生成文件不存在或已过期。");
    }

    return {
      bytes: Uint8Array.from(record.bytes),
      mimeType: normalizeText(record.mimeType, "application/octet-stream"),
      fileName: sanitizeFileName(
        temporaryFile.downloadName || record.fileName,
        fallbackFileName,
      ),
    };
  }

  const proxyProvider = resolveProxyProvider(provider);
  const response = proxyProvider
    ? await providerFetch(proxyProvider, url, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
      })
    : await fetch(url, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
      });

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `拉取生成文件失败 (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const mimeType =
    normalizeText(response.headers.get("content-type"), "application/octet-stream")
      .split(";")[0]
      .trim()
      .toLowerCase() || "application/octet-stream";
  const inferredFileName =
    extractFileNameFromContentDisposition(
      response.headers.get("content-disposition"),
    ) || inferFileNameFromUrl(url, fallbackFileName);

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType,
    fileName: inferredFileName,
  };
}

async function buildStoredFileUrls(input: {
  backend: DatabaseBackend;
  bucketName: string;
  objectKey: string;
  fileName: string;
}) {
  if (input.backend === "supabase") {
    if (!supabaseAdmin) {
      throw new Error("Supabase 未配置，无法生成文件访问地址。");
    }

    const previewResult = await supabaseAdmin.storage
      .from(input.bucketName)
      .createSignedUrl(input.objectKey, SIGNED_URL_EXPIRES_IN_SECONDS);
    if (previewResult.error || !previewResult.data?.signedUrl) {
      throw new Error(
        `生成预览地址失败: ${previewResult.error?.message || "unknown"}`,
      );
    }

    const downloadResult = await supabaseAdmin.storage
      .from(input.bucketName)
      .createSignedUrl(input.objectKey, SIGNED_URL_EXPIRES_IN_SECONDS, {
        download: input.fileName,
      });
    if (downloadResult.error || !downloadResult.data?.signedUrl) {
      throw new Error(
        `生成下载地址失败: ${downloadResult.error?.message || "unknown"}`,
      );
    }

    return {
      previewUrl: previewResult.data.signedUrl,
      downloadUrl: downloadResult.data.signedUrl,
    } satisfies PersistedAssetUrls;
  }

  const app = await getCloudBaseAdminApp();
  const cloudPath = `${input.bucketName}/${input.objectKey}`
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const metadata = await app.getUploadMetadata({ cloudPath });
  const downloadUrl =
    typeof metadata?.data?.download_url === "string"
      ? metadata.data.download_url.trim()
      : "";
  if (!downloadUrl) {
    throw new Error("CloudBase 未返回可用的文件下载地址。");
  }

  return {
    previewUrl: downloadUrl,
    downloadUrl,
  } satisfies PersistedAssetUrls;
}

function isDocumentGenerationType(type: GenerationTab) {
  return type === "text" || type === "edit_text";
}

function isImageGenerationType(type: GenerationTab) {
  return type === "image" || type === "edit_image";
}

function isAudioGenerationType(type: GenerationTab) {
  return type === "audio" || type === "edit_audio";
}

function isVideoGenerationType(type: GenerationTab) {
  return type === "video" || type === "edit_video";
}

function isDetectionGenerationType(type: GenerationTab) {
  return (
    type === "detect_text" ||
    type === "detect_image" ||
    type === "detect_audio" ||
    type === "detect_video"
  );
}

function buildAssetTargets(generation: GenerationItem) {
  const assets: AssetFetchTarget[] = [];

  if (isDetectionGenerationType(generation.type)) {
    if (generation.text) {
      assets.push({
        outputType: "text",
        sequenceNo: 1,
        fetchUrl: null,
        fileName: "detect-report.txt",
        textContent: generation.text,
        metadata: {
          kind: "detect_report",
        },
        provider: generation.provider,
      });
    }

    return assets;
  }

  if (isDocumentGenerationType(generation.type)) {
    const links = generation.downloadLinks || [];
    links.forEach((link, index) => {
      assets.push({
        outputType: "document",
        sequenceNo: index + 1,
        fetchUrl: normalizeNullableText(link.url),
        fileName: sanitizeFileName(link.label || `document-${index + 1}`, `document-${index + 1}`),
        textContent: index === 0 ? normalizeNullableText(generation.text) : null,
        metadata: {
          kind: "document_export",
        },
        provider: generation.provider,
      });
    });

    if (assets.length === 0 && generation.text) {
      assets.push({
        outputType: "text",
        sequenceNo: 1,
        fetchUrl: null,
        fileName: "text-output.txt",
        textContent: generation.text,
        metadata: {
          kind: "text_only",
        },
        provider: generation.provider,
      });
    }

    return assets;
  }

  if (isImageGenerationType(generation.type)) {
    (generation.imageUrls || []).forEach((url, index) => {
      const downloadLink = generation.downloadLinks?.[index];
      assets.push({
        outputType: "image",
        sequenceNo: index + 1,
        fetchUrl: normalizeNullableText(downloadLink?.url || url),
        fileName: sanitizeFileName(
          downloadLink?.label || inferFileNameFromUrl(url, `image-${index + 1}`),
          `image-${index + 1}`,
        ),
        textContent: null,
        metadata: null,
        provider: generation.provider,
      });
    });
    return assets;
  }

  if (isAudioGenerationType(generation.type)) {
    if (generation.text) {
      assets.push({
        outputType: "text",
        sequenceNo: 1,
        fetchUrl: null,
        fileName: "audio-script.txt",
        textContent: generation.text,
        metadata: {
          kind: generation.type === "edit_audio" ? "audio_edit_script" : "audio_script",
        },
        provider: generation.provider,
      });
    }

    (generation.audioUrls || []).forEach((url, index) => {
      const downloadLink = generation.downloadLinks?.[index];
      assets.push({
        outputType: "audio",
        sequenceNo: index + (generation.text ? 2 : 1),
        fetchUrl: normalizeNullableText(downloadLink?.url || url),
        fileName: sanitizeFileName(
          downloadLink?.label || inferFileNameFromUrl(url, `audio-${index + 1}`),
          `audio-${index + 1}`,
        ),
        textContent: null,
        metadata: null,
        provider: generation.provider,
      });
    });
    return assets;
  }

  if (isVideoGenerationType(generation.type)) {
    (generation.videoUrls || []).forEach((url, index) => {
      const downloadLink = generation.downloadLinks?.[index];
      assets.push({
        outputType: "video",
        sequenceNo: index + 1,
        fetchUrl: normalizeNullableText(downloadLink?.url || url),
        fileName: sanitizeFileName(
          downloadLink?.label || inferFileNameFromUrl(url, `video-${index + 1}`),
          `video-${index + 1}`,
        ),
        textContent: null,
        metadata: null,
        provider: generation.provider,
      });
    });
    return assets;
  }

  return assets;
}

async function persistAssetRecord(input: {
  db: RoutedAdminDbClient;
  source: GenerationSource;
  userId: string;
  taskId: string;
  asset: AssetFetchTarget;
  nowText: string;
}) {
  const asset = input.asset;
  const fileId = createTextId("storage_file");
  const outputId = createTextId("ai_output");

  if (!asset.fetchUrl) {
    await executeQuery(
      input.db.from("ai_task_outputs").insert({
        id: outputId,
        task_id: input.taskId,
        user_id: input.userId,
        source: input.source,
        output_type: asset.outputType,
        sequence_no: asset.sequenceNo,
        text_content: asset.textContent,
        file_id: null,
        preview_url: null,
        download_url: null,
        metadata_json: asset.metadata,
        created_at: input.nowText,
      }),
      "写入生成产物记录失败",
    );

    return null;
  }

  const fetched = await fetchFileBinary(
    asset.fetchUrl,
    asset.fileName,
    asset.provider,
  );
  const fileName = ensureFileExtension(
    asset.fileName || fetched.fileName,
    fetched.mimeType,
    fetched.fileName,
  );
  const objectKey = buildObjectKey(
    input.userId,
    input.taskId,
    asset.sequenceNo,
    fileName,
  );
  const uploadResult = await input.db.storage
    .from(GENERATED_OUTPUT_BUCKET)
    .upload(objectKey, Buffer.from(fetched.bytes), {
      contentType: fetched.mimeType,
      upsert: false,
    });

  if (uploadResult.error) {
    throw new Error(`上传生成文件失败: ${uploadResult.error.message}`);
  }

  const checksumSha256 = createHash("sha256")
    .update(Buffer.from(fetched.bytes))
    .digest("hex");
  const fileMetadata = {
    ...(asset.metadata || {}),
    task_id: input.taskId,
    sequence_no: asset.sequenceNo,
  };

  await executeQuery(
    input.db.from("storage_files").insert({
      id: fileId,
      user_id: input.userId,
      source: input.source,
      provider: input.db.backend,
      bucket_name: GENERATED_OUTPUT_BUCKET,
      object_key: objectKey,
      file_name: fileName,
      mime_type: fetched.mimeType,
      file_size_bytes: fetched.bytes.byteLength,
      checksum_sha256: checksumSha256,
      is_public: false,
      public_url: null,
      storage_status: "active",
      metadata_json: fileMetadata,
      created_at: input.nowText,
      updated_at: input.nowText,
    }),
    "写入文件索引失败",
  );

  const urls = await buildStoredFileUrls({
    backend: input.db.backend,
    bucketName: GENERATED_OUTPUT_BUCKET,
    objectKey,
    fileName,
  });

  await executeQuery(
    input.db.from("ai_task_outputs").insert({
      id: outputId,
      task_id: input.taskId,
      user_id: input.userId,
      source: input.source,
      output_type: asset.outputType,
      sequence_no: asset.sequenceNo,
      text_content: asset.textContent,
      file_id: fileId,
      preview_url: urls.previewUrl,
      download_url: urls.downloadUrl,
      metadata_json: fileMetadata,
      created_at: input.nowText,
    }),
    "写入生成产物记录失败",
  );

  return {
    fileId,
    fileName,
    mimeType: fetched.mimeType,
    outputType: asset.outputType,
    sequenceNo: asset.sequenceNo,
    textContent: asset.textContent,
    metadata: fileMetadata,
    urls,
  } satisfies PersistedAssetRecord;
}

function buildGenerationItemFromAssets(input: {
  generation: GenerationItem;
  assets: PersistedAssetRecord[];
}) {
  const assets = [...input.assets].sort((left, right) => left.sequenceNo - right.sequenceNo);
  const nextGeneration: GenerationItem = {
    ...input.generation,
    downloadLinks: undefined,
    imageUrls: undefined,
    audioUrls: undefined,
    videoUrls: undefined,
  };

  if (isDocumentGenerationType(input.generation.type)) {
    nextGeneration.downloadLinks = assets
      .filter((asset) => asset.outputType === "document" && asset.urls.downloadUrl)
      .map((asset) => ({
        label: asset.fileName,
        url: asset.urls.downloadUrl as string,
      }));
    nextGeneration.text =
      assets.find((asset) => asset.textContent)?.textContent ||
      input.generation.text;
    return nextGeneration;
  }

  if (isImageGenerationType(input.generation.type)) {
    nextGeneration.imageUrls = assets
      .filter((asset) => asset.outputType === "image" && asset.urls.previewUrl)
      .map((asset) => asset.urls.previewUrl as string);
    nextGeneration.downloadLinks = assets
      .filter((asset) => asset.outputType === "image" && asset.urls.downloadUrl)
      .map((asset) => ({
        label: asset.fileName,
        url: asset.urls.downloadUrl as string,
      }));
    return nextGeneration;
  }

  if (isAudioGenerationType(input.generation.type)) {
    nextGeneration.text =
      assets.find((asset) => asset.textContent)?.textContent ||
      input.generation.text;
    nextGeneration.audioUrls = assets
      .filter((asset) => asset.outputType === "audio" && asset.urls.previewUrl)
      .map((asset) => asset.urls.previewUrl as string);
    nextGeneration.downloadLinks = assets
      .filter((asset) => asset.outputType === "audio" && asset.urls.downloadUrl)
      .map((asset) => ({
        label: asset.fileName,
        url: asset.urls.downloadUrl as string,
      }));
    return nextGeneration;
  }

  if (isVideoGenerationType(input.generation.type)) {
    nextGeneration.videoUrls = assets
      .filter((asset) => asset.outputType === "video" && asset.urls.previewUrl)
      .map((asset) => asset.urls.previewUrl as string);
    nextGeneration.downloadLinks = assets
      .filter((asset) => asset.outputType === "video" && asset.urls.downloadUrl)
      .map((asset) => ({
        label: asset.fileName,
        url: asset.urls.downloadUrl as string,
      }));
    return nextGeneration;
  }

  return nextGeneration;
}

export async function persistGenerationHistory(
  input: PersistGenerationHistoryInput,
) {
  const taskId = normalizeText(input.generation.id, createTextId("ai_task"));
  const startedAtIso = toIsoString(input.startedAt, new Date());
  const finishedAtIso = toIsoString(input.finishedAt, new Date());
  const createdAtIso = toIsoString(input.generation.createdAt, new Date());
  const createdAtText = toSourceDateTime(input.db.backend, createdAtIso);
  const startedAtText = toSourceDateTime(input.db.backend, startedAtIso);
  const finishedAtText = toSourceDateTime(input.db.backend, finishedAtIso);
  const isErrorGeneration = input.generation.status === "error";
  const taskRow = {
    id: taskId,
    user_id: input.userId,
    source: input.source,
    task_category: resolveTaskCategoryByGenerationType(input.generation.type),
    task_type: input.generation.type,
    model_id: input.generation.modelId,
    model_label: input.generation.modelLabel,
    model_provider: input.generation.provider,
    request_prompt: input.generation.prompt,
    request_params_json: input.requestParams || null,
    input_file_id: null,
    status: isErrorGeneration ? "failed" : "running",
    summary: input.generation.summary || null,
    error_message: input.generation.errorMessage || null,
    started_at: startedAtText,
    finished_at: isErrorGeneration ? finishedAtText : null,
    created_at: createdAtText,
    updated_at: isErrorGeneration ? finishedAtText : startedAtText,
  };

  await executeQuery(
    input.db.from("ai_tasks").insert(taskRow),
    "写入生成任务失败",
  );

  if (input.generation.status === "error") {
    return {
      ...input.generation,
      id: taskId,
    };
  }

  try {
    const assetTargets = buildAssetTargets(input.generation);
    const persistedAssets: PersistedAssetRecord[] = [];
    for (const asset of assetTargets) {
      const persistedAsset = await persistAssetRecord({
        db: input.db,
        source: input.source,
        userId: input.userId,
        taskId,
        asset,
        nowText: finishedAtText,
      });
      if (persistedAsset) {
        persistedAssets.push(persistedAsset);
      }
    }

    await executeQuery(
      input.db
        .from("ai_tasks")
        .update({
          status: "success",
          summary: input.generation.summary || null,
          error_message: null,
          finished_at: finishedAtText,
          updated_at: finishedAtText,
        })
        .eq("id", taskId)
        .eq("user_id", input.userId)
        .eq("source", input.source),
      "更新生成任务状态失败",
    );

    return buildGenerationItemFromAssets({
      generation: {
        ...input.generation,
        id: taskId,
        createdAt: createdAtIso,
      },
      assets: persistedAssets,
    });
  } catch (error) {
    try {
      await executeQuery(
        input.db
          .from("ai_tasks")
          .update({
            status: "failed",
            error_message:
              error instanceof Error && error.message.trim()
                ? error.message.trim()
                : "生成结果持久化失败",
            finished_at: finishedAtText,
            updated_at: finishedAtText,
          })
          .eq("id", taskId)
          .eq("user_id", input.userId)
          .eq("source", input.source),
        "回写生成任务失败状态失败",
      );
    } catch (updateError) {
      console.warn(
        "[generation-history] update failed task status failed:",
        updateError,
      );
    }

    throw error;
  }
}

async function buildStoredFileUrlsByRow(
  backend: DatabaseBackend,
  row: StorageFileRow,
) {
  const bucketName = normalizeText(row.bucket_name, GENERATED_OUTPUT_BUCKET);
  const objectKey = normalizeText(row.object_key, "");
  const fileName = sanitizeFileName(
    normalizeText(row.file_name, "output"),
    "output",
  );

  if (!objectKey) {
    return {
      previewUrl: null,
      downloadUrl: null,
    } satisfies PersistedAssetUrls;
  }

  return buildStoredFileUrls({
    backend,
    bucketName,
    objectKey,
    fileName,
  });
}

export async function listPersistedGenerationHistory(
  input: ListGenerationHistoryInput,
) {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 30)));
  const taskRows = await queryRows<AiTaskRow>(
    input.db
      .from("ai_tasks")
      .select(
        "id,user_id,source,task_type,model_id,model_label,model_provider,request_prompt,status,summary,error_message,created_at,started_at,finished_at",
      )
      .eq("user_id", input.userId)
      .eq("source", input.source)
      .in("task_category", ["generate", "edit", "detect"])
      .in("status", ["success", "failed", "canceled"])
      .order("created_at", { ascending: false })
      .limit(limit),
    "读取生成历史失败",
  );

  const tasks = taskRows
    .filter((row) => normalizeText(row.id, ""))
    .sort((left, right) => {
      const leftMs = Date.parse(
        normalizeText(left.created_at, left.started_at || left.finished_at || ""),
      );
      const rightMs = Date.parse(
        normalizeText(right.created_at, right.started_at || right.finished_at || ""),
      );
      return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
    })
    .slice(0, limit);

  if (tasks.length === 0) {
    return [] as GenerationItem[];
  }

  const taskIds = tasks.map((task) => normalizeText(task.id, "")).filter(Boolean);
  const outputRows = await queryRows<AiTaskOutputRow>(
    input.db
      .from("ai_task_outputs")
      .select(
        "id,task_id,user_id,source,output_type,sequence_no,text_content,file_id,metadata_json,created_at",
      )
      .in("task_id", taskIds),
    "读取生成产物失败",
  );

  const fileIds = outputRows
    .map((row) => normalizeText(row.file_id, ""))
    .filter(Boolean);
  const storageRows =
    fileIds.length > 0
      ? await queryRows<StorageFileRow>(
          input.db
            .from("storage_files")
            .select(
              "id,user_id,source,provider,bucket_name,object_key,file_name,mime_type,public_url,metadata_json,created_at",
            )
            .in("id", fileIds),
          "读取生成文件索引失败",
        )
      : [];

  const storageById = new Map<string, StorageFileRow>();
  storageRows.forEach((row) => {
    const fileId = normalizeText(row.id, "");
    if (fileId) {
      storageById.set(fileId, row);
    }
  });

  const fileUrlsById = new Map<string, PersistedAssetUrls>();
  await Promise.all(
    Array.from(storageById.entries()).map(async ([fileId, row]) => {
      try {
        const urls = await buildStoredFileUrlsByRow(input.db.backend, row);
        fileUrlsById.set(fileId, urls);
      } catch (error) {
        console.warn("[generation-history] build file url failed:", {
          fileId,
          error,
        });
      }
    }),
  );

  const outputsByTaskId = new Map<string, AiTaskOutputRow[]>();
  outputRows.forEach((row) => {
    const taskId = normalizeText(row.task_id, "");
    if (!taskId) {
      return;
    }
    if (!outputsByTaskId.has(taskId)) {
      outputsByTaskId.set(taskId, []);
    }
    outputsByTaskId.get(taskId)!.push(row);
  });

  return tasks.map((task) => {
    const taskId = normalizeText(task.id, "");
    const outputs = [...(outputsByTaskId.get(taskId) || [])].sort(
      (left, right) =>
        Number(left.sequence_no || 0) - Number(right.sequence_no || 0),
    );
    const generationType = parseGenerationType(task.task_type);
    const taskStatus = normalizeText(task.status, "success").toLowerCase();
    const generation: GenerationItem = {
      id: taskId,
      type: generationType,
      prompt: normalizeText(task.request_prompt, ""),
      modelId: normalizeText(task.model_id, "unknown"),
      modelLabel: normalizeText(task.model_label, "Unknown Model"),
      provider: parseGenerationProvider(task.model_provider),
      status: taskStatus === "success" ? "success" : "error",
      summary: normalizeNullableText(task.summary) || undefined,
      errorMessage: normalizeNullableText(task.error_message) || undefined,
      createdAt:
        normalizeText(task.created_at, "") ||
        normalizeText(task.started_at, "") ||
        normalizeText(task.finished_at, "") ||
        new Date().toISOString(),
    };

    const firstTextOutput = outputs.find((row) => normalizeText(row.text_content, ""));
    if (firstTextOutput?.text_content) {
      generation.text = firstTextOutput.text_content;
    }

    const downloadLinks: NonNullable<GenerationItem["downloadLinks"]> = [];
    const imageUrls: string[] = [];
    const audioUrls: string[] = [];
    const videoUrls: string[] = [];

    outputs.forEach((output, index) => {
      const fileId = normalizeText(output.file_id, "");
      const fileRow = fileId ? storageById.get(fileId) : null;
      const urls = fileId ? fileUrlsById.get(fileId) : null;
      const metadata = safeParseJsonRecord(output.metadata_json);
      const fileName = sanitizeFileName(
        normalizeText(
          fileRow?.file_name,
          typeof metadata?.file_name === "string" ? metadata.file_name : `output-${index + 1}`,
        ),
        `output-${index + 1}`,
      );
      const previewUrl = normalizeNullableText(urls?.previewUrl);
      const downloadUrl = normalizeNullableText(urls?.downloadUrl);
      const outputType = normalizeText(output.output_type, "");

      if (downloadUrl) {
        downloadLinks.push({
          label: fileName,
          url: downloadUrl,
        });
      }

      if (outputType === "image" && previewUrl) {
        imageUrls.push(previewUrl);
      }
      if (outputType === "audio" && previewUrl) {
        audioUrls.push(previewUrl);
      }
      if (outputType === "video" && previewUrl) {
        videoUrls.push(previewUrl);
      }
    });

    if (isDocumentGenerationType(generation.type) && downloadLinks.length > 0) {
      generation.downloadLinks = downloadLinks;
    }
    if (isImageGenerationType(generation.type) && imageUrls.length > 0) {
      generation.imageUrls = imageUrls;
      generation.downloadLinks = downloadLinks;
    }
    if (isAudioGenerationType(generation.type) && audioUrls.length > 0) {
      generation.audioUrls = audioUrls;
      generation.downloadLinks = downloadLinks;
    }
    if (isVideoGenerationType(generation.type) && videoUrls.length > 0) {
      generation.videoUrls = videoUrls;
      generation.downloadLinks = downloadLinks;
    }

    return generation;
  });
}

export async function deletePersistedGenerationHistory(
  input: DeleteGenerationHistoryInput,
) {
  const taskId = normalizeText(input.taskId, "");
  if (!taskId) {
    throw new Error("生成记录 ID 无效。");
  }

  const taskRows = await queryRows<AiTaskRow>(
    input.db
      .from("ai_tasks")
      .select("id")
      .eq("id", taskId)
      .eq("user_id", input.userId)
      .eq("source", input.source)
      .limit(1),
    "读取生成记录失败",
  );

  if (taskRows.length === 0) {
    throw new Error("生成记录不存在，或您没有删除权限。");
  }

  const outputRows = await queryRows<AiTaskOutputRow>(
    input.db
      .from("ai_task_outputs")
      .select("id,task_id,user_id,source,file_id")
      .eq("task_id", taskId)
      .eq("source", input.source),
    "读取生成产物失败",
  );

  const fileIds = Array.from(
    new Set(outputRows.map((row) => normalizeText(row.file_id, "")).filter(Boolean)),
  );
  const storageRows =
    fileIds.length > 0
      ? await queryRows<StorageFileRow>(
          input.db
            .from("storage_files")
            .select("id,user_id,source,bucket_name,object_key")
            .in("id", fileIds)
            .eq("user_id", input.userId)
            .eq("source", input.source),
          "读取生成文件索引失败",
        )
      : [];

  const objectKeysByBucket = new Map<string, string[]>();
  storageRows.forEach((row) => {
    const bucketName = normalizeText(row.bucket_name, GENERATED_OUTPUT_BUCKET);
    const objectKey = normalizeText(row.object_key, "");
    if (!objectKey) {
      return;
    }

    if (!objectKeysByBucket.has(bucketName)) {
      objectKeysByBucket.set(bucketName, []);
    }
    objectKeysByBucket.get(bucketName)!.push(objectKey);
  });

  let deletedObjectCount = 0;
  for (const [bucketName, objectKeys] of Array.from(objectKeysByBucket.entries())) {
    const uniqueObjectKeys = Array.from(new Set<string>(objectKeys));
    if (uniqueObjectKeys.length === 0) {
      continue;
    }

    const removalResult = await input.db.storage.from(bucketName).remove(uniqueObjectKeys);
    if (removalResult.error) {
      throw new Error(`删除存储文件失败: ${removalResult.error.message}`);
    }
    deletedObjectCount += uniqueObjectKeys.length;
  }

  const storageFileIds = storageRows
    .map((row) => normalizeText(row.id, ""))
    .filter(Boolean);
  if (storageFileIds.length > 0) {
    await executeQuery(
      input.db
        .from("storage_files")
        .delete()
        .in("id", storageFileIds)
        .eq("user_id", input.userId)
        .eq("source", input.source),
      "删除生成文件索引失败",
    );
  }

  await executeQuery(
    input.db
      .from("ai_tasks")
      .delete()
      .eq("id", taskId)
      .eq("user_id", input.userId)
      .eq("source", input.source),
    "删除生成记录失败",
  );

  return {
    deletedTaskId: taskId,
    deletedFileCount: storageFileIds.length,
    deletedObjectCount,
  };
}
