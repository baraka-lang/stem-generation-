// Generation helpers migrated from app.js in small, safe steps.
import { PRIMARY_OUTPUT_FORMAT, FALLBACK_OUTPUT_FORMAT } from '../Config/constants.js'
import { roleDirectives, negatives } from './stemHelper.js'

export function buildCompositionPlan({ tempo, bars }, descriptor){
  const ms=Math.round(bars*4*(60/tempo)*1000)
  return {
    positive_global_styles:["techno","instrumental","loop"],
    negative_global_styles:["vocals","fade-in","fade-out","free-time"],
    sections:[{
      section_name:"Loop",
      positive_local_styles:[descriptor||"modern techno"],
      negative_local_styles:["rubato","modulation","improv cadenza"],
      duration_ms: ms,
      lines: []
    }]
  }
}

/**
 * Generate fallback audio when Supabase Edge Functions are not available
 * Creates a simple audio buffer with basic patterns for demonstration
 */
const NOTE_FREQUENCIES = {
  C: 261.63,
  'C#': 277.18,
  Db: 277.18,
  D: 293.66,
  'D#': 311.13,
  Eb: 311.13,
  E: 329.63,
  F: 349.23,
  'F#': 369.99,
  Gb: 369.99,
  G: 392.0,
  'G#': 415.3,
  Ab: 415.3,
  A: 440.0,
  'A#': 466.16,
  Bb: 466.16,
  B: 493.88
}

function normaliseRoot(master) {
  if (!master) return 'A'
  if (master.root) {
    return master.root.replace('♯', '#').replace('♭', 'b')
  }
  const base = master.rootBase || 'A'
  const accidental = master.accidental || 'natural'
  if (accidental === 'sharp') return `${base}#`
  if (accidental === 'flat') return `${base}b`
  return base
}

function getRootFrequency(master) {
  const note = normaliseRoot(master)
  return (NOTE_FREQUENCIES[note] || 440) / 2 // push roots into a comfortable lower register
}

function getScale(mode) {
  const m = (mode || '').toLowerCase()
  if (m.includes('major')) return [0, 2, 4, 5, 7, 9, 11]
  if (m.includes('dorian')) return [0, 2, 3, 5, 7, 9, 10]
  return [0, 2, 3, 5, 7, 8, 10] // natural minor by default
}

