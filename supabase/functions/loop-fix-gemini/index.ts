import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface GeminiAnalysisRequest {
  audioPcm: string;
  sampleRate: number;
  targetBpm: number;
  bars: number;
}

interface GeminiAnalysisResponse {
  detected_bpm: number;
  confidence: number;
  downbeat_frames: number[];
  beat_frames: number[];
  transient_frames: number[];
  suggested_start_frame: number;
  seam_frame: number;
}

interface LoopFixRequest {
  audio_base64: string;
  target_bpm: number;
  bars: number;
  use_gemini?: boolean;
}

interface LoopFixDiagnostics {
  original_duration_frames: number;
  target_duration_frames: number;
  head_trim_frames: number;
  seam_location_frames: number;
  fade_samples: number;
  detected_bpm?: number;
  confidence?: number;
  stretch_ratio?: number;
  gemini_used: boolean;
  gemini_error?: string;
  suggested_start_frame?: number;
  seam_frame?: number;
  gemini_call_ms?: number;
  wsola_process_ms?: number;
  total_process_ms: number;
}

Deno.serve(async (req: Request) => {
  const startTime = performance.now();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: LoopFixRequest = await req.json();
    const { audio_base64, target_bpm, bars, use_gemini = true } = body;

    if (!audio_base64 || !target_bpm || !bars) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters: audio_base64, target_bpm, bars" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = Uint8Array.from(atob(audio_base64), c => c.charCodeAt(0));
    const view = new DataView(audioBuffer.buffer);

    const header = parseWavHeader(view);
    if (!header) {
      return new Response(
        JSON.stringify({ error: "Invalid WAV file format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pcmData = parsePcmData(view, header);

    let geminiAnalysis: GeminiAnalysisResponse | null = null;
    let geminiCallMs = 0;
    let wsolaProcessMs = 0;
    let geminiError: string | undefined;
    let stretchedPcm = pcmData;

    if (use_gemini && Deno.env.get("GEMINI_API_KEY")) {
      try {
        const geminiStart = performance.now();
        geminiAnalysis = await analyzeWithGemini(pcmData, header.sampleRate, target_bpm, bars);
        geminiCallMs = performance.now() - geminiStart;

        if (geminiAnalysis && geminiAnalysis.confidence >= 0.6) {
          const stretchRatio = geminiAnalysis.detected_bpm / target_bpm;

          if (stretchRatio >= 0.85 && stretchRatio <= 1.15) {
            const wsolaStart = performance.now();
            stretchedPcm = wsolaChannels(pcmData, header.sampleRate, stretchRatio);
            wsolaProcessMs = performance.now() - wsolaStart;

            console.log(`WSOLA applied: BPM ${geminiAnalysis.detected_bpm} → ${target_bpm}, ratio: ${stretchRatio.toFixed(3)}`);
          } else {
            console.log(`Stretch ratio ${stretchRatio.toFixed(3)} outside safe range (0.85-1.15), skipping WSOLA`);
          }
        }
      } catch (error) {
        geminiError = error instanceof Error ? error.message : String(error);
        console.error("Gemini analysis failed, falling back to heuristic method:", geminiError);
      }
    }

    const targetFrames = Math.round((60 / target_bpm) * 4 * bars * header.sampleRate);

    let headIndex = 0;
    if (geminiAnalysis?.suggested_start_frame !== undefined) {
      headIndex = Math.max(0, Math.min(geminiAnalysis.suggested_start_frame, stretchedPcm[0].length - targetFrames));
    } else {
      headIndex = detectHeadIndex(stretchedPcm, header.sampleRate);
    }

    const trimmed = stretchedPcm.map(ch => ch.slice(headIndex, headIndex + targetFrames));

    if (trimmed[0].length < targetFrames) {
      return new Response(
        JSON.stringify({ error: "Audio too short after processing" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let seamIndex = Math.floor(trimmed[0].length * 0.99);
    if (geminiAnalysis?.seam_frame !== undefined) {
      const relativeSeam = geminiAnalysis.seam_frame - headIndex;
      if (relativeSeam > 0 && relativeSeam < trimmed[0].length) {
        seamIndex = relativeSeam;
      }
    } else {
      seamIndex = findSeamIndex(trimmed);
    }

    const fadeSamples = Math.min(8192, Math.floor(trimmed[0].length * 0.05));
    applyEdgeRamps(trimmed, fadeSamples);
    applyCrossfade(trimmed, seamIndex, fadeSamples);

    const fixedWav = createWavFile(trimmed, header.sampleRate);
    const fixedBase64 = btoa(String.fromCharCode(...fixedWav));

    const totalProcessMs = performance.now() - startTime;

    const diagnostics: LoopFixDiagnostics = {
      original_duration_frames: pcmData[0].length,
      target_duration_frames: targetFrames,
      head_trim_frames: headIndex,
      seam_location_frames: seamIndex,
      fade_samples: fadeSamples,
      detected_bpm: geminiAnalysis?.detected_bpm,
      confidence: geminiAnalysis?.confidence,
      stretch_ratio: geminiAnalysis ? geminiAnalysis.detected_bpm / target_bpm : undefined,
      gemini_used: geminiAnalysis !== null && !geminiError,
      gemini_error: geminiError,
      suggested_start_frame: geminiAnalysis?.suggested_start_frame,
      seam_frame: geminiAnalysis?.seam_frame,
      gemini_call_ms: geminiCallMs,
      wsola_process_ms: wsolaProcessMs,
      total_process_ms: totalProcessMs,
    };

    return new Response(
      JSON.stringify({ fixed_audio_base64: fixedBase64 }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-LoopFix-Diagnostics": JSON.stringify(diagnostics),
        },
      }
    );
  } catch (error) {
    console.error("Loop fix error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function analyzeWithGemini(
  pcmData: Float32Array[],
  sampleRate: number,
  targetBpm: number,
  bars: number
): Promise<GeminiAnalysisResponse | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const wav = createWavFile(pcmData, sampleRate);
  const base64Audio = btoa(String.fromCharCode(...wav));
  const dataUri = `data:audio/wav;base64,${base64Audio}`;

  const prompt = `You are an expert audio engineer analyzing a techno music loop for perfect bar alignment.

Audio specs:
- Target BPM: ${targetBpm}
- Target bars: ${bars}
- Time signature: 4/4
- Sample rate: ${sampleRate} Hz

Your task:
1. Detect the actual BPM of this audio with high precision
2. Identify all downbeat positions (frame indices aligned to sample rate)
3. Find the optimal start frame near a strong downbeat with zero-crossing alignment
4. Identify the best seam frame for an equal-power crossfade that minimizes phase error

Requirements:
- The loop must be exactly ${bars} bars long at ${targetBpm} BPM
- Frame indices must be integers within audio bounds
- Prioritize strong transients and downbeats for start/seam points
- Consider phase continuity at the seam point

Return only the JSON data with no additional commentary.`;

  const requestBody = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: "audio/wav",
            data: base64Audio
          }
        }
      ]
    }],
    generationConfig: {
      response_mime_type: "application/json",
      response_schema: {
        type: "object",
        properties: {
          detected_bpm: { type: "number", minimum: 40, maximum: 300 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          downbeat_frames: { type: "array", items: { type: "integer" } },
          beat_frames: { type: "array", items: { type: "integer" } },
          transient_frames: { type: "array", items: { type: "integer" } },
          suggested_start_frame: { type: "integer" },
          seam_frame: { type: "integer" }
        },
        required: ["detected_bpm", "suggested_start_frame"],
        additionalProperties: false
      }
    },
    thinking_level: "high"
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error("Invalid Gemini API response structure");
    }

    const analysisText = data.candidates[0].content.parts[0].text;
    const analysis = JSON.parse(analysisText) as GeminiAnalysisResponse;

    if (analysis.suggested_start_frame < 0 || analysis.suggested_start_frame >= pcmData[0].length) {
      throw new Error("Invalid suggested_start_frame from Gemini");
    }

    return analysis;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Gemini API timeout after 30 seconds");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function wsolaChannels(channels: Float32Array[], sampleRate: number, stretchRatio: number): Float32Array[] {
  return channels.map(ch => wsolaTimeStretch(ch, sampleRate, stretchRatio));
}

function wsolaTimeStretch(input: Float32Array, sampleRate: number, stretchRatio: number): Float32Array {
  const grainSize = Math.round(0.032 * sampleRate);
  const overlap = Math.round(0.012 * sampleRate);
  const searchWindow = Math.round(0.014 * sampleRate);

  const outputLength = Math.floor(input.length / stretchRatio);
  const output = new Float32Array(outputLength);

  const window = new Float32Array(grainSize);
  for (let i = 0; i < grainSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
  }

  let inputPos = 0;
  let outputPos = 0;

  while (outputPos + grainSize < outputLength && inputPos + grainSize < input.length) {
    let bestOffset = 0;
    let bestCorrelation = -Infinity;

    const searchStart = Math.max(0, inputPos - searchWindow);
    const searchEnd = Math.min(input.length - grainSize, inputPos + searchWindow);

    for (let offset = searchStart; offset <= searchEnd; offset++) {
      let correlation = 0;
      for (let i = 0; i < overlap; i++) {
        const prevIdx = outputPos - overlap + i;
        if (prevIdx >= 0) {
          correlation += output[prevIdx] * input[offset + i];
        }
      }

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }

    for (let i = 0; i < grainSize; i++) {
      const idx = bestOffset + i;
      if (idx < input.length) {
        const outIdx = outputPos + i;
        if (outIdx < outputLength) {
          if (i < overlap && outputPos > 0) {
            const blendFactor = i / overlap;
            output[outIdx] = output[outIdx] * (1 - blendFactor) + input[idx] * window[i] * blendFactor;
          } else {
            output[outIdx] = input[idx] * window[i];
          }
        }
      }
    }

    const step = grainSize - overlap;
    inputPos = bestOffset + Math.round(step * stretchRatio);
    outputPos += step;
  }

  return output;
}

function parseWavHeader(view: DataView) {
  if (view.byteLength < 44) return null;

  const riff = String.fromCharCode(...[view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)]);
  const wave = String.fromCharCode(...[view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)]);

  if (riff !== "RIFF" || wave !== "WAVE") return null;

  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  let dataOffset = 44;
  while (dataOffset < view.byteLength - 8) {
    const chunkId = String.fromCharCode(...[
      view.getUint8(dataOffset),
      view.getUint8(dataOffset + 1),
      view.getUint8(dataOffset + 2),
      view.getUint8(dataOffset + 3)
    ]);
    const chunkSize = view.getUint32(dataOffset + 4, true);

    if (chunkId === "data") {
      dataOffset += 8;
      break;
    }
    dataOffset += 8 + chunkSize;
  }

  return { numChannels, sampleRate, bitsPerSample, dataOffset };
}

function parsePcmData(view: DataView, header: any): Float32Array[] {
  const { numChannels, bitsPerSample, dataOffset } = header;
  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = (view.byteLength - dataOffset) / bytesPerSample;
  const framesCount = Math.floor(totalSamples / numChannels);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(new Float32Array(framesCount));
  }

  let offset = dataOffset;
  for (let frame = 0; frame < framesCount; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = 0;
      if (bitsPerSample === 16) {
        sample = view.getInt16(offset, true) / 32768.0;
      } else if (bitsPerSample === 24) {
        const byte1 = view.getUint8(offset);
        const byte2 = view.getUint8(offset + 1);
        const byte3 = view.getInt8(offset + 2);
        sample = ((byte3 << 16) | (byte2 << 8) | byte1) / 8388608.0;
      } else if (bitsPerSample === 32) {
        sample = view.getFloat32(offset, true);
      }
      channels[ch][frame] = sample;
      offset += bytesPerSample;
    }
  }

  return channels;
}

