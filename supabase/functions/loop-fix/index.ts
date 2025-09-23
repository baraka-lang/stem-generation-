// Deno Edge Function — Bar‑perfect loop trimmer
//
// This function accepts a base64 encoded WAV (PCM16) and trims the
// audio to an exact number of bars at the specified BPM.  It uses the
// same DSP primitives as the client code: head detection, seam
// search/crossfade and short edge ramps.  The trimmed loop is
// returned as a WAV.  An optional diagnostic header is provided for
// debugging.

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

interface LoopFixRequest {
  wav_b64: string
  bpm: number
  bars?: number
  xfade_ms?: number
}

// Utility to decode base64 audio payloads.  Supports data URIs and
// plain base64 strings.
function decodeBase64(b64: string): Uint8Array {
  const data = (b64 || '').split(',').pop() || ''
  const bin = atob(data)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Parse a PCM16 WAV into channel arrays.  Throws if the WAV is not
// PCM16.  Returns an object with sampleRate, number of channels,
// total length (frames) and per‑channel Float32Array data.
function parsePcm16Wav(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Check RIFF/WAVE header
  const riff = view.getUint32(0, false)
  const wave = view.getUint32(8, false)
  if (riff !== 0x52494646 || wave !== 0x57415645) {
    throw new Error('Not a WAV file')
  }
  let offset = 12
  let fmtSize = 0
  let fmtOffset = 0
  let dataOffset = 0
  let dataSize = 0
  while (offset + 8 <= view.byteLength) {
    const id = view.getUint32(offset, false)
    const size = view.getUint32(offset + 4, true)
    offset += 8
    if (id === 0x666d7420) { // 'fmt '
      fmtOffset = offset
      fmtSize = size
    } else if (id === 0x64617461) { // 'data'
      dataOffset = offset
      dataSize = size
    }
    offset += size
  }
  if (!fmtOffset || !dataOffset) throw new Error('Invalid WAV')
  const format = view.getUint16(fmtOffset, true)
  const channels = view.getUint16(fmtOffset + 2, true)
  const sampleRate = view.getUint32(fmtOffset + 4, true)
  const bitsPerSample = view.getUint16(fmtOffset + 14, true)
  if (format !== 1 || bitsPerSample !== 16) throw new Error('Only PCM16 WAV supported')
  const frames = dataSize / (channels * 2)
  const chans: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(frames))
  let idx = dataOffset
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = view.getInt16(idx, true)
      chans[c][i] = sample < 0 ? sample / 0x8000 : sample / 0x7fff
      idx += 2
    }
  }
  return { sampleRate, channels, length: frames, data: chans }
}

// Compute the number of sample frames for a given BPM and bar count.
function computeTargetFrames(sr: number, bpm: number, bars: number) {
  const beats = bars * 4
  const seconds = beats * (60 / bpm)
  return Math.round(seconds * sr)
}

// Detect the index of the first strong transient in the buffer.  This
// mirrors the client‑side `detectHeadIndex` implementation.  It
// computes a short-term energy envelope and finds the first point
// exceeding a threshold, then backs off slightly and searches for a
// nearby zero crossing.  The threshold scales with the peak energy
// observed in the first second of audio.
function detectHeadIndex(buf: Float32Array, sr: number) {
  const maxMs = 1000
  const maxN = Math.min(buf.length, Math.round((maxMs / 1000) * sr))
  if (maxN <= 0) return 0
  const env = new Float32Array(maxN)
  for (let i = 0; i < maxN; i++) env[i] = Math.abs(buf[i])
  const win = Math.max(2, Math.round((8 / 1000) * sr))
  let acc = 0
  for (let i = 0; i < win && i < env.length; i++) acc += env[i]
  const sm = new Float32Array(maxN)
  for (let i = 0; i < maxN; i++) {
    if (i >= win) acc += env[i] - env[i - win]
    sm[i] = acc / Math.min(win, i + 1)
  }
  let peak = 0
  for (let i = 0; i < maxN; i++) if (sm[i] > peak) peak = sm[i]
  const th = Math.max(Math.pow(10, -45 / 20), peak * 0.12)
  const backOff = Math.round(0.0035 * sr)
  const zeroFallback = Math.max(64, Math.round(0.008 * sr))
  function nearestZero(around: number) {
    let best = around
    let bestVal = Math.abs(buf[around] || 0)
    const a = Math.max(0, around - zeroFallback)
    const b = Math.min(buf.length - 1, around + zeroFallback)
    for (let i = a; i <= b; i++) {
      const v = Math.abs(buf[i])
      if (v < bestVal) {
        bestVal = v
        best = i
      }
    }
    return best
  }
  for (let i = 0; i < maxN; i++) {
    if (sm[i] >= th) {
      const idx = Math.max(0, i - backOff)
      return Math.max(0, nearestZero(idx))
    }
  }
  return 0
}