function pseudoRandom(index, seed) {
  const x = Math.sin((index + 1 + seed) * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function clampSample(v) {
  if (v > 1) return 1
  if (v < -1) return -1
  return v
}

function generateKick(ctx) {
  if (ctx.beatPhase > 0.4) return 0
  const env = Math.exp(-ctx.beatPhase * 28)
  const pitch = 60 + 140 * (1 - ctx.beatPhase)
  return Math.sin(2 * Math.PI * pitch * ctx.t) * env * 0.85
}

function generateBass(ctx) {
  const step = ctx.beatIndex
  const interval = ctx.scale[step % ctx.scale.length] - 12
  const freq = ctx.baseFreq * Math.pow(2, interval / 12)
  const env = Math.exp(-ctx.beatPhase * 6)
  const fundamental = Math.sin(2 * Math.PI * freq * ctx.t)
  const harmonic = Math.sin(2 * Math.PI * freq * 2 * ctx.t) * 0.35
  return (fundamental + harmonic) * env * 0.55
}

function generateLead(ctx) {
  const step = Math.floor(ctx.t / (ctx.secondsPerBeat / 2))
  const intervals = ctx.scale.map(n => n + 12)
  const interval = intervals[step % intervals.length]
  const freq = ctx.baseFreq * Math.pow(2, interval / 12)
  const env = Math.exp(-ctx.eighthPhase * 8)
  const vibrato = 1 + 0.015 * Math.sin(ctx.t * 6)
  return (Math.sin(2 * Math.PI * freq * vibrato * ctx.t) * 0.6 + Math.sin(2 * Math.PI * freq * 2 * ctx.t) * 0.25) * env * 0.5
}

function generatePad(ctx) {
  const chord = ctx.mode === 'major' ? [0, 4, 7, 11] : [0, 3, 7, 10]
  const spread = chord.map(i => ctx.baseFreq * Math.pow(2, (i + 12) / 12))
  const slowEnv = 0.6 + 0.35 * Math.sin(ctx.barPhase * Math.PI * 2)
  let sum = 0
  for (const freq of spread) {
    sum += Math.sin(2 * Math.PI * freq * ctx.t) * 0.4
    sum += Math.sin(2 * Math.PI * freq * 2 * ctx.t) * 0.2
  }
  return (sum / spread.length) * slowEnv * 0.6
}

function generateHihat(ctx) {
  if (ctx.sixteenthPhase > 0.2) return 0
  const env = Math.exp(-ctx.sixteenthPhase * 45)
  const noise = pseudoRandom(ctx.sampleIndex, ctx.seed) * 2 - 1
  return noise * env * 0.45
}

function generatePerc(ctx) {
  if (ctx.beatInBar !== 1 && ctx.beatInBar !== 3) return 0
  if (ctx.beatPhase > 0.45) return 0
  const env = Math.exp(-ctx.beatPhase * 28)
  const noise = (pseudoRandom(ctx.sampleIndex, ctx.seed) * 2 - 1) * 0.7
  const tone = Math.sin(2 * Math.PI * 180 * ctx.t) * 0.3
  return (noise + tone) * env * 0.6
}

function generatePerc2(ctx) {
  const offsetPhase = (ctx.eighthPhase + (ctx.beatInBar % 2) * 0.5) % 1
  if (offsetPhase > 0.3) return 0
  const env = Math.exp(-offsetPhase * 24)
  const freq = 600 + 200 * Math.sin(ctx.barIndex * 0.5)
  return (Math.sin(2 * Math.PI * freq * ctx.t) * 0.4) * env * 0.45
}

function generateArp(ctx) {
  const step = Math.floor(ctx.t / (ctx.secondsPerBeat / 4))
  const interval = ctx.scale[(step * 2) % ctx.scale.length] + 12
  const freq = ctx.baseFreq * Math.pow(2, interval / 12)
  const env = Math.exp(-ctx.sixteenthPhase * 16)
  return (Math.sin(2 * Math.PI * freq * ctx.t) * 0.5 + Math.sin(2 * Math.PI * freq * 2 * ctx.t) * 0.25) * env * 0.45
}

function generateFx(ctx) {
  const sweep = Math.sin(ctx.barPhase * Math.PI * 2)
  const noise = (pseudoRandom(ctx.sampleIndex, ctx.seed) * 2 - 1) * (0.4 + 0.3 * sweep)
  const tone = Math.sin(2 * Math.PI * (ctx.baseFreq / 4 + sweep * 60) * ctx.t) * 0.25
  return (noise + tone) * (0.5 + 0.3 * sweep)
}

function generateGeneric(ctx) {
  const freq = ctx.baseFreq * 2
  return (Math.sin(2 * Math.PI * freq * ctx.t) * 0.4 + Math.sin(2 * Math.PI * freq * 2 * ctx.t) * 0.2) * 0.4
}

function generateFallbackAudio(payload) {
  const { music_length_ms, stem, master: masterFromPayload, tempo: tempoOverride } = payload

  // Calculate audio parameters
  const sampleRate = 44100
  const length = Math.floor((music_length_ms || 10000) * sampleRate / 1000)

  // Create a simple audio buffer
  const buffer = new ArrayBuffer(44 + length * 2) // WAV header + 16-bit samples
  const view = new DataView(buffer)

  // Write WAV header
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, length * 2, true)

  const data = new Int16Array(buffer, 44)
  const master = masterFromPayload || {}
  const tempo = tempoOverride || master.tempo || 128
  const secondsPerBeat = 60 / tempo
  const secondsPerBar = secondsPerBeat * 4
  const baseFreq = getRootFrequency(master)
  const scale = getScale(master.mode)
  const mode = (master.mode || '').toLowerCase().includes('major') ? 'major' : 'minor'
  const seed = (stem || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const stemType = (stem || '').toLowerCase()

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    const beatFloat = t / secondsPerBeat
    const beatIndex = Math.floor(beatFloat)
    const beatPhase = beatFloat - beatIndex
    const beatInBar = beatIndex % 4
    const barFloat = t / secondsPerBar
    const barIndex = Math.floor(barFloat)
    const barPhase = barFloat - barIndex
    const eighthPhase = (t / (secondsPerBeat / 2)) % 1
    const sixteenthPhase = (t / (secondsPerBeat / 4)) % 1

    const ctx = {
      t,
      sampleRate,
      beatPhase,
      beatIndex,
      beatInBar,
      barPhase,
      barIndex,
      eighthPhase,
      sixteenthPhase,
      baseFreq,
      scale,
      secondsPerBeat,
      secondsPerBar,
      mode,
      seed,
      sampleIndex: i
    }

    let amplitude = 0
    switch (stemType) {
      case 'kick':
        amplitude = generateKick(ctx)
        break
      case 'bass':
        amplitude = generateBass(ctx)
        break
      case 'lead':
        amplitude = generateLead(ctx)
        break
      case 'pad':
        amplitude = generatePad(ctx)
        break
      case 'hihat':
        amplitude = generateHihat(ctx)
        break
      case 'perc':
        amplitude = generatePerc(ctx)
        break
      case 'perc2':
        amplitude = generatePerc2(ctx)
        break
      case 'arp':
        amplitude = generateArp(ctx)
        break
      case 'fx':
        amplitude = generateFx(ctx)
        break
      default:
        amplitude = generateGeneric(ctx)
        break
    }

    // Apply envelope to avoid clicks and clamp
    const envelope = Math.min(1, Math.min(t * 100, (length / sampleRate - t) * 100))
    data[i] = Math.round(clampSample(amplitude) * envelope * 32767)
  }

  return buffer
}

export async function composeOnce(payload, signal){
  // Check if Supabase is configured
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  
  if (!supabaseUrl || !supabaseKey || supabaseUrl === 'your_supabase_url_here') {
    console.warn('Supabase not configured, using fallback audio generation')
    return generateFallbackAudio(payload)
  }
  
  const functionUrl = `${supabaseUrl}/functions/v1/generate-techno-stem`
  const requestPayload = { 
    stem: payload.stem || 'kick',
    controls: payload.controls || {},
    master: payload.master || { tempo: 130, bars: 4, rootBase: 'A', accidental: 'natural', mode: 'Minor' }
  }
  
  try {
    const res = await fetch(functionUrl, {
      method: 'POST', 
      signal,
      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload)
    })
    
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const e = await res.json()
        if (e.error) msg = e.error
        if (e.upstream) msg += ` • upstream: ${e.upstream}`
      } catch { msg += ` • Raw: ${await res.text()}` }
      throw new Error(msg)
    }
    
    // The Edge Function returns JSON with audio_b64 field
    const result = await res.json()
    if (result.audio_b64) {
      // Convert base64 data URL to ArrayBuffer
      const base64Data = result.audio_b64.split(',')[1] // Remove data:audio/wav;base64, prefix
      const binaryString = atob(base64Data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      return bytes.buffer
    }
    
    throw new Error('No audio data in response')
  } catch (e) { 
    console.warn('Supabase Edge Function failed, falling back to local generation:', e.message)
    return generateFallbackAudio(payload)
  }
}

