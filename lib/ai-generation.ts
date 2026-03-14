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

export type ConnectedGenerationTab =
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
export type GenerationUILanguage = "zh" | "en";
export type GenerationModelProvider = "mistral" | "replicate" | "aliyun" | "demo";
export type GenerationModelRegion = "domestic" | "international" | "demo";

export type GenerationModelMode =
  | "file-generation"
  | "image-generation"
  | "video-generation"
  | "audio-generation"
  | "file-editing"
  | "image-editing"
  | "video-editing"
  | "audio-editing"
  | "file-detection"
  | "image-detection"
  | "video-detection"
  | "audio-detection"
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
  legacy?: boolean;
};

const GENERATION_MODELS: readonly GenerationModelConfig[] = [
  {
    id: "qwen-flash",
    label: "Qwen Flash via DashScope",
    provider: "aliyun",
    mode: "file-generation",
    tabs: ["text"],
    region: "domestic",
    optionLabelZh: "Qwen Flash · 文生文档",
    optionLabelEn: "Qwen Flash · Document Generation",
    autoLabelZh: "Qwen Flash 文档",
    autoLabelEn: "Qwen Flash Docs",
  },
  {
    id: "wanx2.0-t2i-turbo",
    label: "Wanx 2.0 T2I Turbo via DashScope",
    provider: "aliyun",
    mode: "image-generation",
    tabs: ["image"],
    region: "domestic",
    optionLabelZh: "Wanx 2.0 Turbo · 文生图片",
    optionLabelEn: "Wanx 2.0 Turbo · Text to Image",
    autoLabelZh: "Wanx 2.0 文生图",
    autoLabelEn: "Wanx 2.0 T2I",
  },
  {
    id: "wan2.2-i2v-flash",
    label: "Wanx 2.0 T2I Turbo + Wan 2.2 I2V Flash via DashScope",
    provider: "aliyun",
    mode: "video-generation",
    tabs: ["video"],
    region: "domestic",
    optionLabelZh: "Wanx 2.0 Turbo + Wan 2.2 Flash · 文生视频",
    optionLabelEn: "Wanx 2.0 Turbo + Wan 2.2 Flash · Text to Video",
    autoLabelZh: "Wan 首帧+视频",
    autoLabelEn: "Wan Keyframe + Video",
  },
  {
    id: "wan2.2-t2v-plus",
    label: "Wan 2.2 T2V Plus via DashScope",
    provider: "aliyun",
    mode: "video-generation",
    tabs: ["video"],
    region: "domestic",
    optionLabelZh: "Wan 2.2 Plus · 文生视频",
    optionLabelEn: "Wan 2.2 Plus · Text to Video",
    autoLabelZh: "Wan 2.2 文生视频",
    autoLabelEn: "Wan 2.2 Video",
  },
  {
    id: "qwen3-tts-flash",
    label: "Qwen3 TTS Flash via DashScope",
    provider: "aliyun",
    mode: "audio-generation",
    tabs: ["audio"],
    region: "domestic",
    optionLabelZh: "Qwen3 TTS Flash · 语音合成",
    optionLabelEn: "Qwen3 TTS Flash · Text to Speech",
    autoLabelZh: "Qwen 语音",
    autoLabelEn: "Qwen Speech",
  },
  {
    id: "qwen-flash-edit",
    label: "Qwen Flash Edit via DashScope",
    provider: "aliyun",
    mode: "file-editing",
    tabs: ["edit_text"],
    region: "domestic",
    optionLabelZh: "Qwen Flash · 文档编辑",
    optionLabelEn: "Qwen Flash · Document Editing",
    autoLabelZh: "Qwen 文档编辑",
    autoLabelEn: "Qwen Docs Edit",
  },
  {
    id: "wanx2.1-imageedit",
    label: "Wanx 2.1 ImageEdit via DashScope",
    provider: "aliyun",
    mode: "image-editing",
    tabs: ["edit_image"],
    region: "domestic",
    optionLabelZh: "Wanx 2.1 ImageEdit · 图片编辑",
    optionLabelEn: "Wanx 2.1 ImageEdit · Image Editing",
    autoLabelZh: "Wanx 图片编辑",
    autoLabelEn: "Wanx Image Edit",
  },
  {
    id: "wan2.2-i2v-flash",
    label: "Qwen3 VL Flash + Qwen Flash + Wan 2.2 I2V Flash via DashScope",
    provider: "aliyun",
    mode: "video-editing",
    tabs: ["edit_video"],
    region: "domestic",
    optionLabelZh: "Qwen3 VL Flash + Qwen Flash + Wan 2.2 Flash · 视频编辑",
    optionLabelEn: "Qwen3 VL Flash + Qwen Flash + Wan 2.2 Flash · Video Editing",
    autoLabelZh: "Qwen + Wan 视频编辑",
    autoLabelEn: "Qwen + Wan Video Edit",
  },
  {
    id: "paraformer-v2-qwen3-tts-flash",
    label: "Paraformer V2 + Qwen3 TTS Flash via DashScope",
    provider: "aliyun",
    mode: "audio-editing",
    tabs: ["edit_audio"],
    region: "domestic",
    optionLabelZh: "Paraformer V2 + Qwen3 TTS Flash · 音频编辑",
    optionLabelEn: "Paraformer V2 + Qwen3 TTS Flash · Audio Editing",
    autoLabelZh: "音频重配",
    autoLabelEn: "Audio Redub",
  },
  {
    id: "qwen-flash-detect",
    label: "Qwen Flash AI Detection via DashScope",
    provider: "aliyun",
    mode: "file-detection",
    tabs: ["detect_text"],
    region: "domestic",
    optionLabelZh: "Qwen Flash · 文档检测",
    optionLabelEn: "Qwen Flash · Docs Detection",
    autoLabelZh: "Qwen 文档检测",
    autoLabelEn: "Qwen Docs Detect",
  },
  {
    id: "qwen3-vl-flash-image-detect",
    label: "Qwen3 VL Flash Image Detection via DashScope",
    provider: "aliyun",
    mode: "image-detection",
    tabs: ["detect_image"],
    region: "domestic",
    optionLabelZh: "Qwen3 VL Flash · 图片检测",
    optionLabelEn: "Qwen3 VL Flash · Image Detection",
    autoLabelZh: "Qwen 图片检测",
    autoLabelEn: "Qwen Image Detect",
  },
  {
    id: "qwen-vl-plus-image-detect",
    label: "Qwen VL Plus Image Detection via DashScope (Legacy)",
    provider: "aliyun",
    mode: "image-detection",
    tabs: ["detect_image"],
    region: "domestic",
    optionLabelZh: "Qwen VL Plus · 图片检测（旧版兼容）",
    optionLabelEn: "Qwen VL Plus · Image Detection (Legacy)",
    autoLabelZh: "Qwen 图片检测",
    autoLabelEn: "Qwen Image Detect",
    legacy: true,
  },
  {
    id: "qwen3-vl-flash-video-detect",
    label: "Qwen3 VL Flash Video Detection via DashScope",
    provider: "aliyun",
    mode: "video-detection",
    tabs: ["detect_video"],
    region: "domestic",
    optionLabelZh: "Qwen3 VL Flash · 视频检测",
    optionLabelEn: "Qwen3 VL Flash · Video Detection",
    autoLabelZh: "Qwen 视频检测",
    autoLabelEn: "Qwen Video Detect",
  },
  {
    id: "qwen-vl-plus-video-detect",
    label: "Qwen VL Plus Video Detection via DashScope (Legacy)",
    provider: "aliyun",
    mode: "video-detection",
    tabs: ["detect_video"],
    region: "domestic",
    optionLabelZh: "Qwen VL Plus · 视频检测（旧版兼容）",
    optionLabelEn: "Qwen VL Plus · Video Detection (Legacy)",
    autoLabelZh: "Qwen 视频检测",
    autoLabelEn: "Qwen Video Detect",
    legacy: true,
  },
  {
    id: "qwen3-omni-flash-realtime-detect",
    label: "Qwen3 Omni Flash Realtime Detection via DashScope",
    provider: "aliyun",
    mode: "audio-detection",
    tabs: ["detect_audio"],
    region: "domestic",
    optionLabelZh: "Qwen3 Omni Flash · 音频检测",
    optionLabelEn: "Qwen3 Omni Flash · Audio Detection",
    autoLabelZh: "Qwen 音频检测",
    autoLabelEn: "Qwen Audio Detect",
  },
  {
    id: "openai/gpt-5-nano",
    label: "GPT-5 Nano via Replicate",
    provider: "replicate",
    mode: "file-generation",
    tabs: ["text"],
    region: "international",
    optionLabelZh: "GPT-5 Nano · 文档生成",
    optionLabelEn: "GPT-5 Nano · Document Generation",
    autoLabelZh: "GPT-5 Nano 文档",
    autoLabelEn: "GPT-5 Nano Docs",
  },
  {
    id: "prunaai/flux.1-dev-lora",
    label: "FLUX.1 Dev LoRA via Replicate",
    provider: "replicate",
    mode: "image-generation",
    tabs: ["image"],
    region: "international",
    optionLabelZh: "FLUX.1 Dev LoRA · 图片生成",
    optionLabelEn: "FLUX.1 Dev LoRA · Text to Image",
    autoLabelZh: "FLUX 图片",
    autoLabelEn: "FLUX Image",
  },
  {
    id: "minimax/speech-2.8-turbo",
    label: "MiniMax Speech 2.8 Turbo via Replicate",
    provider: "replicate",
    mode: "audio-generation",
    tabs: ["audio"],
    region: "international",
    optionLabelZh: "MiniMax Speech 2.8 Turbo · 语音生成",
    optionLabelEn: "MiniMax Speech 2.8 Turbo · Text to Speech",
    autoLabelZh: "MiniMax 语音",
    autoLabelEn: "MiniMax Speech",
  },
  {
    id: "wan-video/wan-2.2-t2v-fast",
    label: "Wan 2.2 Fast via Replicate",
    provider: "replicate",
    mode: "video-generation",
    tabs: ["video"],
    region: "international",
    optionLabelZh: "Wan 2.2 Fast · 视频生成",
    optionLabelEn: "Wan 2.2 Fast · Text to Video",
    autoLabelZh: "Wan 视频",
    autoLabelEn: "Wan Video",
  },
  {
    id: "openai/gpt-5-nano-edit",
    label: "GPT-5 Nano via Replicate",
    provider: "replicate",
    mode: "file-editing",
    tabs: ["edit_text"],
    region: "international",
    optionLabelZh: "GPT-5 Nano · 文档编辑",
    optionLabelEn: "GPT-5 Nano · Document Editing",
    autoLabelZh: "GPT-5 Nano 编辑",
    autoLabelEn: "GPT-5 Nano Edit",
  },
  {
    id: "espressotechie/qwen-imgedit-4bit",
    label: "Qwen ImgEdit 4bit via Replicate",
    provider: "replicate",
    mode: "image-editing",
    tabs: ["edit_image"],
    region: "international",
    optionLabelZh: "Qwen ImgEdit 4bit · 图片编辑",
    optionLabelEn: "Qwen ImgEdit 4bit · Image Editing",
    autoLabelZh: "Qwen 图片编辑",
    autoLabelEn: "Qwen Image Edit",
  },
  {
    id: "lightricks/ltx-video-0.9.7-distilled",
    label: "LTX Video 0.9.7 Distilled via Replicate",
    provider: "replicate",
    mode: "video-editing",
    tabs: ["edit_video"],
    region: "international",
    optionLabelZh: "LTX Video 0.9.7 Distilled · 视频编辑",
    optionLabelEn: "LTX Video 0.9.7 Distilled · Video Editing",
    autoLabelZh: "LTX 视频编辑",
    autoLabelEn: "LTX Video Edit",
  },
  {
    id: "vaibhavs10/incredibly-fast-whisper+minimax/speech-02-turbo",
    label: "Whisper + MiniMax Speech 02 Turbo via Replicate",
    provider: "replicate",
    mode: "audio-editing",
    tabs: ["edit_audio"],
    region: "international",
    optionLabelZh: "Whisper + MiniMax Speech 02 Turbo · 音频编辑",
    optionLabelEn: "Whisper + MiniMax Speech 02 Turbo · Audio Editing",
    autoLabelZh: "Whisper 音频重配",
    autoLabelEn: "Whisper Audio Redub",
  },
  {
    id: "openai/gpt-5-nano-detect",
    label: "GPT-5 Nano Detection via Replicate",
    provider: "replicate",
    mode: "file-detection",
    tabs: ["detect_text"],
    region: "international",
    optionLabelZh: "GPT-5 Nano · 文档检测",
    optionLabelEn: "GPT-5 Nano · Docs Detection",
    autoLabelZh: "GPT-5 Nano 文档检测",
    autoLabelEn: "GPT-5 Nano Docs Detect",
  },
  {
    id: "openai/gpt-5-nano-image-detect",
    label: "GPT-5 Nano Image Detection via Replicate",
    provider: "replicate",
    mode: "image-detection",
    tabs: ["detect_image"],
    region: "international",
    optionLabelZh: "GPT-5 Nano · 图片检测",
    optionLabelEn: "GPT-5 Nano · Image Detection",
    autoLabelZh: "GPT-5 Nano 图片检测",
    autoLabelEn: "GPT-5 Nano Image Detect",
  },
  {
    id: "openai/gpt-5-nano-video-detect",
    label: "GPT-5 Nano Video Detection via Replicate",
    provider: "replicate",
    mode: "video-detection",
    tabs: ["detect_video"],
    region: "international",
    optionLabelZh: "GPT-5 Nano · 视频检测",
    optionLabelEn: "GPT-5 Nano · Video Detection",
    autoLabelZh: "GPT-5 Nano 视频检测",
    autoLabelEn: "GPT-5 Nano Video Detect",
  },
  {
    id: "lucataco/qwen2.5-omni-7b-detect",
    label: "Qwen2.5 Omni 7B Detection via Replicate",
    provider: "replicate",
    mode: "audio-detection",
    tabs: ["detect_audio"],
    region: "international",
    optionLabelZh: "Qwen2.5 Omni 7B · 音频检测",
    optionLabelEn: "Qwen2.5 Omni 7B · Audio Detection",
    autoLabelZh: "Qwen 音频检测",
    autoLabelEn: "Qwen Audio Detect",
  },
  ] as const;

