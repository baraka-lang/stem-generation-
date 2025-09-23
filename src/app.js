// app.js — Techno Generator (Loop-Perfect Edition) — Player/Mixer toggle + wider sliders + hotkeys
// Modified to add card numbering, waveform navigation buttons, help modal and red borders on mute.

import { createClient } from '@supabase/supabase-js'

/* =========================================================
   Feature flags / Env toggles
   ========================================================= */
const USE_COMPOSITION_PLAN = String(import.meta.env.VITE_ELEVEN_USE_PLAN || 'false').toLowerCase() === 'true'
const PRIMARY_OUTPUT_FORMAT = 'pcm_44100'
const FALLBACK_OUTPUT_FORMAT = 'mp3_44100_128'

/* =========================================================
   Generation format (server)
   ========================================================= */
const PRO_FORMAT = PRIMARY_OUTPUT_FORMAT

/* =========================================================
   UX flags
   ========================================================= */
const PROMPTS_MODE = 'builder' // 'builder' | 'freeform'

/* =========================================================
   Transport / DSP constants
   ========================================================= */
const TEMPO_MIN = 110
const TEMPO_MAX = 140
const DEFAULT_TEMPO = 130
const DEFAULT_BARS  = 4

const START_ENV_MS   = 5
const EDGE_RAMP_MS   = 5
const LOOP_XFADE_MS  = 12
const ALIGN_SEARCH_MS = 45
const ZERO_FALLBACK_SAMPLES = 384

const BOUNDARY_LOOKAHEAD_MS = 120
const GEN_TAIL_PAD_MS = 200

/* =========================================================
   EQ‑3 + Filter defaults
   ========================================================= */
const EQ_MIN_DB = -80
const EQ_MAX_DB =  +6
const EQ_DEFAULT = 50
const EQ_SMOOTH_TC = 0.02

const EQ_LOW_FREQ  = 180
const EQ_MID_FREQ  = 2200
const EQ_MID_Q     = 1.20
const EQ_HIGH_FREQ = 6500

const FILTER_MIN_HZ = 40
const FILTER_MAX_HZ = 18000
const FILTER_Q = 0.707
const FILTER_SMOOTH_TC = 0.02
const FILTER_DEFAULT_HZ = 12000 // 12 kHz default

/* =========================================================
   Global state
   ========================================================= */
let audioContext = null
let masterGain   = null
let isPlaying    = false

const stemRaw   = {}
const stemLoop  = {}
// active nodes: { source, env, filter, eq:{low,mid,high}, gain }
const stemNodes = {}
const stemGains = {}

// Each stem maintains its own loop duration.  When a loop is built from a raw
// buffer (after generation or when selecting a take), its duration is stored
// here.  The transport uses these durations to compute per‑stem phases and
// restart offsets, ensuring each stem plays back at its own tempo without
// reference to a shared master tempo.
const stemLoopDuration = {}

let stemControlValues = {}
let stemMuteStates = {}
let soloedStem = null

const stemEqValues = {}
const stemFilterValues = {}

let loopStartTime  = 0
let loopDuration   = 0
let transportTicker = null

let referenceStemType = null
let referenceHeadIndex = 0 // samples at decoded SR

// Takes
const stemHistory = {}
const stemActiveIndex = {}
const HISTORY_LIMIT = 50
function ensureStemHistory(st) {
  if (!stemHistory[st]) stemHistory[st] = []
  if (stemActiveIndex[st] == null) stemActiveIndex[st] = -1
}
function pushStemVersion(st, entry) {
  ensureStemHistory(st)
  stemHistory[st].push(entry)
  if (stemHistory[st].length > HISTORY_LIMIT) stemHistory[st].shift()
  stemActiveIndex[st] = stemHistory[st].length - 1
  updateHistoryBadge(st)
  updateHistoryIndicator(st)
  updateCardNumberColor(st)
  updateTempoIndicator(st)
}
function getActiveVersion(st) {
  ensureStemHistory(st)
  const i = stemActiveIndex[st]
  if (i < 0) return null
  return stemHistory[st][i]
}

/* =========================================================
   Supabase client
   ========================================================= */
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

/* =========================================================
   Visual helpers
   ========================================================= */
function getColorRGB(colorName) {
  const m = {
    red: '239, 68, 68',
    orange: '249, 115, 22',
    yellow: '234, 179, 8',
    green: '34, 197, 94',
    cyan: '6, 182, 212',
    purple: '147, 51, 234',
    blue: '59, 130, 246',
    pink: '236, 72, 153'
  }
  return m[colorName] || '156, 163, 175'
}
function drawWaveform(canvas, audioBuffer, color) {
  if (!canvas || !audioBuffer) return
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  const data = audioBuffer.getChannelData(0)
  const step = Math.ceil(data.length / width)
  const amp = height / 2
  ctx.beginPath()
  for (let x = 0; x < width; x++) {
    let min = 1, max = -1
    for (let j = 0; j < step && (x*step + j) < data.length; j++) {
      const v = data[x*step + j]
      if (v < min) min = v
      if (v > max) max = v
    }
    const y1 = (1 + min) * amp
    const y2 = (1 + max) * amp
    ctx.moveTo(x, y1)
    ctx.lineTo(x, y2)
  }
  ctx.stroke()
}
function drawTinyWaveform(canvas, audioBuffer) {
  if (!canvas || !audioBuffer) return
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 1
  const data = audioBuffer.getChannelData(0)
  const step = Math.max(1, Math.floor(data.length / (width * 2)))
  const amp = height / 2
  ctx.beginPath()
  for (let x = 0, i = 0; x < width; x++, i += step) {
    let min = 1, max = -1
    for (let k = 0; k < step && (i + k) < data.length; k++) {
      const v = data[i + k]
      if (v < min) min = v
      if (v > max) max = v
    }
    const y1 = (1 + min) * amp
    const y2 = (1 + max) * amp
    ctx.moveTo(x, y1)
    ctx.lineTo(x, y2)
  }
  ctx.stroke()
}

/* =========================================================
   Stem configs (9 cards) — order defines 1–9 hotkeys
   ========================================================= */
const stemConfigs = {
  kick:  {
    name: 'Kick', color: 'red', basePrompt: 'deep techno kick drum',
    controls: {
      punch: { type:'knob', min:0, max:100, default:70, unit:'%', label:'Punch' },
      decay: { type:'knob', min:0, max:100, default:40, unit:'%', label:'Decay' },
      texture:{ type:'toggle', default:false, label:'Distortion' },
      volume:{ type:'knob', min:0, max:100, default:80, unit:'%', label:'Volume' }
    }
  },
  perc:  {
    name: 'Snare', color: 'cyan', basePrompt: 'industrial techno snare',
    controls: {
      intensity:{ type:'knob', min:0, max:100, default:60, unit:'%', label:'Intensity' },
      variation:{ type:'knob', min:0, max:100, default:40, unit:'%', label:'Variation' },
      metallic:{ type:'toggle', default:false, label:'Metallic' },
      volume:{ type:'knob', min:0, max:100, default:80, unit:'%', label:'Volume' }
    }
  },
  bass:  {
    name: 'Bass', color: 'yellow', basePrompt: 'dark techno bassline',
    controls: {
      depth:{ type:'knob', min:0, max:100, default:80, unit:'%', label:'Depth' },
      movement:{ type:'knob', min:0, max:100, default:30, unit:'%', label:'Movement' },
      filter:{ type:'toggle', default:true, label:'Filter Sweep' },
      volume:{ type:'knob', min:0, max:100, default:80, unit:'%', label:'Volume' }
    }
  },
  lead:  {
    name: 'Lead', color: 'green', basePrompt: 'hypnotic techno lead synth',
    controls: {
      brightness:{ type:'knob', min:0, max:100, default:50, unit:'%', label:'Brightness' },
      complexity:{ type:'knob', min:0, max:100, default:40, unit:'%', label:'Complexity' },
      delay:{ type:'toggle', default:false, label:'Delay' },
      volume:{ type:'knob', min:0, max:100, default:80, unit:'%', label:'Volume' }
    }
  },
  hihat: {
    name: 'Hihat', color: 'orange', basePrompt: 'crisp techno closed hi-hat',
    controls: {
      brightness:{ type:'knob', min:0, max:100, default:60, unit:'%', label:'Brightness' },
      pattern:{ type:'knob', min:0, max:100, default:50, unit:'%', label:'Pattern' },
      reverb:{ type:'toggle', default:false, label:'Reverb' },
      volume:{ type:'knob', min:0, max:100, default:80, unit:'%', label:'Volume' }
    }
  },
  pad:   {
    name: 'Pad', color: 'purple', basePrompt: 'ambient techno pad',
    controls: {
      warmth:{ type:'knob', min:0, max:100, default:60, unit:'%', label:'Warmth' },
      evolution:{ type:'knob', min:0, max:100, default:30, unit:'%', label:'Evolution' },
      chorus:{ type:'toggle', default:true, label:'Chorus' },
      volume:{ type:'knob', min:0, max:100, default:80, unit:'%', label:'Volume' }
    }
  },
  arp:   {
    name: 'Arp', color: 'blue', basePrompt: 'techno synthesizer arpeggio',
    controls: {
      rate:{ type:'knob', min:0, max:100, default:55, unit:'%', label:'Rate' },
      complexity:{ type:'knob', min:0, max:100, default:60, unit:'%', label:'Complexity' },
      gate:{ type:'toggle', default:false, label:'Long Gate' },
      volume:{ type:'knob', min:0, max:100, default:80, unit:'%', label:'Volume' }
    }
  },
  fx:    {
    name: 'FX', color: 'pink', basePrompt: 'techno transition effects and atmos',
    controls: {
      intensity:{ type:'knob', min:0, max:100, default:65, unit:'%', label:'Intensity' },
      movement:{ type:'knob', min:0, max:100, default:50, unit:'%', label:'Movement' },
      reverb:{ type:'toggle', default:true, label:'Small Reverb' },
      volume:{ type:'knob', min:0, max:100, default:80, unit:'%', label:'Volume' }
    }
  },
  perc2: {
    name: 'Perc', color: 'orange', basePrompt: 'techno top percussion loop',
    controls: {
      density:{ type:'knob', min:0, max:100, default:60, unit:'%', label:'Density' },
      groove:{ type:'knob', min:0, max:100, default:50, unit:'%', label:'Groove' },
      metallic:{ type:'toggle', default:false, label:'Metallic' },
      volume:{ type:'knob', min:0, max:100, default:80, unit:'%', label:'Volume' }
    }
  }
}
// Fixed hotkey order (1–9)
const STEM_ORDER = ['kick','perc','bass','lead','hihat','pad','arp','fx','perc2']

/* =========================================================
   Prompt scaffold (unchanged)
   ========================================================= */
const SESSION_TAG = (() => Math.random().toString(36).slice(2, 10))()
function globalScaffold({ tempo, bars, root, mode }) {
  //
  // Construct a global scaffold for the prompt that strongly emphasises
  // strict adherence to tempo and bar length. ElevenLabs documentation
  // notes that the model follows BPM when explicitly told to【732721151118734†L136-L146】.  To
  // reinforce this behaviour, we provide ABSOLUTE directives to insist
  // on the exact tempo and number of bars.  This helps minimise
  // deviations where the generated audio might otherwise be slightly
  // faster or slower than the requested BPM.  The loop description also
  // clarifies that the full length of the audio should match the
  // specified bars at the given tempo, with no extra or missing
  // material.
  return [
    `Project: ${SESSION_TAG}`,
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
    // ABSOLUTE directive to follow the tempo and bar count exactly.  This
    // line explicitly instructs the model not to deviate from the given
    // BPM and not to add or remove bars.  We include this to
    // complement the existing instructions above and align with
    // ElevenLabs recommendations【732721151118734†L136-L146】.
    `ABSOLUTE: The loop length must be exactly ${bars} bars at ${tempo} BPM; do not alter the tempo or add/remove bars`
  ].join('. ')
}
function scaleKnob(v, a, b, c, d, e) {
  const x = Number(v ?? 50)
  if (x <= 20) return a
  if (x <= 40) return b
  if (x <= 60) return c
  if (x <= 80) return d
  return e
}

