import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-requested-with",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Credentials": "true",
};

// Mapping from internal stem types to ElevenLabs separation stem types
const STEM_TYPE_MAPPING: Record<string, string> = {
  kick: "drums",
  perc: "drums",
  perc2: "drums",
  hihat: "drums",
  bass: "bass",
  lead: "instruments",
  pad: "instruments",
  arp: "instruments",
  fx: "instruments",
};

interface SeparationRequest {
  audioData: string; // base64 encoded audio
  stemType: string; // internal stem type (kick, bass, etc)
  outputFormat?: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  // Health check endpoint
  if (req.method === "GET") {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    return new Response(
      JSON.stringify({
        status: "healthy",
        service: "separate-stems",
        version: "1.0.0",
        apiKeyConfigured: !!apiKey,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    const startTime = Date.now();
    console.log("[separate-stems] Received request", {
      method: req.method,
      url: req.url,
      timestamp: new Date().toISOString(),
    });

    // Parse request body
    const body: SeparationRequest = await req.json();
    const { audioData, stemType, outputFormat = "mp3_44100_128" } = body;

    if (!audioData || !stemType) {
      console.error("[separate-stems] Missing required fields:", {
        hasAudioData: !!audioData,
        hasStemType: !!stemType,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: audioData and stemType are required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("[separate-stems] Request params:", {
      stemType,
      outputFormat,
      audioDataLength: audioData.length,
    });

    // Get API key from environment
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      console.error("[separate-stems] ELEVENLABS_API_KEY not configured");
      console.error("[separate-stems] Available env vars:", Object.keys(Deno.env.toObject()));
      return new Response(
        JSON.stringify({
          success: false,
          error: "API key not configured",
          hint: "Please configure ELEVENLABS_API_KEY in Supabase project secrets",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("[separate-stems] API key configured:", apiKey.substring(0, 8) + "...");

    // Convert base64 to binary
    console.log("[separate-stems] Decoding base64 audio data...");
    const binaryAudio = Uint8Array.from(atob(audioData), (c) => c.charCodeAt(0));
    console.log("[separate-stems] Binary audio size:", binaryAudio.length, "bytes");

    // Create multipart form data
    const formData = new FormData();
    const audioBlob = new Blob([binaryAudio], { type: "audio/wav" });
    formData.append("file", audioBlob, "audio.wav");
    formData.append("output_format", outputFormat);

    console.log("[separate-stems] Calling ElevenLabs API...");

    // Call ElevenLabs stem separation API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout

    try {
      const response = await fetch(
        "https://api.elevenlabs.io/v1/music/stem-separation",
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
          },
          body: formData,
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      console.log("[separate-stems] ElevenLabs response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error("[separate-stems] ElevenLabs API error:", {
          status: response.status,
          error: errorText,
        });

        let errorMessage = "Stem separation failed";
        let hint = "";

        if (response.status === 401) {
          errorMessage = "Authentication failed";
          hint = "Invalid API key";
        } else if (response.status === 422) {
          errorMessage = "Invalid audio format";
          hint = "The audio file may be corrupted or in an unsupported format";
        } else if (response.status === 413) {
          errorMessage = "Audio file too large";
          hint = "Try a shorter audio clip";
        } else if (response.status === 429) {
          errorMessage = "Rate limit exceeded";
          hint = "Please wait a moment and try again";
        } else if (response.status >= 500) {
          errorMessage = "Service temporarily unavailable";
          hint = "Please try again in a moment";
        }

        return new Response(
          JSON.stringify({
            success: false,
            error: errorMessage,
            hint,
            statusCode: response.status,
          }),
          {
            status: response.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Get the ZIP file
      console.log("[separate-stems] Downloading ZIP file...");
      const zipData = await response.arrayBuffer();
      console.log("[separate-stems] ZIP file size:", zipData.byteLength, "bytes");

      // Parse ZIP file to extract stems
      console.log("[separate-stems] Extracting stems from ZIP...");
      const stems = await extractStemsFromZip(zipData);

      console.log("[separate-stems] Extracted stems:", Object.keys(stems));

      // Determine which stem to return based on the requested instrument type
      const targetStemType = STEM_TYPE_MAPPING[stemType] || "instruments";
      console.log("[separate-stems] Mapping", stemType, "to", targetStemType);

      const selectedStem = stems[targetStemType];
      if (!selectedStem) {
        console.error("[separate-stems] Target stem not found in ZIP:", {
          targetStemType,
          availableStems: Object.keys(stems),
        });
        return new Response(
          JSON.stringify({
            success: false,
            error: "Target stem not found in separation result",
            hint: `Expected '${targetStemType}' but only found: ${Object.keys(stems).join(", ")}`,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      console.log("[separate-stems] Selected stem size:", selectedStem.length, "bytes");

      // Convert to base64 for transmission
      const base64Audio = btoa(String.fromCharCode(...selectedStem));
      console.log("[separate-stems] Base64 audio length:", base64Audio.length, "characters");

      const duration = Date.now() - startTime;
      console.log("[separate-stems] Success! Total processing time:", duration, "ms");

      return new Response(
        JSON.stringify({
          success: true,
          audioData: base64Audio,
          stemType: targetStemType,
          requestedInstrument: stemType,
          format: outputFormat,
          processingTimeMs: duration,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError.name === "AbortError") {
        console.error("[separate-stems] Request timeout");
        return new Response(
          JSON.stringify({
            success: false,
            error: "Request timeout",
            hint: "Stem separation took too long. Please try with a shorter audio clip.",
          }),
          {
            status: 504,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      throw fetchError;
    }
  } catch (error) {
    let duration = 0;
    try {
      duration = Date.now() - startTime;
    } catch {}
    console.error("[separate-stems] Unexpected error after", duration, "ms:", error);
    console.error("[separate-stems] Error details:", {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error",
        hint: error?.message || "An unexpected error occurred",
        errorType: error?.name || "UnknownError",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Extract audio stems from a ZIP file
 * Returns an object with stem types as keys and Uint8Array audio data as values
 */
async function extractStemsFromZip(zipData: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  const stems: Record<string, Uint8Array> = {};

  try {
    // Use JSZip-like approach with native Deno APIs
    // For now, we'll use a simple ZIP parser
    const view = new DataView(zipData);
    let offset = 0;

    // Simple ZIP parsing - looking for local file headers (signature: 0x04034b50)
    while (offset < view.byteLength - 30) {
      const signature = view.getUint32(offset, true);

      if (signature === 0x04034b50) {
        // Local file header found
        const filenameLength = view.getUint16(offset + 26, true);
        const extraFieldLength = view.getUint16(offset + 28, true);
        const compressedSize = view.getUint32(offset + 18, true);
        const compressionMethod = view.getUint16(offset + 8, true);

        // Extract filename
        const filenameBytes = new Uint8Array(zipData, offset + 30, filenameLength);
        const filename = new TextDecoder().decode(filenameBytes);

        console.log("[zip-parser] Found file:", filename, "size:", compressedSize);

        // Get file data (skip header + filename + extra field)
        const dataOffset = offset + 30 + filenameLength + extraFieldLength;
        const fileData = new Uint8Array(zipData, dataOffset, compressedSize);

        // Determine stem type from filename
        const lowerFilename = filename.toLowerCase();
        if (lowerFilename.includes("vocal")) {
          stems["vocals"] = fileData;
        } else if (lowerFilename.includes("drum")) {
          stems["drums"] = fileData;
        } else if (lowerFilename.includes("bass")) {
          stems["bass"] = fileData;
        } else if (lowerFilename.includes("instrument") || lowerFilename.includes("other")) {
          stems["instruments"] = fileData;
        }

        // Move to next file
        offset = dataOffset + compressedSize;
      } else {
        offset++;
      }
    }

    console.log("[zip-parser] Extracted stems:", Object.keys(stems));
    return stems;
  } catch (error) {
    console.error("[zip-parser] Error parsing ZIP:", error);
    throw new Error("Failed to parse ZIP file: " + error.message);
  }
}
