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

type PromptLocale = "zh" | "en";
type ReplicateImageOutputFormat = "jpg" | "png" | "webp";
type ReplicateVideoAspectRatio = "16:9" | "1:1" | "9:16";

function joinPromptLines(lines: readonly string[]) {
  return lines.filter(Boolean).join("\n");
}

function buildFileGenerationSchemaPromptLines(locale: PromptLocale) {
  if (locale === "zh") {
    return [
      "你是专业的结构化文档生成助手，负责输出可导出为 PDF、Excel、Word、TXT、Markdown 的完整文档包。",
      "必须严格遵守给定 schema，字段名、层级、数据类型都不能改动，也不能输出 schema 之外的解释或附加文本。",
      "默认输出简体中文，除非用户明确要求其他语言。",
      "内容必须直接可用、信息完整、结构清晰，避免空话、套话和无意义占位内容。",
      "",
      "必须只返回 JSON，且必须严格符合以下结构：",
      "{",
      '  "title": "文档标题（string, 1-120 chars）",',
      '  "summary": "文档摘要（string, 1-1200 chars）",',
      '  "sections": [',
      "    {",
      '      "heading": "章节标题（string, 1-80 chars）",',
      '      "paragraphs": ["段落文本（string, 1-1500 chars）"],',
      '      "bullets": ["可选要点（string, max 200 chars）"],',
      '      "table": {',
      '        "title": "可选表格标题",',
      '        "columns": ["列1", "列2"],',
      '        "rows": [["单元格1", "单元格2"]]',
      "      }",
      "    }",
      "  ],",
      '  "spreadsheets": []',
      "}",
    ] as const;
  }

  return [
    "You are a professional structured document generation assistant for exportable PDF, Excel, Word, TXT, and Markdown content.",
    "You must follow the provided schema exactly: do not rename keys, change nesting, alter data types, or output any extra commentary outside the JSON payload.",
    "Default to English unless the user explicitly requests another language.",
    "The result must be directly usable, content-complete, well-structured, and free of filler or placeholder text.",
    "",
    "You must return JSON only in this exact structure:",
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
  ] as const;
}

const REPLICATE_POLL_INTERVAL_MS = 1200;
const REPLICATE_IMAGE_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "REPLICATE_IMAGE_TASK_TIMEOUT_MS",
  120000,
);
const REPLICATE_SANA_IMAGE_WIDTH = getPositiveIntFromEnv(
  "REPLICATE_SANA_IMAGE_WIDTH",
  1024,
);
const REPLICATE_SANA_IMAGE_HEIGHT = getPositiveIntFromEnv(
  "REPLICATE_SANA_IMAGE_HEIGHT",
  576,
);
const REPLICATE_SANA_IMAGE_OUTPUT_FORMAT = getReplicateImageOutputFormatFromEnv(
  "REPLICATE_SANA_IMAGE_OUTPUT_FORMAT",
  "jpg",
);
const REPLICATE_SANA_IMAGE_OUTPUT_QUALITY = getPositiveIntFromEnv(
  "REPLICATE_SANA_IMAGE_OUTPUT_QUALITY",
  85,
);
const REPLICATE_FLUX_IMAGE_ASPECT_RATIO =
  process.env.REPLICATE_FLUX_IMAGE_ASPECT_RATIO?.trim() || "16:9";
const REPLICATE_FLUX_IMAGE_OUTPUT_FORMAT = getReplicateImageOutputFormatFromEnv(
  "REPLICATE_FLUX_IMAGE_OUTPUT_FORMAT",
  "jpg",
);
const REPLICATE_FLUX_IMAGE_OUTPUT_QUALITY = getPositiveIntFromEnv(
  "REPLICATE_FLUX_IMAGE_OUTPUT_QUALITY",
  85,
);
const REPLICATE_FLUX_IMAGE_MEGAPIXELS =
  process.env.REPLICATE_FLUX_IMAGE_MEGAPIXELS?.trim() || "1";
const REPLICATE_FLUX_IMAGE_NUM_INFERENCE_STEPS = getPositiveIntFromEnv(
  "REPLICATE_FLUX_IMAGE_NUM_INFERENCE_STEPS",
  28,
);
const REPLICATE_QWEN_IMAGE_EDIT_STEPS =
  getPositiveIntFromEnv("REPLICATE_QWEN_IMAGE_EDIT_STEPS", 2) >= 4 ? 4 : 2;
const REPLICATE_QWEN_IMAGE_EDIT_OUTPUT_FORMAT = getReplicateImageOutputFormatFromEnv(
  "REPLICATE_QWEN_IMAGE_EDIT_OUTPUT_FORMAT",
  "webp",
);
const REPLICATE_QWEN_IMAGE_EDIT_OUTPUT_QUALITY = getPositiveIntFromEnv(
  "REPLICATE_QWEN_IMAGE_EDIT_OUTPUT_QUALITY",
  85,
);
const REPLICATE_VIDEO_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "REPLICATE_VIDEO_TASK_TIMEOUT_MS",
  240000,
);
const REPLICATE_MINIMAX_VIDEO_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "REPLICATE_MINIMAX_VIDEO_TASK_TIMEOUT_MS",
  Math.max(REPLICATE_VIDEO_TASK_TIMEOUT_MS, 480000),
);
const REPLICATE_WAN_VIDEO_RESOLUTION =
  process.env.REPLICATE_WAN_VIDEO_RESOLUTION?.trim() || "480p";
const REPLICATE_WAN_VIDEO_ASPECT_RATIO =
  process.env.REPLICATE_WAN_VIDEO_ASPECT_RATIO?.trim() || "16:9";
const REPLICATE_WAN_VIDEO_NUM_FRAMES = getPositiveIntFromEnv(
  "REPLICATE_WAN_VIDEO_NUM_FRAMES",
  81,
);
const REPLICATE_WAN_VIDEO_FRAMES_PER_SECOND = getPositiveIntFromEnv(
  "REPLICATE_WAN_VIDEO_FRAMES_PER_SECOND",
  16,
);
const REPLICATE_WAN_VIDEO_GO_FAST = getBooleanFromEnv(
  "REPLICATE_WAN_VIDEO_GO_FAST",
  true,
);
const REPLICATE_WAN_VIDEO_INTERPOLATE_OUTPUT = getBooleanFromEnv(
  "REPLICATE_WAN_VIDEO_INTERPOLATE_OUTPUT",
  false,
);
const REPLICATE_WAN_VIDEO_OPTIMIZE_PROMPT = getBooleanFromEnv(
  "REPLICATE_WAN_VIDEO_OPTIMIZE_PROMPT",
  false,
);
const REPLICATE_LTX_VIDEO_EDIT_RESOLUTION =
  getPositiveIntFromEnv("REPLICATE_LTX_VIDEO_EDIT_RESOLUTION", 480) >= 720 ? 720 : 480;
const REPLICATE_LTX_VIDEO_EDIT_NUM_FRAMES = Math.min(
  257,
  Math.max(9, getPositiveIntFromEnv("REPLICATE_LTX_VIDEO_EDIT_NUM_FRAMES", 81)),
);
const REPLICATE_LTX_VIDEO_EDIT_FPS = Math.min(
  60,
  Math.max(1, getPositiveIntFromEnv("REPLICATE_LTX_VIDEO_EDIT_FPS", 16)),
);
const REPLICATE_LTX_VIDEO_EDIT_CONDITIONING_FRAMES = Math.min(
  50,
  Math.max(1, getPositiveIntFromEnv("REPLICATE_LTX_VIDEO_EDIT_CONDITIONING_FRAMES", 9)),
);
const REPLICATE_LTX_VIDEO_EDIT_NUM_INFERENCE_STEPS = Math.min(
  50,
  Math.max(2, getPositiveIntFromEnv("REPLICATE_LTX_VIDEO_EDIT_NUM_INFERENCE_STEPS", 16)),
);
const REPLICATE_LTX_VIDEO_EDIT_FINAL_INFERENCE_STEPS = Math.min(
  50,
  Math.max(1, getPositiveIntFromEnv("REPLICATE_LTX_VIDEO_EDIT_FINAL_INFERENCE_STEPS", 6)),
);
const REPLICATE_LTX_VIDEO_EDIT_DENOISE_STRENGTH = Math.min(
  1,
  Math.max(0, getNumberFromEnv("REPLICATE_LTX_VIDEO_EDIT_DENOISE_STRENGTH", 0.75)),
);
const REPLICATE_LTX_VIDEO_EDIT_GUIDANCE_SCALE = Math.min(
  10,
  Math.max(1, getNumberFromEnv("REPLICATE_LTX_VIDEO_EDIT_GUIDANCE_SCALE", 3)),
);
const REPLICATE_LTX_VIDEO_EDIT_DOWNSCALE_FACTOR = Math.min(
  1,
  Math.max(0.1, getNumberFromEnv("REPLICATE_LTX_VIDEO_EDIT_DOWNSCALE_FACTOR", 0.667)),
);
const REPLICATE_LTX_VIDEO_EDIT_NEGATIVE_PROMPT =
  process.env.REPLICATE_LTX_VIDEO_EDIT_NEGATIVE_PROMPT?.trim() ||
  "worst quality, inconsistent motion, blurry, jittery, distorted, extra subjects, text, logo, watermark";
const REPLICATE_AUDIO_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "REPLICATE_AUDIO_TASK_TIMEOUT_MS",
  180000,
);
const REPLICATE_TEXT_TASK_TIMEOUT_MS = getPositiveIntFromEnv(
  "REPLICATE_TEXT_TASK_TIMEOUT_MS",
  300000,
);
const REPLICATE_CREATE_MAX_RETRIES = 4;
const REPLICATE_CREATE_BASE_DELAY_MS = 3000;
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
  2200,
);
const REPLICATE_DOCUMENT_GENERATION_MAX_NEW_TOKENS = getPositiveIntFromEnv(
  "REPLICATE_DOCUMENT_GENERATION_MAX_NEW_TOKENS",
  800,
);
const REPLICATE_DOCUMENT_SPREADSHEET_MAX_NEW_TOKENS = getPositiveIntFromEnv(
  "REPLICATE_DOCUMENT_SPREADSHEET_MAX_NEW_TOKENS",
  950,
);
const DOCUMENT_EDITING_MAX_TOKENS = getPositiveIntFromEnv(
  "DOCUMENT_EDITING_MAX_TOKENS",
  1000,
);
const DOCUMENT_EDIT_SOURCE_MAX_CHARS = getPositiveIntFromEnv(
  "DOCUMENT_EDIT_SOURCE_MAX_CHARS",
  8000,
);
const REPLICATE_DOCUMENT_EDIT_SOURCE_MAX_CHARS = getPositiveIntFromEnv(
  "REPLICATE_DOCUMENT_EDIT_SOURCE_MAX_CHARS",
  6000,
);
const DETECTION_MAX_TOKENS = getPositiveIntFromEnv(
  "DETECTION_MAX_TOKENS",
  500,
);
const DETECTION_SOURCE_MAX_CHARS = getPositiveIntFromEnv(
  "DETECTION_SOURCE_MAX_CHARS",
  8000,
);
const REPLICATE_DOCUMENT_DETECTION_MAX_NEW_TOKENS = getPositiveIntFromEnv(
  "REPLICATE_DOCUMENT_DETECTION_MAX_NEW_TOKENS",
  220,
);
const REPLICATE_DOCUMENT_DETECTION_MAX_COMPLETION_TOKENS = getPositiveIntFromEnv(
  "REPLICATE_DOCUMENT_DETECTION_MAX_COMPLETION_TOKENS",
  140,
);
const REPLICATE_VISUAL_DETECTION_MAX_COMPLETION_TOKENS = getPositiveIntFromEnv(
  "REPLICATE_VISUAL_DETECTION_MAX_COMPLETION_TOKENS",
  140,
);
const REPLICATE_DOCUMENT_DETECTION_SOURCE_MAX_CHARS = getPositiveIntFromEnv(
  "REPLICATE_DOCUMENT_DETECTION_SOURCE_MAX_CHARS",
  4000,
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
const REPLICATE_MINIMAX_SPEECH_AUDIO_FORMAT =
  process.env.REPLICATE_MINIMAX_SPEECH_AUDIO_FORMAT?.trim().toLowerCase() || "mp3";
const REPLICATE_MINIMAX_SPEECH_SAMPLE_RATE = (() => {
  const allowed = new Set([8000, 16000, 22050, 24000, 32000, 44100]);
  const value = getPositiveIntFromEnv("REPLICATE_MINIMAX_SPEECH_SAMPLE_RATE", 24000);
  return allowed.has(value) ? value : 24000;
})();
const REPLICATE_MINIMAX_SPEECH_BITRATE = (() => {
  const allowed = new Set([32000, 64000, 128000, 256000]);
  const value = getPositiveIntFromEnv("REPLICATE_MINIMAX_SPEECH_BITRATE", 64000);
  return allowed.has(value) ? value : 64000;
})();
const REPLICATE_MINIMAX_SPEECH_CHANNEL =
  process.env.REPLICATE_MINIMAX_SPEECH_CHANNEL?.trim().toLowerCase() === "stereo"
    ? "stereo"
    : "mono";
const REPLICATE_MINIMAX_SPEECH_SPEED = Math.min(
  2,
  Math.max(0.5, getNumberFromEnv("REPLICATE_MINIMAX_SPEECH_SPEED", 1)),
);
const REPLICATE_MINIMAX_SPEECH_VOLUME = Math.min(
  10,
  Math.max(0, getNumberFromEnv("REPLICATE_MINIMAX_SPEECH_VOLUME", 1)),
);
const REPLICATE_MINIMAX_SPEECH_PITCH = Math.min(
  12,
  Math.max(-12, Math.round(getNumberFromEnv("REPLICATE_MINIMAX_SPEECH_PITCH", 0))),
);
const REPLICATE_MINIMAX_SPEECH_ENGLISH_NORMALIZATION = getBooleanFromEnv(
  "REPLICATE_MINIMAX_SPEECH_ENGLISH_NORMALIZATION",
  false,
);
const REPLICATE_MINIMAX_SPEECH_LANGUAGE_BOOST =
  process.env.REPLICATE_MINIMAX_SPEECH_LANGUAGE_BOOST?.trim() || "";

const cachedReplicateLatestVersionIds = new Map<string, string>();
const cachedReplicateVersionEndpointModels = new Set<string>();

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

function getNumberFromEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function getReplicateImageOutputFormatFromEnv(
  name: string,
  fallback: ReplicateImageOutputFormat,
): ReplicateImageOutputFormat {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "jpg" || value === "png" || value === "webp") {
    return value;
  }

  return fallback;
}

function getBooleanFromEnv(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  return fallback;
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

  const is429 = getErrorStatusCode(error) === 429;
  const effectiveBaseDelay = is429 ? baseDelayMs * 3 : baseDelayMs;
  const jitter = Math.floor(Math.random() * 250);
  return effectiveBaseDelay * Math.pow(2, attempt) + jitter;
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
  if (modelId === "lucataco/qwen1.5-1.8b-chat" || modelId === "lucataco/qwen1.5-1.8b-chat-detect") {
    return "lucataco/qwen1.5-1.8b";
  }

  if (modelId === "openai/gpt-5-nano-detect") {
    return "openai/gpt-5-nano";
  }

  if (modelId === "openai/gpt-5-nano-edit") {
    return "openai/gpt-5-nano";
  }

  return modelId;
}

function normalizeReplicateAudioModelId(modelId: string) {
  return modelId === "codeplugtech/minimax-speech-02-turbo"
    ? "minimax/speech-02-turbo"
    : modelId;
}

function isReplicateMiniMaxSpeechModelId(modelId: string) {
  const normalizedModelId = normalizeReplicateAudioModelId(modelId);
  return (
    normalizedModelId === "minimax/speech-02-turbo" ||
    normalizedModelId === "minimax/speech-2.6-turbo" ||
    normalizedModelId === "minimax/speech-2.8-turbo"
  );
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
    modelId === "openai/gpt-5-nano-image-detect" ||
    modelId === "openai/gpt-5-nano-video-detect"
  ) {
    return "openai/gpt-5-nano";
  }

  if (
    modelId === "lucataco/qwen-vl-chat-detect" ||
    modelId === "lucataco/qwen-vl-chat-video-detect"
  ) {
    return "lucataco/qwen-vl-chat";
  }

  return modelId;
}

function resolveReplicateAudioDetectionModelId(modelId: string) {
  if (modelId === "nvidia/canary-qwen-2.5b-detect") {
    return "nvidia/canary-qwen-2.5b";
  }

  if (modelId === "lucataco/qwen2.5-omni-7b-detect") {
    return "lucataco/qwen2.5-omni-7b";
  }

  if (modelId === "zsxkib/kimi-audio-7b-instruct-detect") {
    return "zsxkib/kimi-audio-7b-instruct";
  }

  return modelId;
}

function buildReplicateImagePrompt(userPrompt: string) {
  const cleanedPrompt = userPrompt.replace(/\s+/g, " ").trim();
  return joinPromptLines([
    "Generate exactly one high-quality image that faithfully executes the user's request.",
    "Make the requested subject, scene, style, lighting, and composition cues visually explicit and dominant.",
    "Preserve clean anatomy, realistic perspective, coherent materials, consistent lighting, and strong local detail.",
    "Do not add extra subjects, text, letters, logos, subtitles, frames, or watermarks unless the user explicitly requests them.",
    `User request: ${cleanedPrompt}`,
    "If the request is in Chinese, understand and execute it correctly.",
  ]);
}

function buildReplicateVideoPrompt(userPrompt: string) {
  return joinPromptLines([
    "Generate exactly one short video that faithfully executes the user's request.",
    "Keep the requested main subject, scene logic, style, and time continuity stable across the whole clip.",
    "Use coherent motion, natural physics, stable identity, and visually consistent lighting and materials.",
    "Do not add unrelated scene changes, subject swaps, text, logos, subtitles, or watermarks unless the user explicitly requests them.",
    `User request: ${userPrompt.trim()}`,
    "If the request is in Chinese, understand and execute it correctly.",
  ]);
}

function buildReplicateDocumentSystemPrompt(
  targetFormat: DocumentFileFormat,
  locale: PromptLocale = "en",
) {
  const requireSpreadsheet = targetFormat === "xlsx";

  return joinPromptLines([
    ...buildFileGenerationSchemaPromptLines(locale),
    ...getDocumentFormatGenerationGuidance(targetFormat, locale),
    requireSpreadsheet
      ? "Include at least one meaningful spreadsheet that matches the user's request."
      : "Return an empty spreadsheets array unless tabular output is explicitly requested.",
    "Return exactly one raw JSON object.",
    "Do not wrap the result inside response, data, output, document, message, or content fields.",
    "If the user provides exact wording, copy that wording verbatim into the correct fields.",
    "Do not summarize, compress, paraphrase, or omit any explicitly requested heading, sentence, bullet, or table row.",
    "Do not output markdown fences or explanations.",
  ]);
}

function buildReplicateDocumentPrompt(
  userPrompt: string,
  targetFormat: DocumentFileFormat,
  locale: PromptLocale = "en",
) {
  return buildFileGenerationPrompt(userPrompt, targetFormat, locale);
}

function getReplicateDocumentGenerationMaxNewTokens(targetFormat: DocumentFileFormat) {
  return targetFormat === "xlsx"
    ? REPLICATE_DOCUMENT_SPREADSHEET_MAX_NEW_TOKENS
    : REPLICATE_DOCUMENT_GENERATION_MAX_NEW_TOKENS;
}

function buildReplicateDocumentGenerationInputs(
  modelId: string,
  documentPrompt: string,
  maxNewTokens?: number,
  systemPrompt = "You are a structured document generator. Return raw JSON only.",
) {
  if (modelId.startsWith("openai/")) {
    const primaryInput: Record<string, unknown> = {
      prompt: documentPrompt,
      system_prompt: systemPrompt,
      ...(maxNewTokens ? { max_completion_tokens: maxNewTokens } : {}),
    };

    return {
      primaryInput,
      fallbackInput: {
        prompt: documentPrompt,
        system_prompt: systemPrompt,
      },
    };
  }

  return {
    primaryInput: {
      prompt: documentPrompt,
      ...(maxNewTokens ? { max_new_tokens: maxNewTokens } : {}),
      temperature: 0.3,
      top_p: 0.95,
    },
    fallbackInput: {
      prompt: documentPrompt,
    },
  };
}

function buildReplicateCompactDocumentEditingPrompt(input: {
  fileName: string;
  instruction: string;
  sourceText: string;
  requireSpreadsheet: boolean;
}) {
  const explicitTargetText = extractExplicitEditingTargetText(input.instruction);

  return joinPromptLines([
    "Return exactly one raw JSON object. No markdown. No explanation.",
    "The top-level object itself must contain title, summary, sections, and spreadsheets.",
    "Do not wrap the result inside response, data, output, document, message, or content fields.",
    "Edit the uploaded document instead of rewriting unrelated content.",
    "Preserve core facts, structure order, and unchanged passages.",
    "Reuse unchanged paragraphs, bullets, table cells, and spreadsheet cells as close to verbatim as possible.",
    "If the request is a local replacement, keep other sentences as close to the source as possible.",
    explicitTargetText ? `The target wording must appear verbatim in the result: ${explicitTargetText}` : "",
    explicitTargetText ? "Do not keep the superseded wording in the corresponding location." : "",
    input.requireSpreadsheet
      ? "spreadsheets must contain at least one useful sheet."
      : "spreadsheets must be an empty array unless tabular output is clearly required.",
    "JSON shape:",
    input.requireSpreadsheet
      ? '{"title":"string","summary":"string","sections":[{"heading":"string","paragraphs":["string"],"bullets":["string"],"table":{"title":"string","columns":["string"],"rows":[["string"]]}}],"spreadsheets":[{"name":"string","columns":["string"],"rows":[["string"]]}]}'
      : '{"title":"string","summary":"string","sections":[{"heading":"string","paragraphs":["string"],"bullets":["string"],"table":{"title":"string","columns":["string"],"rows":[["string"]]}}],"spreadsheets":[]}',
    `Source file: ${input.fileName}`,
    "Edit instruction:",
    input.instruction,
    "Source content:",
    truncateText(input.sourceText, REPLICATE_DOCUMENT_EDIT_SOURCE_MAX_CHARS),
  ]);
}

function getReplicateDocumentEditingMaxTokens(requireSpreadsheet: boolean) {
  return requireSpreadsheet
    ? REPLICATE_DOCUMENT_SPREADSHEET_MAX_NEW_TOKENS
    : REPLICATE_DOCUMENT_GENERATION_MAX_NEW_TOKENS;
}

function buildReplicateDocumentEditingInputs(
  modelId: string,
  documentPrompt: string,
  requireSpreadsheet: boolean,
) {
  const maxTokens = getReplicateDocumentEditingMaxTokens(requireSpreadsheet);

  if (modelId.startsWith("openai/")) {
    const primaryInput: Record<string, unknown> = {
      prompt: documentPrompt,
      system_prompt: "You are a structured document editor. Return raw JSON only.",
      max_completion_tokens: maxTokens,
    };

    if (modelId === "openai/gpt-5-nano") {
      primaryInput.reasoning_effort = "minimal";
      primaryInput.verbosity = "low";
    }

    return {
      primaryInput,
      fallbackInput: {
        prompt: documentPrompt,
        system_prompt: "You are a structured document editor. Return raw JSON only.",
      },
    };
  }

  return {
    primaryInput: {
      prompt: documentPrompt,
      max_new_tokens: maxTokens,
      temperature: 0.2,
      top_p: 0.95,
    },
    fallbackInput: {
      prompt: documentPrompt,
    },
  };
}

function buildReplicateCompactDocumentDetectionPrompt(input: {
  fileName: string;
  extractedText: string;
  locale: "zh" | "en";
}) {
  const excerpt = buildDocumentDetectionExcerpt(
    input.extractedText,
    REPLICATE_DOCUMENT_DETECTION_SOURCE_MAX_CHARS,
  );
  if (input.locale === "zh") {
    return joinPromptLines([
      "你是保守、低误报的文档 AI 检测助手，只能基于可观察文本证据判断。",
      "证据不足时优先返回 uncertain，并降低 probability 与 confidence。",
      "只返回严格 JSON：{\"probability\":0-100,\"confidence\":0-100,\"verdict\":\"likely_ai|uncertain|likely_human\",\"reasons\":[\"具体依据1\",\"具体依据2\",\"具体依据3\"]}",
      `文件名：${input.fileName}`,
      "重点观察：重复度、结构均匀性、信息密度、措辞模板化、逻辑深度、个性化痕迹、错误类型、观点新颖性。",
      "文档内容：",
      excerpt,
    ]);
  }

  return joinPromptLines([
    "You are a conservative, low-false-positive AI document detector and must rely only on observable textual evidence.",
    "If evidence is weak, prefer uncertain and lower both probability and confidence.",
    'Return strict JSON only: {"probability":0-100,"confidence":0-100,"verdict":"likely_ai|uncertain|likely_human","reasons":["specific evidence 1","specific evidence 2","specific evidence 3"]}',
    `File: ${input.fileName}`,
    "Focus on repetition, structural uniformity, information density, templated phrasing, reasoning depth, personalization, error types, and originality.",
    "Document content:",
    excerpt,
  ]);
}

function buildReplicateDocumentDetectionSystemPrompt(locale: "zh" | "en") {
  if (locale === "zh") {
    return joinPromptLines([
      "你是保守、低误报的文档 AI 检测助手，只能基于可观察文本证据判断。",
      "证据不足时优先返回 uncertain，并降低 probability 与 confidence。",
      "只返回严格 JSON：{\"probability\":0-100,\"confidence\":0-100,\"verdict\":\"likely_ai|uncertain|likely_human\",\"reasons\":[\"具体依据1\",\"具体依据2\",\"具体依据3\"]}",
      "probability 和 confidence 必须输出整数百分比。",
      "reasons 保持简洁、具体、可观察，不要输出模板占位语。",
    ]);
  }

  return joinPromptLines([
    "You are a conservative, low-false-positive AI document detector and must rely only on observable textual evidence.",
    "If evidence is weak, prefer uncertain and lower both probability and confidence.",
    'Return strict JSON only: {"probability":0-100,"confidence":0-100,"verdict":"likely_ai|uncertain|likely_human","reasons":["specific evidence 1","specific evidence 2","specific evidence 3"]}',
    "Use integer percentages for probability and confidence.",
    "Keep reasons concise, concrete, and evidence-based. Never output placeholder wording.",
  ]);
}