function detectHeadIndex(channels: Float32Array[], sampleRate: number): number {
  const searchFrames = Math.min(Math.floor(sampleRate * 0.5), channels[0].length);
  const windowSize = Math.floor(sampleRate * 0.05);

  let maxEnergy = -Infinity;
  let peakIndex = 0;

  for (let i = 0; i < searchFrames - windowSize; i += Math.floor(windowSize / 4)) {
    let energy = 0;
    for (let ch = 0; ch < channels.length; ch++) {
      for (let j = 0; j < windowSize; j++) {
        const sample = channels[ch][i + j];
        energy += sample * sample;
      }
    }
    if (energy > maxEnergy) {
      maxEnergy = energy;
      peakIndex = i;
    }
  }

  for (let i = Math.max(0, peakIndex - 100); i < Math.min(peakIndex + 100, channels[0].length - 1); i++) {
    let allNearZero = true;
    for (let ch = 0; ch < channels.length; ch++) {
      if (Math.abs(channels[ch][i]) > 0.01) {
        allNearZero = false;
        break;
      }
    }
    if (allNearZero) {
      return i;
    }
  }

  return Math.max(0, peakIndex - Math.floor(windowSize / 2));
}

function findSeamIndex(channels: Float32Array[]): number {
  const length = channels[0].length;
  const searchStart = Math.floor(length * 0.95);
  const searchEnd = Math.floor(length * 0.995);

  let minError = Infinity;
  let bestSeam = searchStart;

  for (let i = searchStart; i < searchEnd; i++) {
    let error = 0;
    for (let ch = 0; ch < channels.length; ch++) {
      const diff = channels[ch][i] - channels[ch][0];
      error += diff * diff;
    }
    if (error < minError) {
      minError = error;
      bestSeam = i;
    }
  }

  return bestSeam;
}

