import { createMistral } from "@ai-sdk/mistral";
import { generateObject } from "ai";
import ExcelJS from "exceljs";
import { extractTextFromPdfBuffer, replaceTextInPdfBuffer } from "@/lib/pdf-editing";
import JSZip from "jszip";
import { randomUUID } from "node:crypto";
import {
  getGenerationModelConfig,
  getGenerationModelDisabledMessage,
  isConnectedGenerationTab,
  isGenerationModelEnabled,
  isGenerationTab,
  type GenerationItem,
} from "@/lib/ai-generation";
import {
  DOCUMENT_FILE_FORMATS,
  isDocumentFileFormat,
  type DocumentFileFormat,
} from "@/lib/document-formats";
import {
  generateDocumentFiles,
  getGeneratedDocumentSchema,
  type GeneratedDocument,
  type GeneratedExportedFile,
} from "@/lib/document-export";
import { storeGeneratedFile } from "@/lib/generated-files";
import { getProviderProxyStatus, providerFetch } from "@/lib/provider-http";
import { verifyCloudbaseAccessToken } from "@/lib/server/cloudbase-auth";
import { getRoutedRuntimeDbClient } from "@/lib/server/database-routing";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  extractRequestAnalyticsMeta,
  trackAnalyticsSessionEvent,
} from "@/lib/analytics/tracker";
import {
  consumeGuestGenerationQuota,
  releaseGuestGenerationQuota,
  type GuestQuotaReservation,
  type GuestQuotaSnapshot,
} from "@/lib/server/guest-quota";
import { persistGenerationHistory } from "@/lib/server/generation-history";
import { ensureDomesticAppUser } from "@/lib/payment/domestic-payment";
import { ensureGlobalAppUser } from "@/lib/payment/global-payment";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

void createMistral;
void generateObject;

const CLOUDBASE_ACCESS_TOKEN_HEADER = "x-cloudbase-access-token";
const AUTHORIZATION_HEADER = "authorization";
const IS_DOMESTIC_RUNTIME = (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "zh")
  .toLowerCase()
  .startsWith("zh");

const FILE_GENERATION_SYSTEM_PROMPT_LINES = [
  "You generate structured documents for export to PDF, Excel, Word, TXT, and Markdown.",
  "Return content that follows the provided schema exactly.",
  "Default to Simplified Chinese unless the user explicitly requests another language.",
  "",
  "CRITICAL: You MUST return JSON in this exact format:",
  "{",
  '  "title": "Document title (string, 1-120 chars)",',
  '  "summary": "Brief summary (string, 1-1200 chars)",',
  '  "sections": [',
  "    {",
  '      "heading": "Section heading (string, 1-80 chars)",',
  '      "paragraphs": ["Paragraph text (string, 1-1500 chars)"],',
  '      "bullets": ["Optional bullet point (string, max 200 chars)"],',
  '      "table": {',
  '        "title": "Optional table title",',
  '        "columns": ["Column 1", "Column 2"],',
  '        "rows": [["Cell 1", "Cell 2"]]',
  "      }",
  "    }",
  "  ],",
  '  "spreadsheets": []',
  "}",
];

const REPLICATE_POLL_INTERVAL_MS = 1200;
const REPLICATE_IMAGE_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "REPLICATE_IMAGE_TASK_TIMEOUT_MS",
  120000,
);
const REPLICATE_VIDEO_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "REPLICATE_VIDEO_TASK_TIMEOUT_MS",
  240000,
);
const REPLICATE_MINIMAX_VIDEO_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "REPLICATE_MINIMAX_VIDEO_TASK_TIMEOUT_MS",
  Math.max(REPLICATE_VIDEO_TASK_TIMEOUT_MS, 480000),
);
const REPLICATE_AUDIO_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "REPLICATE_AUDIO_TASK_TIMEOUT_MS",
  180000,
);
const REPLICATE_TEXT_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "REPLICATE_TEXT_TASK_TIMEOUT_MS",
  120000,
);
const REPLICATE_CREATE_MAX_RETRIES = 2;
const REPLICATE_CREATE_BASE_DELAY_MS = 1500;
const DASHSCOPE_POLL_INTERVAL_MS = 1500;
const DASHSCOPE_IMAGE_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "DASHSCOPE_IMAGE_TASK_TIMEOUT_MS",
  180000,
);
const DASHSCOPE_VIDEO_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "DASHSCOPE_VIDEO_TASK_TIMEOUT_MS",
  300000,
);
const DASHSCOPE_AUDIO_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "DASHSCOPE_AUDIO_TASK_TIMEOUT_MS",
  180000,
);
const DASHSCOPE_CHAT_COMPLETION_TIMEOUT_MS = getPositiveIntFromEnv(
  "DASHSCOPE_CHAT_COMPLETION_TIMEOUT_MS",
  60000,
);
const DEFAULT_GENERATION_OUTPUT_COUNT = 1;
const DEFAULT_IMAGE_OUTPUT_COUNT = DEFAULT_GENERATION_OUTPUT_COUNT;
const DEFAULT_AUDIO_OUTPUT_COUNT = DEFAULT_GENERATION_OUTPUT_COUNT;
const DEFAULT_VIDEO_OUTPUT_COUNT = DEFAULT_GENERATION_OUTPUT_COUNT;
const DOCUMENT_GENERATION_MAX_TOKENS = getPositiveIntFromEnv(
  "DOCUMENT_GENERATION_MAX_TOKENS",
  1000,
);
const DOCUMENT_EDITING_MAX_TOKENS = getPositiveIntFromEnv(
  "DOCUMENT_EDITING_MAX_TOKENS",
  1000,
);
const DOCUMENT_EDIT_SOURCE_MAX_CHARS = getPositiveIntFromEnv(
  "DOCUMENT_EDIT_SOURCE_MAX_CHARS",
  8000,
);
const DETECTION_MAX_TOKENS = getPositiveIntFromEnv(
  "DETECTION_MAX_TOKENS",
  200,
);
const DETECTION_SOURCE_MAX_CHARS = getPositiveIntFromEnv(
  "DETECTION_SOURCE_MAX_CHARS",
  8000,
);
const USER_PROMPT_MAX_CHARS = getPositiveIntFromEnv(
  "USER_PROMPT_MAX_CHARS",
  2000,
);
const GENERATED_INPUT_BUCKET = "generated-outputs";
const GENERATED_INPUT_SIGNED_URL_TTL_SECONDS = getPositiveIntFromEnv(
  "GENERATED_INPUT_SIGNED_URL_TTL_SECONDS",
  86400,
);
const DASHSCOPE_TTS_VOICE = process.env.DASHSCOPE_TTS_VOICE?.trim() || "longxiaochun";
const DASHSCOPE_TTS_RESPONSE_FORMAT =
  process.env.DASHSCOPE_TTS_RESPONSE_FORMAT?.trim().toLowerCase() || "mp3";

const cachedReplicateLatestVersionIds = new Map<string, string>();

type DashScopeDocumentResponseMode = "json_schema" | "json_object" | "prompt_only";

const cachedDashScopeDocumentResponseMode = new Map<string, DashScopeDocumentResponseMode>();
const DASHSCOPE_JSON_SCHEMA_MODEL_IDS = new Set<string>();

function extractBearerToken(request: Request) {
  const authHeader = request.headers.get(AUTHORIZATION_HEADER)?.trim() || "";
  if (!authHeader) {
    return "";
  }

  const bearerPrefix = "bearer ";
  if (!authHeader.toLowerCase().startsWith(bearerPrefix)) {
    return "";
  }

  return authHeader.slice(bearerPrefix.length).trim();
}

type GenerateRequestPayload = {
  prompt: string;
  type: string;
  model: unknown;
  formats: unknown;
  inputFile: File | null;
  keyframeFile: File | null;
  frameFiles: File[];
};

function normalizeFormFieldValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

async function parseGenerateRequest(req: Request): Promise<GenerateRequestPayload> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const inputFile = formData.get("file");
    const keyframeFile = formData.get("keyframe");
    const frameFiles = formData.getAll("frames");
    const formats = formData.getAll("formats");

    return {
      prompt: normalizeFormFieldValue(formData.get("prompt")).trim().slice(0, USER_PROMPT_MAX_CHARS),
      type: normalizeFormFieldValue(formData.get("type")).trim(),
      model: normalizeFormFieldValue(formData.get("model")).trim(),
      formats: formats.length > 0 ? formats : undefined,
      inputFile: inputFile instanceof File && inputFile.size > 0 ? inputFile : null,
      keyframeFile:
        keyframeFile instanceof File && keyframeFile.size > 0 ? keyframeFile : null,
      frameFiles: frameFiles.filter(
        (file): file is File => file instanceof File && file.size > 0,
      ),
    };
  }

  const body = (await req.json()) as {
    prompt?: unknown;
    type?: unknown;
    model?: unknown;
    formats?: unknown;
  };

  return {
    prompt: typeof body.prompt === "string" ? body.prompt.trim().slice(0, USER_PROMPT_MAX_CHARS) : "",
    type: typeof body.type === "string" ? body.type : "",
    model: body.model,
    formats: body.formats,
    inputFile: null,
    keyframeFile: null,
    frameFiles: [],
  };
}

function buildGeneratedDocumentJsonSchema(requireSpreadsheet: boolean) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "summary", "sections", "spreadsheets"],
    properties: {
      title: {
        type: "string",
        minLength: 1,
        maxLength: 120,
      },
      summary: {
        type: "string",
        minLength: 1,
        maxLength: 1200,
      },
      sections: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["heading", "paragraphs", "bullets"],
          properties: {
            heading: {
              type: "string",
              minLength: 1,
              maxLength: 80,
            },
            paragraphs: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              items: {
                type: "string",
                minLength: 1,
                maxLength: 1500,
              },
            },
            bullets: {
              type: "array",
              maxItems: 8,
              items: {
                type: "string",
                minLength: 1,
                maxLength: 200,
              },
            },
            table: {
              type: "object",
              additionalProperties: false,
              required: ["columns", "rows"],
              properties: {
                title: {
                  type: "string",
                  minLength: 1,
                  maxLength: 80,
                },
                columns: {
                  type: "array",
                  minItems: 1,
                  maxItems: 8,
                  items: {
                    type: "string",
                    minLength: 1,
                    maxLength: 40,
                  },
                },
                rows: {
                  type: "array",
                  maxItems: 30,
                  items: {
                    type: "array",
                    minItems: 1,
                    maxItems: 8,
                    items: {
                      type: "string",
                      maxLength: 200,
                    },
                  },
                },
              },
            },
          },
        },
      },
      spreadsheets: {
        type: "array",
        minItems: requireSpreadsheet ? 1 : 0,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "columns", "rows"],
          properties: {
            name: {
              type: "string",
              minLength: 1,
              maxLength: 31,
            },
            columns: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: {
                type: "string",
                minLength: 1,
                maxLength: 40,
              },
            },
            rows: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              items: {
                type: "array",
                minItems: 1,
                maxItems: 8,
                items: {
                  type: "string",
                  maxLength: 200,
                },
              },
            },
          },
        },
      },
    },
  } as const;
}

type ReplicatePredictionPayload = {
  id?: string;
  status?: string;
  error?: unknown;
  output?: unknown;
};

type ReplicateModelDetailPayload = {
  latest_version?: {
    id?: string;
  };
};

type DashScopeTaskPayload = {
  request_id?: string;
  code?: string;
  message?: string;
  output?: {
    task_id?: string;
    task_status?: string;
    results?: unknown;
    video_url?: string;
    image_url?: string;
    audio_url?: string;
  };
};

type DashScopeChatCompletionPayload = {
  id?: string;
  created?: number;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
};

function createRequestTimer(requestId: string) {
  const requestStartedAt = Date.now();

  return {
    phase(label: string, phaseStartedAt: number, extra?: string) {
      const suffix = extra ? `，${extra}` : "";
      console.log(
        `[Generate][${requestId}] ${label}，耗时: ${Date.now() - phaseStartedAt}ms${suffix}`,
      );
    },
    total(label: string, extra?: string) {
      const suffix = extra ? `，${extra}` : "";
      console.log(
        `[Generate][${requestId}] ${label}，总耗时: ${Date.now() - requestStartedAt}ms${suffix}`,
      );
    },
    getTotalMs() {
      return Date.now() - requestStartedAt;
    },
  };
}

function getPositiveIntFromEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function getErrorStatusCode(error: unknown): number {
  if (error && typeof error === "object" && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number") {
      return statusCode;
    }
  }

  return 500;
}

function getResponseHeaderValue(error: unknown, headerName: string): string | null {
  if (!error || typeof error !== "object" || !("responseHeaders" in error)) {
    return null;
  }

  const rawHeaders = (error as { responseHeaders?: unknown }).responseHeaders;
  if (!rawHeaders || typeof rawHeaders !== "object") {
    return null;
  }

  if ("get" in rawHeaders && typeof (rawHeaders as { get?: unknown }).get === "function") {
    const value = (rawHeaders as { get: (name: string) => string | null }).get(headerName);
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  return null;
}

function getNestedErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }

  if ("cause" in error) {
    return getNestedErrorCode((error as { cause?: unknown }).cause);
  }

  return null;
}

function isRateLimitError(error: unknown) {
  const statusCode = getErrorStatusCode(error);
  if (statusCode === 429) {
    return true;
  }

  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const normalizedMessage = rawMessage.toLowerCase();
  return (
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("rate_limited") ||
    normalizedMessage.includes("resource_exhausted")
  );
}

function isNetworkConnectionError(error: unknown) {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const normalizedMessage = rawMessage.toLowerCase();
  const errorCode = (getNestedErrorCode(error) ?? "").toUpperCase();

  if (
    errorCode === "ECONNRESET" ||
    errorCode === "ETIMEDOUT" ||
    errorCode === "ECONNREFUSED" ||
    errorCode === "EAI_AGAIN" ||
    errorCode === "ENOTFOUND" ||
    errorCode === "EPIPE" ||
    errorCode === "UND_ERR_CONNECT_TIMEOUT"
  ) {
    return true;
  }

  return (
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("connect timeout") ||
    normalizedMessage.includes("socket disconnected") ||
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("tls connection")
  );
}

function getRetryDelayMs(error: unknown, attempt: number, baseDelayMs: number) {
  const retryAfter = getResponseHeaderValue(error, "retry-after");
  if (retryAfter) {
    const asSeconds = Number(retryAfter);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return Math.ceil(asSeconds * 1000);
    }
  }

  const jitter = Math.floor(Math.random() * 250);
  return baseDelayMs * Math.pow(2, attempt) + jitter;
}

function waitFor(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractDashScopeErrorMeta(rawMessage: string) {
  const normalizedMessage = rawMessage.trim();
  const jsonStart = normalizedMessage.indexOf("{");
  if (jsonStart < 0) {
    return {
      code: "",
      type: "",
      message: "",
    };
  }

  const payloadText = normalizedMessage.slice(jsonStart).trim();
  if (!payloadText.startsWith("{")) {
    return {
      code: "",
      type: "",
      message: "",
    };
  }

  try {
    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    const nestedError =
      payload.error && typeof payload.error === "object"
        ? (payload.error as Record<string, unknown>)
        : payload;
    const code =
      typeof nestedError.code === "string" ? nestedError.code.trim() : "";
    const type =
      typeof nestedError.type === "string" ? nestedError.type.trim() : "";
    const message =
      typeof nestedError.message === "string" ? nestedError.message.trim() : "";
    return {
      code,
      type,
      message,
    };
  } catch {
    return {
      code: "",
      type: "",
      message: "",
    };
  }
}

function getGenerationErrorMessage(error: unknown) {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : "未知错误";
  const normalizedMessage = rawMessage.toLowerCase();
  const errorCode = (getNestedErrorCode(error) ?? "").toUpperCase();
  const statusCode = getErrorStatusCode(error);
  const retryAfter = getResponseHeaderValue(error, "retry-after");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
  const isDashScopeError = rawMessage.includes("阿里云百炼请求失败");
  const dashScopeError = isDashScopeError
    ? extractDashScopeErrorMeta(rawMessage)
    : { code: "", type: "", message: "" };
  const dashScopeCode = dashScopeError.code.toUpperCase();
  const dashScopeType = dashScopeError.type.toUpperCase();
  const dashScopeMessage = dashScopeError.message.toLowerCase();

  if (rawMessage.includes("Connect Timeout Error")) {
    return "连接模型接口超时，请检查网络或代理配置。";
  }

  if (statusCode === 401 && normalizedMessage.includes("replicate")) {
    return "Replicate 鉴权失败：请检查 REPLICATE_API_TOKEN 是否有效。";
  }

  if (statusCode === 429 && normalizedMessage.includes("replicate")) {
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return `Replicate 当前限流，请约 ${Math.ceil(retryAfterSeconds)} 秒后重试。`;
    }
    return "Replicate 当前限流，请稍后重试。";
  }

  if (
    statusCode === 401 &&
    isDashScopeError &&
    (
      dashScopeCode.includes("INVALID_API_KEY") ||
      dashScopeType.includes("INVALID_API_KEY") ||
      dashScopeMessage.includes("api key") ||
      dashScopeMessage.includes("access key") ||
      dashScopeMessage.includes("unauthorized")
    )
  ) {
    return "阿里云百炼鉴权失败：请检查 DASHSCOPE_API_KEY 是否有效，以及当前环境变量是否已正确加载。";
  }

  if (
    statusCode === 403 &&
    (
      dashScopeCode === "ALLOCATIONQUOTA.FREETIERONLY" ||
      dashScopeType === "ALLOCATIONQUOTA.FREETIERONLY" ||
      dashScopeMessage.includes("free tier of the model has been exhausted")
    )
  ) {
    return "阿里云百炼当前模型的免费额度已用尽，且账号开启了“仅使用免费额度”。请到阿里云百炼控制台关闭该限制或开通付费后重试。";
  }

  if (
    (statusCode === 402 || statusCode === 403) &&
    isDashScopeError &&
    (
      dashScopeCode.includes("BILL") ||
      dashScopeCode.includes("BALANCE") ||
      dashScopeCode.includes("ARREAR") ||
      dashScopeType.includes("BILL") ||
      dashScopeType.includes("BALANCE") ||
      dashScopeType.includes("ARREAR") ||
      dashScopeMessage.includes("insufficient balance") ||
      dashScopeMessage.includes("account balance") ||
      dashScopeMessage.includes("arrears") ||
      dashScopeMessage.includes("overdue")
    )
  ) {
    return "阿里云百炼账户余额不足或账号存在欠费，当前模型调用已被拒绝。请充值或处理欠费后重试。";
  }

  if (
    statusCode === 403 &&
    isDashScopeError &&
    (
      dashScopeCode.includes("NOPERMISSION") ||
      dashScopeCode.includes("FORBIDDEN") ||
      dashScopeType.includes("NOPERMISSION") ||
      dashScopeType.includes("FORBIDDEN") ||
      dashScopeMessage.includes("no permission") ||
      dashScopeMessage.includes("permission denied") ||
      dashScopeMessage.includes("access denied") ||
      dashScopeMessage.includes("not enabled")
    )
  ) {
    return "阿里云百炼当前账号无权访问该模型，或该模型尚未开通。请到控制台确认模型权限、服务开通状态和所属地域配置。";
  }

  if (
    statusCode === 404 &&
    isDashScopeError &&
    (
      dashScopeCode.includes("MODEL") ||
      dashScopeType.includes("MODEL") ||
      dashScopeMessage.includes("model not found") ||
      dashScopeMessage.includes("unknown model") ||
      dashScopeMessage.includes("not found")
    )
  ) {
    return "阿里云百炼模型不存在或当前环境不可用，请检查模型 ID、服务开通状态和区域配置。";
  }

  if (
    statusCode === 429 &&
    isDashScopeError &&
    (
      dashScopeCode.includes("QUOTA") ||
      dashScopeCode.includes("RATE") ||
      dashScopeCode.includes("THROTTLE") ||
      dashScopeType.includes("QUOTA") ||
      dashScopeType.includes("RATE") ||
      dashScopeType.includes("THROTTLE") ||
      dashScopeMessage.includes("rate limit") ||
      dashScopeMessage.includes("quota") ||
      dashScopeMessage.includes("throttle")
    )
  ) {
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return `阿里云百炼当前限流或额度受限，请约 ${Math.ceil(retryAfterSeconds)} 秒后重试。`;
    }
    return "阿里云百炼当前限流或额度受限，请稍后重试。";
  }

  if (isNetworkConnectionError(error)) {
    return `网络连接异常（${errorCode || "NETWORK_ERROR"}），请检查代理或稍后重试。`;
  }

  return rawMessage;
}

function getReplicateApiKeyOrThrow() {
  const apiKey = process.env.REPLICATE_API_TOKEN?.trim();
  if (!apiKey) {
    throw new Error("缺少 REPLICATE_API_TOKEN");
  }

  return apiKey;
}

function getReplicateBaseUrl() {
  return (process.env.REPLICATE_BASE_URL ?? "https://api.replicate.com/v1").replace(/\/+$/, "");
}

async function replicateFetch(path: string, init?: RequestInit) {
  const baseHeaders = new Headers(init?.headers);
  const apiKey = getReplicateApiKeyOrThrow();
  const url = `${getReplicateBaseUrl()}${path}`;

  const requestWithScheme = (scheme: "Bearer" | "Token") => {
    const headers = new Headers(baseHeaders);
    headers.set("Authorization", `${scheme} ${apiKey}`);

    return providerFetch("replicate", url, {
      ...(init ?? {}),
      headers,
    });
  };

  const firstResponse = await requestWithScheme("Bearer");
  if (firstResponse.status !== 401) {
    return firstResponse;
  }

  return requestWithScheme("Token");
}

function splitReplicateModelId(modelId: string) {
  const [owner, name, ...rest] = modelId.split("/");
  if (!owner || !name || rest.length > 0) {
    throw new Error(`Replicate 模型 ID 格式无效：${modelId}`);
  }

  return { owner, name };
}

function normalizeReplicateTextModelId(modelId: string) {
  return modelId === "lucataco/qwen1.5-1.8b-chat" ||
    modelId === "lucataco/qwen1.5-1.8b-chat-detect"
    ? "lucataco/qwen1.5-1.8b"
    : modelId;
}

function normalizeReplicateAudioModelId(modelId: string) {
  return modelId === "codeplugtech/minimax-speech-02-turbo"
    ? "minimax/speech-02-turbo"
    : modelId;
}

function isLegacyReplicateAudioEditingModelId(modelId: string) {
  return modelId === "vaibhavs10/incredibly-fast-whisper+codeplugtech/minimax-speech-02-turbo";
}

function isReplicateAudioEditingPipelineModelId(modelId: string) {
  return (
    modelId === "vaibhavs10/incredibly-fast-whisper+minimax/speech-02-turbo" ||
    isLegacyReplicateAudioEditingModelId(modelId)
  );
}

function resolveDashScopeTextDetectionModelId(modelId: string) {
  return modelId === "qwen-flash-detect" ? "qwen-flash" : modelId;
}

