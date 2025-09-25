// Deno Edge Function — Generate a techno stem with strict bar‑perfect looping
//
// This function moves prompt construction, composition and loop
// alignment off the browser and into Supabase.  Given a stem type
// (kick, perc, bass, lead, hihat, pad, arp, fx, perc2), a set of
// control values and master settings (tempo, bars, key), it builds
// the appropriate prompt, optionally tightens the constraints for
// snare/hihat generation, calls ElevenLabs Music API to generate a
// raw PCM clip, validates the result for expected onsets and trims
// the audio to an exact number of bars using the same DSP pipeline
// used in the client.  It returns a base64 encoded WAV along with
// metadata describing the prompt and validation tier.

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

interface GenerateRequest {
  stem: string
  controls: Record<string, any>
  master: {
    tempo: number
    bars: number
    rootBase: string
    accidental: string
    mode: string
  }
  use_grok?: boolean
}

// Stem base descriptions used in prompt construction.  Only the
// basePrompt fields are required here; other UI‑related metadata is
// omitted.
const stemConfigs: Record<string, { basePrompt: string }> = {
  kick: { basePrompt: 'deep techno kick drum' },
  perc: { basePrompt: 'industrial techno snare' },
  bass: { basePrompt: 'dark techno bassline' },
  lead: { basePrompt: 'hypnotic techno lead synth' },
  hihat: { basePrompt: 'crisp techno closed hi-hat' },
  pad: { basePrompt: 'ambient techno pad' },
  arp: { basePrompt: 'techno synthesizer arpeggio' },
  fx: { basePrompt: 'techno transition effects and atmos' },
  perc2: { basePrompt: 'techno top percussion loop' },
}

// Scale a knob value (0–100) into one of five descriptive strings.
function scaleKnob(v: number | undefined, a: string, b: string, c: string, d: string, e: string): string {
  const x = Number(v ?? 50)
  if (x <= 20) return a
  if (x <= 40) return b
  if (x <= 60) return c
  if (x <= 80) return d
  return e
}

// Build a global scaffold for all stems.  This emphasises strict
// adherence to tempo and bar length and instructs the model to
// generate exactly the requested number of bars at a fixed BPM.
function globalScaffold({ tempo, bars, root, mode }: { tempo: number; bars: number; root: string; mode: string }): string {
  return [
    'Genre: modern techno',
    'TimeSignature: 4/4 (no swing)',
    `Tempo: ${tempo} BPM (constant; no variation)`,
    `Length: EXACT ${bars} bars (no extra bars)`,
    `Key: ${root} ${mode} (strictly diatonic; no modulation)`,
    'Start: bar 1 beat 1 (no count-in; no pre-roll)',
    `End: precisely at end of bar ${bars} (no tail; no reverb/delay bleed)`,
    'Loop: seamless at bar boundary (phase-coherent)',
    'Quantization: strict grid (no humanization)',
    'Delivery: instrumental only',
    // Absolute directive reinforcing loop length
    `ABSOLUTE: The loop length must be exactly ${bars} bars at ${tempo} BPM; do not alter the tempo or add/remove bars`,
  ].join('. ')
}

// Map a knob value to a rhythmic rate for arpeggiators.
function mapArpRate(v: number | undefined): string {
  const x = Number(v ?? 55)
  return x <= 33 ? '1/8 notes' : x <= 66 ? '1/16 notes' : '1/32 notes'
}

// Root text helper (combines root base and accidental).
function getRootText(master: { rootBase: string; accidental: string }): string {
  const base = master.rootBase || 'A'
  const acc = master.accidental || 'natural'
  if (acc === 'sharp') return `${base}#`
  if (acc === 'flat') return `${base}b`
  return base
}

