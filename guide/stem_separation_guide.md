# ElevenLabs Music API — Stem Separation (Updated Nov 2025, with community troubleshooting)

This guide explains **what the stem‑separation API does, what you send, what you get back, and how to implement it** with cURL, JavaScript/Node, and Python. It also includes the **latest practical troubleshooting tips** sourced from developer discussions and docs so anyone can integrate it confidently.

> **What it does:** Takes a *single mixed audio file* (song, backing track, etc.) and returns **separate audio files** (stems) for *vocals, drums, bass, instruments* — delivered in a ZIP archive. [1]  
> **Endpoint:** `POST https://api.elevenlabs.io/v1/music/stem-separation` [2]  
> **Auth header:** `xi-api-key: <YOUR_API_KEY>` [3]

---

## What “stem separation” is (and isn’t)

- **Separation** ≠ **generation**. It **extracts** parts from an existing track; it does **not** create new music.  
- Common use cases: remixing, karaoke/instrumentals, practice tracks, sampling, and post‑production cleanup.

---

## What you send

- **`file` (required):** Your mixed audio (WAV/MP3 and other common formats are supported across ElevenLabs endpoints). [4][5]  
- **`output_format` (optional):** Encoded as `codec_sample_rate_bitrate` (e.g., `mp3_44100_128`). If omitted, the API uses a default for the endpoint. [6]

> Tip: If the source file is heavily limited/clipped or extremely lossy, separation quality can degrade (more bleed or artifacts). A clean WAV often separates better than a crunchy MP3. [7][8]

---

## What you get back

- **HTTP 200** with a **ZIP** archive. Inside: one audio file per stem (**vocals**, **drums**, **bass**, **instruments**). [1]  
- You can request the encoding via `output_format` (e.g., MP3 at 44.1 kHz/128 kbps). [6]  
- **Common HTTP statuses:** `401` (auth), `413` (payload too large), `422` (invalid/malformed request), `429` (rate limit), `5xx` (server). [9][10]

---

## Quickstart (copy/paste)

### 1) cURL