function resolveDashScopeVisualDetectionModelId(modelId: string) {
  if (
    modelId === "qwen-vl-plus-image-detect" ||
    modelId === "qwen-vl-plus-video-detect"
  ) {
    return "qwen-vl-plus";
  }

  if (
    modelId === "qwen3-vl-flash-image-detect" ||
    modelId === "qwen3-vl-flash-video-detect"
  ) {
    return "qwen3-vl-flash";
  }

  return modelId;
}

function resolveDashScopeAudioDetectionModelId(modelId: string) {
  return modelId === "qwen3-omni-flash-realtime-detect"
    ? "qwen3-omni-flash"
    : modelId;
}

function resolveReplicateVisualDetectionModelId(modelId: string) {
  if (
    modelId === "lucataco/qwen-vl-chat-detect" ||
    modelId === "lucataco/qwen-vl-chat-video-detect"
  ) {
    return "lucataco/qwen-vl-chat";
  }

  return modelId;
}

function resolveReplicateAudioDetectionModelId(modelId: string) {
  return modelId === "nvidia/canary-qwen-2.5b-detect"
    ? "nvidia/canary-qwen-2.5b"
    : modelId;
}

function buildReplicateImagePrompt(userPrompt: string) {
  const cleanedPrompt = userPrompt.replace(/\s+/g, " ").trim();
  return [
    `Create one image based on this request: ${cleanedPrompt}.`,
    "Keep composition simple and make the requested subject dominant.",
    "No visible text, letters, logos, subtitles, signs, or watermarks in the image.",
  ].join("\n");
}

function buildReplicateVideoPrompt(userPrompt: string) {
  return [
    "Generate exactly one short video that strictly follows the user's request.",
    "Keep the requested main subject as the dominant subject in every shot.",
    "Keep motion simple, stable, and visually coherent.",
    `User request: ${userPrompt.trim()}`,
    "If the request is in Chinese, understand and execute it correctly.",
  ].join("\n");
}

function buildReplicateDocumentPrompt(userPrompt: string, targetFormat: DocumentFileFormat) {
  const requireSpreadsheet = targetFormat === "xlsx";

  return [
    buildFileGenerationSystemPrompt(targetFormat),
    "Return raw JSON only.",
    "Output JSON keys: title, summary, sections, spreadsheets.",
    "Each section must include heading, paragraphs, bullets, and may include table.",
    "Each spreadsheet must include name, columns, rows.",
    requireSpreadsheet
      ? "Return at least one useful spreadsheet."
      : "Return an empty spreadsheets array unless tabular data is explicitly requested.",
    "",
    buildFileGenerationPrompt(userPrompt, targetFormat),
  ].join("\n");
}

function extractReplicateErrorText(error: unknown) {
  if (typeof error === "string") {
    return error.trim();
  }

  if (error && typeof error === "object") {
    if ("message" in error && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message.trim();
    }

    return JSON.stringify(error);
  }

  return "";
}

function collectUrlsFromUnknown(
  input: unknown,
  urls: Set<string>,
  visited: WeakSet<object>,
  depth: number,
) {
  if (depth > 6 || urls.size >= 8) {
    return;
  }

  if (typeof input === "string") {
    if (/^https?:\/\//i.test(input)) {
      urls.add(input);
    }
    return;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      collectUrlsFromUnknown(item, urls, visited, depth + 1);
      if (urls.size >= 8) {
        break;
      }
    }
    return;
  }

  if (!input || typeof input !== "object") {
    return;
  }

  if (visited.has(input)) {
    return;
  }
  visited.add(input);

  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    collectUrlsFromUnknown(record[key], urls, visited, depth + 1);
    if (urls.size >= 8) {
      break;
    }
  }
}

function extractReplicateOutputUrls(output: unknown) {
  const urls = new Set<string>();
  collectUrlsFromUnknown(output, urls, new WeakSet<object>(), 0);
  return Array.from(urls);
}

function extractReplicateTextOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  if (Array.isArray(output)) {
    return output.map((item) => extractReplicateTextOutput(item)).join("");
  }

  if (!output || typeof output !== "object") {
    return "";
  }

  const record = output as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  if ("output" in record) {
    return extractReplicateTextOutput(record.output);
  }

  if ("data" in record) {
    return extractReplicateTextOutput(record.data);
  }

  return "";
}

async function readReplicateResponseJson(
  response: Response,
): Promise<ReplicatePredictionPayload> {
  if (!response.ok) {
    const detail = (await response.text()).trim();
    const message = `Replicate 请求失败 (HTTP ${response.status})${detail ? `: ${detail}` : ""}`;
    const error = new Error(message) as Error & {
      statusCode?: number;
      responseHeaders?: Headers;
    };
    error.statusCode = response.status;
    error.responseHeaders = response.headers;
    throw error;
  }

  return (await response.json()) as ReplicatePredictionPayload;
}

async function readReplicateJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = (await response.text()).trim();
    const message = `Replicate 请求失败 (HTTP ${response.status})${detail ? `: ${detail}` : ""}`;
    const error = new Error(message) as Error & {
      statusCode?: number;
      responseHeaders?: Headers;
    };
    error.statusCode = response.status;
    error.responseHeaders = response.headers;
    throw error;
  }

  return (await response.json()) as T;
}

async function getReplicateLatestVersionId(modelId: string) {
  const cachedVersionId = cachedReplicateLatestVersionIds.get(modelId);
  if (cachedVersionId) {
    return cachedVersionId;
  }

  const { owner, name } = splitReplicateModelId(modelId);
  const response = await replicateFetch(`/models/${owner}/${name}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const payload = await readReplicateJson<ReplicateModelDetailPayload>(response);
  const versionId = payload.latest_version?.id;
  if (!versionId) {
    throw new Error(`Replicate 模型 ${modelId} 缺少 latest_version，无法创建任务。`);
  }

  cachedReplicateLatestVersionIds.set(modelId, versionId);
  return versionId;
}

async function createReplicatePrediction(
  requestId: string,
  modelId: string,
  input: Record<string, unknown>,
) {
  const normalizedModelId = normalizeReplicateAudioModelId(
    normalizeReplicateTextModelId(modelId),
  );
  const { owner, name } = splitReplicateModelId(normalizedModelId);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: "wait=60",
  };

  let preferVersionEndpoint = false;
  let attempt = 0;

  while (true) {
    try {
      if (!preferVersionEndpoint) {
        const modelEndpointResponse = await replicateFetch(`/models/${owner}/${name}/predictions`, {
          method: "POST",
          headers,
          body: JSON.stringify({ input }),
        });

        if (modelEndpointResponse.status !== 404) {
          return readReplicateResponseJson(modelEndpointResponse);
        }

        preferVersionEndpoint = true;
        console.warn(`[Generate][${requestId}] Replicate 模型端点不可用，自动切换 version 端点`);
      }

      const versionId = await getReplicateLatestVersionId(normalizedModelId);
      const versionEndpointResponse = await replicateFetch("/predictions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          version: versionId,
          input,
        }),
      });

      return readReplicateResponseJson(versionEndpointResponse);
    } catch (error) {
      const canRetry =
        (isRateLimitError(error) || isNetworkConnectionError(error)) &&
        attempt < REPLICATE_CREATE_MAX_RETRIES;
      if (!canRetry) {
        throw error;
      }

      const waitMs = getRetryDelayMs(error, attempt, REPLICATE_CREATE_BASE_DELAY_MS);
      attempt += 1;
      console.warn(
        `[Generate][${requestId}] Replicate 请求异常，${waitMs}ms 后重试 (${attempt}/${REPLICATE_CREATE_MAX_RETRIES})`,
      );
      await waitFor(waitMs);
    }
  }
}

async function fetchReplicatePredictionById(predictionId: string) {
  const response = await replicateFetch(`/predictions/${predictionId}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  return readReplicateResponseJson(response);
}

async function waitForReplicatePredictionResult(
  predictionId: string,
  timeoutMs: number,
  timeoutMessage: string,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const payload = await fetchReplicatePredictionById(predictionId);
    const status = (payload.status ?? "").toLowerCase();

    if (status === "succeeded") {
      return payload;
    }

    if (status === "failed" || status === "canceled") {
      const detail = extractReplicateErrorText(payload.error);
      throw new Error(`Replicate 任务失败${detail ? `: ${detail}` : ""}`);
    }

    await waitFor(REPLICATE_POLL_INTERVAL_MS);
  }

  throw new Error(timeoutMessage);
}

function buildReplicateImageInputs(modelId: string, promptForModel: string) {
  if (modelId === "nvidia/sana-sprint-1.6b") {
    return {
      primaryInput: {
        prompt: promptForModel,
        width: 1536,
        height: 864,
        output_format: "png",
      },
      fallbackInput: {
        prompt: promptForModel,
      },
    };
  }

  return {
    primaryInput: {
      prompt: promptForModel,
      aspect_ratio: "16:9",
      safety_filter_level: "block_medium_and_above",
    },
    fallbackInput: {
      prompt: promptForModel,
    },
  };
}

async function generateImageWithReplicate(requestId: string, modelId: string, prompt: string) {
  const promptForModel = buildReplicateImagePrompt(prompt);
  const { primaryInput, fallbackInput } = buildReplicateImageInputs(
    modelId,
    promptForModel,
  );

  let payload: ReplicatePredictionPayload;
  try {
    payload = await createReplicatePrediction(requestId, modelId, primaryInput);
  } catch (error) {
    if (getErrorStatusCode(error) !== 422) {
      throw error;
    }

    console.warn(`[Generate][${requestId}] Replicate 图片参数不兼容，自动降级为最小输入重试`);
    payload = await createReplicatePrediction(requestId, modelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "succeeded") {
    return payload;
  }
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(`Replicate 图片生成失败${detail ? `: ${detail}` : ""}`);
  }
  if (!payload.id) {
    throw new Error("Replicate 返回结果缺少 prediction id。");
  }

  return waitForReplicatePredictionResult(
    payload.id,
    REPLICATE_IMAGE_TASK_TIMEOUT_MS,
    "Replicate 图片生成超时，请稍后重试。",
  );
}

function buildReplicateAudioPrompt(prompt: string) {
  return prompt.trim();
}

function buildReplicateAudioInputs(modelId: string, promptForModel: string) {
  if (normalizeReplicateAudioModelId(modelId) === "minimax/speech-02-turbo") {
    return {
      primaryInput: {
        text: promptForModel,
        voice_id:
          process.env.REPLICATE_MINIMAX_SPEECH_VOICE_ID?.trim() ||
          "English_Graceful_Woman",
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      fallbackInput: {
        text: promptForModel,
      },
    };
  }

  if (modelId === "stability-ai/stable-audio-2.5") {
    return {
      primaryInput: {
        prompt: promptForModel,
        duration: 10,
      },
      fallbackInput: {
        prompt: promptForModel,
      },
    };
  }

  return {
    primaryInput: {
      prompt: promptForModel,
      duration: 10,
    },
    fallbackInput: {
      prompt: promptForModel,
    },
  };
}

function buildReplicateAudioTimeoutMessage(modelId: string, predictionId: string) {
  return `Replicate 音频生成超时，请稍后重试。model_id: ${modelId} prediction_id: ${predictionId}`;
}

async function generateAudioWithReplicate(requestId: string, modelId: string, prompt: string) {
  const promptForModel = buildReplicateAudioPrompt(prompt);
  const { primaryInput, fallbackInput } = buildReplicateAudioInputs(modelId, promptForModel);

  let payload: ReplicatePredictionPayload;
  try {
    payload = await createReplicatePrediction(requestId, modelId, primaryInput);
  } catch (error) {
    if (getErrorStatusCode(error) !== 422) {
      throw error;
    }

    console.warn(`[Generate][${requestId}] Replicate audio input was rejected, retrying with fallback input`);
    payload = await createReplicatePrediction(requestId, modelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "succeeded") {
    return payload;
  }
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(`Replicate audio generation failed${detail ? `: ${detail}` : ""}`);
  }
  if (!payload.id) {
    throw new Error("Replicate response is missing prediction id.");
  }

  return waitForReplicatePredictionResult(
    payload.id,
    REPLICATE_AUDIO_TASK_TIMEOUT_MS,
    buildReplicateAudioTimeoutMessage(modelId, payload.id),
  );
}

const DEFAULT_VIDEO_DURATION_SECONDS = 5;
const T2V_TURBO_DEFAULT_FPS = 8;
const T2V_TURBO_DEFAULT_FRAME_COUNT =
  DEFAULT_VIDEO_DURATION_SECONDS * T2V_TURBO_DEFAULT_FPS;

function buildReplicateVideoInputs(modelId: string, promptForModel: string) {
  if (modelId === "ji4chenli/t2v-turbo") {
    return {
      primaryInput: {
        prompt: promptForModel,
        num_inference_steps: 4,
        guidance_scale: 7.5,
        num_frames: T2V_TURBO_DEFAULT_FRAME_COUNT,
        fps: T2V_TURBO_DEFAULT_FPS,
      },
      fallbackInput: {
        prompt: promptForModel,
      },
    };
  }

  if (modelId === "minimax/video-01") {
    return {
      primaryInput: {
        prompt: promptForModel,
        prompt_optimizer: true,
      },
      fallbackInput: {
        prompt: promptForModel,
      },
    };
  }

  return {
    primaryInput: {
      prompt: promptForModel,
      duration: DEFAULT_VIDEO_DURATION_SECONDS,
      aspect_ratio: "16:9",
      output_format: "mp4",
    },
    fallbackInput: {
      prompt: promptForModel,
    },
  };
}

function getReplicateVideoTaskTimeoutMs(modelId: string) {
  if (modelId === "minimax/video-01") {
    return REPLICATE_MINIMAX_VIDEO_TASK_TIMEOUT_MS;
  }

  return REPLICATE_VIDEO_TASK_TIMEOUT_MS;
}

function buildReplicateVideoTimeoutMessage(modelId: string, predictionId: string) {
  if (modelId === "minimax/video-01") {
    return [
      `Replicate 视频生成超时：${modelId} 当前排队或生成较慢。`,
      `prediction_id: ${predictionId}`,
      "可稍后重试，或在 .env.local 中增大 REPLICATE_MINIMAX_VIDEO_TASK_TIMEOUT_MS。",
    ].join("\n");
  }

  return `Replicate 视频生成超时，请稍后重试。prediction_id: ${predictionId}`;
}

function buildReplicateVideoEditingTimeoutMessage(modelId: string, predictionId: string) {
  return `Replicate 视频编辑超时，请稍后重试。model_id: ${modelId} prediction_id: ${predictionId}`;
}

async function generateVideoWithReplicate(requestId: string, modelId: string, prompt: string) {
  const promptForModel = buildReplicateVideoPrompt(prompt);
  const { primaryInput, fallbackInput } = buildReplicateVideoInputs(modelId, promptForModel);
  const timeoutMs = getReplicateVideoTaskTimeoutMs(modelId);

  let payload: ReplicatePredictionPayload;
  try {
    payload = await createReplicatePrediction(requestId, modelId, primaryInput);
  } catch (error) {
    if (getErrorStatusCode(error) !== 422) {
      throw error;
    }

    console.warn(`[Generate][${requestId}] Replicate 视频参数不兼容，自动降级为最小输入重试`);
    payload = await createReplicatePrediction(requestId, modelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "succeeded") {
    return payload;
  }
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(`Replicate 视频生成失败${detail ? `: ${detail}` : ""}`);
  }
  if (!payload.id) {
    throw new Error("Replicate 返回结果缺少 prediction id。");
  }

  return waitForReplicatePredictionResult(
    payload.id,
    timeoutMs,
    buildReplicateVideoTimeoutMessage(modelId, payload.id),
  );
}


function getDashScopeApiKeyOrThrow() {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("缺少 DASHSCOPE_API_KEY");
  }

  return apiKey;
}

function getDashScopeBaseUrl() {
  return (process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com").replace(/\/+$/, "");
}

function getDashScopeCompatibleBaseUrl() {
  return `${getDashScopeBaseUrl()}/compatible-mode/v1`;
}

function getProxyProviderByModelProvider(provider: GenerationItem["provider"]) {
  if (provider === "mistral") {
    return "mistral" as const;
  }

  if (provider === "aliyun") {
    return "aliyun" as const;
  }

  return "replicate" as const;
}

function createTimeoutError(message: string, statusCode = 504) {
  const error = new Error(message) as Error & {
    statusCode?: number;
  };
  error.statusCode = statusCode;
  return error;
}

function createAbortSignalWithTimeout(timeoutMs: number, upstreamSignal?: AbortSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(createTimeoutError(`阿里云百炼请求超时（>${timeoutMs}ms）。`, 504));
  }, timeoutMs);

  const abortFromUpstream = () => {
    controller.abort(upstreamSignal?.reason);
  };

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId);
      if (upstreamSignal) {
        upstreamSignal.removeEventListener("abort", abortFromUpstream);
      }
    },
  };
}

async function dashScopeFetch(pathOrUrl: string, init?: RequestInit, timeoutMs?: number) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${getDashScopeApiKeyOrThrow()}`);

  const url = /^https?:\/\//i.test(pathOrUrl)
    ? pathOrUrl
    : `${getDashScopeBaseUrl()}${pathOrUrl}`;

  const timeoutController =
    typeof timeoutMs === "number" && timeoutMs > 0
      ? createAbortSignalWithTimeout(timeoutMs, init?.signal ?? undefined)
      : null;

  try {
    return await providerFetch("aliyun", url, {
      ...(init ?? {}),
      headers,
      signal: timeoutController?.signal ?? init?.signal,
    });
  } catch (error) {
    if (timeoutController?.signal.aborted && !(init?.signal?.aborted ?? false)) {
      throw createTimeoutError(`阿里云百炼请求超时（>${timeoutMs}ms）。`, 504);
    }

    throw error;
  } finally {
    timeoutController?.cleanup();
  }
}

async function readDashScopeJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = (await response.text()).trim();
    const message = `阿里云百炼请求失败 (HTTP ${response.status})${detail ? `: ${detail}` : ""}`;
    const error = new Error(message) as Error & {
      statusCode?: number;
      responseHeaders?: Headers;
    };
    error.statusCode = response.status;
    error.responseHeaders = response.headers;
    throw error;
  }

  return (await response.json()) as T;
}

async function readDashScopeBinary(response: Response) {
  if (!response.ok) {
    const detail = (await response.text()).trim();
    const message = `阿里云百炼请求失败 (HTTP ${response.status})${detail ? `: ${detail}` : ""}`;
    const error = new Error(message) as Error & {
      statusCode?: number;
      responseHeaders?: Headers;
    };
    error.statusCode = response.status;
    error.responseHeaders = response.headers;
    throw error;
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg";
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { contentType, bytes };
}

function extractDashScopeErrorText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code.trim() : "";
  const message = typeof record.message === "string" ? record.message.trim() : "";
  return [code, message].filter(Boolean).join(": ");
}

function getDashScopeTaskId(payload: DashScopeTaskPayload) {
  return payload.output?.task_id?.trim() || null;
}

function getDashScopeTaskStatus(payload: DashScopeTaskPayload) {
  return (payload.output?.task_status ?? "").trim().toUpperCase();
}

async function createDashScopeAsyncTask(
  path: string,
  body: Record<string, unknown>,
) {
  const response = await dashScopeFetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify(body),
  });

  return readDashScopeJson<DashScopeTaskPayload>(response);
}

async function waitForDashScopeTaskResult(
  taskId: string,
  timeoutMs: number,
  timeoutMessage: string,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const response = await dashScopeFetch(`/api/v1/tasks/${taskId}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await readDashScopeJson<DashScopeTaskPayload>(response);
    const status = getDashScopeTaskStatus(payload);

    if (status === "SUCCEEDED") {
      return payload;
    }

    if (status === "FAILED" || status === "CANCELED") {
      const detail = extractDashScopeErrorText(payload);
      throw new Error(`阿里云百炼任务失败${detail ? `: ${detail}` : ""}`);
    }

    await waitFor(DASHSCOPE_POLL_INTERVAL_MS);
  }

  throw new Error(timeoutMessage);
}

function stripMarkdownCodeFence(rawText: string) {
  return rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractJsonObjectText(rawText: string) {
  const cleaned = stripMarkdownCodeFence(rawText);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

function extractChatMessageText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      return typeof (item as { text?: unknown }).text === "string"
        ? (item as { text: string }).text
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

function truncateText(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return trimmed.slice(0, maxLength).trim();
}

type DetectionVerdict = "likely_ai" | "uncertain" | "likely_human";

type NormalizedDetectionResult = {
  probability: number;
  confidence: number;
  verdict: DetectionVerdict;
  reasons: string[];
  frameProbabilities?: number[];
};

function getRuntimeLocale() {
  return IS_DOMESTIC_RUNTIME ? "zh" : "en";
}

function clampPercentage(value: number, fallback = 50) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function parsePercentageValue(value: unknown, fallback = 50) {
  if (typeof value === "number") {
    return clampPercentage(value <= 1 ? value * 100 : value, fallback);
  }

  if (typeof value === "string") {
    const matched = value.trim().match(/-?\d+(?:\.\d+)?/);
    if (!matched) {
      return fallback;
    }
    const numeric = Number(matched[0]);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return clampPercentage(numeric <= 1 ? numeric * 100 : numeric, fallback);
  }

  return fallback;
}

function parseConfidenceValue(value: unknown, fallback = 60) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["high", "strong", "高", "较高"].includes(normalized)) {
      return 85;
    }
    if (["medium", "mid", "moderate", "中", "一般"].includes(normalized)) {
      return 60;
    }
    if (["low", "弱", "低", "较低"].includes(normalized)) {
      return 35;
    }
  }

  return parsePercentageValue(value, fallback);
}

function normalizeReasonList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 5);
}

function resolveDetectionVerdict(probability: number, requested?: unknown): DetectionVerdict {
  if (typeof requested === "string") {
    const normalized = requested.trim().toLowerCase();
    if (["likely_ai", "ai", "likely-ai", "ai_generated"].includes(normalized)) {
      return "likely_ai";
    }
    if (["likely_human", "human", "human_written", "human_made"].includes(normalized)) {
      return "likely_human";
    }
    if (["uncertain", "unknown", "mixed"].includes(normalized)) {
      return "uncertain";
    }
  }

  if (probability >= 70) {
    return "likely_ai";
  }
  if (probability <= 30) {
    return "likely_human";
  }
  return "uncertain";
}

