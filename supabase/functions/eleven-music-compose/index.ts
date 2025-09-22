// supabase/functions/eleven-music-compose/index.ts
// Deno Edge Function – Creator plan proxy for ElevenLabs Music API.
// Forces output_format=pcm_24000, wraps raw PCM16 as WAV, and auto-detects mono vs stereo.

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

interface MusicRequest {
  prompt: string | null
  music_length_ms: number
  output_format?: string
  model_id?: string
}

function makeWavFromPCM16(
  pcmBytes: Uint8Array,
  sampleRate: number,
  channels: number
): Uint8Array {
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const alignedLen = Math.floor(pcmBytes.byteLength / blockAlign) * blockAlign
  const dataLen = alignedLen
  const buffer = new ArrayBuffer(44 + dataLen)
  const view = new DataView(buffer)

  // 'RIFF' chunk
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLen, true)
  writeAscii(view, 8, 'WAVE')

  // 'fmt ' chunk
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)      // PCM fmt chunk size
  view.setUint16(20, 1, true)       // PCM format
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)      // bits per sample

  // 'data' chunk
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataLen, true)

  const out = new Uint8Array(buffer)
  out.set(pcmBytes.subarray(0, alignedLen), 44)
  return out

  function writeAscii(v: DataView, o: number, s: string) {
    for (let i=0; i<s.length; i++) v.setUint8(o+i, s.charCodeAt(i))
  }
}

function guessChannelsFromLength(
  pcmBytesLength: number,
  sampleRate: number,
  musicLengthMs: number
): number {
  // We estimate expected frames = sr * seconds.
  const expectedFrames = Math.max(1, Math.round(sampleRate * (musicLengthMs / 1000)))
  const bytesPerMono = expectedFrames * 2
  const bytesPerStereo = expectedFrames * 4

  // Allow generous tolerance (provider may vary a little, & we sometimes request a small pad)
  const tol = Math.max(4096, Math.round(0.15 * bytesPerStereo))

  const monoDiff = Math.abs(pcmBytesLength - bytesPerMono)
  const stereoDiff = Math.abs(pcmBytesLength - bytesPerStereo)

  if (stereoDiff <= monoDiff && stereoDiff <= tol) return 2
  if (monoDiff < stereoDiff && monoDiff <= tol) return 1
  // Default to stereo if ambiguous
  return 2
}

Deno.serve(async (req: Request) => {
  try {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response('ok', { status: 200, headers: corsHeaders })
    }

    if (req.method !== 'POST') {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders },
      })
    }

    const apiKey = Deno.env.get('ELEVENLABS_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ELEVENLABS_API_KEY is not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    const body = (await req.json()) as MusicRequest
    const prompt = (body.prompt ?? '').toString().trim().slice(0, 2000) || null
    let music_length_ms = Math.max(1000, Math.round(Number(body.music_length_ms) || 0))
    music_length_ms = Math.min(300000, music_length_ms)

    // Build upstream URL – ElevenLabs expects output_format in the query (per their error message)
    const upstream = new URL('https://api.elevenlabs.io/v1/music')
    upstream.searchParams.set('output_format', 'pcm_24000') // hard-lock to Creator plan PCM

    const upstreamBody = {
      prompt,
      music_length_ms,
      model_id: body.model_id || 'music_v1',
    }

    const upstreamResp = await fetch(upstream.toString(), {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/*,application/octet-stream',
      },
      body: JSON.stringify(upstreamBody),
    })

    if (!upstreamResp.ok) {
      const txt = await upstreamResp.text().catch(() => '')
      return new Response(
        JSON.stringify({ error: `Upstream error ${upstreamResp.status}`, upstream: txt }),
        { status: upstreamResp.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      )
    }

    // ElevenLabs returns raw PCM16 for pcm_* formats — wrap as WAV for the browser
    const rawBytes = new Uint8Array(await upstreamResp.arrayBuffer())

    // Try to detect if it is already WAV (safety)
    const isWav = rawBytes.length >= 12 &&
      rawBytes[0] === 0x52 && rawBytes[1] === 0x49 && rawBytes[2] === 0x46 && rawBytes[3] === 0x46 && // RIFF
      rawBytes[8] === 0x57 && rawBytes[9] === 0x41 && rawBytes[10] === 0x56 && rawBytes[11] === 0x45  // WAVE

    if (isWav) {
      // Pass-through if already WAV
      return new Response(rawBytes, {
        status: 200,
        headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-cache', ...corsHeaders },
      })
    }

    const sampleRate = 24000
    const channels = guessChannelsFromLength(rawBytes.byteLength, sampleRate, music_length_ms)
    const wavBytes = makeWavFromPCM16(rawBytes, sampleRate, channels)

    return new Response(wavBytes, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-cache',
        ...corsHeaders,
      },
    })
  } catch (err) {
    console.error('❌ Edge function error:', err)
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: err?.message || String(err),
        ts: new Date().toISOString(),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    )
  }
})