export async function composeWithRetries(st, tempo, bars, signal, deps){
  const beats = bars * 4
  const seconds = beats * (60 / tempo)
  let music_length_ms = Math.round(seconds * 1000) + (deps.genTailPadMs ?? 0)
  music_length_ms = Math.max(10000, Math.min(300000, music_length_ms))

  const master = deps.getMasterForPrompt()
  const controls = deps.getControls(st) || {}

  for (let tier = 0; tier < 3; tier++) {
    const prompt = deps.buildTierPrompt(st, controls, master, tier)
    if (typeof deps.statusUpdate === 'function') {
      const fmt = deps.primaryFormat || 'pcm_44100'
      deps.statusUpdate(`Creating… (${st}, tier ${tier + 1}/3 @ 44.1k ${fmt})`)
    }
    const body = deps.usePlan
      ? { composition_plan: buildCompositionPlan(master, deps.stemConfigs?.[st]?.basePrompt), prompt: null }
      : { prompt, music_length_ms }
    const enrichedBody = {
      ...body,
      stem: st,
      master,
      tempo,
      bars
    }
    const ab = await composeOnce(enrichedBody, signal)
    const buf = await deps.decodeAudio(ab)
    const ok = deps.validateBuffer(st, buf, tempo, bars)
    if (ok) return { buffer: buf, usedPrompt: prompt, tier }
  }

  const finalPrompt = deps.buildTierPrompt(st, controls, master, 2)
  const body = deps.usePlan
    ? { composition_plan: buildCompositionPlan(master, deps.stemConfigs?.[st]?.basePrompt), prompt: null }
    : { prompt: finalPrompt, music_length_ms }
  const enrichedBody = {
    ...body,
    stem: st,
    master,
    tempo,
    bars
  }
  const ab = await composeOnce(enrichedBody, signal)
  const buf = await deps.decodeAudio(ab)
  return { buffer: buf, usedPrompt: finalPrompt, tier: 2, failedValidation: true }
}