function normalizeDetectionResult(rawText: string): NormalizedDetectionResult {
  let parsed: Record<string, unknown> = {};

  try {
    parsed = JSON.parse(extractJsonObjectText(rawText)) as Record<string, unknown>;
  } catch (error) {
    console.warn("[Generate][detect] parse detection JSON failed:", error);
  }

  const probability = parsePercentageValue(
    parsed.probability ?? parsed.ai_probability ?? parsed.score ?? parsed.likelihood,
    50,
  );
  const confidence = parseConfidenceValue(
    parsed.confidence ?? parsed.confidence_score,
    probability >= 70 || probability <= 30 ? 75 : 55,
  );
  const frameProbabilities = Array.isArray(parsed.frame_probabilities)
    ? parsed.frame_probabilities
        .map((item) => parsePercentageValue(item, NaN))
        .filter((item) => Number.isFinite(item))
        .slice(0, 6)
    : undefined;
  const reasons = normalizeReasonList(parsed.reasons ?? parsed.evidence ?? parsed.signals);
  const verdict = resolveDetectionVerdict(probability, parsed.verdict);

  return {
    probability,
    confidence,
    verdict,
    reasons:
      reasons.length > 0
        ? reasons
        : [
            getRuntimeLocale() === "zh"
              ? "模型未返回明确依据，建议结合人工复核。"
              : "The model did not return clear evidence. Manual review is recommended.",
          ],
    frameProbabilities,
  };
}

function getDetectionVerdictLabel(verdict: DetectionVerdict, locale: "zh" | "en") {
  if (locale === "zh") {
    if (verdict === "likely_ai") {
      return "高概率为 AI 生成";
    }
    if (verdict === "likely_human") {
      return "更可能为人工创作";
    }
    return "暂不确定";
  }

  if (verdict === "likely_ai") {
    return "Likely AI-generated";
  }
  if (verdict === "likely_human") {
    return "Likely human-created";
  }
  return "Uncertain";
}

function getConfidenceLabel(score: number, locale: "zh" | "en") {
  if (locale === "zh") {
    if (score >= 80) {
      return "高";
    }
    if (score >= 55) {
      return "中";
    }
    return "低";
  }

  if (score >= 80) {
    return "High";
  }
  if (score >= 55) {
    return "Medium";
  }
  return "Low";
}

function buildDetectionSummary(result: NormalizedDetectionResult, locale: "zh" | "en") {
  return locale === "zh"
    ? `AI 生成概率 ${result.probability}% · ${getDetectionVerdictLabel(result.verdict, locale)}`
    : `${result.probability}% AI probability · ${getDetectionVerdictLabel(result.verdict, locale)}`;
}

function buildDetectionText(
  result: NormalizedDetectionResult,
  locale: "zh" | "en",
) {
  const lines =
    locale === "zh"
      ? [
          `检测结论：${getDetectionVerdictLabel(result.verdict, locale)}`,
          `AI 生成概率：${result.probability}%`,
          `置信度：${getConfidenceLabel(result.confidence, locale)}（${result.confidence}%）`,
        ]
      : [
          `Verdict: ${getDetectionVerdictLabel(result.verdict, locale)}`,
          `AI Probability: ${result.probability}%`,
          `Confidence: ${getConfidenceLabel(result.confidence, locale)} (${result.confidence}%)`,
        ];

  if (result.frameProbabilities && result.frameProbabilities.length > 0) {
    lines.push(
      locale === "zh"
        ? `关键帧概率：${result.frameProbabilities.map((item) => `${item}%`).join("、")}`
        : `Frame Probabilities: ${result.frameProbabilities.map((item) => `${item}%`).join(", ")}`,
    );
  }

  lines.push(locale === "zh" ? "判定依据：" : "Reasons:");
  result.reasons.forEach((reason) => {
    lines.push(locale === "zh" ? `- ${reason}` : `- ${reason}`);
  });
  lines.push(
    locale === "zh"
      ? "说明：该结果为概率判断，不等同于司法或平台官方鉴定。"
      : "Note: This is a probabilistic assessment, not a forensic or platform-certified verdict.",
  );

  return lines.join("\n");
}

function buildStructuredDetectionInstruction(target: "document" | "image" | "audio" | "video", locale: "zh" | "en") {
  if (locale === "zh") {
    return [
      `你是专业的${target === "document" ? "文档" : target === "image" ? "图片" : target === "audio" ? "音频" : "视频"} AI 来源检测助手。`,
      "请仅根据给定内容估计它是 AI 生成的概率，不要编造无法观察到的事实。",
      "返回严格 JSON，不要输出 Markdown，不要补充解释。",
      'JSON 格式：{"probability":0-100,"confidence":0-100,"verdict":"likely_ai|uncertain|likely_human","reasons":["依据1","依据2"]}',
      target === "video"
        ? '如果收到多张关键帧，请额外返回 "frame_probabilities": [0-100,0-100,...]，并给出整体平均概率。'
        : "reasons 请控制在 2-4 条，并尽量具体。",
    ].join("\n");
  }

  return [
    `You are a professional AI-origin detector for ${target}.`,
    "Estimate the probability that the content is AI-generated using only the provided evidence.",
    "Return strict JSON only. No markdown. No extra explanation.",
    'JSON schema: {"probability":0-100,"confidence":0-100,"verdict":"likely_ai|uncertain|likely_human","reasons":["reason 1","reason 2"]}',
    target === "video"
      ? 'If you receive multiple keyframes, also return "frame_probabilities": [0-100, ...] and set "probability" to the overall mean estimate.'
      : "Keep reasons concrete and concise.",
  ].join("\n");
}

function resolveDetectionTargetType(type: string): "text" | "image" | "audio" | "video" {
  if (type.endsWith("image")) {
    return "image";
  }
  if (type.endsWith("video")) {
    return "video";
  }
  if (type.endsWith("audio")) {
    return "audio";
  }
  return "text";
}

function resolveDetectionRiskLevel(probability: number): "low" | "medium" | "high" {
  if (probability >= 70) {
    return "high";
  }
  if (probability >= 40) {
    return "medium";
  }
  return "low";
}

function mapDetectionVerdictToDbValue(verdict: DetectionVerdict) {
  if (verdict === "likely_ai") {
    return "ai_generated";
  }
  if (verdict === "likely_human") {
    return "human";
  }
  return "uncertain";
}

function extractTextFragments(value: unknown, depth = 0): string[] {
  if (depth > 3 || value == null) {
    return [];
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextFragments(item, depth + 1));
  }

  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const preferredKeys = [
    "text",
    "content",
    "contents",
    "description",
    "summary",
    "value",
    "body",
    "paragraphs",
    "paragraph",
    "detail",
    "details",
    "message",
    "note",
    "notes",
  ];

  const fragments: string[] = [];
  for (const key of preferredKeys) {
    if (key in record) {
      fragments.push(...extractTextFragments(record[key], depth + 1));
    }
  }

  return fragments;
}

function uniqueTexts(values: string[], maxItems: number, maxLength: number) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = truncateText(value, maxLength);
    if (!normalized) {
      continue;
    }

    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    result.push(normalized);
    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function firstNonEmptyText(record: Record<string, unknown>, keys: string[], maxLength: number) {
  for (const key of keys) {
    if (!(key in record)) {
      continue;
    }

    const fragments = extractTextFragments(record[key]);
    if (fragments.length > 0) {
      return truncateText(fragments[0], maxLength);
    }
  }

  return "";
}

function buildTableRows(
  rowsSource: unknown,
  columns: string[],
  maxRows: number,
  cellMaxLength: number,
) {
  if (!Array.isArray(rowsSource) || columns.length === 0) {
    return [];
  }

  return rowsSource
    .slice(0, maxRows)
    .map((row) => {
      if (Array.isArray(row)) {
        return columns.map((_, columnIndex) => {
          const cell = row[columnIndex];
          const fragments = extractTextFragments(cell);
          return truncateText(fragments[0] ?? "", cellMaxLength);
        });
      }

      if (row && typeof row === "object") {
        const record = row as Record<string, unknown>;
        return columns.map((column) => {
          const fragments = extractTextFragments(record[column]);
          return truncateText(fragments[0] ?? "", cellMaxLength);
        });
      }

      const fragments = extractTextFragments(row);
      return [truncateText(fragments[0] ?? "", cellMaxLength), ...columns.slice(1).map(() => "")];
    })
    .filter((row) => row.some((cell) => cell.length > 0));
}

function extractColumnsFromRows(rowsSource: unknown, maxColumns: number) {
  if (!Array.isArray(rowsSource) || rowsSource.length === 0) {
    return [];
  }

  const firstRow = rowsSource.find((row) => row != null);
  if (!firstRow) {
    return [];
  }

  if (Array.isArray(firstRow)) {
    return firstRow
      .slice(0, maxColumns)
      .map((_, index) => `?${index + 1}`);
  }

  if (typeof firstRow === "object") {
    return Object.keys(firstRow as Record<string, unknown>)
      .map((key) => truncateText(key, 40))
      .filter(Boolean)
      .slice(0, maxColumns);
  }

  return ["??"];
}

function normalizeTabularData(
  value: unknown,
  options: { maxRows: number; maxColumns: number; titleFallback: string },
) {
  if (!value) {
    return null;
  }

  const record = (value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const rowsSource =
    (Array.isArray(value) ? value : null) ??
    (Array.isArray(record.rows) ? record.rows : null) ??
    (Array.isArray(record.data) ? record.data : null) ??
    (Array.isArray(record.items) ? record.items : null) ??
    (Array.isArray(record.records) ? record.records : null);

  const columns = uniqueTexts(
    [
      ...extractTextFragments(record.columns),
      ...extractTextFragments(record.headers),
      ...extractTextFragments(record.header),
      ...extractTextFragments(record.fields),
      ...extractColumnsFromRows(rowsSource, options.maxColumns),
    ],
    options.maxColumns,
    40,
  );

  const rows = buildTableRows(rowsSource, columns, options.maxRows, 200);
  if (columns.length === 0 || rows.length === 0) {
    return null;
  }

  const title = firstNonEmptyText(record, ["title", "name", "label"], 80) || options.titleFallback;
  return {
    title,
    columns,
    rows,
  };
}

function normalizeSection(
  value: unknown,
  index: number,
): GeneratedDocument["sections"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const heading =
    firstNonEmptyText(record, ["heading", "title", "name", "section", "label"], 80) ||
    `?? ${index + 1}`;

  const paragraphs = uniqueTexts(
    [
      ...extractTextFragments(record.paragraphs),
      ...extractTextFragments(record.paragraph),
      ...extractTextFragments(record.content),
      ...extractTextFragments(record.contents),
      ...extractTextFragments(record.body),
      ...extractTextFragments(record.text),
      ...extractTextFragments(record.description),
      ...extractTextFragments(record.summary),
    ],
    4,
    1500,
  );

  const bullets = uniqueTexts(
    [
      ...extractTextFragments(record.bullets),
      ...extractTextFragments(record.points),
      ...extractTextFragments(record.items),
      ...extractTextFragments(record.list),
    ],
    8,
    200,
  );

  const normalizedTable = normalizeTabularData(
    record.table ?? record.dataset ?? record.matrix ?? record.spreadsheet,
    {
      maxRows: 30,
      maxColumns: 8,
      titleFallback: `${heading} ??`,
    },
  );

  const finalParagraphs =
    paragraphs.length > 0
      ? paragraphs
      : bullets.length > 0
        ? [truncateText(bullets.join("\uFF1B"), 1500)]
        : [`\u56F4\u7ED5\u201C${heading}\u201D\u6574\u7406\u7684\u5185\u5BB9\u3002`];

  return {
    heading,
    paragraphs: finalParagraphs,
    bullets,
    ...(normalizedTable
      ? {
          table: normalizedTable,
        }
      : {}),
  };
}

function buildFallbackSections(summary: string) {
  return [
    {
      heading: "\u5185\u5BB9\u6982\u89C8",
      paragraphs: [truncateText(summary, 1500)],
      bullets: [],
    },
  ] satisfies GeneratedDocument["sections"];
}

function normalizeSpreadsheet(
  value: unknown,
  index: number,
): GeneratedDocument["spreadsheets"][number] | null {
  const normalized = normalizeTabularData(value, {
    maxRows: 50,
    maxColumns: 8,
    titleFallback: `Table ${index + 1}`,
  });
  if (!normalized) {
    return null;
  }

  return {
    name: truncateText(normalized.title, 31),
    columns: normalized.columns,
    rows: normalized.rows,
  };
}

function buildFallbackSpreadsheet(sections: GeneratedDocument["sections"]) {
  return {
    name: "Sheet 1",
    columns: ["Section", "Content"],
    rows: sections.slice(0, 8).map((section) => [section.heading, section.paragraphs[0] ?? ""]),
  } satisfies GeneratedDocument["spreadsheets"][number];
}

function normalizeGeneratedDocumentPayload(
  raw: unknown,
  prompt: string,
  requireSpreadsheet: boolean,
): GeneratedDocument {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const normalizedSections = (
    Array.isArray(record.sections)
      ? record.sections
      : Array.isArray(record.chapters)
        ? record.chapters
        : Array.isArray(record.parts)
          ? record.parts
          : Array.isArray(record.outline)
            ? record.outline
            : []
  )
    .map((item, index) => normalizeSection(item, index))
    .filter((item): item is GeneratedDocument["sections"][number] => item !== null)
    .slice(0, 8);

  const title =
    firstNonEmptyText(record, ["title", "name", "headline", "topic"], 120) ||
    truncateText(prompt, 120) ||
    "Edited Document";

  const summary =
    firstNonEmptyText(record, ["summary", "abstract", "overview", "description"], 1200) ||
    truncateText(
      normalizedSections.flatMap((section) => section.paragraphs).join(" ") ||
        "Edited document content.",
      1200,
    );

  const sections = normalizedSections.length >= 1 ? normalizedSections : buildFallbackSections(summary);

  const spreadsheets = (
    Array.isArray(record.spreadsheets)
      ? record.spreadsheets
      : Array.isArray(record.tables)
        ? record.tables
        : Array.isArray(record.sheets)
          ? record.sheets
          : []
  )
    .map((item, index) => normalizeSpreadsheet(item, index))
    .filter((item): item is GeneratedDocument["spreadsheets"][number] => item !== null)
    .slice(0, 3);

  return {
    title,
    summary,
    sections,
    spreadsheets:
      spreadsheets.length > 0
        ? spreadsheets
        : requireSpreadsheet
          ? [buildFallbackSpreadsheet(sections)]
          : [],
  };
}

async function requestDashScopeChatCompletion(body: Record<string, unknown>) {
  const response = await dashScopeFetch(
    `${getDashScopeCompatibleBaseUrl()}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
    DASHSCOPE_CHAT_COMPLETION_TIMEOUT_MS,
  );

  return readDashScopeJson<DashScopeChatCompletionPayload>(response);
}

async function requestDashScopeChatCompletionStreamText(
  body: Record<string, unknown>,
) {
  const response = await dashScopeFetch(
    `${getDashScopeCompatibleBaseUrl()}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        ...body,
        stream: true,
      }),
    },
    DASHSCOPE_CHAT_COMPLETION_TIMEOUT_MS,
  );

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `阿里云百炼流式请求失败 (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  if (!response.body) {
    throw new Error("阿里云百炼未返回可读取的流式响应。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";

  const appendChunkText = (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }

    const record = payload as {
      choices?: Array<{
        delta?: {
          content?: unknown;
        };
        message?: {
          content?: unknown;
        };
      }>;
    };
    const choice = Array.isArray(record.choices) ? record.choices[0] : null;
    const deltaContent = choice?.delta?.content;
    const messageContent = choice?.message?.content;
    const textChunk =
      typeof deltaContent === "string"
        ? deltaContent
        : extractChatMessageText(deltaContent) ||
          (typeof messageContent === "string"
            ? messageContent
            : extractChatMessageText(messageContent));
    if (textChunk) {
      outputText += textChunk;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }

      const payloadText = trimmed.slice(5).trim();
      if (!payloadText || payloadText === "[DONE]") {
        continue;
      }

      try {
        appendChunkText(JSON.parse(payloadText));
      } catch (error) {
        console.warn("[Generate][DashScope] failed to parse stream chunk:", error);
      }
    }

    if (done) {
      break;
    }
  }

  if (!outputText.trim()) {
    throw new Error("阿里云百炼未返回可解析的流式文本内容。");
  }

  return outputText;
}

function supportsDashScopeJsonSchema(modelId: string) {
  return DASHSCOPE_JSON_SCHEMA_MODEL_IDS.has(modelId);
}

function shouldDisableThinkingForDashScopeDocumentMode(
  modelId: string,
  _mode: DashScopeDocumentResponseMode,
) {
  return modelId === "qwen3.5-flash" || modelId === "qwen-flash";
}

function buildDashScopeDocumentResponseCandidates(modelId: string): DashScopeDocumentResponseMode[] {
  const cachedMode = cachedDashScopeDocumentResponseMode.get(modelId);
  if (cachedMode) {
    return [cachedMode];
  }

  if (supportsDashScopeJsonSchema(modelId)) {
    return ["json_schema", "json_object", "prompt_only"];
  }

  return ["json_object", "prompt_only"];
}

function buildDashScopeDocumentRequest(
  baseRequest: Record<string, unknown>,
  modelId: string,
  mode: DashScopeDocumentResponseMode,
  requireSpreadsheet: boolean,
) {
  const request = {
    ...baseRequest,
  } as Record<string, unknown>;

  if (shouldDisableThinkingForDashScopeDocumentMode(modelId, mode)) {
    request.enable_thinking = false;
  }

  if (mode === "json_schema") {
    return {
      ...request,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "generated_document",
          strict: true,
          schema: buildGeneratedDocumentJsonSchema(requireSpreadsheet),
        },
      },
    };
  }

  if (mode === "json_object") {
    return {
      ...request,
      response_format: {
        type: "json_object",
      },
    };
  }

  return request;
}

function shouldRequireSpreadsheet(formats: readonly DocumentFileFormat[]) {
  return formats.includes("xlsx");
}

function getDocumentFormatGenerationGuidance(targetFormat: DocumentFileFormat) {
  if (targetFormat === "xlsx") {
    return [
      "Target export format: Excel (.xlsx).",
      "Focus on structured spreadsheet data.",
      "Include at least one spreadsheet with a clear sheet name, useful columns, and complete rows.",
      "Keep sections concise; the spreadsheet is the primary deliverable.",
    ];
  }

  if (targetFormat === "docx") {
    return [
      "Target export format: Word (.docx).",
      "Focus on prose sections, readable headings, and polished paragraphs.",
      "Keep the spreadsheets array empty unless the user explicitly requests tabular output.",
    ];
  }

  if (targetFormat === "pdf") {
    return [
      "Target export format: PDF.",
      "Focus on clean narrative structure with concise headings and readable paragraphs.",
      "Keep the spreadsheets array empty unless the user explicitly requests tabular output.",
    ];
  }

  if (targetFormat === "md") {
    return [
      "Target export format: Markdown (.md).",
      "Use a markdown-friendly structure with clear headings and concise paragraphs.",
      "Keep the spreadsheets array empty unless the user explicitly requests tabular output.",
    ];
  }

  return [
    "Target export format: TXT (.txt).",
    "Use plain-text-friendly structure with simple headings and readable paragraphs.",
    "Keep the spreadsheets array empty unless the user explicitly requests tabular output.",
  ];
}

function buildFileGenerationSystemPrompt(targetFormat: DocumentFileFormat) {
  const requireSpreadsheet = targetFormat === "xlsx";

  return [
    ...FILE_GENERATION_SYSTEM_PROMPT_LINES,
    ...getDocumentFormatGenerationGuidance(targetFormat),
    requireSpreadsheet
      ? "Include at least one meaningful spreadsheet that matches the user's request."
      : "Return an empty spreadsheets array unless tabular data is explicitly requested.",
  ].join("\n");
}

function parseGeneratedDocumentFromRawText(
  rawText: string,
  prompt: string,
  requireSpreadsheet: boolean,
) {
  const rawDocument = JSON.parse(extractJsonObjectText(rawText));
  const documentSchema = getGeneratedDocumentSchema({ requireSpreadsheet });
  const directResult = documentSchema.safeParse(rawDocument);
  if (directResult.success) {
    return directResult.data;
  }

  const normalizedDocument = normalizeGeneratedDocumentPayload(
    rawDocument,
    prompt,
    requireSpreadsheet,
  );
  const normalizedResult = documentSchema.safeParse(normalizedDocument);
  if (normalizedResult.success) {
    return normalizedResult.data;
  }

  throw normalizedResult.error;
}

async function generateDocumentWithDashScope(
  requestId: string,
  modelId: string,
  prompt: string,
  targetFormat: DocumentFileFormat,
) {
  const requireSpreadsheet = targetFormat === "xlsx";
  const systemPrompt = `${buildFileGenerationSystemPrompt(targetFormat)} Respond with raw JSON only.`;
  const baseRequest = {
    model: modelId,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: buildFileGenerationPrompt(prompt, targetFormat),
      },
    ],
    temperature: 0.3,
    max_tokens: DOCUMENT_GENERATION_MAX_TOKENS,
  };

  let payload: DashScopeChatCompletionPayload;
  let completionMode: DashScopeDocumentResponseMode = "prompt_only";
  const completionStartedAt = Date.now();

  const candidateModes = buildDashScopeDocumentResponseCandidates(modelId);
  let lastError: unknown;
  for (const candidateMode of candidateModes) {
    try {
      console.log(
        `[Generate][${requestId}][DashScope][document] 发起 chat/completions，请求模式: ${candidateMode}，超时: ${DASHSCOPE_CHAT_COMPLETION_TIMEOUT_MS}ms`,
      );
      payload = await requestDashScopeChatCompletion(
        buildDashScopeDocumentRequest(baseRequest, modelId, candidateMode, requireSpreadsheet),
      );
      completionMode = candidateMode;
      cachedDashScopeDocumentResponseMode.set(modelId, candidateMode);
      break;
    } catch (error) {
      lastError = error;
      if (getErrorStatusCode(error) !== 400 && getErrorStatusCode(error) !== 422) {
        throw error;
      }

      console.warn(
        `[Generate][${requestId}][DashScope][document] 模型 ${modelId} 不支持 ${candidateMode}，准备回退。`,
      );
    }
  }

  if (!payload!) {
    throw lastError ?? new Error(`阿里云百炼文档生成失败，模型 ${modelId} 未返回有效结果。`);
  }

  console.log(
    `[Generate][${requestId}][DashScope][document] chat/completions 完成，耗时: ${Date.now() - completionStartedAt}ms，模式: ${completionMode}`,
  );

  const content = extractChatMessageText(payload.choices?.[0]?.message?.content);
  if (!content.trim()) {
    throw new Error("阿里云百炼文档生成未返回可解析内容。");
  }

  console.log(`[Generate][${requestId}][DashScope] AI返回内容:`, content.substring(0, 500));
  const result = parseGeneratedDocumentFromRawText(content, prompt, requireSpreadsheet);
  console.log(`[Generate][${requestId}][DashScope] 解析结果:`, JSON.stringify(result).substring(0, 300));
  return result;
}async function generateDocumentWithReplicate(
  requestId: string,
  modelId: string,
  prompt: string,
  targetFormat: DocumentFileFormat,
) {
  const requireSpreadsheet = targetFormat === "xlsx";
  const normalizedModelId = normalizeReplicateTextModelId(modelId);
  const documentPrompt = buildReplicateDocumentPrompt(prompt, targetFormat);
  const primaryInput = {
    prompt: documentPrompt,
    max_new_tokens: DOCUMENT_GENERATION_MAX_TOKENS,
    temperature: 0.3,
    top_p: 0.95,
  };
  const fallbackInput = {
    prompt: documentPrompt,
  };

  let payload: ReplicatePredictionPayload;
  try {
    payload = await createReplicatePrediction(requestId, normalizedModelId, primaryInput);
  } catch (error) {
    if (getErrorStatusCode(error) !== 422) {
      throw error;
    }

    console.warn(
      `[Generate][${requestId}] Replicate ???????????????????`,
    );
    payload = await createReplicatePrediction(requestId, normalizedModelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(`Replicate ??????${detail ? `: ${detail}` : ""}`);
  }

  const finalPayload =
    status === "succeeded"
      ? payload
      : await (() => {
          if (!payload.id) {
            throw new Error("Replicate ?????? prediction id?");
          }

          return waitForReplicatePredictionResult(
            payload.id,
            REPLICATE_TEXT_TASK_TIMEOUT_MS,
            `Replicate ?????????????prediction_id: ${payload.id}`,
          );
        })();

  const content = extractReplicateTextOutput(finalPayload.output);
  if (!content.trim()) {
    throw new Error("Replicate ?????????????");
  }

  return parseGeneratedDocumentFromRawText(content, prompt, requireSpreadsheet);
}

function resolveDashScopeDocumentEditModelId(modelId: string) {
  return modelId === "qwen-flash-edit" ? "qwen-flash" : modelId;
}

function getUploadFileExtension(fileName: string) {
  const matched = fileName.trim().toLowerCase().match(/\.([a-z0-9]{1,16})$/);
  return matched?.[1] ?? "";
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeEditablePlainText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTextFromWordXml(xml: string) {
  return normalizeEditablePlainText(
    decodeXmlEntities(xml)
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<w:cr\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<[^>]+>/g, " "),
  );
}

async function extractTextFromDocxBuffer(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const xmlPaths = Object.keys(zip.files).filter((path) =>
    /^word\/(document|header\d+|footer\d+)\.xml$/i.test(path),
  );

  const parts = await Promise.all(
    xmlPaths.map(async (path) => {
      const file = zip.file(path);
      return file ? extractTextFromWordXml(await file.async("text")) : "";
    }),
  );

  return normalizeEditablePlainText(parts.filter(Boolean).join("\n\n"));
}

async function extractTextFromXlsxBuffer(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  const workbookBuffer =
    Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(workbookBuffer);

  const sections = workbook.worksheets
    .map((sheet) => {
      const rows = sheet
        .getSheetValues()
        .slice(1, 61)
        .map((row) => {
          if (!Array.isArray(row)) {
            return "";
          }

          return row
            .slice(1, 21)
            .map((cell) => {
              if (cell == null) {
                return "";
              }
              if (typeof cell === "object" && "text" in cell) {
                return String((cell as { text?: unknown }).text ?? "").trim();
              }
              return String(cell).trim();
            })
            .filter(Boolean)
            .join("\t");
        })
        .filter(Boolean);

      if (rows.length === 0) {
        return "";
      }

      return [`工作表：${sheet.name}`, ...rows].join("\n");
    })
    .filter(Boolean);

  return normalizeEditablePlainText(sections.join("\n\n"));
}

async function extractEditableDocumentText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = getUploadFileExtension(file.name);

  if (extension === "txt" || extension === "md") {
    return normalizeEditablePlainText(Buffer.from(bytes).toString("utf8"));
  }

  if (extension === "docx") {
    return extractTextFromDocxBuffer(bytes);
  }

  if (extension === "xlsx") {
    return extractTextFromXlsxBuffer(bytes);
  }

  if (extension === "pdf") {
    return extractTextFromPdfBuffer(bytes);
  }

  throw new Error("当前文档编辑仅支持 TXT、MD、DOCX、XLSX、PDF 文件。");
}

async function extractDetectableDocumentText(file: File) {
  try {
    return await extractEditableDocumentText(file);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("当前文档编辑仅支持")
    ) {
      throw new Error("当前文档检测仅支持 TXT、MD、DOCX、XLSX、PDF 文件。");
    }
    throw error;
  }
}

function buildDocumentDetectionPrompt(input: {
  fileName: string;
  extractedText: string;
  locale: "zh" | "en";
}) {
  if (input.locale === "zh") {
    return [
      `文件名：${input.fileName}`,
      "请判断以下文档内容更像 AI 生成还是人工创作。",
      "重点观察语言重复度、结构均匀性、信息密度、措辞模板化、论证跳跃等信号。",
      "文档内容：",
      truncateText(input.extractedText, DETECTION_SOURCE_MAX_CHARS),
    ].join("\n\n");
  }

  return [
    `File name: ${input.fileName}`,
    "Estimate whether the following document is more likely AI-generated or human-created.",
    "Focus on repetition, stylistic uniformity, templated wording, density of information, and reasoning continuity.",
    "Document content:",
    truncateText(input.extractedText, DETECTION_SOURCE_MAX_CHARS),
  ].join("\n\n");
}

function buildVisualDetectionPrompt(target: "image" | "video", locale: "zh" | "en") {
  if (locale === "zh") {
    return target === "video"
      ? "你将收到同一段视频抽取的多张关键帧。请分别评估每一帧的 AI 生成概率，并给出整体平均判断，重点关注纹理一致性、边缘失真、物理不连续、字幕/文字异常和时序伪影。"
      : "请评估该图片为 AI 生成的概率，重点关注局部纹理、光影一致性、手部/边缘细节、透视关系、文字和水印异常。";
  }

  return target === "video"
    ? "You will receive multiple keyframes from the same video. Estimate the AI-generation probability for each frame and return the overall mean, focusing on texture consistency, edge artifacts, physical continuity, text anomalies, and temporal-style artifacts visible across frames."
    : "Estimate the probability that this image is AI-generated. Focus on local textures, lighting consistency, anatomy or edge details, perspective, and text or watermark anomalies.";
}

async function detectDocumentWithDashScope(input: {
  modelId: string;
  file: File;
  locale: "zh" | "en";
}) {
  const extractedText = await extractDetectableDocumentText(input.file);
  if (!extractedText.trim()) {
    throw new Error(
      input.locale === "zh"
        ? "未能从文档中提取到可检测文本。"
        : "No detectable text could be extracted from the document.",
    );
  }

  const requestBody = {
    model: resolveDashScopeTextDetectionModelId(input.modelId),
    enable_thinking: false,
    temperature: 0.1,
    max_tokens: DETECTION_MAX_TOKENS,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "system",
        content: buildStructuredDetectionInstruction("document", input.locale),
      },
      {
        role: "user",
        content: buildDocumentDetectionPrompt({
          fileName: input.file.name,
          extractedText,
          locale: input.locale,
        }),
      },
    ],
  };

  let payload: DashScopeChatCompletionPayload;
  try {
    payload = await requestDashScopeChatCompletion(requestBody);
  } catch (error) {
    const statusCode = getErrorStatusCode(error);
    if (statusCode !== 400 && statusCode !== 422) {
      throw error;
    }

    const { response_format, ...fallbackRequestBody } = requestBody;
    void response_format;
    payload = await requestDashScopeChatCompletion(fallbackRequestBody);
  }

  return normalizeDetectionResult(
    extractChatMessageText(payload.choices?.[0]?.message?.content).trim(),
  );
}

async function detectVisualWithDashScope(input: {
  modelId: string;
  files: File[];
  locale: "zh" | "en";
  target: "image" | "video";
}) {
  const content = [
    {
      type: "text",
      text: buildVisualDetectionPrompt(input.target, input.locale),
    },
    ...(await Promise.all(
      input.files.slice(0, 6).map(async (file) => ({
        type: "image_url",
        image_url: {
          url: await fileToDataUrl(file),
        },
      })),
    )),
  ];

  const requestBody = {
    model: resolveDashScopeVisualDetectionModelId(input.modelId),
    enable_thinking: false,
    temperature: 0.1,
    max_tokens: DETECTION_MAX_TOKENS,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "system",
        content: buildStructuredDetectionInstruction(input.target, input.locale),
      },
      {
        role: "user",
        content,
      },
    ],
  };

  let payload: DashScopeChatCompletionPayload;
  try {
    payload = await requestDashScopeChatCompletion(requestBody);
  } catch (error) {
    const statusCode = getErrorStatusCode(error);
    if (statusCode !== 400 && statusCode !== 422) {
      throw error;
    }

    const { response_format, ...fallbackRequestBody } = requestBody;
    void response_format;
    payload = await requestDashScopeChatCompletion(fallbackRequestBody);
  }

  return normalizeDetectionResult(
    extractChatMessageText(payload.choices?.[0]?.message?.content).trim(),
  );
}

type LiteralReplacePlan = {
  sourceText: string;
  targetText: string;
};

type DirectDocumentEditResult = {
  generatedFiles: GeneratedExportedFile[];
  replacementCount: number;
  previewText: string;
  mode: "direct_replace";
  sourceText: string;
  targetText: string;
};

function escapeXmlEntities(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function replaceAllLiteral(input: string, sourceText: string, targetText: string) {
  if (!sourceText) {
    return {
      value: input,
      count: 0,
    };
  }

  let cursor = 0;
  let count = 0;
  let output = "";

  while (cursor < input.length) {
    const matchedIndex = input.indexOf(sourceText, cursor);
    if (matchedIndex < 0) {
      output += input.slice(cursor);
      break;
    }

    output += input.slice(cursor, matchedIndex);
    output += targetText;
    cursor = matchedIndex + sourceText.length;
    count += 1;
  }

  return {
    value: output,
    count,
  };
}

function parseLiteralReplaceInstruction(instruction: string): LiteralReplacePlan | null {
  const normalized = instruction.trim();
  if (!normalized) {
    return null;
  }

  const patterns = [
    /(?:\u628a|\u5c06)?(?:\u6587\u6863|\u6587\u7ae0|\u5185\u5bb9|\u6587\u672c)?(?:\u4e2d|\u91cc|\u5185)?(?:\u7684)?\s*\u3010([\s\S]+?)\u3011\s*(?:\u4fee\u6539\u4e3a|\u6539\u4e3a|\u66ff\u6362\u4e3a|\u66ff\u6362\u6210|\u6539\u6210|\u6362\u6210|\u6362\u4e3a)\s*\u3010([\s\S]+?)\u3011/,
    /(?:\u628a|\u5c06)?(?:\u6587\u6863|\u6587\u7ae0|\u5185\u5bb9|\u6587\u672c)?(?:\u4e2d|\u91cc|\u5185)?(?:\u7684)?\s*\u201c([\s\S]+?)\u201d\s*(?:\u4fee\u6539\u4e3a|\u6539\u4e3a|\u66ff\u6362\u4e3a|\u66ff\u6362\u6210|\u6539\u6210|\u6362\u6210|\u6362\u4e3a)\s*\u201c([\s\S]+?)\u201d/,
    /(?:\u628a|\u5c06)?(?:\u6587\u6863|\u6587\u7ae0|\u5185\u5bb9|\u6587\u672c)?(?:\u4e2d|\u91cc|\u5185)?(?:\u7684)?\s*"([\s\S]+?)"\s*(?:\u4fee\u6539\u4e3a|\u6539\u4e3a|\u66ff\u6362\u4e3a|\u66ff\u6362\u6210|\u6539\u6210|\u6362\u6210|\u6362\u4e3a)\s*"([\s\S]+?)"/,
    /(?:\u628a|\u5c06)?(?:\u6587\u6863|\u6587\u7ae0|\u5185\u5bb9|\u6587\u672c)?(?:\u4e2d|\u91cc|\u5185)?(?:\u7684)?\s*'([\s\S]+?)'\s*(?:\u4fee\u6539\u4e3a|\u6539\u4e3a|\u66ff\u6362\u4e3a|\u66ff\u6362\u6210|\u6539\u6210|\u6362\u6210|\u6362\u4e3a)\s*'([\s\S]+?)'/,
    /(?:replace|change)\s+["\u201c\']([\s\S]+?)["\u201d\']\s+(?:with|to)\s+["\u201c\']([\s\S]+?)["\u201d\']/i,
  ];

  for (const pattern of patterns) {
    const matched = normalized.match(pattern);
    if (!matched) {
      continue;
    }

    const sourceText = matched[1]?.trim() || "";
    const targetText = matched[2]?.trim() || "";
    if (!sourceText || sourceText === targetText) {
      return null;
    }

    return {
      sourceText,
      targetText,
    };
  }

  return null;
}

async function extractEditableDocumentTextFromBytes(bytes: Uint8Array, extension: string) {
  if (extension === "txt" || extension === "md") {
    return normalizeEditablePlainText(Buffer.from(bytes).toString("utf8"));
  }

  if (extension === "docx") {
    return extractTextFromDocxBuffer(bytes);
  }

  if (extension === "xlsx") {
    return extractTextFromXlsxBuffer(bytes);
  }

  if (extension === "pdf") {
    return extractTextFromPdfBuffer(bytes);
  }

  throw new Error("当前文档编辑仅支持 TXT、MD、DOCX、XLSX、PDF 文件。");
}

function buildDirectDocumentEditPreview(input: {
  fileName: string;
  instruction: string;
  sourceText: string;
  targetText: string;
  replacementCount: number;
}) {
  return [
    `文件名: ${input.fileName}`,
    `指令: ${input.instruction}`,
    "编辑方式: 文本替换",
    `替换次数: ${input.replacementCount}`,
    `原文: ${input.sourceText}`,
    `新文: ${input.targetText}`,
  ].join("\n");
}

function buildGeneratedDocumentPreview(document: GeneratedDocument) {
  const previewLines = [document.title.trim(), document.summary.trim()]
    .filter(Boolean)
    .slice(0, 2);

  document.sections.slice(0, 2).forEach((section) => {
    if (section.heading.trim()) {
      previewLines.push(`# ${section.heading.trim()}`);
    }
    section.paragraphs
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .slice(0, 2)
      .forEach((paragraph) => previewLines.push(paragraph));
  });

  return truncateText(previewLines.join("\n"), 1200);
}