// Helper to wrap index within buffer length (modulo arithmetic).
function mod(a: number, n: number) {
  return ((a % n) + n) % n
}

// Search around the seam for the best overlap offset using a simple
// least‑squares error metric.  A small neighborhood around zero
// offset is searched to find where the beginning and end of the loop
// best match.
function findBestSeamOffset(data: Float32Array, startIdx: number, targetLen: number, xfadeN: number, sr: number) {
  const n = data.length
  // search window ~45ms scaled by sample rate
  const search = Math.max(0, Math.round((45 / 1000) * sr))
  const step = Math.max(1, Math.round(sr / 12000))
  let bestOffset = 0
  let bestScore = Number.POSITIVE_INFINITY
  const sampleAt = (idx: number) => {
    while (idx < 0) idx += n
    while (idx >= n) idx -= n
    return data[idx]
  }
  for (let off = -search; off <= search; off += step) {
    let score = 0
    for (let i = 0; i < xfadeN; i += step) {
      const a = sampleAt(startIdx + i + off)
      const b = sampleAt(startIdx + targetLen - xfadeN + i + off)
      const diff = a - b
      score += diff * diff
    }
    if (score < bestScore) {
      bestScore = score
      bestOffset = off
    }
  }
  return bestOffset
}

// Slice the raw channel arrays starting at `start` for `len` frames,
// wrapping around if necessary.  Returns a new set of channel arrays.
function sliceWrap(data: Float32Array[], start: number, len: number) {
  const ch = data.length
  const out: Float32Array[] = Array.from({ length: ch }, () => new Float32Array(len))
  const n = data[0].length
  for (let c = 0; c < ch; c++) {
    const src = data[c]
    const dst = out[c]
    const end = start + len
    if (end <= n) {
      dst.set(src.subarray(start, end), 0)
    } else {
      const first = n - start
      dst.set(src.subarray(start), 0)
      dst.set(src.subarray(0, len - first), first)
    }
  }
  return out
}

// Apply short fade in/out ramps to the beginning and end of each channel
// to avoid clicks at the loop seam.  The ramp duration is given in
// milliseconds.
function applyEdgeRamps(chans: Float32Array[], sr: number, rampMs: number) {
  const n = chans[0].length
  const ramp = Math.max(2, Math.round((rampMs / 1000) * sr))
  for (const d of chans) {
    for (let i = 0; i < Math.min(ramp, n); i++) {
      d[i] *= Math.sin(0.5 * Math.PI * (i / (ramp - 1)))
    }
    for (let i = 0; i < Math.min(ramp, n); i++) {
      d[n - 1 - i] *= Math.sin(0.5 * Math.PI * (1 - (i / (ramp - 1))))
    }
  }
}