function computeTargetFrames(sr, bpm, bars){ const beats=bars*4; const seconds=beats*(60/bpm); return Math.round(seconds*sr) }
function sampleAt(data, idx){ const n=data.length; while(idx<0) idx+=n; while(idx>=n) idx-=n; return data[idx] }
function findBestSeamOffset(raw, startIdx, targetLen, xfadeN, alignSearchMs){
  const sr = raw.sampleRate
  const d0 = raw.getChannelData(0)
  const search = Math.max(0, Math.round((alignSearchMs/1000)*sr))
  const step = Math.max(1, Math.round(sr / 12000))
  let bestOffset = 0, bestScore = Number.POSITIVE_INFINITY
  for (let off = -search; off <= search; off += step) {
    let score = 0
    for (let i=0;i<xfadeN;i+=step) {
      const a = sampleAt(d0, startIdx + i + off)
      const b = sampleAt(d0, startIdx + targetLen - xfadeN + i + off)
      const diff = a - b
      score += diff*diff
    }
    if (score < bestScore) { bestScore = score; bestOffset = off }
  }
  return bestOffset
}
function applySeamCrossfade(buffer, xfadeMs){
  const sr=buffer.sampleRate, n=buffer.length
  const xfadeN=Math.max(2, Math.round((xfadeMs/1000)*sr))
  for(let c=0;c<buffer.numberOfChannels;c++){
    const d=buffer.getChannelData(c)
    for(let i=0;i<xfadeN;i++){
      const t=i/(xfadeN-1)
      const wa=Math.cos(0.5*Math.PI*t), wb=Math.sin(0.5*Math.PI*t)
      const endIdx=n-xfadeN+i
      d[endIdx]= (d[endIdx]*wa + d[i]*wb)
    }
    d[n-1]=d[0]
  }
}
function applyEdgeRamps(buffer, rampMs){
  const sr=buffer.sampleRate, n=buffer.length
  const ramp=Math.max(2, Math.round((rampMs/1000)*sr))
  for(let c=0;c<buffer.numberOfChannels;c++){
    const d=buffer.getChannelData(c)
    for(let i=0;i<ramp && i<n;i++) d[i]*=Math.sin(0.5*Math.PI*(i/(ramp-1)))
    for(let i=0;i<ramp && i<n;i++) d[n-1-i]*=Math.sin(0.5*Math.PI*(1-(i/(ramp-1))))
  }
}
function removeDcOffset(buffer){ const ch=buffer.numberOfChannels; for(let c=0;c<ch;c++){ const d=buffer.getChannelData(c); let sum=0; for(let i=0;i<d.length;i++) sum+=d[i]; const mean=sum/d.length; if(Math.abs(mean)>1e-6){ for(let i=0;i<d.length;i++) d[i]-=mean } } }
export function buildLoopBufferFromRawStrict(raw, bpm, bars, headIndex, opts={}){
  const { loopXfadeMs=24, edgeRampMs=8, alignSearchMs=45 } = opts
  removeDcOffset(raw)
  const sr=raw.sampleRate
  const target=computeTargetFrames(sr,bpm,bars)
  const ch=raw.numberOfChannels
  const out=new AudioBuffer({ length: target, numberOfChannels: ch, sampleRate: sr })
  const xfadeN=Math.max(2, Math.round((loopXfadeMs/1000)*sr))
  const bestOff=findBestSeamOffset(raw, headIndex, target, xfadeN, alignSearchMs)
  const start=((headIndex+bestOff)%raw.length + raw.length)%raw.length
  const end=start+target
  for(let c=0;c<ch;c++){
    const src=raw.getChannelData(c), dst=out.getChannelData(c)
    if(end<=raw.length) dst.set(src.subarray(start,end),0)
    else { const first=raw.length-start; dst.set(src.subarray(start),0); dst.set(src.subarray(0, target-first), first) }
  }
  applyEdgeRamps(out, edgeRampMs)
  applySeamCrossfade(out, loopXfadeMs)
  return out
}

