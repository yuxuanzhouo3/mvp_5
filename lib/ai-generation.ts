import { DEFAULT_LANGUAGE } from "@/config";

export type GenerationTab =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "edit_text"
  | "edit_image"
  | "edit_audio"
  | "edit_video"
  | "detect_text"
  | "detect_image"
  | "detect_audio"
  | "detect_video";

export type ConnectedGenerationTab = "text" | "image" | "video" | "audio";
export type GenerationUILanguage = "zh" | "en";
export type GenerationModelProvider = "mistral" | "replicate" | "aliyun" | "demo";
export type GenerationModelRegion = "domestic" | "international" | "demo";

export type GenerationModelMode =
  | "file-generation"
  | "image-generation"
  | "video-generation"
  | "audio-generation"
  | "demo";

export type GenerationModelConfig = {
  id: string;
  label: string;
  provider: GenerationModelProvider;
  mode: GenerationModelMode;
  tabs: readonly GenerationTab[];
  region: GenerationModelRegion;
  optionLabelZh: string;
  optionLabelEn: string;
  autoLabelZh: string;
  autoLabelEn: string;
};

const GENERATION_MODELS: readonly GenerationModelConfig[] = [
  {
    id: "qwen3.5-flash",
    label: "Qwen3.5 Flash via DashScope",
    provider: "aliyun",
    mode: "file-generation",
    tabs: ["text"],
    region: "domestic",
    optionLabelZh: "Qwen3.5 Flash · 文生文档（更快）",
    optionLabelEn: "Qwen3.5 Flash · Document Generation (Faster)",
    autoLabelZh: "Qwen3.5 Flash 文档",
    autoLabelEn: "Qwen3.5 Flash Docs",
  },
  {
    id: "wan2.6-t2i",
    label: "Wan 2.6 T2I via DashScope",
    provider: "aliyun",
    mode: "image-generation",
    tabs: ["image"],
    region: "domestic",
    optionLabelZh: "Wan 2.6 T2I · 文生图片",
    optionLabelEn: "Wan 2.6 T2I · Text to Image",
    autoLabelZh: "Wan 2.6 文生图",
    autoLabelEn: "Wan 2.6 T2I",
  },
  {
    id: "wan2.6-i2v-flash",
    label: "Wan 2.6 I2V Flash via DashScope",
    provider: "aliyun",
    mode: "video-generation",
    tabs: ["video"],
    region: "domestic",
    optionLabelZh: "Wan 2.6 I2V Flash · 文生视频（自动生成首帧）",
    optionLabelEn: "Wan 2.6 I2V Flash · Text to Video (auto keyframe)",
    autoLabelZh: "Wan 2.6 文生视频",
    autoLabelEn: "Wan 2.6 Video",
  },
  {
    id: "qwen3-tts-instruct-flash",
    label: "Qwen3 TTS Instruct Flash via DashScope",
    provider: "aliyun",
    mode: "audio-generation",
    tabs: ["audio"],
    region: "domestic",
    optionLabelZh: "Qwen3 TTS Instruct Flash · 语音合成",
    optionLabelEn: "Qwen3 TTS Instruct Flash · Text to Speech",
    autoLabelZh: "Qwen 语音",
    autoLabelEn: "Qwen Speech",
  },
  {
    id: "mistral-small-latest",
    label: "Mistral Small Latest",
    provider: "mistral",
    mode: "file-generation",
    tabs: ["text"],
    region: "international",
    optionLabelZh: "Mistral Small Latest · 文生文档",
    optionLabelEn: "Mistral Small Latest · Document Generation",
    autoLabelZh: "Mistral 文档",
    autoLabelEn: "Mistral Docs",
  },
  {
    id: "google/imagen-4",
    label: "Google Imagen 4 via Replicate",
    provider: "replicate",
    mode: "image-generation",
    tabs: ["image"],
    region: "international",
    optionLabelZh: "Google Imagen 4 · 文生图片",
    optionLabelEn: "Google Imagen 4 · Text to Image",
    autoLabelZh: "Imagen 4",
    autoLabelEn: "Imagen 4",
  },
  {
    id: "stability-ai/stable-audio-2.5",
    label: "Stable Audio 2.5 via Replicate",
    provider: "replicate",
    mode: "audio-generation",
    tabs: ["audio"],
    region: "international",
    optionLabelZh: "Stable Audio 2.5 · 文生音频",
    optionLabelEn: "Stable Audio 2.5 · Text to Audio",
    autoLabelZh: "Stable Audio 2.5",
    autoLabelEn: "Stable Audio 2.5",
  },
  {
    id: "minimax/video-01",
    label: "MiniMax Video-01 via Replicate",
    provider: "replicate",
    mode: "video-generation",
    tabs: ["video"],
    region: "international",
    optionLabelZh: "MiniMax Video-01 · 文生视频",
    optionLabelEn: "MiniMax Video-01 · Text to Video",
    autoLabelZh: "MiniMax",
    autoLabelEn: "MiniMax",
  },
  {
    id: "ui-demo",
    label: "UI Demo",
    provider: "demo",
    mode: "demo",
    tabs: [
      "edit_text",
      "edit_image",
      "edit_audio",
      "edit_video",
      "detect_text",
      "detect_image",
      "detect_audio",
      "detect_video",
    ],
    region: "demo",
    optionLabelZh: "演示模式",
    optionLabelEn: "Demo Mode",
    autoLabelZh: "演示模式",
    autoLabelEn: "Demo Mode",
  },
] as const;