/* ---------- Builders (hihat/snare strict + others) ---------- */
// (Builders unchanged; omitted for brevity in comments — logic preserved)
function buildHihatPrompt(controls, master, strictness=0){ /* ... same as before ... */ 
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
function buildSnarePrompt(controls, master, strictness=0){ /* ... same as before ... */ 
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
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ]
  if (strictness === 1) common.push('ABSOLUTE: only beat 2 and beat 4 per bar; no extra hits.', 'ABSOLUTE: no off-grid timing.')
  else if (strictness >= 2) common.push('MUST: exactly one snare on beat 2 and one on beat 4 per bar, nothing else.', 'MUST: gate decay fully before the seam; exclude clap/rim layers.')
  return common.join(' ')
}
function mapArpRate(v){ const x=Number(v??55); return x<=33?'1/8 notes': x<=66?'1/16 notes':'1/32 notes' }
function buildArpPrompt(controls, master){ /* ... same as before ... */ 
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const rate = mapArpRate(controls.rate)
  const complexity = scaleKnob(controls.complexity, 'simple','moderate','interesting','intricate','ornate')
  const gate = controls.gate ? 'long-ish gate (80–160ms)' : 'short gate (30–80ms)'
  return [
    'STEM: ARPEGGIATOR — solo synth arpeggio only.',
    `Identity: ${stemConfigs.arp.basePrompt}.`,
    g,
    'ROLE: isolated arp; strictly diatonic in ${root} ${mode}; no chords.',
    `Pattern: ${rate}; fully quantized; phrase length must evenly divide ${bars} bars.`,
    `Complexity: ${complexity}; consistent motif and octave moves.`,
    `Envelope: ${gate}; no delay/reverb across seam.`,
    'Exclude: drums/percussion/bass/pads/leads/vocals.',
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ].join(' ')
}
function buildFXPrompt(controls, master){ /* ... same as before ... */ 
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const intensity = scaleKnob(controls.intensity, 'subtle','moderate','medium','strong','intense')
  const movement  = scaleKnob(controls.movement, 'static','gentle motion','evolving','animated','dynamic')
  const space = controls.reverb ? 'Space: tiny room; decay ≤ 150ms; gate before bar end.' : 'Space: dry/minimal; gate before bar end.'
  return [
    'STEM: FX — solo techno transition effects & atmos only.',
    `Identity: ${stemConfigs.fx.basePrompt}.`,
    g,
    'ROLE: bar-internal whooshes/sweeps/noise beds that RESET each bar.',
    `Intensity: ${intensity}. Movement: ${movement}.`,
    space,
    'Exclude: pitched melodies/drums/percussion; avoid risers/falls that exceed a single bar.',
    'Deliver a bar-perfect seamless loop; zero tail beyond the bar.'
  ].join(' ')
}
function buildPercLoopPrompt(controls, master){ /* ... same as before ... */ 
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const density = scaleKnob(controls.density, 'sparse','light','medium','busy','dense')
  const metallic = controls.metallic ? 'slightly metallic timbre allowed' : 'organic timbre preferred'
  const groove = scaleKnob(controls.groove, 'straight','straight with mild syncopation','syncopated but quantized','complex yet quantized','complex yet quantized')
  return [
    'STEM: PERCUSSION — solo top percussion only (shakers/blocks/taps); not snare/hat/kick.',
    `Identity: ${stemConfigs.perc2.basePrompt}.`,
    g,
    `ROLE: quantized on-grid accents; ${groove}; zero swing.`,
    `Density: ${density}; keep consistent across bars.`,
    `Timbre: ${metallic}; short releases; zero tails at seam.`,
    'Exclude: tonal hits/kick/snare/clap/hat/ride/toms/crashes.',
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ].join(' ')
}
function roleDirectives(st, c){ /* ... same as before ... */ 
  switch (st) {
    case 'kick': return [
      'ROLE: single isolated kick only',
      'Pattern: four-on-the-floor; hits on beats 1–4 every bar',
      'Pitch: unpitched; no tonal sub note; no toms',
      `Decay: ${scaleKnob(c.decay, 'very short','short','medium','long','very long')}`,
      `Punch: ${scaleKnob(c.punch, 'soft','firm','punchy','very punchy','aggressive')}`,
      c.texture ? 'Saturation: light; no tail' : 'Saturation: minimal; clean transient',
      'Exclude: fills/intro flam/crashes'
    ].join('. ')
    case 'bass': return [
      'ROLE: single isolated bass only',
      'Harmony: strictly diatonic in project key (no chromatic notes)',
      'Pitch: root + fifth primarily; occasional octave',
      `Movement: ${scaleKnob(c.movement, 'static','simple','groovy','animated','busy')} repeating per bar`,
      `Depth: ${scaleKnob(c.depth, 'light','medium','deep','deeper','subby')} low-end; controlled release`,
      c.filter ? 'Filter: subtle motion within bar; reset each bar' : 'Filter: stable',
      'Start note on beat 1; no slides across seam'
    ].join('. ')
    case 'lead': return [
      'ROLE: single isolated lead synth only',
      'Melody: strictly diatonic; avoid chromatic passing tones',
      `Phrase length evenly divides ${Math.max(1, stemControlValues?.master?.bars || DEFAULT_BARS)} bar(s)`,
      `Complexity: ${scaleKnob(c.complexity, 'simple','moderate','interesting','intricate','ornate')} (quantized)`,
      `Brightness: ${scaleKnob(c.brightness,'dark','mellow','balanced','bright','very bright')}`,
      c.delay ? 'Delay: minimal tempo-synced; cut at bar end' : 'Delay: off',
      'No bends/slides across loop seam'
    ].join('. ')
    case 'pad': return [
      'ROLE: single isolated pad only',
      'Chord: sustained diatonic chord(s); no modulation',
      `Evolution: ${scaleKnob(c.evolution,'static','gentle','subtle motion','evolving','animated')} but reset every bar`,
      `Warmth: ${scaleKnob(c.warmth,'cool','neutral','warm','lush','very lush')}`,
      c.chorus ? 'Chorus: subtle; no stereo smear at seam' : 'Chorus: off',
      'No long reverb tail; envelope ends before bar boundary'
    ].join('. ')
    default: return 'ROLE: single isolated instrument only'
  }
}
function negatives(st){ /* ... same as before ... */ 
  const common = [
    'no vocals or speech','no cymbal crash on the last beat','no count-in','no pre-roll',
    'no silence at start','no tempo changes','no swing','no off-grid timing','no modulation or key change'
  ]
  const per = {
    kick:['no toms','no pitch glides','no tonal sub drops','no reverb tail'],
    hihat:['no open hats','no ride','no shaker','no clap','no snare','no pitch sweeps','no reverb tail'],
    perc:['no clap','no rimshot','no hi-hat','no kick','no toms','no melodic percussion','no reverb tail'],
    bass:['no chords','no distortion tail','no slides across seam'],
    lead:['no atonal notes','no portamento across seam','no long delay tail'],
    pad:['no huge reverb','no side instruments','no arpeggios','no tail at seam'],
    arp:['no drums','no percussion','no bass','no pads','no leads','no vocals','no FX'],
    fx:['no drums or percussion','no pitched melodies','no vocals','no tails across seam'],
    perc2:['no kick','no snare','no clap','no hi-hat','no ride','no toms','no tonal hits','no tail across seam']
  }
  return [...common, ...(per[st] || [])].join('; ')
}
function buildStemPrompt(st, strictness=0){
  const controls = stemControlValues[st] || {}
  const master = getMasterForPrompt()
  if (st === 'hihat') return buildHihatPrompt(controls, master, strictness)
  if (st === 'perc')  return buildSnarePrompt(controls, master, strictness)
  if (st === 'arp')   return buildArpPrompt(controls, master)
  if (st === 'fx')    return buildFXPrompt(controls, master)
  if (st === 'perc2') return buildPercLoopPrompt(controls, master)
  const cfg = stemConfigs[st]
  const stemBase = cfg?.basePrompt || 'single instrument'
  const global   = globalScaffold(master)
  const role     = roleDirectives(st, controls)
  const negs     = negatives(st)
  return [
    `STEM: ${st.toUpperCase()} — solo ${stemBase}.`,
    global,
    role,
    `Avoid: ${negs}.`,
    'Deliver a bar-perfect loop that aligns exactly with bar boundaries and starts at bar 1 beat 1.'
  ].join(' ')
}

/* =========================================================
   Audio graph (Filter + EQ)
   ========================================================= */
async function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)()
    masterGain = audioContext.createGain()
    masterGain.gain.setValueAtTime(0.9, audioContext.currentTime)
    masterGain.connect(audioContext.destination)
  }
  if (audioContext.state === 'suspended') await audioContext.resume()
}
function createEqNodes() {
  const low  = audioContext.createBiquadFilter()
  low.type = 'lowshelf'
  low.frequency.setValueAtTime(EQ_LOW_FREQ, audioContext.currentTime)
  low.gain.setValueAtTime(0, audioContext.currentTime)

  const mid  = audioContext.createBiquadFilter()
  mid.type = 'peaking'
  mid.frequency.setValueAtTime(EQ_MID_FREQ, audioContext.currentTime)
  mid.Q.setValueAtTime(EQ_MID_Q, audioContext.currentTime)
  mid.gain.setValueAtTime(0, audioContext.currentTime)

  const high = audioContext.createBiquadFilter()
  high.type = 'highshelf'
  high.frequency.setValueAtTime(EQ_HIGH_FREQ, audioContext.currentTime)
  high.gain.setValueAtTime(0, audioContext.currentTime)

  return { low, mid, high }
}
function knobToFreq(val) {
  const v = Math.max(0, Math.min(100, Number(val)||0))
  const lnMin = Math.log(FILTER_MIN_HZ), lnMax = Math.log(FILTER_MAX_HZ)
  const lnF = lnMin + (v/100) * (lnMax - lnMin)
  return Math.exp(lnF)
}
function freqToKnob(freq) {
  const f = Math.max(FILTER_MIN_HZ, Math.min(FILTER_MAX_HZ, Number(freq)||FILTER_DEFAULT_HZ))
  const lnMin = Math.log(FILTER_MIN_HZ), lnMax = Math.log(FILTER_MAX_HZ)
  const lnF = Math.log(f)
  return Math.round(((lnF - lnMin) / (lnMax - lnMin)) * 100)
}
function createFilterNode(st) {
  const filter = audioContext.createBiquadFilter()
  const vals = stemFilterValues[st] || { mode: 'lowpass', cutoff: freqToKnob(FILTER_DEFAULT_HZ) }
  filter.type = vals.mode
  filter.Q.setValueAtTime(FILTER_Q, audioContext.currentTime)
  filter.frequency.setValueAtTime(knobToFreq(vals.cutoff), audioContext.currentTime)
  return filter
}
function createStemNodes(st, loopBuffer) {
  const src = audioContext.createBufferSource()
  src.buffer = loopBuffer
  src.loop = true
  src.loopStart = 0
  src.loopEnd = loopBuffer.duration

  const env = audioContext.createGain()
  env.gain.setValueAtTime(0, audioContext.currentTime)

  const filter = createFilterNode(st)
  const eq = createEqNodes()

  const g = stemGains[st] || audioContext.createGain()
  if (!stemGains[st]) {
    stemGains[st] = g
    const vol = (stemControlValues[st]?.volume ?? 80) / 100
    g.gain.setValueAtTime(vol, audioContext.currentTime)
    g.connect(masterGain)
  }

  src.connect(env)
  env.connect(filter)
  filter.connect(eq.low)
  eq.low.connect(eq.mid)
  eq.mid.connect(eq.high)
  eq.high.connect(g)

  applyEqValuesToNodes(eq, stemEqValues[st] || { low: EQ_DEFAULT, mid: EQ_DEFAULT, high: EQ_DEFAULT })
  applyFilterValuesToNode(filter, stemFilterValues[st] || { mode: 'lowpass', cutoff: freqToKnob(FILTER_DEFAULT_HZ) })

  return { source: src, env, filter, eq, gain: g }
}

/* =========================================================
   Loop math + seam tools
   ========================================================= */
