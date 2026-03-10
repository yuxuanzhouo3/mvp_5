import { createMistral } from "@ai-sdk/mistral";
import { generateObject } from "ai";
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
} from "@/lib/document-export";
import { storeGeneratedFile } from "@/lib/generated-files";
import { getProviderProxyStatus, providerFetch } from "@/lib/provider-http";
import { verifyCloudbaseAccessToken } from "@/lib/server/cloudbase-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  consumeGuestGenerationQuota,
  releaseGuestGenerationQuota,
  type GuestQuotaReservation,
  type GuestQuotaSnapshot,
} from "@/lib/server/guest-quota";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const CLOUDBASE_ACCESS_TOKEN_HEADER = "x-cloudbase-access-token";
const AUTHORIZATION_HEADER = "authorization";
const IS_DOMESTIC_RUNTIME = (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "zh")
  .toLowerCase()
  .startsWith("zh");

const FILE_GENERATION_SYSTEM_PROMPT_LINES = [
  "You generate structured documents for export to PDF, Excel, Word, TXT, and Markdown.",
  "Return content that follows the provided schema exactly.",
  "Default to Simplified Chinese unless the user explicitly requests another language.",
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
const DASHSCOPE_CHAT_COMPLETION_TIMEOUT_MS = getPositiveIntFromEnv(
  "DASHSCOPE_CHAT_COMPLETION_TIMEOUT_MS",
  60000,
);
const DOCUMENT_GENERATION_MAX_TOKENS = getPositiveIntFromEnv(
  "DOCUMENT_GENERATION_MAX_TOKENS",
  900,
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

const mistral = createMistral({
  apiKey: process.env.MISTRAL_API_KEY,
  baseURL: process.env.MISTRAL_BASE_URL,
  fetch: (input, init) => providerFetch("mistral", input, init),
});

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

function getGenerationErrorMessage(error: unknown) {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : "未知错误";
  const normalizedMessage = rawMessage.toLowerCase();
  const errorCode = (getNestedErrorCode(error) ?? "").toUpperCase();
  const statusCode = getErrorStatusCode(error);
  const retryAfter = getResponseHeaderValue(error, "retry-after");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;

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

  if (isNetworkConnectionError(error)) {
    return `网络连接异常（${errorCode || "NETWORK_ERROR"}），请检查代理或稍后重试。`;
  }

  return rawMessage;
}

function getMistralApiKeyOrThrow() {
  const apiKey = process.env.MISTRAL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("缺少 MISTRAL_API_KEY");
  }

  return apiKey;
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
  const { owner, name } = splitReplicateModelId(modelId);
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

      const versionId = await getReplicateLatestVersionId(modelId);
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

async function generateImageWithReplicate(requestId: string, modelId: string, prompt: string) {
  const payload = await createReplicatePrediction(requestId, modelId, {
    prompt: buildReplicateImagePrompt(prompt),
    aspect_ratio: "16:9",
    safety_filter_level: "block_medium_and_above",
  });

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
  return `Replicate audio generation timed out for ${modelId}. prediction_id: ${predictionId}`;
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

function buildReplicateVideoInputs(modelId: string, promptForModel: string) {
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
      duration: 5,
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
    titleFallback: `?? ${index + 1}`,
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
    name: "????",
    columns: ["??", "??"],
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
    "????";

  const summary =
    firstNonEmptyText(record, ["summary", "abstract", "overview", "description"], 1200) ||
    truncateText(
      normalizedSections.flatMap((section) => section.paragraphs).join(" ") || `???${prompt}??????????`,
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

function supportsDashScopeJsonSchema(modelId: string) {
  return DASHSCOPE_JSON_SCHEMA_MODEL_IDS.has(modelId);
}

function shouldDisableThinkingForDashScopeDocumentMode(
  modelId: string,
  _mode: DashScopeDocumentResponseMode,
) {
  return modelId === "qwen3.5-flash";
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

function buildFileGenerationSystemPrompt(requireSpreadsheet: boolean) {
  return [
    ...FILE_GENERATION_SYSTEM_PROMPT_LINES,
    requireSpreadsheet
      ? "Include at least one meaningful spreadsheet that matches the user's request."
      : "Spreadsheets are optional. Return an empty spreadsheets array unless tabular data is clearly helpful.",
  ].join("\n");
}

async function generateDocumentWithDashScope(
  requestId: string,
  modelId: string,
  prompt: string,
  requireSpreadsheet: boolean,
) {
  const systemPrompt = `${buildFileGenerationSystemPrompt(requireSpreadsheet)} Respond with raw JSON only.`;
  const baseRequest = {
    model: modelId,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: buildFileGenerationPrompt(prompt, requireSpreadsheet),
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
    throw new Error("?????????????????");
  }

  const rawDocument = JSON.parse(stripMarkdownCodeFence(content));
  const documentSchema = getGeneratedDocumentSchema({ requireSpreadsheet });
  const directResult = documentSchema.safeParse(rawDocument);
  if (directResult.success) {
    return directResult.data;
  }

  const normalizedDocument = normalizeGeneratedDocumentPayload(rawDocument, prompt, requireSpreadsheet);
  const normalizedResult = documentSchema.safeParse(normalizedDocument);
  if (normalizedResult.success) {
    console.warn(
      `[Generate][${requestId}][DashScope][document] 原始结构未完全命中 schema，已自动归一化。字段: ${directResult.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
    return normalizedResult.data;
  }

  throw normalizedResult.error;
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
          n: 1,
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

async function generateVideoWithDashScope(requestId: string, modelId: string, prompt: string) {
  const keyframePayload = await generateImageWithDashScope(requestId, "wan2.6-t2i", prompt);
  const imageUrls = extractReplicateOutputUrls(keyframePayload.output).slice(0, 1);
  if (imageUrls.length === 0) {
    throw new Error("阿里云百炼文生视频未获取到可用首帧图片链接。");
  }

  const payload = await createDashScopeVideoTask(modelId, prompt, imageUrls[0]);
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
  if (modelId === "qwen3-tts-instruct-flash-realtime") {
    return "qwen3-tts-instruct-flash";
  }

  return modelId;
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
    const audioUrls = extractReplicateOutputUrls(payload).slice(0, 4);
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

function buildFileGenerationPrompt(userPrompt: string, requireSpreadsheet: boolean) {
  return [
    "User request:",
    userPrompt,
    "",
    "Output requirements:",
    "- Create one complete document package that satisfies the request.",
    "- Keep the title concise and specific.",
    "- Write a practical summary and focused sections.",
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

export async function POST(req: Request) {
  const requestId = randomUUID();
  const requestTimer = createRequestTimer(requestId);
  let guestQuotaReservation: GuestQuotaReservation | null = null;
  let guestQuotaSnapshot: GuestQuotaSnapshot | undefined;
  let guestSetCookieHeader: string | undefined;

  try {
    const body = (await req.json()) as {
      prompt?: unknown;
      type?: unknown;
      model?: unknown;
      formats?: unknown;
    };

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const type = typeof body.type === "string" ? body.type : "";
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

    const modelConfig = getGenerationModelConfig(type, body.model);
    if (!isGenerationModelEnabled(modelConfig.id)) {
      return Response.json(
        { message: getGenerationModelDisabledMessage(modelConfig.id, "zh") },
        { status: 403 },
      );
    }

    console.log(
      `[Generate][${requestId}] 收到请求，类型: ${type}，模型: ${modelConfig.id}，代理: ${getProviderProxyStatus(
        getProxyProviderByModelProvider(modelConfig.provider),
      )}`,
    );

    if (modelConfig.mode === "file-generation") {
      let requestedFormats: readonly DocumentFileFormat[] = DOCUMENT_FILE_FORMATS;

      if (body.formats !== undefined) {
        if (!Array.isArray(body.formats)) {
          return Response.json({ message: "文档格式参数无效。" }, { status: 400 });
        }

        const filteredFormats = Array.from(
          new Set(body.formats.filter(isDocumentFileFormat)),
        );

        if (filteredFormats.length === 0) {
          return Response.json({ message: "请至少选择一种文档格式。" }, { status: 400 });
        }

        requestedFormats = filteredFormats;
      }

      if (isGuestRequest && requestedFormats.length !== 1) {
        return jsonWithCookie(
          { message: "未登录用户每次仅能选择一种文档格式。" },
          { status: 400 },
          guestSetCookieHeader,
        );
      }

      if (isGuestRequest) {
        const guestConsumeResult = await consumeGuestGenerationQuota(req);
        guestQuotaSnapshot = guestConsumeResult.snapshot;
        guestSetCookieHeader = guestConsumeResult.setCookieHeader;

        if (!guestConsumeResult.allowed) {
          return jsonWithCookie(
            {
              message: "游客本月文档生成额度已用完，请登录后继续使用。",
              guestQuota: guestQuotaSnapshot,
            },
            { status: 429 },
            guestSetCookieHeader,
          );
        }

        guestQuotaReservation = guestConsumeResult.reservation || null;
      }

      const requireSpreadsheet = shouldRequireSpreadsheet(requestedFormats);
      const documentSchema = getGeneratedDocumentSchema({ requireSpreadsheet });

      const generationStartedAt = Date.now();
      const object =
        modelConfig.provider === "aliyun"
          ? await generateDocumentWithDashScope(
              requestId,
              modelConfig.id,
              prompt,
              requireSpreadsheet,
            )
          : await (async () => {
              getMistralApiKeyOrThrow();
              const result = await generateObject({
                model: mistral(modelConfig.id),
                schema: documentSchema,
                schemaName: "generated_document",
                schemaDescription:
                  "Structured content for exporting PDF, Excel, Word, TXT and Markdown files.",
                system: buildFileGenerationSystemPrompt(requireSpreadsheet),
                prompt: buildFileGenerationPrompt(prompt, requireSpreadsheet),
                temperature: 0.3,
                maxTokens: DOCUMENT_GENERATION_MAX_TOKENS,
                maxRetries: 0,
              });
              return result.object;
            })();
      requestTimer.phase(
        "文档内容生成完成",
        generationStartedAt,
        `provider: ${modelConfig.provider}`,
      );

      const exportStartedAt = Date.now();
      const generatedFiles = await generateDocumentFiles(object, requestedFormats);
      requestTimer.phase(
        "文档文件导出完成",
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
      requestTimer.phase("文档文件落库完成", storageStartedAt, `count: ${downloadLinks.length}`);

      const result: GenerateResponsePayload = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: `已生成 ${generatedFiles.length} 个文档文件`,
        text: `${object.title}
${object.summary}`,
        downloadLinks,
        createdAt: new Date().toISOString(),
      };
      if (guestQuotaSnapshot) {
        result.guestQuota = guestQuotaSnapshot;
      }

      requestTimer.total("文档请求完成");
      return jsonWithCookie(result, undefined, guestSetCookieHeader);
    }

    if (modelConfig.mode === "audio-generation") {
      const origin = new URL(req.url).origin;
      const audioGenerationResult =
        modelConfig.provider === "aliyun"
          ? await generateAudioWithDashScope(modelConfig.id, prompt, origin)
          : await (async () => {
              getReplicateApiKeyOrThrow();
              const prediction = await generateAudioWithReplicate(requestId, modelConfig.id, prompt);
              const audioUrls = extractReplicateOutputUrls(prediction.output).slice(0, 4);
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

      return Response.json(result);
    }

    if (modelConfig.mode === "image-generation") {
      const imagePayload =
        modelConfig.provider === "aliyun"
          ? await generateImageWithDashScope(requestId, modelConfig.id, prompt)
          : await (async () => {
              getReplicateApiKeyOrThrow();
              return generateImageWithReplicate(requestId, modelConfig.id, prompt);
            })();
      const imageUrls = extractReplicateOutputUrls(imagePayload.output).slice(0, 4);
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

      return Response.json(result);
    }

    const videoPayload =
      modelConfig.provider === "aliyun"
        ? await generateVideoWithDashScope(requestId, modelConfig.id, prompt)
        : await (async () => {
            getReplicateApiKeyOrThrow();
            return generateVideoWithReplicate(requestId, modelConfig.id, prompt);
          })();
    const videoUrls = extractReplicateOutputUrls(videoPayload.output).slice(0, 2);
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

    return Response.json(result);
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

    const statusCode = getErrorStatusCode(error);
    const message = getGenerationErrorMessage(error);
    console.error(
      `[Generate][${requestId}] 请求处理失败，总耗时: ${requestTimer.getTotalMs()}ms:`,
      error,
    );

    return jsonWithCookie(
      guestQuotaSnapshot ? { message, guestQuota: guestQuotaSnapshot } : { message },
      { status: statusCode >= 400 ? statusCode : 500 },
      guestSetCookieHeader,
    );
  }
}