export function buildHihatPrompt(controls, master, strictness=0){
  const { tempo, bars, root, mode } = master
  const g = [
    'Genre: modern techno',
    'TimeSignature: 4/4 (no swing)',
    `Tempo: ${tempo} BPM (constant; no variation)`,
    `Length: EXACT ${bars} bars (no extra bars)`,
    `Key: ${root} ${mode} (strictly diatonic; no modulation)`,
    'Start: bar 1 beat 1 (no count-in; no pre-roll)',
    `End: precisely at end of bar ${bars} (no tail; no reverb/delay bleed)`,
    'Loop: seamless at bar boundary (phase-coherent)',
    'Quantization: strict grid (no humanization)',
    'Delivery: instrumental only'
  ].join('. ')
  const role = roleDirectives('hihat', controls, bars)
  const common = [
    'STEM: HIHAT — solo closed hi-hat only.',
    'Identity: crisp techno closed hi-hat.',
    g,
    role,
    `Exclude: ${negatives('hihat')}`,
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ]
  if (strictness === 1) common.push('ABSOLUTE: Only closed-hat hits on a straight 1/16 grid; zero swing.')
  else if (strictness >= 2) common.push(
    'MUST: closed-hat hits on each 1/16 step (16 hits/bar).',
    'MUST: zero reverb tail at seam; gate hits before bar end.',
    'MUST: exclude open hat, ride, shaker, snare, clap, toms, crashes.'
  )
  return common.join(' ')
}
export function buildSnarePrompt(controls, master, strictness=0){
  const { tempo, bars, root, mode } = master
  const g = [
    'Genre: modern techno',
    'TimeSignature: 4/4 (no swing)',
    `Tempo: ${tempo} BPM (constant; no variation)`,
    `Length: EXACT ${bars} bars (no extra bars)`,
    `Key: ${root} ${mode} (strictly diatonic; no modulation)`,
    'Start: bar 1 beat 1 (no count-in; no pre-roll)',
    `End: precisely at end of bar ${bars} (no tail; no reverb/delay bleed)`,
    'Loop: seamless at bar boundary (phase-coherent)',
    'Quantization: strict grid (no humanization)',
    'Delivery: instrumental only'
  ].join('. ')
  const role      = roleDirectives('perc', controls, bars)
  const common = [
    'STEM: SNARE — solo snare only.',
    'Identity: industrial techno snare; drum-machine style; no clap.',
    g,
    role,
    `Exclude: ${negatives('perc')}`,
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ]
  if (strictness === 1) common.push('ABSOLUTE: only beat 2 and beat 4 per bar; no extra hits.', 'ABSOLUTE: no off-grid timing.')
  else if (strictness >= 2) common.push('MUST: exactly one snare on beat 2 and one on beat 4 per bar, nothing else.', 'MUST: gate decay fully before the seam; exclude clap/rim layers.')
  return common.join(' ')
}

