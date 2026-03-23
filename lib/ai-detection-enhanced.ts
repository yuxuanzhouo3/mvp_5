/**
 * 增强型AI检测 - 集成专业检测服务
 */

type SpecialistDetectionVerdict = "likely_ai" | "uncertain" | "likely_human";

interface SpecialistDetectionResult {
  probability: number;
  confidence: number;
  verdict: SpecialistDetectionVerdict;
  reasons: string[];
  voiceprintScore?: number;
  spectralAnomalies?: string[];
  frameProbabilities?: number[];
}

function buildBearerHeaders(apiKey?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey ?? ""}`,
  };
}

function buildTokenHeaders(apiKey?: string): Record<string, string> {
  return {
    Authorization: `Token ${apiKey ?? ""}`,
  };
}

function buildApiKeyHeaders(headerName: string, apiKey?: string): Record<string, string> {
  return {
    [headerName]: apiKey ?? "",
  };
}

async function detectAudioWithSpecialist(audioFile: File): Promise<SpecialistDetectionResult> {
  const formData = new FormData();
  formData.append("audio", audioFile);

  const response = await fetch("https://api.resemble.ai/v2/detect", {
    method: "POST",
    headers: buildBearerHeaders(process.env.RESEMBLE_API_KEY),
    body: formData,
  });

  const result = (await response.json()) as any;

  return {
    probability: result.ai_probability * 100,
    confidence: result.confidence * 100,
    verdict:
      result.ai_probability > 0.7
        ? "likely_ai"
        : result.ai_probability < 0.3
          ? "likely_human"
          : "uncertain",
    reasons: [
      `声纹分析: ${result.voiceprint_match ? "检测到合成声纹特征" : "自然人声特征"}`,
      `频谱异常: ${(result.spectral_artifacts ?? []).join("、")}`,
      `韵律分析: ${result.prosody_score > 0.8 ? "过于规整(AI特征)" : "自然变化"}`,
      `呼吸音: ${result.breath_detection ? "存在" : "缺失(AI特征)"}`,
    ],
    voiceprintScore: result.voiceprint_similarity,
    spectralAnomalies: result.spectral_artifacts,
  };
}

async function detectImageWithSpecialist(imageFile: File): Promise<SpecialistDetectionResult> {
  const formData = new FormData();
  formData.append("media", imageFile);

  const response = await fetch("https://api.thehive.ai/api/v2/task/sync", {
    method: "POST",
    headers: buildTokenHeaders(process.env.HIVE_API_KEY),
    body: formData,
  });

  const result = (await response.json()) as any;
  const aiClass = result.status?.[0]?.response?.output?.find(
    (item: any) => item.class === "ai_generated",
  );

  return {
    probability: (aiClass?.score ?? 0) * 100,
    confidence: 85,
    verdict:
      (aiClass?.score ?? 0) > 0.7
        ? "likely_ai"
        : (aiClass?.score ?? 0) < 0.3
          ? "likely_human"
          : "uncertain",
    reasons: [
      `GAN指纹检测: ${result.gan_fingerprint ? "发现生成模型特征" : "未检测到"}`,
      `JPEG压缩异常: ${result.compression_artifacts}`,
      `边缘一致性: ${result.edge_coherence_score < 0.6 ? "存在伪影" : "正常"}`,
      `频域分析: ${result.frequency_analysis}`,
    ],
  };
}

async function detectVideoWithSpecialist(videoFile: File): Promise<SpecialistDetectionResult> {
  const formData = new FormData();
  formData.append("video", videoFile);

  const response = await fetch("https://api.deepware.ai/v1/scan", {
    method: "POST",
    headers: buildApiKeyHeaders("X-API-Key", process.env.DEEPWARE_API_KEY),
    body: formData,
  });

  const result = (await response.json()) as any;

  return {
    probability: result.deepfake_probability * 100,
    confidence: result.confidence * 100,
    verdict:
      result.deepfake_probability > 0.7
        ? "likely_ai"
        : result.deepfake_probability < 0.3
          ? "likely_human"
          : "uncertain",
    reasons: [
      `面部一致性: ${result.face_consistency_score}`,
      `时序伪影: ${(result.temporal_artifacts ?? []).join("、")}`,
      `唇音同步: ${result.lip_sync_score < 0.7 ? "不自然(AI特征)" : "正常"}`,
      `光影连续性: ${result.lighting_continuity}`,
    ],
    frameProbabilities: result.frame_scores,
  };
}

async function detectDocumentWithSpecialist(text: string): Promise<SpecialistDetectionResult> {
  const response = await fetch("https://api.gptzero.me/v2/predict/text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildApiKeyHeaders("x-api-key", process.env.GPTZERO_API_KEY),
    },
    body: JSON.stringify({ document: text }),
  });

  const result = (await response.json()) as any;
  const document = result.documents?.[0] ?? {};
  const sentences = Array.isArray(document.sentences) ? document.sentences : [];

  return {
    probability: (document.average_generated_prob ?? 0) * 100,
    confidence: 90,
    verdict:
      (document.completely_generated_prob ?? 0) > 0.7
        ? "likely_ai"
        : (document.completely_generated_prob ?? 0) < 0.3
          ? "likely_human"
          : "uncertain",
    reasons: [
      `句子级检测: ${sentences.filter((sentence: any) => sentence.generated_prob > 0.7).length}/${sentences.length} 句疑似AI`,
      `困惑度分析: ${document.perplexity} (越低越像AI)`,
      `突发性分析: ${document.burstiness} (AI文本突发性低)`,
      `写作模式: ${document.writing_style}`,
    ],
  };
}

export {
  detectAudioWithSpecialist,
  detectImageWithSpecialist,
  detectVideoWithSpecialist,
  detectDocumentWithSpecialist,
};