// Role directives per stem.  These describe the expected pattern,
// articulation and tone for each stem type.  They rely on the control
// values passed from the client.
function roleDirectives(st: string, c: Record<string, any>): string {
  switch (st) {
    case 'kick':
      return [
        'ROLE: single isolated kick only',
        'Pattern: four-on-the-floor; hits on beats 1–4 every bar',
        'Pitch: unpitched; no tonal sub note; no toms',
        `Decay: ${scaleKnob(c.decay, 'very short', 'short', 'medium', 'long', 'very long')}`,
        `Punch: ${scaleKnob(c.punch, 'soft', 'firm', 'punchy', 'very punchy', 'aggressive')}`,
        c.texture ? 'Saturation: light; no tail' : 'Saturation: minimal; clean transient',
        'Exclude: fills/intro flam/crashes',
      ].join('. ')
    case 'bass':
      return [
        'ROLE: single isolated bass only',
        'Harmony: strictly diatonic in project key (no chromatic notes)',
        'Pitch: root + fifth primarily; occasional octave',
        `Movement: ${scaleKnob(c.movement, 'static', 'simple', 'groovy', 'animated', 'busy')} repeating per bar`,
        `Depth: ${scaleKnob(c.depth, 'light', 'medium', 'deep', 'deeper', 'subby')} low-end; controlled release`,
        c.filter ? 'Filter: subtle motion within bar; reset each bar' : 'Filter: stable',
        'Start note on beat 1; no slides across seam',
      ].join('. ')
    case 'lead':
      return [
        'ROLE: single isolated lead synth only',
        'Melody: strictly diatonic; avoid chromatic passing tones',
        `Phrase length evenly divides ${Math.max(1, c.bars || 4)} bar(s)`,
        `Complexity: ${scaleKnob(c.complexity, 'simple', 'moderate', 'interesting', 'intricate', 'ornate')} (quantized)`,
        `Brightness: ${scaleKnob(c.brightness, 'dark', 'mellow', 'balanced', 'bright', 'very bright')}`,
        c.delay ? 'Delay: minimal tempo-synced; cut at bar end' : 'Delay: off',
        'No bends/slides across loop seam',
      ].join('. ')
    case 'pad':
      return [
        'ROLE: single isolated pad only',
        'Chord: sustained diatonic chord(s); no modulation',
        `Evolution: ${scaleKnob(c.evolution, 'static', 'gentle', 'subtle motion', 'evolving', 'animated')} but reset every bar`,
        `Warmth: ${scaleKnob(c.warmth, 'cool', 'neutral', 'warm', 'lush', 'very lush')}`,
        c.chorus ? 'Chorus: subtle; no stereo smear at seam' : 'Chorus: off',
        'No long reverb tail; envelope ends before bar boundary',
      ].join('. ')
    default:
      return 'ROLE: single isolated instrument only'
  }
}

// Negative directives per stem to exclude unwanted instruments and
// effects.  Common negatives are always included.
function negatives(st: string): string {
  const common = [
    'no vocals or speech',
    'no cymbal crash on the last beat',
    'no count-in',
    'no pre-roll',
    'no silence at start',
    'no tempo changes',
    'no swing',
    'no off-grid timing',
    'no modulation or key change',
  ]
  const per: Record<string, string[]> = {
    kick: ['no toms', 'no pitch glides', 'no tonal sub drops', 'no reverb tail'],
    hihat: ['no open hats', 'no ride', 'no shaker', 'no clap', 'no snare', 'no pitch sweeps', 'no reverb tail'],
    perc: ['no clap', 'no rimshot', 'no hi-hat', 'no kick', 'no toms', 'no melodic percussion', 'no reverb tail'],
    bass: ['no chords', 'no distortion tail', 'no slides across seam'],
    lead: ['no atonal notes', 'no portamento across seam', 'no long delay tail'],
    pad: ['no huge reverb', 'no side instruments', 'no arpeggios', 'no tail at seam'],
    arp: ['no drums', 'no percussion', 'no bass', 'no pads', 'no leads', 'no vocals', 'no FX'],
    fx: ['no drums or percussion', 'no pitched melodies', 'no vocals', 'no tails across seam'],
    perc2: ['no kick', 'no snare', 'no clap', 'no hi-hat', 'no ride', 'no toms', 'no tonal hits', 'no tail across seam'],
  }
  return [...common, ...(per[st] || [])].join('; ')
}