export function buildArpPrompt(controls, master){
  const { tempo, bars, root, mode } = master
  const g = [
    'Genre: modern techno',
    'TimeSignature: 4/4 (no swing)',
    `Tempo: ${tempo} BPM (constant; no variation)`,
    `Length: EXACT ${bars} bars (no extra bars)`,
    `Key: ${root} ${mode} (strictly diatonic; no modulation)`,
    'Start: bar 1 beat 1 (no count-in; no pre-roll)',
    `End: precisely at end of bar ${bars} (no tail; no reverb/delay bleed)`,
    'Loop: seamless at bar boundary (phase-coherent)',
    'Quantization: strict grid (no humanization)',
    'Delivery: instrumental only'
  ].join('. ')
  const role = roleDirectives('arp', controls, bars)
  return [
    'STEM: ARPEGGIATOR — solo synth arpeggio only.',
    'Identity: modern techno arp.',
    g,
    role,
    `Exclude: ${negatives('arp')}`,
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ].join(' ')
}
export function buildFXPrompt(controls, master){
  const { tempo, bars, root, mode } = master
  const g = [
    'Genre: modern techno',
    'TimeSignature: 4/4 (no swing)',
    `Tempo: ${tempo} BPM (constant; no variation)`,
    `Length: EXACT ${bars} bars (no extra bars)`,
    `Key: ${root} ${mode} (strictly diatonic; no modulation)`,
    'Start: bar 1 beat 1 (no count-in; no pre-roll)',
    `End: precisely at end of bar ${bars} (no tail; no reverb/delay bleed)`,
    'Loop: seamless at bar boundary (phase-coherent)',
    'Quantization: strict grid (no humanization)',
    'Delivery: instrumental only'
  ].join('. ')
  const role = roleDirectives('fx', controls, bars)
  return [
    'STEM: FX — solo bar-internal whooshes/sweeps/noise beds that reset each bar.',
    'Identity: techno-style FX bed.',
    g,
    role,
    `Exclude: ${negatives('fx')}`,
    'Avoid risers/falls that exceed a single bar.',
    'Deliver a bar-perfect seamless loop; zero tail beyond the bar.'
  ].join(' ')
}
export function buildPercLoopPrompt(controls, master){
  const { tempo, bars, root, mode } = master
  const g = [
    'Genre: modern techno',
    'TimeSignature: 4/4 (no swing)',
    `Tempo: ${tempo} BPM (constant; no variation)`,
    `Length: EXACT ${bars} bars (no extra bars)`,
    `Key: ${root} ${mode} (strictly diatonic; no modulation)`,
    'Start: bar 1 beat 1 (no count-in; no pre-roll)',
    `End: precisely at end of bar ${bars} (no tail; no reverb/delay bleed)`,
    'Loop: seamless at bar boundary (phase-coherent)',
    'Quantization: strict grid (no humanization)',
    'Delivery: instrumental only'
  ].join('. ')
  const role = roleDirectives('perc2', controls, bars)
  return [
    'STEM: PERCUSSION — solo top percussion only (shakers/blocks/taps); not snare/hat/kick.',
    'Identity: modern techno percussion loop.',
    g,
    role,
    `Exclude: ${negatives('perc2')}`,
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ].join(' ')
}
export function buildStemPrompt(st, controls, master, strictness=0){
  if (st === 'hihat') return buildHihatPrompt(controls, master, strictness)
  if (st === 'perc')  return buildSnarePrompt(controls, master, strictness)
  if (st === 'arp')   return buildArpPrompt(controls, master)
  if (st === 'fx')    return buildFXPrompt(controls, master)
  if (st === 'perc2') return buildPercLoopPrompt(controls, master)
  const stemBase = 'single instrument'
  const global   = [
    'Genre: modern techno',
    'TimeSignature: 4/4 (no swing)',
    `Tempo: ${master.tempo} BPM (constant; no variation)`,
    `Length: EXACT ${master.bars} bars (no extra bars)`,
    `Key: ${master.root} ${master.mode} (strictly diatonic; no modulation)`,
    'Start: bar 1 beat 1 (no count-in; no pre-roll)',
    `End: precisely at end of bar ${master.bars} (no tail; no reverb/delay bleed)`,
    'Loop: seamless at bar boundary (phase-coherent)',
    'Quantization: strict grid (no humanization)',
    'Delivery: instrumental only'
  ].join('. ')
  const role     = roleDirectives(st, controls, master.bars)
  const negs     = `Exclude: ${negatives(st)}`
  return [
    `STEM: ${st.toUpperCase()} — solo ${stemBase}.`,
    global,
    role,
    negs,
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ].join(' ')
}