const DEFAULT_MODEL_BY_TAB: Record<GenerationTab, string> = {
  text: DEFAULT_LANGUAGE === "zh" ? "qwen3.5-flash" : "mistral-small-latest",
  image: DEFAULT_LANGUAGE === "zh" ? "wan2.6-t2i" : "google/imagen-4",
  video: DEFAULT_LANGUAGE === "zh" ? "wan2.6-i2v-flash" : "minimax/video-01",
  audio:
    DEFAULT_LANGUAGE === "zh"
      ? "qwen3-tts-instruct-flash"
      : "stability-ai/stable-audio-2.5",
  edit_text: "ui-demo",
  edit_image: "ui-demo",
  edit_audio: "ui-demo",
  edit_video: "ui-demo",
  detect_text: "ui-demo",
  detect_image: "ui-demo",
  detect_audio: "ui-demo",
  detect_video: "ui-demo",
};

export type GenerationDownloadLink = {
  label: string;
  url: string;
};

export interface GenerationItem {
  id: string;
  type: GenerationTab;
  prompt: string;
  modelId: string;
  modelLabel: string;
  provider: GenerationModelProvider | "system";
  status: "success" | "error";
  summary?: string;
  text?: string;
  imageUrls?: string[];
  audioUrls?: string[];
  videoUrls?: string[];
  downloadLinks?: GenerationDownloadLink[];
  createdAt: string;
  errorMessage?: string;
}

function isGenerationModelAvailable(model: GenerationModelConfig) {
  if (model.region === "demo") {
    return true;
  }

  if (model.region === "domestic") {
    return DEFAULT_LANGUAGE === "zh";
  }

  return DEFAULT_LANGUAGE === "en";
}

export function isInternationalGenerationEnabled() {
  return DEFAULT_LANGUAGE === "en";
}

export function isDomesticGenerationEnabled() {
  return DEFAULT_LANGUAGE === "zh";
}

export function getInternationalModelDisabledMessage(
  language: GenerationUILanguage = "zh",
) {
  return language === "zh"
    ? "当前站点默认语言不是 en，国际版模型已禁用。"
    : "International models are only available when NEXT_PUBLIC_DEFAULT_LANGUAGE=en.";
}