// Build the hi-hat prompt.  Adjusts strictness to enforce exact 1/16
// grid and zero tails when retrying.
function buildHihatPrompt(controls: Record<string, any>, master: any, strictness = 0): string {
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const brightness = scaleKnob(controls.brightness, 'dark', 'balanced', 'crisp', 'bright', 'very bright')
  const space = controls.reverb ? 'Space: tiny room; decay < 120ms; gate tails before seam.' : 'Space: dry, minimal.'
  const common = [
    'STEM: HIHAT — solo closed hi-hat only.',
    'Identity: crisp techno closed hi-hat.',
    g,
    'ROLE: isolated closed hat (no open-hat).',
    'Pattern: strict 1/16 notes; first hit exactly at bar 1 beat 1; consistent every bar.',
    `Tone: ${brightness}; unpitched; short decay (40–120ms).`,
    space,
    'Exclude: ride, shaker, clap, snare, kick, toms, crashes; no melodic content, sweeps, or FX.',
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.',
  ]
  if (strictness === 1) {
    common.push('ABSOLUTE: Only closed-hat hits on a straight 1/16 grid; zero swing.')
  } else if (strictness >= 2) {
    common.push('MUST: closed-hat hits on each 1/16 step (16 hits/bar).', 'MUST: zero reverb tail at seam; gate hits before bar end.', 'MUST: exclude open hat, ride, shaker, snare, clap, toms, crashes.')
  }
  return common.join(' ')
}

// Build the snare (perc) prompt.  Strictness controls enforcement of hits
// exactly on beats 2 and 4.
function buildSnarePrompt(controls: Record<string, any>, master: any, strictness = 0): string {
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const varTxt = scaleKnob(controls.variation, 'no variation', 'very subtle variation', 'subtle variation', 'light variation', 'moderate variation')
  const intensity = scaleKnob(controls.intensity, 'low', 'moderate', 'medium', 'strong', 'very strong')
  const body = controls.metallic ? 'Timbre: slightly metallic; tight transient; short decay (80–180ms).' : 'Timbre: dry, tight; short decay (80–180ms).'
  const common = [
    'STEM: SNARE — solo snare only.',
    'Identity: industrial techno snare; drum-machine style; no clap.',
    g,
    'ROLE: isolated electronic snare.',
    'Pattern: hits exactly on beats 2 and 4 of every bar (no ghost notes or rolls).',
    `Dynamics: ${intensity}; ${body}`,
    `Variation: ${varTxt} but positions remain 2 & 4.`,
    'Exclude: clap/rim/kick/hat/shakers/toms/crashes; unpitched; no tails at seam.',
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.',
  ]
  if (strictness === 1) {
    common.push('ABSOLUTE: only beat 2 and beat 4 per bar; no extra hits.', 'ABSOLUTE: no off-grid timing.')
  } else if (strictness >= 2) {
    common.push('MUST: exactly one snare on beat 2 and one on beat 4 per bar, nothing else.', 'MUST: gate decay fully before the seam; exclude clap/rim layers.')
  }
  return common.join(' ')
}

// Build the arpeggiator prompt.
function buildArpPrompt(controls: Record<string, any>, master: any): string {
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const rate = mapArpRate(controls.rate)
  const complexity = scaleKnob(controls.complexity, 'simple', 'moderate', 'interesting', 'intricate', 'ornate')
  const gate = controls.gate ? 'long-ish gate (80–160ms)' : 'short gate (30–80ms)'
  return [
    'STEM: ARPEGGIATOR — solo synth arpeggio only.',
    `Identity: ${stemConfigs.arp.basePrompt}.`,
    g,
    `ROLE: isolated arp; strictly diatonic in ${root} ${mode}; no chords.`,
    `Pattern: ${rate}; fully quantized; phrase length must evenly divide ${bars} bars.`,
    `Complexity: ${complexity}; consistent motif and octave moves.`,
    `Envelope: ${gate}; no delay/reverb across seam.`,
    'Exclude: drums/percussion/bass/pads/leads/vocals.',
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.',
  ].join(' ')
}

// Build the FX prompt.
function buildFXPrompt(controls: Record<string, any>, master: any): string {
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const intensity = scaleKnob(controls.intensity, 'subtle', 'moderate', 'medium', 'strong', 'intense')
  const movement = scaleKnob(controls.movement, 'static', 'gentle motion', 'evolving', 'animated', 'dynamic')
  const space = controls.reverb ? 'Space: tiny room; decay ≤ 150ms; gate before bar end.' : 'Space: dry/minimal; gate before bar end.'
  return [
    'STEM: FX — solo techno transition effects & atmos only.',
    `Identity: ${stemConfigs.fx.basePrompt}.`,
    g,
    'ROLE: bar-internal whooshes/sweeps/noise beds that RESET each bar.',
    `Intensity: ${intensity}. Movement: ${movement}.`,
    space,
    'Exclude: pitched melodies/drums/percussion; avoid risers/falls that exceed a single bar.',
    'Deliver a bar-perfect seamless loop; zero tail beyond the bar.',
  ].join(' ')
}