function getDocumentMimeTypeByExtension(extension: string) {
  if (extension === "txt") {
    return "text/plain; charset=utf-8";
  }

  if (extension === "md") {
    return "text/markdown; charset=utf-8";
  }

  if (extension === "xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  if (extension === "pdf") {
    return "application/pdf";
  }

  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function replaceTextInWordParagraphXml(paragraphXml: string, plan: LiteralReplacePlan) {
  const nodeRegex = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  const nodes: Array<{
    start: number;
    end: number;
    openTag: string;
    closeTag: string;
    text: string;
  }> = [];

  let matched: RegExpExecArray | null;
  while ((matched = nodeRegex.exec(paragraphXml)) !== null) {
    nodes.push({
      start: matched.index,
      end: nodeRegex.lastIndex,
      openTag: matched[1],
      closeTag: matched[3],
      text: decodeXmlEntities(matched[2]),
    });
  }

  if (nodes.length === 0) {
    return {
      xml: paragraphXml,
      replacementCount: 0,
    };
  }

  const combinedText = nodes.map((node) => node.text).join("");
  const replaced = replaceAllLiteral(combinedText, plan.sourceText, plan.targetText);
  if (replaced.count === 0) {
    return {
      xml: paragraphXml,
      replacementCount: 0,
    };
  }

  const originalLengths = nodes.map((node) => node.text.length);
  const nextNodeTexts = originalLengths.map((length, index) => {
    const consumed = originalLengths
      .slice(0, index)
      .reduce((sum, current) => sum + current, 0);
    if (index === originalLengths.length - 1) {
      return replaced.value.slice(consumed);
    }
    return replaced.value.slice(consumed, consumed + length);
  });

  let nextXml = paragraphXml;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const replacementXml = `${node.openTag}${escapeXmlEntities(nextNodeTexts[index] || "")}${node.closeTag}`;
    nextXml = `${nextXml.slice(0, node.start)}${replacementXml}${nextXml.slice(node.end)}`;
  }

  return {
    xml: nextXml,
    replacementCount: replaced.count,
  };
}

function replaceTextInWordXmlContent(xml: string, plan: LiteralReplacePlan) {
  const escapedSource = escapeXmlEntities(plan.sourceText);
  const escapedTarget = escapeXmlEntities(plan.targetText);
  const directReplace = replaceAllLiteral(xml, escapedSource, escapedTarget);
  if (directReplace.count > 0) {
    return {
      xml: directReplace.value,
      replacementCount: directReplace.count,
    };
  }

  const paragraphRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
  let replacementCount = 0;
  let cursor = 0;
  let output = "";
  let matched: RegExpExecArray | null;

  while ((matched = paragraphRegex.exec(xml)) !== null) {
    output += xml.slice(cursor, matched.index);
    const paragraphResult = replaceTextInWordParagraphXml(matched[0], plan);
    output += paragraphResult.xml;
    replacementCount += paragraphResult.replacementCount;
    cursor = matched.index + matched[0].length;
  }

  output += xml.slice(cursor);
  return {
    xml: output,
    replacementCount,
  };
}

async function replaceTextInDocxBuffer(bytes: Uint8Array, plan: LiteralReplacePlan) {
  const zip = await JSZip.loadAsync(bytes);
  const xmlPaths = Object.keys(zip.files).filter((path) =>
    /^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/i.test(path),
  );

  let replacementCount = 0;
  await Promise.all(
    xmlPaths.map(async (path) => {
      const file = zip.file(path);
      if (!file) {
        return;
      }

      const xml = await file.async("text");
      const replaced = replaceTextInWordXmlContent(xml, plan);
      replacementCount += replaced.replacementCount;
      if (replaced.replacementCount > 0) {
        zip.file(path, replaced.xml);
      }
    }),
  );

  return {
    bytes: new Uint8Array(await zip.generateAsync({ type: "uint8array" })),
    replacementCount,
  };
}

function replaceTextInRichTextRuns(
  richTextRuns: Array<{ text?: string; [key: string]: unknown }>,
  plan: LiteralReplacePlan,
) {
  let replacementCount = 0;
  const nextRuns = richTextRuns.map((run) => {
    const text = typeof run.text === "string" ? run.text : "";
    if (!text) {
      return { ...run, text };
    }

    const replaced = replaceAllLiteral(text, plan.sourceText, plan.targetText);
    replacementCount += replaced.count;
    return { ...run, text: replaced.count > 0 ? replaced.value : text };
  });

  return {
    richTextRuns: nextRuns,
    replacementCount,
  };
}

async function replaceTextInXlsxBuffer(bytes: Uint8Array, plan: LiteralReplacePlan) {
  const workbook = new ExcelJS.Workbook();
  const workbookBuffer = Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(workbookBuffer);

  let replacementCount = 0;
  workbook.worksheets.forEach((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value === "string") {
          const replaced = replaceAllLiteral(cell.value, plan.sourceText, plan.targetText);
          if (replaced.count > 0) {
            cell.value = replaced.value;
            replacementCount += replaced.count;
          }
          return;
        }

        if (
          cell.value &&
          typeof cell.value === "object" &&
          "richText" in cell.value &&
          Array.isArray((cell.value as { richText?: unknown }).richText)
        ) {
          const richTextValue = cell.value as {
            richText: Array<{ text?: string; [key: string]: unknown }>;
          };
          const richTextResult = replaceTextInRichTextRuns(richTextValue.richText, plan);
          if (richTextResult.replacementCount > 0) {
            cell.value = {
              ...richTextValue,
              richText: richTextResult.richTextRuns,
            };
            replacementCount += richTextResult.replacementCount;
          }
        }
      });
    });
  });

  return {
    bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
    replacementCount,
  };
}

async function tryPerformDirectDocumentEdit(file: File, instruction: string) {
  const plan = parseLiteralReplaceInstruction(instruction);
  if (!plan) {
    return null;
  }

  const bytes = new Uint8Array(await file.arrayBuffer()) as Uint8Array;
  const extension = getUploadFileExtension(file.name);
  let editedBytes: Uint8Array = bytes;
  let replacementCount = 0;

  if (extension === "txt" || extension === "md") {
    const sourceText = Buffer.from(bytes).toString("utf8");
    const replaced = replaceAllLiteral(sourceText, plan.sourceText, plan.targetText);
    replacementCount = replaced.count;
    editedBytes = new TextEncoder().encode(replaced.value);
  } else if (extension === "docx") {
    const replaced = await replaceTextInDocxBuffer(bytes, plan);
    replacementCount = replaced.replacementCount;
    editedBytes = replaced.bytes;
  } else if (extension === "xlsx") {
    const replaced = await replaceTextInXlsxBuffer(bytes, plan);
    replacementCount = replaced.replacementCount;
    editedBytes = replaced.bytes;
  } else if (extension === "pdf") {
    const replaced = await replaceTextInPdfBuffer(bytes, plan);
    replacementCount = replaced.replacementCount;
    editedBytes = replaced.bytes;
  } else {
    return null;
  }

  if (replacementCount <= 0) {
    throw new Error(`未在文档中找到原文“${plan.sourceText}”，请确认原文完全一致后重试。`);
  }

  const previewText = buildDirectDocumentEditPreview({
    fileName: file.name,
    instruction,
    sourceText: plan.sourceText,
    targetText: plan.targetText,
    replacementCount,
  });

  return {
    generatedFiles: [
      {
        format: getDocumentEditOutputFormats(file.name)[0],
        fileName: file.name,
        mimeType: getDocumentMimeTypeByExtension(extension),
        bytes: editedBytes,
      },
    ],
    replacementCount,
    previewText,
    mode: "direct_replace",
    sourceText: plan.sourceText,
    targetText: plan.targetText,
  } satisfies DirectDocumentEditResult;
}

function getDocumentEditOutputFormats(fileName: string): readonly DocumentFileFormat[] {
  const extension = getUploadFileExtension(fileName);
  if (extension === "txt") {
    return ["txt"];
  }

  if (extension === "md") {
    return ["md"];
  }

  if (extension === "xlsx") {
    return ["xlsx"];
  }

  if (extension === "pdf") {
    return ["pdf"];
  }

  return ["docx"];
}

function buildDocumentEditingSystemPrompt(requireSpreadsheet: boolean) {
  return [
    ...FILE_GENERATION_SYSTEM_PROMPT_LINES,
    "You edit uploaded documents instead of drafting from scratch.",
    "Preserve core facts from the source document unless the user explicitly asks to rewrite them.",
    "Do not summarize, compress, or rewrite unaffected content.",
    "Keep paragraph order and wording unchanged wherever no edit is requested.",
    requireSpreadsheet
      ? "Return at least one spreadsheet when the output format includes xlsx."
      : "Return an empty spreadsheets array unless tabular data is genuinely useful.",
    "Respond with raw JSON only.",
  ].join("\n");
}

