import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { ZipReader, BlobReader, BlobWriter } from "jsr:@zip-js/zip-js";

/**
 * Supabase Edge Function - ElevenLabs Stem Separation Proxy
 * - Accepts base64 audio in the body
 * - Calls ElevenLabs /v1/music/stem-separation
 * - Extracts stems from the returned ZIP
 * - Returns the selected stem as base64
 *
 * Updated: 2025-11-19
 * Changes to fix connection issues:
 *  1) Robust CORS preflight (echo Access-Control-Request-Headers + Vary).
 *  2) Pass `output_format` as query param (per docs) and set Accept: application/zip.
 *  3) Safer base64 decoder (supports data: URIs & URL-safe base64).
 *  4) Better MIME sniffing for the uploaded audio.
 *  5) Use zip.js to parse ZIP reliably (central directory, data descriptors, etc.).
 *  6) Fixed scoping bug where `startTime` was inaccessible in catch handler.
 */

type StemExternal = "vocals" | "drums" | "bass" | "instruments";

const STEM_TYPE_MAPPING: Record<string, StemExternal> = {
  kick: "drums",
  perc: "drums",
  perc2: "drums",
  hihat: "drums",
  drums: "drums",
  bass: "bass",
  lead: "instruments",
  melody: "instruments",
  pad: "instruments",
  arp: "instruments",
  fx: "instruments",
  sfx: "instruments",
  vox: "vocals",
  vocal: "vocals",
  vocals: "vocals",
};

interface SeparationRequest {
  audioData: string; // base64 (optionally a data: URL)
  stemType: string;  // internal stem type (kick, bass, etc.)
  outputFormat?: string; // e.g. "mp3_44100_128"
}

/** Build CORS headers dynamically. */
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "*";
  const acrh = req.headers.get("access-control-request-headers");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Access-Control-Request-Headers",
  };
  headers["Access-Control-Allow-Headers"] =
    acrh ?? "authorization, x-client-info, apikey, content-type";
  return headers;
}

/** Normalize & decode base64 (supports data URLs and URL-safe alphabet). */
function normalizeBase64(input: string): string {
  // Strip "data:*;base64," prefix if present
  if (input.startsWith("data:")) {
    const comma = input.indexOf(",");
    if (comma >= 0) input = input.slice(comma + 1);
  }
  // Remove whitespace/newlines
  input = input.replace(/\s+/g, "");
  // URL-safe -> standard
  input = input.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding
  const pad = input.length % 4;
  if (pad === 2) input += "==";
  else if (pad === 3) input += "=";
  else if (pad !== 0 && pad !== 2 && pad !== 3) {
    // non-standard length: try best effort
    input += "=".repeat((4 - (input.length % 4)) % 4);
  }
  return input;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Heuristic MIME sniffing to label the upload for ElevenLabs. */
function guessMime(bytes: Uint8Array): { mime: string; ext: string } {
  const header4 = String.fromCharCode(...bytes.slice(0, 4));
  if (header4 === "RIFF") return { mime: "audio/wav", ext: "wav" };
  if (header4 === "OggS") return { mime: "audio/ogg", ext: "ogg" };
  // ID3 or MPEG frame sync
  if (
    header4.startsWith("ID3") ||
    (bytes[0] === 0xff && (bytes[1] & 0b11100000) === 0b11100000)
  ) {
    return { mime: "audio/mpeg", ext: "mp3" };
  }
  return { mime: "application/octet-stream", ext: "bin" };
}

/** Encode bytes to base64 with chunking to avoid call stack limits. */
function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000; // 32k
  let str = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    str += String.fromCharCode(...sub);
  }
  return btoa(str);
}