const DEFAULT_MODEL_BY_TAB: Record<GenerationTab, string> = {
  text: DEFAULT_LANGUAGE === "zh" ? "qwen-flash" : "openai/gpt-5-nano",
  image: DEFAULT_LANGUAGE === "zh" ? "wanx2.0-t2i-turbo" : "prunaai/flux.1-dev-lora",
  video: DEFAULT_LANGUAGE === "zh" ? "wan2.2-i2v-flash" : "wan-video/wan-2.2-t2v-fast",
  audio:
    DEFAULT_LANGUAGE === "zh"
      ? "qwen3-tts-flash"
      : "minimax/speech-2.8-turbo",
  edit_text:
    DEFAULT_LANGUAGE === "zh" ? "qwen-flash-edit" : "openai/gpt-5-nano-edit",
  edit_image:
    DEFAULT_LANGUAGE === "zh" ? "wanx2.1-imageedit" : "espressotechie/qwen-imgedit-4bit",
  edit_audio:
    DEFAULT_LANGUAGE === "zh"
      ? "paraformer-v2-qwen3-tts-flash"
      : "vaibhavs10/incredibly-fast-whisper+minimax/speech-02-turbo",
  edit_video:
    DEFAULT_LANGUAGE === "zh" ? "wan2.2-i2v-flash" : "lightricks/ltx-video-0.9.7-distilled",
  detect_text:
    DEFAULT_LANGUAGE === "zh"
      ? "qwen-flash-detect"
      : "openai/gpt-5-nano-detect",
  detect_image:
    DEFAULT_LANGUAGE === "zh"
      ? "qwen3-vl-flash-image-detect"
      : "openai/gpt-5-nano-image-detect",
  detect_audio:
    DEFAULT_LANGUAGE === "zh"
      ? "qwen3-omni-flash-realtime-detect"
      : "lucataco/qwen2.5-omni-7b-detect",
  detect_video:
    DEFAULT_LANGUAGE === "zh"
      ? "qwen3-vl-flash-video-detect"
      : "openai/gpt-5-nano-video-detect",
};