function buildDocumentEditingPrompt(input: {
  fileName: string;
  instruction: string;
  sourceText: string;
  requireSpreadsheet: boolean;
}) {
  return [
    `Source file: ${input.fileName}`,
    "Editing instructions:",
    input.instruction,
    "",
    "Source content:",
    truncateText(input.sourceText, DOCUMENT_EDIT_SOURCE_MAX_CHARS),
    "",
    "Output requirements:",
    "- Keep the result faithful to the uploaded file while applying the requested edits.",
    "- Return one complete edited document package.",
    "- Do not omit sections, shorten paragraphs, or summarize unchanged passages.",
    "- If the request is a local phrase replacement, keep every other sentence exactly as-is.",
    input.requireSpreadsheet
      ? "- Include one useful spreadsheet in the result."
      : "- Keep the spreadsheets array empty unless the edited result clearly needs tabular data.",
  ].join("\n");
}

function buildReplicateDocumentEditingPrompt(input: {
  fileName: string;
  instruction: string;
  sourceText: string;
  requireSpreadsheet: boolean;
}) {
  return [
    buildDocumentEditingSystemPrompt(input.requireSpreadsheet),
    buildDocumentEditingPrompt(input),
  ].join("\n\n");
}

async function editDocumentWithDashScope(input: {
  requestId: string;
  modelId: string;
  prompt: string;
  file: File;
  requireSpreadsheet: boolean;
}) {
  const sourceText = await extractEditableDocumentText(input.file);
  if (!sourceText.trim()) {
    throw new Error("上传文档未解析出可编辑文本，请更换文件后重试。");
  }

  const actualModelId = resolveDashScopeDocumentEditModelId(input.modelId);
  const baseRequest = {
    model: actualModelId,
    messages: [
      {
        role: "system",
        content: buildDocumentEditingSystemPrompt(input.requireSpreadsheet),
      },
      {
        role: "user",
        content: buildDocumentEditingPrompt({
          fileName: input.file.name,
          instruction: input.prompt,
          sourceText,
          requireSpreadsheet: input.requireSpreadsheet,
        }),
      },
    ],
    temperature: 0.2,
    max_tokens: DOCUMENT_EDITING_MAX_TOKENS,
  };

  let payload: DashScopeChatCompletionPayload;
  let completionMode: DashScopeDocumentResponseMode = "prompt_only";
  const candidateModes = buildDashScopeDocumentResponseCandidates(actualModelId);
  let lastError: unknown;

  for (const candidateMode of candidateModes) {
    try {
      console.log(
        `[Generate][${input.requestId}][DashScope][document-edit] 发起 chat/completions，请求模式: ${candidateMode}，超时: ${DASHSCOPE_CHAT_COMPLETION_TIMEOUT_MS}ms`,
      );
      payload = await requestDashScopeChatCompletion(
        buildDashScopeDocumentRequest(
          baseRequest,
          actualModelId,
          candidateMode,
          input.requireSpreadsheet,
        ),
      );
      completionMode = candidateMode;
      cachedDashScopeDocumentResponseMode.set(actualModelId, candidateMode);
      break;
    } catch (error) {
      lastError = error;
      if (getErrorStatusCode(error) !== 400 && getErrorStatusCode(error) !== 422) {
        throw error;
      }
    }
  }

  if (!payload!) {
    throw lastError ?? new Error(`阿里云百炼文档编辑失败，模型 ${actualModelId} 未返回有效结果。`);
  }

  console.log(
    `[Generate][${input.requestId}][DashScope][document-edit] chat/completions 完成，模式: ${completionMode}`,
  );

  const content = extractChatMessageText(payload.choices?.[0]?.message?.content);
  if (!content.trim()) {
    throw new Error("阿里云百炼文档编辑未返回可解析内容。");
  }

  const rawDocument = JSON.parse(stripMarkdownCodeFence(content));
  const documentSchema = getGeneratedDocumentSchema({
    requireSpreadsheet: input.requireSpreadsheet,
  });
  const directResult = documentSchema.safeParse(rawDocument);
  if (directResult.success) {
    return directResult.data;
  }

  const normalizedDocument = normalizeGeneratedDocumentPayload(
    rawDocument,
    input.prompt,
    input.requireSpreadsheet,
  );
  const normalizedResult = documentSchema.safeParse(normalizedDocument);
  if (normalizedResult.success) {
    return normalizedResult.data;
  }

  throw normalizedResult.error;
}