function applyEdgeRamps(channels: Float32Array[], fadeSamples: number): void {
  for (let ch = 0; ch < channels.length; ch++) {
    for (let i = 0; i < fadeSamples; i++) {
      const gain = i / fadeSamples;
      channels[ch][i] *= gain;

      const endIdx = channels[ch].length - 1 - i;
      channels[ch][endIdx] *= gain;
    }
  }
}

function applyCrossfade(channels: Float32Array[], seamIndex: number, fadeSamples: number): void {
  const actualFade = Math.min(fadeSamples, seamIndex, channels[0].length - seamIndex);

  for (let ch = 0; ch < channels.length; ch++) {
    for (let i = 0; i < actualFade; i++) {
      const t = i / actualFade;
      const gainOut = Math.sqrt(1 - t);
      const gainIn = Math.sqrt(t);

      const tailIdx = seamIndex + i;
      const headIdx = i;

      const blended = channels[ch][tailIdx] * gainOut + channels[ch][headIdx] * gainIn;
      channels[ch][tailIdx] = blended;
    }
  }
}

function createWavFile(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numChannels = channels.length;
  const numFrames = channels[0].length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = numFrames * numChannels * bytesPerSample;
  const fileSize = 44 + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, fileSize - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][frame]));
      const intSample = Math.round(sample * 32767);
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}
