import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface GeminiAnalysisResponse {
  detected_bpm: number;
  confidence: number;
  downbeat_frames: number[];
  beat_frames: number[];
  transient_frames: number[];
  suggested_start_frame: number;
  seam_frame: number;
  alternative_start_frames?: number[];
  alternative_seam_frames?: number[];
  tempo_stability?: number;
  transient_strengths?: number[];
}

interface LoopFixRequest {
  audio_base64: string;
  target_bpm: number;
  bars: number;
  use_gemini?: boolean;
  stem_type?: string;
  user_id?: string;
  session_id?: string;
  prompt_text?: string;
  prompt_bars?: number;
  playback_bars?: number;
  generation_bars?: number;
  sample_rate?: number;
  source_frames?: number;
  audio_duration_sec?: number;
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
  model_used: string;
  cache_hit: boolean;
  gemini_error?: string;
  suggested_start_frame?: number;
  seam_frame?: number;
  gemini_call_ms?: number;
  wsola_process_ms?: number;
  total_process_ms: number;
  quality_score?: number;
  fallback_reason?: string;
  retry_count?: number;
}

interface WSOLAParams {
  grainSize: number;
  overlap: number;
  searchWindow: number;
}

function toPositiveInt(value: number | undefined | null, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(1, Math.round(fallback));
  return Math.max(1, Math.round(n));
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
  const startTime = performance.now();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body: LoopFixRequest = await req.json();
    const {
      audio_base64,
      target_bpm,
      bars,
      use_gemini = true,
      stem_type,
      user_id,
      session_id,
      prompt_text,
      prompt_bars,
      playback_bars,
      generation_bars,
      sample_rate,
      source_frames,
      audio_duration_sec
    } = body;

    if (!audio_base64 || !target_bpm || !bars) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters: audio_base64, target_bpm, bars" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decode audio
    const data = audio_base64.split(',').pop() || audio_base64;
    const bin = atob(data);
    const audioBuffer = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      audioBuffer[i] = bin.charCodeAt(i);
    }

    console.log(`[LoopFix] Processing: ${audioBuffer.length} bytes, ${target_bpm} BPM, ${bars} bars, stem: ${stem_type || 'unknown'}`);

    // Parse WAV
    const view = new DataView(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength);
    const header = parseWavHeader(view);
    if (!header) {
      return new Response(
        JSON.stringify({ error: "Invalid WAV file format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pcmData = parsePcmData(view, header);
    const audioDurationSeconds = pcmData[0].length / header.sampleRate;
    const sourceDurationSeconds = Number.isFinite(audio_duration_sec)
      ? Number(audio_duration_sec)
      : audioDurationSeconds;
    const sourceFramesCount = Number.isFinite(source_frames)
      ? Math.max(1, Math.round(Number(source_frames)))
      : pcmData[0].length;
    const promptBarsNormalized = toPositiveInt(prompt_bars, bars);
    const playbackBarsNormalized = toPositiveInt(playback_bars, Math.max(1, Math.round(promptBarsNormalized / 2)));
    const generationBarsNormalized = toPositiveInt(generation_bars, promptBarsNormalized);
    const targetBars = playbackBarsNormalized || promptBarsNormalized || bars;
    const sampleRateHint = Number.isFinite(sample_rate) ? Number(sample_rate) : header.sampleRate;
    const inferredPromptBars = sourceDurationSeconds && target_bpm
      ? Math.max(1, Math.round((sourceDurationSeconds * target_bpm) / (60 * 4)))
      : null;

    // Calculate audio hash for caching
    const audioHash = await calculateAudioHash(audioBuffer);

    let geminiAnalysis: GeminiAnalysisResponse | null = null;
    let geminiCallMs = 0;
    let wsolaProcessMs = 0;

    console.log(
      `[LoopFix] Context → promptBars=${promptBarsNormalized}, playbackBars=${playbackBarsNormalized}, generationBars=${generationBarsNormalized}, duration=${sourceDurationSeconds?.toFixed(2) || 'n/a'}s, frames=${sourceFramesCount}`
    );
    let geminiError: string | undefined;
    let stretchedPcm = pcmData;
    let modelUsed = "heuristic";
    let cacheHit = false;
    let retryCount = 0;
    let fallbackReason: string | undefined;

    // Try to get cached analysis
    if (use_gemini) {
      const cachedAnalysis = await getCachedAnalysis(supabase, audioHash, target_bpm, bars, stem_type);
      if (cachedAnalysis) {
        geminiAnalysis = cachedAnalysis.analysis;
        modelUsed = cachedAnalysis.model_used;
        cacheHit = true;
        console.log(`[LoopFix] Cache hit! Model: ${modelUsed}, Confidence: ${geminiAnalysis.confidence}`);
      }
    }

    // Perform Gemini analysis if not cached
    if (use_gemini && !cacheHit && Deno.env.get("GEMINI_API_KEY")) {
      try {
        const geminiStart = performance.now();
        const result = await analyzeWithGeminiMultiModel(
          pcmData,
          header.sampleRate,
          target_bpm,
          generationBarsNormalized,
          stem_type,
          prompt_text,
          playbackBarsNormalized,
          sourceDurationSeconds,
          sourceFramesCount
        );

        geminiAnalysis = result.analysis;
        modelUsed = result.modelUsed;
        retryCount = result.retryCount;
        geminiCallMs = performance.now() - geminiStart;

        // Cache the analysis if successful
        if (geminiAnalysis && geminiAnalysis.confidence >= 0.5) {
          await cacheAnalysis(
            supabase,
            audioHash,
            audioDurationSeconds,
            target_bpm,
            generationBarsNormalized,
            stem_type,
            geminiAnalysis,
            modelUsed
          );
        }

        console.log(`[LoopFix] Gemini analysis: Model=${modelUsed}, BPM=${geminiAnalysis?.detected_bpm}, Confidence=${geminiAnalysis?.confidence}, Retries=${retryCount}`);
      } catch (error) {
        geminiError = error instanceof Error ? error.message : String(error);
        fallbackReason = `Gemini failed: ${geminiError}`;
        console.error("[LoopFix] Gemini analysis failed:", geminiError);
      }
    }

    // Apply WSOLA time-stretching if needed
    if (geminiAnalysis && geminiAnalysis.confidence >= 0.5) {
      const stretchRatio = geminiAnalysis.detected_bpm / target_bpm;

      if (stretchRatio >= 0.75 && stretchRatio <= 1.25) {
        const wsolaStart = performance.now();
        const wsolaParams = getAdaptiveWSOLAParams(stem_type, target_bpm, stretchRatio);
        stretchedPcm = wsolaChannels(pcmData, header.sampleRate, stretchRatio, wsolaParams);
        wsolaProcessMs = performance.now() - wsolaStart;

        console.log(`[LoopFix] WSOLA applied: ${geminiAnalysis.detected_bpm} → ${target_bpm} BPM, ratio: ${stretchRatio.toFixed(3)}`);
      } else {
        console.log(`[LoopFix] Stretch ratio ${stretchRatio.toFixed(3)} outside safe range (0.75-1.25), skipping WSOLA`);
        fallbackReason = `Stretch ratio ${stretchRatio.toFixed(3)} out of range`;
      }
    } else if (geminiAnalysis && geminiAnalysis.confidence < 0.5) {
      fallbackReason = `Low confidence: ${geminiAnalysis.confidence.toFixed(2)}`;
      console.log(`[LoopFix] Low confidence (${geminiAnalysis.confidence}), using heuristic method`);
    }

    // Trim to exact bar length (playback-aware)
    const targetFrames = Math.round((60 / target_bpm) * 4 * targetBars * sampleRateHint);
    const effectiveTargetFrames = Math.min(targetFrames, stretchedPcm[0].length);

    let headIndex = 0;
    if (geminiAnalysis?.suggested_start_frame !== undefined && geminiAnalysis.confidence >= 0.5) {
      headIndex = Math.max(0, Math.min(geminiAnalysis.suggested_start_frame, stretchedPcm[0].length - effectiveTargetFrames));
    } else {
      headIndex = detectHeadIndexEnhanced(stretchedPcm, header.sampleRate, stem_type);
    }

    const trimmed = stretchedPcm.map(ch => ch.slice(headIndex, headIndex + effectiveTargetFrames));

    if (trimmed[0].length < effectiveTargetFrames) {
      return new Response(
        JSON.stringify({ error: "Audio too short after processing" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find optimal seam point
    let seamIndex = Math.floor(trimmed[0].length * 0.99);
    if (geminiAnalysis?.seam_frame !== undefined && geminiAnalysis.confidence >= 0.5) {
      const relativeSeam = geminiAnalysis.seam_frame - headIndex;
      if (relativeSeam > 0 && relativeSeam < trimmed[0].length) {
        seamIndex = relativeSeam;
      }
    } else {
      seamIndex = findSeamIndexEnhanced(trimmed);
    }

    // Apply crossfade
    const fadeSamples = calculateOptimalFadeSamples(trimmed, stem_type);
    applyEdgeRamps(trimmed, fadeSamples);
    applyCrossfade(trimmed, seamIndex, fadeSamples);

    // Calculate quality score
    const qualityScore = calculateQualityScore(
      trimmed,
      geminiAnalysis,
      seamIndex,
      fadeSamples,
      effectiveTargetFrames
    );

    // Create output WAV
    const fixedWav = createWavFile(trimmed, header.sampleRate);

    // Convert to base64
    let fixedBinary = '';
    const chunkSize = 8192;
    for (let i = 0; i < fixedWav.length; i += chunkSize) {
      const chunk = fixedWav.subarray(i, Math.min(i + chunkSize, fixedWav.length));
      fixedBinary += String.fromCharCode(...chunk);
    }
    const fixedBase64 = btoa(fixedBinary);

    const totalProcessMs = performance.now() - startTime;

    // Build diagnostics
    const diagnostics: LoopFixDiagnostics = {
      original_duration_frames: pcmData[0].length,
      target_duration_frames: effectiveTargetFrames,
      head_trim_frames: headIndex,
      seam_location_frames: seamIndex,
      fade_samples: fadeSamples,
      detected_bpm: geminiAnalysis?.detected_bpm,
      confidence: geminiAnalysis?.confidence,
      stretch_ratio: geminiAnalysis ? geminiAnalysis.detected_bpm / target_bpm : undefined,
      gemini_used: geminiAnalysis !== null && !geminiError,
      model_used: modelUsed,
      cache_hit: cacheHit,
      prompt_bars: promptBarsNormalized,
      playback_bars: playbackBarsNormalized,
      generation_bars: generationBarsNormalized,
      source_frames: sourceFramesCount,
      source_duration_seconds: sourceDurationSeconds,
      inferred_prompt_bars: inferredPromptBars,
      gemini_error: geminiError,
      suggested_start_frame: geminiAnalysis?.suggested_start_frame,
      seam_frame: geminiAnalysis?.seam_frame,
      gemini_call_ms: geminiCallMs,
      wsola_process_ms: wsolaProcessMs,
      total_process_ms: totalProcessMs,
      quality_score: qualityScore,
      fallback_reason: fallbackReason,
      retry_count: retryCount,
    };

    // Log analytics
    await logAnalytics(supabase, {
      user_id,
      session_id,
      stem_type,
      target_bpm,
      bars: targetBars,
      audio_duration_seconds: audioDurationSeconds,
      audio_size_bytes: audioBuffer.length,
      model_used: modelUsed,
      gemini_used: diagnostics.gemini_used,
      cache_hit: cacheHit,
      detected_bpm: geminiAnalysis?.detected_bpm,
      confidence: geminiAnalysis?.confidence,
      stretch_ratio: diagnostics.stretch_ratio,
      gemini_call_ms: geminiCallMs,
      wsola_process_ms: wsolaProcessMs,
      total_process_ms: totalProcessMs,
      quality_score: qualityScore,
      error_occurred: !!geminiError,
      error_message: geminiError,
      fallback_used: !!fallbackReason,
    });

    console.log(`[LoopFix] Complete: ${totalProcessMs.toFixed(0)}ms, Quality: ${qualityScore}/100, Method: ${modelUsed}`);

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
    console.error("[LoopFix] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================================
// GEMINI ANALYSIS WITH MULTI-MODEL STRATEGY
// ============================================================================

async function analyzeWithGeminiMultiModel(
  pcmData: Float32Array[],
  sampleRate: number,
  targetBpm: number,
  bars: number,
  stemType?: string,
  promptText?: string,
  playbackBars?: number,
  sourceDurationSeconds?: number,
  sourceFrames?: number
): Promise<{ analysis: GeminiAnalysisResponse; modelUsed: string; retryCount: number }> {
  const models = [
    { name: "gemini-2.0-flash-exp", timeout: 30000, cost: 0.0002 },
    { name: "gemini-2.5-flash", timeout: 45000, cost: 0.0003 }
  ];

  let lastError: Error | null = null;
  let totalRetries = 0;

  for (const model of models) {
    try {
      console.log(`[Gemini] Trying model: ${model.name}`);
        const analysis = await analyzeWithGemini(
          pcmData,
          sampleRate,
          targetBpm,
          bars,
          stemType,
          model.name,
          model.timeout,
          promptText,
          playbackBars,
          sourceDurationSeconds,
          sourceFrames
        );

      if (analysis && analysis.confidence >= 0.5) {
        return { analysis, modelUsed: model.name, retryCount: totalRetries };
      } else {
        console.log(`[Gemini] ${model.name} returned low confidence: ${analysis?.confidence}`);
        lastError = new Error(`Low confidence: ${analysis?.confidence}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[Gemini] ${model.name} failed:`, lastError.message);

      // Retry on transient errors
      if (lastError.message.includes("429") || lastError.message.includes("503") || lastError.message.includes("timeout")) {
        totalRetries++;
        if (totalRetries < 2) {
          const backoff = Math.min(1000 * Math.pow(2, totalRetries), 5000);
          console.log(`[Gemini] Retrying ${model.name} after ${backoff}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoff));

          try {
            const analysis = await analyzeWithGemini(
              pcmData,
              sampleRate,
              targetBpm,
              bars,
              stemType,
              model.name,
              model.timeout,
              promptText,
              playbackBars,
              sourceDurationSeconds,
              sourceFrames
            );
            if (analysis && analysis.confidence >= 0.5) {
              return { analysis, modelUsed: model.name, retryCount: totalRetries };
            }
          } catch (retryError) {
            console.error(`[Gemini] Retry failed:`, retryError);
          }
        }
      }
    }
  }

  throw lastError || new Error("All Gemini models failed");
}

async function analyzeWithGemini(
  pcmData: Float32Array[],
  sampleRate: number,
  targetBpm: number,
  bars: number,
  stemType: string | undefined,
  modelName: string,
  timeout: number,
  promptText?: string,
  playbackBars?: number,
  sourceDurationSeconds?: number,
  sourceFrames?: number
): Promise<GeminiAnalysisResponse | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const wav = createWavFile(pcmData, sampleRate);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < wav.length; i += chunkSize) {
    const chunk = wav.subarray(i, Math.min(i + chunkSize, wav.length));
    binary += String.fromCharCode(...chunk);
  }
  const base64Audio = btoa(binary);

  // Enhanced prompt with stem-type awareness
  const prompt = buildEnhancedPrompt(
    targetBpm,
    bars,
    sampleRate,
    stemType,
    promptText,
    playbackBars,
    sourceDurationSeconds,
    sourceFrames
  );

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
          detected_bpm: {
            type: "number",
            minimum: 40,
            maximum: 300,
            description: "Detected BPM with high precision"
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Analysis confidence (0-1)"
          },
          downbeat_frames: {
            type: "array",
            items: { type: "integer" },
            description: "Frame indices of downbeats"
          },
          beat_frames: {
            type: "array",
            items: { type: "integer" },
            description: "Frame indices of all beats"
          },
          transient_frames: {
            type: "array",
            items: { type: "integer" },
            description: "Strong transient positions"
          },
          suggested_start_frame: {
            type: "integer",
            description: "Optimal loop start frame"
          },
          seam_frame: {
            type: "integer",
            description: "Optimal crossfade seam frame"
          },
          alternative_start_frames: {
            type: "array",
            items: { type: "integer" },
            description: "Alternative start points ranked by quality"
          },
          alternative_seam_frames: {
            type: "array",
            items: { type: "integer" },
            description: "Alternative seam points ranked by quality"
          },
          tempo_stability: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Tempo consistency throughout (0-1)"
          },
          transient_strengths: {
            type: "array",
            items: { type: "number" },
            description: "Relative strength of each transient"
          }
        },
        required: ["detected_bpm", "confidence", "suggested_start_frame", "seam_frame"]
      }
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
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

    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
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
      throw new Error(`Gemini API timeout after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildEnhancedPrompt(
  targetBpm: number,
  bars: number,
  sampleRate: number,
  stemType?: string,
  promptText?: string,
  playbackBars?: number,
  sourceDurationSeconds?: number,
  sourceFrames?: number
): string {
  const stemContext = getStemTypeContext(stemType);
  const userIntent = promptText?.trim()
    ? `USER PROMPT / INTENT: ${promptText.trim()}`
    : 'USER PROMPT / INTENT: <not provided; follow stem style and tempo strictly>';
  const playbackInfo = playbackBars
    ? `Playback target: ${playbackBars} bars (system may generate ~${bars} bars for analysis headroom).`
    : `Playback target: ${Math.max(1, Math.round(bars / 2))} bars (generation length: ${bars} bars).`;
  const lengthInfo = sourceDurationSeconds
    ? `Source length: ${sourceDurationSeconds.toFixed(2)} sec${sourceFrames ? ` (~${sourceFrames} frames)` : ''}.`
    : sourceFrames
      ? `Source frames: ${sourceFrames}.`
      : 'Source length: <unknown>.';

  return `You are an expert audio engineer analyzing a ${stemType || 'techno music'} loop for bar-perfect alignment.

${userIntent}

AUDIO SPECIFICATIONS:
- Target BPM: ${targetBpm}
- Generation bars (raw input): ${bars}
- ${playbackInfo}
- Time signature: 4/4
- Sample rate: ${sampleRate} Hz
- Content type: ${stemContext.description}
- ${lengthInfo}

YOUR TASK:
1. Detect the ACTUAL BPM with ±0.1 BPM precision
2. Identify ALL downbeat positions (frame indices of bar 1, beat 1)
3. Identify ALL beat positions (frame indices of all beats)
4. Locate ALL strong transients (${stemContext.transients})
5. Find the OPTIMAL loop start frame with these criteria:
   ${stemContext.startCriteria}
   Never start inside the body of a kick/bass transient—start at the initial attack or clean zero-crossing.
6. Find the OPTIMAL seam frame (crossfade point) with these criteria:
   ${stemContext.seamCriteria}
7. Provide ALTERNATIVES: List 2-3 alternative start/seam points ranked by quality
8. Assess TEMPO STABILITY: Rate how consistent the tempo is (0=drift, 1=rock solid)

ANALYSIS REQUIREMENTS:
- Frame indices must be integers within audio bounds
- Prioritize ${stemContext.priority}
- Consider phase continuity at loop boundaries
- Ensure the loop will be exactly ${playbackBars || Math.max(1, Math.round(bars / 2))} bars at ${targetBpm} BPM for playback, using extra material only for analysis
- Rate your confidence based on signal clarity and beat consistency

QUALITY CHECKLIST:
✓ Start frame on or near zero-crossing
✓ Start frame on strong ${stemContext.transients}
✓ Seam frame has minimal amplitude difference with start
✓ Beat spacing is consistent throughout
✓ No tempo drift or rubato detected

Return comprehensive JSON with all requested fields including alternatives.`;
}

function getStemTypeContext(stemType?: string): {
  description: string;
  transients: string;
  startCriteria: string;
  seamCriteria: string;
  priority: string;
} {
  const contexts: Record<string, any> = {
    kick: {
      description: "kick drum loop with strong low-frequency transients",
      transients: "kick drum hits with sharp attack",
      startCriteria: "- Must align EXACTLY with kick drum transient\n   - Prefer the strongest kick hit in the first beat\n   - Zero-crossing within ±100 samples of kick attack",
      seamCriteria: "- Must align with similar kick transient at loop end\n   - Match phase of low frequencies\n   - Minimize sub-bass discontinuity",
      priority: "transient sharpness and phase coherence in low frequencies"
    },
    bass: {
      description: "bass line with sustained tones and possible note changes",
      transients: "note onset positions and pitch changes",
      startCriteria: "- Align with note onset or stable sustain portion\n   - Ensure phase alignment for smooth bass continuation\n   - Prefer downbeat or strong beat position",
      seamCriteria: "- Match harmonic content between start and seam\n   - Ensure smooth pitch transition\n   - Phase-align fundamental frequency",
      priority: "harmonic continuity and smooth pitch transitions"
    },
    lead: {
      description: "melodic lead synth or instrument",
      transients: "note attacks and melodic phrase boundaries",
      startCriteria: "- Start at phrase beginning or strong note onset\n   - Consider melodic context\n   - Natural breathing point in melody",
      seamCriteria: "- Match melodic phrase structure\n   - Smooth harmonic transition\n   - Musical resolution point",
      priority: "musical phrasing and harmonic resolution"
    },
    pad: {
      description: "atmospheric pad or sustained chord",
      transients: "chord changes and swell points",
      startCriteria: "- Start at chord onset or stable sustain\n   - Less critical timing\n   - Natural entry point",
      seamCriteria: "- Smooth amplitude transition\n   - Match harmonic content\n   - Long crossfade acceptable",
      priority: "smooth amplitude and harmonic transitions"
    },
    hihat: {
      description: "hi-hat or cymbal pattern with rapid transients",
      transients: "individual hi-hat hits",
      startCriteria: "- Start on closed hi-hat or first hit of pattern\n   - Precise timing critical\n   - Match rhythmic pattern",
      seamCriteria: "- Match hi-hat pattern phase\n   - Preserve high-frequency detail\n   - Short precise crossfade",
      priority: "rhythmic precision and high-frequency preservation"
    },
    perc: {
      description: "percussion elements with varied rhythmic patterns",
      transients: "percussion hits and rhythmic accents",
      startCriteria: "- Start on strongest percussion hit\n   - Align with rhythmic pattern\n   - Clear attack point",
      seamCriteria: "- Match rhythmic pattern phase\n   - Preserve transient clarity\n   - Consider polyrhythmic elements",
      priority: "rhythmic accuracy and transient preservation"
    }
  };

  return contexts[stemType || ""] || {
    description: "music loop with rhythmic and harmonic content",
    transients: "beat positions and strong attacks",
    startCriteria: "- Align with downbeat or strong beat\n   - Clear attack point\n   - Zero-crossing preferred",
    seamCriteria: "- Match energy and phase with start\n   - Smooth harmonic transition\n   - Minimize discontinuity",
    priority: "beat alignment and phase coherence"
  };
}

// ============================================================================
// CACHING FUNCTIONS
// ============================================================================

async function calculateAudioHash(audioBuffer: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", audioBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getCachedAnalysis(
  supabase: any,
  audioHash: string,
  targetBpm: number,
  bars: number,
  stemType?: string
): Promise<{ analysis: GeminiAnalysisResponse; model_used: string } | null> {
  const { data, error } = await supabase
    .from("loop_fix_cache")
    .select("*")
    .eq("audio_hash", audioHash)
    .eq("target_bpm", targetBpm)
    .eq("bars", bars)
    .eq("stem_type", stemType || null)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  // Increment hit count
  await supabase.rpc("increment_cache_hit_count", { cache_id: data.id });

  return {
    analysis: {
      detected_bpm: data.detected_bpm,
      confidence: data.confidence,
      downbeat_frames: data.downbeat_frames || [],
      beat_frames: data.beat_frames || [],
      transient_frames: data.transient_frames || [],
      suggested_start_frame: data.suggested_start_frame,
      seam_frame: data.seam_frame,
      ...(data.analysis_metadata || {})
    },
    model_used: data.model_used
  };
}

async function cacheAnalysis(
  supabase: any,
  audioHash: string,
  audioDurationSeconds: number,
  targetBpm: number,
  bars: number,
  stemType: string | undefined,
  analysis: GeminiAnalysisResponse,
  modelUsed: string
): Promise<void> {
  const qualityScore = Math.round(analysis.confidence * 100);

  await supabase
    .from("loop_fix_cache")
    .upsert({
      audio_hash: audioHash,
      audio_duration_seconds: audioDurationSeconds,
      target_bpm: targetBpm,
      bars: bars,
      stem_type: stemType || null,
      model_used: modelUsed,
      detected_bpm: analysis.detected_bpm,
      confidence: analysis.confidence,
      downbeat_frames: analysis.downbeat_frames || [],
      beat_frames: analysis.beat_frames || [],
      transient_frames: analysis.transient_frames || [],
      suggested_start_frame: analysis.suggested_start_frame,
      seam_frame: analysis.seam_frame,
      analysis_metadata: {
        alternative_start_frames: analysis.alternative_start_frames,
        alternative_seam_frames: analysis.alternative_seam_frames,
        tempo_stability: analysis.tempo_stability,
        transient_strengths: analysis.transient_strengths
      },
      quality_score: qualityScore
    }, {
      onConflict: "audio_hash"
    });
}

async function logAnalytics(supabase: any, data: any): Promise<void> {
  try {
    await supabase
      .from("loop_fix_analytics")
      .insert({
        user_id: data.user_id || null,
        session_id: data.session_id || null,
        stem_type: data.stem_type || "unknown",
        target_bpm: data.target_bpm,
        bars: data.bars,
        audio_duration_seconds: data.audio_duration_seconds,
        audio_size_bytes: data.audio_size_bytes,
        model_used: data.model_used,
        gemini_used: data.gemini_used,
        cache_hit: data.cache_hit,
        detected_bpm: data.detected_bpm,
        confidence: data.confidence,
        stretch_ratio: data.stretch_ratio,
        gemini_call_ms: data.gemini_call_ms,
        wsola_process_ms: data.wsola_process_ms,
        total_process_ms: data.total_process_ms,
        quality_score: data.quality_score,
        error_occurred: data.error_occurred,
        error_message: data.error_message,
        fallback_used: data.fallback_used,
        estimated_cost_usd: calculateEstimatedCost(data.model_used, data.audio_size_bytes, data.cache_hit)
      });
  } catch (error) {
    console.error("[LoopFix] Failed to log analytics:", error);
  }
}

function calculateEstimatedCost(modelUsed: string, audioSizeBytes: number, cacheHit: boolean): number {
  if (cacheHit) return 0;

  const costPerKB: Record<string, number> = {
    "gemini-2.0-flash-exp": 0.0001,
    "gemini-2.5-flash": 0.00015,
    "heuristic": 0
  };

  const cost = (costPerKB[modelUsed] || 0) * (audioSizeBytes / 1024);
  return Math.round(cost * 1000000) / 1000000; // Round to 6 decimals
}

// ============================================================================
// ADAPTIVE WSOLA PARAMETERS
// ============================================================================

function getAdaptiveWSOLAParams(stemType: string | undefined, targetBpm: number, stretchRatio: number): WSOLAParams {
  const baseSampleRate = 44100;

  const profiles: Record<string, WSOLAParams> = {
    kick: {
      grainSize: Math.round(0.020 * baseSampleRate),  // 20ms - preserve transients
      overlap: Math.round(0.008 * baseSampleRate),    // 8ms
      searchWindow: Math.round(0.010 * baseSampleRate)
    },
    hihat: {
      grainSize: Math.round(0.015 * baseSampleRate),  // 15ms - ultra precise
      overlap: Math.round(0.006 * baseSampleRate),    // 6ms
      searchWindow: Math.round(0.008 * baseSampleRate)
    },
    perc: {
      grainSize: Math.round(0.018 * baseSampleRate),  // 18ms
      overlap: Math.round(0.007 * baseSampleRate),
      searchWindow: Math.round(0.009 * baseSampleRate)
    },
    bass: {
      grainSize: Math.round(0.040 * baseSampleRate),  // 40ms - smooth low freq
      overlap: Math.round(0.015 * baseSampleRate),    // 15ms
      searchWindow: Math.round(0.020 * baseSampleRate)
    },
    lead: {
      grainSize: Math.round(0.035 * baseSampleRate),  // 35ms
      overlap: Math.round(0.013 * baseSampleRate),
      searchWindow: Math.round(0.018 * baseSampleRate)
    },
    pad: {
      grainSize: Math.round(0.050 * baseSampleRate),  // 50ms - very smooth
      overlap: Math.round(0.020 * baseSampleRate),    // 20ms
      searchWindow: Math.round(0.025 * baseSampleRate)
    }
  };

  let params = profiles[stemType || ""] || {
    grainSize: Math.round(0.032 * baseSampleRate),   // 32ms default
    overlap: Math.round(0.012 * baseSampleRate),     // 12ms
    searchWindow: Math.round(0.014 * baseSampleRate)
  };

  // Adjust based on stretch ratio - more overlap for extreme stretches
  if (Math.abs(stretchRatio - 1.0) > 0.1) {
    params.overlap = Math.round(params.overlap * 1.3);
    params.searchWindow = Math.round(params.searchWindow * 1.2);
  }

  // Adjust based on tempo - faster tempos need smaller grains
  if (targetBpm > 140) {
    params.grainSize = Math.round(params.grainSize * 0.85);
    params.overlap = Math.round(params.overlap * 0.85);
  } else if (targetBpm < 110) {
    params.grainSize = Math.round(params.grainSize * 1.15);
    params.overlap = Math.round(params.overlap * 1.15);
  }

  return params;
}

// ============================================================================
// ENHANCED DETECTION ALGORITHMS
// ============================================================================

function detectHeadIndexEnhanced(channels: Float32Array[], sampleRate: number, stemType?: string): number {
  const searchFrames = Math.min(Math.floor(sampleRate * 0.5), channels[0].length);
  const windowSize = Math.floor(sampleRate * 0.05);

  // Energy-based detection
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

  // For kick/perc stems, refine to nearest zero-crossing
  if (stemType === "kick" || stemType === "perc" || stemType === "hihat") {
    for (let i = Math.max(0, peakIndex - 200); i < Math.min(peakIndex + 200, channels[0].length - 1); i++) {
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
  }

  return Math.max(0, peakIndex - Math.floor(windowSize / 2));
}

function findSeamIndexEnhanced(channels: Float32Array[]): number {
  const length = channels[0].length;
  const searchStart = Math.floor(length * 0.94);  // Expanded search range
  const searchEnd = Math.floor(length * 0.998);

  let minError = Infinity;
  let bestSeam = searchStart;

  // Find frame with minimum phase error
  for (let i = searchStart; i < searchEnd; i += 2) {  // Step by 2 for speed
    let error = 0;

    // Compare with loop start
    for (let ch = 0; ch < channels.length; ch++) {
      const diff = channels[ch][i] - channels[ch][0];
      error += diff * diff;

      // Also check slope continuity
      if (i < length - 1) {
        const slope1 = channels[ch][i + 1] - channels[ch][i];
        const slope2 = channels[ch][1] - channels[ch][0];
        error += Math.abs(slope1 - slope2) * 0.5;
      }
    }

    if (error < minError) {
      minError = error;
      bestSeam = i;
    }
  }

  return bestSeam;
}

function calculateOptimalFadeSamples(channels: Float32Array[], stemType?: string): number {
  const length = channels[0].length;
  const maxFade = Math.min(8192, Math.floor(length * 0.05));

  // Stem-specific fade lengths
  const fadeProfiles: Record<string, number> = {
    kick: Math.min(4096, maxFade),     // Short fade for transients
    hihat: Math.min(2048, maxFade),    // Very short for hi-hats
    perc: Math.min(3072, maxFade),     // Short for percussion
    bass: Math.min(6144, maxFade),     // Medium for bass
    lead: Math.min(6144, maxFade),     // Medium for leads
    pad: maxFade                        // Long fade for pads
  };

  return fadeProfiles[stemType || ""] || Math.min(8192, maxFade);
}

// ============================================================================
// QUALITY SCORING
// ============================================================================

function calculateQualityScore(
  channels: Float32Array[],
  analysis: GeminiAnalysisResponse | null,
  seamIndex: number,
  fadeSamples: number,
  targetFrames: number
): number {
  let score = 50;  // Base score

  // Confidence score (0-30 points)
  if (analysis && analysis.confidence) {
    score += Math.round(analysis.confidence * 30);
  }

  // Duration accuracy (0-15 points)
  const actualFrames = channels[0].length;
  const durationError = Math.abs(actualFrames - targetFrames) / targetFrames;
  score += Math.round((1 - Math.min(durationError, 1)) * 15);

  // Seam quality (0-15 points)
  let seamError = 0;
  const checkRange = Math.min(100, fadeSamples);
  for (let ch = 0; ch < channels.length; ch++) {
    for (let i = 0; i < checkRange; i++) {
      const tailIdx = seamIndex + i;
      const headIdx = i;
      if (tailIdx < channels[ch].length && headIdx < channels[ch].length) {
        const diff = channels[ch][tailIdx] - channels[ch][headIdx];
        seamError += diff * diff;
      }
    }
  }
  const seamQuality = 1 / (1 + seamError / checkRange);
  score += Math.round(seamQuality * 15);

  // Energy consistency (0-10 points)
  const energyStart = calculateRMSEnergy(channels, 0, Math.min(1024, channels[0].length));
  const energyEnd = calculateRMSEnergy(channels, Math.max(0, channels[0].length - 1024), channels[0].length);
  const energyBalance = 1 - Math.abs(energyStart - energyEnd) / Math.max(energyStart, energyEnd);
  score += Math.round(energyBalance * 10);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateRMSEnergy(channels: Float32Array[], start: number, end: number): number {
  let sum = 0;
  let count = 0;
  for (let ch = 0; ch < channels.length; ch++) {
    for (let i = start; i < end && i < channels[ch].length; i++) {
      sum += channels[ch][i] * channels[ch][i];
      count++;
    }
  }
  return Math.sqrt(sum / Math.max(count, 1));
}

// ============================================================================
// WSOLA TIME-STRETCHING (ENHANCED)
// ============================================================================

function wsolaChannels(
  channels: Float32Array[],
  sampleRate: number,
  stretchRatio: number,
  params: WSOLAParams
): Float32Array[] {
  return channels.map(ch => wsolaTimeStretch(ch, sampleRate, stretchRatio, params));
}

function wsolaTimeStretch(
  input: Float32Array,
  sampleRate: number,
  stretchRatio: number,
  params: WSOLAParams
): Float32Array {
  const { grainSize, overlap, searchWindow } = params;

  const outputLength = Math.floor(input.length / stretchRatio);
  const output = new Float32Array(outputLength);

  // Hanning window
  const window = new Float32Array(grainSize);
  for (let i = 0; i < grainSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
  }

  let inputPos = 0;
  let outputPos = 0;

  while (outputPos + grainSize < outputLength && inputPos + grainSize < input.length) {
    let bestOffset = inputPos;
    let bestCorrelation = -Infinity;

    const searchStart = Math.max(0, inputPos - searchWindow);
    const searchEnd = Math.min(input.length - grainSize, inputPos + searchWindow);

    // Cross-correlation search
    for (let offset = searchStart; offset <= searchEnd; offset++) {
      let correlation = 0;
      for (let i = 0; i < overlap; i++) {
        const prevIdx = outputPos - overlap + i;
        if (prevIdx >= 0 && prevIdx < output.length) {
          correlation += output[prevIdx] * input[offset + i];
        }
      }

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }

    // Copy and blend grain
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

// ============================================================================
// WAV FILE HANDLING
// ============================================================================

function parseWavHeader(view: DataView) {
  if (view.byteLength < 44) {
    console.error(`WAV file too small: ${view.byteLength} bytes`);
    return null;
  }

  const riff = String.fromCharCode(...[view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)]);
  const wave = String.fromCharCode(...[view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)]);

  if (riff !== "RIFF" || wave !== "WAVE") {
    console.error(`Invalid WAV format: RIFF="${riff}", WAVE="${wave}"`);
    return null;
  }

  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  let dataOffset = 44;
  let foundData = false;

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
      foundData = true;
      break;
    }

    if (chunkSize <= 0 || chunkSize > view.byteLength || (dataOffset + 8 + chunkSize) > view.byteLength) {
      break;
    }

    dataOffset += 8 + chunkSize;
  }

  if (!foundData) {
    dataOffset = 44;
  }

  return { numChannels, sampleRate, bitsPerSample, dataOffset };
}

function parsePcmData(view: DataView, header: any): Float32Array[] {
  const { numChannels, bitsPerSample, dataOffset } = header;
  const bytesPerSample = bitsPerSample / 8;
  const remainingBytes = view.byteLength - dataOffset;

  if (remainingBytes <= 0) {
    throw new Error(`Invalid data offset: ${dataOffset}`);
  }

  const totalSamples = remainingBytes / bytesPerSample;
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
      channels[ch][frame] = Math.max(-1.0, Math.min(1.0, sample));
      offset += bytesPerSample;
    }
  }

  return channels;
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