async function editDocumentWithReplicate(input: {
  requestId: string;
  modelId: string;
  prompt: string;
  file: File;
  requireSpreadsheet: boolean;
}) {
  const sourceText = await extractEditableDocumentText(input.file);
  if (!sourceText.trim()) {
    throw new Error("上传文档未解析出可编辑文本，请更换文件后重试。");
  }

  const normalizedModelId = normalizeReplicateTextModelId(input.modelId);
  const documentPrompt = buildReplicateDocumentEditingPrompt({
    fileName: input.file.name,
    instruction: input.prompt,
    sourceText,
    requireSpreadsheet: input.requireSpreadsheet,
  });
  const primaryInput = {
    prompt: documentPrompt,
    max_new_tokens: DOCUMENT_EDITING_MAX_TOKENS,
    temperature: 0.2,
    top_p: 0.95,
  };
  const fallbackInput = {
    prompt: documentPrompt,
  };

  let payload: ReplicatePredictionPayload;
  try {
    payload = await createReplicatePrediction(input.requestId, normalizedModelId, primaryInput);
  } catch (error) {
    if (getErrorStatusCode(error) !== 422) {
      throw error;
    }

    console.warn(
      `[Generate][${input.requestId}] Replicate 文档编辑参数不兼容，自动降级为最小输入重试`,
    );
    payload = await createReplicatePrediction(input.requestId, normalizedModelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(`Replicate 文档编辑失败${detail ? `: ${detail}` : ""}`);
  }

  const finalPayload =
    status === "succeeded"
      ? payload
      : await (() => {
          if (!payload.id) {
            throw new Error("Replicate 返回结果缺少 prediction id。");
          }

          return waitForReplicatePredictionResult(
            payload.id,
            REPLICATE_TEXT_TASK_TIMEOUT_MS,
            `Replicate 文档编辑超时，请稍后重试。prediction_id: ${payload.id}`,
          );
        })();

  const content = extractReplicateTextOutput(finalPayload.output);
  if (!content.trim()) {
    throw new Error("Replicate 文档编辑未返回可解析内容。");
  }

  return parseGeneratedDocumentFromRawText(content, input.prompt, input.requireSpreadsheet);
}

function fileToDataUrl(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const mimeType = file.type || "application/octet-stream";
    return `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
  });
}

function buildDashScopeImagePrompt(prompt: string) {
  return prompt.replace(/\s+/g, " ").trim();
}

function buildDashScopeImageTaskConfig(modelId: string, prompt: string) {
  const normalizedPrompt = buildDashScopeImagePrompt(prompt);

  if (modelId === "wan2.6-t2i") {
    return {
      path: "/api/v1/services/aigc/image-generation/generation",
      body: {
        model: modelId,
        input: {
          messages: [
            {
              role: "user",
              content: [
                {
                  text: normalizedPrompt,
                },
              ],
            },
          ],
        },
        parameters: {
          n: DEFAULT_IMAGE_OUTPUT_COUNT,
        },
      },
    };
  }

  return {
    path: "/api/v1/services/aigc/text2image/image-synthesis",
    body: {
      model: modelId,
      input: {
        prompt: normalizedPrompt,
      },
      parameters: {
        n: DEFAULT_IMAGE_OUTPUT_COUNT,
      },
    },
  };
}

async function generateImageWithDashScope(requestId: string, modelId: string, prompt: string) {
  const taskConfig = buildDashScopeImageTaskConfig(modelId, prompt);
  const payload = await createDashScopeAsyncTask(taskConfig.path, taskConfig.body);

  const status = getDashScopeTaskStatus(payload);
  if (status === "SUCCEEDED") {
    return payload;
  }

  if (status === "FAILED" || status === "CANCELED") {
    const detail = extractDashScopeErrorText(payload);
    throw new Error(`阿里云百炼图片生成失败${detail ? `: ${detail}` : ""}`);
  }

  const taskId = getDashScopeTaskId(payload);
  if (!taskId) {
    throw new Error("阿里云百炼图片生成未返回 task_id。");
  }

  return waitForDashScopeTaskResult(
    taskId,
    DASHSCOPE_IMAGE_TASK_TIMEOUT_MS,
    `阿里云百炼图片生成超时，请稍后重试。task_id: ${taskId}`,
  );
}

async function editImageWithDashScope(modelId: string, prompt: string, file: File) {
  const payload = await createDashScopeAsyncTask(
    "/api/v1/services/aigc/image2image/image-synthesis",
    {
      model: modelId,
      input: {
        function: "description_edit",
        prompt: buildDashScopeImagePrompt(prompt),
        base_image_url: await fileToDataUrl(file),
      },
      parameters: {
        n: DEFAULT_IMAGE_OUTPUT_COUNT,
      },
    },
  );

  const status = getDashScopeTaskStatus(payload);
  if (status === "SUCCEEDED") {
    return payload;
  }

  if (status === "FAILED" || status === "CANCELED") {
    const detail = extractDashScopeErrorText(payload);
    throw new Error(`阿里云百炼图片编辑失败${detail ? `: ${detail}` : ""}`);
  }

  const taskId = getDashScopeTaskId(payload);
  if (!taskId) {
    throw new Error("阿里云百炼图片编辑未返回 task_id。");
  }

  return waitForDashScopeTaskResult(
    taskId,
    DASHSCOPE_IMAGE_TASK_TIMEOUT_MS,
    `阿里云百炼图片编辑超时，请稍后重试。task_id: ${taskId}`,
  );
}

function buildReplicateImageEditPrompt(userPrompt: string) {
  const cleanedPrompt = userPrompt.replace(/\s+/g, " ").trim();
  return [
    "Edit the uploaded image according to the user's request.",
    "Preserve the main subject and overall composition unless the user explicitly asks to change them.",
    `User request: ${cleanedPrompt}`,
    "If the request is in Chinese, understand and execute it correctly.",
  ].join("\n");
}

function buildReplicateImageEditInputs(modelId: string, promptForModel: string, imageUrl: string) {
  if (modelId === "espressotechie/qwen-imgedit-4bit") {
    return {
      primaryInput: {
        image: imageUrl,
        prompt: promptForModel,
        steps: 4,
        output_format: "png",
        output_quality: 95,
      },
      fallbackInput: {
        image: imageUrl,
        prompt: promptForModel,
      },
    };
  }

  return {
    primaryInput: {
      image: imageUrl,
      prompt: promptForModel,
    },
    fallbackInput: {
      image: imageUrl,
      prompt: promptForModel,
    },
  };
}

async function editImageWithReplicate(input: {
  requestId: string;
  modelId: string;
  prompt: string;
  file: File;
  db: NonNullable<Awaited<ReturnType<typeof getRoutedRuntimeDbClient>>>;
}) {
  const uploaded = await uploadInputFileForEditing(input.db, input.requestId, "image-edit", input.file);
  const promptForModel = buildReplicateImageEditPrompt(input.prompt);
  const { primaryInput, fallbackInput } = buildReplicateImageEditInputs(
    input.modelId,
    promptForModel,
    uploaded.publicUrl,
  );

  let payload: ReplicatePredictionPayload;
  try {
    payload = await createReplicatePrediction(input.requestId, input.modelId, primaryInput);
  } catch (error) {
    if (getErrorStatusCode(error) !== 422) {
      throw error;
    }

    console.warn(`[Generate][${input.requestId}] Replicate 图片编辑参数不兼容，自动降级为最小输入重试`);
    payload = await createReplicatePrediction(input.requestId, input.modelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "succeeded") {
    return payload;
  }
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(`Replicate 图片编辑失败${detail ? `: ${detail}` : ""}`);
  }
  if (!payload.id) {
    throw new Error("Replicate 返回结果缺少 prediction id。");
  }

  return waitForReplicatePredictionResult(
    payload.id,
    REPLICATE_IMAGE_TASK_TIMEOUT_MS,
    `Replicate 图片编辑超时，请稍后重试。prediction_id: ${payload.id}`,
  );
}

function buildDashScopeVideoPrompt(prompt: string) {
  return [
    "根据用户要求生成一个简洁、稳定、连贯的短视频。",
    "保持主体清晰，动作自然，镜头稳定。",
    `用户要求：${prompt.trim()}`,
  ].join("\n");
}

async function createDashScopeVideoTask(modelId: string, prompt: string, imageUrl: string) {
  const inputCandidates: Record<string, unknown>[] = [
    {
      prompt: buildDashScopeVideoPrompt(prompt),
      img_url: imageUrl,
    },
    {
      prompt: buildDashScopeVideoPrompt(prompt),
      image_url: imageUrl,
    },
  ];

  let lastError: unknown = null;
  for (const input of inputCandidates) {
    try {
      return await createDashScopeAsyncTask(
        "/api/v1/services/aigc/video-generation/video-synthesis",
        {
          model: modelId,
          input,
        },
      );
    } catch (error) {
      lastError = error;
      const statusCode = getErrorStatusCode(error);
      if (statusCode !== 400 && statusCode !== 422) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("阿里云百炼视频任务创建失败。");
}

async function createDashScopeTextToVideoTask(modelId: string, prompt: string) {
  const promptText = buildDashScopeVideoPrompt(prompt);
  const inputCandidates: Record<string, unknown>[] = [
    {
      prompt: promptText,
    },
    {
      text: promptText,
    },
  ];

  let lastError: unknown = null;
  for (const input of inputCandidates) {
    try {
      return await createDashScopeAsyncTask(
        "/api/v1/services/aigc/video-generation/video-synthesis",
        {
          model: modelId,
          input,
        },
      );
    } catch (error) {
      lastError = error;
      const statusCode = getErrorStatusCode(error);
      if (statusCode !== 400 && statusCode !== 422) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("阿里云百炼文生视频任务创建失败。");
}

async function editVideoWithDashScope(
  modelId: string,
  prompt: string,
  keyframeFile: File,
) {
  const payload = await createDashScopeAsyncTask(
    "/api/v1/services/aigc/image2video/video-synthesis",
    {
      model: modelId,
      input: {
        prompt: buildDashScopeVideoPrompt(prompt),
        first_frame_url: await fileToDataUrl(keyframeFile),
      },
    },
  );

  const status = getDashScopeTaskStatus(payload);
  if (status === "SUCCEEDED") {
    return payload;
  }

  if (status === "FAILED" || status === "CANCELED") {
    const detail = extractDashScopeErrorText(payload);
    throw new Error(`阿里云百炼视频编辑失败${detail ? `: ${detail}` : ""}`);
  }

  const taskId = getDashScopeTaskId(payload);
  if (!taskId) {
    throw new Error("阿里云百炼视频编辑未返回 task_id。");
  }

  return waitForDashScopeTaskResult(
    taskId,
    DASHSCOPE_VIDEO_TASK_TIMEOUT_MS,
    `阿里云百炼视频编辑超时，请稍后重试。task_id: ${taskId}`,
  );
}

function buildReplicateVideoEditPrompt(userPrompt: string) {
  return [
    "Edit the uploaded video according to the user's request.",
    "Preserve the main subject, motion continuity, and overall scene coherence unless the user explicitly asks to change them.",
    `User request: ${userPrompt.trim()}`,
    "If the request is in Chinese, understand and execute it correctly.",
  ].join("\n");
}

function buildReplicateVideoEditInputs(modelId: string, promptForModel: string, videoUrl: string) {
  if (modelId === "lightricks/ltx-video-0.9.7-distilled") {
    return {
      primaryInput: {
        prompt: promptForModel,
        video: videoUrl,
        go_fast: true,
        num_frames: 121,
        fps: 24,
        conditioning_frames: 21,
        denoise_strength: 0.4,
        num_inference_steps: 24,
        final_inference_steps: 10,
      },
      fallbackInput: {
        prompt: promptForModel,
        video: videoUrl,
      },
    };
  }

  return {
    primaryInput: {
      prompt: promptForModel,
      video: videoUrl,
    },
    fallbackInput: {
      prompt: promptForModel,
      video: videoUrl,
    },
  };
}

async function editVideoWithReplicate(input: {
  requestId: string;
  modelId: string;
  prompt: string;
  file: File;
  db: NonNullable<Awaited<ReturnType<typeof getRoutedRuntimeDbClient>>>;
}) {
  const uploaded = await uploadInputFileForEditing(input.db, input.requestId, "video-edit", input.file);
  const promptForModel = buildReplicateVideoEditPrompt(input.prompt);
  const { primaryInput, fallbackInput } = buildReplicateVideoEditInputs(
    input.modelId,
    promptForModel,
    uploaded.publicUrl,
  );

  let payload: ReplicatePredictionPayload;
  try {
    payload = await createReplicatePrediction(input.requestId, input.modelId, primaryInput);
  } catch (error) {
    if (getErrorStatusCode(error) !== 422) {
      throw error;
    }

    console.warn(`[Generate][${input.requestId}] Replicate 视频编辑参数不兼容，自动降级为最小输入重试`);
    payload = await createReplicatePrediction(input.requestId, input.modelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "succeeded") {
    return payload;
  }
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(`Replicate 视频编辑失败${detail ? `: ${detail}` : ""}`);
  }
  if (!payload.id) {
    throw new Error("Replicate 返回结果缺少 prediction id。");
  }

  return waitForReplicatePredictionResult(
    payload.id,
    getReplicateVideoTaskTimeoutMs(input.modelId),
    buildReplicateVideoEditingTimeoutMessage(input.modelId, payload.id),
  );
}

async function generateVideoWithDashScope(requestId: string, modelId: string, prompt: string) {
  const payload =
    modelId === "wan2.2-t2v-plus"
      ? await createDashScopeTextToVideoTask(modelId, prompt)
      : await (async () => {
          const keyframePayload = await generateImageWithDashScope(
            requestId,
            "wanx2.0-t2i-turbo",
            prompt,
          );
          const imageUrls = extractReplicateOutputUrls(keyframePayload.output).slice(0, 1);
          if (imageUrls.length === 0) {
            throw new Error("阿里云百炼文生视频未获取到可用首帧图片链接。");
          }

          return createDashScopeVideoTask(modelId, prompt, imageUrls[0]);
        })();
  const status = getDashScopeTaskStatus(payload);
  if (status === "SUCCEEDED") {
    return payload;
  }

  if (status === "FAILED" || status === "CANCELED") {
    const detail = extractDashScopeErrorText(payload);
    throw new Error(`阿里云百炼视频生成失败${detail ? `: ${detail}` : ""}`);
  }

  const taskId = getDashScopeTaskId(payload);
  if (!taskId) {
    throw new Error("阿里云百炼视频生成未返回 task_id。");
  }

  return waitForDashScopeTaskResult(
    taskId,
    DASHSCOPE_VIDEO_TASK_TIMEOUT_MS,
    `阿里云百炼视频生成超时，请稍后重试。task_id: ${taskId}`,
  );
}

function getAudioFileExtensionFromMimeType(mimeType: string) {
  if (mimeType.includes("wav")) {
    return "wav";
  }

  if (mimeType.includes("ogg")) {
    return "ogg";
  }

  if (mimeType.includes("flac")) {
    return "flac";
  }

  return DASHSCOPE_TTS_RESPONSE_FORMAT || "mp3";
}

function getAudioMimeTypeFromFormat(format?: string | null) {
  const normalizedFormat = format?.trim().toLowerCase() ?? "";
  if (normalizedFormat === "wav") {
    return "audio/wav";
  }

  if (normalizedFormat === "ogg") {
    return "audio/ogg";
  }

  if (normalizedFormat === "flac") {
    return "audio/flac";
  }

  if (normalizedFormat.startsWith("audio/")) {
    return normalizedFormat;
  }

  return "audio/mpeg";
}

function decodeBase64ToUint8Array(base64: string) {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

function normalizeDashScopeAudioModelId(modelId: string) {
  if (
    modelId === "qwen3-tts-instruct-flash-realtime" ||
    modelId === "qwen3-tts-instruct-flash"
  ) {
    return "qwen3-tts-flash";
  }

  return modelId;
}

function getAudioEditingPipelineModelIds(modelId: string) {
  if (modelId === "paraformer-v2-qwen3-tts-flash") {
    return {
      transcriptionModelId: "paraformer-v2",
      synthesisModelId: "qwen3-tts-flash",
      rewriteModelId: "qwen-flash",
    };
  }

  return {
    transcriptionModelId: "paraformer-v2",
    synthesisModelId: normalizeDashScopeAudioModelId(modelId),
    rewriteModelId: "qwen-flash",
  };
}

function getReplicateAudioEditingPipelineModelIds(modelId: string) {
  return {
    transcriptionModelId: "vaibhavs10/incredibly-fast-whisper",
    synthesisModelId: isReplicateAudioEditingPipelineModelId(modelId)
      ? "minimax/speech-02-turbo"
      : normalizeReplicateAudioModelId(modelId),
    rewriteModelId: "lucataco/qwen1.5-1.8b-chat",
  };
}

function sanitizeObjectKeySegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "file";
}

async function getUploadedInputFileUrl(
  db: NonNullable<Awaited<ReturnType<typeof getRoutedRuntimeDbClient>>>,
  bucketName: string,
  objectPath: string,
) {
  if (db.backend === "supabase") {
    if (!supabaseAdmin) {
      throw new Error("服务端缺少 Supabase 配置，无法生成编辑源文件签名地址。");
    }

    const { data, error } = await supabaseAdmin.storage
      .from(bucketName)
      .createSignedUrl(objectPath, GENERATED_INPUT_SIGNED_URL_TTL_SECONDS);
    if (error) {
      throw new Error(`生成编辑源文件签名地址失败: ${error.message}`);
    }

    const signedUrl = typeof data?.signedUrl === "string" ? data.signedUrl.trim() : "";
    if (!signedUrl) {
      throw new Error("编辑源文件上传成功但未获取到签名地址。");
    }

    return signedUrl;
  }

  const { data, error } = await db.storage.from(bucketName).getPublicUrl(objectPath);
  if (error) {
    throw new Error(`读取编辑源文件地址失败: ${error.message}`);
  }

  const publicUrl = typeof data?.publicUrl === "string" ? data.publicUrl.trim() : "";
  if (!publicUrl) {
    throw new Error("编辑源文件上传成功但未获取到可访问地址。");
  }

  return publicUrl;
}

async function uploadInputFileForEditing(
  db: NonNullable<Awaited<ReturnType<typeof getRoutedRuntimeDbClient>>>,
  requestId: string,
  folder: string,
  file: File,
) {
  const extension = getUploadFileExtension(file.name) || "bin";
  const objectPath = [
    "inputs",
    requestId,
    folder,
    `${Date.now()}-${sanitizeObjectKeySegment(file.name.replace(/\.[^.]+$/, ""))}.${extension}`,
  ].join("/");
  const buffer = Buffer.from(await file.arrayBuffer());

  const uploadResult = await db.storage.from(GENERATED_INPUT_BUCKET).upload(objectPath, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });

  if (uploadResult.error) {
    throw new Error(`上传编辑源文件失败: ${uploadResult.error.message}`);
  }

  return {
    objectPath,
    publicUrl: await getUploadedInputFileUrl(db, GENERATED_INPUT_BUCKET, objectPath),
  };
}

function extractDashScopeTaskResultUrls(payload: DashScopeTaskPayload) {
  const results = payload.output?.results;
  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const record = item as Record<string, unknown>;
      return [
        typeof record.transcription_url === "string" ? record.transcription_url.trim() : "",
        typeof record.url === "string" ? record.url.trim() : "",
        typeof record.file_url === "string" ? record.file_url.trim() : "",
      ].filter(Boolean);
    })
    .slice(0, DEFAULT_AUDIO_OUTPUT_COUNT);
}

function extractDashScopeTranscriptionText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const transcriptCandidates = [
    ...extractTextFragments(record.text),
    ...extractTextFragments(record.transcript),
    ...extractTextFragments(record.transcripts),
    ...extractTextFragments(record.sentences),
    ...extractTextFragments(record.segments),
    ...extractTextFragments(record.result),
    ...extractTextFragments(record.results),
  ];

  return normalizeEditablePlainText(uniqueTexts(transcriptCandidates, 200, 500).join("\n"));
}

async function transcribeAudioWithDashScope(
  requestId: string,
  modelId: string,
  fileUrl: string,
) {
  const payload = await createDashScopeAsyncTask(
    "/api/v1/services/audio/asr/transcription",
    {
      model: modelId,
      input: {
        file_urls: [fileUrl],
      },
    },
  );

  const status = getDashScopeTaskStatus(payload);
  const finalPayload =
    status === "SUCCEEDED"
      ? payload
      : await (async () => {
          if (status === "FAILED" || status === "CANCELED") {
            const detail = extractDashScopeErrorText(payload);
            throw new Error(`阿里云百炼音频转写失败${detail ? `: ${detail}` : ""}`);
          }

          const taskId = getDashScopeTaskId(payload);
          if (!taskId) {
            throw new Error("阿里云百炼音频转写未返回 task_id。");
          }

          return waitForDashScopeTaskResult(
            taskId,
            DASHSCOPE_AUDIO_TASK_TIMEOUT_MS,
            `阿里云百炼音频转写超时，请稍后重试。task_id: ${taskId}`,
          );
        })();

  const transcriptionUrls = extractDashScopeTaskResultUrls(finalPayload);
  if (transcriptionUrls.length === 0) {
    throw new Error("阿里云百炼音频转写未返回 transcription_url。");
  }

  const response = await providerFetch("aliyun", transcriptionUrls[0], {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  const transcriptionPayload = await readDashScopeJson<Record<string, unknown>>(response);
  const transcriptionText = extractDashScopeTranscriptionText(transcriptionPayload);
  if (!transcriptionText) {
    throw new Error("阿里云百炼音频转写结果为空。");
  }

  console.log(`[Generate][${requestId}][DashScope][audio-edit] 音频转写完成`);
  return transcriptionText;
}

async function rewriteAudioTranscriptWithDashScope(
  instruction: string,
  transcript: string,
  modelId: string,
) {
  const payload = await requestDashScopeChatCompletion({
    model: modelId,
    enable_thinking: false,
    temperature: 0.2,
    max_tokens: DOCUMENT_GENERATION_MAX_TOKENS,
    messages: [
      {
        role: "system",
        content:
          "你是一个口播音频编辑助手。请根据用户要求改写转写稿，输出最终要朗读的文本。只返回最终文本，不要解释。",
      },
      {
        role: "user",
        content: [
          "编辑要求：",
          instruction,
          "",
          "原始转写：",
          truncateText(transcript, DOCUMENT_EDIT_SOURCE_MAX_CHARS),
        ].join("\n"),
      },
    ],
  });

  const rewrittenText = extractChatMessageText(payload.choices?.[0]?.message?.content).trim();
  if (!rewrittenText) {
    throw new Error("音频编辑文案改写失败，未返回有效文本。");
  }

  return rewrittenText;
}

async function editAudioWithDashScope(input: {
  requestId: string;
  modelId: string;
  prompt: string;
  file: File;
  origin: string;
  db: NonNullable<Awaited<ReturnType<typeof getRoutedRuntimeDbClient>>>;
}) {
  const pipeline = getAudioEditingPipelineModelIds(input.modelId);
  const uploaded = await uploadInputFileForEditing(
    input.db,
    input.requestId,
    "audio-edit",
    input.file,
  );
  const transcript = await transcribeAudioWithDashScope(
    input.requestId,
    pipeline.transcriptionModelId,
    uploaded.publicUrl,
  );
  const rewrittenScript = await rewriteAudioTranscriptWithDashScope(
    input.prompt,
    transcript,
    pipeline.rewriteModelId,
  );
  const synthesized = await generateAudioWithDashScope(
    pipeline.synthesisModelId,
    rewrittenScript,
    input.origin,
  );

  return {
    ...synthesized,
    rewrittenScript,
    transcript,
  };
}

function extractReplicateTranscriptionText(output: unknown) {
  const record = output && typeof output === "object" ? (output as Record<string, unknown>) : null;
  const fragments = uniqueTexts(
    [
      extractReplicateTextOutput(output),
      ...extractTextFragments(output),
      ...extractTextFragments(record?.text),
      ...extractTextFragments(record?.transcript),
      ...extractTextFragments(record?.transcription),
      ...extractTextFragments(record?.segments),
      ...extractTextFragments(record?.chunks),
      ...extractTextFragments(record?.output),
      ...extractTextFragments(record?.data),
    ],
    400,
    500,
  );

  return normalizeEditablePlainText(fragments.join("\n"));
}

async function transcribeAudioWithReplicate(
  requestId: string,
  modelId: string,
  fileUrl: string,
) {
  const primaryInput = {
    audio: fileUrl,
    task: "transcribe",
    language: "None",
    timestamp: "chunk",
    batch_size: 24,
  };
  const fallbackInput = {
    audio: fileUrl,
  };

  let payload: ReplicatePredictionPayload;
  try {
    payload = await createReplicatePrediction(requestId, modelId, primaryInput);
  } catch (error) {
    if (getErrorStatusCode(error) !== 422) {
      throw error;
    }

    console.warn(`[Generate][${requestId}] Replicate 音频转写参数不兼容，自动降级为最小输入重试`);
    payload = await createReplicatePrediction(requestId, modelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(`Replicate 音频转写失败${detail ? `: ${detail}` : ""}`);
  }

  const finalPayload =
    status === "succeeded"
      ? payload
      : await (() => {
          if (!payload.id) {
            throw new Error("Replicate 返回结果缺少 prediction id。");
          }

          return waitForReplicatePredictionResult(
            payload.id,
            REPLICATE_AUDIO_TASK_TIMEOUT_MS,
            `Replicate 音频转写超时，请稍后重试。prediction_id: ${payload.id}`,
          );
        })();

  const transcriptionText = extractReplicateTranscriptionText(finalPayload.output);
  if (!transcriptionText) {
    throw new Error("Replicate 音频转写结果为空。");
  }

  return transcriptionText;
}

function buildReplicateAudioEditingPrompt(instruction: string, transcript: string) {
  return [
    "You are an audio script editor.",
    "Rewrite the transcript into the final narration script that should be spoken.",
    "Keep the meaning faithful unless the user explicitly asks to change it.",
    "Return only the final script. Do not add explanations or markdown.",
    "If the instruction is in Chinese, understand and execute it correctly.",
    "",
    "Editing requirements:",
    instruction,
    "",
    "Original transcript:",
    truncateText(transcript, DOCUMENT_EDIT_SOURCE_MAX_CHARS),
  ].join("\n");
}

async function rewriteAudioTranscriptWithReplicate(input: {
  requestId: string;
  instruction: string;
  transcript: string;
  modelId: string;
}) {
  const normalizedModelId = normalizeReplicateTextModelId(input.modelId);
  const prompt = buildReplicateAudioEditingPrompt(input.instruction, input.transcript);
  const primaryInput = {
    prompt,
    max_new_tokens: DOCUMENT_GENERATION_MAX_TOKENS,
    temperature: 0.2,
    top_p: 0.95,
  };
  const fallbackInput = {
    prompt,
  };

  let payload: ReplicatePredictionPayload;
  try {
    payload = await createReplicatePrediction(input.requestId, normalizedModelId, primaryInput);
  } catch (error) {
    if (getErrorStatusCode(error) !== 422) {
      throw error;
    }

    console.warn(`[Generate][${input.requestId}] Replicate 音频改写参数不兼容，自动降级为最小输入重试`);
    payload = await createReplicatePrediction(input.requestId, normalizedModelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(`Replicate 音频改写失败${detail ? `: ${detail}` : ""}`);
  }

  const finalPayload =
    status === "succeeded"
      ? payload
      : await (() => {
          if (!payload.id) {
            throw new Error("Replicate 返回结果缺少 prediction id。");
          }

          return waitForReplicatePredictionResult(
            payload.id,
            REPLICATE_TEXT_TASK_TIMEOUT_MS,
            `Replicate 音频改写超时，请稍后重试。prediction_id: ${payload.id}`,
          );
        })();

  const rewrittenText = extractReplicateTextOutput(finalPayload.output).trim();
  if (!rewrittenText) {
    throw new Error("音频编辑文案改写失败，未返回有效文本。");
  }

  return rewrittenText;
}

async function editAudioWithReplicate(input: {
  requestId: string;
  modelId: string;
  prompt: string;
  file: File;
  db: NonNullable<Awaited<ReturnType<typeof getRoutedRuntimeDbClient>>>;
}) {
  const pipeline = getReplicateAudioEditingPipelineModelIds(input.modelId);
  const uploaded = await uploadInputFileForEditing(input.db, input.requestId, "audio-edit", input.file);
  const transcript = await transcribeAudioWithReplicate(
    input.requestId,
    pipeline.transcriptionModelId,
    uploaded.publicUrl,
  );
  const rewrittenScript = await rewriteAudioTranscriptWithReplicate({
    requestId: input.requestId,
    instruction: input.prompt,
    transcript,
    modelId: pipeline.rewriteModelId,
  });
  const synthesized = await generateAudioWithReplicate(
    input.requestId,
    pipeline.synthesisModelId,
    rewrittenScript,
  );
  const audioUrls = extractReplicateOutputUrls(synthesized.output).slice(
    0,
    DEFAULT_AUDIO_OUTPUT_COUNT,
  );
  if (audioUrls.length === 0) {
    throw new Error("Replicate 音频重配未返回可用音频链接，请稍后重试。");
  }

  return {
    audioUrls,
    downloadLinks: audioUrls.map((url, index) => ({
      label: `audio-${index + 1}`,
      url,
    })),
    rewrittenScript,
    transcript,
  };
}

function extractDashScopeAudioBase64(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const output = (payload as Record<string, unknown>).output;
  if (!output || typeof output !== "object") {
    return null;
  }

  const audio = (output as Record<string, unknown>).audio;
  if (!audio || typeof audio !== "object") {
    return null;
  }

  const audioRecord = audio as Record<string, unknown>;
  const data = typeof audioRecord.data === "string" ? audioRecord.data.trim() : "";
  if (!data) {
    return null;
  }

  const mimeType = getAudioMimeTypeFromFormat(
    typeof audioRecord.mime_type === "string"
      ? audioRecord.mime_type
      : typeof audioRecord.format === "string"
        ? audioRecord.format
        : DASHSCOPE_TTS_RESPONSE_FORMAT,
  );

  return {
    bytes: decodeBase64ToUint8Array(data),
    mimeType,
  };
}

const IMAGE_FILE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

function buildGeneratedFileUrl(
  origin: string,
  fileId: string,
  fileName: string,
  disposition: "attachment" | "inline" = "attachment",
) {
  const searchParams = new URLSearchParams({
    downloadName: fileName,
  });

  if (disposition === "inline") {
    searchParams.set("disposition", "inline");
  }

  return `${origin}/api/generated-files/${fileId}?${searchParams.toString()}`;
}

function getFileExtensionFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname;
    const matched = pathname.match(/\.([a-z0-9]{2,8})$/i);
    return matched?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function getImageFileExtension(mimeType: string, fallbackUrl: string) {
  const normalizedMimeType = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    IMAGE_FILE_EXTENSION_BY_MIME_TYPE[normalizedMimeType] ??
    getFileExtensionFromUrl(fallbackUrl) ??
    "png"
  );
}

async function storeRemoteImageAsGeneratedFile(input: {
  origin: string;
  requestId: string;
  sourceUrl: string;
  provider: GenerationItem["provider"];
  index: number;
}) {
  const response = await providerFetch(
    getProxyProviderByModelProvider(input.provider),
    input.sourceUrl,
    {
      method: "GET",
      redirect: "follow",
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `生成图片下载失败 (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "image/png";
  if (!mimeType.startsWith("image/")) {
    throw new Error(`生成图片返回了非图片内容: ${mimeType}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const fileExtension = getImageFileExtension(mimeType, input.sourceUrl);
  const fileName = `image-${input.index + 1}-${input.requestId.slice(0, 8)}.${fileExtension}`;
  const stored = storeGeneratedFile({
    fileName,
    mimeType,
    bytes,
  });

  return {
    fileName,
    previewUrl: buildGeneratedFileUrl(input.origin, stored.id, fileName, "inline"),
    downloadUrl: buildGeneratedFileUrl(input.origin, stored.id, fileName, "attachment"),
  };
}

async function buildDashScopeAudioResult(response: Response, origin: string) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const payload = await readDashScopeJson<Record<string, unknown>>(response);
    const audioUrls = extractReplicateOutputUrls(payload).slice(0, DEFAULT_AUDIO_OUTPUT_COUNT);
    if (audioUrls.length === 0) {
      const base64Audio = extractDashScopeAudioBase64(payload);
      if (!base64Audio) {
        throw new Error("阿里云百炼语音合成未返回可用音频链接。");
      }

      const fileExtension = getAudioFileExtensionFromMimeType(base64Audio.mimeType);
      const fileName = `tts-${Date.now()}.${fileExtension}`;
      const stored = storeGeneratedFile({
        fileName,
        mimeType: base64Audio.mimeType,
        bytes: base64Audio.bytes,
      });
      const url = buildGeneratedFileUrl(origin, stored.id, fileName);

      return {
        audioUrls: [url],
        downloadLinks: [
          {
            label: fileName,
            url,
          },
        ],
      };
    }

    return {
      audioUrls,
      downloadLinks: audioUrls.map((url, index) => ({
        label: `audio-${index + 1}`,
        url,
      })),
    };
  }

  const binary = await readDashScopeBinary(response);
  const fileExtension = getAudioFileExtensionFromMimeType(binary.contentType);
  const fileName = `tts-${Date.now()}.${fileExtension}`;
  const stored = storeGeneratedFile({
    fileName,
    mimeType: binary.contentType,
    bytes: binary.bytes,
  });
  const url = buildGeneratedFileUrl(origin, stored.id, fileName);

  return {
    audioUrls: [url],
    downloadLinks: [
      {
        label: fileName,
        url,
      },
    ],
  };
}

async function generateAudioWithDashScope(
  modelId: string,
  prompt: string,
  origin: string,
) {
  const normalizedModelId = normalizeDashScopeAudioModelId(modelId);
  const requestCandidates: Record<string, unknown>[] = [
    {
      model: normalizedModelId,
      input: {
        text: prompt.trim(),
      },
      parameters: {
        voice: DASHSCOPE_TTS_VOICE,
        format: DASHSCOPE_TTS_RESPONSE_FORMAT,
      },
    },
    {
      model: normalizedModelId,
      input: {
        text: prompt.trim(),
      },
      parameters: {
        voice: DASHSCOPE_TTS_VOICE,
      },
    },
    {
      model: normalizedModelId,
      input: {
        text: prompt.trim(),
      },
    },
    {
      model: normalizedModelId,
      input: prompt.trim(),
    },
  ];

  let lastError: unknown = null;
  for (const body of requestCandidates) {
    try {
      const response = await dashScopeFetch("/api/v1/services/aigc/multimodal-generation/generation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, audio/*, application/octet-stream",
        },
        body: JSON.stringify(body),
      });

      return buildDashScopeAudioResult(response, origin);
    } catch (error) {
      lastError = error;
      const statusCode = getErrorStatusCode(error);
      if (statusCode !== 400 && statusCode !== 404 && statusCode !== 422) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("阿里云百炼语音合成失败。");
}

function buildReplicateDetectionPrompt(
  target: "document" | "image" | "audio" | "video",
  userPrompt: string,
  locale: "zh" | "en",
) {
  return [
    buildStructuredDetectionInstruction(target, locale),
    userPrompt,
  ].join("\n\n");
}

function buildAudioDetectionPrompt(fileName: string, locale: "zh" | "en") {
  if (locale === "zh") {
    return [
      `文件名：${fileName}`,
      "请根据音色稳定性、呼吸与停顿、频谱伪影、房间混响、情感变化和发音自然度，判断该音频是否更像 AI 合成语音。",
    ].join("\n\n");
  }

  return [
    `File name: ${fileName}`,
    "Estimate whether this audio sounds AI-generated by considering prosody, breathing, pauses, spectral artifacts, room tone, emotional variation, and pronunciation naturalness.",
  ].join("\n\n");
}

function mergeDetectionResults(results: NormalizedDetectionResult[]) {
  if (results.length === 0) {
    return normalizeDetectionResult("{}");
  }

  if (results.length === 1) {
    return results[0];
  }

  const probability = clampPercentage(
    results.reduce((sum, item) => sum + item.probability, 0) / results.length,
    results[0].probability,
  );
  const confidence = clampPercentage(
    results.reduce((sum, item) => sum + item.confidence, 0) / results.length,
    results[0].confidence,
  );
  const reasons = Array.from(
    new Set(results.flatMap((item) => item.reasons.map((reason) => reason.trim()))),
  )
    .filter(Boolean)
    .slice(0, 5);

  return {
    probability,
    confidence,
    verdict: resolveDetectionVerdict(probability),
    reasons,
    frameProbabilities: results.map((item) => item.probability),
  };
}

async function waitForReplicateDetectionResult(input: {
  requestId: string;
  modelId: string;
  primaryInput: Record<string, unknown>;
  fallbackInput: Record<string, unknown>;
  timeoutMessage: string;
}) {
  let payload: ReplicatePredictionPayload;
  try {
    payload = await createReplicatePrediction(
      input.requestId,
      input.modelId,
      input.primaryInput,
    );
  } catch (error) {
    if (getErrorStatusCode(error) !== 422) {
      throw error;
    }

    payload = await createReplicatePrediction(
      input.requestId,
      input.modelId,
      input.fallbackInput,
    );
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(`Replicate 检测失败${detail ? `: ${detail}` : ""}`);
  }

  const finalPayload =
    status === "succeeded"
      ? payload
      : await (() => {
          if (!payload.id) {
            throw new Error("Replicate 返回结果缺少 prediction id。");
          }

          return waitForReplicatePredictionResult(
            payload.id,
            REPLICATE_TEXT_TASK_TIMEOUT_MS,
            input.timeoutMessage,
          );
        })();

  const content = extractReplicateTextOutput(finalPayload.output);
  if (!content.trim()) {
    throw new Error("Replicate 检测未返回可解析内容。");
  }

  return normalizeDetectionResult(content);
}

async function detectDocumentWithReplicate(input: {
  requestId: string;
  modelId: string;
  file: File;
  locale: "zh" | "en";
}) {
  const extractedText = await extractDetectableDocumentText(input.file);
  if (!extractedText.trim()) {
    throw new Error(
      input.locale === "zh"
        ? "未能从文档中提取到可检测文本。"
        : "No detectable text could be extracted from the document.",
    );
  }

  const normalizedModelId = normalizeReplicateTextModelId(input.modelId);
  const prompt = buildReplicateDetectionPrompt(
    "document",
    buildDocumentDetectionPrompt({
      fileName: input.file.name,
      extractedText,
      locale: input.locale,
    }),
    input.locale,
  );

  return waitForReplicateDetectionResult({
    requestId: input.requestId,
    modelId: normalizedModelId,
    primaryInput: {
      prompt,
      max_new_tokens: DETECTION_MAX_TOKENS,
      temperature: 0.1,
      top_p: 0.95,
    },
    fallbackInput: {
      prompt,
    },
    timeoutMessage: `Replicate 文档检测超时，请稍后重试。model_id: ${normalizedModelId}`,
  });
}

async function detectImageWithReplicate(input: {
  requestId: string;
  modelId: string;
  imageUrl: string;
  locale: "zh" | "en";
  target: "image" | "video";
}) {
  const normalizedModelId = resolveReplicateVisualDetectionModelId(input.modelId);
  const prompt = buildReplicateDetectionPrompt(
    input.target,
    buildVisualDetectionPrompt(input.target, input.locale),
    input.locale,
  );

  return waitForReplicateDetectionResult({
    requestId: input.requestId,
    modelId: normalizedModelId,
    primaryInput: {
      image: input.imageUrl,
      prompt,
      max_length: DETECTION_MAX_TOKENS,
      temperature: 0.1,
      top_p: 0.95,
    },
    fallbackInput: {
      image: input.imageUrl,
      prompt,
    },
    timeoutMessage: `Replicate 视觉检测超时，请稍后重试。model_id: ${normalizedModelId}`,
  });
}

async function detectAudioWithDashScope(input: {
  requestId: string;
  modelId: string;
  file: File;
  locale: "zh" | "en";
  db: NonNullable<Awaited<ReturnType<typeof getRoutedRuntimeDbClient>>>;
}) {
  const uploaded = await uploadInputFileForEditing(
    input.db,
    input.requestId,
    "audio-detect",
    input.file,
  );

  const rawText = await requestDashScopeChatCompletionStreamText({
    model: resolveDashScopeAudioDetectionModelId(input.modelId),
    enable_thinking: false,
    temperature: 0.1,
    max_tokens: DETECTION_MAX_TOKENS,
    messages: [
      {
        role: "system",
        content: buildStructuredDetectionInstruction("audio", input.locale),
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildAudioDetectionPrompt(input.file.name, input.locale),
          },
          {
            type: "video_url",
            video_url: {
              url: uploaded.publicUrl,
            },
          },
        ],
      },
    ],
  });

  return normalizeDetectionResult(rawText);
}

async function detectAudioWithReplicate(input: {
  requestId: string;
  modelId: string;
  file: File;
  locale: "zh" | "en";
  db: NonNullable<Awaited<ReturnType<typeof getRoutedRuntimeDbClient>>>;
}) {
  const uploaded = await uploadInputFileForEditing(
    input.db,
    input.requestId,
    "audio-detect",
    input.file,
  );
  const normalizedModelId = resolveReplicateAudioDetectionModelId(input.modelId);
  const prompt = buildReplicateDetectionPrompt(
    "audio",
    buildAudioDetectionPrompt(input.file.name, input.locale),
    input.locale,
  );

  return waitForReplicateDetectionResult({
    requestId: input.requestId,
    modelId: normalizedModelId,
    primaryInput: {
      audio: uploaded.publicUrl,
      prompt,
      max_tokens: DETECTION_MAX_TOKENS,
      temperature: 0.1,
      top_p: 0.95,
    },
    fallbackInput: {
      audio: uploaded.publicUrl,
      prompt,
    },
    timeoutMessage: `Replicate 音频检测超时，请稍后重试。model_id: ${normalizedModelId}`,
  });
}

function buildFileGenerationPrompt(userPrompt: string, targetFormat: DocumentFileFormat) {
  const requireSpreadsheet = targetFormat === "xlsx";

  return [
    "User request:",
    userPrompt,
    "",
    `Target format: ${targetFormat}`,
    "",
    "Output requirements:",
    "- Create one complete document package that satisfies the request.",
    "- Keep the title concise and specific.",
    requireSpreadsheet
      ? "- Prioritize accurate spreadsheet structure, sheet names, columns, and rows."
      : "- Prioritize readable prose structure with clear headings and focused paragraphs.",
    requireSpreadsheet
      ? "- Include one useful spreadsheet such as a checklist, plan, budget, schedule, or summary table."
      : "- Keep the spreadsheets array empty unless a spreadsheet is clearly necessary.",
    "- Do not mention the schema or these instructions in the final content.",
  ].join("\n");
}

type GenerateResponsePayload = GenerationItem & {
  guestQuota?: GuestQuotaSnapshot;
};

function jsonWithCookie(
  payload: unknown,
  init?: ResponseInit,
  setCookieHeader?: string,
) {
  const response = Response.json(payload, init);
  if (setCookieHeader) {
    response.headers.append("Set-Cookie", setCookieHeader);
  }
  return response;
}

type UserQuotaType = "document" | "image" | "video" | "audio";

type UserQuotaAccountRow = {
  id?: string | null;
  cycle_end_date?: string | null;
};

type UserQuotaBalanceRow = {
  id?: string | null;
  base_limit?: number | string | null;
  addon_limit?: number | string | null;
  admin_adjustment?: number | string | null;
  used_amount?: number | string | null;
  remaining_amount?: number | string | null;
};

type UserQuotaReservation = {
  userId: string;
  source: "cn" | "global";
  quotaType: UserQuotaType;
  quotaAccountId: string;
  quotaBalanceId: string;
  requestId: string;
};

function toDbRows<T>(result: unknown): T[] {
  if (!result || typeof result !== "object" || !("data" in result)) {
    return [];
  }
  const data = (result as { data?: unknown }).data;
  if (Array.isArray(data)) {
    return data as T[];
  }
  if (data && typeof data === "object") {
    return [data as T];
  }
  return [];
}

function toDbErrorMessage(result: unknown) {
  if (!result || typeof result !== "object" || !("error" in result)) {
    return null;
  }
  const error = (result as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return null;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : "unknown";
}

function toNonNegativeInt(input: unknown, fallback = 0) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return Math.max(0, fallback);
  }
  return Math.max(0, Math.trunc(parsed));
}

function toInt(input: unknown, fallback = 0) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return Math.trunc(fallback);
  }
  return Math.trunc(parsed);
}

function formatUtcDateTimeForSql(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function getDbNowBySource(source: "cn" | "global") {
  return source === "cn"
    ? formatUtcDateTimeForSql(new Date())
    : new Date().toISOString();
}

function resolveQuotaTypeByGenerationType(type: string): UserQuotaType {
  if (type.endsWith("image")) {
    return "image";
  }
  if (type.endsWith("video")) {
    return "video";
  }
  if (type.endsWith("audio")) {
    return "audio";
  }
  return "document";
}

function getQuotaExhaustedMessage(quotaType: UserQuotaType) {
  const labelMap: Record<UserQuotaType, string> = {
    document: "文档",
    image: "图片",
    video: "视频",
    audio: "音频",
  };
  return `当前${labelMap[quotaType]}额度已用完，请升级套餐或联系管理员调整额度。`;
}

async function consumeUserGenerationQuota(input: {
  userId: string;
  source: "cn" | "global";
  quotaType: UserQuotaType;
  requestId: string;
}) {
  const db = await getRoutedRuntimeDbClient();
  if (!db) {
    throw new Error("数据库连接不可用，暂时无法校验用户额度。");
  }

  const accountResult = await db
    .from("user_quota_accounts")
    .select("id,cycle_end_date")
    .eq("user_id", input.userId)
    .eq("source", input.source)
    .eq("status", "active")
    .limit(20);

  const accountError = toDbErrorMessage(accountResult);
  if (accountError) {
    throw new Error(`读取用户额度账户失败: ${accountError}`);
  }

  const latestAccount = toDbRows<UserQuotaAccountRow>(accountResult)
    .map((item) => ({
      id: String(item.id || "").trim(),
      cycleEndDate: String(item.cycle_end_date || "").trim(),
    }))
    .filter((item) => item.id)
    .sort(
      (left, right) =>
        new Date(right.cycleEndDate || 0).getTime() -
        new Date(left.cycleEndDate || 0).getTime(),
    )[0];

  if (!latestAccount?.id) {
    return {
      allowed: false,
      message: getQuotaExhaustedMessage(input.quotaType),
    };
  }

  const balanceResult = await db
    .from("user_quota_balances")
    .select("id,base_limit,addon_limit,admin_adjustment,used_amount,remaining_amount")
    .eq("quota_account_id", latestAccount.id)
    .eq("quota_type", input.quotaType)
    .limit(1);

  const balanceError = toDbErrorMessage(balanceResult);
  if (balanceError) {
    throw new Error(`读取用户额度余额失败: ${balanceError}`);
  }

  const balance = toDbRows<UserQuotaBalanceRow>(balanceResult)[0];
  if (!balance?.id) {
    return {
      allowed: false,
      message: getQuotaExhaustedMessage(input.quotaType),
    };
  }

  const baseLimit = toNonNegativeInt(balance.base_limit, 0);
  const addonLimit = toNonNegativeInt(balance.addon_limit, 0);
  const adminAdjustment = toInt(balance.admin_adjustment, 0);
  const usedAmount = toNonNegativeInt(balance.used_amount, 0);
  const totalLimit = Math.max(0, baseLimit + addonLimit + adminAdjustment);
  const beforeRemaining =
    balance.remaining_amount === null || balance.remaining_amount === undefined
      ? Math.max(0, totalLimit - usedAmount)
      : toNonNegativeInt(balance.remaining_amount, Math.max(0, totalLimit - usedAmount));

  if (beforeRemaining <= 0) {
    return {
      allowed: false,
      message: getQuotaExhaustedMessage(input.quotaType),
    };
  }

  const nextUsedAmount = usedAmount + 1;
  const afterRemaining = Math.max(0, beforeRemaining - 1);
  const nowIso = getDbNowBySource(input.source);

  const updateResult = await db
    .from("user_quota_balances")
    .update({
      used_amount: nextUsedAmount,
      remaining_amount: afterRemaining,
      last_consumed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", balance.id);

  const updateError = toDbErrorMessage(updateResult);
  if (updateError) {
    throw new Error(`扣减用户额度失败: ${updateError}`);
  }

  try {
    await db.from("user_quota_change_logs").insert({
      id: `quota_log_${randomUUID().replace(/-/g, "")}`,
      user_id: input.userId,
      source: input.source,
      quota_type: input.quotaType,
      change_kind: "consume",
      delta_amount: -1,
      before_amount: beforeRemaining,
      after_amount: afterRemaining,
      reference_type: "ai_generate",
      reference_id: input.requestId,
      operator_type: "user",
      operator_id: input.userId,
      note: `generate_${input.quotaType}`,
      created_at: nowIso,
    });
  } catch (error) {
    console.warn("[Generate] 写入用户额度扣减日志失败:", error);
  }

  return {
    allowed: true,
    reservation: {
      userId: input.userId,
      source: input.source,
      quotaType: input.quotaType,
      quotaAccountId: latestAccount.id,
      quotaBalanceId: String(balance.id),
      requestId: input.requestId,
    } as UserQuotaReservation,
  };
}

async function releaseUserGenerationQuota(reservation: UserQuotaReservation) {
  const db = await getRoutedRuntimeDbClient();
  if (!db) {
    throw new Error("数据库连接不可用，无法回滚用户额度。");
  }

  const balanceResult = await db
    .from("user_quota_balances")
    .select("id,base_limit,addon_limit,admin_adjustment,used_amount,remaining_amount")
    .eq("id", reservation.quotaBalanceId)
    .limit(1);

  const balanceError = toDbErrorMessage(balanceResult);
  if (balanceError) {
    throw new Error(`回滚用户额度失败: ${balanceError}`);
  }

  const balance = toDbRows<UserQuotaBalanceRow>(balanceResult)[0];
  if (!balance?.id) {
    return;
  }

  const baseLimit = toNonNegativeInt(balance.base_limit, 0);
  const addonLimit = toNonNegativeInt(balance.addon_limit, 0);
  const adminAdjustment = toInt(balance.admin_adjustment, 0);
  const usedAmount = toNonNegativeInt(balance.used_amount, 0);
  if (usedAmount <= 0) {
    return;
  }

  const totalLimit = Math.max(0, baseLimit + addonLimit + adminAdjustment);
  const beforeRemaining =
    balance.remaining_amount === null || balance.remaining_amount === undefined
      ? Math.max(0, totalLimit - usedAmount)
      : toNonNegativeInt(balance.remaining_amount, Math.max(0, totalLimit - usedAmount));
  const nextUsedAmount = Math.max(0, usedAmount - 1);
  const afterRemaining = beforeRemaining + 1;
  const nowIso = getDbNowBySource(reservation.source);

  const updateResult = await db
    .from("user_quota_balances")
    .update({
      used_amount: nextUsedAmount,
      remaining_amount: afterRemaining,
      updated_at: nowIso,
    })
    .eq("id", reservation.quotaBalanceId);

  const updateError = toDbErrorMessage(updateResult);
  if (updateError) {
    throw new Error(`回滚用户额度失败: ${updateError}`);
  }

  try {
    await db.from("user_quota_change_logs").insert({
      id: `quota_log_${randomUUID().replace(/-/g, "")}`,
      user_id: reservation.userId,
      source: reservation.source,
      quota_type: reservation.quotaType,
      change_kind: "refund",
      delta_amount: 1,
      before_amount: beforeRemaining,
      after_amount: afterRemaining,
      reference_type: "ai_generate_rollback",
      reference_id: reservation.requestId,
      operator_type: "system",
      operator_id: null,
      note: `rollback_${reservation.quotaType}`,
      created_at: nowIso,
    });
  } catch (error) {
    console.warn("[Generate] 写入用户额度回滚日志失败:", error);
  }
}

export async function POST(req: Request) {
  const requestId = randomUUID();
  const requestTimer = createRequestTimer(requestId);
  let guestQuotaReservation: GuestQuotaReservation | null = null;
  let userQuotaReservation: UserQuotaReservation | null = null;
  let guestQuotaSnapshot: GuestQuotaSnapshot | undefined;
  let guestSetCookieHeader: string | undefined;
  let analyticsUserId: string | null = null;
  let analyticsSessionId: string | null = null;
  let analyticsStartTracked = false;
  let analyticsGenerationType: string | null = null;
  let analyticsModelId: string | null = null;
  let analyticsModelProvider: string | null = null;
  let generationStartedAtIso: string | null = null;
  let runtimeDbClient: Awaited<ReturnType<typeof getRoutedRuntimeDbClient>> | null =
    null;

  const analyticsSource = IS_DOMESTIC_RUNTIME ? "cn" : "global";
  const analyticsMeta = extractRequestAnalyticsMeta(req);

  const trackGenerateEvent = async (
    eventType: string,
    eventName: string,
    eventData: Record<string, unknown>,
    ensureSession: boolean,
    relatedTaskId?: string | null,
  ) => {
    try {
      const sessionId = await trackAnalyticsSessionEvent({
        source: analyticsSource,
        userId: analyticsUserId,
        sessionId: analyticsSessionId || undefined,
        ensureSession: ensureSession && Boolean(analyticsUserId),
        eventType,
        eventName,
        relatedTaskId: relatedTaskId || undefined,
        eventData,
        meta: analyticsMeta,
      });
      if (sessionId) {
        analyticsSessionId = sessionId;
      }
    } catch (error) {
      console.warn(
        `[Generate][${requestId}] analytics track failed (${eventType}/${eventName}):`,
        error,
      );
    }
  };

  const persistGenerationResult = async (
    generation: GenerationItem,
    requestParams?: Record<string, unknown> | null,
  ) => {
    if (!analyticsUserId || !runtimeDbClient) {
      return generation;
    }

    return persistGenerationHistory({
      db: runtimeDbClient,
      source: analyticsSource,
      userId: analyticsUserId,
      generation,
      requestParams,
      startedAt: generationStartedAtIso,
      finishedAt: new Date().toISOString(),
    });
  };

  const persistDetectionReportResult = async (
    generation: GenerationItem,
    detectionResult: NormalizedDetectionResult,
    requestParams?: Record<string, unknown> | null,
  ) => {
    if (!analyticsUserId || !runtimeDbClient) {
      return;
    }

    const insertResult = await runtimeDbClient.from("ai_detection_reports").insert({
      id: `detect_report_${randomUUID().replace(/-/g, "")}`,
      task_id: generation.id,
      user_id: analyticsUserId,
      source: analyticsSource,
      target_type: resolveDetectionTargetType(generation.type),
      confidence_score: detectionResult.confidence,
      risk_level: resolveDetectionRiskLevel(detectionResult.probability),
      verdict: mapDetectionVerdictToDbValue(detectionResult.verdict),
      report_text: generation.text || generation.summary || null,
      evidence_json: {
        probability: detectionResult.probability,
        confidence: detectionResult.confidence,
        verdict: detectionResult.verdict,
        reasons: detectionResult.reasons,
        frame_probabilities: detectionResult.frameProbabilities || null,
        request_params: requestParams || null,
        model_id: generation.modelId,
        model_label: generation.modelLabel,
        model_provider: generation.provider,
      },
      created_at: getDbNowBySource(analyticsSource),
    });

    const insertError = toDbErrorMessage(insertResult);
    if (insertError) {
      throw new Error(`写入 AI 检测报告失败: ${insertError}`);
    }
  };

  const getTrackedTaskId = (generation: GenerationItem) =>
    analyticsUserId && runtimeDbClient ? generation.id : null;

  const trackGenerateFailure = async (message: string) => {
    if (!analyticsStartTracked) {
      return;
    }

    await trackGenerateEvent(
      "generate_failed",
      "generate_request_failed",
      {
        type: analyticsGenerationType,
        model_id: analyticsModelId,
        model_provider: analyticsModelProvider,
        duration_ms: requestTimer.getTotalMs(),
        is_guest: !analyticsUserId,
        error: message,
      },
      false,
    );
  };

  const returnTrackedGenerateError = async (
    message: string,
    status: number,
  ) => {
    await trackGenerateFailure(message);
    return jsonWithCookie(
      guestQuotaSnapshot ? { message, guestQuota: guestQuotaSnapshot } : { message },
      { status },
      guestSetCookieHeader,
    );
  };

  try {
    const requestPayload = await parseGenerateRequest(req);
    const { prompt, type, inputFile, keyframeFile, frameFiles } = requestPayload;
    const cloudbaseAccessToken =
      req.headers.get(CLOUDBASE_ACCESS_TOKEN_HEADER)?.trim() || "";
    const supabaseAccessToken = extractBearerToken(req);

    type VerifiedLoginUser = {
      userId: string;
      email: string | null;
    };
    let loginUser: VerifiedLoginUser | null = null;

    if (!IS_DOMESTIC_RUNTIME && cloudbaseAccessToken) {
      return Response.json(
        { message: "当前为国际版环境，禁止使用国内版 CloudBase 登录令牌。" },
        { status: 403 },
      );
    }

    if (IS_DOMESTIC_RUNTIME && supabaseAccessToken) {
      return Response.json(
        { message: "当前为国内版环境，禁止使用国际版 Supabase 登录令牌。" },
        { status: 403 },
      );
    }

    if (IS_DOMESTIC_RUNTIME && cloudbaseAccessToken) {
      try {
        const verifiedCloudbaseUser = await verifyCloudbaseAccessToken(
          cloudbaseAccessToken,
        );
        if (!verifiedCloudbaseUser) {
          return Response.json(
            { message: "登录状态已失效，请重新登录。" },
            { status: 401 },
          );
        }
        loginUser = verifiedCloudbaseUser;
      } catch (error) {
        console.error(`[Generate][${requestId}] CloudBase 登录校验失败:`, error);
        return Response.json(
          { message: "登录校验失败，请稍后重试。" },
          { status: 503 },
        );
      }
    }

    if (!IS_DOMESTIC_RUNTIME && supabaseAccessToken) {
      if (!supabaseAdmin) {
        return Response.json(
          { message: "服务端缺少 Supabase 配置，暂时无法校验登录状态。" },
          { status: 503 },
        );
      }

      try {
        const { data, error } = await supabaseAdmin.auth.getUser(
          supabaseAccessToken,
        );
        if (error || !data.user) {
          return Response.json(
            { message: "登录状态已失效，请重新登录。" },
            { status: 401 },
          );
        }

        loginUser = {
          userId: data.user.id,
          email: data.user.email || null,
        };
      } catch (error) {
        console.error(`[Generate][${requestId}] Supabase 登录校验失败:`, error);
        return Response.json(
          { message: "登录校验失败，请稍后重试。" },
          { status: 503 },
        );
      }
    }

    if (loginUser?.userId) {
      runtimeDbClient = await getRoutedRuntimeDbClient();
      if (!runtimeDbClient) {
        return Response.json(
          { message: "用户档案初始化失败，请稍后重试。" },
          { status: 503 },
        );
      }

      if (IS_DOMESTIC_RUNTIME) {
        await ensureDomesticAppUser({
          db: runtimeDbClient,
          userId: loginUser.userId,
          email: loginUser.email,
        });
      } else {
        await ensureGlobalAppUser({
          db: runtimeDbClient,
          userId: loginUser.userId,
          email: loginUser.email,
        });
      }
    }

    analyticsUserId = loginUser?.userId || null;
    const isGuestRequest = !loginUser;

    if (!isGenerationTab(type) || !isConnectedGenerationTab(type)) {
      return Response.json({ message: "当前类型尚未接入后端模型。" }, { status: 400 });
    }

    if (isGuestRequest && type !== "text") {
      return jsonWithCookie(
        { message: "未登录用户仅可使用文档生成功能。" },
        { status: 403 },
        guestSetCookieHeader,
      );
    }

    if (!prompt) {
      return Response.json({ message: "请输入生成提示词。" }, { status: 400 });
    }

    const modelConfig = getGenerationModelConfig(type, requestPayload.model);
    if (!isGenerationModelEnabled(modelConfig.id)) {
      return Response.json(
        { message: getGenerationModelDisabledMessage(modelConfig.id, "zh") },
        { status: 403 },
      );
    }

    const reserveUserQuotaIfNeeded = async () => {
      if (isGuestRequest || !loginUser?.userId || userQuotaReservation) {
        return null;
      }

      const quotaType = resolveQuotaTypeByGenerationType(type);
      const userConsumeResult = await consumeUserGenerationQuota({
        userId: loginUser.userId,
        source: analyticsSource,
        quotaType,
        requestId,
      });

      if (!userConsumeResult.allowed) {
        return userConsumeResult.message || getQuotaExhaustedMessage(quotaType);
      }

      userQuotaReservation = userConsumeResult.reservation || null;
      return null;
    };

    analyticsGenerationType = type;
    analyticsModelId = modelConfig.id;
    analyticsModelProvider = modelConfig.provider;
    generationStartedAtIso = new Date().toISOString();

    await trackGenerateEvent(
      "generate_start",
      "generate_started",
      {
        type,
        model_id: modelConfig.id,
        model_provider: modelConfig.provider,
        is_guest: isGuestRequest,
      },
      true,
    );
    analyticsStartTracked = true;

    console.log(
      `[Generate][${requestId}] 收到请求，类型: ${type}，模型: ${modelConfig.id}，代理: ${getProviderProxyStatus(
        getProxyProviderByModelProvider(modelConfig.provider),
      )}`,
    );

    const detectionLocale = getRuntimeLocale();

    if (modelConfig.mode === "file-detection") {
      if (!inputFile) {
        return returnTrackedGenerateError("请上传待检测文档。", 400);
      }

      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const detectionResult =
        modelConfig.provider === "aliyun"
          ? await detectDocumentWithDashScope({
              modelId: modelConfig.id,
              file: inputFile,
              locale: detectionLocale,
            })
          : await detectDocumentWithReplicate({
              requestId,
              modelId: modelConfig.id,
              file: inputFile,
              locale: detectionLocale,
            });

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: buildDetectionSummary(detectionResult, detectionLocale),
        text: buildDetectionText(detectionResult, detectionLocale),
        createdAt: new Date().toISOString(),
      };
      const persistedResult = await persistGenerationResult(result, {
        source_file_name: inputFile.name,
      });
      await persistDetectionReportResult(persistedResult, detectionResult, {
        source_file_name: inputFile.name,
      });

      await trackGenerateEvent(
        "detect_success",
        "detect_document_success",
        {
          type,
          model_id: modelConfig.id,
          model_provider: modelConfig.provider,
          ai_probability: detectionResult.probability,
          confidence: detectionResult.confidence,
          duration_ms: requestTimer.getTotalMs(),
          is_guest: isGuestRequest,
        },
        false,
        getTrackedTaskId(persistedResult),
      );

      return Response.json(persistedResult);
    }

    if (modelConfig.mode === "image-detection") {
      if (!inputFile) {
        return returnTrackedGenerateError("请上传待检测图片。", 400);
      }

      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const detectionResult =
        modelConfig.provider === "aliyun"
          ? await detectVisualWithDashScope({
              modelId: modelConfig.id,
              files: [inputFile],
              locale: detectionLocale,
              target: "image",
            })
          : await (async () => {
              if (!runtimeDbClient) {
                throw new Error("图片检测缺少运行时数据库上下文。");
              }

              const uploaded = await uploadInputFileForEditing(
                runtimeDbClient,
                requestId,
                "image-detect",
                inputFile,
              );
              return detectImageWithReplicate({
                requestId,
                modelId: modelConfig.id,
                imageUrl: uploaded.publicUrl,
                locale: detectionLocale,
                target: "image",
              });
            })();

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: buildDetectionSummary(detectionResult, detectionLocale),
        text: buildDetectionText(detectionResult, detectionLocale),
        createdAt: new Date().toISOString(),
      };
      const persistedResult = await persistGenerationResult(result, {
        source_file_name: inputFile.name,
      });
      await persistDetectionReportResult(persistedResult, detectionResult, {
        source_file_name: inputFile.name,
      });

      await trackGenerateEvent(
        "detect_success",
        "detect_image_success",
        {
          type,
          model_id: modelConfig.id,
          model_provider: modelConfig.provider,
          ai_probability: detectionResult.probability,
          confidence: detectionResult.confidence,
          duration_ms: requestTimer.getTotalMs(),
          is_guest: isGuestRequest,
        },
        false,
        getTrackedTaskId(persistedResult),
      );

      return Response.json(persistedResult);
    }

    if (modelConfig.mode === "audio-detection") {
      if (!inputFile) {
        return returnTrackedGenerateError("请上传待检测音频。", 400);
      }

      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const detectionResult =
        modelConfig.provider === "aliyun"
          ? await (async () => {
              if (!runtimeDbClient) {
                throw new Error("音频检测缺少运行时数据库上下文。");
              }

              return detectAudioWithDashScope({
                requestId,
                modelId: modelConfig.id,
                file: inputFile,
                locale: detectionLocale,
                db: runtimeDbClient,
              });
            })()
          : await (async () => {
              if (!runtimeDbClient) {
                throw new Error("音频检测缺少运行时数据库上下文。");
              }

              return detectAudioWithReplicate({
                requestId,
                modelId: modelConfig.id,
                file: inputFile,
                locale: detectionLocale,
                db: runtimeDbClient,
              });
            })();

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: buildDetectionSummary(detectionResult, detectionLocale),
        text: buildDetectionText(detectionResult, detectionLocale),
        createdAt: new Date().toISOString(),
      };
      const persistedResult = await persistGenerationResult(result, {
        source_file_name: inputFile.name,
      });
      await persistDetectionReportResult(persistedResult, detectionResult, {
        source_file_name: inputFile.name,
      });

      await trackGenerateEvent(
        "detect_success",
        "detect_audio_success",
        {
          type,
          model_id: modelConfig.id,
          model_provider: modelConfig.provider,
          ai_probability: detectionResult.probability,
          confidence: detectionResult.confidence,
          duration_ms: requestTimer.getTotalMs(),
          is_guest: isGuestRequest,
        },
        false,
        getTrackedTaskId(persistedResult),
      );

      return Response.json(persistedResult);
    }

    if (modelConfig.mode === "video-detection") {
      if (!inputFile) {
        return returnTrackedGenerateError("请上传待检测视频。", 400);
      }
      if (frameFiles.length === 0) {
        return returnTrackedGenerateError("视频检测缺少关键帧，请重新上传后重试。", 400);
      }

      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const detectionResult =
        modelConfig.provider === "aliyun"
          ? await detectVisualWithDashScope({
              modelId: modelConfig.id,
              files: frameFiles,
              locale: detectionLocale,
              target: "video",
            })
          : await (async () => {
              if (!runtimeDbClient) {
                throw new Error("视频检测缺少运行时数据库上下文。");
              }

              const frameResults: NormalizedDetectionResult[] = [];
              const limitedFrames = frameFiles.slice(0, 3);
              for (let index = 0; index < limitedFrames.length; index += 1) {
                const frame = limitedFrames[index];
                const uploaded = await uploadInputFileForEditing(
                  runtimeDbClient,
                  requestId,
                  `video-detect-frame-${index + 1}`,
                  frame,
                );
                frameResults.push(
                  await detectImageWithReplicate({
                    requestId: `${requestId}-frame-${index + 1}`,
                    modelId: modelConfig.id,
                    imageUrl: uploaded.publicUrl,
                    locale: detectionLocale,
                    target: "video",
                  }),
                );
              }

              return mergeDetectionResults(frameResults);
            })();

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: buildDetectionSummary(detectionResult, detectionLocale),
        text: buildDetectionText(detectionResult, detectionLocale),
        createdAt: new Date().toISOString(),
      };
      const persistedResult = await persistGenerationResult(result, {
        source_file_name: inputFile.name,
        frame_count: frameFiles.length,
      });
      await persistDetectionReportResult(persistedResult, detectionResult, {
        source_file_name: inputFile.name,
        frame_count: frameFiles.length,
      });

      await trackGenerateEvent(
        "detect_success",
        "detect_video_success",
        {
          type,
          model_id: modelConfig.id,
          model_provider: modelConfig.provider,
          ai_probability: detectionResult.probability,
          confidence: detectionResult.confidence,
          frame_count: frameFiles.length,
          duration_ms: requestTimer.getTotalMs(),
          is_guest: isGuestRequest,
        },
        false,
        getTrackedTaskId(persistedResult),
      );

      return Response.json(persistedResult);
    }

    if (modelConfig.mode === "file-generation") {
      let requestedFormats: readonly DocumentFileFormat[] = [DOCUMENT_FILE_FORMATS[0]];

      if (requestPayload.formats !== undefined) {
        if (!Array.isArray(requestPayload.formats)) {
          return returnTrackedGenerateError("格式参数无效", 400);
        }

        const filteredFormats = Array.from(
          new Set(requestPayload.formats.filter(isDocumentFileFormat)),
        );

        if (filteredFormats.length === 0) {
          return returnTrackedGenerateError("未指定有效格式", 400);
        }

        if (filteredFormats.length !== 1) {
          return returnTrackedGenerateError("只能选择一个格式", 400);
        }

        requestedFormats = [filteredFormats[0]];
      }

      if (isGuestRequest) {
        const guestConsumeResult = await consumeGuestGenerationQuota(req);
        guestQuotaSnapshot = guestConsumeResult.snapshot;
        guestSetCookieHeader = guestConsumeResult.setCookieHeader;

        if (!guestConsumeResult.allowed) {
          return returnTrackedGenerateError(
            "游客配额已用完，请稍后再试",
            429,
          );
        }

        guestQuotaReservation = guestConsumeResult.reservation || null;
      }

      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const targetFormat = requestedFormats[0];
      const requireSpreadsheet = shouldRequireSpreadsheet(requestedFormats);

      const generationStartedAt = Date.now();
      const object =
        modelConfig.provider === "aliyun"
          ? await generateDocumentWithDashScope(
              requestId,
              modelConfig.id,
              prompt,
              targetFormat,
            )
          : await generateDocumentWithReplicate(
              requestId,
              modelConfig.id,
              prompt,
              targetFormat,
            );
      requestTimer.phase(
        "生成文档",
        generationStartedAt,
        `provider: ${modelConfig.provider}`,
      );

      const exportStartedAt = Date.now();
      const generatedFiles = await generateDocumentFiles(object, requestedFormats);
      requestTimer.phase(
        "导出文件",
        exportStartedAt,
        `formats: ${requestedFormats.join(",")}`,
      );

      const storageStartedAt = Date.now();
      const origin = new URL(req.url).origin;
      const downloadLinks = generatedFiles.map((file) => {
        const stored = storeGeneratedFile({
          fileName: file.fileName,
          mimeType: file.mimeType,
          bytes: file.bytes,
        });

        return {
          label: file.fileName,
          url: buildGeneratedFileUrl(origin, stored.id, file.fileName),
        };
      });
      requestTimer.phase("存储文件", storageStartedAt, `count: ${downloadLinks.length}`);

      const result: GenerateResponsePayload = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: `已生成 ${generatedFiles.length} 个文档`,
        text: `${object.title}
${object.summary}`,
        downloadLinks,
        createdAt: new Date().toISOString(),
      };
      if (guestQuotaSnapshot) {
        result.guestQuota = guestQuotaSnapshot;
      }

      const persistedResult = await persistGenerationResult(result, {
        requested_formats: requestedFormats,
        require_spreadsheet: requireSpreadsheet,
      });
      const responsePayload: GenerateResponsePayload = guestQuotaSnapshot
        ? {
            ...persistedResult,
            guestQuota: guestQuotaSnapshot,
          }
        : persistedResult;

      requestTimer.total("??????");
      await trackGenerateEvent(
        "generate_success",
        "generate_document_success",
        {
          type,
          model_id: modelConfig.id,
          model_provider: modelConfig.provider,
          output_count: generatedFiles.length,
          formats: requestedFormats,
          duration_ms: requestTimer.getTotalMs(),
          is_guest: isGuestRequest,
        },
        false,
        getTrackedTaskId(persistedResult),
      );
      return jsonWithCookie(responsePayload, undefined, guestSetCookieHeader);
    }

    if (modelConfig.mode === "file-editing") {
      if (!(inputFile instanceof File)) {
        return returnTrackedGenerateError("请先上传需要编辑的文档。", 400);
      }

      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const requestedFormats = getDocumentEditOutputFormats(inputFile.name);
      const requireSpreadsheet = shouldRequireSpreadsheet(requestedFormats);
      const origin = new URL(req.url).origin;
      const directEditResult = await tryPerformDirectDocumentEdit(inputFile, prompt);
      if (!directEditResult && getUploadFileExtension(inputFile.name) === "pdf") {
        return returnTrackedGenerateError(
          "PDF 编辑当前仅支持精准替换模式，例如：把文档中的【原文】改为【新文】，其他不要改。该模式会尽量保留原有版式与位置。",
          400,
        );
      }
      const editedDocument = directEditResult
        ? null
        : modelConfig.provider === "aliyun"
          ? await editDocumentWithDashScope({
              requestId,
              modelId: modelConfig.id,
              prompt,
              file: inputFile,
              requireSpreadsheet,
            })
          : await editDocumentWithReplicate({
              requestId,
              modelId: modelConfig.id,
              prompt,
              file: inputFile,
              requireSpreadsheet,
            });
      const generatedFiles = directEditResult
        ? directEditResult.generatedFiles
        : await generateDocumentFiles(editedDocument!, requestedFormats);
      const downloadLinks = generatedFiles.map((file) => {
        const stored = storeGeneratedFile({
          fileName: file.fileName,
          mimeType: file.mimeType,
          bytes: file.bytes,
        });

        return {
          label: file.fileName,
          url: buildGeneratedFileUrl(origin, stored.id, file.fileName),
        };
      });

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: directEditResult
          ? `已精确替换 ${directEditResult.replacementCount} 处文本并导出 ${generatedFiles.length} 个文件`
          : `已完成文档编辑并导出 ${generatedFiles.length} 个文件`,
        text: directEditResult
          ? directEditResult.previewText
          : buildGeneratedDocumentPreview(editedDocument!),
        downloadLinks,
        createdAt: new Date().toISOString(),
      };
      const persistedResult = await persistGenerationResult(result, {
        requested_formats: requestedFormats,
        source_file_name: inputFile.name,
        require_spreadsheet: requireSpreadsheet,
        editing_mode: directEditResult?.mode || "llm_regenerate",
        replacement_source_text: directEditResult?.sourceText || null,
        replacement_target_text: directEditResult?.targetText || null,
        replacement_count: directEditResult?.replacementCount || 0,
      });

      await trackGenerateEvent(
        "generate_success",
        "generate_document_success",
        {
          type,
          model_id: modelConfig.id,
          model_provider: modelConfig.provider,
          output_count: generatedFiles.length,
          formats: requestedFormats,
          duration_ms: requestTimer.getTotalMs(),
          is_guest: isGuestRequest,
        },
        false,
        getTrackedTaskId(persistedResult),
      );
      return Response.json(persistedResult);
    }

    if (modelConfig.mode === "audio-editing") {
      if (!(inputFile instanceof File)) {
        return returnTrackedGenerateError("请先上传需要编辑的音频。", 400);
      }

      if (!runtimeDbClient) {
        return returnTrackedGenerateError("编辑上传服务暂时不可用，请稍后重试。", 503);
      }

      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const origin = new URL(req.url).origin;
      const audioEditResult =
        modelConfig.provider === "aliyun"
          ? await editAudioWithDashScope({
              requestId,
              modelId: modelConfig.id,
              prompt,
              file: inputFile,
              origin,
              db: runtimeDbClient,
            })
          : await editAudioWithReplicate({
              requestId,
              modelId: modelConfig.id,
              prompt,
              file: inputFile,
              db: runtimeDbClient,
            });

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: `已完成音频转写与重配，共输出 ${audioEditResult.audioUrls.length} 条音频`,
        text: audioEditResult.rewrittenScript,
        audioUrls: audioEditResult.audioUrls,
        downloadLinks: audioEditResult.downloadLinks,
        createdAt: new Date().toISOString(),
      };
      const persistedResult = await persistGenerationResult(result, {
        source_file_name: inputFile.name,
        transcript_preview: truncateText(audioEditResult.transcript, 1200),
      });

      await trackGenerateEvent(
        "generate_success",
        "generate_audio_success",
        {
          type,
          model_id: modelConfig.id,
          model_provider: modelConfig.provider,
          output_count: audioEditResult.audioUrls.length,
          duration_ms: requestTimer.getTotalMs(),
          is_guest: isGuestRequest,
        },
        false,
        getTrackedTaskId(persistedResult),
      );
      return Response.json(persistedResult);
    }

    if (modelConfig.mode === "image-editing") {
      if (!(inputFile instanceof File)) {
        return returnTrackedGenerateError("请先上传需要编辑的图片。", 400);
      }

      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const imagePayload =
        modelConfig.provider === "aliyun"
          ? await editImageWithDashScope(modelConfig.id, prompt, inputFile)
          : await (() => {
              if (!runtimeDbClient) {
                throw new Error("编辑上传服务暂时不可用，请稍后重试。");
              }

              return editImageWithReplicate({
                requestId,
                modelId: modelConfig.id,
                prompt,
                file: inputFile,
                db: runtimeDbClient,
              });
            })();
      const imageUrls = extractReplicateOutputUrls(imagePayload.output).slice(
        0,
        DEFAULT_IMAGE_OUTPUT_COUNT,
      );
      if (imageUrls.length === 0) {
        throw new Error(
          modelConfig.provider === "aliyun"
            ? "阿里云百炼图片编辑未返回可用图片链接，请稍后重试。"
            : "Replicate 图片编辑未返回可用图片链接，请稍后重试。",
        );
      }

      const origin = new URL(req.url).origin;
      const localImages = await Promise.all(
        imageUrls.map((sourceUrl, index) =>
          storeRemoteImageAsGeneratedFile({
            origin,
            requestId,
            sourceUrl,
            provider: modelConfig.provider,
            index,
          }),
        ),
      );

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: `已完成 ${localImages.length} 张图片编辑`,
        imageUrls: localImages.map((item) => item.previewUrl),
        downloadLinks: localImages.map((item) => ({
          label: item.fileName,
          url: item.downloadUrl,
        })),
        createdAt: new Date().toISOString(),
      };
      const persistedResult = await persistGenerationResult(result, {
        source_file_name: inputFile.name,
      });

      await trackGenerateEvent(
        "generate_success",
        "generate_image_success",
        {
          type,
          model_id: modelConfig.id,
          model_provider: modelConfig.provider,
          output_count: localImages.length,
          duration_ms: requestTimer.getTotalMs(),
          is_guest: isGuestRequest,
        },
        false,
        getTrackedTaskId(persistedResult),
      );
      return Response.json(persistedResult);
    }

    if (modelConfig.mode === "audio-generation") {
      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const origin = new URL(req.url).origin;
      const audioGenerationResult =
        modelConfig.provider === "aliyun"
          ? await generateAudioWithDashScope(modelConfig.id, prompt, origin)
          : await (async () => {
              getReplicateApiKeyOrThrow();
              const prediction = await generateAudioWithReplicate(requestId, modelConfig.id, prompt);
              const audioUrls = extractReplicateOutputUrls(prediction.output).slice(
                0,
                DEFAULT_AUDIO_OUTPUT_COUNT,
              );
              if (audioUrls.length === 0) {
                throw new Error("Replicate 音频生成未返回可用音频链接，请稍后重试。");
              }

              return {
                audioUrls,
                downloadLinks: audioUrls.map((url, index) => ({
                  label: `audio-${index + 1}`,
                  url,
                })),
              };
            })();

      const { audioUrls, downloadLinks } = audioGenerationResult;
      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: `已生成 ${audioUrls.length} 条音频`,
        audioUrls,
        downloadLinks,
        createdAt: new Date().toISOString(),
      };
      const persistedResult = await persistGenerationResult(result, null);

      await trackGenerateEvent(
        "generate_success",
        "generate_audio_success",
        {
          type,
          model_id: modelConfig.id,
          model_provider: modelConfig.provider,
          output_count: audioUrls.length,
          duration_ms: requestTimer.getTotalMs(),
          is_guest: isGuestRequest,
        },
        false,
        getTrackedTaskId(persistedResult),
      );
      return Response.json(persistedResult);
    }

    if (modelConfig.mode === "image-generation") {
      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const imagePayload =
        modelConfig.provider === "aliyun"
          ? await generateImageWithDashScope(requestId, modelConfig.id, prompt)
          : await (async () => {
              getReplicateApiKeyOrThrow();
              return generateImageWithReplicate(requestId, modelConfig.id, prompt);
            })();
      const imageUrls = extractReplicateOutputUrls(imagePayload.output).slice(
        0,
        DEFAULT_IMAGE_OUTPUT_COUNT,
      );
      if (imageUrls.length === 0) {
        throw new Error(
          modelConfig.provider === "aliyun"
            ? "阿里云百炼未返回可用图片链接，请稍后重试。"
            : "Replicate 未返回可用图片链接，请稍后重试。",
        );
      }

      const origin = new URL(req.url).origin;
      const localImages = await Promise.all(
        imageUrls.map((sourceUrl, index) =>
          storeRemoteImageAsGeneratedFile({
            origin,
            requestId,
            sourceUrl,
            provider: modelConfig.provider,
            index,
          }),
        ),
      );

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: `已生成 ${localImages.length} 张图片`,
        imageUrls: localImages.map((item) => item.previewUrl),
        downloadLinks: localImages.map((item) => ({
          label: item.fileName,
          url: item.downloadUrl,
        })),
        createdAt: new Date().toISOString(),
      };
      const persistedResult = await persistGenerationResult(result, null);

      await trackGenerateEvent(
        "generate_success",
        "generate_image_success",
        {
          type,
          model_id: modelConfig.id,
          model_provider: modelConfig.provider,
          output_count: localImages.length,
          duration_ms: requestTimer.getTotalMs(),
          is_guest: isGuestRequest,
        },
        false,
        getTrackedTaskId(persistedResult),
      );
      return Response.json(persistedResult);
    }

    if (modelConfig.mode === "video-editing") {
      if (modelConfig.provider === "aliyun" && !(keyframeFile instanceof File)) {
        return returnTrackedGenerateError(
          "请重新上传视频，系统需要提取首帧后再执行视频编辑。",
          400,
        );
      }

      if (modelConfig.provider === "replicate" && !(inputFile instanceof File)) {
        return returnTrackedGenerateError("请先上传需要编辑的视频。", 400);
      }

      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const videoPayload =
        modelConfig.provider === "aliyun"
          ? await editVideoWithDashScope(modelConfig.id, prompt, keyframeFile!)
          : await (() => {
              if (!runtimeDbClient || !(inputFile instanceof File)) {
                throw new Error("编辑上传服务暂时不可用，请稍后重试。");
              }

              return editVideoWithReplicate({
                requestId,
                modelId: modelConfig.id,
                prompt,
                file: inputFile,
                db: runtimeDbClient,
              });
            })();
      const videoUrls = extractReplicateOutputUrls(videoPayload.output).slice(
        0,
        DEFAULT_VIDEO_OUTPUT_COUNT,
      );
      if (videoUrls.length === 0) {
        throw new Error(
          modelConfig.provider === "aliyun"
            ? "阿里云百炼视频编辑未返回可用视频链接，请稍后重试。"
            : "Replicate 视频编辑未返回可用视频链接，请稍后重试。",
        );
      }

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary:
          modelConfig.provider === "aliyun"
            ? `已基于首帧重生成 ${videoUrls.length} 条视频`
            : `已完成 ${videoUrls.length} 条视频编辑`,
        videoUrls,
        downloadLinks: videoUrls.map((url, index) => ({
          label: `video-${index + 1}`,
          url,
        })),
        createdAt: new Date().toISOString(),
      };
      const persistedResult = await persistGenerationResult(result, {
        source_file_name: inputFile?.name || null,
        keyframe_file_name: keyframeFile?.name || null,
      });

      await trackGenerateEvent(
        "generate_success",
        "generate_video_success",
        {
          type,
          model_id: modelConfig.id,
          model_provider: modelConfig.provider,
          output_count: videoUrls.length,
          duration_ms: requestTimer.getTotalMs(),
          is_guest: isGuestRequest,
        },
        false,
        getTrackedTaskId(persistedResult),
      );
      return Response.json(persistedResult);
    }

    const userQuotaError = await reserveUserQuotaIfNeeded();
    if (userQuotaError) {
      return returnTrackedGenerateError(userQuotaError, 429);
    }

    const videoPayload =
      modelConfig.provider === "aliyun"
        ? await generateVideoWithDashScope(requestId, modelConfig.id, prompt)
        : await (async () => {
            getReplicateApiKeyOrThrow();
            return generateVideoWithReplicate(requestId, modelConfig.id, prompt);
          })();
    const videoUrls = extractReplicateOutputUrls(videoPayload.output).slice(
      0,
      DEFAULT_VIDEO_OUTPUT_COUNT,
    );
    if (videoUrls.length === 0) {
      throw new Error(
        modelConfig.provider === "aliyun"
          ? "阿里云百炼未返回可用视频链接，请稍后重试。"
          : "Replicate 未返回可用视频链接，请稍后重试。",
      );
    }

    const result: GenerationItem = {
      id: requestId,
      type,
      prompt,
      modelId: modelConfig.id,
      modelLabel: modelConfig.label,
      provider: modelConfig.provider,
      status: "success",
      summary: `已生成 ${videoUrls.length} 条视频`,
      videoUrls,
      downloadLinks: videoUrls.map((url, index) => ({
        label: `video-${index + 1}`,
        url,
      })),
      createdAt: new Date().toISOString(),
    };
    const persistedResult = await persistGenerationResult(result, null);

    await trackGenerateEvent(
      "generate_success",
      "generate_video_success",
      {
        type,
        model_id: modelConfig.id,
        model_provider: modelConfig.provider,
        output_count: videoUrls.length,
        duration_ms: requestTimer.getTotalMs(),
        is_guest: isGuestRequest,
      },
      false,
      getTrackedTaskId(persistedResult),
    );
    return Response.json(persistedResult);
  } catch (error) {
    if (guestQuotaReservation) {
      try {
        const releasedQuota = await releaseGuestGenerationQuota(guestQuotaReservation);
        if (releasedQuota) {
          guestQuotaSnapshot = releasedQuota;
        }
      } catch (releaseError) {
        console.error(`[Generate][${requestId}] 游客额度回滚失败:`, releaseError);
      }
    }

    if (userQuotaReservation) {
      try {
        await releaseUserGenerationQuota(userQuotaReservation);
      } catch (releaseError) {
        console.error(`[Generate][${requestId}] 用户额度回滚失败:`, releaseError);
      }
    }

    const statusCode = getErrorStatusCode(error);
    const message = getGenerationErrorMessage(error);
    console.error(
      `[Generate][${requestId}] 请求处理失败，总耗时: ${requestTimer.getTotalMs()}ms:`,
      error,
    );

    await trackGenerateFailure(message);

    return jsonWithCookie(
      guestQuotaSnapshot ? { message, guestQuota: guestQuotaSnapshot } : { message },
      { status: statusCode >= 400 ? statusCode : 500 },
      guestSetCookieHeader,
    );
  }
}