// Build the percussion loop (perc2) prompt.
function buildPercLoopPrompt(controls: Record<string, any>, master: any): string {
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const density = scaleKnob(controls.density, 'sparse', 'light', 'medium', 'busy', 'dense')
  const metallic = controls.metallic ? 'slightly metallic timbre allowed' : 'organic timbre preferred'
  const groove = scaleKnob(controls.groove, 'straight', 'straight with mild syncopation', 'syncopated but quantized', 'complex yet quantized', 'complex yet quantized')
  return [
    'STEM: PERCUSSION — solo top percussion only (shakers/blocks/taps); not snare/hat/kick.',
    `Identity: ${stemConfigs.perc2.basePrompt}.`,
    g,
    `ROLE: quantized on-grid accents; ${groove}; zero swing.`,
    `Density: ${density}; keep consistent across bars.`,
    `Timbre: ${metallic}; short releases; zero tails at seam.`,
    'Exclude: tonal hits/kick/snare/clap/hat/ride/toms/crashes.',
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.',
  ].join(' ')
}

// Build a stem prompt based on the stem type.  Hihat and snare
// support strictness tiers for automatic retries.
function buildStemPrompt(st: string, controls: Record<string, any>, master: any, strictness = 0): string {
  if (st === 'hihat') return buildHihatPrompt(controls, master, strictness)
  if (st === 'perc') return buildSnarePrompt(controls, master, strictness)
  if (st === 'arp') return buildArpPrompt(controls, master)
  if (st === 'fx') return buildFXPrompt(controls, master)
  if (st === 'perc2') return buildPercLoopPrompt(controls, master)
  const cfg = stemConfigs[st]
  const stemBase = cfg?.basePrompt || 'single instrument'
  const global = globalScaffold(master)
  const role = roleDirectives(st, controls)
  const negs = negatives(st)
  return [
    `STEM: ${st.toUpperCase()} — solo ${stemBase}.`,
    global,
    role,
    `Avoid: ${negs}.`,
    'Deliver a bar-perfect loop that aligns exactly with bar boundaries and starts at bar 1 beat 1.',
  ].join(' ')
}

// Guess the number of channels given the expected sample rate and music
// length.  This mirrors the ElevenLabs proxy implementation.
function guessChannelsFromLength(pcmBytesLength: number, sampleRate: number, musicLengthMs: number): number {
  const expectedFrames = Math.max(1, Math.round(sampleRate * (musicLengthMs / 1000)))
  const bytesPerMono = expectedFrames * 2
  const bytesPerStereo = expectedFrames * 4
  const tol = Math.max(4096, Math.round(0.15 * bytesPerStereo))
  const monoDiff = Math.abs(pcmBytesLength - bytesPerMono)
  const stereoDiff = Math.abs(pcmBytesLength - bytesPerStereo)
  if (stereoDiff <= monoDiff && stereoDiff <= tol) return 2
  if (monoDiff < stereoDiff && monoDiff <= tol) return 1
  return 2
}

// Convert raw PCM16 bytes into channel arrays.  Each sample is
// converted to Float32 and normalised to [-1,1].
function convertRawPCMToChans(pcm: Uint8Array, channels: number, sampleRate: number) {
  const totalSamples = pcm.length / 2
  const frames = totalSamples / channels
  const chans: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(frames))
  let offset = 0
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const lo = pcm[offset]
      const hi = pcm[offset + 1]
      let val = (hi << 8) | lo
      if (val & 0x8000) val = val - 0x10000
      const sample = val < 0 ? val / 0x8000 : val / 0x7fff
      chans[c][i] = sample
      offset += 2
    }
  }
  return { data: chans, sr: sampleRate, ch: channels, length: frames }
}

// Count transient onsets in a buffer (first channel) using an RMS
// threshold.  Used by hi-hat validation.
function countOnsets(buf: { data: Float32Array[]; sr: number; length: number }, refractorySec = 0.08, relThresh = 0.35): number {
  const sr = buf.sr
  const x = buf.data[0]
  let sum = 0
  const step = 512
  for (let i = 0; i < x.length; i += step) {
    const v = x[i]
    sum += v * v
  }
  const rms = Math.sqrt(sum / Math.max(1, Math.floor(x.length / step)))
  const thr = Math.max(0.02, rms * relThresh)
  const refr = Math.max(1, Math.round(refractorySec * sr))
  let peaks = 0
  let i = 0
  while (i < x.length) {
    if (Math.abs(x[i]) >= thr) {
      peaks++
      i += refr
    } else {
      i++
    }
  }
  return peaks
}