```bash
curl -X POST 'https://api.elevenlabs.io/v1/music/stem-separation' \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -F "file=@/path/to/your-track.wav" \
  -F "output_format=mp3_44100_128" \
  --output stems.zip
This writes stems.zip in your working directory. Unzip to get vocals.*, drums.*, bass.*, instruments.* (exact filenames may vary). [1]
2) Node.js (robust fetch + safe multipart)
Server‑side example (don’t expose your API key in the browser). Requires Node 18+.
ts
Copy code
// package.json deps: node-fetch (if using Node < 18), form-data
import fs from "node:fs";
import path from "node:path";
import FormData from "form-data";

const API_KEY = process.env.ELEVENLABS_API_KEY!;
const ENDPOINT = "https://api.elevenlabs.io/v1/music/stem-separation";

async function separateStems(inputPath: string, outZip = "stems.zip", msTimeout = 180000) {
  // 1) Build multipart WITHOUT setting Content-Type yourself (lets boundary be set)
  const form = new FormData();
  form.append("file", fs.createReadStream(inputPath));
  form.append("output_format", "mp3_44100_128"); // optional

  // 2) AbortController for timeouts (Node 18+ global fetch)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), msTimeout);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": API_KEY, ...form.getHeaders() },
      body: form,
      signal: controller.signal
    });

    if (!res.ok) {
      const problem = await res.text().catch(() => "<no body>");
      throw new Error(`Stem separation failed (${res.status}): ${problem}`);
    }

    // 3) Stream to disk to avoid buffering huge files in memory
    const fileStream = fs.createWriteStream(outZip);
    await new Promise<void>((resolve, reject) => {
      (res.body as any).pipe(fileStream);
      (res.body as any).on("error", reject);
      fileStream.on("finish", () => resolve());
    });

    console.log(`Saved: ${path.resolve(outZip)}`);
  } finally {
    clearTimeout(timer);
  }
}

// Example
separateStems("./your-track.wav").catch(console.error);
Prefer the official Node SDK? It has built‑in automatic retries and a configurable timeout. Example (pseudo‑shape):
ts
Copy code
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! });

const zipBuffer = await client.music.stemSeparation.create(
  { /* body & files per SDK docs */ },
  { timeoutInSeconds: 180, maxRetries: 2 }
);
// Write zipBuffer to disk...
The SDK auto‑retries 408/409/429/5xx and defaults to a 60s timeout; you can bump both. [11]
3) Python (requests)
py
Copy code
import os, zipfile, io, requests

API_KEY = os.environ["ELEVENLABS_API_KEY"]
url = "https://api.elevenlabs.io/v1/music/stem-separation"

with open("your-track.wav", "rb") as f:
    files = {"file": f}  # don't set Content-Type yourself; requests handles boundaries
    data = {"output_format": "mp3_44100_128"}  # optional
    r = requests.post(url, headers={"xi-api-key": API_KEY}, files=files, data=data, timeout=(15, 300))
    r.raise_for_status()

# Save + extract the ZIP
zip_bytes = io.BytesIO(r.content)
with zipfile.ZipFile(zip_bytes) as z:
    z.extractall("stems_out")
print("Stems in ./stems_out")
Latest troubleshooting (from the community + docs)
A. 401 “Unauthorized”
Make sure you pass xi-api-key and keep it server‑side. Rotating an old/stale key fixed issues for some developers. [3][12]
B. 422 “Unprocessable Entity”
If you’re calling from the browser, you may trigger a CORS‑typed 422. Proxy through your backend/edge function instead of calling the ElevenLabs API directly from front‑end code. [9]
For multipart requests, do not manually set the Content-Type: multipart/form-data header; let your HTTP client add a proper boundary. Hand‑rolled boundaries cause {"detail":"Missing boundary in multipart."}. [13]
Double‑check required fields: include the file form field and ensure it’s a real audio file (non‑empty, decodable). [4]
C. Timeouts & large files
The official Node SDK defaults to a 60s timeout; raise it (e.g., timeoutInSeconds: 180) for longer tracks. It also auto‑retries transient 408/409/429/5xx by default. [11]
You can also stream the response to disk to avoid memory spikes (see Node example).
ElevenLabs has made latency improvements to the stem endpoint recently; still, timeouts can happen on saturated networks or very long inputs—use a larger timeout and retry/backoff. [14]
D. 413 “Payload Too Large”
You’re likely breaching a gateway/server limit. Try a shorter clip, or re‑encode (WAV/MP3) before upload. If you run a proxy, make sure its body size limit allows your uploads. [10]
E. “Corrupt MP3/ZIP” when saving
Save binary responses and avoid trying to parse audio as JSON/text. In Python, prefer requests’ binary content and write bytes or use stream + file I/O. [15]
F. Input formats & output options
If the API complains about unsupported formats, convert with FFmpeg (e.g., to WAV) and retry. [7]
The output_format follows codec_sample_rate_bitrate (e.g., mp3_44100_128). Use a standard option if you hit plan/format restrictions. [6]
G. Quality: bleed & artifacts
Some vocal/instrument bleed is normal for current separation models; expect trade‑offs between isolation and artifacts. Clean, uncrushed sources separate better. [8]
If you need cleaner stems: try less compressed sources, post‑cleanup (EQ, gating, spectral tools), or run a second pass with a specialist tool. [16]
H. Access & plan
The Music API (including separation) is available to paid users. If you see permission errors, verify your plan and API access. [17]
Production tips
Proxy from your backend/edge (don’t expose keys client‑side). For Supabase Edge Functions, enable CORS (allow authorization, content-type, etc.). [18]
Stream uploads for large files to avoid buffering (Node: fs.createReadStream; Python: file handle).
Hash & cache by input file digest so you don’t re‑separate the same track.
Name stems defensively (don’t hard‑code filenames; list ZIP entries).
Resilience: backoff on 429/5xx and raise client timeouts for bigger jobs. [11]
Format strategy: request MP3 for quick previews, then a lossless or higher‑bitrate format for final renders if your plan allows. [5][6]
Example: wiring this into a stem‑based UI
User uploads song.wav.
Your backend/edge function calls the endpoint and stores stems.zip.
Extract to /stems/{uploadId}/vocals.mp3, /drums.mp3, /bass.mp3, /instruments.mp3.
Front‑end loads each stem and uses the Web Audio API to mute/solo, loop, and mix in sync.
Notes
Official docs list 4 stems (vocals, drums, bass, instruments). Some SDK/community docs mention expanded sets (e.g., guitar/keys). Treat those as experimental until confirmed in the official API docs for your account/plan. [2][19]
Respect IP & licensing and the ElevenLabs terms when processing third‑party material.
Security & stability checklist
Keep xi-api-key secret; never ship it in front‑end code. [3]
Monitor for rate limits and quotas; use retries/backoff. [11]
Ignore unknown fields in responses to avoid breakage if the API adds properties (per ElevenLabs’ breaking‑changes guidance). [20]
Integration note for 343 Labs AI Music Studio
Your PRD already routes ElevenLabs through a Supabase Edge Function proxy and a Web Audio UI that expects PCM/WAV flows. Keep using that proxy for separation: accept the user upload in the Edge Function, call stem-separation, store the ZIP, extract stems as individual files, and load them into your existing “stem cards” UI. If your engine expects 24 kHz PCM → WAV, you can request MP3 for preview and transcode a final WAV for download. [21]
markdown
Copy code

**Sources for this update (high‑signal references):**

- [1] Official stem‑separation response shape (ZIP with stems). :contentReference[oaicite:0]{index=0}  
- [2] ElevenLabs changelog announcing the **/v1/music/stem-separation** endpoint (and stem types). :contentReference[oaicite:1]{index=1}  
- [3] API authentication (use `xi-api-key`, keep it secret; server‑side only). :contentReference[oaicite:2]{index=2}  
- [4] ElevenLabs endpoints that accept audio via **multipart file** (pattern shared across music/align/isolation). :contentReference[oaicite:3]{index=3}  
- [5] Supported audio formats overview (docs/help). :contentReference[oaicite:4]{index=4}  
- [6] `output_format` string convention `codec_sample_rate_bitrate` (e.g., `mp3_44100_128`). :contentReference[oaicite:5]{index=5}  
- [7] Practical fix for “format not supported” → convert with FFmpeg before retrying. :contentReference[oaicite:6]{index=6}  
- [8] Community consensus: **bleed/artifacts are normal**; trade‑offs in isolation quality. :contentReference[oaicite:7]{index=7}  
- [9] “422 (cors)” guidance and calling from front‑end vs backend pitfalls. :contentReference[oaicite:8]{index=8}  
- [10] What 413 means and why proxies/servers reject large bodies. :contentReference[oaicite:9]{index=9}  
- [11] Official Node SDK **retries** and **timeouts** defaults and overrides. :contentReference[oaicite:10]{index=10}  
- [12] Real‑world fix: regenerating a fresh API key resolved access issues in some cases. :contentReference[oaicite:11]{index=11}  
- [13] Multipart **“Missing boundary”** pitfall when you set `Content-Type` manually. :contentReference[oaicite:12]{index=12}  
- [14] Docs note **latency improvements** made to the separation endpoint (still plan for timeouts). :contentReference[oaicite:13]{index=13}  
- [15] Report of “corrupt audio when saving” in Python → ensure binary save/stream. :contentReference[oaicite:14]{index=14}  
- [16] Post‑cleanup approaches for reducing bleed/artifacts. :contentReference[oaicite:15]{index=15}  
- [17] Music API availability note for **paid users**. :contentReference[oaicite:16]{index=16}  
- [18] Supabase Edge Functions CORS pattern (proxying from browser safely). :contentReference[oaicite:17]{index=17}  
- [19] Third‑party/SDK docs sometimes mention expanded stem sets (e.g., guitar/keys) — verify against official docs for your plan. :contentReference[oaicite:18]{index=18}  
- [20] ElevenLabs **breaking‑changes policy** (ignore unknown fields). :contentReference[oaicite:19]{index=19}  
- [21] Integration context from the **343 Labs AI Music Studio PRD** (proxy + Web Audio pipeline). :contentReference[oaicite:20]{index=20}