// (unchanged helpers)
function clampTempo(t){ const x=Math.round(Number(t)||DEFAULT_TEMPO); return Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, x)) }
function computeTargetFrames(sr, bpm, bars){ const beats=bars*4; const seconds=beats*(60/bpm); return Math.round(seconds*sr) }
function removeDcOffset(buffer){ const ch=buffer.numberOfChannels; for(let c=0;c<ch;c++){ const d=buffer.getChannelData(c); let sum=0; for(let i=0;i<d.length;i++) sum+=d[i]; const mean=sum/d.length; if(Math.abs(mean)>1e-6){ for(let i=0;i<d.length;i++) d[i]-=mean } } }
function nearestZeroCrossing(data, around, radius){ const n=data.length; let best=around,bestVal=Math.abs(data[around]||0); const a=Math.max(0,around-radius), b=Math.min(n-1,around+radius); for(let i=a;i<=b;i++){ const v=Math.abs(data[i]); if(v<bestVal){ bestVal=v; best=i } } return best }
function detectHeadIndex(buffer){ const sr=buffer.sampleRate; const maxMs=1000; const maxN=Math.min(buffer.length, Math.round((maxMs/1000)*sr)); if(maxN<=0) return 0; const x=buffer.getChannelData(0); const env=new Float32Array(maxN); for(let i=0;i<maxN;i++) env[i]=Math.abs(x[i]); const win=Math.max(2, Math.round((8/1000)*sr)); let acc=0; for(let i=0;i<win && i<env.length;i++) acc+=env[i]; const sm=new Float32Array(maxN); for(let i=0;i<maxN;i++){ if(i>=win) acc+=env[i]-env[i-win]; sm[i]=acc/Math.min(win,i+1) } let peak=0; for(let i=0;i<maxN;i++) if(sm[i]>peak) peak=sm[i]; const th=Math.max(Math.pow(10,-45/20), peak*0.12); const backOff=Math.round(0.0035*sr); for(let i=0;i<maxN;i++) if(sm[i]>=th){ const z=nearestZeroCrossing(x, Math.max(0,i-backOff), ZERO_FALLBACK_SAMPLES); return Math.max(0,z) } return 0 }
function sampleAt(data, idx){ const n=data.length; while(idx<0) idx+=n; while(idx>=n) idx-=n; return data[idx] }
function findBestSeamOffset(raw, startIdx, targetLen, xfadeN){
  const sr = raw.sampleRate
  const d0 = raw.getChannelData(0)
  const search = Math.max(0, Math.round((ALIGN_SEARCH_MS/1000)*sr))
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
function applySeamCrossfade(buffer, xfadeMs=LOOP_XFADE_MS){
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
function applyEdgeRamps(buffer, rampMs=EDGE_RAMP_MS){
  const sr=buffer.sampleRate, n=buffer.length
  const ramp=Math.max(2, Math.round((rampMs/1000)*sr))
  for(let c=0;c<buffer.numberOfChannels;c++){
    const d=buffer.getChannelData(c)
    for(let i=0;i<ramp && i<n;i++) d[i]*=Math.sin(0.5*Math.PI*(i/(ramp-1)))
    for(let i=0;i<ramp && i<n;i++) d[n-1-i]*=Math.sin(0.5*Math.PI*(1-(i/(ramp-1))))
  }
}
function buildLoopBufferFromRawStrict(raw, bpm, bars, headIndex){
  removeDcOffset(raw)
  const sr=raw.sampleRate
  const target=computeTargetFrames(sr,bpm,bars)
  const ch=raw.numberOfChannels
  const out=new AudioBuffer({ length: target, numberOfChannels: ch, sampleRate: sr })
  const xfadeN=Math.max(2, Math.round((LOOP_XFADE_MS/1000)*sr))
  const bestOff=findBestSeamOffset(raw, headIndex, target, xfadeN)
  const start=((headIndex+bestOff)%raw.length + raw.length)%raw.length
  const end=start+target
  for(let c=0;c<ch;c++){
    const src=raw.getChannelData(c), dst=out.getChannelData(c)
    if(end<=raw.length) dst.set(src.subarray(start,end),0)
    else { const first=raw.length-start; dst.set(src.subarray(start),0); dst.set(src.subarray(0, target-first), first) }
  }
  applyEdgeRamps(out, EDGE_RAMP_MS)
  applySeamCrossfade(out, LOOP_XFADE_MS)
  return out
}

/* =========================================================
   Validators (unchanged)
   ========================================================= */
function countOnsets(buf, refractorySec=0.08, relThresh=0.35){
  const sr=buf.sampleRate
  const x=buf.getChannelData(0)
  let sum=0; for(let i=0;i<x.length;i+=512){ const v=x[i]; sum+=v*v }
  const rms=Math.sqrt(sum/Math.max(1, Math.floor(x.length/512)))
  const thr=Math.max(0.02, rms*relThresh)
  const refr=Math.max(1, Math.round(refractorySec*sr))
  let peaks=0,i=0
  while(i<x.length){ if(Math.abs(x[i])>=thr){ peaks++; i+=refr } else i++ }
  return peaks
}
function validateSnare(buf, bpm, bars, tolMs=40){
  const sr=buf.sampleRate
  const barSec=4*(60/bpm)
  const beatSec=60/bpm
  const tol=Math.round((tolMs/1000)*sr)
  const x=buf.getChannelData(0)
  function hasPeakNear(sampleIdx, win=tol, mult=3.0){
    const a=Math.max(0, sampleIdx-win), b=Math.min(x.length-1, sampleIdx+win)
    let s=0,n=0; for(let i=a;i<=b;i+=4){ const v=x[i]; s+=v*v; n++ }
    const rms=Math.sqrt(s/Math.max(1,n))
    const thr=Math.max(0.02, rms*mult)
    for(let i=a;i<=b;i+=2) if(Math.abs(x[i])>=thr) return true
    return false
  }
  for(let bar=0; bar<bars; bar++){
    const barStart=Math.round(bar*barSec*sr)
    const beat2=barStart+Math.round(1*beatSec*sr)
    const beat4=barStart+Math.round(3*beatSec*sr)
    if(!hasPeakNear(beat2) || !hasPeakNear(beat4)) return false
  }
  return true
}
function validateHihat(buf, bpm, bars){
  const expected=bars*16
  const found=countOnsets(buf, 0.07, 0.35)
  return found >= Math.max(10, Math.round(expected * 0.6))
}

/* =========================================================
   Playback indicators + Play button icon
   ========================================================= */
// Update the progress indicators for each stem.  Instead of using a single
// shared phase for all instruments, compute the phase per stem based on its
// individual loop duration.  This allows stems generated at different tempos
// to display progress accurately and ensures loops remain independent.
function updatePlaybackIndicators() {
  if (!audioContext) return
  const t = audioContext.currentTime
  Object.keys(stemConfigs).forEach(st => {
    const indicator = document.querySelector(`[data-stem-indicator="${st}"]`)
    const buf = stemLoop[st]
    if (!indicator || !buf) return
    const dur = stemLoopDuration[st] || buf.duration
    if (dur <= 0 || !isFinite(dur)) return
    const phase = ((t - loopStartTime) % dur) / dur
    indicator.style.left = `${phase * 100}%`
    indicator.style.opacity = '1'
  })
}
function updatePlayButtonIcon() {
  const btn = document.getElementById('playBtn')
  if (!btn) return
  const icon = btn.querySelector('[data-lucide]')
  if (icon) { icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play'); window.lucide?.createIcons() }
  else { btn.textContent = isPlaying ? 'Pause' : 'Play' }
}

/* =========================================================
   Transport
   ========================================================= */
function startTransport() {
  if (isPlaying) return
  isPlaying = true
  updatePlayButtonIcon()

  // We no longer compute a global loop duration.  Each stem uses its own
  // buffer length for looping.  Record the start time of this transport so
  // that per‑stem phases can be computed relative to a common origin.
  const t0 = audioContext.currentTime + START_ENV_MS/1000
  loopStartTime = t0

  Object.keys(stemConfigs).forEach(st => {
    const indicator = document.querySelector(`[data-stem-indicator="${st}"]`)
    if (indicator) { indicator.style.left = '0%'; indicator.style.opacity = '1' }
  })

  Object.keys(stemLoop).forEach(st => {
    const buf = stemLoop[st]
    if (!buf) return
    const nodes = createStemNodes(st, buf)
    stemNodes[st] = nodes
    nodes.env.gain.setValueAtTime(0, t0)
    nodes.env.gain.linearRampToValueAtTime(1, t0 + START_ENV_MS/1000)
    const vol = (stemControlValues[st]?.volume ?? 80)/100
    const muted = stemMuteStates[st]
    const soloedOther = (soloedStem && soloedStem !== st)
    nodes.gain.gain.setValueAtTime((muted || soloedOther) ? 0 : vol, t0)
    nodes.source.start(t0)
  })

  if (transportTicker) clearInterval(transportTicker)
  transportTicker = setInterval(() => {
    if (!isPlaying) return
    updatePlaybackIndicators()
  }, 25)

  updateAllMixerGlows()
}
function stopTransport() {
  if (!isPlaying) return
  isPlaying = false
  updatePlayButtonIcon()

  const stopAt = audioContext.currentTime + 0.005
  Object.keys(stemConfigs).forEach(st => {
    const indicator = document.querySelector(`[data-stem-indicator="${st}"]`)
    if (indicator) { indicator.style.left = '0%'; indicator.style.opacity = '0' }
  })

  Object.values(stemNodes).forEach(n => {
    if (!n?.source) return
    n.env.gain.cancelScheduledValues(audioContext.currentTime)
    n.env.gain.setValueAtTime(n.env.gain.value, audioContext.currentTime)
    n.env.gain.linearRampToValueAtTime(0, stopAt)
    try { n.source.stop(stopAt) } catch {}
  })
  Object.keys(stemNodes).forEach(k => delete stemNodes[k])
  if (transportTicker) clearInterval(transportTicker)
  transportTicker = null

  updateAllMixerGlows()
}
function restartStemNextBoundary(st) {
  if (!isPlaying) return
  const buf = stemLoop[st]
  if (!buf) return
  const dur = stemLoopDuration[st] || buf.duration
  if (dur <= 0) return
  // Compute how far into the current loop we are relative to when playback started.
  // This allows the new buffer to start at the same phase as the old one.
  const elapsed = (audioContext.currentTime - loopStartTime) % dur
  const startAt = audioContext.currentTime
  const next = createStemNodes(st, buf)
  const prev = stemNodes[st]
  stemNodes[st] = next

  const vol = (stemControlValues[st]?.volume ?? 80) / 100
  const muted = stemMuteStates[st]
  const soloedOther = (soloedStem && soloedStem !== st)
  next.gain.gain.setValueAtTime((muted || soloedOther) ? 0 : vol, startAt)
  next.env.gain.setValueAtTime(1, startAt)
  try {
    next.source.start(startAt, elapsed)
  } catch {}
  if (prev?.source) {
    try { prev.source.stop(startAt) } catch {}
  }
  updateMixerGlow(st)
}

/* =========================================================
   Eleven Music compose (unchanged core)
   ========================================================= */
const genControllers = new Map()
function getNewStemController(st){ const prev=genControllers.get(st); if(prev && !prev.signal.aborted) prev.abort(new DOMException('Superseded','AbortError')); const ctrl=new AbortController(); genControllers.set(st, ctrl); return ctrl }
function buildCompositionPlan({ tempo, bars }, descriptor){ const ms=Math.round(bars*4*(60/tempo)*1000); return { positive_global_styles:["techno","instrumental","loop"], negative_global_styles:["vocals","fade-in","fade-out","free-time"], sections:[{ section_name:"Loop", positive_local_styles:[descriptor||"modern techno"], negative_local_styles:["rubato","modulation","improv cadenza"], duration_ms: ms, lines: [] }] } }
async function composeOnce(payload, signal){
  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/eleven-music-compose`
  const tryPayload = (fmt) => ({ ...payload, output_format: fmt, model_id: 'music_v1', respect_sections_durations: true })
  let lastErr = null
  for (const fmt of [PRIMARY_OUTPUT_FORMAT, FALLBACK_OUTPUT_FORMAT]) {
    try {
      const res = await fetch(functionUrl, {
        method: 'POST', signal,
        headers: { 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(tryPayload(fmt))
      })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try {
          const e = await res.json()
          if (e.error) msg = e.error
          if (e.upstream) msg += ` • upstream: ${e.upstream}`
        } catch { msg += ` • Raw: ${await res.text()}` }
        if (fmt === PRIMARY_OUTPUT_FORMAT && /only allowed for Pro|PCM/i.test(msg)) { lastErr = new Error(msg); continue }
        throw new Error(msg)
      }
      return res.arrayBuffer()
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('composeOnce failed')
}
async function composeWithRetries(st, tempo, bars, signal, statusEl){
  const beats=bars*4
  const seconds=beats*(60/tempo)
  let music_length_ms=Math.round(seconds*1000)+GEN_TAIL_PAD_MS
  music_length_ms=Math.max(10000, Math.min(300000, music_length_ms))
  const master=getMasterForPrompt()
  const controls=stemControlValues[st]||{}
  for(let tier=0;tier<3;tier++){
    const prompt=(st==='hihat')?buildHihatPrompt(controls, master, tier):buildSnarePrompt(controls, master, tier)
    if (statusEl) statusEl.textContent=`Generating… (${st}, tier ${tier+1}/3 @ 44.1k ${PRIMARY_OUTPUT_FORMAT})`
    const body=USE_COMPOSITION_PLAN?{ composition_plan: buildCompositionPlan(master, stemConfigs[st]?.basePrompt), prompt: null }:{ prompt, music_length_ms }
    const ab=await composeOnce(body, signal)
    const buf=await audioContext.decodeAudioData(ab)
    const ok=(st==='hihat')?validateHihat(buf, tempo, bars):validateSnare(buf, tempo, bars)
    if(ok) return { buffer: buf, usedPrompt: prompt, tier }
  }
  const finalPrompt=(st==='hihat')?buildHihatPrompt(controls, master, 2):buildSnarePrompt(controls, master, 2)
  const body=USE_COMPOSITION_PLAN?{ composition_plan: buildCompositionPlan(master, stemConfigs[st]?.basePrompt), prompt: null }:{ prompt: finalPrompt, music_length_ms }
  const ab=await composeOnce(body, signal)
  const buf=await audioContext.decodeAudioData(ab)
  return { buffer: buf, usedPrompt: finalPrompt, tier: 2, failedValidation: true }
}
async function generateStem(st) {
  await ensureAudioContext()
  const ctrl = getNewStemController(st)
  const { signal } = ctrl

  const button = document.querySelector(`[data-stem="${st}"] [data-action="generate"]`)
  const statusEl = document.querySelector(`[data-stem="${st}"] .status-line`)
  const card = document.querySelector(`[data-stem="${st}"]`)

  try {
    if (button) {
      button.disabled = true
      const icon = button.querySelector('[data-lucide]')
      if (icon) { icon.setAttribute('data-lucide', 'loader-2'); icon.classList.add('loading-spin'); window.lucide?.createIcons() }
    }
    if (card) card.classList.add('is-generating')
    if (statusEl) statusEl.textContent = `Generating… (Eleven Music v1)`

    const tempo = clampTempo(stemControlValues.master?.tempo ?? DEFAULT_TEMPO)
    const bars  = stemControlValues.master?.bars  ?? DEFAULT_BARS

    // Offload prompt construction, composition and loop fixing to Supabase.
    let audioBuffer, usedPrompt, tier, validated
    try {
      // Build request payload with per‑stem controls and master settings.  The
      // master settings include the root base, accidental and mode, which are
      // preserved from the UI.  We also pass a flag to indicate that Grok
      // composition is disabled on the server for now.
      const payload = {
        stem: st,
        controls: stemControlValues[st] || {},
        master: {
          tempo,
          bars,
          rootBase: stemControlValues.master?.rootBase || 'A',
          accidental: stemControlValues.master?.accidental || 'natural',
          mode: stemControlValues.master?.mode || 'Minor',
        },
        use_grok: false,
      }

      // Invoke the Supabase Edge function via the official client.  The
      // supabase-js client automatically injects authentication headers
      // and handles cross‑origin calls on our behalf.  If the call
      // fails (for example due to CORS or a missing JWT), we fall
      // back to a direct fetch against the `functions.supabase.co`
      // domain using the anon key.  This dual approach improves
      // resilience when running locally or via preview hosts where
      // the Supabase client may not be configured with a valid
      // Authorization token.  See the Supabase docs for disabling
      // JWT verification【810483078752586†L232-L254】.
      let fnData = null
      try {
        const { data, error } = await supabase.functions.invoke('generate-techno-stem', { body: payload, signal })
        if (error) throw error
        fnData = data
      } catch (invokeErr) {
        console.warn('supabase.functions.invoke failed, falling back to fetch:', invokeErr?.message)
        // Fallback: construct direct URL to the Edge Function on the
        // main supabase domain.  We send the payload as plain text
        // (`Content-Type: text/plain`) to avoid CORS preflight.  The
        // anon key is attached as a query parameter instead of a
        // header, since custom headers cause preflight.
        try {
          const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '')
          const match = supabaseUrl.match(/https?:\/\/(.*?)\.supabase\.co/)
          const projectRef = match ? match[1] : ''
          const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')
          if (!projectRef) throw new Error('Missing project ref for fallback')
          const fnName = 'generate-techno-stem'
          // Build a GET URL to avoid CORS preflight.  We encode the JSON
          // payload into the `payload` query parameter and attach the
          // anon key as `apikey`.  Example:
          //   https://<project>.supabase.co/functions/v1/<fnName>?apikey=<anonKey>&payload=<encoded>
          // Encode the payload once.  We avoid using URLSearchParams for the
          // payload value to prevent double encoding.  The anonymous key
          // is URL‑encoded separately.
          const encodedPayload = encodeURIComponent(JSON.stringify(payload))
          const encodedAnon = anonKey ? encodeURIComponent(anonKey) : ''
          let fetchUrl = `https://${projectRef}.supabase.co/functions/v1/${fnName}`
          const qs = []
          if (encodedAnon) qs.push(`apikey=${encodedAnon}`)
          qs.push(`payload=${encodedPayload}`)
          fetchUrl += `?${qs.join('&')}`
          const fetchOptions = { method: 'GET', signal }
          const resp = await fetch(fetchUrl, fetchOptions)
          if (!resp.ok) {
            const txt = await resp.text().catch(() => '')
            throw new Error(`Fallback fetch error ${resp.status}: ${txt}`)
          }
          const json = await resp.json()
          fnData = json
        } catch (fallbackErr) {
          // Rethrow with context
          throw new Error(fallbackErr?.message || 'Failed to send a request to the Edge Function')
        }
      }
      if (!fnData) {
        throw new Error('No response from Supabase function')
      }

      usedPrompt = fnData.usedPrompt
      tier = fnData.tier
      validated = !!fnData.validated
      // Decode base64 WAV returned from the server
      const b64 = String(fnData.audio_b64 || '')
      const base64Data = b64.split(',').pop() || ''
      const binStr = atob(base64Data)
      const len = binStr.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i)
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      audioBuffer = await audioContext.decodeAudioData(ab)
    } catch (e) {
      // Propagate the error to the outer catch for user feedback
      throw e
    }

    // Detect head index for record keeping (not used for playback)
    try {
      referenceHeadIndex = detectHeadIndex(audioBuffer)
      referenceStemType = st
    } catch {}

    // Store raw buffer for reference and use the trimmed loop as returned from the server.
    stemRaw[st]  = audioBuffer
    stemLoop[st] = audioBuffer
    stemLoopDuration[st] = audioBuffer.duration

    pushStemVersion(st, {
      id: `${st}_${Date.now()}`,
      createdAt: new Date().toISOString(),
      prompt: usedPrompt,
      tempo, bars,
      sessionTag: SESSION_TAG,
      headIndex: referenceHeadIndex,
      raw: audioBuffer,
      meta: { tier, validated }
    })
    renderHistoryDrawer(st)

    // Do not rebuild other loops when head index changes; each stem keeps its own alignment

    const canvas = document.querySelector(`[data-stem="${st}"] .waveform-canvas`)
    if (canvas) {
      const cfg = stemConfigs[st]
      drawWaveform(canvas, stemLoop[st], `rgb(${getColorRGB(cfg.color)})`)
    }
    if (statusEl) {
      const base = `Ready (${stemLoop[st].duration.toFixed(3)}s, loop-aligned)`
      // Use the validated flag returned from the server to indicate success.  If
      // validation failed after retries, show a warning.  Otherwise, show
      // the strictness tier when greater than 0.
      statusEl.textContent = (!validated)
        ? `${base} — warning: validation failed after retries (kept strict take)`
        : (tier > 0 ? `${base} — strict tier ${tier + 1}` : `${base}`)
    }

    if (isPlaying) restartStemNextBoundary(st)
    updateMixerGlow(st)
    updateCardNumberColor(st)
    updateHistoryIndicator(st)
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(`❌ Generation error (${st}):`, err)
      if (statusEl) statusEl.textContent = `Error: ${err.message}`
    } else {
      if (statusEl) statusEl.textContent = 'Generation cancelled'
    }
  } finally {
    if (genControllers.get(st) === ctrl) genControllers.delete(st)
    if (button) {
      button.disabled = false
      const icon = button.querySelector('[data-lucide]')
      if (icon) { icon.setAttribute('data-lucide', 'wand-2'); icon.classList.remove('loading-spin'); window.lucide?.createIcons() }
    }
    if (card) card.classList.remove('is-generating')
  }
}