// Validate a hi-hat buffer: expect ~16 hits per bar; accept if at
// least 60% of expected hits are present.
function validateHihat(buf: { data: Float32Array[]; sr: number; length: number }, bpm: number, bars: number): boolean {
  const expected = bars * 16
  const found = countOnsets(buf, 0.07, 0.35)
  return found >= Math.max(10, Math.round(expected * 0.6))
}

// Validate a snare buffer: ensure hits at beat 2 and 4 of each bar.
function validateSnare(buf: { data: Float32Array[]; sr: number; length: number }, bpm: number, bars: number): boolean {
  const sr = buf.sr
  const x = buf.data[0]
  const barSec = 4 * (60 / bpm)
  const beatSec = 60 / bpm
  const tol = Math.round((40 / 1000) * sr)
  function hasPeakNear(sampleIdx: number): boolean {
    const a = Math.max(0, sampleIdx - tol)
    const b = Math.min(x.length - 1, sampleIdx + tol)
    let sum = 0
    let n = 0
    for (let i = a; i <= b; i += 4) {
      const v = x[i]
      sum += v * v
      n++
    }
    const rms = Math.sqrt(sum / Math.max(1, n))
    const thr = Math.max(0.02, rms * 3.0)
    for (let i = a; i <= b; i += 2) {
      if (Math.abs(x[i]) >= thr) return true
    }
    return false
  }
  for (let bar = 0; bar < bars; bar++) {
    const barStart = Math.round(bar * barSec * sr)
    const beat2 = barStart + Math.round(1 * beatSec * sr)
    const beat4 = barStart + Math.round(3 * beatSec * sr)
    if (!hasPeakNear(beat2) || !hasPeakNear(beat4)) return false
  }
  return true
}

// DSP helpers from loop-fix.  These operate on raw channel arrays.
function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

function detectHeadIndexArray(data: Float32Array, sr: number): number {
  const maxMs = 1000
  const maxN = Math.min(data.length, Math.round((maxMs / 1000) * sr))
  if (maxN <= 0) return 0
  const env = new Float32Array(maxN)
  for (let i = 0; i < maxN; i++) env[i] = Math.abs(data[i])
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
    let bestVal = Math.abs(data[around] || 0)
    const a = Math.max(0, around - zeroFallback)
    const b = Math.min(data.length - 1, around + zeroFallback)
    for (let i = a; i <= b; i++) {
      const v = Math.abs(data[i])
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

function findBestSeamOffsetArray(data: Float32Array, startIdx: number, targetLen: number, xfadeN: number, sr: number): number {
  const n = data.length
  const search = Math.max(0, Math.round((45 / 1000) * sr))
  const step = Math.max(1, Math.round(sr / 12000))
  let bestOff = 0
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
      bestOff = off
    }
  }
  return bestOff
}