function buildReplicateDocumentDetectionUserPrompt(input: {
  fileName: string;
  extractedText: string;
  locale: "zh" | "en";
}) {
  const excerpt = buildDocumentDetectionExcerpt(
    input.extractedText,
    REPLICATE_DOCUMENT_DETECTION_SOURCE_MAX_CHARS,
  );

  if (input.locale === "zh") {
    return joinPromptLines([
      `文件名：${input.fileName}`,
      "重点观察：重复度、结构均匀性、信息密度、措辞模板化、逻辑深度、个性化痕迹、错误类型、观点新颖性。",
      "文档内容：",
      excerpt,
    ]);
  }

  return joinPromptLines([
    `File: ${input.fileName}`,
    "Focus on repetition, structural uniformity, information density, templated phrasing, reasoning depth, personalization, error types, and originality.",
    "Document content:",
    excerpt,
  ]);
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

  if (typeof record.json_str === "string") {
    return record.json_str;
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

  let preferVersionEndpoint = cachedReplicateVersionEndpointModels.has(normalizedModelId);
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
          cachedReplicateVersionEndpointModels.delete(normalizedModelId);
          return readReplicateResponseJson(modelEndpointResponse);
        }

        preferVersionEndpoint = true;
        cachedReplicateVersionEndpointModels.add(normalizedModelId);
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
    const primaryInput: Record<string, unknown> = {
      prompt: promptForModel,
      width: REPLICATE_SANA_IMAGE_WIDTH,
      height: REPLICATE_SANA_IMAGE_HEIGHT,
      output_format: REPLICATE_SANA_IMAGE_OUTPUT_FORMAT,
    };
    if (REPLICATE_SANA_IMAGE_OUTPUT_FORMAT !== "png") {
      primaryInput.output_quality = REPLICATE_SANA_IMAGE_OUTPUT_QUALITY;
    }

    return {
      primaryInput,
      fallbackInput: {
        prompt: promptForModel,
        width: REPLICATE_SANA_IMAGE_WIDTH,
        height: REPLICATE_SANA_IMAGE_HEIGHT,
      },
    };
  }

  if (modelId === "prunaai/flux.1-dev-lora") {
    const primaryInput: Record<string, unknown> = {
      prompt: promptForModel,
      aspect_ratio: REPLICATE_FLUX_IMAGE_ASPECT_RATIO,
      output_format: REPLICATE_FLUX_IMAGE_OUTPUT_FORMAT,
      megapixels: REPLICATE_FLUX_IMAGE_MEGAPIXELS,
      num_outputs: DEFAULT_IMAGE_OUTPUT_COUNT,
      num_inference_steps: REPLICATE_FLUX_IMAGE_NUM_INFERENCE_STEPS,
    };
    if (REPLICATE_FLUX_IMAGE_OUTPUT_FORMAT !== "png") {
      primaryInput.output_quality = REPLICATE_FLUX_IMAGE_OUTPUT_QUALITY;
    }

    return {
      primaryInput,
      fallbackInput: {
        prompt: promptForModel,
        aspect_ratio: REPLICATE_FLUX_IMAGE_ASPECT_RATIO,
        num_outputs: DEFAULT_IMAGE_OUTPUT_COUNT,
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

async function generateImageWithReplicate(
  requestId: string,
  modelId: string,
  prompt: string,
  locale: PromptLocale = getRuntimeLocale(),
) {
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
    throw new Error(
      locale === "zh"
        ? `Replicate 图片生成失败${detail ? `: ${detail}` : ""}`
        : `Replicate image generation failed${detail ? `: ${detail}` : ""}`,
    );
  }
  if (!payload.id) {
    throw new Error(
      locale === "zh"
        ? "Replicate 返回结果缺少 prediction id。"
        : "Replicate response is missing prediction id.",
    );
  }

  return waitForReplicatePredictionResult(
    payload.id,
    REPLICATE_IMAGE_TASK_TIMEOUT_MS,
    locale === "zh"
      ? "Replicate 图片生成超时，请稍后重试。"
      : "Replicate image generation timed out. Please try again.",
  );
}

function buildReplicateAudioPrompt(modelId: string, prompt: string) {
  const cleanedPrompt = prompt.trim();

  if (isReplicateMiniMaxSpeechModelId(modelId)) {
    return cleanedPrompt;
  }

  return joinPromptLines([
    "Generate exactly one high-quality audio output that faithfully follows the user's request.",
    "Prioritize coherent pacing, stable mood, clean timbre, and strong perceptual quality.",
    "Do not add unrelated voices, spoken instructions, text readouts, or artifacts unless the user explicitly requests them.",
    `User request: ${cleanedPrompt}`,
    "If the request is in Chinese, understand and execute it correctly.",
  ]);
}

function inferMiniMaxSpeechLanguageBoost(prompt: string) {
  if (REPLICATE_MINIMAX_SPEECH_LANGUAGE_BOOST) {
    return REPLICATE_MINIMAX_SPEECH_LANGUAGE_BOOST;
  }

  const hasChinese = /[\u3400-\u9FFF]/.test(prompt);
  const hasLatin = /[A-Za-z]/.test(prompt);
  if (hasChinese && !hasLatin) {
    return "Chinese";
  }
  if (hasLatin && !hasChinese) {
    return "English";
  }

  return "Automatic";
}

function resolveMiniMaxSpeechVoiceId(prompt: string) {
  const hasChinese = /[\u3400-\u9FFF]/.test(prompt);
  const zhVoice = process.env.REPLICATE_MINIMAX_SPEECH_VOICE_ID_ZH?.trim();
  const enVoice = process.env.REPLICATE_MINIMAX_SPEECH_VOICE_ID_EN?.trim();
  const sharedVoice = process.env.REPLICATE_MINIMAX_SPEECH_VOICE_ID?.trim();

  if (hasChinese && zhVoice) {
    return zhVoice;
  }
  if (!hasChinese && enVoice) {
    return enVoice;
  }

  return sharedVoice || "Wise_Woman";
}

function buildReplicateAudioInputs(modelId: string, promptForModel: string) {
  if (isReplicateMiniMaxSpeechModelId(modelId)) {
    return {
      primaryInput: {
        text: promptForModel,
        voice_id: resolveMiniMaxSpeechVoiceId(promptForModel),
        speed: REPLICATE_MINIMAX_SPEECH_SPEED,
        volume: REPLICATE_MINIMAX_SPEECH_VOLUME,
        pitch: REPLICATE_MINIMAX_SPEECH_PITCH,
        audio_format: REPLICATE_MINIMAX_SPEECH_AUDIO_FORMAT,
        sample_rate: REPLICATE_MINIMAX_SPEECH_SAMPLE_RATE,
        bitrate: REPLICATE_MINIMAX_SPEECH_BITRATE,
        channel: REPLICATE_MINIMAX_SPEECH_CHANNEL,
        language_boost: inferMiniMaxSpeechLanguageBoost(promptForModel),
        english_normalization: REPLICATE_MINIMAX_SPEECH_ENGLISH_NORMALIZATION,
      },
      fallbackInput: {
        text: promptForModel,
        voice_id: resolveMiniMaxSpeechVoiceId(promptForModel),
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

  if (modelId === "inworld/tts-1.5-mini") {
    return {
      primaryInput: {
        text: promptForModel,
      },
      fallbackInput: {
        text: promptForModel,
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

function buildReplicateAudioTimeoutMessage(
  modelId: string,
  predictionId: string,
  locale: PromptLocale = getRuntimeLocale(),
) {
  return locale === "zh"
    ? `Replicate 音频生成超时，请稍后重试。model_id: ${modelId} prediction_id: ${predictionId}`
    : `Replicate audio generation timed out. Please try again. model_id: ${modelId} prediction_id: ${predictionId}`;
}

async function generateAudioWithReplicate(
  requestId: string,
  modelId: string,
  prompt: string,
  locale: PromptLocale = getRuntimeLocale(),
) {
  const promptForModel = buildReplicateAudioPrompt(modelId, prompt);
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
    throw new Error(
      locale === "zh"
        ? `Replicate 音频生成失败${detail ? `: ${detail}` : ""}`
        : `Replicate audio generation failed${detail ? `: ${detail}` : ""}`,
    );
  }
  if (!payload.id) {
    throw new Error(
      locale === "zh"
        ? "Replicate 返回结果缺少 prediction id。"
        : "Replicate response is missing prediction id.",
    );
  }

  return waitForReplicatePredictionResult(
    payload.id,
    REPLICATE_AUDIO_TASK_TIMEOUT_MS,
    buildReplicateAudioTimeoutMessage(modelId, payload.id, locale),
  );
}

const DEFAULT_VIDEO_DURATION_SECONDS = 5;
const T2V_TURBO_DEFAULT_FPS = 8;
const T2V_TURBO_DEFAULT_FRAME_COUNT =
  DEFAULT_VIDEO_DURATION_SECONDS * T2V_TURBO_DEFAULT_FPS;
const DASHSCOPE_VIDEO_EDIT_FRAME_COUNT = 3;
const DASHSCOPE_VIDEO_EDIT_ASPECT_RATIO_TOLERANCE = 0.03;

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

  if (modelId === "wan-video/wan-2.2-t2v-fast") {
    return {
      primaryInput: {
        prompt: promptForModel,
        num_frames: Math.max(REPLICATE_WAN_VIDEO_NUM_FRAMES, 81),
        resolution: REPLICATE_WAN_VIDEO_RESOLUTION,
        aspect_ratio: REPLICATE_WAN_VIDEO_ASPECT_RATIO,
        frames_per_second: REPLICATE_WAN_VIDEO_FRAMES_PER_SECOND,
        go_fast: REPLICATE_WAN_VIDEO_GO_FAST,
        interpolate_output: REPLICATE_WAN_VIDEO_INTERPOLATE_OUTPUT,
        optimize_prompt: REPLICATE_WAN_VIDEO_OPTIMIZE_PROMPT,
      },
      fallbackInput: {
        prompt: promptForModel,
        resolution: REPLICATE_WAN_VIDEO_RESOLUTION,
        aspect_ratio: REPLICATE_WAN_VIDEO_ASPECT_RATIO,
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

function buildReplicateVideoTimeoutMessage(
  modelId: string,
  predictionId: string,
  locale: PromptLocale = getRuntimeLocale(),
) {
  if (modelId === "minimax/video-01") {
    return locale === "zh"
      ? [
          `Replicate 视频生成超时：${modelId} 当前排队或生成较慢。`,
          `prediction_id: ${predictionId}`,
          "可稍后重试，或在 .env.local 中增大 REPLICATE_MINIMAX_VIDEO_TASK_TIMEOUT_MS。",
        ].join("\n")
      : [
          `Replicate video generation timed out: ${modelId} is currently queued or generating slowly.`,
          `prediction_id: ${predictionId}`,
          "Retry later or increase REPLICATE_MINIMAX_VIDEO_TASK_TIMEOUT_MS in .env.local.",
        ].join("\n");
  }

  return locale === "zh"
    ? `Replicate 视频生成超时，请稍后重试。prediction_id: ${predictionId}`
    : `Replicate video generation timed out. Please try again. prediction_id: ${predictionId}`;
}

function buildReplicateVideoEditingTimeoutMessage(
  modelId: string,
  predictionId: string,
  locale: PromptLocale = getRuntimeLocale(),
) {
  return locale === "zh"
    ? `Replicate 视频编辑超时，请稍后重试。model_id: ${modelId} prediction_id: ${predictionId}`
    : `Replicate video editing timed out. Please try again later. model_id: ${modelId} prediction_id: ${predictionId}`;
}

async function generateVideoWithReplicate(
  requestId: string,
  modelId: string,
  prompt: string,
  locale: PromptLocale = getRuntimeLocale(),
) {
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
    throw new Error(
      locale === "zh"
        ? `Replicate 视频生成失败${detail ? `: ${detail}` : ""}`
        : `Replicate video generation failed${detail ? `: ${detail}` : ""}`,
    );
  }
  if (!payload.id) {
    throw new Error(
      locale === "zh"
        ? "Replicate 返回结果缺少 prediction id。"
        : "Replicate response is missing prediction id.",
    );
  }

  return waitForReplicatePredictionResult(
    payload.id,
    timeoutMs,
    buildReplicateVideoTimeoutMessage(modelId, payload.id, locale),
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

function normalizeExtractedJsonCandidate(candidate: string) {
  return candidate
    .replace(/"Sections":/g, '"sections":')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findBalancedJsonObjectEnd(text: string, startIndex: number) {
  if (text[startIndex] !== "{") {
    return -1;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\" && inString) {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
      if (depth < 0) {
        return -1;
      }
    }
  }

  return -1;
}

function extractJsonObjectText(rawText: string) {
  const cleaned = stripMarkdownCodeFence(rawText);
  const validCandidates: Array<{ start: number; end: number; text: string }> = [];

  for (let start = 0; start < cleaned.length; start += 1) {
    if (cleaned[start] !== "{") {
      continue;
    }

    const end = findBalancedJsonObjectEnd(cleaned, start);
    if (end < 0) {
      continue;
    }

    const candidate = normalizeExtractedJsonCandidate(cleaned.slice(start, end + 1));
    try {
      JSON.parse(candidate);
      validCandidates.push({ start, end, text: candidate });
    } catch {
      continue;
    }
  }

  if (validCandidates.length > 0) {
    const topLevelCandidates = validCandidates.filter((candidate, index) => {
      return !validCandidates.some((otherCandidate, otherIndex) => {
        if (index === otherIndex) {
          return false;
        }

        const fullyContains =
          otherCandidate.start <= candidate.start &&
          otherCandidate.end >= candidate.end;
        const isDifferentRange =
          otherCandidate.start !== candidate.start || otherCandidate.end !== candidate.end;

        return fullyContains && isDifferentRange;
      });
    });

    const preferredCandidate =
      topLevelCandidates[topLevelCandidates.length - 1] ?? validCandidates[validCandidates.length - 1];
    if (preferredCandidate) {
      return preferredCandidate.text;
    }
  }

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  let json = "";

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    json = cleaned.slice(firstBrace, lastBrace + 1);
  } else if (firstBrace >= 0) {
    json = cleaned.slice(firstBrace);
    const openBrackets = (json.match(/\[/g) || []).length;
    const closeBrackets = (json.match(/\]/g) || []).length;
    if (openBrackets > closeBrackets) {
      json += "]".repeat(openBrackets - closeBrackets);
    }
    json += "}";
  }

  if (json) {
    return normalizeExtractedJsonCandidate(json);
  }

  return cleaned;
}

function looksLikeStructuredDocumentJsonResponse(rawText: string) {
  const cleaned = stripMarkdownCodeFence(rawText).trim();
  if (!cleaned) {
    return false;
  }

  if (!cleaned.includes("{") || !cleaned.includes("}")) {
    return false;
  }

  return /"(title|summary|sections|spreadsheets)"\s*:/.test(cleaned);
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

function pluralizeEnglish(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function buildDocumentGenerationSummary(count: number, locale: PromptLocale) {
  return locale === "zh"
    ? `已生成 ${count} 个文档`
    : `Generated ${count} ${pluralizeEnglish(count, "document")}`;
}

function buildDocumentEditSummary(
  fileCount: number,
  locale: PromptLocale,
  replacementCount?: number,
) {
  if (locale === "zh") {
    return typeof replacementCount === "number"
      ? `已精确替换 ${replacementCount} 处文本并导出 ${fileCount} 个文件`
      : `已完成文档编辑并导出 ${fileCount} 个文件`;
  }

  return typeof replacementCount === "number"
    ? `Precisely replaced ${replacementCount} text ${pluralizeEnglish(replacementCount, "occurrence")} and exported ${fileCount} ${pluralizeEnglish(fileCount, "file")}`
    : `Edited document and exported ${fileCount} ${pluralizeEnglish(fileCount, "file")}`;
}

function buildAudioEditSummary(count: number, locale: PromptLocale) {
  return locale === "zh"
    ? `已完成音频转写与重配，共输出 ${count} 条音频`
    : `Completed audio transcription and remix, exported ${count} ${pluralizeEnglish(count, "audio file")}`;
}

function buildImageEditSummary(count: number, locale: PromptLocale) {
  return locale === "zh"
    ? `已完成 ${count} 张图片编辑`
    : `Edited ${count} ${pluralizeEnglish(count, "image")}`;
}

function buildAudioGenerationSummary(count: number, locale: PromptLocale) {
  return locale === "zh"
    ? `已生成 ${count} 条音频`
    : `Generated ${count} ${pluralizeEnglish(count, "audio file")}`;
}

function buildImageGenerationSummary(count: number, locale: PromptLocale) {
  return locale === "zh"
    ? `已生成 ${count} 张图片`
    : `Generated ${count} ${pluralizeEnglish(count, "image")}`;
}

function buildVideoEditSummary(
  count: number,
  locale: PromptLocale,
  regeneratedFromKeyframes: boolean,
) {
  if (locale === "zh") {
    return regeneratedFromKeyframes
      ? `已基于抽帧关键帧 + 提示词重生成 ${count} 条视频`
      : `已完成 ${count} 条视频编辑`;
  }

  return regeneratedFromKeyframes
    ? `Regenerated ${count} ${pluralizeEnglish(count, "video")} from extracted keyframes + prompt`
    : `Edited ${count} ${pluralizeEnglish(count, "video")}`;
}

function buildVideoGenerationSummary(count: number, locale: PromptLocale) {
  return locale === "zh"
    ? `已生成 ${count} 条视频`
    : `Generated ${count} ${pluralizeEnglish(count, "video")}`;
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
    const extracted = extractJsonObjectText(rawText);
    parsed = JSON.parse(extracted) as Record<string, unknown>;
  } catch (error) {
    console.warn("[Generate][detect] parse detection JSON failed:", error);
    console.warn("[Generate][detect] raw text:", rawText);
    console.warn("[Generate][detect] extracted JSON:", extractJsonObjectText(rawText));
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
    return joinPromptLines([
      `你是专业的${target === "document" ? "文档" : target === "image" ? "图片" : target === "audio" ? "音频" : "视频"} AI 检测专家。`,
      "你的职责是基于可观察证据做保守、可解释、低误报的判断，不要为了给出高分而夸大可疑性。",
      "只根据当前输入中真正可观察到的内容下结论，不要编造无法看到、听到或验证的细节。",
      "当证据不足、特征不明显或存在多种合理解释时，优先返回 uncertain，并降低 probability 与 confidence。",
      "",
      "probability 评分标准：",
      "90-100：几乎确定为 AI 生成，且存在多个强特征",
      "70-89：较大概率为 AI 生成，存在典型特征",
      "50-69：证据不足，无法稳定判断",
      "30-49：更像人工创作，但仍有少量可疑点",
      "0-29：几乎确定为人工创作",
      "",
      "confidence 评分标准：",
      "80-100：证据充分且一致",
      "60-79：有一定证据，但仍存在不确定性",
      "0-59：证据有限，判断主要依赖经验",
      "",
      "必须返回严格 JSON（不要 Markdown 代码块，不要附加解释）：",
      '{"probability":0-100,"confidence":0-100,"verdict":"likely_ai|uncertain|likely_human","reasons":["具体可观察依据1","具体可观察依据2","具体可观察依据3"]}',
      target === "video" ? '如果收到多张关键帧，请额外返回 "frame_probabilities": [0-100,0-100,...]' : "",
      "reasons 必须具体、可观察、可解释，避免泛泛而谈；不要只写“像 AI”“很自然”这类空话。",
    ].filter(Boolean));
  }

  return joinPromptLines([
    `You are a professional AI detection expert for ${target}.`,
    "Your job is to make conservative, evidence-based, low-false-positive judgments.",
    "Only rely on observable evidence in the current input. Do not fabricate details that cannot be directly seen, heard, or verified.",
    "When evidence is weak, ambiguous, or explainable by normal human production, prefer uncertain and lower both probability and confidence.",
    "",
    "Probability scoring:",
    "90-100: Almost certainly AI-generated with multiple strong indicators",
    "70-89: Likely AI-generated with typical indicators",
    "50-69: Insufficient evidence for a stable conclusion",
    "30-49: More likely human-made, with a few suspicious points",
    "0-29: Almost certainly human-made",
    "",
    "Confidence scoring:",
    "80-100: Strong, consistent evidence",
    "60-79: Some evidence, but still uncertain",
    "0-59: Limited evidence; judgment is largely heuristic",
    "",
    "Return strict JSON only (no markdown blocks, no extra explanation):",
    '{"probability":0-100,"confidence":0-100,"verdict":"likely_ai|uncertain|likely_human","reasons":["specific observable evidence 1","specific observable evidence 2","specific observable evidence 3"]}',
    target === "video" ? 'If multiple keyframes are provided, also return "frame_probabilities": [0-100, ...]' : "",
    "Reasons must be concrete and observable, not generic. If evidence is unclear, lower probability and confidence honestly.",
  ].filter(Boolean));
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

  const explicitColumns = uniqueTexts(
    [
      ...extractTextFragments(record.columns),
      ...extractTextFragments(record.headers),
      ...extractTextFragments(record.header),
      ...extractTextFragments(record.fields),
    ],
    options.maxColumns,
    40,
  );
  const columns =
    explicitColumns.length > 0
      ? explicitColumns
      : uniqueTexts(extractColumnsFromRows(rowsSource, options.maxColumns), options.maxColumns, 40);

  const rows = buildTableRows(rowsSource, columns, options.maxRows, 200);
  if (columns.length === 0 || rows.length === 0) {
    return null;
  }

  const title =
    firstNonEmptyText(
      record,
      [
        "title",
        "name",
        "label",
        "sheetName",
        "sheet_name",
        "sheetTitle",
        "sheet_title",
        "worksheetName",
        "worksheet_name",
        "worksheetTitle",
        "worksheet_title",
        "tabName",
        "tab_name",
        "tabTitle",
        "tab_title",
        "tableName",
        "table_name",
        "tableTitle",
        "table_title",
        "sheet",
        "worksheet",
        "tab",
      ],
      80,
    ) || options.titleFallback;
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
  const fallbackHeading = /[㐀-鿿]/.test(summary) ? "内容概览" : "Content Overview";

  return [
    {
      heading: fallbackHeading,
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

﻿function trimPromptSpreadsheetInstructionValue(value: string) {
  return value.trim().replace(/[.]+$/, "").trim();
}

function resolveSpreadsheetInstructionIndex(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["first", "1", "1st", "one"].includes(normalized)) {
    return 0;
  }
  if (["second", "2", "2nd", "two"].includes(normalized)) {
    return 1;
  }
  if (["third", "3", "3rd", "three"].includes(normalized)) {
    return 2;
  }
  return null;
}

function parsePromptSpreadsheetColumns(value: string) {
  return uniqueTexts(
    trimPromptSpreadsheetInstructionValue(value)
      .split(/\s*,\s*/)
      .map((column) => trimPromptSpreadsheetInstructionValue(column))
      .filter(Boolean),
    8,
    40,
  );
}

function parsePromptSpreadsheetRows(value: string, columnCount: number) {
  const normalized = value
    .replace(/\|\s*Pass\s*[.;]\s*(?=[^|]+\|)/g, "| Pass\n")
    .replace(/[;]/g, "\n");

  const rows: string[][] = [];
  for (const rawSegment of normalized.split(/\n/)) {
    const segment = trimPromptSpreadsheetInstructionValue(rawSegment);
    if (!segment || !segment.includes("|")) {
      continue;
    }

    const parts = segment
      .split("|")
      .map((part) => truncateText(trimPromptSpreadsheetInstructionValue(part), 200));
    if (parts.length < columnCount) {
      continue;
    }

    const row = parts.slice(0, columnCount - 1);
    row.push(parts.slice(columnCount - 1).join(" | "));
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }

  return rows.slice(0, 50);
}

type PromptSpreadsheetDraft = {
  name: string;
  columns: string[];
  rows: string[][];
};

function getPromptSpreadsheetDraft(drafts: PromptSpreadsheetDraft[], index: number) {
  while (drafts.length <= index) {
    drafts.push({ name: "", columns: [], rows: [] });
  }
  return drafts[index]!;
}

function extractPromptDefinedSpreadsheets(prompt: string): GeneratedDocument["spreadsheets"] {
  const drafts: PromptSpreadsheetDraft[] = [];
  let pendingRowsIndex: number | null = null;

  for (const rawLine of prompt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let match = line.match(/^The result must contain exactly one spreadsheet named:\s*(.+)$/i);
    if (match) {
      getPromptSpreadsheetDraft(drafts, 0).name = truncateText(trimPromptSpreadsheetInstructionValue(match[1]), 31);
      pendingRowsIndex = null;
      continue;
    }

    match = line.match(/^The (first|second|third) spreadsheet name must be:\s*(.+)$/i);
    if (match) {
      const index = resolveSpreadsheetInstructionIndex(match[1]);
      if (index !== null) {
        getPromptSpreadsheetDraft(drafts, index).name = truncateText(
          trimPromptSpreadsheetInstructionValue(match[2]),
          31,
        );
      }
      pendingRowsIndex = null;
      continue;
    }

    match = line.match(/^The spreadsheet headers must be exactly:\s*(.+)$/i);
    if (match) {
      getPromptSpreadsheetDraft(drafts, 0).columns = parsePromptSpreadsheetColumns(match[1]);
      pendingRowsIndex = null;
      continue;
    }

    match = line.match(/^The (first|second|third) spreadsheet headers must be exactly:\s*(.+)$/i);
    if (match) {
      const index = resolveSpreadsheetInstructionIndex(match[1]);
      if (index !== null) {
        getPromptSpreadsheetDraft(drafts, index).columns = parsePromptSpreadsheetColumns(match[2]);
      }
      pendingRowsIndex = null;
      continue;
    }

    match = line.match(/^The spreadsheet must contain exactly these .* rows:\s*(.*)$/i);
    if (match) {
      const draft = getPromptSpreadsheetDraft(drafts, 0);
      const inlineRows = match[1].trim();
      if (inlineRows) {
        draft.rows = parsePromptSpreadsheetRows(inlineRows, Math.max(draft.columns.length, 3));
        pendingRowsIndex = null;
      } else {
        pendingRowsIndex = 0;
      }
      continue;
    }

    match = line.match(/^The (first|second|third) spreadsheet must contain exactly these .* rows:\s*(.*)$/i);
    if (match) {
      const index = resolveSpreadsheetInstructionIndex(match[1]);
      if (index !== null) {
        const draft = getPromptSpreadsheetDraft(drafts, index);
        const inlineRows = match[2].trim();
        if (inlineRows) {
          draft.rows = parsePromptSpreadsheetRows(inlineRows, Math.max(draft.columns.length, 3));
          pendingRowsIndex = null;
        } else {
          pendingRowsIndex = index;
        }
      }
      continue;
    }

    if (pendingRowsIndex !== null && /[|]/.test(line)) {
      const draft = getPromptSpreadsheetDraft(drafts, pendingRowsIndex);
      draft.rows.push(...parsePromptSpreadsheetRows(line, Math.max(draft.columns.length, 3)));
      continue;
    }

    pendingRowsIndex = null;
  }

  return drafts
    .map((draft, index) => ({
      name: truncateText(draft.name || `Sheet ${index + 1}`, 31),
      columns: uniqueTexts(draft.columns, 8, 40),
      rows: draft.rows.slice(0, 50).map((row) => row.slice(0, Math.max(draft.columns.length, 1))),
    }))
    .filter((sheet) => sheet.name && sheet.columns.length > 0 && sheet.rows.length > 0)
    .slice(0, 3);
}

function isAutoGeneratedSpreadsheetName(name: string) {
  return /^(table|sheet|worksheet)\s+\d+$/i.test(name.trim());
}

function resolveGeneratedSpreadsheets(
  spreadsheets: GeneratedDocument["spreadsheets"],
  prompt: string,
  sections: GeneratedDocument["sections"],
  requireSpreadsheet: boolean,
) {
  if (!requireSpreadsheet) {
    return [] satisfies GeneratedDocument["spreadsheets"];
  }

  const promptDefinedSpreadsheets = extractPromptDefinedSpreadsheets(prompt);
  if (promptDefinedSpreadsheets.length > 0) {
    if (spreadsheets.length === 0) {
      return promptDefinedSpreadsheets;
    }

    if (
      promptDefinedSpreadsheets.length > spreadsheets.length ||
      spreadsheets.every((sheet) => isAutoGeneratedSpreadsheetName(sheet.name))
    ) {
      return promptDefinedSpreadsheets;
    }
  }

  return spreadsheets.length > 0 ? spreadsheets : [buildFallbackSpreadsheet(sections)];
}


function normalizeLooseJsonObjectKey(key: string) {
  return key.replace(/[​-‍﻿]/g, "").replace(/\s+/g, "").trim();
}

function normalizeLooseJsonStructure(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLooseJsonStructure(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const normalizedKey = normalizeLooseJsonObjectKey(rawKey) || rawKey;
    normalized[normalizedKey] = normalizeLooseJsonStructure(rawValue);
  }

  return normalized;
}

function normalizeGeneratedDocumentPayload(
  raw: unknown,
  prompt: string,
  requireSpreadsheet: boolean,
): GeneratedDocument {
  const record = normalizeLooseJsonStructure(
    raw && typeof raw === "object" ? raw : {},
  ) as Record<string, unknown>;
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
    spreadsheets: resolveGeneratedSpreadsheets(spreadsheets, prompt, sections, requireSpreadsheet),
  };
}

function collectGeneratedDocumentCandidates(
  value: unknown,
  candidates: unknown[],
  visited: WeakSet<object>,
  depth = 0,
) {
  if (depth > 6 || value == null) {
    return;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.includes("{") && !trimmed.includes("["))) {
      return;
    }

    try {
      const parsed = JSON.parse(extractJsonObjectText(trimmed));
      candidates.push(parsed);
      collectGeneratedDocumentCandidates(parsed, candidates, visited, depth + 1);
    } catch {
      return;
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectGeneratedDocumentCandidates(item, candidates, visited, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const objectValue = value as Record<string, unknown>;
  if (visited.has(objectValue)) {
    return;
  }
  visited.add(objectValue);
  candidates.push(objectValue);

  const preferredKeys = [
    "document",
    "generated_document",
    "generatedDocument",
    "result",
    "response",
    "data",
    "message",
    "content",
    "output",
    "text",
    "output_text",
    "json",
    "json_str",
  ];

  for (const key of preferredKeys) {
    if (key in objectValue) {
      collectGeneratedDocumentCandidates(objectValue[key], candidates, visited, depth + 1);
    }
  }

  for (const [key, nestedValue] of Object.entries(objectValue)) {
    if (preferredKeys.includes(key)) {
      continue;
    }
    collectGeneratedDocumentCandidates(nestedValue, candidates, visited, depth + 1);
  }
}

function normalizeGeneratedDocumentScoreText(value: string) {
  return value.trim().toLowerCase();
}

function scoreResolvedGeneratedDocument(
  document: GeneratedDocument,
  prompt: string,
  requireSpreadsheet: boolean,
) {
  const promptTitle = truncateText(prompt, 120).trim().toLowerCase();
  const fallbackHeadings = new Set(["content overview", "overview", "内容概览"]);
  const summary = document.summary.trim();
  let score = 0;

  if (document.title.trim()) {
    score += 3;
  }
  if (document.title.trim().toLowerCase() !== promptTitle) {
    score += 8;
  }
  if (
    summary &&
    !/^edited document content\.?$/i.test(summary) &&
    summary !== "Document summary" &&
    summary !== "文档内容摘要"
  ) {
    score += 8;
  }

  score += document.sections.length * 5;
  for (const section of document.sections) {
    if (section.heading.trim() && !fallbackHeadings.has(section.heading.trim().toLowerCase())) {
      score += 4;
    }
    score += Math.min(section.paragraphs.join(" ").trim().length, 600) / 80;
    if (section.bullets.length > 0) {
      score += 6;
    }
    if (section.table) {
      score += 12 + Math.min(section.table.rows.length, 10);
    }
  }

  if (document.spreadsheets.length > 0) {
    score += 15 + document.spreadsheets.length * 5;
  }
  if (requireSpreadsheet && document.spreadsheets.length > 0) {
    score += 20;
  }

  if (
    document.sections.length === 1 &&
    fallbackHeadings.has(document.sections[0]?.heading.trim().toLowerCase() ?? "")
  ) {
    score -= 8;
  }

  if (
    document.sections.every(
      (section) =>
        section.bullets.length === 0 &&
        !section.table &&
        section.paragraphs.every(
          (paragraph) =>
            normalizeGeneratedDocumentScoreText(paragraph) ===
            normalizeGeneratedDocumentScoreText(document.summary),
        ),
    )
  ) {
    score -= 12;
  }

  return score;
}

function tryResolveGeneratedDocumentCandidate(
  value: unknown,
  prompt: string,
  requireSpreadsheet: boolean,
) {
  const documentSchema = getGeneratedDocumentSchema({ requireSpreadsheet });
  const candidates: unknown[] = [];
  collectGeneratedDocumentCandidates(value, candidates, new WeakSet<object>());

  let bestDocument: GeneratedDocument | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const directResult = documentSchema.safeParse(candidate);
    if (directResult.success) {
      const score = scoreResolvedGeneratedDocument(directResult.data, prompt, requireSpreadsheet);
      if (score > bestScore) {
        bestDocument = directResult.data;
        bestScore = score;
      }
      continue;
    }

    const normalizedCandidate =
      candidate && typeof candidate === "object"
        ? (normalizeLooseJsonStructure(candidate) as Record<string, unknown>)
        : null;
    const hasLikelyDocumentKeys = normalizedCandidate
      ? [
          "title",
          "summary",
          "sections",
          "chapters",
          "parts",
          "outline",
          "spreadsheets",
          "tables",
          "sheets",
        ].some((key) => key in normalizedCandidate)
      : false;

    if (!hasLikelyDocumentKeys) {
      continue;
    }

    const normalizedDocument = normalizeGeneratedDocumentPayload(
      candidate,
      prompt,
      requireSpreadsheet,
    );
    const normalizedResult = documentSchema.safeParse(normalizedDocument);
    if (normalizedResult.success) {
      const score = scoreResolvedGeneratedDocument(
        normalizedResult.data,
        prompt,
        requireSpreadsheet,
      );
      if (score > bestScore) {
        bestDocument = normalizedResult.data;
        bestScore = score;
      }
    }
  }

  return bestDocument;
}


function containsCjkText(value: string) {
  return /[\u3400-\u9fff]/.test(value);
}

function normalizePlainTextDocumentHeading(line: string) {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^Title\s*:\s*/i, "")
    .replace(/^Summary\s*:\s*/i, "")
    .replace(/^Section\s*:\s*/i, "")
    .replace(/^Chapter\s*:\s*/i, "")
    .trim();
}

function isPlainTextBulletLine(line: string) {
  return /^([-*•]\s+|\d+[.)]\s+)/.test(line.trim());
}

function normalizePlainTextBullet(line: string) {
  return line.trim().replace(/^([-*?]\s+|\d+[.)]\s+)/, "").trim();
}

function isMarkdownTableDividerLine(line: string) {
  return /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(line.trim());
}

function splitMarkdownTableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => truncateText(cell.trim(), 200));
}

function parseMarkdownTableBlock(
  rawLines: string[],
  startIndex: number,
  titleFallback: string,
) {
  const headerLine = rawLines[startIndex]?.trim() ?? "";
  const dividerLine = rawLines[startIndex + 1]?.trim() ?? "";
  if (!headerLine.includes("|") || !isMarkdownTableDividerLine(dividerLine)) {
    return null;
  }

  const columns = splitMarkdownTableCells(headerLine).slice(0, 8);
  if (columns.length === 0 || columns.every((column) => !column)) {
    return null;
  }

  const rows: string[][] = [];
  let index = startIndex + 2;
  while (index < rawLines.length) {
    const line = rawLines[index]?.trim() ?? "";
    if (!line || !line.includes("|")) {
      break;
    }
    if (isMarkdownTableDividerLine(line)) {
      index += 1;
      continue;
    }

    const cells = splitMarkdownTableCells(line).slice(0, columns.length);
    if (cells.some((cell) => cell.length > 0)) {
      rows.push(cells);
    }
    index += 1;
  }

  const normalizedTable = normalizeTabularData(
    {
      title: titleFallback,
      columns,
      rows,
    },
    {
      maxRows: 30,
      maxColumns: 8,
      titleFallback,
    },
  );

  if (!normalizedTable) {
    return null;
  }

  return {
    table: normalizedTable,
    nextIndex: index - 1,
  };
}

function isPlainTextSectionHeading(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (/^#{2,6}\s+/.test(trimmed)) {
    return true;
  }

  if (/^(Section|Chapter|Part)\s*[:\-]/i.test(trimmed)) {
    return true;
  }

  if (/^\d+(?:\.\d+)*[.)]?\s+.{1,80}$/.test(trimmed) && !/[.!?。！？]$/.test(trimmed)) {
    return true;
  }

  return false;
}

function buildGeneratedDocumentFromPlainText(
  rawText: string,
  prompt: string,
  requireSpreadsheet: boolean,
): GeneratedDocument {
  const cleaned = stripMarkdownCodeFence(rawText).replace(/\r\n/g, "\n").trim();
  const rawLines = cleaned.split("\n");
  const nonEmptyLines = rawLines.map((line) => line.trim()).filter(Boolean);
  const defaultHeading = containsCjkText(cleaned) ? "内容概览" : "Overview";

  let title = "";
  let summary = "";
  let startLineIndex = 0;

  for (let index = 0; index < nonEmptyLines.length; index += 1) {
    const line = nonEmptyLines[index];
    if (!title && /^Title\s*:/i.test(line)) {
      title = truncateText(normalizePlainTextDocumentHeading(line), 120);
      continue;
    }

    if (!summary && /^Summary\s*:/i.test(line)) {
      summary = truncateText(normalizePlainTextDocumentHeading(line), 1200);
      continue;
    }

    if (!title) {
      title = truncateText(normalizePlainTextDocumentHeading(line), 120);
      startLineIndex = index + 1;
      break;
    }
  }

  const sections: GeneratedDocument["sections"] = [];
  let currentSection: GeneratedDocument["sections"][number] | null = null;
  let paragraphBuffer: string[] = [];

  const ensureSection = () => {
    if (!currentSection) {
      currentSection = {
        heading: defaultHeading,
        paragraphs: [],
        bullets: [],
      };
    }

    return currentSection;
  };

  const flushParagraphBuffer = () => {
    if (paragraphBuffer.length === 0) {
      return;
    }

    const paragraph = truncateText(paragraphBuffer.join(" ").replace(/\s+/g, " "), 1500);
    if (paragraph) {
      ensureSection().paragraphs.push(paragraph);
    }
    paragraphBuffer = [];
  };

  const flushSection = () => {
    flushParagraphBuffer();
    if (!currentSection) {
      return;
    }

    if (currentSection.paragraphs.length === 0 && currentSection.bullets.length > 0) {
      currentSection.paragraphs.push(
        truncateText(currentSection.bullets.join("; "), 1500) ||
          (containsCjkText(cleaned) ? "提取的要点如下。" : "Key points extracted below."),
      );
    }

    if (currentSection.paragraphs.length === 0 && currentSection.table) {
      currentSection.paragraphs.push(containsCjkText(cleaned) ? "相关数据见下表。" : "See the table below.");
    }

    if (currentSection.paragraphs.length === 0) {
      currentSection = null;
      return;
    }

    sections.push({
      heading: truncateText(currentSection.heading, 80) || defaultHeading,
      paragraphs: currentSection.paragraphs.slice(0, 4),
      bullets: currentSection.bullets.slice(0, 8),
      ...(currentSection.table
        ? {
            table: currentSection.table,
          }
        : {}),
    });
    currentSection = null;
  };

  for (let index = startLineIndex; index < rawLines.length; index += 1) {
    const line = rawLines[index].trim();

    if (!line) {
      flushParagraphBuffer();
      continue;
    }

    if (!summary && /^Summary\s*:/i.test(line)) {
      summary = truncateText(normalizePlainTextDocumentHeading(line), 1200);
      continue;
    }

    const tableResult = parseMarkdownTableBlock(
      rawLines,
      index,
      truncateText(currentSection?.heading ?? defaultHeading, 80) || defaultHeading,
    );
    if (tableResult) {
      flushParagraphBuffer();
      if (currentSection?.table) {
        flushSection();
      }
      ensureSection().table = tableResult.table;
      index = tableResult.nextIndex;
      continue;
    }

    if (isPlainTextSectionHeading(line)) {
      flushSection();
      currentSection = {
        heading: truncateText(normalizePlainTextDocumentHeading(line), 80) || defaultHeading,
        paragraphs: [],
        bullets: [],
      };
      continue;
    }

    if (isPlainTextBulletLine(line)) {
      flushParagraphBuffer();
      const bullet = truncateText(normalizePlainTextBullet(line), 200);
      if (bullet) {
        ensureSection().bullets.push(bullet);
      }
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushSection();

  const normalizedSections = sections.length > 0 ? sections.slice(0, 8) : buildFallbackSections(cleaned);
  const normalizedSummary =
    truncateText(
      summary || normalizedSections.flatMap((section) => section.paragraphs).join(" ") || cleaned || prompt,
      1200,
    ) || (containsCjkText(cleaned) ? "文档内容摘要" : "Document summary");

  return {
    title: title || truncateText(prompt, 120) || (containsCjkText(cleaned) ? "生成文档" : "Generated Document"),
    summary: normalizedSummary,
    sections: normalizedSections,
    spreadsheets: resolveGeneratedSpreadsheets([], prompt, normalizedSections, requireSpreadsheet),
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

function getDocumentFormatGenerationGuidance(
  targetFormat: DocumentFileFormat,
  locale: PromptLocale,
) {
  if (targetFormat === "xlsx") {
    return locale === "zh"
      ? [
          "目标导出格式：Excel（.xlsx）。",
          "重点输出结构化表格数据。",
          "至少生成一个工作表，工作表名称明确，列名有意义，行数据完整可用。",
          "章节说明可以简洁，但表格必须是主要交付内容。",
        ]
      : [
          "Target export format: Excel (.xlsx).",
          "Focus on structured spreadsheet data.",
          "Include at least one spreadsheet with a clear sheet name, useful columns, and complete rows.",
          "Keep sections concise; the spreadsheet is the primary deliverable.",
        ];
  }

  if (targetFormat === "docx") {
    return locale === "zh"
      ? [
          "目标导出格式：Word（.docx）。",
          "重点输出可读性强的章节结构、清晰标题和完整段落。",
          "除非用户明确要求表格型输出，否则 spreadsheets 数组保持为空。",
        ]
      : [
          "Target export format: Word (.docx).",
          "Focus on prose sections, readable headings, and polished paragraphs.",
          "Keep the spreadsheets array empty unless the user explicitly requests tabular output.",
        ];
  }

  if (targetFormat === "pdf") {
    return locale === "zh"
      ? [
          "目标导出格式：PDF。",
          "重点输出叙述清晰、结构干净、便于阅读的正文内容。",
          "除非用户明确要求表格型输出，否则 spreadsheets 数组保持为空。",
        ]
      : [
          "Target export format: PDF.",
          "Focus on clean narrative structure with concise headings and readable paragraphs.",
          "Keep the spreadsheets array empty unless the user explicitly requests tabular output.",
        ];
  }

  if (targetFormat === "md") {
    return locale === "zh"
      ? [
          "目标导出格式：Markdown（.md）。",
          "使用适合 Markdown 的层级标题、简洁段落和清晰结构。",
          "除非用户明确要求表格型输出，否则 spreadsheets 数组保持为空。",
        ]
      : [
          "Target export format: Markdown (.md).",
          "Use a markdown-friendly structure with clear headings and concise paragraphs.",
          "Keep the spreadsheets array empty unless the user explicitly requests tabular output.",
        ];
  }

  return locale === "zh"
    ? [
        "目标导出格式：TXT（.txt）。",
        "使用适合纯文本的简单标题、清晰段落和可直接阅读的结构。",
        "除非用户明确要求表格型输出，否则 spreadsheets 数组保持为空。",
      ]
    : [
        "Target export format: TXT (.txt).",
        "Use plain-text-friendly structure with simple headings and readable paragraphs.",
        "Keep the spreadsheets array empty unless the user explicitly requests tabular output.",
      ];
}

function buildFileGenerationSystemPrompt(
  targetFormat: DocumentFileFormat,
  locale: PromptLocale = "en",
) {
  const requireSpreadsheet = targetFormat === "xlsx";

  return joinPromptLines([
    ...buildFileGenerationSchemaPromptLines(locale),
    ...getDocumentFormatGenerationGuidance(targetFormat, locale),
    locale === "zh"
      ? requireSpreadsheet
        ? "必须包含至少一个与用户需求匹配、可直接使用的有效工作表。"
        : "除非用户明确要求表格数据，否则必须返回空的 spreadsheets 数组。"
      : requireSpreadsheet
        ? "Include at least one meaningful spreadsheet that matches the user's request."
        : "Return an empty spreadsheets array unless tabular data is explicitly requested.",
  ]);
}

function parseGeneratedDocumentFromRawText(
  rawText: string,
  prompt: string,
  requireSpreadsheet: boolean,
) {
  const documentSchema = getGeneratedDocumentSchema({ requireSpreadsheet });
  let rawDocument: unknown;

  try {
    rawDocument = JSON.parse(extractJsonObjectText(rawText));
    if (typeof rawDocument === "string") {
      rawDocument = JSON.parse(extractJsonObjectText(rawDocument));
    }
  } catch {
    if (looksLikeStructuredDocumentJsonResponse(rawText)) {
      throw new Error("文档生成返回了不完整或非法的 JSON，已阻止导出损坏的 PDF。请重试生成。");
    }

    const plainTextDocument = buildGeneratedDocumentFromPlainText(
      rawText,
      prompt,
      requireSpreadsheet,
    );
    const plainTextResult = documentSchema.safeParse(plainTextDocument);
    if (plainTextResult.success) {
      return plainTextResult.data;
    }

    throw plainTextResult.error;
  }

  const resolvedDocument = tryResolveGeneratedDocumentCandidate(
    rawDocument,
    prompt,
    requireSpreadsheet,
  );
  if (resolvedDocument) {
    return resolvedDocument;
  }

  if (looksLikeStructuredDocumentJsonResponse(rawText)) {
    throw new Error("文档生成返回了不完整或非法的 JSON，已阻止导出损坏的 PDF。请重试生成。");
  }

  const plainTextDocument = buildGeneratedDocumentFromPlainText(
    rawText,
    prompt,
    requireSpreadsheet,
  );
  const plainTextResult = documentSchema.safeParse(plainTextDocument);
  if (plainTextResult.success) {
    return plainTextResult.data;
  }

  throw plainTextResult.error;
}

async function generateDocumentWithDashScope(
  requestId: string,
  modelId: string,
  prompt: string,
  targetFormat: DocumentFileFormat,
) {
  const requireSpreadsheet = targetFormat === "xlsx";
  const systemPrompt = `${buildFileGenerationSystemPrompt(targetFormat, "zh")} 只返回原始 JSON，不要返回 Markdown 或解释。`;
  const baseRequest = {
    model: modelId,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: buildFileGenerationPrompt(prompt, targetFormat, "zh"),
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
  const documentSystemPrompt = buildReplicateDocumentSystemPrompt(targetFormat, "en");
  const documentPrompt = buildReplicateDocumentPrompt(prompt, targetFormat, "en");
  const runDocumentGeneration = async (maxNewTokens?: number) => {
    const { primaryInput, fallbackInput } = buildReplicateDocumentGenerationInputs(
      normalizedModelId,
      documentPrompt,
      maxNewTokens,
      documentSystemPrompt,
    );

    let payload: ReplicatePredictionPayload;
    try {
      payload = await createReplicatePrediction(requestId, normalizedModelId, primaryInput);
    } catch (error) {
      if (getErrorStatusCode(error) !== 422) {
        throw error;
      }

      console.warn(
        `[Generate][${requestId}] Replicate 文档生成参数不兼容，自动降级为最小输入重试`,
      );
      payload = await createReplicatePrediction(requestId, normalizedModelId, fallbackInput);
    }

    const status = (payload.status ?? "").toLowerCase();
    if (status === "failed" || status === "canceled") {
      const detail = extractReplicateErrorText(payload.error);
      throw new Error(`Replicate 文档生成失败${detail ? `: ${detail}` : ""}`);
    }

    const finalPayload =
      status === "succeeded"
        ? payload
        : await (() => {
            if (!payload.id) {
              throw new Error("Replicate 文档生成失败 prediction id?");
            }

            return waitForReplicatePredictionResult(
              payload.id,
              REPLICATE_TEXT_TASK_TIMEOUT_MS,
              `Replicate 文档生成超时，请稍后重试。prediction_id: ${payload.id}`,
            );
          })();

    const content = extractReplicateTextOutput(finalPayload.output);
    if (!content.trim()) {
      throw new Error("Replicate 文档生成未返回可解析内容。");
    }

    return content;
  };

  const optimizedMaxNewTokens = getReplicateDocumentGenerationMaxNewTokens(targetFormat);

  try {
    const content = await runDocumentGeneration(optimizedMaxNewTokens);
    return parseGeneratedDocumentFromRawText(content, prompt, requireSpreadsheet);
  } catch (error) {
    if (optimizedMaxNewTokens >= DOCUMENT_GENERATION_MAX_TOKENS) {
      throw error;
    }

    console.warn(
      `[Generate][${requestId}] Replicate 文档生成首次结果未通过解析，自动回退到更高输出上限重试`,
    );
    const content = await runDocumentGeneration(DOCUMENT_GENERATION_MAX_TOKENS);
    return parseGeneratedDocumentFromRawText(content, prompt, requireSpreadsheet);
  }
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

function decodeUtf16BeBytes(bytes: Uint8Array) {
  const swapped = new Uint8Array(bytes.length - (bytes.length % 2));
  for (let index = 0; index < swapped.length; index += 2) {
    swapped[index] = bytes[index + 1] ?? 0;
    swapped[index + 1] = bytes[index] ?? 0;
  }

  return new TextDecoder("utf-16le").decode(swapped);
}

function scoreDecodedPlainText(text: string) {
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  const nullCount = (text.match(/\u0000/g) || []).length;
  const controlCount = (text.match(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  return replacementCount * 20 + nullCount * 10 + controlCount * 5;
}

function decodePlainTextDocumentBytes(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return normalizeEditablePlainText(new TextDecoder("utf-8").decode(bytes.subarray(3)));
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return normalizeEditablePlainText(new TextDecoder("utf-16le").decode(bytes.subarray(2)));
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return normalizeEditablePlainText(decodeUtf16BeBytes(bytes.subarray(2)));
  }

  const candidates = [
    () => new TextDecoder("utf-8", { fatal: false }).decode(bytes),
    () => new TextDecoder("utf-16le", { fatal: false }).decode(bytes),
    () => new TextDecoder("gb18030", { fatal: false }).decode(bytes),
  ];

  let bestText = "";
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    try {
      const decoded = normalizeEditablePlainText(candidate());
      if (!decoded) {
        continue;
      }

      const score = scoreDecodedPlainText(decoded);
      if (score < bestScore) {
        bestScore = score;
        bestText = decoded;
      }
    } catch {
      continue;
    }
  }

  return bestText;
}

const UTF8_BOM_BYTES = Uint8Array.from([0xef, 0xbb, 0xbf]);

function encodePlainTextDocumentBytes(text: string) {
  const encoded = new TextEncoder().encode(normalizeEditablePlainText(text));
  const output = new Uint8Array(UTF8_BOM_BYTES.length + encoded.length);
  output.set(UTF8_BOM_BYTES, 0);
  output.set(encoded, UTF8_BOM_BYTES.length);
  return output;
}

function stringifySpreadsheetCellValue(cell: unknown) {
  if (cell == null) {
    return "";
  }

  if (typeof cell === "object") {
    if ("text" in cell) {
      return String((cell as { text?: unknown }).text ?? "").trim();
    }

    if ("richText" in cell && Array.isArray((cell as { richText?: unknown[] }).richText)) {
      return (cell as { richText: Array<{ text?: unknown }> }).richText
        .map((item) => String(item?.text ?? ""))
        .join("")
        .trim();
    }

    if ("result" in cell && (cell as { result?: unknown }).result != null) {
      return String((cell as { result?: unknown }).result ?? "").trim();
    }

    if ("formula" in cell && typeof (cell as { formula?: unknown }).formula === "string") {
      return String((cell as { formula: string }).formula).trim();
    }

    if ("hyperlink" in cell) {
      const hyperlinkRecord = cell as { text?: unknown; hyperlink?: unknown };
      const text = String(hyperlinkRecord.text ?? "").trim();
      const link = String(hyperlinkRecord.hyperlink ?? "").trim();
      return [text, link].filter(Boolean).join(" ").trim();
    }
  }

  return String(cell).trim();
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
            .map((cell) => stringifySpreadsheetCellValue(cell))
            .filter(Boolean)
            .join("\t");
        })
        .filter(Boolean);

      if (rows.length === 0) {
        return "";
      }

      return [`Sheet: ${sheet.name}`, ...rows].join("\n");
    })
    .filter(Boolean);

  return normalizeEditablePlainText(sections.join("\n\n"));
}

async function extractEditableDocumentText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = getUploadFileExtension(file.name);

  if (extension === "txt" || extension === "md") {
    return decodePlainTextDocumentBytes(bytes);
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

function buildDocumentDetectionUnsupportedFormatMessage(
  locale: PromptLocale = getRuntimeLocale(),
) {
  return locale === "zh"
    ? "当前文档检测仅支持 TXT、MD、DOCX、XLSX、PDF 文件。"
    : "Document detection currently supports only TXT, MD, DOCX, XLSX, and PDF files.";
}

async function extractDetectableDocumentText(
  file: File,
  locale: PromptLocale = getRuntimeLocale(),
) {
  const extension = getUploadFileExtension(file.name);
  if (!["txt", "md", "docx", "xlsx", "pdf"].includes(extension)) {
    throw new Error(buildDocumentDetectionUnsupportedFormatMessage(locale));
  }

  return extractEditableDocumentText(file);
}

function buildDocumentDetectionExcerpt(text: string, maxChars: number) {
  const normalized = normalizeEditablePlainText(text);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const separator = "\n\n[...]\n\n";
  const chunkLength = Math.max(200, Math.floor((maxChars - separator.length * 2) / 3));
  const head = normalized.slice(0, chunkLength).trim();
  const middleStart = Math.max(0, Math.floor(normalized.length / 2 - chunkLength / 2));
  const middle = normalized.slice(middleStart, middleStart + chunkLength).trim();
  const tail = normalized.slice(Math.max(0, normalized.length - chunkLength)).trim();

  return truncateText([head, middle, tail].filter(Boolean).join(separator), maxChars);
}

function buildDocumentDetectionPrompt(input: {
  fileName: string;
  extractedText: string;
  locale: "zh" | "en";
}) {
  const excerpt = buildDocumentDetectionExcerpt(input.extractedText, DETECTION_SOURCE_MAX_CHARS);
  if (input.locale === "zh") {
    return joinPromptLines([
      `文件名：${input.fileName}`,
      "请仅基于文档文本本身可观察到的语言、结构和信息特征进行判断，不要臆测作者身份或写作过程。",
      "重点从以下维度评估该文档是否可能为 AI 生成：",
      "1. 语言重复度：句式、词汇、表达方式是否过度重复",
      "2. 结构均匀性：段落长度和组织方式是否过于整齐机械",
      "3. 信息密度：是否空泛、缺乏具体细节、数据或上下文约束",
      "4. 措辞风格：是否存在模板化、机械化、过度标准化表达",
      "5. 逻辑连贯性：推理是否跳跃、浅层、缺乏真实写作痕迹",
      "6. 个性化特征：是否缺乏个人语气、习惯表达、自然口语感",
      "7. 错误类型：更接近 AI 的事实/逻辑问题，还是更接近人工的拼写/语法/口误",
      "8. 新颖性：观点是否具体、有针对性，还是流于常见套话",
      "如果文本很短、信息很少或证据不充分，请保守判断并降低 probability 与 confidence。",
      "",
      "文档内容：",
      excerpt,
    ]);
  }

  return joinPromptLines([
    `File: ${input.fileName}`,
    "Judge only from observable textual evidence in the document itself; do not speculate about the author or unseen writing process.",
    "Assess whether the document may be AI-generated across these dimensions:",
    "1. Repetition: repeated sentence patterns, wording, or expressions",
    "2. Structural uniformity: overly regular paragraph lengths or organization",
    "3. Information density: shallow content, lack of concrete details, data, or constraints",
    "4. Phrasing style: templated, mechanical, or overly standardized wording",
    "5. Logical coherence: shallow reasoning, abrupt jumps, or weak argumentative depth",
    "6. Personalization: lack of personal voice, colloquialisms, or natural human texture",
    "7. Error types: more AI-like factual/logical issues vs more human-like spelling/grammar slips",
    "8. Originality: specific insight vs generic platitudes",
    "If the text is short or evidence is insufficient, be conservative and lower both probability and confidence.",
    "",
    "Document content:",
    excerpt,
  ]);
}

function buildVisualDetectionPrompt(target: "image" | "video", locale: "zh" | "en") {
  if (locale === "zh") {
    if (target === "video") {
      return joinPromptLines([
        "⚠️ 关键：真实视频允许存在场景切换、镜头切换、UI 覆层、曝光波动、自然光变化和焦距变化，这些本身不是 AI 特征。",
        "请重点观察同一主体、同一镜头或同一场景内部的一致性，而不是简单把‘不连续’误判为 AI。",
        "",
        "只有以下类型的现象才更像 AI 生成证据：",
        "1. 同一镜头内的人脸、肢体、手指、物体轮廓持续漂移、扭曲或突然变形",
        "2. 同一场景内的纹理、材质、背景结构反复重绘、模糊、重复或不真实",
        "3. 光影、反射、透视、重力或运动规律明显违背物理常识",
        "4. 主体身份、服装、关键道具或空间关系在无合理剪辑依据下突然变化",
        "5. 明显的生成伪影、闪烁、边缘抖动、局部糊化或结构崩坏",
        "",
        "⚠️ 以下情况通常是正常现象，不要误判为 AI：",
        "- 正常剪辑造成的场景跳转、角度切换、时间变化",
        "- 视频播放器或录屏带来的 UI 界面、字幕层、进度条",
        "- 自然天气/光照变化、对焦变化、镜头焦距变化",
        "- 不同关键帧来自不同片段或不同镜头",
        "",
        "如果提供的关键帧明显来自不同场景或包含 UI 覆层，不能仅凭场景不连续就判为 AI；若缺少明确伪影，应保守降低 probability。",
      ]);
    }
    return joinPromptLines([
      "请仅基于图片中可观察到的视觉证据进行判断，不要臆测生成过程。",
      "重点从以下维度分析该图片是否可能为 AI 生成：",
      "1. 纹理细节：局部纹理是否重复、不自然、过于干净或过度平滑",
      "2. 边缘质量：主体边缘是否模糊、断裂、粘连或带有伪影",
      "3. 光影一致性：光源方向、阴影、高光、反射是否符合物理规律",
      "4. 解剖与结构：人脸、手指、肢体、器物结构是否自然合理",
      "5. 文字与符号：文字、标识、图案是否变形、乱码或不连贯",
      "6. 透视关系：空间透视、尺度比例、重叠关系是否真实",
      "7. 对称与重复：是否存在不自然的过度对称或细节复制",
      "8. 放大一致性：放大后细节是否经得起推敲，是否出现局部崩坏或穿帮",
      "如果图片证据不足或只是风格化较强但没有明确伪影，请保守判断并降低 probability 与 confidence。",
    ]);
  }

  if (target === "video") {
    return joinPromptLines([
      "⚠️ KEY: Real videos may contain scene cuts, camera switches, UI overlays, exposure changes, natural lighting changes, and focal-length shifts. These alone are NOT AI indicators.",
      "Focus on within-shot and within-subject consistency instead of over-penalizing normal editing discontinuity.",
      "",
      "Signs that more strongly support AI generation include:",
      "1. Persistent face, limb, finger, or object deformation within the same shot",
      "2. Repainting, unstable textures, repeated details, or structural drift within one scene",
      "3. Clearly impossible lighting, reflection, gravity, motion, or perspective behavior",
      "4. Sudden identity, clothing, prop, or spatial-layout changes without a plausible edit boundary",
      "5. Obvious generation artifacts such as flicker, edge shimmer, local blur collapse, or geometry failure",
      "",
      "⚠️ Usually normal and should not be over-counted as AI evidence:",
      "- Ordinary scene cuts or angle changes",
      "- Screen-recording or player UI overlays",
      "- Natural weather, time-of-day, focus, or exposure changes",
      "- Different keyframes coming from different segments or shots",
      "",
      "If keyframes clearly come from different scenes or include UI overlays, do not classify as AI merely because continuity is broken; stay conservative unless explicit artifacts are visible.",
    ]);
  }
  return joinPromptLines([
    "Judge only from observable visual evidence in the image itself; do not speculate about the hidden generation process.",
    "Assess whether the image may be AI-generated across these dimensions:",
    "1. Texture details: repeated, unstable, overly smooth, or unnatural local textures",
    "2. Edge quality: blurry borders, broken contours, sticking artifacts, or unclear separations",
    "3. Lighting consistency: whether light direction, shadows, highlights, and reflections obey physics",
    "4. Anatomy and structure: whether faces, fingers, limbs, tools, and object structures look natural",
    "5. Text and symbols: whether text, logos, signs, or patterns are garbled or structurally inconsistent",
    "6. Perspective relations: whether depth, scale, overlap, and geometry are realistic",
    "7. Symmetry and repetition: unnatural over-symmetry or duplicated detail patterns",
    "8. Zoomed-in coherence: whether details remain consistent under closer inspection",
    "If evidence is weak or the image is simply stylized without clear artifacts, stay conservative and lower both probability and confidence.",
  ]);
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
    enable_thinking: true,
    temperature: 0.2,
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
    enable_thinking: true,
    temperature: 0.2,
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
    return decodePlainTextDocumentBytes(bytes);
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
  locale?: PromptLocale;
}) {
  const locale = input.locale ?? getRuntimeLocale();

  return locale === "zh"
    ? [
        `文件名: ${input.fileName}`,
        `指令: ${input.instruction}`,
        "编辑方式: 文本替换",
        `替换次数: ${input.replacementCount}`,
        `原文: ${input.sourceText}`,
        `新文: ${input.targetText}`,
      ].join("\n")
    : [
        `File: ${input.fileName}`,
        `Instruction: ${input.instruction}`,
        "Edit mode: direct replacement",
        `Replacement count: ${input.replacementCount}`,
        `Original: ${input.sourceText}`,
        `Updated: ${input.targetText}`,
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

        if (!cell.value || typeof cell.value !== "object") {
          return;
        }

        if (
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

        const objectValue = cell.value as unknown as Record<string, unknown>;
        const nextValue: Record<string, unknown> = { ...objectValue };
        let objectReplacementCount = 0;

        for (const key of ["text", "hyperlink", "formula", "result"] as const) {
          if (typeof nextValue[key] !== "string") {
            continue;
          }

          const replaced = replaceAllLiteral(nextValue[key] as string, plan.sourceText, plan.targetText);
          if (replaced.count > 0) {
            nextValue[key] = replaced.value;
            objectReplacementCount += replaced.count;
          }
        }

        if (objectReplacementCount > 0) {
          cell.value = nextValue as unknown as typeof cell.value;
          replacementCount += objectReplacementCount;
        }
      });
    });
  });

  return {
    bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
    replacementCount,
  };
}

async function tryPerformDirectDocumentEdit(
  file: File,
  instruction: string,
  locale: PromptLocale = getRuntimeLocale(),
) {
  const plan = parseLiteralReplaceInstruction(instruction);
  if (!plan) {
    return null;
  }

  const bytes = new Uint8Array(await file.arrayBuffer()) as Uint8Array;
  const extension = getUploadFileExtension(file.name);
  let editedBytes: Uint8Array = bytes;
  let replacementCount = 0;

  if (extension === "txt" || extension === "md") {
    const sourceText = decodePlainTextDocumentBytes(bytes);
    const replaced = replaceAllLiteral(sourceText, plan.sourceText, plan.targetText);
    replacementCount = replaced.count;
    editedBytes = encodePlainTextDocumentBytes(replaced.value);
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
    throw new Error(
      locale === "zh"
        ? `未在文档中找到原文“${plan.sourceText}”，请确认原文完全一致后重试。`
        : `The source text "${plan.sourceText}" was not found in the document. Please verify an exact match and try again.`,
    );
  }

  const previewText = buildDirectDocumentEditPreview({
    fileName: file.name,
    instruction,
    sourceText: plan.sourceText,
    targetText: plan.targetText,
    replacementCount,
    locale,
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
  const allowPlainTextMultiExportForTests =
    process.env.ALLOW_PLAIN_TEXT_EDIT_MULTI_EXPORT_FOR_TESTS === "true" &&
    process.env.NODE_ENV !== "production";
  const allowPdfMultiExportForTests =
    process.env.ALLOW_PDF_EDIT_MULTI_EXPORT_FOR_TESTS === "true" &&
    process.env.NODE_ENV !== "production";

  if (extension === "txt") {
    return allowPlainTextMultiExportForTests ? ["txt", "md"] : ["txt"];
  }

  if (extension === "md") {
    return allowPlainTextMultiExportForTests ? ["md", "txt"] : ["md"];
  }

  if (extension === "xlsx") {
    return ["xlsx"];
  }

  if (extension === "pdf") {
    return allowPdfMultiExportForTests ? ["pdf", "txt", "md"] : ["pdf"];
  }

  return ["docx"];
}

function extractExplicitEditingTargetText(instruction: string) {
  const normalized = instruction.trim();
  if (!normalized) {
    return null;
  }

  const prefixes = [
    "???????",
    "??????:",
    "???????",
    "??????:",
    "??????",
    "?????:",
    "??????",
    "?????:",
    "????????",
    "???????:",
    "????????",
    "???????:",
    "Required exact target wording for this edit:",
    "The target wording must appear verbatim in the result:",
    "final wording must be:",
    "target wording must be:",
    "final sentence must be:",
    "target sentence must be:",
    "TARGET_SENTENCE:",
    "TARGET_TEXT:",
  ];

  for (const prefix of prefixes) {
    const index = normalized.indexOf(prefix);
    if (index < 0) {
      continue;
    }

    const remainderSource = normalized.slice(index + prefix.length).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    const remainder = remainderSource.split("\n", 1)[0]?.trim() || "";
    if (remainder) {
      return truncateText(remainder, 300);
    }
  }

  return null;
}

function normalizeComparableEditText(input: string) {
  return input.normalize("NFKC").replace(/\s+/g, "").trim();
}

function buildComparableBigrams(input: string) {
  const normalized = normalizeComparableEditText(input);
  if (!normalized) {
    return new Set<string>();
  }

  if (normalized.length === 1) {
    return new Set([normalized]);
  }

  const bigrams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    bigrams.add(normalized.slice(index, index + 2));
  }

  return bigrams;
}

function computeEditTextSimilarity(left: string, right: string) {
  const leftNormalized = normalizeComparableEditText(left);
  const rightNormalized = normalizeComparableEditText(right);
  if (!leftNormalized || !rightNormalized) {
    return 0;
  }

  const leftBigrams = buildComparableBigrams(left);
  const rightBigrams = buildComparableBigrams(right);
  if (!leftBigrams.size || !rightBigrams.size) {
    return 0;
  }

  let intersectionCount = 0;
  for (const token of leftBigrams) {
    if (rightBigrams.has(token)) {
      intersectionCount += 1;
    }
  }

  const bigramScore = intersectionCount / Math.max(leftBigrams.size, rightBigrams.size);
  const sharedCharScore = Array.from(new Set(leftNormalized)).filter((char) => rightNormalized.includes(char)).length /
    Math.max(leftNormalized.length, rightNormalized.length);

  return bigramScore * 0.75 + sharedCharScore * 0.25;
}

function splitEditableTextSegments(text: string) {
  const segments: string[] = [];
  const separators = new Set(["\n", "?", "?", "?", "!", "?", "?", ";"]);
  let current = "";

  for (const char of text) {
    current += char;
    if (separators.has(char)) {
      const segment = current.trim();
      if (segment) {
        segments.push(segment);
      }
      current = "";
    }
  }

  const trailing = current.trim();
  if (trailing) {
    segments.push(trailing);
  }

  return segments.length > 0 ? segments : [text.trim()].filter(Boolean);
}

function documentContainsComparableText(document: GeneratedDocument, targetText: string) {
  const targetComparable = normalizeComparableEditText(targetText);
  if (!targetComparable) {
    return false;
  }

  const values: string[] = [document.title, document.summary];
  for (const section of document.sections) {
    values.push(section.heading, ...section.paragraphs, ...section.bullets);
    if (section.table) {
      values.push(section.table.title || "", ...section.table.columns, ...section.table.rows.flat());
    }
  }
  for (const spreadsheet of document.spreadsheets) {
    values.push(spreadsheet.name, ...spreadsheet.columns, ...spreadsheet.rows.flat());
  }

  return values.some((value) => normalizeComparableEditText(value).includes(targetComparable));
}

function computeEditTextPrefixLength(left: string, right: string) {
  const leftNormalized = normalizeComparableEditText(left);
  const rightNormalized = normalizeComparableEditText(right);
  const maxLength = Math.min(leftNormalized.length, rightNormalized.length);
  let length = 0;

  while (length < maxLength && leftNormalized[length] === rightNormalized[length]) {
    length += 1;
  }

  return length;
}

function collectGeneratedDocumentTextValues(document: GeneratedDocument) {
  const values: string[] = [document.title, document.summary];
  for (const section of document.sections) {
    values.push(section.heading, ...section.paragraphs, ...section.bullets);
    if (section.table) {
      values.push(section.table.title || "", ...section.table.columns, ...section.table.rows.flat());
    }
  }
  for (const spreadsheet of document.spreadsheets) {
    values.push(spreadsheet.name, ...spreadsheet.columns, ...spreadsheet.rows.flat());
  }
  return values;
}

function findPreferredSourceSummary(sourceText: string) {
  const normalized = sourceText.replace(/\r/g, '');
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lower = line.toLowerCase();
    if (!lower.startsWith('summary anchor') && !line.startsWith('????')) {
      continue;
    }

    const parts = [line];
    while (index + 1 < lines.length) {
      const nextLine = lines[index + 1]!;
      const nextLower = nextLine.toLowerCase();
      if (
        nextLower.startsWith('section ') ||
        nextLower.startsWith('sheet:') ||
        nextLine.startsWith('??') ||
        nextLine.startsWith('??')
      ) {
        break;
      }
      parts.push(nextLine);
      index += 1;
      if (/[?.\!]$/.test(nextLine)) {
        break;
      }
    }

    const summary = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (summary) {
      return summary;
    }
  }

  return null;
}

function shouldRecoverSourceSegment(segment: string) {
  const normalized = normalizeComparableEditText(segment);
  if (normalized.length < 24) {
    return false;
  }

  if (!/[\s,.:;????]/.test(segment) && !/[一-鿿]/.test(segment)) {
    return false;
  }

  const lower = segment.toLowerCase();
  if (
    lower === 'overview' ||
    lower === 'sheet' ||
    lower === 'field' ||
    lower === 'sample' ||
    lower === 'result'
  ) {
    return false;
  }

  return true;
}

function repairGeneratedDocumentMissingSourceSegments(
  document: GeneratedDocument,
  originalSourceText: string,
  replacedSourceText: string | null,
  targetText: string | null,
) {
  const existingValues = collectGeneratedDocumentTextValues(document).map((value) => normalizeComparableEditText(value));
  const existingSet = new Set(existingValues);
  const missingSegments: string[] = [];
  const replacedComparable = normalizeComparableEditText(replacedSourceText || '');
  const targetComparable = normalizeComparableEditText(targetText || '');

  for (const segment of splitEditableTextSegments(originalSourceText.replaceAll('	', String.fromCharCode(10)))) {
    if (!shouldRecoverSourceSegment(segment)) {
      continue;
    }

    const comparable = normalizeComparableEditText(segment);
    if (!comparable || existingSet.has(comparable)) {
      continue;
    }
    if (replacedComparable && (comparable === replacedComparable || comparable.includes(replacedComparable))) {
      continue;
    }
    if (targetComparable && comparable === targetComparable) {
      continue;
    }

    missingSegments.push(segment.trim());
    existingSet.add(comparable);
  }

  const preferredSummary = findPreferredSourceSummary(originalSourceText);
  const nextDocument =
    preferredSummary &&
    !normalizeComparableEditText(document.summary).includes(normalizeComparableEditText(preferredSummary))
      ? {
          ...document,
          summary: preferredSummary,
        }
      : document;

  if (missingSegments.length === 0) {
    return nextDocument;
  }

  const nextSections = nextDocument.sections.map((section) => ({
    ...section,
    paragraphs: [...section.paragraphs],
    bullets: [...section.bullets],
    table: section.table
      ? {
          ...section.table,
          columns: [...section.table.columns],
          rows: section.table.rows.map((row) => [...row]),
        }
      : undefined,
  }));

  if (nextSections.length === 0) {
    nextSections.push({
      heading: 'Recovered Content',
      paragraphs: missingSegments.slice(0, 4),
      bullets: [],
    });
  } else {
    const lastSection = nextSections[nextSections.length - 1]!;
    for (const segment of missingSegments) {
      if (lastSection.paragraphs.length < 4) {
        lastSection.paragraphs.push(segment);
      }
    }
  }

  return {
    ...nextDocument,
    sections: nextSections,
  };
}

function findBestExplicitTargetReplacementSource(sourceText: string, targetText: string) {
  let bestMatch: { sourceText: string; score: number } | null = null;
  const targetComparableLength = normalizeComparableEditText(targetText).length;

  for (const segment of splitEditableTextSegments(sourceText.replaceAll("	", String.fromCharCode(10)))) {
    const comparableLength = normalizeComparableEditText(segment).length;
    if (comparableLength < Math.max(10, Math.floor(targetComparableLength * 0.75))) {
      continue;
    }

    const prefixLength = computeEditTextPrefixLength(segment, targetText);
    if (prefixLength < 4 && !segment.includes("??") && !segment.includes("??") && !segment.includes("??")) {
      continue;
    }

    const score = computeEditTextSimilarity(segment, targetText) + prefixLength / Math.max(1, targetComparableLength);
    if (score < 0.35) {
      continue;
    }
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        sourceText: segment,
        score,
      };
    }
  }

  return bestMatch;
}

function replaceExactEditText(value: string, sourceText: string, targetText: string) {
  if (!value || !sourceText || value === targetText || !value.includes(sourceText)) {
    return value;
  }

  return value.split(sourceText).join(targetText);
}

function repairGeneratedDocumentWithExplicitTarget(
  document: GeneratedDocument,
  originalSourceText: string,
  targetText: string | null,
) {
  const bestMatch = targetText
    ? findBestExplicitTargetReplacementSource(originalSourceText, targetText)
    : null;
  const fallbackBestMatch = !bestMatch?.sourceText && targetText
    ? findBestExplicitTargetReplacementSource(collectGeneratedDocumentTextValues(document).join(String.fromCharCode(10)), targetText)
    : null;
  const sourceText = bestMatch?.sourceText || fallbackBestMatch?.sourceText || null;

  let repaired = document;
  if (targetText && sourceText && normalizeComparableEditText(sourceText) !== normalizeComparableEditText(targetText)) {
    repaired = {
    ...document,
    summary: replaceExactEditText(document.summary, sourceText, targetText),
    sections: document.sections.map((section) => ({
      ...section,
      paragraphs: section.paragraphs.map((paragraph) => replaceExactEditText(paragraph, sourceText, targetText)),
      bullets: section.bullets.map((bullet) => replaceExactEditText(bullet, sourceText, targetText)),
      table: section.table
        ? {
            ...section.table,
            rows: section.table.rows.map((row) =>
              row.map((cell) => replaceExactEditText(cell, sourceText, targetText)),
            ),
          }
        : undefined,
    })),
    spreadsheets: document.spreadsheets.map((spreadsheet) => ({
      ...spreadsheet,
      rows: spreadsheet.rows.map((row) =>
        row.map((cell) => replaceExactEditText(cell, sourceText, targetText)),
      ),
    })),
    };

    repaired = documentContainsComparableText(repaired, targetText) ? repaired : document;
  }

  return repairGeneratedDocumentMissingSourceSegments(repaired, originalSourceText, sourceText, targetText);
}

function buildDocumentEditingSystemPrompt(
  requireSpreadsheet: boolean,
  locale: PromptLocale = "en",
) {
  return joinPromptLines([
    ...buildFileGenerationSchemaPromptLines(locale),
    locale === "zh"
      ? "???????????????????????"
      : "You edit uploaded documents instead of drafting them from scratch.",
    locale === "zh"
      ? "??????????????????????????????????"
      : "Preserve core facts, structure order, and unaffected content unless the user explicitly asks to change them.",
    locale === "zh"
      ? "??????????????????????????"
      : "Do not summarize, compress, omit, soften, or rewrite content that was not requested to change.",
    locale === "zh"
      ? "???????????????????????????????????????????????????????"
      : "Reuse unchanged paragraphs, bullets, table cells, and spreadsheet cells as close to verbatim as possible, including prefixes, numbering, punctuation, currency symbols, and casing.",
    locale === "zh"
      ? "????????????????????????"
      : "For local replacement requests, keep all other sentences as close to verbatim as possible.",
    locale === "zh"
      ? requireSpreadsheet
        ? "??????? xlsx ????????????????"
        : "??????????????? spreadsheets ???????"
      : requireSpreadsheet
        ? "Return at least one spreadsheet when the output format includes xlsx."
        : "Return an empty spreadsheets array unless tabular data is genuinely needed.",
    locale === "zh" ? "????? JSON????? Markdown ????" : "Respond with raw JSON only.",
  ]);
}

function buildDocumentEditingPrompt(input: {
  fileName: string;
  instruction: string;
  sourceText: string;
  requireSpreadsheet: boolean;
  locale?: PromptLocale;
}) {
  const locale = input.locale ?? "en";
  const explicitTargetText = extractExplicitEditingTargetText(input.instruction);

  if (locale === "zh") {
    return joinPromptLines([
      `????${input.fileName}`,
      "?????",
      input.instruction,
      "",
      explicitTargetText ? `????????????????${explicitTargetText}` : "",
      "?????",
      truncateText(input.sourceText, DOCUMENT_EDIT_SOURCE_MAX_CHARS),
      "",
      "?????",
      "- ??????????????????",
      "- ??????????????",
      "- ????????????????????",
      "- ???????????????????????????????????????????????????????",
      "- ?????????????????????",
      explicitTargetText ? `- ???????????????${explicitTargetText}` : "",
      explicitTargetText ? "- ????????????????????" : "",
      input.requireSpreadsheet
        ? "- ?????????????????"
        : "- ??????????????? spreadsheets ???????",
    ]);
  }

  return joinPromptLines([
    `Source file: ${input.fileName}`,
    "Editing instructions:",
    input.instruction,
    "",
    explicitTargetText ? `Required exact target wording for this edit: ${explicitTargetText}` : "",
    "Source content:",
    truncateText(input.sourceText, DOCUMENT_EDIT_SOURCE_MAX_CHARS),
    "",
    "Output requirements:",
    "- Keep the result faithful to the uploaded file while applying the requested edits.",
    "- Return one complete edited document package.",
    "- Do not omit sections, shorten paragraphs, or summarize unchanged passages.",
    "- Reuse unchanged paragraphs, bullets, table cells, and spreadsheet cells as close to verbatim as possible, including prefixes, numbering, punctuation, currency symbols, and casing.",
    "- If the request is a local phrase replacement, keep every other sentence as close to the source as possible.",
    explicitTargetText ? `- The target wording must appear verbatim in the result: ${explicitTargetText}` : "",
    explicitTargetText ? "- Do not keep the superseded wording in the corresponding location." : "",
    input.requireSpreadsheet
      ? "- Include at least one useful spreadsheet in the result."
      : "- Keep the spreadsheets array empty unless the edited result clearly needs tabular data.",
  ]);
}

function buildReplicateDocumentEditingPrompt(input: {
  fileName: string;
  instruction: string;
  sourceText: string;
  requireSpreadsheet: boolean;
}) {
  return buildReplicateCompactDocumentEditingPrompt(input);
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
        content: buildDocumentEditingSystemPrompt(input.requireSpreadsheet, "zh"),
      },
      {
        role: "user",
        content: buildDocumentEditingPrompt({
          fileName: input.file.name,
          instruction: input.prompt,
          sourceText,
          requireSpreadsheet: input.requireSpreadsheet,
          locale: "zh",
        }),
      },
    ],
    temperature: 0,
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
  const explicitTargetText = extractExplicitEditingTargetText(input.prompt);
  const directResult = documentSchema.safeParse(rawDocument);
  if (directResult.success) {
    return repairGeneratedDocumentWithExplicitTarget(directResult.data, sourceText, explicitTargetText);
  }

  const normalizedDocument = normalizeGeneratedDocumentPayload(
    rawDocument,
    input.prompt,
    input.requireSpreadsheet,
  );
  const normalizedResult = documentSchema.safeParse(normalizedDocument);
  if (normalizedResult.success) {
    return repairGeneratedDocumentWithExplicitTarget(normalizedResult.data, sourceText, explicitTargetText);
  }

  throw normalizedResult.error;
}

async function editDocumentWithReplicate(input: {
  requestId: string;
  modelId: string;
  prompt: string;
  file: File;
  requireSpreadsheet: boolean;
  locale?: PromptLocale;
}) {
  const locale = input.locale ?? getRuntimeLocale();
  const sourceText = await extractEditableDocumentText(input.file);
  if (!sourceText.trim()) {
    throw new Error(
      locale === "zh"
        ? "上传文档未解析出可编辑文本，请更换文件后重试。"
        : "No editable text could be extracted from the uploaded document. Please try a different file.",
    );
  }

  const normalizedModelId = normalizeReplicateTextModelId(input.modelId);
  const documentPrompt = buildReplicateDocumentEditingPrompt({
    fileName: input.file.name,
    instruction: input.prompt,
    sourceText,
    requireSpreadsheet: input.requireSpreadsheet,
  });
  const { primaryInput, fallbackInput } = buildReplicateDocumentEditingInputs(
    normalizedModelId,
    documentPrompt,
    input.requireSpreadsheet,
  );

  let payload: ReplicatePredictionPayload;
  try {
    payload = await createReplicatePrediction(input.requestId, normalizedModelId, primaryInput);
  } catch (error) {
    if (getErrorStatusCode(error) !== 422) {
      throw error;
    }

    console.warn(
      locale === "zh"
        ? `[Generate][${input.requestId}] Replicate 文档编辑参数不兼容，自动降级为最小输入重试`
        : `[Generate][${input.requestId}] Replicate document editing input is incompatible; retrying with fallback input`,
    );
    payload = await createReplicatePrediction(input.requestId, normalizedModelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(
      locale === "zh"
        ? `Replicate 文档编辑失败${detail ? `: ${detail}` : ""}`
        : `Replicate document editing failed${detail ? `: ${detail}` : ""}`,
    );
  }

  const finalPayload =
    status === "succeeded"
      ? payload
      : await (() => {
          if (!payload.id) {
            throw new Error(
              locale === "zh"
                ? "Replicate 返回结果缺少 prediction id。"
                : "Replicate response is missing a prediction id.",
            );
          }

          return waitForReplicatePredictionResult(
            payload.id,
            REPLICATE_TEXT_TASK_TIMEOUT_MS,
            locale === "zh"
              ? `Replicate 文档编辑超时，请稍后重试。prediction_id: ${payload.id}`
              : `Replicate document editing timed out. Please try again later. prediction_id: ${payload.id}`,
          );
        })();

  const content = extractReplicateTextOutput(finalPayload.output);
  if (!content.trim()) {
    throw new Error(
      locale === "zh"
        ? "Replicate ?????????????"
        : "Replicate document editing returned no parseable content.",
    );
  }

  const explicitTargetText = extractExplicitEditingTargetText(input.prompt);

  try {
    let rawDocument: unknown = JSON.parse(extractJsonObjectText(content));
    if (typeof rawDocument === "string") {
      rawDocument = JSON.parse(extractJsonObjectText(rawDocument));
    }

    const documentSchema = getGeneratedDocumentSchema({ requireSpreadsheet: input.requireSpreadsheet });
    const directResult = documentSchema.safeParse(rawDocument);
    if (directResult.success) {
      return repairGeneratedDocumentWithExplicitTarget(directResult.data, sourceText, explicitTargetText);
    }

    const normalizedDocument = normalizeGeneratedDocumentPayload(
      rawDocument,
      input.prompt,
      input.requireSpreadsheet,
    );
    const normalizedResult = documentSchema.safeParse(normalizedDocument);
    if (normalizedResult.success) {
      return repairGeneratedDocumentWithExplicitTarget(normalizedResult.data, sourceText, explicitTargetText);
    }
  } catch {
    // Fallback to the generic parser below.
  }

  const parsedDocument = parseGeneratedDocumentFromRawText(content, input.prompt, input.requireSpreadsheet);
  return repairGeneratedDocumentWithExplicitTarget(parsedDocument, sourceText, explicitTargetText);
}

function fileToDataUrl(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const mimeType = file.type || "application/octet-stream";
    return `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
  });
}

function buildDashScopeImagePrompt(prompt: string, mode: "generation" | "editing" = "generation") {
  const cleanedPrompt = prompt.replace(/\s+/g, " ").trim();

  if (mode === "editing") {
    return joinPromptLines([
      "请基于输入图片执行精确编辑，严格落实用户要求。",
      "除非用户明确要求改变，否则必须保留主体身份、整体构图、镜头视角、空间关系、画幅比例和未修改区域。",
      "只修改用户明确提到的部分，不要擅自新增、删除、替换或改动其他元素。",
      "结果必须像同一张图片的自然编辑版本，不得无故更换主体、重建场景或重构画面。",
      `用户要求：${cleanedPrompt}`,
    ]);
  }

  return joinPromptLines([
    "请生成 1 张高质量图片，严格执行用户要求。",
    "优先落实用户指定的主体、场景、风格、时间、天气、镜头、构图、颜色与材质特征。",
    "确保主体清晰突出，解剖自然，透视正确，光影一致，局部细节真实可信。",
    "除非用户明确要求，否则不得出现可见文字、字母、标志、字幕、边框或水印。",
    `用户要求：${cleanedPrompt}`,
  ]);
}

type DashScopeVideoEditPlan = {
  requiresReferenceRebuild: boolean;
  mustKeep: string[];
  referenceChanges: string[];
  mustAvoid: string[];
  keyframePrompt: string;
  regeneratedKeyframePrompt: string;
  videoPrompt: string;
};

type DashScopeVideoKeyframeVerification = {
  passed: boolean;
  confidence: number;
  missingRequirements: string[];
  correctedKeyframePrompt: string;
};

type DashScopeEditedVideoVerification = {
  passed: boolean;
  confidence: number;
  missingRequirements: string[];
  correctedVideoPrompt: string;
};

function normalizeDashScopePlanStringArray(value: unknown, limit = 8) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, limit);
}

function buildDashScopeFallbackVideoEditPlan(
  videoSummary: string,
  userPrompt: string,
  partial?: Partial<DashScopeVideoEditPlan>,
): DashScopeVideoEditPlan {
  const mustKeep = partial?.mustKeep?.filter(Boolean) ?? [];
  const referenceChanges = partial?.referenceChanges?.filter(Boolean) ?? [];
  const mustAvoid = partial?.mustAvoid?.filter(Boolean) ?? [];
  const requiresReferenceRebuild =
    partial?.requiresReferenceRebuild ?? referenceChanges.length > 0;

  return {
    requiresReferenceRebuild,
    mustKeep,
    referenceChanges,
    mustAvoid,
    keyframePrompt:
      partial?.keyframePrompt?.trim() ||
      [
        "请基于原视频关键帧生成一张适合后续5秒视频重生成的编辑后首帧。",
        "优先保留主体身份、服饰、姿态、构图、镜头角度和空间关系的连续性。",
        "用户明确要求改变的可见视觉属性必须真正改变，不可继续沿用原参考帧。",
        `原视频摘要：${videoSummary}`,
        `编辑要求：${buildDashScopeImagePrompt(userPrompt)}`,
        ...(mustKeep.length > 0
          ? ["必须保留：", ...mustKeep.map((item) => `- ${item}`)]
          : []),
        ...(referenceChanges.length > 0
          ? ["必须落实的可见改动：", ...referenceChanges.map((item) => `- ${item}`)]
          : []),
        ...(mustAvoid.length > 0
          ? ["禁止保留：", ...mustAvoid.map((item) => `- ${item}`)]
          : []),
      ].join("\n"),
    regeneratedKeyframePrompt:
      partial?.regeneratedKeyframePrompt?.trim() ||
      [
        "请直接生成一张适合后续5秒视频重生成的参考首帧。",
        "画面要保留原视频主体身份、服饰、构图和空间关系中的核心特征，同时严格落实用户要求的可见改动。",
        `原视频摘要：${videoSummary}`,
        `编辑要求：${buildDashScopeImagePrompt(userPrompt)}`,
        ...(mustKeep.length > 0
          ? ["必须保留：", ...mustKeep.map((item) => `- ${item}`)]
          : []),
        ...(referenceChanges.length > 0
          ? ["必须落实的可见改动：", ...referenceChanges.map((item) => `- ${item}`)]
          : []),
        ...(mustAvoid.length > 0
          ? ["禁止出现：", ...mustAvoid.map((item) => `- ${item}`)]
          : []),
      ].join("\n"),
    videoPrompt:
      partial?.videoPrompt?.trim() ||
      [
        "基于编辑后的参考首帧生成一个稳定、连贯、真实的5秒短视频。",
        "保持主体清晰、动作自然、镜头稳定，并延续合理的时序。",
        `原视频摘要：${videoSummary}`,
        `编辑要求：${userPrompt.trim()}`,
        ...(mustKeep.length > 0
          ? ["必须保留：", ...mustKeep.map((item) => `- ${item}`)]
          : []),
        ...(referenceChanges.length > 0
          ? ["必须落实的改动：", ...referenceChanges.map((item) => `- ${item}`)]
          : []),
        ...(mustAvoid.length > 0
          ? ["禁止出现：", ...mustAvoid.map((item) => `- ${item}`)]
          : []),
      ].join("\n"),
  };
}

function normalizeDashScopeVideoEditPlan(
  rawText: string,
  videoSummary: string,
  userPrompt: string,
) {
  try {
    const parsed = JSON.parse(extractJsonObjectText(rawText)) as Record<string, unknown>;
    const mustKeep = normalizeDashScopePlanStringArray(parsed.must_keep);
    const referenceChanges = normalizeDashScopePlanStringArray(
      parsed.reference_changes,
    );
    const mustAvoid = normalizeDashScopePlanStringArray(parsed.must_avoid);

    return buildDashScopeFallbackVideoEditPlan(videoSummary, userPrompt, {
      requiresReferenceRebuild:
        typeof parsed.requires_reference_rebuild === "boolean"
          ? parsed.requires_reference_rebuild
          : referenceChanges.length > 0,
      mustKeep,
      referenceChanges,
      mustAvoid,
      keyframePrompt:
        typeof parsed.keyframe_prompt === "string" ? parsed.keyframe_prompt : "",
      regeneratedKeyframePrompt:
        typeof parsed.regenerated_keyframe_prompt === "string"
          ? parsed.regenerated_keyframe_prompt
          : "",
      videoPrompt:
        typeof parsed.video_prompt === "string" ? parsed.video_prompt : "",
    });
  } catch (error) {
    console.warn("[Generate][video-edit] parse structured plan failed:", error);
    return buildDashScopeFallbackVideoEditPlan(videoSummary, userPrompt);
  }
}

async function buildDashScopeVideoEditPlan(
  videoSummary: string,
  userPrompt: string,
): Promise<DashScopeVideoEditPlan> {
  const requestBody = {
    model: "qwen-flash",
    enable_thinking: false,
    temperature: 0.1,
    max_tokens: 800,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "system",
        content: [
          "你是视频编辑规划器，负责把“原视频摘要 + 用户编辑要求”转换成稳定、可执行的结构化编辑计划。",
          "核心原则：优先保留主体身份、叙事连续性、构图逻辑与时序线索；但用户明确要求改变的内容优先级更高，必须真正落地。",
          "请判断用户要求是否会改变参考关键帧中可见的视觉锚点；如果会，requires_reference_rebuild 必须为 true。",
          "可见视觉锚点包括但不限于：时间、天气、季节、光线、背景、场景、室内外、服饰、发型、颜色、风格、构图、镜头角度、道具、主体外观、画幅与视角。",
          "如果用户只要求改变动作节奏、情绪、镜头运动或轻微表演，而不改变参考帧视觉锚点，则 requires_reference_rebuild 可为 false。",
          "reference_changes 只写需要覆盖参考关键帧的可见视觉改动，不要把纯动作变化写进去。",
          "must_keep 只写必须保留的主体、构图、关系、身份特征和核心叙事线索。",
          "must_avoid 只写与用户要求冲突、必须在结果中去除的元素。",
          "keyframe_prompt 必须适合单张关键帧编辑；video_prompt 必须适合基于参考图继续生成 5 秒视频；regenerated_keyframe_prompt 必须适合在原关键帧难以修正时直接重建新的参考首帧。",
          "提示词必须直接、具体、可执行，避免空泛描述、重复要求和与用户需求无关的修饰。",
          "只返回 JSON，不要解释，不要输出 schema 之外的字段。",
          "JSON schema:",
          '{"requires_reference_rebuild":boolean,"must_keep":string[],"reference_changes":string[],"must_avoid":string[],"keyframe_prompt":string,"regenerated_keyframe_prompt":string,"video_prompt":string}',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `原视频摘要：${videoSummary}`,
          `用户编辑要求：${userPrompt.trim()}`,
        ].join("\n"),
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

  const rawText = extractChatMessageText(payload.choices?.[0]?.message?.content).trim();
  if (!rawText) {
    return buildDashScopeFallbackVideoEditPlan(videoSummary, userPrompt);
  }

  return normalizeDashScopeVideoEditPlan(rawText, videoSummary, userPrompt);
}

function buildFallbackDashScopeVideoKeyframeVerification(
  plan: DashScopeVideoEditPlan,
): DashScopeVideoKeyframeVerification {
  return {
    passed: plan.referenceChanges.length === 0,
    confidence: plan.referenceChanges.length === 0 ? 60 : 35,
    missingRequirements: plan.referenceChanges,
    correctedKeyframePrompt: plan.keyframePrompt,
  };
}

function buildFallbackDashScopeEditedVideoVerification(
  plan: DashScopeVideoEditPlan,
): DashScopeEditedVideoVerification {
  return {
    passed: false,
    confidence: 35,
    missingRequirements: plan.referenceChanges,
    correctedVideoPrompt: [
      plan.videoPrompt,
      ...(plan.referenceChanges.length > 0
        ? ["再次强化以下必须可见的改动：", ...plan.referenceChanges.map((item) => `- ${item}`)]
        : []),
      ...(plan.mustAvoid.length > 0
        ? ["严格禁止以下内容继续出现：", ...plan.mustAvoid.map((item) => `- ${item}`)]
        : []),
    ].join("\n"),
  };
}

function normalizeDashScopeVideoKeyframeVerification(
  rawText: string,
  plan: DashScopeVideoEditPlan,
): DashScopeVideoKeyframeVerification {
  try {
    const parsed = JSON.parse(extractJsonObjectText(rawText)) as Record<string, unknown>;
    const missingRequirements = normalizeDashScopePlanStringArray(
      parsed.missing_requirements,
    );

    return {
      passed: typeof parsed.passed === "boolean" ? parsed.passed : false,
      confidence:
        typeof parsed.confidence === "number"
          ? clampPercentage(parsed.confidence, 50)
          : 50,
      missingRequirements,
      correctedKeyframePrompt:
        typeof parsed.corrected_keyframe_prompt === "string" &&
        parsed.corrected_keyframe_prompt.trim()
          ? parsed.corrected_keyframe_prompt.trim()
          : [
              plan.keyframePrompt,
              ...(missingRequirements.length > 0
                ? ["补充修正要求：", ...missingRequirements.map((item) => `- ${item}`)]
                : []),
            ].join("\n"),
    };
  } catch (error) {
    console.warn("[Generate][video-edit] parse keyframe verification failed:", error);
    return buildFallbackDashScopeVideoKeyframeVerification(plan);
  }
}

async function verifyDashScopeVideoEditKeyframe(
  imageUrl: string,
  userPrompt: string,
  plan: DashScopeVideoEditPlan,
): Promise<DashScopeVideoKeyframeVerification> {
  const requestBody = {
    model: "qwen3-vl-flash",
    enable_thinking: false,
    temperature: 0.1,
    max_tokens: 500,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "system",
        content: [
          "你是视频编辑参考关键帧验收器，负责判断给定图片是否已经满足用户要求中必须体现在画面里的视觉改动。",
          "只检查单张图片里肉眼可见的内容，不检查动作、节奏、时长或你无法从静态图确认的信息。",
          "如果图片仍保留了与用户要求冲突的旧视觉属性，或者关键改动不够明显，passed 必须为 false。",
          "missing_requirements 只写仍未满足的可见要求，必须具体到可执行层面。",
          "corrected_keyframe_prompt 必须输出一个更强、更直接、只针对缺失项的关键帧编辑提示词。",
          "如果无法确认某项改动已经清晰落实，应保守判定为未满足。",
          "只返回 JSON，不要解释，不要输出额外字段。",
          'JSON schema: {"passed":boolean,"confidence":number,"missing_requirements":string[],"corrected_keyframe_prompt":string}',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `用户编辑要求：${userPrompt.trim()}`,
              ...(plan.mustKeep.length > 0
                ? ["必须保留：", ...plan.mustKeep.map((item) => `- ${item}`)]
                : []),
              ...(plan.referenceChanges.length > 0
                ? ["必须落实的可见改动：", ...plan.referenceChanges.map((item) => `- ${item}`)]
                : []),
              ...(plan.mustAvoid.length > 0
                ? ["禁止出现：", ...plan.mustAvoid.map((item) => `- ${item}`)]
                : []),
            ].join("\n"),
          },
          {
            type: "image_url",
            image_url: {
              url: imageUrl,
            },
          },
        ],
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

  const rawText = extractChatMessageText(payload.choices?.[0]?.message?.content).trim();
  if (!rawText) {
    return buildFallbackDashScopeVideoKeyframeVerification(plan);
  }

  return normalizeDashScopeVideoKeyframeVerification(rawText, plan);
}

function normalizeDashScopeEditedVideoVerification(
  rawText: string,
  plan: DashScopeVideoEditPlan,
): DashScopeEditedVideoVerification {
  try {
    const parsed = JSON.parse(extractJsonObjectText(rawText)) as Record<string, unknown>;
    const missingRequirements = normalizeDashScopePlanStringArray(
      parsed.missing_requirements,
    );

    return {
      passed: typeof parsed.passed === "boolean" ? parsed.passed : false,
      confidence:
        typeof parsed.confidence === "number"
          ? clampPercentage(parsed.confidence, 50)
          : 50,
      missingRequirements,
      correctedVideoPrompt:
        typeof parsed.corrected_video_prompt === "string" &&
        parsed.corrected_video_prompt.trim()
          ? parsed.corrected_video_prompt.trim()
          : [
              plan.videoPrompt,
              ...(missingRequirements.length > 0
                ? ["补充修正要求：", ...missingRequirements.map((item) => `- ${item}`)]
                : []),
            ].join("\n"),
    };
  } catch (error) {
    console.warn("[Generate][video-edit] parse video verification failed:", error);
    return buildFallbackDashScopeEditedVideoVerification(plan);
  }
}

async function verifyDashScopeEditedVideo(
  videoUrl: string,
  userPrompt: string,
  plan: DashScopeVideoEditPlan,
): Promise<DashScopeEditedVideoVerification> {
  const requestBody = {
    model: "qwen3-omni-flash",
    enable_thinking: false,
    temperature: 0.1,
    max_tokens: 500,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "system",
        content: [
          "你是视频编辑成片验收器，负责判断最终视频是否满足用户要求中必须显性体现的结果。",
          "只检查最终视频里肉眼可见的结果，不检查底层推理过程，也不要臆测不可观察的信息。",
          "如果视频仍保留了与用户要求冲突的视觉属性，或关键改动不够明显，passed 必须为 false。",
          "missing_requirements 只写仍未满足的可见要求，必须具体、可执行。",
          "corrected_video_prompt 必须输出一个更强、更直接、专门用于下一次重试的视频重生成提示词。",
          "如果无法确认关键改动已经稳定呈现，应保守判定为未满足。",
          "只返回 JSON，不要解释，不要输出额外字段。",
          'JSON schema: {"passed":boolean,"confidence":number,"missing_requirements":string[],"corrected_video_prompt":string}',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `用户编辑要求：${userPrompt.trim()}`,
              ...(plan.mustKeep.length > 0
                ? ["必须保留：", ...plan.mustKeep.map((item) => `- ${item}`)]
                : []),
              ...(plan.referenceChanges.length > 0
                ? ["必须落实的改动：", ...plan.referenceChanges.map((item) => `- ${item}`)]
                : []),
              ...(plan.mustAvoid.length > 0
                ? ["禁止出现：", ...plan.mustAvoid.map((item) => `- ${item}`)]
                : []),
            ].join("\n"),
          },
          {
            type: "video",
            video: videoUrl,
          },
        ],
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

  const rawText = extractChatMessageText(payload.choices?.[0]?.message?.content).trim();
  if (!rawText) {
    return buildFallbackDashScopeEditedVideoVerification(plan);
  }

  return normalizeDashScopeEditedVideoVerification(rawText, plan);
}

type DashScopeImageDimensions = {
  width: number;
  height: number;
};

type DashScopeEditedKeyframeCandidateCheck = {
  accepted: boolean;
  verification: DashScopeVideoKeyframeVerification | null;
  rejectionReason: string | null;
  candidateDimensions: DashScopeImageDimensions | null;
};

function readAsciiFromBytes(bytes: Uint8Array, start: number, length: number) {
  return Buffer.from(bytes.subarray(start, start + length)).toString("ascii");
}

function readPngImageDimensions(bytes: Uint8Array): DashScopeImageDimensions | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readGifImageDimensions(bytes: Uint8Array): DashScopeImageDimensions | null {
  if (bytes.length < 10) {
    return null;
  }

  const signature = readAsciiFromBytes(bytes, 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readWebpImageDimensions(bytes: Uint8Array): DashScopeImageDimensions | null {
  if (
    bytes.length < 30 ||
    readAsciiFromBytes(bytes, 0, 4) !== "RIFF" ||
    readAsciiFromBytes(bytes, 8, 4) !== "WEBP"
  ) {
    return null;
  }

  const chunkType = readAsciiFromBytes(bytes, 12, 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (chunkType === "VP8X" && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (chunkType === "VP8 " && bytes.length >= 30) {
    const width = view.getUint16(26, true) & 0x3fff;
    const height = view.getUint16(28, true) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (chunkType === "VP8L" && bytes.length >= 25) {
    const width = 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]);
    const height =
      1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6));
    return width > 0 && height > 0 ? { width, height } : null;
  }

  return null;
}

function readJpegImageDimensions(bytes: Uint8Array): DashScopeImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] != 0xff) {
      offset += 1;
    }

    if (offset + 3 >= bytes.length) {
      break;
    }

    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01) {
      offset += 2;
      continue;
    }

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) {
      break;
    }

    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }

    offset += 2 + segmentLength;
  }

  return null;
}

function readImageDimensionsFromBytes(bytes: Uint8Array): DashScopeImageDimensions | null {
  return (
    readPngImageDimensions(bytes) ||
    readJpegImageDimensions(bytes) ||
    readWebpImageDimensions(bytes) ||
    readGifImageDimensions(bytes)
  );
}

async function readImageDimensionsFromFile(file: File) {
  return readImageDimensionsFromBytes(new Uint8Array(await file.arrayBuffer()));
}

async function readImageDimensionsFromUrl(url: string) {
  if (url.startsWith("data:")) {
    const separatorIndex = url.indexOf(",");
    if (separatorIndex < 0) {
      return null;
    }

    const meta = url.slice(0, separatorIndex);
    const body = url.slice(separatorIndex + 1);
    const buffer = meta.includes(";base64")
      ? Buffer.from(body, "base64")
      : Buffer.from(decodeURIComponent(body), "utf8");
    return readImageDimensionsFromBytes(new Uint8Array(buffer));
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`读取候选关键帧尺寸失败: HTTP ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return readImageDimensionsFromBytes(bytes);
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.max(1, Math.round(Math.abs(left)));
  let b = Math.max(1, Math.round(Math.abs(right)));

  while (b !== 0) {
    const rest = a % b;
    a = b;
    b = rest;
  }

  return a;
}

function describeImageAspectRatio(dimensions: DashScopeImageDimensions) {
  const width = Math.max(1, Math.round(dimensions.width));
  const height = Math.max(1, Math.round(dimensions.height));
  const divisor = greatestCommonDivisor(width, height);
  const ratioWidth = Math.max(1, Math.round(width / divisor));
  const ratioHeight = Math.max(1, Math.round(height / divisor));
  const orientationText = width === height ? "方图" : width > height ? "横版" : "竖版";

  return {
    ratioText: `${ratioWidth}:${ratioHeight}`,
    orientationText,
    sizeText: `${width}×${height}`,
    aspectValue: width / height,
  };
}

function getReplicateVideoAspectRatioFromDimensions(
  dimensions: DashScopeImageDimensions | null,
): ReplicateVideoAspectRatio | null {
  if (!dimensions) {
    return null;
  }

  const aspectValue = Math.max(0.01, dimensions.width) / Math.max(0.01, dimensions.height);
  if (aspectValue >= 1.15) {
    return "16:9";
  }

  if (aspectValue <= 0.87) {
    return "9:16";
  }

  return "1:1";
}

function isAspectRatioPreserved(
  originalDimensions: DashScopeImageDimensions,
  candidateDimensions: DashScopeImageDimensions,
) {
  const originalAspect = originalDimensions.width / originalDimensions.height;
  const candidateAspect = candidateDimensions.width / candidateDimensions.height;
  return (
    Math.abs(candidateAspect - originalAspect) / Math.max(originalAspect, Number.EPSILON) <=
    DASHSCOPE_VIDEO_EDIT_ASPECT_RATIO_TOLERANCE
  );
}

function appendPromptRequirements(prompt: string, requirements: string[]) {
  const normalizedPrompt = prompt.trim();
  const normalizedRequirements = requirements.map((item) => item.trim()).filter(Boolean);
  return [normalizedPrompt, ...normalizedRequirements].filter(Boolean).join("\n");
}

function buildDashScopeAspectRatioLockLines(
  dimensions: DashScopeImageDimensions,
  target: "image" | "video",
) {
  const { ratioText, orientationText, sizeText } = describeImageAspectRatio(dimensions);
  const incompatibleModes =
    orientationText === "横版"
      ? "竖版或方图"
      : orientationText === "竖版"
        ? "横版或方图"
        : "横版或竖版";

  if (target === "image") {
    return [
      `输出图片必须严格保持原关键帧画幅比例：${ratioText}（${orientationText}，约 ${sizeText}）。`,
      `必须继续沿用抽帧关键帧的构图边界与镜头视角，不得改成${incompatibleModes}。`,
      "禁止裁切主体、拉伸变形或随意改动镜头边界。",
    ];
  }

  return [
    `最终视频必须严格保持参考关键帧画幅比例：${ratioText}（${orientationText}）。`,
    `最终视频必须继续基于抽帧关键帧作为参考首帧生成，不得改成${incompatibleModes}。`,
    "禁止裁切主体、拉伸变形或改变原始构图边界。",
  ];
}

function buildDashScopeAspectRatioRetryLine(dimensions: DashScopeImageDimensions) {
  const { ratioText, orientationText } = describeImageAspectRatio(dimensions);
  return `上一张候选图未保持原关键帧比例，这次必须严格输出 ${ratioText} ${orientationText} 画幅，不能变比。`;
}

function buildDashScopeKeyframeAttemptPrompt(
  prompt: string,
  dimensions: DashScopeImageDimensions,
  enforceAspectRetry = false,
) {
  return appendPromptRequirements(prompt, [
    ...buildDashScopeAspectRatioLockLines(dimensions, "image"),
    ...(enforceAspectRetry ? [buildDashScopeAspectRatioRetryLine(dimensions)] : []),
    "本次编辑必须仍然基于抽帧关键帧继续修改，不能脱离该关键帧重新构图。",
  ]);
}

function buildDashScopeVideoAttemptPrompt(prompt: string, dimensions: DashScopeImageDimensions) {
  return appendPromptRequirements(prompt, buildDashScopeAspectRatioLockLines(dimensions, "video"));
}

async function validateDashScopeEditedKeyframeCandidate(input: {
  candidateUrl: string;
  originalDimensions: DashScopeImageDimensions;
  prompt: string;
  plan: DashScopeVideoEditPlan;
}): Promise<DashScopeEditedKeyframeCandidateCheck> {
  try {
    const candidateDimensions = await readImageDimensionsFromUrl(input.candidateUrl);
    if (!candidateDimensions) {
      return {
        accepted: false,
        verification: null,
        rejectionReason: "无法解析候选关键帧尺寸。",
        candidateDimensions: null,
      };
    }

    if (!isAspectRatioPreserved(input.originalDimensions, candidateDimensions)) {
      const originalAspect = describeImageAspectRatio(input.originalDimensions);
      const candidateAspect = describeImageAspectRatio(candidateDimensions);
      return {
        accepted: false,
        verification: null,
        rejectionReason:
          `候选关键帧画幅比例变更为 ${candidateAspect.ratioText}（${candidateAspect.orientationText}，${candidateAspect.sizeText}），` +
          `原关键帧为 ${originalAspect.ratioText}（${originalAspect.orientationText}，${originalAspect.sizeText}）。`,
        candidateDimensions,
      };
    }

    const verification = await verifyDashScopeVideoEditKeyframe(
      input.candidateUrl,
      input.prompt,
      input.plan,
    );

    return {
      accepted: true,
      verification,
      rejectionReason: null,
      candidateDimensions,
    };
  } catch (error) {
    return {
      accepted: false,
      verification: null,
      rejectionReason: error instanceof Error ? error.message : "候选关键帧校验失败。",
      candidateDimensions: null,
    };
  }
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

async function editImageWithDashScopeBaseImage(
  modelId: string,
  prompt: string,
  baseImageUrl: string,
) {
  const payload = await createDashScopeAsyncTask(
    "/api/v1/services/aigc/image2image/image-synthesis",
    {
      model: modelId,
      input: {
        function: "description_edit",
        prompt: buildDashScopeImagePrompt(prompt, "editing"),
        base_image_url: baseImageUrl,
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

async function editImageWithDashScope(modelId: string, prompt: string, file: File) {
  return editImageWithDashScopeBaseImage(modelId, prompt, await fileToDataUrl(file));
}

function buildReplicateImageEditPrompt(userPrompt: string) {
  const cleanedPrompt = userPrompt.replace(/\s+/g, " ").trim();
  return joinPromptLines([
    "Edit the uploaded image strictly according to the user's request.",
    "Preserve subject identity, aspect ratio, composition, camera perspective, spatial layout, and untouched regions unless the user explicitly asks to change them.",
    "Only modify what the user explicitly mentions. Do not add, remove, restyle, or replace unrelated elements.",
    "The result should look like a natural edit of the same image, not a new image with a different subject or scene.",
    `User request: ${cleanedPrompt}`,
    "If the request is in Chinese, understand and execute it correctly.",
  ]);
}

function buildReplicateImageEditInputs(modelId: string, promptForModel: string, imageUrl: string) {
  if (modelId === "espressotechie/qwen-imgedit-4bit") {
    const primaryInput: Record<string, unknown> = {
      image: imageUrl,
      prompt: promptForModel,
      steps: REPLICATE_QWEN_IMAGE_EDIT_STEPS,
      output_format: REPLICATE_QWEN_IMAGE_EDIT_OUTPUT_FORMAT,
    };
    if (REPLICATE_QWEN_IMAGE_EDIT_OUTPUT_FORMAT !== "png") {
      primaryInput.output_quality = REPLICATE_QWEN_IMAGE_EDIT_OUTPUT_QUALITY;
    }

    return {
      primaryInput,
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
  locale?: PromptLocale;
}) {
  const locale = input.locale ?? getRuntimeLocale();
  const uploaded = await uploadInputFileForEditing(
    input.db,
    input.requestId,
    "image-edit",
    input.file,
    locale,
  );
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

    console.warn(
      locale === "zh"
        ? `[Generate][${input.requestId}] Replicate 图片编辑参数不兼容，自动降级为最小输入重试`
        : `[Generate][${input.requestId}] Replicate image editing input is incompatible; retrying with fallback input`,
    );
    payload = await createReplicatePrediction(input.requestId, input.modelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "succeeded") {
    return payload;
  }
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(
      locale === "zh"
        ? `Replicate 图片编辑失败${detail ? `: ${detail}` : ""}`
        : `Replicate image editing failed${detail ? `: ${detail}` : ""}`,
    );
  }
  if (!payload.id) {
    throw new Error(
      locale === "zh"
        ? "Replicate 返回结果缺少 prediction id。"
        : "Replicate response is missing a prediction id.",
    );
  }

  return waitForReplicatePredictionResult(
    payload.id,
    REPLICATE_IMAGE_TASK_TIMEOUT_MS,
    locale === "zh"
      ? `Replicate 图片编辑超时，请稍后重试。prediction_id: ${payload.id}`
      : `Replicate image editing timed out. Please try again later. prediction_id: ${payload.id}`,
  );
}

function buildDashScopeVideoPrompt(
  prompt: string,
  plan?: Pick<DashScopeVideoEditPlan, "mustKeep" | "referenceChanges" | "mustAvoid">,
) {
  return joinPromptLines([
    "根据用户要求生成 1 条简洁、稳定、连贯的短视频。",
    "保持主体清晰、身份稳定、动作自然、镜头稳定、时序连贯、物理合理。",
    "用户明确要求改变的内容优先级高于参考图中的原始属性，必须真正体现在结果中。",
    ...(plan
      ? ["必须保持与参考关键帧一致的画幅比例、构图边界和镜头视角，不裁切、不拉伸、不随意切换画幅。"]
      : []),
    ...(plan?.mustKeep?.length
      ? ["必须保留：", ...plan.mustKeep.map((item) => `- ${item}`)]
      : []),
    ...(plan?.referenceChanges?.length
      ? ["必须落实的可见改动：", ...plan.referenceChanges.map((item) => `- ${item}`)]
      : []),
    ...(plan?.mustAvoid?.length
      ? ["禁止出现：", ...plan.mustAvoid.map((item) => `- ${item}`)]
      : []),
    "除非用户明确要求，否则不要加入文字、logo、水印、无关主体或无关场景变化。",
    `用户要求：${prompt.trim()}`,
  ]);
}

async function requestDashScopePlainTextWithFallback(
  modelIds: readonly string[],
  buildRequestBody: (modelId: string) => Record<string, unknown>,
  errorMessage: string,
) {
  let lastError: unknown = null;

  for (const modelId of modelIds) {
    try {
      const payload = await requestDashScopeChatCompletion(buildRequestBody(modelId));
      const text = extractChatMessageText(payload.choices?.[0]?.message?.content).trim();
      if (text) {
        return text;
      }
      lastError = new Error(`${errorMessage}（模型 ${modelId} 未返回文本）`);
    } catch (error) {
      lastError = error;
      const statusCode = getErrorStatusCode(error);
      if (statusCode !== 400 && statusCode !== 404 && statusCode !== 422) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error(errorMessage);
}

async function summarizeDashScopeVideoFrames(frameFiles: File[]) {
  const limitedFrames = frameFiles.slice(0, DASHSCOPE_VIDEO_EDIT_FRAME_COUNT);
  const content = [
    {
      type: "text",
      text: [
        "你将收到同一条视频的多个关键帧。",
        "请提炼跨帧稳定的核心信息：主体身份、场景环境、关键动作、镜头语言、视觉风格和整体氛围。",
        "如果存在轻微机位变化或转场，请总结主线内容，不要逐帧罗列。",
        "只返回一段中文摘要，不超过120字。",
      ].join("\n"),
    },
    ...(await Promise.all(
      limitedFrames.map(async (file) => ({
        type: "image_url",
        image_url: {
          url: await fileToDataUrl(file),
        },
      })),
    )),
  ];

  return truncateText(
    await requestDashScopePlainTextWithFallback(
      ["qwen3-vl-flash"],
      (modelId) => ({
        model: modelId,
        enable_thinking: false,
        temperature: 0.1,
        max_tokens: 256,
        messages: [
          {
            role: "system",
            content:
              "你是视频编辑前处理助手。任务是从多帧画面中提炼后续重生成必须保留的主体身份、场景要点、构图特征、时序线索与稳定视觉锚点。只输出简洁摘要，不要解释，不要臆测看不到的信息。",
          },
          {
            role: "user",
            content,
          },
        ],
      }),
      "视频关键帧分析失败。",
    ),
    240,
  );
}

async function createDashScopeVideoTask(
  modelId: string,
  prompt: string,
  imageUrl: string,
  plan?: Pick<DashScopeVideoEditPlan, "mustKeep" | "referenceChanges" | "mustAvoid">,
) {
  const promptText = buildDashScopeVideoPrompt(prompt, plan);
  const inputCandidates: Record<string, unknown>[] = [
    {
      prompt: promptText,
      img_url: imageUrl,
    },
    {
      prompt: promptText,
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

async function waitForCompletedDashScopeVideoTask(
  payload: DashScopeTaskPayload,
  failureLabel: string,
  timeoutLabel: string,
) {
  const status = getDashScopeTaskStatus(payload);
  if (status === "SUCCEEDED") {
    return payload;
  }

  if (status === "FAILED" || status === "CANCELED") {
    const detail = extractDashScopeErrorText(payload);
    throw new Error(`${failureLabel}${detail ? `: ${detail}` : ""}`);
  }

  const taskId = getDashScopeTaskId(payload);
  if (!taskId) {
    throw new Error(`${failureLabel}，且未返回 task_id。`);
  }

  return waitForDashScopeTaskResult(taskId, DASHSCOPE_VIDEO_TASK_TIMEOUT_MS, timeoutLabel);
}

async function editVideoWithDashScope(
  requestId: string,
  modelId: string,
  prompt: string,
  keyframeFile: File,
  frameFiles: File[],
) {
  const effectiveFrameFiles =
    frameFiles.length > 0 ? frameFiles.slice(0, DASHSCOPE_VIDEO_EDIT_FRAME_COUNT) : [keyframeFile];
  const videoSummary = await summarizeDashScopeVideoFrames(effectiveFrameFiles);
  const editPlan = await buildDashScopeVideoEditPlan(videoSummary, prompt);
  const finalPrompt = editPlan.videoPrompt || prompt;
  const originalKeyframeDataUrl = await fileToDataUrl(keyframeFile);
  const originalKeyframeDimensions = await readImageDimensionsFromFile(keyframeFile);
  if (!originalKeyframeDimensions) {
    throw new Error("无法解析关键帧尺寸，请重新上传视频后重试。");
  }

  const originalAspect = describeImageAspectRatio(originalKeyframeDimensions);
  let videoInputImageUrl = originalKeyframeDataUrl;
  let usedEditedKeyframe = false;
  let strongestVideoPrompt = finalPrompt;
  let lastKeyframeVerification: DashScopeVideoKeyframeVerification | null = null;
  let requireAspectRetry = false;

  try {
    let keyframePrompt = editPlan.keyframePrompt;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const editedKeyframePayload = await editImageWithDashScopeBaseImage(
        "wanx2.1-imageedit",
        buildDashScopeKeyframeAttemptPrompt(
          keyframePrompt,
          originalKeyframeDimensions,
          requireAspectRetry,
        ),
        originalKeyframeDataUrl,
      );
      const editedKeyframeUrl = extractReplicateOutputUrls(editedKeyframePayload.output)[0];
      if (!editedKeyframeUrl) {
        console.warn(
          `[Generate][${requestId}][DashScope][video-edit] 关键帧预编辑未返回可用图片，回退原始关键帧`,
        );
        break;
      }

      const candidateCheck = await validateDashScopeEditedKeyframeCandidate({
        candidateUrl: editedKeyframeUrl,
        originalDimensions: originalKeyframeDimensions,
        prompt,
        plan: editPlan,
      });
      if (!candidateCheck.accepted || !candidateCheck.verification) {
        requireAspectRetry = true;
        console.warn(
          `[Generate][${requestId}][DashScope][video-edit] 候选关键帧未通过比例校验，将保持 ${originalAspect.ratioText} ${originalAspect.orientationText} 重试`,
          candidateCheck.rejectionReason,
        );
        continue;
      }

      requireAspectRetry = false;
      videoInputImageUrl = editedKeyframeUrl;
      usedEditedKeyframe = true;

      const verification = candidateCheck.verification;
      lastKeyframeVerification = verification;
      if (verification.passed || verification.missingRequirements.length === 0) {
        break;
      }

      keyframePrompt = verification.correctedKeyframePrompt;

      if (attempt === 1) {
        console.warn(
          `[Generate][${requestId}][DashScope][video-edit] 关键帧二次修正后仍未完全满足要求，将使用最优候选继续生成`,
          verification.missingRequirements,
        );
      }
    }

    if (
      editPlan.referenceChanges.length > 0 &&
      (!lastKeyframeVerification || !lastKeyframeVerification.passed)
    ) {
      const regeneratedKeyframePayload = await editImageWithDashScopeBaseImage(
        "wanx2.1-imageedit",
        buildDashScopeKeyframeAttemptPrompt(
          editPlan.regeneratedKeyframePrompt,
          originalKeyframeDimensions,
          true,
        ),
        originalKeyframeDataUrl,
      );
      const regeneratedKeyframeUrl = extractReplicateOutputUrls(
        regeneratedKeyframePayload.output,
      )[0];
      if (regeneratedKeyframeUrl) {
        const regeneratedCandidateCheck = await validateDashScopeEditedKeyframeCandidate({
          candidateUrl: regeneratedKeyframeUrl,
          originalDimensions: originalKeyframeDimensions,
          prompt,
          plan: editPlan,
        });
        if (regeneratedCandidateCheck.accepted && regeneratedCandidateCheck.verification) {
          lastKeyframeVerification = regeneratedCandidateCheck.verification;
          videoInputImageUrl = regeneratedKeyframeUrl;
          usedEditedKeyframe = true;
        } else {
          console.warn(
            `[Generate][${requestId}][DashScope][video-edit] 强化关键帧仍未通过比例校验，将保留当前参考图`,
            regeneratedCandidateCheck.rejectionReason,
          );
        }
      }
    }
  } catch (error) {
    console.warn(
      `[Generate][${requestId}][DashScope][video-edit] 关键帧预编辑或验收失败，回退原始关键帧`,
      error,
    );
    videoInputImageUrl = originalKeyframeDataUrl;
    usedEditedKeyframe = false;
  }

  console.log(
    `[Generate][${requestId}][DashScope][video-edit] 基于 ${effectiveFrameFiles.length} 帧生成结构化编辑计划，并以抽帧关键帧 + 提示词继续生成视频，目标画幅 ${originalAspect.ratioText} ${originalAspect.orientationText}${usedEditedKeyframe ? '，已接受比例校验通过的关键帧预编辑' : '，沿用原始关键帧作为参考图'}`,
  );

  const runVideoAttempt = async (videoPrompt: string) => {
    const createdPayload = await createDashScopeVideoTask(
      modelId,
      buildDashScopeVideoAttemptPrompt(videoPrompt, originalKeyframeDimensions),
      videoInputImageUrl,
      editPlan,
    );

    return waitForCompletedDashScopeVideoTask(
      createdPayload,
      "阿里云百炼视频编辑失败",
      `阿里云百炼视频编辑超时，请稍后重试。request_id: ${requestId}`,
    );
  };

  let payload = await runVideoAttempt(strongestVideoPrompt);

  let videoUrls = extractReplicateOutputUrls(payload.output).slice(0, DEFAULT_VIDEO_OUTPUT_COUNT);
  if (videoUrls.length > 0) {
    try {
      const verification = await verifyDashScopeEditedVideo(
        videoUrls[0],
        prompt,
        editPlan,
      );
      if (!verification.passed && verification.missingRequirements.length > 0) {
        strongestVideoPrompt = verification.correctedVideoPrompt;
        payload = await runVideoAttempt(strongestVideoPrompt);
        videoUrls = extractReplicateOutputUrls(payload.output).slice(
          0,
          DEFAULT_VIDEO_OUTPUT_COUNT,
        );
      }
    } catch (error) {
      console.warn(
        `[Generate][${requestId}][DashScope][video-edit] 成片验收失败，保留当前生成结果`,
        error,
      );
    }
  }

  return payload;
}

function buildReplicateVideoEditPrompt(
  userPrompt: string,
  options?: {
    useReferenceKeyframe?: boolean;
    referenceFrameCount?: number;
  },
) {
  const cleanedPrompt = userPrompt.replace(/\s+/g, " ").trim();
  return cleanedPrompt;
}

function buildReplicateVideoEditInputs(input: {
  modelId: string;
  promptForModel: string;
  videoUrl: string | null;
  keyframeUrl?: string | null;
  aspectRatio?: ReplicateVideoAspectRatio | null;
  locale?: PromptLocale;
}) {
  const locale = input.locale ?? getRuntimeLocale();
  const { modelId, promptForModel, videoUrl, keyframeUrl, aspectRatio } = input;

  if (modelId === "lightricks/ltx-video-0.9.7-distilled") {
    const primaryInput: Record<string, unknown> = {
      prompt: promptForModel,
      resolution: REPLICATE_LTX_VIDEO_EDIT_RESOLUTION,
      go_fast: true,
      num_frames: REPLICATE_LTX_VIDEO_EDIT_NUM_FRAMES,
      fps: REPLICATE_LTX_VIDEO_EDIT_FPS,
      denoise_strength: REPLICATE_LTX_VIDEO_EDIT_DENOISE_STRENGTH,
      num_inference_steps: REPLICATE_LTX_VIDEO_EDIT_NUM_INFERENCE_STEPS,
      final_inference_steps: REPLICATE_LTX_VIDEO_EDIT_FINAL_INFERENCE_STEPS,
      guidance_scale: REPLICATE_LTX_VIDEO_EDIT_GUIDANCE_SCALE,
      downscale_factor: REPLICATE_LTX_VIDEO_EDIT_DOWNSCALE_FACTOR,
      negative_prompt: REPLICATE_LTX_VIDEO_EDIT_NEGATIVE_PROMPT,
    };

    const fallbackInput: Record<string, unknown> = {
      prompt: promptForModel,
      resolution: REPLICATE_LTX_VIDEO_EDIT_RESOLUTION,
    };

    if (keyframeUrl) {
      primaryInput.image = keyframeUrl;
      primaryInput.aspect_ratio = "match_input_image";

      if (videoUrl) {
        fallbackInput.video = videoUrl;
        fallbackInput.conditioning_frames = REPLICATE_LTX_VIDEO_EDIT_CONDITIONING_FRAMES;
        if (aspectRatio) {
          fallbackInput.aspect_ratio = aspectRatio;
        }
      } else {
        fallbackInput.image = keyframeUrl;
        fallbackInput.aspect_ratio = "match_input_image";
      }

      return {
        primaryInput,
        fallbackInput,
        usesReferenceKeyframe: true,
      };
    }

    if (!videoUrl) {
      throw new Error(
        locale === "zh"
          ? "Replicate 视频编辑缺少可用的视频或关键帧输入。"
          : "Replicate video editing is missing a usable video or keyframe input.",
      );
    }

    primaryInput.video = videoUrl;
    primaryInput.conditioning_frames = REPLICATE_LTX_VIDEO_EDIT_CONDITIONING_FRAMES;
    fallbackInput.video = videoUrl;

    if (aspectRatio) {
      primaryInput.aspect_ratio = aspectRatio;
      fallbackInput.aspect_ratio = aspectRatio;
    }

    return {
      primaryInput,
      fallbackInput,
      usesReferenceKeyframe: false,
    };
  }

  if (keyframeUrl) {
    return {
      primaryInput: {
        prompt: promptForModel,
        image: keyframeUrl,
      },
      fallbackInput: videoUrl
        ? {
            prompt: promptForModel,
            video: videoUrl,
          }
        : {
            prompt: promptForModel,
            image: keyframeUrl,
          },
      usesReferenceKeyframe: true,
    };
  }

  if (!videoUrl) {
    throw new Error(
      locale === "zh"
        ? "Replicate 视频编辑缺少可用的视频输入。"
        : "Replicate video editing is missing a usable video input.",
    );
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
    usesReferenceKeyframe: false,
  };
}

async function editVideoWithReplicate(input: {
  requestId: string;
  modelId: string;
  prompt: string;
  file: File;
  keyframeFile: File | null;
  frameFiles: File[];
  db: NonNullable<Awaited<ReturnType<typeof getRoutedRuntimeDbClient>>>;
  locale?: PromptLocale;
}) {
  // 添加 2 秒延迟以避免触发 Replicate 速率限制（每秒 3000 次请求）
  await waitFor(2000);

  const locale = input.locale ?? getRuntimeLocale();
  const referenceKeyframeFile =
    input.keyframeFile ?? input.frameFiles[Math.min(1, input.frameFiles.length - 1)] ?? input.frameFiles[0] ?? null;

  let keyframeUrl: string | null = null;
  let aspectRatio: ReplicateVideoAspectRatio | null = null;

  if (referenceKeyframeFile instanceof File) {
    try {
      const uploadedKeyframe = await uploadInputFileForEditing(
        input.db,
        input.requestId,
        "video-edit-keyframe",
        referenceKeyframeFile,
        locale,
      );
      keyframeUrl = uploadedKeyframe.publicUrl;
      aspectRatio = getReplicateVideoAspectRatioFromDimensions(
        await readImageDimensionsFromFile(referenceKeyframeFile),
      );
    } catch (error) {
      console.warn(
        locale === "zh"
          ? `[Generate][${input.requestId}][Replicate][video-edit] 关键帧准备失败，回退为原视频直编`
          : `[Generate][${input.requestId}][Replicate][video-edit] Keyframe preparation failed; falling back to direct video editing`,
        error,
      );
    }
  }

  let uploadedVideo = keyframeUrl
    ? null
    : await uploadInputFileForEditing(input.db, input.requestId, "video-edit", input.file, locale);

  const ensureUploadedVideo = async () => {
    if (uploadedVideo) {
      return uploadedVideo;
    }

    uploadedVideo = await uploadInputFileForEditing(input.db, input.requestId, "video-edit", input.file, locale);
    return uploadedVideo;
  };

  const promptForModel = buildReplicateVideoEditPrompt(input.prompt, {
    useReferenceKeyframe: Boolean(keyframeUrl),
    referenceFrameCount: input.frameFiles.length,
  });
  let { primaryInput, fallbackInput, usesReferenceKeyframe } = buildReplicateVideoEditInputs({
    modelId: input.modelId,
    promptForModel,
    videoUrl: uploadedVideo?.publicUrl ?? null,
    keyframeUrl,
    aspectRatio,
    locale,
  });

  console.log(
    locale === "zh"
      ? `[Generate][${input.requestId}][Replicate][video-edit] ${usesReferenceKeyframe ? `已切换为抽帧关键帧重生成，参考帧数 ${Math.max(1, input.frameFiles.length)}` : "未拿到关键帧，回退为原视频直编"}`
      : `[Generate][${input.requestId}][Replicate][video-edit] ${usesReferenceKeyframe ? `Switched to extracted-keyframe regeneration with ${Math.max(1, input.frameFiles.length)} reference frame(s)` : "No usable keyframe found; falling back to direct video editing"}`,
  );

  let payload: ReplicatePredictionPayload;
  try {
    payload = await createReplicatePrediction(input.requestId, input.modelId, primaryInput);
  } catch (error) {
    if (getErrorStatusCode(error) !== 422) {
      throw error;
    }

    console.warn(
      locale === "zh"
        ? `[Generate][${input.requestId}] Replicate 视频编辑参数不兼容，自动降级为最小输入重试`
        : `[Generate][${input.requestId}] Replicate video editing input is incompatible; retrying with fallback input`,
    );

    if (usesReferenceKeyframe && !Object.prototype.hasOwnProperty.call(fallbackInput, "video")) {
      const fallbackVideo = await ensureUploadedVideo();
      const fallbackPromptForModel = buildReplicateVideoEditPrompt(input.prompt, {
        useReferenceKeyframe: false,
        referenceFrameCount: input.frameFiles.length,
      });

      ({ primaryInput, fallbackInput, usesReferenceKeyframe } = buildReplicateVideoEditInputs({
        modelId: input.modelId,
        promptForModel: fallbackPromptForModel,
        videoUrl: fallbackVideo.publicUrl,
        keyframeUrl: null,
        aspectRatio,
        locale,
      }));

      console.warn(
        locale === "zh"
          ? `[Generate][${input.requestId}][Replicate][video-edit] 抽帧关键帧方案不兼容，已自动回退为原视频直编`
          : `[Generate][${input.requestId}][Replicate][video-edit] Extracted-keyframe mode is incompatible; falling back to direct video editing`,
      );
    }

    payload = await createReplicatePrediction(input.requestId, input.modelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "succeeded") {
    return {
      payload,
      usesReferenceKeyframe,
    };
  }
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(
      locale === "zh"
        ? `Replicate 视频编辑失败${detail ? `: ${detail}` : ""}`
        : `Replicate video editing failed${detail ? `: ${detail}` : ""}`,
    );
  }
  if (!payload.id) {
    throw new Error(
      locale === "zh"
        ? "Replicate 返回结果缺少 prediction id。"
        : "Replicate response is missing a prediction id.",
    );
  }

  return {
    payload: await waitForReplicatePredictionResult(
      payload.id,
      getReplicateVideoTaskTimeoutMs(input.modelId),
      buildReplicateVideoEditingTimeoutMessage(input.modelId, payload.id, locale),
    ),
    usesReferenceKeyframe,
  };
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
    rewriteModelId: "openai/gpt-5-nano",
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
  locale: PromptLocale = getRuntimeLocale(),
) {
  if (db.backend === "supabase") {
    if (!supabaseAdmin) {
      throw new Error(
        locale === "zh"
          ? "服务端缺少 Supabase 配置，无法生成编辑源文件签名地址。"
          : "Supabase server configuration is missing, so a signed URL cannot be generated for the editing input.",
      );
    }

    const { data, error } = await supabaseAdmin.storage
      .from(bucketName)
      .createSignedUrl(objectPath, GENERATED_INPUT_SIGNED_URL_TTL_SECONDS);
    if (error) {
      throw new Error(
        locale === "zh"
          ? `生成编辑源文件签名地址失败: ${error.message}`
          : `Failed to create a signed URL for the editing input file: ${error.message}`,
      );
    }

    const signedUrl = typeof data?.signedUrl === "string" ? data.signedUrl.trim() : "";
    if (!signedUrl) {
      throw new Error(
        locale === "zh"
          ? "编辑源文件上传成功但未获取到签名地址。"
          : "The editing source file was uploaded successfully, but no signed URL was returned.",
      );
    }

    return signedUrl;
  }

  const { data, error } = await db.storage.from(bucketName).getPublicUrl(objectPath);
  if (error) {
    throw new Error(
      locale === "zh"
        ? `读取编辑源文件地址失败: ${error.message}`
        : `Failed to read the editing source file URL: ${error.message}`,
    );
  }

  const publicUrl = typeof data?.publicUrl === "string" ? data.publicUrl.trim() : "";
  if (!publicUrl) {
    throw new Error(
      locale === "zh"
        ? "编辑源文件上传成功但未获取到可访问地址。"
        : "The editing source file was uploaded successfully, but no accessible URL was returned.",
    );
  }

  return publicUrl;
}

async function uploadInputFileForEditing(
  db: NonNullable<Awaited<ReturnType<typeof getRoutedRuntimeDbClient>>>,
  requestId: string,
  folder: string,
  file: File,
  locale: PromptLocale = getRuntimeLocale(),
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
    throw new Error(
      locale === "zh"
        ? `上传编辑源文件失败: ${uploadResult.error.message}`
        : `Failed to upload the editing source file: ${uploadResult.error.message}`,
    );
  }

  return {
    objectPath,
    publicUrl: await getUploadedInputFileUrl(db, GENERATED_INPUT_BUCKET, objectPath, locale),
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
        content: [
          "你是口播音频编辑助手。请严格按照用户要求改写转写稿。",
          "必须保留原转写稿的核心含义、关键信息、专有名词和事实内容，除非用户明确要求删除或改写。",
          "只修改用户明确提到的部分，不要擅自添加、删除、总结、弱化或改变其他内容。",
          "输出必须是可直接朗读的最终文案，自然、顺口、简洁，不要添加解释或说明。",
        ].join("\n"),
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
  locale: PromptLocale = getRuntimeLocale(),
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

    console.warn(
      locale === "zh"
        ? `[Generate][${requestId}] Replicate 音频转写参数不兼容，自动降级为最小输入重试`
        : `[Generate][${requestId}] Replicate audio transcription input is incompatible; retrying with fallback input`,
    );
    payload = await createReplicatePrediction(requestId, modelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(
      locale === "zh"
        ? `Replicate 音频转写失败${detail ? `: ${detail}` : ""}`
        : `Replicate audio transcription failed${detail ? `: ${detail}` : ""}`,
    );
  }

  const finalPayload =
    status === "succeeded"
      ? payload
      : await (() => {
          if (!payload.id) {
            throw new Error(
              locale === "zh"
                ? "Replicate 返回结果缺少 prediction id。"
                : "Replicate response is missing a prediction id.",
            );
          }

          return waitForReplicatePredictionResult(
            payload.id,
            REPLICATE_AUDIO_TASK_TIMEOUT_MS,
            locale === "zh"
              ? `Replicate 音频转写超时，请稍后重试。prediction_id: ${payload.id}`
              : `Replicate audio transcription timed out. Please try again later. prediction_id: ${payload.id}`,
          );
        })();

  const transcriptionText = extractReplicateTranscriptionText(finalPayload.output);
  if (!transcriptionText) {
    throw new Error(
      locale === "zh"
        ? "Replicate 音频转写结果为空。"
        : "Replicate audio transcription returned empty text.",
    );
  }

  return transcriptionText;
}

function buildReplicateAudioEditingPrompt(instruction: string, transcript: string) {
  return joinPromptLines([
    "You are an audio script editor. Apply ONLY the exact changes requested.",
    "CRITICAL RULES:",
    "1. Make MINIMAL modifications - only change what is explicitly mentioned",
    "2. PRESERVE the original length - do NOT add, expand, or generate new content",
    "3. If instruction says 'change X to Y', ONLY replace X with Y, keep everything else identical",
    "4. Output ONLY the modified transcript, no explanations or markdown",
    "",
    "Editing requirements:",
    instruction,
    "",
    "Original transcript:",
    truncateText(transcript, DOCUMENT_EDIT_SOURCE_MAX_CHARS),
  ]);
}

async function rewriteAudioTranscriptWithReplicate(input: {
  requestId: string;
  instruction: string;
  transcript: string;
  modelId: string;
  locale?: PromptLocale;
}) {
  const locale = input.locale ?? getRuntimeLocale();
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

    console.warn(
      locale === "zh"
        ? `[Generate][${input.requestId}] Replicate 音频改写参数不兼容，自动降级为最小输入重试`
        : `[Generate][${input.requestId}] Replicate audio rewrite input is incompatible; retrying with fallback input`,
    );
    payload = await createReplicatePrediction(input.requestId, normalizedModelId, fallbackInput);
  }

  const status = (payload.status ?? "").toLowerCase();
  if (status === "failed" || status === "canceled") {
    const detail = extractReplicateErrorText(payload.error);
    throw new Error(
      locale === "zh"
        ? `Replicate 音频改写失败${detail ? `: ${detail}` : ""}`
        : `Replicate audio rewrite failed${detail ? `: ${detail}` : ""}`,
    );
  }

  const finalPayload =
    status === "succeeded"
      ? payload
      : await (() => {
          if (!payload.id) {
            throw new Error(
              locale === "zh"
                ? "Replicate 返回结果缺少 prediction id。"
                : "Replicate response is missing a prediction id.",
            );
          }

          return waitForReplicatePredictionResult(
            payload.id,
            REPLICATE_TEXT_TASK_TIMEOUT_MS,
            locale === "zh"
              ? `Replicate 音频改写超时，请稍后重试。prediction_id: ${payload.id}`
              : `Replicate audio rewrite timed out. Please try again later. prediction_id: ${payload.id}`,
          );
        })();

  const rewrittenText = extractReplicateTextOutput(finalPayload.output).trim();
  if (!rewrittenText) {
    throw new Error(
      locale === "zh"
        ? "音频编辑文案改写失败，未返回有效文本。"
        : "Audio script rewriting returned no usable text.",
    );
  }

  return rewrittenText;
}

async function editAudioWithReplicate(input: {
  requestId: string;
  modelId: string;
  prompt: string;
  file: File;
  db: NonNullable<Awaited<ReturnType<typeof getRoutedRuntimeDbClient>>>;
  locale?: PromptLocale;
}) {
  const locale = input.locale ?? getRuntimeLocale();
  const pipeline = getReplicateAudioEditingPipelineModelIds(input.modelId);
  const uploaded = await uploadInputFileForEditing(
    input.db,
    input.requestId,
    "audio-edit",
    input.file,
    locale,
  );
  const transcript = await transcribeAudioWithReplicate(
    input.requestId,
    pipeline.transcriptionModelId,
    uploaded.publicUrl,
    locale,
  );
  const rewrittenScript = await rewriteAudioTranscriptWithReplicate({
    requestId: input.requestId,
    instruction: input.prompt,
    transcript,
    modelId: pipeline.rewriteModelId,
    locale,
  });
  const synthesized = await generateAudioWithReplicate(
    input.requestId,
    pipeline.synthesisModelId,
    rewrittenScript,
    locale,
  );
  const audioUrls = extractReplicateOutputUrls(synthesized.output).slice(
    0,
    DEFAULT_AUDIO_OUTPUT_COUNT,
  );
  if (audioUrls.length === 0) {
    throw new Error(
      locale === "zh"
        ? "Replicate 音频重配未返回可用音频链接，请稍后重试。"
        : "Replicate audio remix did not return any usable audio URL. Please try again later.",
    );
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

type RemoteGeneratedMediaKind = "image" | "audio" | "video";

type StoredRemoteGeneratedMedia = {
  fileName: string;
  previewUrl: string;
  downloadUrl: string;
};

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
const IMAGE_MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};
const AUDIO_FILE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/m4a": "m4a",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/x-wav": "wav",
};
const AUDIO_MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};
const VIDEO_FILE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
};
const VIDEO_MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  avi: "video/x-msvideo",
  m4v: "video/x-m4v",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp4: "video/mp4",
  webm: "video/webm",
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

function getAudioFileExtension(mimeType: string, fallbackUrl: string) {
  const normalizedMimeType = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    AUDIO_FILE_EXTENSION_BY_MIME_TYPE[normalizedMimeType] ??
    getFileExtensionFromUrl(fallbackUrl) ??
    getAudioFileExtensionFromMimeType(normalizedMimeType)
  );
}

function getVideoFileExtension(mimeType: string, fallbackUrl: string) {
  const normalizedMimeType = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    VIDEO_FILE_EXTENSION_BY_MIME_TYPE[normalizedMimeType] ??
    getFileExtensionFromUrl(fallbackUrl) ??
    "mp4"
  );
}

function resolveRemoteGeneratedMediaMimeType(
  kind: RemoteGeneratedMediaKind,
  mimeType: string,
  fallbackUrl: string,
) {
  const normalizedMimeType = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalizedMimeType.startsWith(`${kind}/`)) {
    return normalizedMimeType;
  }

  const extension = getFileExtensionFromUrl(fallbackUrl) ?? "";
  if (kind === "image") {
    return IMAGE_MIME_TYPE_BY_EXTENSION[extension] ?? "image/png";
  }
  if (kind === "audio") {
    return AUDIO_MIME_TYPE_BY_EXTENSION[extension] ?? "audio/mpeg";
  }

  return VIDEO_MIME_TYPE_BY_EXTENSION[extension] ?? "video/mp4";
}

function isCompatibleRemoteGeneratedMediaType(
  kind: RemoteGeneratedMediaKind,
  mimeType: string,
  fallbackUrl: string,
) {
  const normalizedMimeType = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalizedMimeType.startsWith(`${kind}/`)) {
    return true;
  }

  const extension = getFileExtensionFromUrl(fallbackUrl) ?? "";
  if (kind === "image") {
    return extension in IMAGE_MIME_TYPE_BY_EXTENSION;
  }
  if (kind === "audio") {
    return extension in AUDIO_MIME_TYPE_BY_EXTENSION;
  }

  return extension in VIDEO_MIME_TYPE_BY_EXTENSION;
}

function getRemoteGeneratedMediaFileExtension(
  kind: RemoteGeneratedMediaKind,
  mimeType: string,
  fallbackUrl: string,
) {
  if (kind === "image") {
    return getImageFileExtension(mimeType, fallbackUrl);
  }
  if (kind === "audio") {
    return getAudioFileExtension(mimeType, fallbackUrl);
  }

  return getVideoFileExtension(mimeType, fallbackUrl);
}

function getRemoteGeneratedMediaLabel(kind: RemoteGeneratedMediaKind, locale: PromptLocale) {
  if (locale === "zh") {
    if (kind === "image") {
      return "图片";
    }
    if (kind === "audio") {
      return "音频";
    }
    return "视频";
  }

  return kind;
}

function buildRemoteGeneratedMediaDownloadError(
  kind: RemoteGeneratedMediaKind,
  locale: PromptLocale,
  status: number,
  detail: string,
) {
  const mediaLabel = getRemoteGeneratedMediaLabel(kind, locale);
  if (locale === "zh") {
    return `生成${mediaLabel}下载失败 (HTTP ${status})${detail ? `: ${detail}` : ""}`;
  }

  return `Failed to download generated ${mediaLabel} (HTTP ${status})${detail ? `: ${detail}` : ""}`;
}

function buildRemoteGeneratedMediaTypeError(
  kind: RemoteGeneratedMediaKind,
  locale: PromptLocale,
  mimeType: string,
) {
  const mediaLabel = getRemoteGeneratedMediaLabel(kind, locale);
  if (locale === "zh") {
    return `生成${mediaLabel}返回了非${mediaLabel}内容: ${mimeType}`;
  }

  return `Generated ${mediaLabel} response returned non-${mediaLabel} content: ${mimeType}`;
}

async function storeRemoteGeneratedMediaAsFile(input: {
  origin: string;
  requestId: string;
  sourceUrl: string;
  provider: GenerationItem["provider"];
  index: number;
  kind: RemoteGeneratedMediaKind;
  locale?: PromptLocale;
}): Promise<StoredRemoteGeneratedMedia> {
  const locale = input.locale ?? getRuntimeLocale();
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
      buildRemoteGeneratedMediaDownloadError(input.kind, locale, response.status, detail),
    );
  }

  const responseMimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  if (!isCompatibleRemoteGeneratedMediaType(input.kind, responseMimeType, input.sourceUrl)) {
    throw new Error(
      buildRemoteGeneratedMediaTypeError(
        input.kind,
        locale,
        responseMimeType || "application/octet-stream",
      ),
    );
  }

  const mimeType = resolveRemoteGeneratedMediaMimeType(
    input.kind,
    responseMimeType,
    input.sourceUrl,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  const fileExtension = getRemoteGeneratedMediaFileExtension(
    input.kind,
    mimeType,
    input.sourceUrl,
  );
  const fileName = `${input.kind}-${input.index + 1}-${input.requestId.slice(0, 8)}.${fileExtension}`;
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

async function storeRemoteImageAsGeneratedFile(input: {
  origin: string;
  requestId: string;
  sourceUrl: string;
  provider: GenerationItem["provider"];
  index: number;
}) {
  return storeRemoteGeneratedMediaAsFile({
    ...input,
    kind: "image",
  });
}

async function resolveGeneratedRemoteMediaOutputs(input: {
  origin: string;
  requestId: string;
  sourceUrls: string[];
  provider: GenerationItem["provider"];
  kind: RemoteGeneratedMediaKind;
  locale?: PromptLocale;
}) {
  const locale = input.locale ?? getRuntimeLocale();
  const settled = await Promise.allSettled(
    input.sourceUrls.map((sourceUrl, index) =>
      storeRemoteGeneratedMediaAsFile({
        origin: input.origin,
        requestId: input.requestId,
        sourceUrl,
        provider: input.provider,
        index,
        kind: input.kind,
        locale,
      }),
    ),
  );

  const resolved = settled.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    console.warn(
      `[Generate][${input.requestId}] Generated ${input.kind} asset fallback to remote URL for item ${index + 1}`,
      result.reason,
    );

    return {
      fileName: `${input.kind}-${index + 1}`,
      previewUrl: input.sourceUrls[index] ?? "",
      downloadUrl: input.sourceUrls[index] ?? "",
    } satisfies StoredRemoteGeneratedMedia;
  });

  return {
    mediaUrls: resolved.map((item) => item.previewUrl),
    downloadLinks: resolved.map((item) => ({
      label: item.fileName,
      url: item.downloadUrl,
    })),
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

function buildReplicateVisualDetectionInputs(input: {
  modelId: string;
  imageUrls: string[];
  locale: "zh" | "en";
  target: "image" | "video";
}) {
  const imageUrls = input.imageUrls.filter(Boolean);
  const primaryImageUrl = imageUrls[0];
  if (!primaryImageUrl) {
    throw new Error("Replicate 视觉检测缺少可用图片输入。");
  }

  const userPrompt = buildVisualDetectionPrompt(input.target, input.locale);

  if (input.modelId === "openai/gpt-5-nano") {
    return {
      primaryInput: {
        image_input: imageUrls,
        system_prompt: buildStructuredDetectionInstruction(input.target, input.locale),
        prompt: userPrompt,
        max_completion_tokens: REPLICATE_VISUAL_DETECTION_MAX_COMPLETION_TOKENS,
        reasoning_effort: "minimal",
        verbosity: "low",
      },
      fallbackInput: {
        image_input: imageUrls,
        prompt: buildReplicateDetectionPrompt(input.target, userPrompt, input.locale),
        max_completion_tokens: REPLICATE_VISUAL_DETECTION_MAX_COMPLETION_TOKENS,
      },
    };
  }

  const prompt = buildReplicateDetectionPrompt(input.target, userPrompt, input.locale);
  return {
    primaryInput: {
      image: primaryImageUrl,
      prompt,
      max_length: DETECTION_MAX_TOKENS,
      temperature: 0.1,
      top_p: 0.95,
    },
    fallbackInput: {
      image: primaryImageUrl,
      prompt,
    },
  };
}

function buildAudioDetectionPrompt(fileName: string, locale: "zh" | "en") {
  if (locale === "zh") {
    return joinPromptLines([
      `文件名：${fileName}`,
      "⚠️ 关键：请优先分析音频本身的声学特征，不要只根据转录文本内容做判断。",
      "请重点观察以下维度：",
      "1. 音色稳定性：是否过于完美、机械一致，缺乏自然细微波动",
      "2. 韵律节奏：语速、停顿、重音是否过于规则或模式化",
      "3. 呼吸与口腔细节：是否缺少自然呼吸声、唇齿音、口水音、轻微杂音",
      "4. 情感表达：情绪变化是否僵硬、夸张或缺乏真实层次",
      "5. 发音自然度：连读、弱读、语气词、口误是否像真实人声",
      "6. 频谱与底噪：频谱是否异常干净、频段分布异常，或缺少真实环境噪声",
      "7. 环境与混响：是否存在自然房间感、空间反射或环境声",
      "8. 拼接与连续性：是否存在突变、拼接痕迹、断裂感或不自然衔接",
      "不要因为音质好、吐字清晰、录音干净就直接判为 AI；专业录音的人声也可能非常干净。",
      "如果你无法直接感知声学特征，只能看到转录文字，请诚实说明，并将 probability 设为 50、confidence 设为 30 左右。",
    ]);
  }

  return joinPromptLines([
    `File: ${fileName}`,
    "⚠️ CRITICAL: prioritize acoustic evidence from the audio itself, not just the transcript.",
    "Assess the likelihood of AI-synthesized audio across these dimensions:",
    "1. Voice stability: overly perfect, mechanically consistent tone vs natural micro-variation",
    "2. Prosody and rhythm: overly regular pacing, pauses, and stress vs naturally varying delivery",
    "3. Breath and mouth detail: missing or overly regular breathing / mouth noises vs natural human artifacts",
    "4. Emotional expression: stiff, exaggerated, or flat transitions vs nuanced human emotion",
    "5. Pronunciation naturalness: unnatural liaison/reduction patterns vs authentic spoken flow",
    "6. Spectrum and noise floor: abnormally clean spectrum or unusual band behavior vs realistic recording texture",
    "7. Room acoustics: unnatural reverb / spatial cues vs believable room tone and ambience",
    "8. Splicing and continuity: sudden transitions, stitching artifacts, or synthetic discontinuities",
    "Do not classify audio as AI merely because it sounds clear, polished, or professionally recorded.",
    "If you cannot directly access acoustic evidence and only have transcript-like information, say so explicitly and keep the result near probability=50 and confidence=30.",
  ]);
}

function buildReplicateAudioDetectionSystemPrompt(locale: "zh" | "en") {
  if (locale === "zh") {
    return joinPromptLines([
      "你是保守、低误报的音频 AI 检测助手，必须优先依据真实可听到的声学证据判断。",
      "不要只根据转录文本内容下结论；如果无法直接获取声学证据，必须明确说明，并将结果维持在 uncertain、probability≈50、confidence≈30。",
      "只返回严格 JSON：{\"probability\":0-100,\"confidence\":0-100,\"verdict\":\"likely_ai|uncertain|likely_human\",\"reasons\":[\"具体依据1\",\"具体依据2\",\"具体依据3\"]}",
      "probability 和 confidence 必须输出整数百分比；reasons 保持简洁、具体、可观察。",
    ]);
  }

  return joinPromptLines([
    "You are a conservative, low-false-positive AI audio detector and must rely primarily on directly audible acoustic evidence.",
    "Do not judge from transcript content alone. If you cannot access acoustic evidence and only infer from transcript-like text, say so explicitly and keep the result near uncertain, probability≈50, confidence≈30.",
    'Return strict JSON only: {"probability":0-100,"confidence":0-100,"verdict":"likely_ai|uncertain|likely_human","reasons":["specific evidence 1","specific evidence 2","specific evidence 3"]}',
    "Use integer percentages for probability and confidence. Keep reasons concise, concrete, and observable.",
  ]);
}

function buildReplicateAudioDetectionUserPrompt(fileName: string, locale: "zh" | "en") {
  if (locale === "zh") {
    return joinPromptLines([
      `文件名：${fileName}`,
      "重点检查：音色微波动、呼吸与口腔细节、韵律节奏、情绪层次、频谱/底噪、空间感、拼接或突变痕迹。",
      "不要因为声音干净、标准、清晰就直接判为 AI。",
    ]);
  }

  return joinPromptLines([
    `File: ${fileName}`,
    "Focus on micro-variation, breath and mouth detail, prosody, emotional nuance, spectrum/noise floor, room tone, and stitching artifacts.",
    "Do not classify audio as AI merely because it sounds clean, clear, or professionally recorded.",
  ]);
}

function buildReplicateCompactAudioDetectionPrompt(fileName: string, locale: "zh" | "en") {
  return [
    buildReplicateAudioDetectionSystemPrompt(locale),
    buildReplicateAudioDetectionUserPrompt(fileName, locale),
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
  locale?: PromptLocale;
}) {
  const locale = input.locale ?? getRuntimeLocale();
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
    throw new Error(
      locale === "zh"
        ? `Replicate 检测失败${detail ? `: ${detail}` : ""}`
        : `Replicate detection failed${detail ? `: ${detail}` : ""}`,
    );
  }

  const finalPayload =
    status === "succeeded"
      ? payload
      : await (() => {
          if (!payload.id) {
            throw new Error(
              locale === "zh"
                ? "Replicate 返回结果缺少 prediction id。"
                : "Replicate response is missing a prediction id.",
            );
          }

          return waitForReplicatePredictionResult(
            payload.id,
            REPLICATE_TEXT_TASK_TIMEOUT_MS,
            input.timeoutMessage,
          );
        })();

  const content = extractReplicateTextOutput(finalPayload.output);
  if (!content.trim()) {
    throw new Error(
      locale === "zh"
        ? "Replicate 检测未返回可解析内容。"
        : "Replicate detection returned no parseable content.",
    );
  }

  return normalizeDetectionResult(content);
}

function buildReplicateDocumentDetectionInputs(input: {
  modelId: string;
  fileName: string;
  extractedText: string;
  locale: "zh" | "en";
}) {
  const fullPrompt = buildReplicateCompactDocumentDetectionPrompt({
    fileName: input.fileName,
    extractedText: input.extractedText,
    locale: input.locale,
  });

  if (input.modelId === "openai/gpt-5-nano") {
    const userPrompt = buildReplicateDocumentDetectionUserPrompt({
      fileName: input.fileName,
      extractedText: input.extractedText,
      locale: input.locale,
    });

    return {
      primaryInput: {
        prompt: userPrompt,
        system_prompt: buildReplicateDocumentDetectionSystemPrompt(input.locale),
        max_completion_tokens: REPLICATE_DOCUMENT_DETECTION_MAX_COMPLETION_TOKENS,
        reasoning_effort: "minimal",
        verbosity: "low",
      },
      fallbackInput: {
        prompt: fullPrompt,
        max_completion_tokens: REPLICATE_DOCUMENT_DETECTION_MAX_COMPLETION_TOKENS,
      },
    };
  }

  return {
    primaryInput: {
      prompt: fullPrompt,
      max_new_tokens: REPLICATE_DOCUMENT_DETECTION_MAX_NEW_TOKENS,
      temperature: 0.1,
      top_p: 0.95,
    },
    fallbackInput: {
      prompt: fullPrompt,
    },
  };
}

async function detectDocumentWithReplicate(input: {
  requestId: string;
  modelId: string;
  file: File;
  locale: "zh" | "en";
}) {
  const extractedText = await extractDetectableDocumentText(input.file, input.locale);
  if (!extractedText.trim()) {
    throw new Error(
      input.locale === "zh"
        ? "未能从文档中提取到可检测文本。"
        : "No detectable text could be extracted from the document.",
    );
  }

  const normalizedModelId = normalizeReplicateTextModelId(input.modelId);
  const { primaryInput, fallbackInput } = buildReplicateDocumentDetectionInputs({
    modelId: normalizedModelId,
    fileName: input.file.name,
    extractedText,
    locale: input.locale,
  });

  return waitForReplicateDetectionResult({
    requestId: input.requestId,
    modelId: normalizedModelId,
    primaryInput,
    fallbackInput,
    timeoutMessage:
      input.locale === "zh"
        ? `Replicate 文档检测超时，请稍后重试。model_id: ${normalizedModelId}`
        : `Replicate document detection timed out. Please try again later. model_id: ${normalizedModelId}`,
    locale: input.locale,
  });
}

async function detectImageWithReplicate(input: {
  requestId: string;
  modelId: string;
  imageUrls: string[];
  locale: "zh" | "en";
  target: "image" | "video";
}) {
  const normalizedModelId = resolveReplicateVisualDetectionModelId(input.modelId);
  const { primaryInput, fallbackInput } = buildReplicateVisualDetectionInputs({
    modelId: normalizedModelId,
    imageUrls: input.imageUrls,
    locale: input.locale,
    target: input.target,
  });

  return waitForReplicateDetectionResult({
    requestId: input.requestId,
    modelId: normalizedModelId,
    primaryInput,
    fallbackInput,
    timeoutMessage:
      input.locale === "zh"
        ? `Replicate 视觉检测超时，请稍后重试。model_id: ${normalizedModelId}`
        : `Replicate visual detection timed out. Please try again later. model_id: ${normalizedModelId}`,
    locale: input.locale,
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
    input.locale,
  );

  const rawText = await requestDashScopeChatCompletionStreamText({
    model: resolveDashScopeAudioDetectionModelId(input.modelId),
    enable_thinking: true,
    temperature: 0.2,
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
            type: "video",
            video: uploaded.publicUrl,
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
    input.locale,
  );
  if (input.modelId === "vaibhavs10/incredibly-fast-whisper-detect") {
    const transcription = await transcribeAudioWithReplicate(
      input.requestId,
      "vaibhavs10/incredibly-fast-whisper",
      uploaded.publicUrl,
      input.locale,
    );
    const detectionPrompt = buildReplicateCompactAudioDetectionPrompt(input.file.name, input.locale);
    const detectionResult = await waitForReplicateDetectionResult({
      requestId: input.requestId,
      modelId: "openai/gpt-5-nano",
      primaryInput: {
        prompt: `${detectionPrompt}\n\nTranscript:\n${transcription}`,
      },
      fallbackInput: {
        prompt: `${detectionPrompt}\n\nTranscript:\n${transcription}`,
      },
      timeoutMessage: input.locale === "zh" ? "文本检测超时" : "Text detection timed out",
      locale: input.locale,
    });
    return detectionResult;
  }

  const normalizedModelId = resolveReplicateAudioDetectionModelId(input.modelId);
  const systemPrompt = buildReplicateAudioDetectionSystemPrompt(input.locale);
  const userPrompt = buildReplicateAudioDetectionUserPrompt(input.file.name, input.locale);
  const compactPrompt = buildReplicateCompactAudioDetectionPrompt(input.file.name, input.locale);
  const timeoutMessage =
    input.locale === "zh"
      ? `Replicate 音频检测超时，请稍后重试。model_id: ${normalizedModelId}`
      : `Replicate audio detection timed out. Please try again later. model_id: ${normalizedModelId}`;

  if (normalizedModelId === "lucataco/qwen2.5-omni-7b") {
    return waitForReplicateDetectionResult({
      requestId: input.requestId,
      modelId: normalizedModelId,
      primaryInput: {
        audio: uploaded.publicUrl,
        prompt: userPrompt,
        system_prompt: systemPrompt,
        generate_audio: false,
      },
      fallbackInput: {
        audio: uploaded.publicUrl,
        prompt: compactPrompt,
        generate_audio: false,
      },
      timeoutMessage,
      locale: input.locale,
    });
  }

  if (normalizedModelId === "zsxkib/kimi-audio-7b-instruct") {
    return waitForReplicateDetectionResult({
      requestId: input.requestId,
      modelId: normalizedModelId,
      primaryInput: {
        audio: uploaded.publicUrl,
        prompt: compactPrompt,
        output_type: "text",
        return_json: true,
        text_temperature: 0,
        text_top_k: 1,
      },
      fallbackInput: {
        audio: uploaded.publicUrl,
        prompt: compactPrompt,
        output_type: "text",
        return_json: true,
      },
      timeoutMessage,
      locale: input.locale,
    });
  }

  if (normalizedModelId === "nvidia/canary-qwen-2.5b") {
    return waitForReplicateDetectionResult({
      requestId: input.requestId,
      modelId: normalizedModelId,
      primaryInput: {
        audio: uploaded.publicUrl,
        llm_prompt: compactPrompt,
        include_timestamps: false,
        show_confidence: false,
      },
      fallbackInput: {
        audio: uploaded.publicUrl,
        llm_prompt: compactPrompt,
        include_timestamps: false,
      },
      timeoutMessage,
      locale: input.locale,
    });
  }

  return waitForReplicateDetectionResult({
    requestId: input.requestId,
    modelId: normalizedModelId,
    primaryInput: {
      audio: uploaded.publicUrl,
      prompt: compactPrompt,
      max_tokens: DETECTION_MAX_TOKENS,
      temperature: 0.1,
      top_p: 0.95,
    },
    fallbackInput: {
      audio: uploaded.publicUrl,
      prompt: compactPrompt,
    },
    timeoutMessage,
    locale: input.locale,
  });
}

function buildFileGenerationPrompt(
  userPrompt: string,
  targetFormat: DocumentFileFormat,
  locale: PromptLocale = "en",
) {
  const requireSpreadsheet = targetFormat === "xlsx";

  if (locale === "zh") {
    return joinPromptLines([
      "用户需求：",
      userPrompt,
      "",
      `目标格式：${targetFormat}`,
      "",
      "输出要求：",
      "- 生成一份完整、可直接交付的文档包，准确满足用户需求。",
      "- 标题简洁明确，摘要准确概括核心内容。",
      requireSpreadsheet
        ? "- 优先保证表格结构准确，工作表名、列名、行数据必须清晰且可直接使用。"
        : "- 优先保证正文结构清晰，标题明确，段落聚焦且信息充分。",
      requireSpreadsheet
        ? "- 至少包含一个有实际用途的工作表，如清单、计划、预算、时间表或汇总表。"
        : "- 只有在确有必要时才使用 spreadsheets，否则保持为空数组。",
      "- 最终内容中不要提及 schema、提示词或这些说明。",
    ]);
  }

  return joinPromptLines([
    "User request:",
    userPrompt,
    "",
    `Target format: ${targetFormat}`,
    "",
    "Output requirements:",
    "- Create one complete, directly usable document package that fully satisfies the request.",
    "- Keep the title concise and specific, and make the summary accurately reflect the core content.",
    requireSpreadsheet
      ? "- Prioritize accurate spreadsheet structure, sheet names, columns, and rows."
      : "- Prioritize readable prose structure with clear headings and focused, information-dense paragraphs.",
    requireSpreadsheet
      ? "- Include at least one useful spreadsheet such as a checklist, plan, budget, schedule, or summary table."
      : "- Keep the spreadsheets array empty unless a spreadsheet is clearly necessary.",
    "- Do not mention the schema or these instructions in the final content.",
  ]);
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
    const allowGuestFileEditingForTests =
      process.env.ALLOW_GUEST_FILE_EDITING_FOR_TESTS === "true" &&
      process.env.NODE_ENV !== "production";

    if (!isGenerationTab(type) || !isConnectedGenerationTab(type)) {
      return Response.json({ message: "?????????????" }, { status: 400 });
    }

    if (isGuestRequest && type !== "text" && !(allowGuestFileEditingForTests && type === "edit_text")) {
      return jsonWithCookie(
        { message: "????????????????" },
        { status: 403 },
        guestSetCookieHeader,
      );
    }

    if (!prompt) {
      return Response.json({ message: "?????????" }, { status: 400 });
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

    const runtimeLocale = getRuntimeLocale();
    const detectionLocale = runtimeLocale;

    if (modelConfig.mode === "file-detection") {
      if (!inputFile) {
        return returnTrackedGenerateError(
          detectionLocale === "zh"
            ? "请上传待检测文档。"
            : "Please upload the document to detect.",
          400,
        );
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
        return returnTrackedGenerateError(
          detectionLocale === "zh"
            ? "请上传待检测图片。"
            : "Please upload the image to detect.",
          400,
        );
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
                throw new Error(
                  detectionLocale === "zh"
                    ? "图片检测缺少运行时数据库上下文。"
                    : "Image detection is missing the runtime database context.",
                );
              }

              const uploaded = await uploadInputFileForEditing(
                runtimeDbClient,
                requestId,
                "image-detect",
                inputFile,
                detectionLocale,
              );
              return detectImageWithReplicate({
                requestId,
                modelId: modelConfig.id,
                imageUrls: [uploaded.publicUrl],
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
        return returnTrackedGenerateError(
          detectionLocale === "zh"
            ? "请上传待检测音频。"
            : "Please upload the audio to detect.",
          400,
        );
      }

      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const detectionResult =
        modelConfig.provider === "aliyun"
          ? await (async () => {
              if (!runtimeDbClient) {
                throw new Error(
                  detectionLocale === "zh"
                    ? "音频检测缺少运行时数据库上下文。"
                    : "Audio detection is missing the runtime database context.",
                );
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
                throw new Error(
                  detectionLocale === "zh"
                    ? "音频检测缺少运行时数据库上下文。"
                    : "Audio detection is missing the runtime database context.",
                );
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
        return returnTrackedGenerateError(
          detectionLocale === "zh"
            ? "请上传待检测视频。"
            : "Please upload the video to detect.",
          400,
        );
      }
      if (frameFiles.length === 0) {
        return returnTrackedGenerateError(
          detectionLocale === "zh"
            ? "视频检测缺少关键帧，请重新上传后重试。"
            : "Video detection is missing extracted keyframes. Please re-upload and try again.",
          400,
        );
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
                throw new Error(
                  detectionLocale === "zh"
                    ? "视频检测缺少运行时数据库上下文。"
                    : "Video detection is missing the runtime database context.",
                );
              }

              const runtimeDb = runtimeDbClient;
              const limitedFrames = frameFiles.slice(0, 3);
              const uploadedFrameUrls = await Promise.all(
                limitedFrames.map(async (frame, index) => {
                  const uploaded = await uploadInputFileForEditing(
                    runtimeDb,
                    requestId,
                    `video-detect-frame-${index + 1}`,
                    frame,
                    detectionLocale,
                  );
                  return uploaded.publicUrl;
                }),
              );

              if (resolveReplicateVisualDetectionModelId(modelConfig.id) === "openai/gpt-5-nano") {
                return detectImageWithReplicate({
                  requestId,
                  modelId: modelConfig.id,
                  imageUrls: uploadedFrameUrls,
                  locale: detectionLocale,
                  target: "video",
                });
              }

              const frameResults = await Promise.all(
                uploadedFrameUrls.map((imageUrl, index) =>
                  detectImageWithReplicate({
                    requestId: `${requestId}-frame-${index + 1}`,
                    modelId: modelConfig.id,
                    imageUrls: [imageUrl],
                    locale: detectionLocale,
                    target: "video",
                  }),
                ),
              );

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
        summary: buildDocumentGenerationSummary(generatedFiles.length, runtimeLocale),
        text: buildGeneratedDocumentPreview(object),
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

      requestTimer.total("文档生成");
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
        return returnTrackedGenerateError(
          runtimeLocale === "zh"
            ? "请先上传需要编辑的文档。"
            : "Please upload the document you want to edit first.",
          400,
        );
      }

      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      const requestedFormats = getDocumentEditOutputFormats(inputFile.name);
      const requireSpreadsheet = shouldRequireSpreadsheet(requestedFormats);
      const origin = new URL(req.url).origin;
      const directEditResult = await tryPerformDirectDocumentEdit(inputFile, prompt, runtimeLocale);
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
              locale: runtimeLocale,
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
        summary: buildDocumentEditSummary(
          generatedFiles.length,
          runtimeLocale,
          directEditResult?.replacementCount,
        ),
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
        return returnTrackedGenerateError(
          runtimeLocale === "zh"
            ? "请先上传需要编辑的音频。"
            : "Please upload the audio you want to edit first.",
          400,
        );
      }

      if (!runtimeDbClient) {
        return returnTrackedGenerateError(
          runtimeLocale === "zh"
            ? "编辑上传服务暂时不可用，请稍后重试。"
            : "The upload service for editing is temporarily unavailable. Please try again later.",
          503,
        );
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
              locale: runtimeLocale,
            });

      const resolvedAudio =
        modelConfig.provider === "replicate"
          ? await resolveGeneratedRemoteMediaOutputs({
              origin,
              requestId,
              sourceUrls: audioEditResult.audioUrls,
              provider: modelConfig.provider,
              kind: "audio",
              locale: runtimeLocale,
            })
          : {
              mediaUrls: audioEditResult.audioUrls,
              downloadLinks: audioEditResult.downloadLinks,
            };

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: buildAudioEditSummary(resolvedAudio.mediaUrls.length, runtimeLocale),
        text: audioEditResult.rewrittenScript,
        audioUrls: resolvedAudio.mediaUrls,
        downloadLinks: resolvedAudio.downloadLinks,
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
          output_count: resolvedAudio.mediaUrls.length,
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
        return returnTrackedGenerateError(
          runtimeLocale === "zh"
            ? "请先上传需要编辑的图片。"
            : "Please upload the image you want to edit first.",
          400,
        );
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
                throw new Error(
                  runtimeLocale === "zh"
                    ? "编辑上传服务暂时不可用，请稍后重试。"
                    : "The upload service for editing is temporarily unavailable. Please try again later.",
                );
              }

              return editImageWithReplicate({
                requestId,
                modelId: modelConfig.id,
                prompt,
                file: inputFile,
                db: runtimeDbClient,
                locale: runtimeLocale,
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
            : runtimeLocale === "zh"
              ? "Replicate 图片编辑未返回可用图片链接，请稍后重试。"
              : "Replicate image editing did not return any usable image URL. Please try again later.",
        );
      }

      const origin = new URL(req.url).origin;
      const resolvedImages = await resolveGeneratedRemoteMediaOutputs({
        origin,
        requestId,
        sourceUrls: imageUrls,
        provider: modelConfig.provider,
        kind: "image",
        locale: runtimeLocale,
      });

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: buildImageEditSummary(resolvedImages.mediaUrls.length, runtimeLocale),
        imageUrls: resolvedImages.mediaUrls,
        downloadLinks: resolvedImages.downloadLinks,
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
          output_count: resolvedImages.mediaUrls.length,
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
              const prediction = await generateAudioWithReplicate(
                requestId,
                modelConfig.id,
                prompt,
                runtimeLocale,
              );
              const audioUrls = extractReplicateOutputUrls(prediction.output).slice(
                0,
                DEFAULT_AUDIO_OUTPUT_COUNT,
              );
              if (audioUrls.length === 0) {
                throw new Error(
                  runtimeLocale === "zh"
                    ? "Replicate 音频生成未返回可用音频链接，请稍后重试。"
                    : "Replicate audio generation did not return any usable audio URL. Please try again.",
                );
              }

              const resolvedAudio = await resolveGeneratedRemoteMediaOutputs({
                origin,
                requestId,
                sourceUrls: audioUrls,
                provider: modelConfig.provider,
                kind: "audio",
                locale: runtimeLocale,
              });

              return {
                audioUrls: resolvedAudio.mediaUrls,
                downloadLinks: resolvedAudio.downloadLinks,
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
        summary: buildAudioGenerationSummary(audioUrls.length, runtimeLocale),
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
      const resolvedImages = await resolveGeneratedRemoteMediaOutputs({
        origin,
        requestId,
        sourceUrls: imageUrls,
        provider: modelConfig.provider,
        kind: "image",
        locale: runtimeLocale,
      });

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: buildImageGenerationSummary(resolvedImages.mediaUrls.length, runtimeLocale),
        imageUrls: resolvedImages.mediaUrls,
        downloadLinks: resolvedImages.downloadLinks,
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
          output_count: resolvedImages.mediaUrls.length,
          duration_ms: requestTimer.getTotalMs(),
          is_guest: isGuestRequest,
        },
        false,
        getTrackedTaskId(persistedResult),
      );
      return Response.json(persistedResult);
    }

    if (modelConfig.mode === "video-editing") {
      const domesticFrameFiles =
        modelConfig.provider === "aliyun"
          ? frameFiles.slice(0, DASHSCOPE_VIDEO_EDIT_FRAME_COUNT)
          : [];
      const domesticKeyframeFile =
        modelConfig.provider === "aliyun"
          ? keyframeFile ??
            domesticFrameFiles[Math.min(1, domesticFrameFiles.length - 1)] ??
            domesticFrameFiles[0] ??
            null
          : null;

      if (modelConfig.provider === "aliyun" && !(domesticKeyframeFile instanceof File)) {
        return returnTrackedGenerateError(
          "请重新上传视频，系统需要提取关键帧后再执行视频编辑。",
          400,
        );
      }

      if (modelConfig.provider === "replicate" && !(inputFile instanceof File)) {
        return returnTrackedGenerateError(
          runtimeLocale === "zh"
            ? "请先上传需要编辑的视频。"
            : "Please upload the video you want to edit first.",
          400,
        );
      }

      const userQuotaError = await reserveUserQuotaIfNeeded();
      if (userQuotaError) {
        return returnTrackedGenerateError(userQuotaError, 429);
      }

      if (modelConfig.provider === "replicate" && !runtimeDbClient) {
        throw new Error(
          runtimeLocale === "zh"
            ? "编辑上传服务暂时不可用，请稍后重试。"
            : "The upload service for editing is temporarily unavailable. Please try again later.",
        );
      }

      let usedReplicateReferenceKeyframe = false;
      const videoPayload =
        modelConfig.provider === "aliyun"
          ? await editVideoWithDashScope(
              requestId,
              modelConfig.id,
              prompt,
              domesticKeyframeFile!,
              domesticFrameFiles,
            )
          : await (async () => {
              const replicateResult = await editVideoWithReplicate({
                requestId,
                modelId: modelConfig.id,
                prompt,
                file: inputFile as File,
                keyframeFile,
                frameFiles,
                db: runtimeDbClient!,
                locale: runtimeLocale,
              });
              usedReplicateReferenceKeyframe = replicateResult.usesReferenceKeyframe;
              return replicateResult.payload;
            })();
      const rawVideoUrls = extractReplicateOutputUrls(videoPayload.output).slice(
        0,
        DEFAULT_VIDEO_OUTPUT_COUNT,
      );
      if (rawVideoUrls.length === 0) {
        throw new Error(
          modelConfig.provider === "aliyun"
            ? "阿里云百炼视频编辑未返回可用视频链接，请稍后重试。"
            : runtimeLocale === "zh"
              ? "Replicate 视频编辑未返回可用视频链接，请稍后重试。"
              : "Replicate video editing did not return any usable video URL. Please try again later.",
        );
      }

      const resolvedVideos =
        modelConfig.provider === "replicate"
          ? await resolveGeneratedRemoteMediaOutputs({
              origin: new URL(req.url).origin,
              requestId,
              sourceUrls: rawVideoUrls,
              provider: modelConfig.provider,
              kind: "video",
              locale: runtimeLocale,
            })
          : {
              mediaUrls: rawVideoUrls,
              downloadLinks: rawVideoUrls.map((url, index) => ({
                label: `video-${index + 1}`,
                url,
              })),
            };

      const result: GenerationItem = {
        id: requestId,
        type,
        prompt,
        modelId: modelConfig.id,
        modelLabel: modelConfig.label,
        provider: modelConfig.provider,
        status: "success",
        summary: buildVideoEditSummary(
          resolvedVideos.mediaUrls.length,
          runtimeLocale,
          modelConfig.provider === "aliyun" || usedReplicateReferenceKeyframe,
        ),
        videoUrls: resolvedVideos.mediaUrls,
        downloadLinks: resolvedVideos.downloadLinks,
        createdAt: new Date().toISOString(),
      };
      const persistedResult = await persistGenerationResult(result, {
        source_file_name: inputFile?.name || null,
        keyframe_file_name: (domesticKeyframeFile ?? keyframeFile)?.name || null,
        frame_count:
          (modelConfig.provider === "aliyun" ? domesticFrameFiles.length : frameFiles.length) || null,
      });

      await trackGenerateEvent(
        "generate_success",
        "generate_video_success",
        {
          type,
          model_id: modelConfig.id,
          model_provider: modelConfig.provider,
          output_count: resolvedVideos.mediaUrls.length,
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

    const resolvedVideos =
      modelConfig.provider === "replicate"
        ? await resolveGeneratedRemoteMediaOutputs({
            origin: new URL(req.url).origin,
            requestId,
            sourceUrls: videoUrls,
            provider: modelConfig.provider,
            kind: "video",
            locale: runtimeLocale,
          })
        : {
            mediaUrls: videoUrls,
            downloadLinks: videoUrls.map((url, index) => ({
              label: `video-${index + 1}`,
              url,
            })),
          };

    const result: GenerationItem = {
      id: requestId,
      type,
      prompt,
      modelId: modelConfig.id,
      modelLabel: modelConfig.label,
      provider: modelConfig.provider,
      status: "success",
      summary: buildVideoGenerationSummary(resolvedVideos.mediaUrls.length, runtimeLocale),
      videoUrls: resolvedVideos.mediaUrls,
      downloadLinks: resolvedVideos.downloadLinks,
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