function shouldIncludeGenerationModel(
  model: GenerationModelConfig,
  options?: { includeDisabled?: boolean; includeLegacy?: boolean },
) {
  if (!options?.includeLegacy && model.legacy) {
    return false;
  }

  if (options?.includeDisabled) {
    return true;
  }

  return isGenerationModelAvailable(model);
}

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
  return (
    value === "text" ||
    value === "image" ||
    value === "video" ||
    value === "audio" ||
    value === "edit_text" ||
    value === "edit_image" ||
    value === "edit_audio" ||
    value === "edit_video" ||
    value === "detect_text" ||
    value === "detect_image" ||
    value === "detect_audio" ||
    value === "detect_video"
  );
}

export function getDefaultModelIdForTab(tab: GenerationTab) {
  return DEFAULT_MODEL_BY_TAB[tab];
}

export function getGenerationModelsForTab(
  tab: GenerationTab,
  options?: { includeDisabled?: boolean; includeLegacy?: boolean },
) {
  return GENERATION_MODELS.filter(
    (model) => model.tabs.includes(tab) && shouldIncludeGenerationModel(model, options),
  );
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
  const models = getGenerationModelsForTab(tab, {
    includeDisabled: true,
    includeLegacy: true,
  });
  if (models.length === 0) {
    throw new Error("当前类型暂无可用模型。");
  }

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

export function getGenerationModelLabel(modelId: string, tab?: GenerationTab) {
  if (tab) {
    const tabMatchedModel = GENERATION_MODELS.find(
      (model) => model.id === modelId && model.tabs.includes(tab),
    );
    if (tabMatchedModel) {
      return tabMatchedModel.label;
    }
  }

  return (
    GENERATION_MODELS.find((model) => model.id === modelId)?.label ?? modelId
  );
}
