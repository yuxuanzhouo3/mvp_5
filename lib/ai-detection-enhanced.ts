/**
 * 增强型AI检测 - 集成专业检测服务
 */

// ============ 音频检测 ============
interface AudioDetectionResult {
  probability: number;
  confidence: number;
  verdict: 'likely_ai' | 'uncertain' | 'likely_human';
  reasons: string[];
  voiceprintScore?: number; // 声纹相似度
  spectralAnomalies?: string[]; // 频谱异常
}

async function detectAudioWithSpecialist(audioFile: File): Promise<AudioDetectionResult> {
  // 方案1: 使用 Resemble AI Voice Detection API
  // https://www.resemble.ai/voice-detection/
  const formData = new FormData();
  formData.append('audio', audioFile);

  const response = await fetch('https://api.resemble.ai/v2/detect', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEMBLE_API_KEY}` },
    body: formData
  });

  const result = await response.json();

  return {
    probability: result.ai_probability * 100,
    confidence: result.confidence * 100,
    verdict: result.ai_probability > 0.7 ? 'likely_ai' :
             result.ai_probability < 0.3 ? 'likely_human' : 'uncertain',
    reasons: [
      `声纹分析: ${result.voiceprint_match ? '检测到合成声纹特征' : '自然人声特征'}`,
      `频谱异常: ${result.spectral_artifacts.join('、')}`,
      `韵律分析: ${result.prosody_score > 0.8 ? '过于规整(AI特征)' : '自然变化'}`,
      `呼吸音: ${result.breath_detection ? '存在' : '缺失(AI特征)'}`
    ],
    voiceprintScore: result.voiceprint_similarity,
    spectralAnomalies: result.spectral_artifacts
  };
}

// ============ 图片检测 ============
async function detectImageWithSpecialist(imageFile: File): Promise<AudioDetectionResult> {
  // 方案1: Hive AI Content Detection
  // https://thehive.ai/apis/content-detection
  const formData = new FormData();
  formData.append('media', imageFile);

  const response = await fetch('https://api.thehive.ai/api/v2/task/sync', {
    method: 'POST',
    headers: { 'Authorization': `Token ${process.env.HIVE_API_KEY}` },
    body: formData
  });

  const result = await response.json();
  const aiClass = result.status[0].response.output.find((c: any) => c.class === 'ai_generated');

  return {
    probability: aiClass.score * 100,
    confidence: 85,
    verdict: aiClass.score > 0.7 ? 'likely_ai' :
             aiClass.score < 0.3 ? 'likely_human' : 'uncertain',
    reasons: [
      `GAN指纹检测: ${result.gan_fingerprint ? '发现生成模型特征' : '未检测到'}`,
      `JPEG压缩异常: ${result.compression_artifacts}`,
      `边缘一致性: ${result.edge_coherence_score < 0.6 ? '存在伪影' : '正常'}`,
      `频域分析: ${result.frequency_analysis}`
    ]
  };
}

// ============ 视频检测 ============
async function detectVideoWithSpecialist(videoFile: File): Promise<AudioDetectionResult> {
  // 方案: Deepware Scanner API
  // https://scanner.deepware.ai/
  const formData = new FormData();
  formData.append('video', videoFile);

  const response = await fetch('https://api.deepware.ai/v1/scan', {
    method: 'POST',
    headers: { 'X-API-Key': process.env.DEEPWARE_API_KEY },
    body: formData
  });

  const result = await response.json();

  return {
    probability: result.deepfake_probability * 100,
    confidence: result.confidence * 100,
    verdict: result.deepfake_probability > 0.7 ? 'likely_ai' :
             result.deepfake_probability < 0.3 ? 'likely_human' : 'uncertain',
    reasons: [
      `面部一致性: ${result.face_consistency_score}`,
      `时序伪影: ${result.temporal_artifacts.join('、')}`,
      `唇音同步: ${result.lip_sync_score < 0.7 ? '不自然(AI特征)' : '正常'}`,
      `光影连续性: ${result.lighting_continuity}`
    ],
    frameProbabilities: result.frame_scores
  };
}

// ============ 文档检测 ============
async function detectDocumentWithSpecialist(text: string): Promise<AudioDetectionResult> {
  // 方案: GPTZero API (专业AI文本检测)
  // https://gptzero.me/
  const response = await fetch('https://api.gptzero.me/v2/predict/text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.GPTZERO_API_KEY
    },
    body: JSON.stringify({ document: text })
  });

  const result = await response.json();

  return {
    probability: result.documents[0].average_generated_prob * 100,
    confidence: 90,
    verdict: result.documents[0].completely_generated_prob > 0.7 ? 'likely_ai' :
             result.documents[0].completely_generated_prob < 0.3 ? 'likely_human' : 'uncertain',
    reasons: [
      `句子级检测: ${result.documents[0].sentences.filter((s: any) => s.generated_prob > 0.7).length}/${result.documents[0].sentences.length} 句疑似AI`,
      `困惑度分析: ${result.documents[0].perplexity} (越低越像AI)`,
      `突发性分析: ${result.documents[0].burstiness} (AI文本突发性低)`,
      `写作模式: ${result.documents[0].writing_style}`
    ]
  };
}

export {
  detectAudioWithSpecialist,
  detectImageWithSpecialist,
  detectVideoWithSpecialist,
  detectDocumentWithSpecialist
};