export function getDomesticModelDisabledMessage(
  language: GenerationUILanguage = "zh",
) {
  return language === "zh"
    ? "当前站点默认语言不是 zh，国内版模型已禁用。"
    : "Domestic models are only available when NEXT_PUBLIC_DEFAULT_LANGUAGE=zh.";
}

export function getNoAvailableGenerationModelMessage(
  language: GenerationUILanguage = "zh",
) {
  if (DEFAULT_LANGUAGE === "zh") {
    return language === "zh"
      ? "当前类型暂无可用国内模型。"
      : "No available domestic model for this content type.";
  }

  if (!isInternationalGenerationEnabled()) {
    return getInternationalModelDisabledMessage(language);
  }

  return language === "zh"
    ? "当前类型暂无可用模型。"
    : "No available model for this content type.";
}

export function isGenerationTab(value: string): value is GenerationTab {
  return Object.prototype.hasOwnProperty.call(DEFAULT_MODEL_BY_TAB, value);
}

export function isConnectedGenerationTab(
  value: string,
): value is ConnectedGenerationTab {
  return value === "text" || value === "image" || value === "video" || value === "audio";
}

export function getDefaultModelIdForTab(tab: GenerationTab) {
  return DEFAULT_MODEL_BY_TAB[tab];
}

export function getGenerationModelsForTab(
  tab: GenerationTab,
  options?: { includeDisabled?: boolean },
) {
  const models = GENERATION_MODELS.filter((model) => model.tabs.includes(tab));
  if (options?.includeDisabled) {
    return models;
  }

  return models.filter(isGenerationModelAvailable);
}

export function hasAvailableGenerationModelsForTab(tab: GenerationTab) {
  return getGenerationModelsForTab(tab).length > 0;
}

export function getGenerationModelDisabledMessage(
  modelId: string,
  language: GenerationUILanguage = "zh",
) {
  const model = GENERATION_MODELS.find((item) => item.id === modelId);
  if (!model) {
    return getNoAvailableGenerationModelMessage(language);
  }

  if (model.region === "domestic") {
    return getDomesticModelDisabledMessage(language);
  }

  if (model.region === "international") {
    return getInternationalModelDisabledMessage(language);
  }

  return getNoAvailableGenerationModelMessage(language);
}

export function isGenerationModelEnabled(modelId: string) {
  const model = GENERATION_MODELS.find((item) => item.id === modelId);
  return model ? isGenerationModelAvailable(model) : false;
}

export function getGenerationModelConfig(
  tab: GenerationTab,
  requestedModel: unknown,
): GenerationModelConfig {
  const models = getGenerationModelsForTab(tab, { includeDisabled: true });
  if (typeof requestedModel === "string") {
    const matched = models.find((model) => model.id === requestedModel);
    if (matched) {
      return matched;
    }
  }

  const defaultModelId = getDefaultModelIdForTab(tab);
  return models.find((model) => model.id === defaultModelId) ?? models[0];
}

export function getGenerationModelOptions(
  tab: GenerationTab,
  language: GenerationUILanguage,
) {
  const models = getGenerationModelsForTab(tab);
  if (models.length === 0) {
    return {
      auto: {
        name: getNoAvailableGenerationModelMessage(language),
      },
    };
  }

  return {
    auto: {
      name:
        language === "zh"
          ? `自动（${models[0].autoLabelZh}）`
          : `Auto (${models[0].autoLabelEn})`,
    },
    ...Object.fromEntries(
      models.map((model) => [
        model.id,
        {
          name: language === "zh" ? model.optionLabelZh : model.optionLabelEn,
        },
      ]),
    ),
  };
}

export function getGenerationUnavailableMessage(
  tab: GenerationTab,
  language: GenerationUILanguage,
) {
  return hasAvailableGenerationModelsForTab(tab)
    ? null
    : getNoAvailableGenerationModelMessage(language);
}

export function getGenerationModelLabel(modelId: string) {
  return (
    GENERATION_MODELS.find((model) => model.id === modelId)?.label ?? modelId
  );
}