/** Extract stems from ZIP using zip.js (reliable with data-descriptors & Zip64). */
async function extractStemsFromZip(zipData: ArrayBuffer): Promise<Record<StemExternal, Uint8Array>> {
  const stems = {} as Record<StemExternal, Uint8Array>;
  const zipBlob = new Blob([zipData], { type: "application/zip" });
  const reader = new ZipReader(new BlobReader(zipBlob));

  try {
    const entries = await reader.getEntries();

    for (const entry of entries) {
      // zip.js entry has "filename"
      const filename = ((entry as any).filename ?? "").toString().toLowerCase();

      let stem: StemExternal | null = null;
      if (filename.includes("vocal")) stem = "vocals";
      else if (filename.includes("drum")) stem = "drums";
      else if (filename.includes("bass")) stem = "bass";
      else if (filename.includes("instrument") || filename.includes("other") || filename.includes("accompaniment"))
        stem = "instruments";

      if (!stem) continue;

      const blob = await entry.getData(new BlobWriter());
      const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
      stems[stem] = bytes;
    }

    return stems;
  } finally {
    await reader.close();
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeadersFor(req);

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  // Health check
  if (req.method === "GET") {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    return new Response(
      JSON.stringify({
        status: "healthy",
        service: "separate-stems",
        version: "1.1.0",
        apiKeyConfigured: Boolean(apiKey),
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const startTime = Date.now();

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Method not allowed" }),
        { status: 405, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    let body: SeparationRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const { audioData, stemType, outputFormat = "mp3_44100_128" } = body;

    if (!audioData || !stemType) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: audioData and stemType",
        }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const targetStem = STEM_TYPE_MAPPING[stemType];
    if (!targetStem) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid stem type "${stemType}"`,
          hint: `Supported: ${Object.keys(STEM_TYPE_MAPPING).join(", ")}`,
        }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "API key not configured",
          hint: "Set ELEVENLABS_API_KEY in project secrets",
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Decode base64
    let bytes: Uint8Array;
    try {
      const normalized = normalizeBase64(audioData);
      bytes = base64ToBytes(normalized);
      if (bytes.length === 0) throw new Error("Decoded audio is empty");
    } catch (e) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to decode base64 audio",
          hint: (e as Error)?.message ?? "Invalid base64 string",
        }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const { mime, ext } = guessMime(bytes);
    const fileName = `audio.${ext}`;

    // Build request (docs: POST /v1/music/stem-separation; returns ZIP)
    // Pass output_format as query param to avoid server ignoring a form field.
    const url = new URL("https://api.elevenlabs.io/v1/music/stem-separation");
    if (outputFormat) url.searchParams.set("output_format", outputFormat);

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), fileName);

    const controller = new AbortController();
    // Supabase free plan request idle timeout is 150s — keep lower than that.
    const timeoutMs = 140_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        // Helps the server negotiate the correct content.
        "accept": "application/zip",
      },
      body: form,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      let message = "Stem separation failed";
      let hint = "";
      switch (resp.status) {
        case 401:
          message = "Authentication failed"; hint = "Invalid or missing API key"; break;
        case 413:
          message = "Audio file too large"; hint = "Try a shorter clip"; break;
        case 422:
          message = "Invalid audio format"; hint = "Unsupported or corrupted audio"; break;
        case 429:
          message = "Rate limit exceeded"; hint = "Retry after a short delay"; break;
        default:
          if (resp.status >= 500) {
            message = "Service temporarily unavailable"; hint = "Retry shortly";
          }
      }
      return new Response(
        JSON.stringify({ success: false, error: message, hint, statusCode: resp.status, details: text }),
        { status: resp.status, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const zipBuffer = await resp.arrayBuffer();

    // Extract stems from ZIP
    const stems = await extractStemsFromZip(zipBuffer);
    const selected = stems[targetStem];
    if (!selected) {
      const available = Object.keys(stems);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Target stem '${targetStem}' not found in ZIP`,
          hint: `Available stems: ${available.join(", ") || "none"}`,
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const base64Audio = bytesToBase64(selected);
    const duration = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        success: true,
        audioData: base64Audio,
        stemType: targetStem,
        requestedInstrument: stemType,
        format: outputFormat,
        processingTimeMs: duration,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    const err = error as Error;
    if ((error as any)?.name === "AbortError") {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Request timeout",
          hint: "Separation took too long. Try a shorter clip.",
          processingTimeMs: duration,
        }),
        { status: 504, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    console.error("[separate-stems] Unexpected error:", err?.name, err?.message, err?.stack);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error",
        hint: err?.message ?? "Unexpected error",
        errorType: err?.name ?? "UnknownError",
        processingTimeMs: duration,
      }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
