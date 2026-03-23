/**
 * 纯模型AI检测优化方案 - 无需外部API
 * 通过增强prompt和多轮验证提升准确率
 */

// ============ 音频检测优化 ============
export function buildAudioDetectionPrompt(fileName: string, locale: "zh" | "en") {
  if (locale === "zh") {
    return [
      `文件名：${fileName}`,
      "请从以下维度分析该音频是否为AI合成：",
      "1. 声音特征：音色是否过于完美、缺乏自然波动",
      "2. 韵律节奏：语速、停顿、重音是否过于规整",
      "3. 呼吸音：是否存在自然呼吸声、口水音等人声细节",
      "4. 情感表达：情绪变化是否自然、是否有机械感",
      "5. 背景噪声：是否完全干净（AI特征）或有环境音",
      "6. 音频伪影：是否有拼接痕迹、频谱异常",
      "请给出0-100的AI概率评分，并详细说明判断依据。"
    ].join("\n\n");
  }

  return [
    `File: ${fileName}`,
    "Analyze if this audio is AI-synthesized based on:",
    "1. Voice characteristics: overly perfect tone, lack of natural variation",
    "2. Prosody: unnaturally regular pace, pauses, stress patterns",
    "3. Breath sounds: presence of natural breathing, mouth sounds",
    "4. Emotional expression: natural emotion shifts vs mechanical feel",
    "5. Background noise: completely clean (AI trait) vs ambient sound",
    "6. Audio artifacts: splicing traces, spectral anomalies",
    "Provide 0-100 AI probability score with detailed reasoning."
  ].join("\n\n");
}

// ============ 图片检测优化 ============
export function buildImageDetectionPrompt(locale: "zh" | "en") {
  if (locale === "zh") {
    return [
      "请从以下维度分析该图片是否为AI生成：",
      "1. 纹理细节：局部纹理是否重复、不自然",
      "2. 边缘质量：物体边缘是否模糊、有伪影",
      "3. 光影一致性：光源方向、阴影是否符合物理规律",
      "4. 人体解剖：手指、五官、肢体比例是否正常",
      "5. 文字内容：文字是否清晰、有无乱码",
      "6. 透视关系：空间透视是否合理",
      "7. 对称性：过度对称（AI特征）或自然不���称",
      "8. 细节连贯性：放大后细节是否经得起推敲",
      "请给出0-100的AI概率评分，并详细说明判断依据。"
    ].join("\n\n");
  }

  return [
    "Analyze if this image is AI-generated based on:",
    "1. Texture details: repetitive or unnatural local textures",
    "2. Edge quality: blurry edges, artifacts around objects",
    "3. Lighting consistency: light direction, shadows follow physics",
    "4. Human anatomy: fingers, facial features, body proportions",
    "5. Text content: clarity, presence of gibberish",
    "6. Perspective: spatial perspective correctness",
    "7. Symmetry: over-symmetry (AI trait) vs natural asymmetry",
    "8. Detail coherence: details hold up under magnification",
    "Provide 0-100 AI probability score with detailed reasoning."
  ].join("\n\n");
}

// ============ 视频检测优化 ============
export function buildVideoDetectionPrompt(locale: "zh" | "en") {
  if (locale === "zh") {
    return [
      "你将收到视频的多个关键帧，请从以下维度分析：",
      "1. 帧间一致性：人物/物体在不同帧中是否保持一致",
      "2. 运动连贯性：动作是否流畅、有无跳跃",
      "3. 光影变化：光照变化是否符合运动轨迹",
      "4. 面部稳定性：面部特征是否在帧间漂移",
      "5. 背景一致性：背景元素是否稳定",
      "6. 唇音同步：说话时嘴型与声音是否匹配（如有音频）",
      "7. 物理规律：运动是否符合物理常识",
      "8. 时序伪影：是否有闪烁、突变等异常",
      "请分别评估每一帧，并给出整体0-100的AI概率评分。"
    ].join("\n\n");
  }

  return [
    "You will receive multiple keyframes. Analyze based on:",
    "1. Inter-frame consistency: person/object consistency across frames",
    "2. Motion continuity: smooth motion vs jumps",
    "3. Lighting changes: lighting follows motion trajectory",
    "4. Facial stability: facial features drift between frames",
    "5. Background consistency: background elements remain stable",
    "6. Lip sync: mouth movements match audio (if present)",
    "7. Physics: motion follows physical laws",
    "8. Temporal artifacts: flickering, sudden changes",
    "Evaluate each frame separately, then provide overall 0-100 AI probability."
  ].join("\n\n");
}

