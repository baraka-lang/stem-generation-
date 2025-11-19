import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'true'
};

interface ComposeRequest {
  prompt?: string;
  composition_plan?: any;
  music_length_ms?: number;
  output_format?: string;
  model_id?: string;
  respect_sections_durations?: boolean;
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
        service: "eleven-music-compose",
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
    console.log("[eleven-music-compose] Received request", {
      method: req.method,
      url: req.url,
      timestamp: new Date().toISOString(),
    });

    // Parse request body
    const body: ComposeRequest = await req.json();
    const {
      prompt,
      composition_plan,
      music_length_ms = 30000,
      output_format = "pcm_24000",
      model_id = "music_v1",
      respect_sections_durations = true
    } = body;

    console.log("[eleven-music-compose] Request params:", {
      hasPrompt: !!prompt,
      hasCompositionPlan: !!composition_plan,
      music_length_ms,
      output_format,
      model_id,
    });

    // Get API key from environment
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      console.error("[eleven-music-compose] ELEVENLABS_API_KEY not configured");
      return new Response(
        JSON.stringify({
          error: "API key not configured",
          hint: "Please configure ELEVENLABS_API_KEY in Supabase project secrets",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("[eleven-music-compose] API key configured:", apiKey.substring(0, 8) + "...");

    // Build request payload for ElevenLabs
    const elevenLabsPayload: any = {
      model_id,
      output_format,
    };

    if (composition_plan) {
      elevenLabsPayload.composition_plan = composition_plan;
    } else if (prompt) {
      elevenLabsPayload.prompt = prompt;
      elevenLabsPayload.music_length_ms = music_length_ms;
    } else {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: either prompt or composition_plan is required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (respect_sections_durations !== undefined) {
      elevenLabsPayload.respect_sections_durations = respect_sections_durations;
    }

    console.log("[eleven-music-compose] Calling ElevenLabs Music API...");

    // Call ElevenLabs Music API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout

    try {
      const response = await fetch(
        "https://api.elevenlabs.io/v1/music",
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            "Accept": "audio/*,application/octet-stream"
          },
          body: JSON.stringify(elevenLabsPayload),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      console.log("[eleven-music-compose] ElevenLabs response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error("[eleven-music-compose] ElevenLabs API error:", {
          status: response.status,
          error: errorText,
        });

        let errorMessage = "Music composition failed";
        let hint = "";

        if (response.status === 401) {
          errorMessage = "Authentication failed";
          hint = "Invalid API key";
        } else if (response.status === 400) {
          errorMessage = "Invalid request";
          hint = errorText;
        } else if (response.status === 403) {
          errorMessage = "Access denied";
          hint = "This feature may not be available in your plan";
        } else if (response.status === 413) {
          errorMessage = "Request too large";
          hint = "Try reducing the music length";
        } else if (response.status === 429) {
          errorMessage = "Rate limit exceeded";
          hint = "Please wait a moment and try again";
        } else if (response.status >= 500) {
          errorMessage = "Service temporarily unavailable";
          hint = "Please try again in a moment";
        }

        return new Response(
          JSON.stringify({
            error: errorMessage,
            hint,
            upstream: errorText,
            statusCode: response.status,
          }),
          {
            status: response.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Get the audio data
      console.log("[eleven-music-compose] Downloading audio data...");
      const audioData = await response.arrayBuffer();
      console.log("[eleven-music-compose] Audio data size:", audioData.byteLength, "bytes");

      const duration = Date.now() - startTime;
      console.log("[eleven-music-compose] Success! Total processing time:", duration, "ms");

      // Return the raw audio data with appropriate headers
      return new Response(
        audioData,
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "audio/wav",
            "Cache-Control": "no-cache",
          },
        }
      );
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError.name === "AbortError") {
        console.error("[eleven-music-compose] Request timeout");
        return new Response(
          JSON.stringify({
            error: "Request timeout",
            hint: "Music composition took too long. Please try with a shorter duration.",
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
    console.error("[eleven-music-compose] Unexpected error after", duration, "ms:", error);
    console.error("[eleven-music-compose] Error details:", {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    });

    return new Response(
      JSON.stringify({
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