/* =========================================================
   Downloads (unchanged)
   ========================================================= */
function encodeWAV(audioBuffer){
  const srcCh=audioBuffer.numberOfChannels
  const len=audioBuffer.length
  const sr=audioBuffer.sampleRate
  const bps=2
  const chans=Array.from({ length: srcCh }, (_, c) => audioBuffer.getChannelData(c))
  const interleaved=new Float32Array(len*srcCh)
  let o=0; for(let i=0;i<len;i++) for(let c=0;c<srcCh;c++) interleaved[o++]=chans[c][i]
  const blockAlign=srcCh*bps, byteRate=sr*blockAlign, dataSize=interleaved.length*bps
  const buffer=new ArrayBuffer(44+dataSize); const view=new DataView(buffer)
  writeAscii(view,0,'RIFF'); view.setUint32(4,36+dataSize,true); writeAscii(view,8,'WAVE')
  writeAscii(view,12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true)
  writeAscii(view,22,String.fromCharCode(srcCh)); view.setUint16(22,srcCh,true)
  view.setUint32(24,sr,true); view.setUint32(28,byteRate,true)
  view.setUint16(32,blockAlign,true); view.setUint16(34,16,true)
  writeAscii(view,36,'data'); view.setUint32(40,dataSize,true)
  let off=44
  for(let i=0;i<interleaved.length;i++,off+=2){ let s=Math.max(-1,Math.min(1, interleaved[i])); s=s<0?s*0x8000:s*0x7FFF; view.setInt16(off,s,true) }
  return new Blob([view], { type: 'audio/wav' })
  function writeAscii(v,o,s){ for(let i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)) }
}
function downloadStem(st){
  const buf=stemLoop[st]
  if(!buf){ alert(`No audio for ${stemConfigs[st]?.name || st}. Generate first.`); return }
  const wav=encodeWAV(buf)
  const url=URL.createObjectURL(wav)
  const a=document.createElement('a')
  a.href=url; a.download=`techno_${st}_${Date.now()}.wav`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/* =========================================================
   UI rendering (per card) — with black generate btn, wider sliders, click‑overlay for toggles
   ========================================================= */
function knobToDb(val){
  const v=Math.max(0, Math.min(100, Number(val)||0))
  if (v <= 50) return EQ_MIN_DB + (v/50) * (0 - EQ_MIN_DB)
  return ((v - 50) / 50) * EQ_MAX_DB
}
function formatDb(db){
  if (db <= EQ_MIN_DB + 0.5) return 'CUT'
  if (Math.abs(db) < 0.05) return '0 dB'
  return `${db.toFixed(1)} dB`
}
function knobAngle(val){ return -135 + (val/100)*270 }
function applyEqValuesToNodes(eqNodes, vals){
  if (!eqNodes || !audioContext) return
  const now=audioContext.currentTime
  eqNodes.low.gain.setTargetAtTime(knobToDb(vals.low), now, EQ_SMOOTH_TC)
  eqNodes.mid.gain.setTargetAtTime(knobToDb(vals.mid), now, EQ_SMOOTH_TC)
  eqNodes.high.gain.setTargetAtTime(knobToDb(vals.high), now, EQ_SMOOTH_TC)
}
function applyFilterValuesToNode(filterNode, vals){
  if (!filterNode || !audioContext) return
  const now=audioContext.currentTime
  filterNode.type=vals.mode
  filterNode.Q.setTargetAtTime(FILTER_Q, now, FILTER_SMOOTH_TC)
  filterNode.frequency.setTargetAtTime(knobToFreq(vals.cutoff), now, FILTER_SMOOTH_TC)
}
function updateEqKnobVisual(knobEl, val){
  if(!knobEl) return
  knobEl.dataset.value=String(val)
  const ptr=knobEl.querySelector('[data-eq-pointer]')
  if (ptr) ptr.style.transform=`translateX(-50%) rotate(${knobAngle(val)}deg)`
}
function updateEqReadout(st, band){
  const v=(stemEqValues[st]||{})[band] ?? EQ_DEFAULT
  const db=knobToDb(v)
  const ro=document.querySelector(`[data-eq-readout="${st}:${band}"]`)
  if (ro) ro.textContent=formatDb(db)
}

/* ---------- Filter UI ---------- */
function updateFilterKnobVisual(knobEl, val){
  if(!knobEl) return
  knobEl.dataset.value=String(val)
  const ptr=knobEl.querySelector('[data-filter-pointer]')
  if (ptr) ptr.style.transform=`translateX(-50%) rotate(${knobAngle(val)}deg)`
}
function updateFilterReadout(st){
  const v=(stemFilterValues[st]||{}).cutoff ?? freqToKnob(FILTER_DEFAULT_HZ)
  const hz=knobToFreq(v)
  const ro=document.querySelector(`[data-filter-readout="${st}"]`)
  if (ro) ro.textContent = hz >= 1000 ? `${(hz/1000).toFixed(hz>=10000?0:1)} kHz` : `${Math.round(hz)} Hz`
}
function updateFilterModeButton(st){
  const btn=document.querySelector(`[data-filter-mode="${st}"]`)
  if(!btn) return
  const mode=(stemFilterValues[st]||{}).mode || 'lowpass'
  btn.textContent = mode === 'lowpass' ? 'LP' : 'HP'
}

/* ---------- Per-card HTML ---------- */
function eqKnobHTML(st, band, label){
  const v=(stemEqValues[st]||{})[band] ?? EQ_DEFAULT
  const ang=knobAngle(v)
  return `\n        <div class="flex flex-col items-center select-none">\n          <div class="relative w-10 h-10 rounded-full border border-white/20 bg-white/5 shadow-inner cursor-[ns-resize]"\n               data-eq-knob data-stem="${st}" data-band="${band}" data-value="${v}" title="${label}: drag to adjust">\n            <div class="absolute inset-0 rounded-full" style="box-shadow: inset 0 2px 6px rgba(0,0,0,0.35), inset 0 -1px 2px rgba(255,255,255,0.05)"></div>\n            <div class="absolute w-0.5 h-3 bg-white/90 rounded pointer-events-none"\n                 data-eq-pointer\n                 style="left:50%; bottom:50%; transform: translateX(-50%) rotate(${ang}deg); transform-origin: bottom center;"></div>\n          </div>\n          <div class="mt-1 text-[10px] tracking-wider text-white/80">${label.toUpperCase()}</div>\n          <div class="text-[10px] text-white/60" data-eq-readout="${st}:${band}">${formatDb(knobToDb(v))}</div>\n        </div>\n      `
}
function filterKnobHTML(st){
  const v=(stemFilterValues[st]||{}).cutoff ?? freqToKnob(FILTER_DEFAULT_HZ)
  const ang=knobAngle(v)
  const mode=(stemFilterValues[st]||{}).mode || 'lowpass'
  return `\n        <div class="flex items-center gap-2">\n          <div class="flex flex-col items-center select-none">\n            <div class="relative w-10 h-10 rounded-full border border-white/20 bg-white/5 shadow-inner cursor-[ns-resize]"\n                 data-filter-knob data-stem="${st}" data-value="${v}" title="Filter Cutoff: drag to adjust">\n              <div class="absolute inset-0 rounded-full" style="box-shadow: inset 0 2px 6px rgba(0,0,0,0.35), inset 0 -1px 2px rgba(255,255,255,0.05)"></div>\n              <div class="absolute w-0.5 h-3 bg-white/90 rounded pointer-events-none"\n                   data-filter-pointer\n                   style="left:50%; bottom:50%; transform: translateX(-50%) rotate(${ang}deg); transform-origin: bottom center;"></div>\n            </div>\n            <div class="mt-1 text-[10px] tracking-wider text-white/80">CUTOFF</div>\n            <div class="text-[10px] text-white/60" data-filter-readout="${st}"></div>\n          </div>\n          <button class="h-6 px-2 rounded-md border border-white/15 bg-white/80 text-black text-[10px] font-semibold tracking-wider hover:bg-white active:translate-y-[1px] transition"\n                  data-action="toggle-filter-mode" data-stem="${st}" data-filter-mode="${st}" title="Toggle LP/HP">\n            ${mode === 'lowpass' ? 'LP' : 'HP'}\n          </button>\n        </div>\n      `
}
function headerActionButtonsHTML(st){
  return `\n        <div class="flex items-center gap-1.5">\n          <button class="sg-toggle w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="mute-stem" data-stem="${st}" title="Mute/Unmute" aria-pressed="false">\n            <i data-lucide="volume-2" class="w-4 h-4"></i>\n          </button>\n          <button class="sg-toggle w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="solo-stem" data-stem="${st}" title="Solo" aria-pressed="false">\n            <i data-lucide="headphones" class="w-4 h-4"></i>\n          </button>\n          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-stem="${st}" title="Favorite (coming soon)">\n            <i data-lucide="heart" class="w-4 h-4"></i>\n          </button>\n          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="download-stem" data-stem="${st}" title="Download">\n            <i data-lucide="download" class="w-4 h-4"></i>\n          </button>\n        </div>\n      `
}
function createBuilderStemCard(st, cfg){
  const card = document.createElement('div')
  card.className = `glass card-border rounded-2xl p-6 transition-all duration-300 hover:scale-[1.02] border-l-4 border-l-${cfg.color}-500`
  card.setAttribute('data-stem', st)

  const idx = STEM_ORDER.indexOf(st) + 1

  const headerHTML = `\n        <div class="flex items-center justify-between mb-2">\n          <div class="flex items-center gap-2">\n            <span data-card-number="${st}" class="stem-index inline-flex items-center justify-center w-5 h-5 text-xs font-semibold rounded-full border border-white/30">${idx}</span>\n            <h3 class="text-lg font-medium text-white">${cfg.name}</h3>\n          </div>\n          ${headerActionButtonsHTML(st)}\n        </div>\n      `

  const eqFilterHTML = `\n        <div class="flex items-center justify-between gap-6 mb-2">\n          <div class="flex items-center gap-6">\n            ${eqKnobHTML(st, 'low',  'Low')}\n            ${eqKnobHTML(st, 'mid',  'Mid')}\n            ${eqKnobHTML(st, 'high', 'High')}\n          </div>\n          <div class="flex items-center gap-3">\n            ${filterKnobHTML(st)}\n          </div>\n        </div>\n      `

  // Volume row (label-left)
  let volumeHTML = ''
  if (cfg.controls?.volume) {
    const vcfg = cfg.controls.volume
    const vid = `${st}-volume`
    const vval = stemControlValues[st]?.volume ?? vcfg.default
    volumeHTML = `\n        <div class="flex items-center gap-2 mb-2">\n          <label class="text-xs text-white/70 shrink-0 w-24">Volume</label>\n          <input type="range" id="${vid}" min="${vcfg.min}" max="${vcfg.max}" value="${vval}" step="1"\n                 class="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"\n                 style="flex:1.5 1 0%"\n                 data-stem="${st}" data-control="volume">\n          <span class="text-xs w-10 text-right">${vval}${vcfg.unit}</span>\n        </div>\n      `
  }

  // Waveform + takes
  const waveformHTML = `\n        <div class="mb-2">\n          <div class="relative group">\n            <canvas class="waveform-canvas w-full h-16 bg-white/5 rounded-md border border-white/10 cursor-pointer"\n                    width="400" height="64" data-stem="${st}" title="Click to browse takes"></canvas>\n            <div class="absolute inset-y-0 left-0 w-0.5 bg-purple-400 shadow-glow pointer-events-none transition-all duration-75 ease-linear opacity-0"\n                 data-stem-indicator="${st}"></div>\n            <!-- Takes and open -->\n            <div class="absolute left-2 top-2 text-[10px] flex flex-col items-start">\n              <div class="px-1.5 py-0.5 rounded bg-black/60 border border-white/10 text-white/90 pointer-events-none select-none">\n                takes: <span data-history-count="${st}">0</span> (#<span data-active-index="${st}">0</span>)\n              </div>\n              <button class="mt-0.5 px-1.5 py-0.5 rounded player-surface border border-white/10 text-white/90 text-[10px] hover:bg-white/10 transition"\n                      data-action="open-takes" data-stem="${st}" type="button">open</button>\n            </div>\n            <!-- Tempo indicator -->\n            <div class="absolute right-2 top-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 border border-white/10 text-white/90 pointer-events-none select-none" data-tempo-indicator="${st}">\n              tempo: --\n            </div>\n            <!-- Centered arrows -->\n            <div class="absolute inset-0 flex items-center justify-center gap-4 pointer-events-none">\n              <button class="px-2 py-1 rounded player-surface border border-white/10 text-white/90 flex items-center justify-center hover:bg-white/10 transition pointer-events-auto"\n                      data-action="prev-take" data-stem="${st}" type="button" title="Previous take">\n                <i data-lucide="chevron-left" class="w-5 h-5"></i>\n              </button>\n              <button class="px-2 py-1 rounded player-surface border border-white/10 text-white/90 flex items-center justify-center hover:bg-white/10 transition pointer-events-auto"\n                      data-action="next-take" data-stem="${st}" type="button" title="Next take">\n                <i data-lucide="chevron-right" class="w-5 h-5"></i>\n              </button>\n            </div>\n          </div>\n        </div>\n        <div class="overflow-hidden transition-all duration-200 ease-out max-h-0" data-history-drawer="${st}">\n          <div class="flex items-center justify-between text-xs text-white/60 mt-1 mb-2">\n            <span>Previous takes</span>\n            <button class="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-[11px]"\n                    data-action="close-history" data-stem="${st}">Close</button>\n          </div>\n          <div class="flex gap-2 overflow-x-auto pb-2 no-scrollbar" data-history-list="${st}"></div>\n        </div>\n      `

  // Sliders (two knobs) — label-left, 50% wider sliders (equal size)
  let slidersRowsHTML = ''
  let togglesMenuHTML = ''
  if (cfg.controls) {
    const entries = Object.entries(cfg.controls).filter(([k]) => k !== 'volume')
    const knobEntries = entries.filter(([,c]) => c.type === 'knob')
    const toggleEntries = entries.filter(([,c]) => c.type === 'toggle')

    knobEntries.forEach(([key, c]) => {
      const id = `${st}-${key}`
      const val = stemControlValues[st]?.[key] ?? c.default
      slidersRowsHTML += `\n            <div class="flex items-center gap-2">\n              <label for="${id}" class="w-24 shrink-0 text-[11px] text-white/80 whitespace-nowrap">${c.label}</label>\n              <input type="range" id="${id}" min="${c.min}" max="${c.max}" value="${val}" step="1"\n                     class="w-full h-1 rounded-lg appearance-none cursor-pointer bg-white/20"\n                     style="flex:2.25 1 0%"\n                     data-stem="${st}" data-control="${key}">\n              <span class="text-[11px] w-10 text-right">${val}${c.unit}</span>\n            </div>\n          `
    })

    toggleEntries.forEach(([key, c]) => {
      const id = `${st}-${key}`
      const val = stemControlValues[st]?.[key] ?? c.default
      togglesMenuHTML += `\n            <label class="flex items-center gap-2 text-xs text-white/90">\n              <input type="checkbox" id="${id}" ${val ? 'checked' : ''} class="w-4 h-4 rounded border-white/40 bg-transparent"\n                     data-stem="${st}" data-control="${key}">\n              <span>${c.label}</span>\n            </label>\n          `
    })
  }

  // Generate panel: player-surface look, black Generate button, click-to-toggle overlay above sliders
  const genPanelHTML = `\n        <div class="mt-3 rounded-xl player-surface text-white border-2 border-white/80 shadow-sm p-3 relative">\n          <div class="flex items-start gap-4">\n            <div class="relative flex-1">\n              <div class="grid grid-cols-1 gap-2">${slidersRowsHTML}</div>\n              <div class="absolute left-0 right-0 -top-2 z-20 hidden" data-options-panel="${st}">\n                <div class="bg-black border-2 border-white/80 rounded-xl p-3 shadow-xl">\n                  ${togglesMenuHTML || '<div class="text-xs text-white/60">No options</div>'}\n                </div>\n              </div>\n            </div>\n            <div class="flex flex-col items-end">\n              <button class="w-9 h-9 rounded-lg border border-white/30 flex items-center justify-center hover:bg-white/10"\n                      data-action="toggle-stem-options" data-stem="${st}" aria-pressed="false" title="Stem options">\n                <i data-lucide="sliders" class="w-4 h-4"></i>\n              </button>\n            </div>\n          </div>\n          <button class="mt-3 w-full py-2.5 rounded-xl bg-black text-white font-semibold border border-white/30 shadow-sm hover:shadow transition will-change-transform hover:-translate-y-0.5 active:translate-y-[1px]"\n                  data-action="generate" data-stem="${st}" title="Generate new take">\n            <span class="inline-flex items-center gap-2">\n              <i data-lucide="wand-2" class="w-4 h-4"></i>\n              Generate\n            </span>\n          </button>\n        </div>\n      `

  card.innerHTML = headerHTML + eqFilterHTML + volumeHTML + waveformHTML + genPanelHTML + `\n        <div class="status-line hidden mt-2 text-sm text-white/80">Ready to generate</div>\n      `

  updateHistoryBadge(st)
  updateFilterReadout(st)
  return card
}

/* =========================================================
   Master controls, Mixer (Docked), events
   ========================================================= */
function initializeStemControlValues() {
  stemControlValues = {
    master: { tempo: DEFAULT_TEMPO, bars: DEFAULT_BARS, rootBase: 'A', accidental: 'natural', mode: 'Minor' }
  }
  stemMuteStates = {}
  const defCutKnob = freqToKnob(FILTER_DEFAULT_HZ)
  Object.entries(stemConfigs).forEach(([st, cfg]) => {
    stemControlValues[st] = {}
    stemMuteStates[st] = false
    if (!stemEqValues[st]) stemEqValues[st] = { low: EQ_DEFAULT, mid: EQ_DEFAULT, high: EQ_DEFAULT }
    if (!stemFilterValues[st]) stemFilterValues[st] = { mode: 'lowpass', cutoff: defCutKnob }
    if (cfg.controls) Object.entries(cfg.controls).forEach(([k, c]) => { stemControlValues[st][k] = c.default })
  })
}

/* ---------- Mixer glow ---------- */
function isStemActuallyPlaying(st){ return isPlaying && !!stemNodes[st]?.source && !stemMuteStates[st] && (!soloedStem || soloedStem === st) }
function updateMixerGlow(st){ const card=document.querySelector(`[data-mix-card="${st}"]`); if(!card) return; card.classList.toggle('sg-glow', isStemActuallyPlaying(st)) }
function updateAllMixerGlows(){ Object.keys(stemConfigs).forEach(updateMixerGlow) }

/* ---------- Toggle visuals (Mute/Solo) ---------- */
function setToggleVisual(el, active){ if (!el) return; el.classList.toggle('sg-toggle-active', !!active); el.setAttribute('aria-pressed', active ? 'true' : 'false') }
function reflectMuteSoloButtons(st){
  const muted=!!stemMuteStates[st]
  const soloed=(soloedStem===st)
  setToggleVisual(document.querySelector(`[data-stem="${st}"] [data-action="mute-stem"]`), muted)
  setToggleVisual(document.querySelector(`[data-stem="${st}"] [data-action="solo-stem"]`), soloed)
  setToggleVisual(document.querySelector(`[data-action="mix-mute"][data-stem="${st}"]`), muted)
  setToggleVisual(document.querySelector(`[data-action="mix-solo"][data-stem="${st}"]`), soloed)
}

/* ---------- Volume link ---------- */
function setVolumeUnified(st, newVal){
  const v=Math.max(0, Math.min(100, Math.round(Number(newVal)||0)))
  stemControlValues[st].volume=v

  const slider=document.querySelector(`[data-stem="${st}"] [data-control="volume"]`)
  if (slider) {
    slider.value=v
    const display=slider.parentElement?.querySelector('span:last-child')
    const cfg=stemConfigs[st]?.controls?.volume
    if (display && cfg) display.textContent=`${v}${cfg.unit}`
  }

  const mKnob=document.querySelector(`[data-mix-knob][data-stem="${st}"]`)
  if (mKnob) {
    mKnob.dataset.value=String(v)
    const ptr=mKnob.querySelector('[data-mix-pointer]')
    if (ptr) ptr.style.transform=`translateX(-50%) rotate(${knobAngle(v)}deg)`
    const r=document.querySelector(`[data-mix-readout="${st}"]`)
    if (r) r.textContent=v
  }

  if (isPlaying && stemNodes[st]?.gain) {
    const vol=v/100
    const muted=stemMuteStates[st]
    const blocked=(soloedStem && soloedStem !== st)
    if (!muted && !blocked) {
      const p=stemNodes[st].gain.gain, t=audioContext.currentTime
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(vol, t + 0.01)
    }
  }
}

/* ---------- Master state helpers ---------- */
function getRootText(){
  const base=stemControlValues.master?.rootBase || 'A'
  const acc =stemControlValues.master?.accidental || 'natural'
  return acc==='sharp'?`${base}#` : acc==='flat'?`${base}b` : base
}
function getMasterForPrompt(){
  return {
    tempo: clampTempo(stemControlValues.master?.tempo ?? DEFAULT_TEMPO),
    bars:  stemControlValues.master?.bars ?? DEFAULT_BARS,
    root:  getRootText(),
    mode:  stemControlValues.master?.mode || 'Minor'
  }
}

/* ---------- Mixer (Docked tray) ---------- */
function volumeKnobHTML(st){
  const v=stemControlValues[st]?.volume ?? 80
  const label=stemConfigs[st]?.name || st
  const ang=knobAngle(v)
  const idx = STEM_ORDER.indexOf(st) + 1
  return `\n        <div class="sg-mix-card relative flex flex-col items-center justify-center rounded-xl border border-white/15 bg-white/10 p-2 aspect-square select-none"\n             data-mix-card="${st}">\n          <span data-mix-number="${st}" class="absolute left-1 top-1 flex items-center justify-center w-4 h-4 rounded-full border border-white/30 text-[10px] font-semibold">${idx}</span>\n          <div class="text-[10px] mb-1 text-white/85">${label}</div>\n          <div class="relative w-12 h-12 rounded-full border border-white/25 bg-white/10 shadow-inner cursor-[ns-resize]"\n               data-mix-knob data-stem="${st}" data-value="${v}" title="${label} Volume">\n            <div class="absolute inset-0 rounded-full" style="box-shadow: inset 0 2px 6px rgba(0,0,0,0.35), inset 0 -1px 2px rgba(255,255,255,0.05)"></div>\n            <div class="absolute w-0.5 h-4 bg-white/90 rounded pointer-events-none"\n                 data-mix-pointer style="left:50%; bottom:50%; transform: translateX(-50%) rotate(${ang}deg); transform-origin: bottom center;"></div>\n          </div>\n          <div class="mt-1 text-[10px] text-white/80"><span data-mix-readout="${st}">${v}</span>%</div>\n          <div class="mt-1 flex gap-1">\n            <button class="sg-toggle px-1.5 py-0.5 text-[10px] rounded border border-white/15 hover:bg-white/10"\n                    data-action="mix-mute" data-stem="${st}" aria-pressed="false">Mute</button>\n            <button class="sg-toggle px-1.5 py-0.5 text-[10px] rounded border border-white/15 hover:bg-white/10"\n                    data-action="mix-solo" data-stem="${st}" aria-pressed="false">Solo</button>\n          </div>\n        </div>\n      `
}
function buildFloatingMixerPanel(){
  const tray=document.getElementById('mixerTray')
  if (!tray) return
  let grid=tray.querySelector('#mixerGrid')
  if (!grid) {
    grid=document.createElement('div')
    grid.id='mixerGrid'
    grid.className='grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-9 gap-2'
    tray.querySelector('.mixer-inner')?.appendChild(grid)
  }
  grid.innerHTML = STEM_ORDER.map(st => volumeKnobHTML(st)).join('')
  STEM_ORDER.forEach(updateMixerGlow)
  STEM_ORDER.forEach(updateCardNumberColor)
}
function setMixerOpen(open){
  const tray=document.getElementById('mixerTray')
  if (!tray) return
  tray.style.maxHeight = open ? '56vh' : '0px'
  tray.dataset.open = open ? '1' : '0'
  // Update player toggle button label + ARIA
  const toggleBtn = document.getElementById('mixerToggleBtn')
  if (toggleBtn) {
    toggleBtn.textContent = open ? 'close mixer' : 'open mixer'
    toggleBtn.setAttribute('aria-pressed', open ? 'true' : 'false')
  }
}
function toggleMixerOpen(){
  const tray=document.getElementById('mixerTray')
  if (!tray) return
  const open = tray.dataset.open === '1'
  setMixerOpen(!open)
}

/* ---------- Hotkey helpers ---------- */
function toggleMute(st){
  stemMuteStates[st] = !stemMuteStates[st]
  const vol = (stemControlValues[st]?.volume ?? 80)/100
  const target = stemMuteStates[st] ? 0 : vol
  if (stemNodes[st]?.gain) {
    const p = stemNodes[st].gain.gain, t = audioContext.currentTime
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(target, t + 0.01)
  }
  const icon = document.querySelector(`[data-stem="${st}"] [data-action="mute-stem"] [data-lucide]`)
  if (icon) { icon.setAttribute('data-lucide', stemMuteStates[st] ? 'volume-x' : 'volume-2'); window.lucide?.createIcons() }
  reflectMuteSoloButtons(st); updateMixerGlow(st)
  updateCardNumberColor(st)
  updateMutedBorder(st)
}

/* ---------- Events ---------- */
// Removed: getTempoValueEl and updateTempoReadout are no longer needed because
// the app no longer exposes a master tempo slider or readout.

// new helper functions for card numbers and history indicators
function updateHistoryIndicator(st){
  ensureStemHistory(st)
  const count = stemHistory[st]?.length || 0
  const active = (stemActiveIndex[st] != null && stemActiveIndex[st] >= 0) ? (stemActiveIndex[st] + 1) : 0
  const countEl = document.querySelector(`[data-history-count="${st}"]`)
  const activeEl = document.querySelector(`[data-active-index="${st}"]`)
  if (countEl) countEl.textContent = String(count)
  if (activeEl) activeEl.textContent = active > 0 ? String(active) : '0'
  updateTempoIndicator(st)
}
// Update the tempo indicator on waveform card
function updateTempoIndicator(st) {
  const el = document.querySelector(`[data-tempo-indicator="${st}"]`)
  if (!el) return
  ensureStemHistory(st)
  const activeIdx = stemActiveIndex[st]
  let tempo = stemControlValues.master?.tempo ?? DEFAULT_TEMPO
  if (activeIdx != null && activeIdx >= 0 && stemHistory[st] && stemHistory[st][activeIdx]) {
    tempo = stemHistory[st][activeIdx].tempo
  }
  el.textContent = `tempo: ${tempo}`
}
function updateCardNumberColor(st){
  const nTakes = (stemHistory[st]?.length || 0)
  const muted = stemMuteStates[st]
  const color = (nTakes === 0 || muted) ? '#ef4444' : '#ffffff'
  const cardNumEl = document.querySelector(`[data-card-number="${st}"]`)
  if (cardNumEl) {
    cardNumEl.style.color = color
    cardNumEl.style.borderColor = color
  }
  const mixNumEl = document.querySelector(`[data-mix-number="${st}"]`)
  if (mixNumEl) {
    mixNumEl.style.color = color
    mixNumEl.style.borderColor = color
  }
}
function updateMutedBorder(st){
  const card = document.querySelector(`[data-stem="${st}"]`)
  if (card) {
    if (stemMuteStates[st]) card.classList.add('sg-muted-border')
    else card.classList.remove('sg-muted-border')
  }
  const mixCard=document.querySelector(`[data-mix-card="${st}"]`)
  if (mixCard) {
    if (stemMuteStates[st]) mixCard.classList.add('sg-muted-border')
    else mixCard.classList.remove('sg-muted-border')
  }
}

function setupEventListeners() {
  // Player Play/Pause
  const playBtn = document.getElementById('playBtn')
  if (playBtn) playBtn.addEventListener('click', async () => {
    await ensureAudioContext()
    if (isPlaying) stopTransport()
    else {
      // Do not rebuild loops when starting transport.  Each stem retains its own
      // loop duration and tempo.
      startTransport()
    }
  })

  // Mixer toggle inside player
  const mixerToggleBtn = document.getElementById('mixerToggleBtn')
  if (mixerToggleBtn) mixerToggleBtn.addEventListener('click', () => toggleMixerOpen())

  // (Space) toggle playback; (1–9) mute/unmute; ignore while editing
  document.addEventListener('keydown', async (e) => {
    const ae = document.activeElement
    const tag = (ae && ae.tagName) || ''
    const editing = (ae && (ae.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(tag)))
    if (editing) return

    // Space: toggle transport
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault()
      await ensureAudioContext()
      if (isPlaying) stopTransport()
      else {
        // Do not rebuild loops on playback toggle.  Use existing per‑stem loops.
        startTransport()
      }
      return
    }

    // Digits/Numpad 1..9 → mute/unmute mapped stems
    const code = e.code || ''
    let num = null
    if (code.startsWith('Digit')) num = Number(code.slice(5))
    else if (code.startsWith('Numpad')) {
      const d = code.slice(6)
      if (/^[1-9]$/.test(d)) num = Number(d)
    }
    if (num && num >= 1 && num <= 9) {
      const st = STEM_ORDER[num - 1]
      if (st) toggleMute(st)
    }
  })

  // Tempo slider: controls the generation tempo only.  Adjusting this value
  // does not affect the playback speed of already‑generated stems.
  const tempoSlider = document.getElementById('tempoSlider')
  const tempoValueEl = document.getElementById('tempoValue')
  if (tempoSlider) {
    // Initialize the slider with the current master tempo
    tempoSlider.value = stemControlValues.master.tempo || DEFAULT_TEMPO
    if (tempoValueEl) tempoValueEl.textContent = String(stemControlValues.master.tempo || DEFAULT_TEMPO)
    tempoSlider.addEventListener('input', e => {
      const value = clampTempo(e.target.value)
      e.target.value = value
      stemControlValues.master.tempo = value
      // Update readout
      if (tempoValueEl) tempoValueEl.textContent = String(value)
    })
  }

  // Bars
  const barsSelector = document.getElementById('barsSelector')
  if (barsSelector) {
    barsSelector.value = String(stemControlValues.master.bars)
    barsSelector.addEventListener('change', e => {
      stemControlValues.master.bars = parseInt(e.target.value, 10)
      STEM_ORDER.forEach(st => {
        const drawer = document.querySelector(`[data-history-drawer="${st}"]`)
        if (drawer?.classList.contains('open')) renderHistoryDrawer(st)
      })
    })
  }

  // Key: root + accidental + mode
  const rootSelector = document.getElementById('rootSelector')
  const modeSelector = document.getElementById('modeSelector')
  const accidentalSelector = document.getElementById('accidentalSelector')
  if (rootSelector) {
    const v = String(rootSelector.value || 'A')
    const m = v.match(/^[A-G]/i)
    if (m) stemControlValues.master.rootBase = m[0].toUpperCase()
    if (/#/i.test(v)) stemControlValues.master.accidental = 'sharp'
    else if (/b/i.test(v)) stemControlValues.master.accidental = 'flat'
    if (accidentalSelector) accidentalSelector.value = stemControlValues.master.accidental
    rootSelector.addEventListener('change', e => {
      const vv = String(e.target.value || 'A')
      const mm = vv.match(/^[A-G]/i)
      if (mm) stemControlValues.master.rootBase = mm[0].toUpperCase()
    })
  }
  if (accidentalSelector) accidentalSelector.addEventListener('change', e => { stemControlValues.master.accidental = e.target.value })
  if (modeSelector) { modeSelector.value = stemControlValues.master.mode; modeSelector.addEventListener('change', e => { stemControlValues.master.mode = e.target.value }) }

  // Hide "Format" selector if present
  const fmt = document.getElementById('outputFormatSelector')
  if (fmt && fmt.parentElement) fmt.parentElement.style.display = 'none'

  // Card inputs (live + gen)
  document.addEventListener('input', e => {
    if (e.target.dataset.stem && e.target.dataset.control) {
      const st = e.target.dataset.stem
      const key = e.target.dataset.control
      const val = e.target.type === 'checkbox' ? e.target.checked : parseInt(e.target.value, 10)
      stemControlValues[st][key] = val
      if (e.target.type === 'range') {
        const display = e.target.parentElement.querySelector('span:last-child')
        const cfg = stemConfigs[st]?.controls[key]
        if (display) display.textContent = `${val}${cfg?.unit || ''}`
      }
      if (key === 'volume') setVolumeUnified(st, val)
    }
  })

  // EQ knob gestures
  let activeEqKnob = null, startX = 0, startY = 0, startVal = 0
  function onEqMove(e){ if(!activeEqKnob) return; const dx=(e.clientX??0)-startX; const dy=startY-(e.clientY??0); const delta=dy+dx*0.35; const v=Math.max(0,Math.min(100,startVal+delta*0.5)); setEqValue(activeEqKnob.stem, activeEqKnob.band, v) }
  function onEqUp(){ activeEqKnob=null; window.removeEventListener('pointermove',onEqMove); window.removeEventListener('pointerup',onEqUp) }
  document.addEventListener('pointerdown', e => {
    const k = e.target.closest('[data-eq-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); const band = k.getAttribute('data-band'); const val=Number(k.getAttribute('data-value'))||EQ_DEFAULT
    if (e.shiftKey) { setEqValue(st, band, 0); return }
    activeEqKnob={stem:st, band}; startX=e.clientX??0; startY=e.clientY??0; startVal=val
    window.addEventListener('pointermove', onEqMove); window.addEventListener('pointerup', onEqUp)
  })
  document.addEventListener('dblclick', e => {
    const k = e.target.closest('[data-eq-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); const band = k.getAttribute('data-band'); setEqValue(st, band, EQ_DEFAULT)
  })

  // Filter knob gestures
  let activeFilterKnob = null, fStartVal = 0
  function onFilterMove(e){ if(!activeFilterKnob) return; const dx=(e.clientX??0)-startX; const dy=startY-(e.clientY??0); const delta=dy+dx*0.35; const v=Math.max(0,Math.min(100,fStartVal+delta*0.5)); setFilterCutoff(activeFilterKnob.stem, v) }
  function onFilterUp(){ activeFilterKnob=null; window.removeEventListener('pointermove',onFilterMove); window.removeEventListener('pointerup',onFilterUp) }
  document.addEventListener('pointerdown', e => {
    const k = e.target.closest('[data-filter-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); const val=Number(k.getAttribute('data-value'))||freqToKnob(FILTER_DEFAULT_HZ)
    if (e.shiftKey) { setFilterCutoff(st, freqToKnob(FILTER_DEFAULT_HZ)); return }
    activeFilterKnob={stem:st}; startX=e.clientX??0; startY=e.clientY??0; fStartVal=val
    window.addEventListener('pointermove', onFilterMove); window.addEventListener('pointerup', onFilterUp)
  })
  document.addEventListener('dblclick', e => {
    const k = e.target.closest('[data-filter-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); setFilterCutoff(st, freqToKnob(FILTER_DEFAULT_HZ))
  })

  // Mixer knobs
  let activeMixKnob = null, mStartVal = 0
  function onMixMove(e){ if(!activeMixKnob) return; const dx=(e.clientX??0)-startX; const dy=startY-(e.clientY??0); const delta=dy+dx*0.35; const v=Math.max(0,Math.min(100,mStartVal+delta*0.5)); setVolumeUnified(activeMixKnob.stem, v) }
  function onMixUp(){ activeMixKnob=null; window.removeEventListener('pointermove',onMixMove); window.removeEventListener('pointerup',onMixUp) }
  document.addEventListener('pointerdown', e => {
    const k = e.target.closest('[data-mix-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); const val=Number(k.getAttribute('data-value')) || (stemControlValues[st]?.volume ?? 80)
    if (e.shiftKey) { setVolumeUnified(st, 0); return }
    activeMixKnob={stem:st}; startX=e.clientX??0; startY=e.clientY??0; mStartVal=val
    window.addEventListener('pointermove', onMixMove); window.addEventListener('pointerup', onMixUp)
  })
  document.addEventListener('dblclick', e => {
    const k = e.target.closest('[data-mix-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); setVolumeUnified(st, stemConfigs[st]?.controls?.volume?.default ?? 80)
  })

  // Click actions (Generate / Download / Filter mode / options overlay / history / waveform navigation)
  document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]')
    if (btn) {
      const action = btn.dataset.action
      const st = btn.dataset.stem
      if (action === 'generate' && st) { await generateStem(st); return }
      if (action === 'download-stem' && st) { downloadStem(st); return }
      if (action === 'toggle-filter-mode' && st) { toggleFilterMode(st); return }
      // Open the takes browser via the "open" button
      if (action === 'open-takes' && st) { toggleHistoryDrawer(st, null); return }
      // Cycle to previous take; wraps around
      if (action === 'prev-take' && st) {
        ensureStemHistory(st)
        const takes = stemHistory[st] || []
        if (takes.length > 0) {
          const current = stemActiveIndex[st] ?? -1
          // move left: if nothing selected, select last; else decrement and wrap
          let nextIdx = (current <= 0) ? (takes.length - 1) : (current - 1)
          selectStemVersion(st, nextIdx)
        }
        return
      }
      // Cycle to next take; wraps around
      if (action === 'next-take' && st) {
        ensureStemHistory(st)
        const takes = stemHistory[st] || []
        if (takes.length > 0) {
          const current = stemActiveIndex[st] ?? -1
          // move right: if nothing selected, select first; else increment and wrap
          let nextIdx = (current >= takes.length - 1 || current < 0) ? 0 : (current + 1)
          selectStemVersion(st, nextIdx)
        }
        return
      }
      if (action === 'toggle-stem-options' && st) {
        const panel = document.querySelector(`[data-options-panel="${st}"]`)
        const open = !(panel?.classList.contains('hidden') === false)
        if (panel) panel.classList.toggle('hidden', !open)
        btn.setAttribute('aria-pressed', open ? 'true' : 'false')
        return
      }
      if (action === 'close-history' && st) { toggleHistoryDrawer(st, false); return }
      if (action === 'mix-mute' || action === 'mute-stem') { toggleMute(st); return }
      if (action === 'mix-solo' || action === 'solo-stem') {
        const already = soloedStem === st
        soloedStem = already ? null : st
        STEM_ORDER.forEach(name => {
          const n = stemNodes[name]; if (!n?.gain) return
          const vol = (stemControlValues[name]?.volume ?? 80)/100
          const target = (soloedStem && name !== soloedStem) ? 0 : (stemMuteStates[name] ? 0 : vol)
          const p = n.gain.gain, t = audioContext.currentTime
          p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(target, t + 0.01)
          reflectMuteSoloButtons(name); updateMixerGlow(name)
        })
        return
      }
      // New actions: open-takes, prev-take, next-take
      if (action === 'open-takes' && st) {
        toggleHistoryDrawer(st, true)
        return
      }
      if (action === 'prev-take' && st) {
        ensureStemHistory(st)
        const list = stemHistory[st]
        if (list && list.length > 0) {
          const cur = stemActiveIndex[st]
          const count = list.length
          const newIndex = cur <= 0 ? count - 1 : cur - 1
          selectStemVersion(st, newIndex)
          updateHistoryIndicator(st)
          updateCardNumberColor(st)
        }
        return
      }
      if (action === 'next-take' && st) {
        ensureStemHistory(st)
        const list = stemHistory[st]
        if (list && list.length > 0) {
          const cur = stemActiveIndex[st]
          const count = list.length
          const newIndex = cur < count - 1 ? cur + 1 : 0
          selectStemVersion(st, newIndex)
          updateHistoryIndicator(st)
          updateCardNumberColor(st)
        }
        return
      }
    } else {
      const cw = e.target.closest('.waveform-canvas'); 
      if (cw?.dataset.stem) { toggleHistoryDrawer(cw.dataset.stem, null); return }
      const takeBtn = e.target.closest('[data-take-index]'); 
      if (takeBtn) {
        const st = takeBtn.getAttribute('data-stem'); const idx = parseInt(takeBtn.getAttribute('data-take-index'),10)
        selectStemVersion(st, idx); updateMixerGlow(st); return
      }
    }
  })

  // Takes tray wheel→horizontal
  document.addEventListener('wheel', (e) => {
    const list = e.target.closest('[data-history-list]')
    if (!list) return
    const absY = Math.abs(e.deltaY), absX = Math.abs(e.deltaX)
    if (absY >= absX) { list.scrollLeft += e.deltaY; e.preventDefault() }
  }, { passive: false })
}

/* ---------- EQ/Filter setters ---------- */
function setEqValue(st, band, newVal){
  const v=Math.max(0, Math.min(100, Math.round(newVal)))
  stemEqValues[st] = { ...(stemEqValues[st] || {}), [band]: v }
  const knob=document.querySelector(`[data-eq-knob][data-stem="${st}"][data-band="${band}"]`)
  if (knob) updateEqKnobVisual(knob, v)
  updateEqReadout(st, band)
  const eq=stemNodes[st]?.eq
  if (eq) applyEqValuesToNodes(eq, stemEqValues[st])
}
function setFilterCutoff(st, newVal){
  const v=Math.max(0, Math.min(100, Math.round(newVal)))
  stemFilterValues[st] = { ...(stemFilterValues[st] || {}), cutoff: v }
  const knob=document.querySelector(`[data-filter-knob][data-stem="${st}"]`)
  if (knob) updateFilterKnobVisual(knob, v)
  updateFilterReadout(st)
  const filter=stemNodes[st]?.filter
  if (filter) applyFilterValuesToNode(filter, stemFilterValues[st])
}
function toggleFilterMode(st){
  const current=(stemFilterValues[st]||{}).mode || 'lowpass'
  const next=current==='lowpass' ? 'highpass' : 'lowpass'
  stemFilterValues[st] = { ...(stemFilterValues[st] || {}), mode: next }
  updateFilterModeButton(st)
  const filter=stemNodes[st]?.filter
  if (filter) applyFilterValuesToNode(filter, stemFilterValues[st])
}

/* =========================================================
   History UI
   ========================================================= */
function updateHistoryBadge(st){
  const badgeEls=document.querySelectorAll(`[data-history-count="${st}"]`)
  const n=stemHistory[st]?.length || 0
  badgeEls.forEach(badge => { badge.textContent=n; badge.style.opacity = n > 0 ? '1' : '0.4' })
  updateHistoryIndicator(st)
  updateCardNumberColor(st)
}
function toggleHistoryDrawer(st, forceOpen=null){
  const drawer=document.querySelector(`[data-history-drawer="${st}"]`); if (!drawer) return
  const isOpen=drawer.classList.contains('open')
  const open=forceOpen===null ? !isOpen : !!forceOpen
  drawer.classList.toggle('open', open)
  drawer.style.maxHeight = open ? '160px' : '0px'
  if (open) renderHistoryDrawer(st)
}
function renderHistoryDrawer(st){
  const list=document.querySelector(`[data-history-list="${st}"]`); if (!list) return
  ensureStemHistory(st)
  list.innerHTML=''
  const takes=stemHistory[st]
  if (!takes.length) { list.innerHTML = `<div class="text-xs text-white/60 px-2 py-6">No takes yet. Generate some!</div>`; return }
  const active=stemActiveIndex[st]
  takes.forEach((take, i) => {
    const item=document.createElement('button')
    item.className=`relative shrink-0 w-28 h-16 rounded-md border ${i===active?'border-purple-400 shadow-[0_0_0_2px_rgba(168,85,247,0.35)]':'border-white/10 hover:border-white/30'} bg-white/5 focus:outline-none focus:ring-2 focus:ring-purple-500/30`
    item.setAttribute('data-take-index', i)
    item.setAttribute('data-stem', st)
    item.title=`v${i+1} • ${take.tempo} BPM • ${take.bars} bars`

    const c=document.createElement('canvas'); c.width=112; c.height=64; c.className='w-full h-full rounded-md'
    item.appendChild(c)

    const meta=document.createElement('div')
    meta.className='absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[10px] leading-none bg-black/50 text-white/90 truncate'
    meta.textContent=`v${i+1} • ${take.tempo} • ${take.bars}b`
    item.appendChild(meta)

    list.appendChild(item)

    // Draw a preview of the raw take without trimming or stretching.  This
    // avoids squeezing the waveform when the generation tempo differs from
    // the current master tempo.
    drawTinyWaveform(c, take.raw)
  })
}
function selectStemVersion(st, index){
  ensureStemHistory(st)
  const takes=stemHistory[st]; if (!takes || index<0 || index>=takes.length) return
  stemActiveIndex[st]=index
  const take=takes[index]
  // Use the stored tempo and bar count from the take itself to build a
  // loop that matches the original generation.  Do not reference the current
  // master tempo, as each stem may have been generated at a different BPM.
  const tempo  = take.tempo
  const bars   = take.bars
  stemRaw[st]  = take.raw
  // Loop directly from the raw audio; do not rebuild loop based on tempo
  stemLoop[st] = take.raw
  // Record the loop duration for this stem
  stemLoopDuration[st] = take.raw.duration
  const canvas=document.querySelector(`[data-stem="${st}"] .waveform-canvas`)
  if (canvas) {
    const cfg=stemConfigs[st]; drawWaveform(canvas, stemLoop[st], `rgb(${getColorRGB(cfg.color)})`)
  }
  const statusEl=document.querySelector(`[data-stem="${st}"] .status-line`)
  if (statusEl) statusEl.textContent=`Selected v${index+1} (${tempo} BPM • ${bars} bars)`
  renderHistoryDrawer(st)
  if (isPlaying) restartStemNextBoundary(st)
  updateHistoryIndicator(st)
  updateCardNumberColor(st)
  updateTempoIndicator(st)
}

/* =========================================================
   App init + navigation
   ========================================================= */
function showPage(pageId){
  const pages=['login-page', 'selection-page', 'techno-generator-page']
  pages.forEach(id => { const page=document.getElementById(id); if (page) page.classList.add('hidden') })
  const targetPage=document.getElementById(pageId); if (targetPage) targetPage.classList.remove('hidden')

  // Show bottom player only on Studio page
  const playerBar=document.getElementById('playerBar')
  const showDock = pageId === 'techno-generator-page'
  if (playerBar) playerBar.classList.toggle('hidden', !showDock)
  if (!showDock) setMixerOpen(false)
}
function setupNavigationListeners(){
  const loginBtn = document.getElementById('loginBtn')
  if (loginBtn) loginBtn.addEventListener('click', () => { showPage('selection-page') })
  const launchTechno = document.getElementById('launchTechno')
  if (launchTechno) launchTechno.addEventListener('click', () => { showPage('techno-generator-page'); initTechnoGenerator() })
  const launchHipHop = document.getElementById('launchHipHop'); if (launchHipHop) launchHipHop?.addEventListener('click', () => {})
  const launchHouse = document.getElementById('launchHouse'); if (launchHouse) launchHouse?.addEventListener('click', () => {})
}
function initTechnoGenerator(){
  console.log('🎛️ Initializing Techno Generator…')
  injectGlobalStyles()
  initializeStemControlValues()

  // Build cards
  const container = document.getElementById('stem-container')
  if (container && PROMPTS_MODE === 'builder') {
    container.innerHTML = ''
    STEM_ORDER.forEach(st => container.appendChild(createBuilderStemCard(st, stemConfigs[st])))
  }

  setupEventListeners()
  window.lucide?.createIcons()

  // Build docked mixer
  buildFloatingMixerPanel()
  setMixerOpen(false) // hidden by default

  if (typeof window !== 'undefined') {
    window.debugAudio = {
      getRaw: () => stemRaw,
      getLoop: () => stemLoop,
      getRefHead: () => referenceHeadIndex,
      getHistory: () => stemHistory,
      select: selectStemVersion,
      getEqValues: () => stemEqValues,
      getFilterValues: () => stemFilterValues
    }
  }
  // Initialise card numbers and indicators
  STEM_ORDER.forEach(st => {
    updateHistoryIndicator(st)
    updateCardNumberColor(st)
    updateMutedBorder(st)
    updateTempoIndicator(st)
  })
  console.log('✅ App ready (session ' + SESSION_TAG + ')')
}

export async function initApp(){
  console.log('🎬 Initializing App Navigation System…')
  setupNavigationListeners()
  showPage('login-page')
  window.lucide?.createIcons()
  setupHelpModal()
  console.log('✅ Navigation system ready')
}

/* =========================================================
   Global styles
   ========================================================= */
function injectGlobalStyles(){
  if (document.getElementById('sg-global-styles')) return
  const style=document.createElement('style')
  style.id='sg-global-styles'
  style.textContent=
    `@keyframes soft-pulse-glow {\n      0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.28), 0 0 16px rgba(255,255,255,0.12); transform: translateY(0) scale(1); }\n      50%      { box-shadow: 0 0 0 12px rgba(255,255,255,0), 0 0 22px rgba(255,255,255,0.22); transform: translateY(-0.5px) scale(1.012); }\n    }\n    #playBtn { animation: soft-pulse-glow 2.6s ease-in-out infinite; transition: transform 160ms ease, box-shadow 160ms ease; will-change: transform, box-shadow; }\n    #playBtn:hover { transform: translateY(-1px) scale(1.02); }\n    #playBtn:active { transform: translateY(0); }\n    .sg-mix-card.sg-glow { animation: soft-pulse-glow 2.6s ease-in-out infinite; }\n    .sg-toggle-active { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.35); }`;
  document.head.appendChild(style)
}

/* =========================================================
   Help Modal setup
   ========================================================= */
function setupHelpModal(){
  const helpBtn = document.getElementById('helpBtn')
  const helpModal = document.getElementById('helpModal')
  const overlay = document.getElementById('helpModalOverlay')
  const closeBtn = document.getElementById('helpModalCloseBtn')
  if (!helpModal) return
  function openModal(){
    helpModal.classList.remove('hidden')
    requestAnimationFrame(() => {
      helpModal.style.opacity = '1'
    })
  }
  function closeModal(){
    helpModal.style.opacity = '0'
    setTimeout(() => {
      helpModal.classList.add('hidden')
    }, 300)
  }
  if (helpBtn) helpBtn.addEventListener('click', openModal)
  if (overlay) overlay.addEventListener('click', closeModal)
  if (closeBtn) closeBtn.addEventListener('click', closeModal)
}