// ============ 文档检测优化 ============
export function buildDocumentDetectionPrompt(input: {
  fileName: string;
  extractedText: string;
  locale: "zh" | "en";
}) {
  if (input.locale === "zh") {
    return [
      `文件名：${input.fileName}`,
      "请从以下维度分析该文档是否为AI生成：",
      "1. 语言重复度：是否有大量重复的句式、词汇",
      "2. 结构均匀性：段落长度、结构是否过于规整",
      "3. 信息密度：内容是否空洞、缺乏具体细节",
      "4. 措辞风格：是否有模板化、机械化的表达",
      "5. 逻辑连贯性：论证是否有跳跃、缺乏深度",
      "6. 个性化特征：是否缺乏个人风格、口语化表达",
      "7. 错误类型：AI常见错误（事实错误、逻辑矛盾）vs人类错误（拼写、语法）",
      "8. 创新性：观点是否新颖还是常见套话",
      "文档内容：",
      input.extractedText.slice(0, 8000)
    ].join("\n\n");
  }

  return [
    `File: ${input.fileName}`,
    "Analyze if this document is AI-generated based on:",
    "1. Repetition: repetitive sentence patterns, vocabulary",
    "2. Structural uniformity: overly regular paragraph lengths, structure",
    "3. Information density: shallow content, lack of specific details",
    "4. Phrasing style: templated, mechanical expressions",
    "5. Logical coherence: reasoning jumps, lack of depth",
    "6. Personalization: lack of personal style, colloquialisms",
    "7. Error types: AI errors (factual, logical) vs human errors (spelling, grammar)",
    "8. Originality: novel insights vs common platitudes",
    "Document content:",
    input.extractedText.slice(0, 8000)
  ].join("\n\n");
}

// ============ 增强的系统指令 ============
export function buildEnhancedDetectionInstruction(
  target: "document" | "image" | "audio" | "video",
  locale: "zh" | "en"
) {
  if (locale === "zh") {
    return [
      `你是专业的${target === "document" ? "文档" : target === "image" ? "图片" : target === "audio" ? "音频" : "视频"}AI检测专家。`,
      "你的任务是基于专业知识判断内容是否为AI生成。",
      "",
      "评分标准：",
      "- 90-100分：几乎确定是AI生成，有多个明显特征",
      "- 70-89分：很可能是AI生成，有典型特征",
      "- 50-69分：不确定，特征不明显",
      "- 30-49分：更像人工创作，但有少量可疑点",
      "- 0-29分：几乎确定是人工创作",
      "",
      "置信度标准：",
      "- 80-100：有充分证据支持判断",
      "- 60-79：有一定证据但不够充分",
      "- 0-59：证据不足，主要靠经验判断",
      "",
      "返回严格JSON格式（不要Markdown代码块）：",
      '{"probability":0-100,"confidence":0-100,"verdict":"likely_ai|uncertain|likely_human","reasons":["具体依据1","具体依据2","具体依据3"]}',
      "",
      "重要提示：",
      "1. reasons必须具体，不要泛泛而谈",
      "2. 如果特征不明显，诚实地降低probability和confidence",
      "3. 不要编造无法观察到的细节"
    ].join("\n");
  }

  return [
    `You are a professional AI detection expert for ${target}.`,
    "Your task is to determine if content is AI-generated based on expertise.",
    "",
    "Scoring criteria:",
    "- 90-100: Almost certain AI, multiple obvious traits",
    "- 70-89: Likely AI, typical characteristics present",
    "- 50-69: Uncertain, features unclear",
    "- 30-49: More likely human, few suspicious points",
    "- 0-29: Almost certain human creation",
    "",
    "Confidence criteria:",
    "- 80-100: Strong evidence supports judgment",
    "- 60-79: Some evidence but insufficient",
    "- 0-59: Insufficient evidence, mainly experience-based",
    "",
    "Return strict JSON (no markdown blocks):",
    '{"probability":0-100,"confidence":0-100,"verdict":"likely_ai|uncertain|likely_human","reasons":["specific evidence 1","specific evidence 2","specific evidence 3"]}',
    "",
    "Important:",
    "1. Reasons must be specific, not generic",
    "2. If features unclear, honestly lower probability and confidence",
    "3. Do not fabricate unobservable details"
  ].join("\n");
}

// ============ 多轮验证策略（可选，提升准确率） ============
export interface MultiRoundDetectionConfig {
  enableSecondRound: boolean; // 当第一轮置信度<70时启用第二轮
  temperature: number; // 第二轮使用不同temperature
}

export const DEFAULT_DETECTION_CONFIG: MultiRoundDetectionConfig = {
  enableSecondRound: true,
  temperature: 0.3 // 第二轮使用稍高temperature增加多样性
};
