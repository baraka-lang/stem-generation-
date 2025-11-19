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

    // Parse request body with validation
    let body: SeparationRequest;
    try {
      body = await req.json();
    } catch (jsonError) {
      console.error("[separate-stems] Invalid JSON in request body:", jsonError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid request body",
          hint: "Request body must be valid JSON",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { audioData, stemType, outputFormat = "mp3_44100_128" } = body;

    // Validate required fields
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

    // Validate stem type
    if (!STEM_TYPE_MAPPING[stemType]) {
      console.error("[separate-stems] Invalid stem type:", stemType);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid stem type: ${stemType}`,
          hint: `Valid stem types are: ${Object.keys(STEM_TYPE_MAPPING).join(", ")}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate base64 format
    if (typeof audioData !== "string" || audioData.length === 0) {
      console.error("[separate-stems] Invalid audioData format");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid audioData format",
          hint: "audioData must be a non-empty base64 encoded string",
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
      audioDataSizeMB: (audioData.length / 1024 / 1024).toFixed(2),
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

    // Convert base64 to binary with validation
    console.log("[separate-stems] Decoding base64 audio data...");
    let binaryAudio: Uint8Array;
    try {
      const binaryString = atob(audioData);
      binaryAudio = Uint8Array.from(binaryString, (c) => c.charCodeAt(0));

      if (binaryAudio.length === 0) {
        throw new Error("Decoded audio data is empty");
      }

      console.log("[separate-stems] Binary audio size:", binaryAudio.length, "bytes", `(${(binaryAudio.length / 1024 / 1024).toFixed(2)} MB)`);

      // Validate it looks like valid audio (check for WAV or other audio headers)
      if (binaryAudio.length < 44) {
        console.warn("[separate-stems] Audio data seems too small to be a valid audio file");
      }

      // Check for WAV header
      const header = String.fromCharCode(binaryAudio[0], binaryAudio[1], binaryAudio[2], binaryAudio[3]);
      if (header === "RIFF") {
        console.log("[separate-stems] Detected WAV format");
      } else {
        console.log("[separate-stems] Audio format header:", header);
      }
    } catch (decodeError) {
      console.error("[separate-stems] Failed to decode base64 audio:", decodeError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to decode audio data",
          hint: "Audio data must be valid base64 encoded",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

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

      // Convert to base64 for transmission (chunked for large files)
      let base64Audio: string;
      try {
        if (selectedStem.length > 1024 * 1024) {
          // For large files, chunk the conversion to avoid call stack overflow
          console.log("[separate-stems] Using chunked base64 encoding for large file");
          const chunkSize = 65536;
          const chunks: string[] = [];
          for (let i = 0; i < selectedStem.length; i += chunkSize) {
            const chunk = selectedStem.slice(i, i + chunkSize);
            chunks.push(String.fromCharCode(...chunk));
          }
          base64Audio = btoa(chunks.join(""));
        } else {
          base64Audio = btoa(String.fromCharCode(...selectedStem));
        }
        console.log("[separate-stems] Base64 audio length:", base64Audio.length, "characters");
      } catch (encodeError) {
        console.error("[separate-stems] Failed to encode audio to base64:", encodeError);
        return new Response(
          JSON.stringify({
            success: false,
            error: "Failed to encode separated audio",
            hint: "Audio data encoding failed. Try a shorter audio clip.",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

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
 * Decompress DEFLATE compressed data
 */
function decompressDEFLATE(compressedData: Uint8Array): Uint8Array {
  try {
    // Use Deno's built-in DecompressionStream
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(compressedData);
        controller.close();
      }
    });

    const decompressedStream = stream.pipeThrough(
      new DecompressionStream("deflate-raw")
    );

    // Convert stream to Uint8Array
    const reader = decompressedStream.getReader();
    const chunks: Uint8Array[] = [];

    return (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Combine all chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    })();
  } catch (error) {
    console.error("[zip-parser] DEFLATE decompression failed:", error);
    throw new Error("Failed to decompress ZIP entry: " + error.message);
  }
}

/**
 * Extract audio stems from a ZIP file
 * Returns an object with stem types as keys and Uint8Array audio data as values
 */
async function extractStemsFromZip(zipData: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  const stems: Record<string, Uint8Array> = {};

  try {
    console.log("[zip-parser] Starting ZIP extraction, size:", zipData.byteLength, "bytes");

    // Validate ZIP file signature
    const view = new DataView(zipData);
    if (view.byteLength < 30) {
      throw new Error("ZIP file too small to contain valid entries");
    }

    let offset = 0;
    let filesFound = 0;

    // Parse all local file headers (signature: 0x04034b50)
    while (offset < view.byteLength - 30) {
      const signature = view.getUint32(offset, true);

      if (signature === 0x04034b50) {
        filesFound++;

        // Parse local file header
        const versionNeeded = view.getUint16(offset + 4, true);
        const flags = view.getUint16(offset + 6, true);
        const compressionMethod = view.getUint16(offset + 8, true);
        const compressedSize = view.getUint32(offset + 18, true);
        const uncompressedSize = view.getUint32(offset + 22, true);
        const filenameLength = view.getUint16(offset + 26, true);
        const extraFieldLength = view.getUint16(offset + 28, true);

        // Bounds checking
        const headerEnd = offset + 30 + filenameLength + extraFieldLength;
        const dataEnd = headerEnd + compressedSize;

        if (dataEnd > view.byteLength) {
          console.error("[zip-parser] File extends beyond ZIP bounds:", {
            offset,
            headerEnd,
            dataEnd,
            zipSize: view.byteLength
          });
          throw new Error("Corrupted ZIP file: entry extends beyond file boundary");
        }

        // Extract filename
        const filenameBytes = new Uint8Array(zipData, offset + 30, filenameLength);
        const filename = new TextDecoder().decode(filenameBytes);

        console.log("[zip-parser] Found file:", {
          filename,
          compressionMethod: compressionMethod === 0 ? "STORED" : compressionMethod === 8 ? "DEFLATE" : `Unknown(${compressionMethod})`,
          compressedSize,
          uncompressedSize
        });

        // Get compressed file data
        const dataOffset = headerEnd;
        const compressedData = new Uint8Array(zipData, dataOffset, compressedSize);

        // Decompress if needed
        let fileData: Uint8Array;
        if (compressionMethod === 0) {
          // Stored (no compression)
          fileData = compressedData;
        } else if (compressionMethod === 8) {
          // DEFLATE compression
          console.log("[zip-parser] Decompressing DEFLATE data for:", filename);
          fileData = await decompressDEFLATE(compressedData);
          console.log("[zip-parser] Decompressed size:", fileData.length, "bytes");

          // Validate decompressed size matches expected
          if (uncompressedSize > 0 && fileData.length !== uncompressedSize) {
            console.warn("[zip-parser] Size mismatch - expected:", uncompressedSize, "got:", fileData.length);
          }
        } else {
          console.error("[zip-parser] Unsupported compression method:", compressionMethod);
          throw new Error(`Unsupported compression method: ${compressionMethod}`);
        }

        // Validate we got actual audio data
        if (fileData.length === 0) {
          console.warn("[zip-parser] Empty file data for:", filename);
          offset = dataEnd;
          continue;
        }

        // Determine stem type from filename (case-insensitive matching)
        const lowerFilename = filename.toLowerCase();
        let stemType: string | null = null;

        if (lowerFilename.includes("vocal")) {
          stemType = "vocals";
        } else if (lowerFilename.includes("drum")) {
          stemType = "drums";
        } else if (lowerFilename.includes("bass")) {
          stemType = "bass";
        } else if (lowerFilename.includes("instrument") || lowerFilename.includes("other")) {
          stemType = "instruments";
        }

        if (stemType) {
          stems[stemType] = fileData;
          console.log("[zip-parser] Mapped", filename, "to stem type:", stemType);
        } else {
          console.warn("[zip-parser] Could not determine stem type for:", filename);
        }

        // Move to next file
        offset = dataEnd;
      } else {
        offset++;
      }
    }

    console.log("[zip-parser] Extraction complete:", {
      filesFound,
      stemsExtracted: Object.keys(stems),
      totalSize: Object.values(stems).reduce((acc, data) => acc + data.length, 0)
    });

    if (Object.keys(stems).length === 0) {
      throw new Error("No valid stem files found in ZIP archive");
    }

    return stems;
  } catch (error) {
    console.error("[zip-parser] Error parsing ZIP:", error);
    throw new Error("Failed to parse ZIP file: " + error.message);
  }
}