// Crossfade the end of the loop into the beginning over `xfadeMs`
// milliseconds.  Uses equal‑power crossfade curves (cosine/sine).
function applySeamCrossfade(chans: Float32Array[], sr: number, xfadeMs: number) {
  const n = chans[0].length
  const xfadeN = Math.max(2, Math.round((xfadeMs / 1000) * sr))
  for (const d of chans) {
    for (let i = 0; i < xfadeN; i++) {
      const t = i / (xfadeN - 1)
      const wa = Math.cos(0.5 * Math.PI * t)
      const wb = Math.sin(0.5 * Math.PI * t)
      const endIdx = n - xfadeN + i
      d[endIdx] = d[endIdx] * wa + d[i] * wb
    }
    // Ensure exact seam continuity
    d[n - 1] = d[0]
  }
}

// Convert Float32 channel arrays back to a PCM16 WAV.  The
// implementation mirrors the WAV writer in the client and ElevenLabs
// proxy functions.  Each sample is clamped to [-1,1], scaled to 16‑bit
// and interleaved.
function makeWavFromPCM16(chans: Float32Array[], sr: number): Uint8Array {
  const ch = chans.length
  const frames = chans[0].length
  const blockAlign = ch * 2
  const dataSize = frames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  // RIFF header
  view.setUint32(0, 0x52494646, false) // 'RIFF'
  view.setUint32(4, 36 + dataSize, true)
  view.setUint32(8, 0x57415645, false) // 'WAVE'
  // fmt chunk
  view.setUint32(12, 0x666d7420, false) // 'fmt '
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, ch, true)
  view.setUint32(24, sr, true)
  view.setUint32(28, sr * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  // data chunk
  view.setUint32(36, 0x64617461, false) // 'data'
  view.setUint32(40, dataSize, true)
  let off = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      let s = chans[c][i]
      if (s < -1) s = -1
      else if (s > 1) s = 1
      const v = s < 0 ? s * 0x8000 : s * 0x7fff
      view.setInt16(off, v, true)
      off += 2
    }
  }
  return new Uint8Array(buffer)
}

// The main handler for the loop fix function.  It decodes the input
// WAV, computes the trim start and length, performs a seam crossfade
// and returns a new WAV.  Diagnostics about the trim are returned in
// a response header.
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
    const body = (await req.json()) as LoopFixRequest
    const bpm = Math.max(40, Math.min(300, Math.round(Number(body.bpm) || 0)))
    const bars = Math.max(1, Math.min(32, Math.round(Number(body.bars) || 4)))
    const xfadeMs = Math.max(2, Math.min(200, Math.round(Number(body.xfade_ms) || 12)))
    const wavBytes = decodeBase64(body.wav_b64 || '')
    if (!wavBytes || !wavBytes.length) {
      return new Response(JSON.stringify({ error: 'Missing wav_b64' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
    }
    // Parse WAV to get PCM data
    const pcm = parsePcm16Wav(wavBytes)
    const sr = pcm.sampleRate
    const targetLen = computeTargetFrames(sr, bpm, bars)
    const headIdx = detectHeadIndex(pcm.data[0], sr)
    const xfadeN = Math.max(2, Math.round((xfadeMs / 1000) * sr))
    const bestOff = findBestSeamOffset(pcm.data[0], headIdx, targetLen, xfadeN, sr)
    const start = mod(headIdx + bestOff, pcm.length)
    const trimmed = sliceWrap(pcm.data, start, targetLen)
    applyEdgeRamps(trimmed, sr, 5)
    applySeamCrossfade(trimmed, sr, xfadeMs)
    const outBytes = makeWavFromPCM16(trimmed, sr)
    const diag = { bpm, bars, sr, channels: pcm.channels, headIndex: headIdx, offset: bestOff, targetFrames: targetLen }
    return new Response(outBytes, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-cache',
        'X-LoopFix-Diagnostics': encodeURIComponent(JSON.stringify(diag)),
        ...corsHeaders,
      },
    })
  } catch (err) {
    console.error('loop-fix error', err)
    return new Response(JSON.stringify({ error: 'Internal error', details: (err?.message || String(err)) }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }
})