function sliceWrapArray(data: Float32Array[], start: number, len: number): Float32Array[] {
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

function applyEdgeRampsArray(chans: Float32Array[], sr: number, rampMs: number) {
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

function applySeamCrossfadeArray(chans: Float32Array[], sr: number, xfadeMs: number) {
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
    d[n - 1] = d[0]
  }
}

// Convert channel arrays back to a PCM16 WAV.  Borrowed from loop-fix.
function makeWavFromPCM16(chans: Float32Array[], sr: number): Uint8Array {
  const ch = chans.length
  const frames = chans[0].length
  const blockAlign = ch * 2
  const dataSize = frames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  view.setUint32(0, 0x52494646, false) // 'RIFF'
  view.setUint32(4, 36 + dataSize, true)
  view.setUint32(8, 0x57415645, false) // 'WAVE'
  view.setUint32(12, 0x666d7420, false) // 'fmt '
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, ch, true)
  view.setUint32(24, sr, true)
  view.setUint32(28, sr * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
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

// Generate the stem: build prompt, call ElevenLabs, validate and trim.
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
    const body = (await req.json()) as GenerateRequest
    const stem = String(body.stem || '').toLowerCase()
    const controls = body.controls || {}
    const master = body.master || { tempo: 130, bars: 4, rootBase: 'A', accidental: 'natural', mode: 'Minor' }
    // Clamp tempo and bars
    const tempo = Math.max(40, Math.min(300, Math.round(Number(master.tempo) || 130)))
    const bars = Math.max(1, Math.min(32, Math.round(Number(master.bars) || 4)))
    const rootText = getRootText(master)
    const masterForPrompt = { tempo, bars, root: rootText, mode: master.mode || 'Minor' }
    const xiKey = Deno.env.get('ELEVENLABS_API_KEY')
    if (!xiKey) {
      return new Response(JSON.stringify({ error: 'ELEVENLABS_API_KEY is not configured' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
    }
    // Determine if we need strictness retries (hihat/snare)
    let strictness = 0
    let usedPrompt = ''
    let validated = true
    let tier = 0
    let rawPCM: Uint8Array | null = null
    let sampleRate = 24000
    let channels = 1
    let musicLengthMs = 0
    // We'll attempt up to 3 tiers for hihat and snare (perc)
    for (strictness = 0; strictness < 3; strictness++) {
      usedPrompt = buildStemPrompt(stem, controls, masterForPrompt, strictness)
      // Compute length in milliseconds
      const beats = bars * 4
      const seconds = beats * (60 / tempo)
      musicLengthMs = Math.round(seconds * 1000) + 200 // pad tail
      musicLengthMs = Math.max(10000, Math.min(300000, musicLengthMs))
      // Build request to ElevenLabs
      const upstream = new URL('https://api.elevenlabs.io/v1/music')
      upstream.searchParams.set('output_format', 'pcm_24000')
      const upstreamBody = { prompt: usedPrompt, music_length_ms: musicLengthMs, model_id: 'music_v1' }
      const resp = await fetch(upstream.toString(), {
        method: 'POST',
        headers: {
          'xi-api-key': xiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/*,application/octet-stream',
        },
        body: JSON.stringify(upstreamBody),
      })
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '')
        return new Response(JSON.stringify({ error: `Upstream error ${resp.status}`, upstream: txt }), { status: resp.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }
      // ElevenLabs returns raw PCM16
      const rawBytes = new Uint8Array(await resp.arrayBuffer())
      // Guess channels and convert to channel arrays
      channels = guessChannelsFromLength(rawBytes.length, sampleRate, musicLengthMs)
      const pcm = convertRawPCMToChans(rawBytes, channels, sampleRate)
      // Validate if necessary
      if (stem === 'hihat') {
        validated = validateHihat(pcm, tempo, bars)
      } else if (stem === 'perc') {
        validated = validateSnare(pcm, tempo, bars)
      } else {
        validated = true
      }
      rawPCM = rawBytes
      tier = strictness
      if (validated || strictness >= 2 || (stem !== 'hihat' && stem !== 'perc')) {
        break
      }
    }
    if (!rawPCM) {
      return new Response(JSON.stringify({ error: 'Failed to generate audio' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
    }
    // Convert raw PCM to channel arrays for trimming
    const pcm = convertRawPCMToChans(rawPCM, channels, sampleRate)
    // Compute trimming parameters
    const targetFrames = Math.round((bars * 4) * (60 / tempo) * sampleRate)
    const headIdx = detectHeadIndexArray(pcm.data[0], sampleRate)
    const xfadeMs = 12
    const xfadeN = Math.max(2, Math.round((xfadeMs / 1000) * sampleRate))
    const bestOff = findBestSeamOffsetArray(pcm.data[0], headIdx, targetFrames, xfadeN, sampleRate)
    const start = mod(headIdx + bestOff, pcm.length)
    const trimmed = sliceWrapArray(pcm.data, start, targetFrames)
    // Apply ramps and crossfade
    applyEdgeRampsArray(trimmed, sampleRate, 5)
    applySeamCrossfadeArray(trimmed, sampleRate, xfadeMs)
    const outBytes = makeWavFromPCM16(trimmed, sampleRate)
    // Encode to base64
    let binary = ''
    for (let i = 0; i < outBytes.length; i++) binary += String.fromCharCode(outBytes[i])
    const b64 = btoa(binary)
    const audio_b64 = `data:audio/wav;base64,${b64}`
    const responseBody = { audio_b64, usedPrompt, tier, validated }
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  } catch (err) {
    console.error('generate-techno-stem error', err)
    return new Response(JSON.stringify({ error: 'Internal error', details: err?.message || String(err) }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }
})