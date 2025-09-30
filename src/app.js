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
// Increase ramp and crossfade durations to minimise audible clicks at loop
// boundaries.  A longer fade-in/out and crossfade smooths the transition
// when the loop restarts, reducing the chance of hearing a click.
const EDGE_RAMP_MS   = 8
const LOOP_XFADE_MS  = 24
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

// When a stem is soloed, store its previous mute state here so it can be restored
// when the solo is released.  Keys are stem IDs; values are booleans indicating
// whether the stem was muted prior to soloing.  Only the current soloed stem
// will have an entry in this object.
const prevSoloMuteStates = {}

const stemEqValues = {}
const stemFilterValues = {}

// Per‑stem UI state for waveform editing.  When true for a given stem, the
// take navigation arrows on that waveform are hidden and the horizontal
// dial overlay for adjusting volume and the endpoint is shown.  Use
// toggleWaveformControls() to change this state.
const waveformEditingState = {}

// Endpoint stretch factors per stem.  A factor of 1.0 means the loop
// plays at its original rate.  Values below 1.0 compress the sound
// (it finishes sooner within the loop), while values above 1.0 stretch
// it (the sound plays back slower) without changing the loop duration.
const endpointFactors = {}

// State for the waveform edit popup.  When a waveform is tapped, we open
// a modal with its own controls for volume and endpoint.  We store
// the stem being edited along with its previous volume and endpoint
// factor so we can revert if the user discards changes.  When the
// modal is closed, isOpen becomes false and stem resets to null.
const waveformEditState = {
  isOpen: false,
  stem: null,
  prevVolume: 0,
  prevEndpointFactor: 1
}

let loopStartTime  = 0
let loopDuration   = 0
let transportTicker = null

let referenceStemType = null
let referenceHeadIndex = 0 // samples at decoded SR
// Tooltip element for mixer sliders; created during init.  Shows dB or Hz values while adjusting sliders.
let sliderTooltipEl = null

// Track which stem's settings are being edited in the generate settings modal
let currentGenerateStem = null

// Flag indicating whether the session master settings (tempo, bars, key)
// have been selected. Once this flag is true, the session settings are
// locked for the remainder of the session and the setup modal will not be shown again.
let sessionSetupDone = false

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
// Expanded stem configuration.  Each instrument now exposes five
// parametric sliders (knobs) that map to musical descriptors such as
// attack, body, tone and pattern, plus two toggles for auxiliary
// processing (e.g. distortion, reverb).  Volume remains a
// non‑generative control and is therefore excluded from the count of
// five sliders.  These descriptors draw upon common envelope and
// timbre terminology suggested in ElevenLabs prompting guidelines and
// the sound‑effect prompt cheatsheet【250912434198074†L742-L756】.
const stemConfigs = {
  kick: {
    name: 'Kick',
    color: 'red',
    basePrompt: 'deep techno kick drum',
    controls: {
      punch:   { type: 'knob', min: 0, max: 100, default: 70, unit: '%', label: 'Punch' },
      attack:  { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Attack' },
      decay:   { type: 'knob', min: 0, max: 100, default: 40, unit: '%', label: 'Decay' },
      body:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Body' },
      tone:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Tone' },
      distortion: { type: 'toggle', default: false, label: 'Distortion' },
      rumble:     { type: 'toggle', default: false, label: 'Rumble' },
      volume:  { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  perc: {
    name: 'Snare',
    color: 'cyan',
    basePrompt: 'industrial techno snare',
    controls: {
      intensity: { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Intensity' },
      variation: { type: 'knob', min: 0, max: 100, default: 40, unit: '%', label: 'Variation' },
      snap:     { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Snap' },
      decay:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Decay' },
      tone:     { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Tone' },
      metallic: { type: 'toggle', default: false, label: 'Metallic' },
      reverb:   { type: 'toggle', default: false, label: 'Reverb' },
      volume:   { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  bass: {
    name: 'Bass',
    color: 'yellow',
    basePrompt: 'dark techno bassline',
    controls: {
      depth:     { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Depth' },
      movement:  { type: 'knob', min: 0, max: 100, default: 30, unit: '%', label: 'Movement' },
      attack:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Attack' },
      tone:      { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Tone' },
      sub:       { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Sub' },
      filter:    { type: 'toggle', default: true, label: 'Filter Sweep' },
      distortion:{ type: 'toggle', default: false, label: 'Distortion' },
      volume:    { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  lead: {
    name: 'Lead',
    color: 'green',
    basePrompt: 'hypnotic techno lead synth',
    controls: {
      brightness:{ type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Brightness' },
      complexity:{ type: 'knob', min: 0, max: 100, default: 40, unit: '%', label: 'Complexity' },
      motion:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Motion' },
      attack:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Attack' },
      range:     { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Range' },
      delay:     { type: 'toggle', default: false, label: 'Delay' },
      chorus:    { type: 'toggle', default: false, label: 'Chorus' },
      volume:    { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  hihat: {
    name: 'Hihat',
    color: 'orange',
    basePrompt: 'crisp techno closed hi-hat',
    controls: {
      brightness: { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Brightness' },
      pattern:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Pattern' },
      decay:      { type: 'knob', min: 0, max: 100, default: 40, unit: '%', label: 'Decay' },
      texture:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Texture' },
      shuffle:    { type: 'knob', min: 0, max: 100, default: 40, unit: '%', label: 'Shuffle' },
      reverb:     { type: 'toggle', default: false, label: 'Reverb' },
      chorus:     { type: 'toggle', default: false, label: 'Chorus' },
      volume:     { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  pad: {
    name: 'Pad',
    color: 'purple',
    basePrompt: 'ambient techno pad',
    controls: {
      warmth:    { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Warmth' },
      evolution: { type: 'knob', min: 0, max: 100, default: 30, unit: '%', label: 'Evolution' },
      brightness:{ type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Brightness' },
      motion:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Motion' },
      texture:   { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Texture' },
      chorus:    { type: 'toggle', default: true, label: 'Chorus' },
      reverb:    { type: 'toggle', default: false, label: 'Reverb' },
      volume:    { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  arp: {
    name: 'Arp',
    color: 'blue',
    basePrompt: 'techno synthesizer arpeggio',
    controls: {
      rate:      { type: 'knob', min: 0, max: 100, default: 55, unit: '%', label: 'Rate' },
      complexity:{ type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Complexity' },
      range:     { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Range' },
      swing:     { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Swing' },
      tone:      { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Tone' },
      gate:      { type: 'toggle', default: false, label: 'Long Gate' },
      delay:     { type: 'toggle', default: false, label: 'Delay' },
      volume:    { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  fx: {
    name: 'FX',
    color: 'pink',
    basePrompt: 'techno transition effects and atmos',
    controls: {
      intensity: { type: 'knob', min: 0, max: 100, default: 65, unit: '%', label: 'Intensity' },
      movement:  { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Movement' },
      texture:   { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Texture' },
      sweep:     { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Sweep' },
      filter:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Filter' },
      reverb:    { type: 'toggle', default: true, label: 'Reverb' },
      delay:     { type: 'toggle', default: false, label: 'Delay' },
      volume:    { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  perc2: {
    name: 'Perc',
    color: 'orange',
    basePrompt: 'techno top percussion loop',
    controls: {
      density:     { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Density' },
      groove:      { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Groove' },
      variation:   { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Variation' },
      tone:        { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Tone' },
      syncopation:{ type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Syncopation' },
      metallic:    { type: 'toggle', default: false, label: 'Metallic' },
      reverb:      { type: 'toggle', default: false, label: 'Reverb' },
      volume:      { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
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
  const patternDesc = scaleKnob(controls.pattern, 'straight 1/16 notes', 'slight 1/16 shuffle', 'moderate syncopation', 'complex syncopation', 'polyrhythmic accents')
  const lengthDesc = scaleKnob(controls.decay, '30–80ms', '60–120ms', '100–180ms', '150–250ms', '250–400ms')
  const textureDesc = scaleKnob(controls.texture, 'soft', 'dry', 'balanced', 'crisp', 'metallic')
  const swingDesc = scaleKnob(controls.shuffle, 'straight', 'light shuffle', 'moderate shuffle', 'noticeable shuffle', 'heavy shuffle')
  const space = controls.reverb ? 'Space: tiny room; decay < 120 ms; gate tails before seam.' : 'Space: dry/minimal.'
  const chorus = controls.chorus ? 'Chorus: subtle shimmer; avoid smear across seam.' : 'Chorus: off.'
  const common = [
    'STEM: HIHAT — solo closed hi‑hat only.',
    'Identity: crisp techno closed hi‑hat.',
    g,
    'ROLE: isolated closed hat (no open‑hat).',
    `Pattern: ${patternDesc}; first hit exactly at bar 1 beat 1; consistent every bar.`,
    `Length: ${lengthDesc}.`,
    `Tone: ${brightness}; Texture: ${textureDesc}.`,
    `Swing: ${swingDesc}.`,
    space,
    chorus,
    'Exclude: ride, shaker, clap, snare, kick, toms, crashes; no melodic content, sweeps, or FX.',
    'Deliver a bar‑perfect seamless loop aligned to bar boundaries.'
  ]
  if (strictness === 1) common.push('ABSOLUTE: Only closed‑hat hits on a straight 1/16 grid; zero swing.')
  else if (strictness >= 2) common.push(
    'MUST: closed‑hat hits on each 1/16 step (16 hits/bar).',
    'MUST: zero reverb tail at seam; gate hits before bar end.',
    'MUST: exclude open hat, ride, shaker, snare, clap, toms, crashes.'
  )
  return common.join(' ')
}
function buildSnarePrompt(controls, master, strictness=0){ /* ... same as before ... */ 
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const varTxt     = scaleKnob(controls.variation, 'no variation', 'very subtle variation', 'subtle variation', 'light variation', 'moderate variation')
  const intensity  = scaleKnob(controls.intensity, 'low', 'moderate', 'medium', 'strong', 'very strong')
  const snap       = scaleKnob(controls.snap, 'soft', 'medium‑soft', 'balanced', 'sharp', 'cracking')
  const tail       = scaleKnob(controls.decay, 'very short', 'short', 'medium', 'long', 'very long')
  const toneDesc   = scaleKnob(controls.tone, 'thin', 'dry', 'balanced', 'full', 'deep')
  const timbreTxt  = controls.metallic ? 'Timbre: slightly metallic; tight transient.' : 'Timbre: organic and dry.'
  const space      = controls.reverb ? 'Space: tiny room; decay < 150 ms; gate tails before seam.' : 'Space: dry; short decay; no tail.'
  const common = [
    'STEM: SNARE — solo snare only.',
    'Identity: industrial techno snare; drum‑machine style; no clap.',
    g,
    'ROLE: isolated electronic snare.',
    'Pattern: hits exactly on beats 2 and 4 of every bar (no ghost notes or rolls).',
    `Dynamics: ${intensity}; Snap: ${snap}; Tail: ${tail}.`,
    `Tone: ${toneDesc}. ${timbreTxt}`,
    `Variation: ${varTxt} but positions remain 2 & 4.`,
    space,
    'Exclude: clap/rim/kick/hat/shakers/toms/crashes; unpitched; no tails at seam.',
    'Deliver a bar‑perfect seamless loop aligned to bar boundaries.'
  ]
  if (strictness === 1) common.push('ABSOLUTE: only beat 2 and beat 4 per bar; no extra hits.', 'ABSOLUTE: no off‑grid timing.')
  else if (strictness >= 2) common.push('MUST: exactly one snare on beat 2 and one on beat 4 per bar, nothing else.', 'MUST: gate decay fully before the seam; exclude clap/rim layers.')
  return common.join(' ')
}
function mapArpRate(v){ const x=Number(v??55); return x<=33?'1/8 notes': x<=66?'1/16 notes':'1/32 notes' }
function buildArpPrompt(controls, master){ /* ... same as before ... */ 
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const rate       = mapArpRate(controls.rate)
  const complexity = scaleKnob(controls.complexity, 'simple', 'moderate', 'interesting', 'intricate', 'ornate')
  const rangeDesc  = scaleKnob(controls.range, 'narrow', 'one octave', 'two octaves', 'three octaves', 'wide')
  const swingDesc  = scaleKnob(controls.swing, 'straight', 'slight swing', 'moderate swing', 'pronounced swing', 'syncopated')
  const toneDesc   = scaleKnob(controls.tone, 'dark', 'warm', 'balanced', 'bright', 'sparkling')
  const gate       = controls.gate ? 'long‑ish gate (80–160 ms)' : 'short gate (30–80 ms)'
  const delay      = controls.delay ? 'Delay: subtle tempo‑synced echoes; cut at bar end.' : 'Delay: off.'
  return [
    'STEM: ARPEGGIATOR — solo synth arpeggio only.',
    `Identity: ${stemConfigs.arp.basePrompt}.`,
    g,
    `ROLE: isolated arp; strictly diatonic in ${root} ${mode}; no chords.`,
    `Pattern: ${rate}; ${swingDesc}; fully quantized; phrase length must evenly divide ${bars} bars.`,
    `Complexity: ${complexity}; consistent motif and octave moves.`,
    `Range: ${rangeDesc}; Tone: ${toneDesc}.`,
    `Envelope: ${gate}.`,
    delay,
    'Exclude: drums/percussion/bass/pads/leads/vocals.',
    'Deliver a bar‑perfect seamless loop aligned to bar boundaries.'
  ].join(' ')
}
function buildFXPrompt(controls, master){ /* ... same as before ... */ 
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const intensity   = scaleKnob(controls.intensity, 'subtle', 'moderate', 'medium', 'strong', 'intense')
  const movement    = scaleKnob(controls.movement, 'static', 'gentle motion', 'evolving', 'animated', 'dynamic')
  const textureDesc = scaleKnob(controls.texture, 'smooth', 'grainy', 'noisy', 'metallic', 'chaotic')
  const sweepDesc   = scaleKnob(controls.sweep, 'short sweep', 'moderate sweep', 'long sweep', 'full‑bar sweep', 'multi‑bar sweep')
  const filterDesc  = scaleKnob(controls.filter, 'low emphasis', 'mid emphasis', 'balanced', 'high emphasis', 'resonant high‑pass')
  const space       = controls.reverb ? 'Space: tiny room; decay ≤ 150 ms; gate before bar end.' : 'Space: dry/minimal; gate before bar end.'
  const delayTxt    = controls.delay ? 'Delay: subtle echo; decay under bar.' : 'Delay: off.'
  return [
    'STEM: FX — solo techno transition effects & atmos only.',
    `Identity: ${stemConfigs.fx.basePrompt}.`,
    g,
    'ROLE: bar‑internal whooshes/sweeps/noise beds that RESET each bar.',
    `Intensity: ${intensity}. Movement: ${movement}. Texture: ${textureDesc}. Sweep: ${sweepDesc}. Filter: ${filterDesc}.`,
    space,
    delayTxt,
    'Exclude: pitched melodies/drums/percussion; avoid risers/falls that exceed a single bar.',
    'Deliver a bar‑perfect seamless loop; zero tail beyond the bar.'
  ].join(' ')
}
function buildPercLoopPrompt(controls, master){ /* ... same as before ... */ 
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const density     = scaleKnob(controls.density, 'sparse', 'light', 'medium', 'busy', 'dense')
  const groove      = scaleKnob(controls.groove, 'straight', 'straight with mild syncopation', 'syncopated but quantized', 'complex yet quantized', 'complex yet quantized')
  const variation   = scaleKnob(controls.variation, 'repetitive', 'subtle', 'moderate', 'intricate', 'wild')
  const toneDesc    = scaleKnob(controls.tone, 'dark', 'warm', 'balanced', 'bright', 'metallic')
  const syncDesc    = scaleKnob(controls.syncopation, 'straight', 'mild', 'groovy', 'complex', 'polyrhythmic')
  const metallic    = controls.metallic ? 'slightly metallic timbre allowed' : 'organic timbre preferred'
  const space       = controls.reverb ? 'Space: tiny room; gate before seam.' : 'Space: dry; no reverb.'
  return [
    'STEM: PERCUSSION — solo top percussion only (shakers/blocks/taps); not snare/hat/kick.',
    `Identity: ${stemConfigs.perc2.basePrompt}.`,
    g,
    `ROLE: quantized on‑grid accents; ${groove}; zero swing.`,
    `Density: ${density}; keep consistent across bars.`,
    `Variation: ${variation}.`,
    `Tone: ${toneDesc}.`,
    `Syncopation: ${syncDesc}.`,
    `Timbre: ${metallic}; short releases; zero tails at seam.`,
    space,
    'Exclude: tonal hits/kick/snare/clap/hat/ride/toms/crashes.',
    'Deliver a bar‑perfect seamless loop aligned to bar boundaries.'
  ].join(' ')
}
function roleDirectives(st, c){ /* ... same as before ... */ 
  switch (st) {
    case 'kick': return [
      'ROLE: single isolated kick only',
      'Pattern: four-on-the-floor; hits on beats 1–4 every bar',
      'Pitch: unpitched; no tonal sub note; no toms',
      // Envelope and tone descriptors
      `Attack: ${scaleKnob(c.attack, 'slow','soft','balanced','sharp','instant')}`,
      `Decay: ${scaleKnob(c.decay, 'very short','short','medium','long','very long')}`,
      `Punch: ${scaleKnob(c.punch, 'soft','firm','punchy','very punchy','aggressive')}`,
      `Body: ${scaleKnob(c.body, 'thin','firm','full','thick','boomy')}`,
      `Tone: ${scaleKnob(c.tone, 'dark','warm','balanced','bright','very bright')}`,
      // Toggle descriptors
      c.distortion ? 'Distortion: moderate saturation; no excessive clipping' : 'Distortion: none; clean transient',
      c.rumble ? 'Rumble: deep sub tail under 50 Hz; subtle' : 'Rumble: none',
      'Exclude: fills/intro flam/crashes'
    ].join('. ')
    case 'bass': return [
      'ROLE: single isolated bass only',
      'Harmony: strictly diatonic in project key (no chromatic notes)',
      'Pitch: root + fifth primarily; occasional octave',
      `Movement: ${scaleKnob(c.movement, 'static','simple','groovy','animated','busy')} repeating per bar`,
      `Depth: ${scaleKnob(c.depth, 'light','medium','deep','deeper','subby')} low‑end; controlled release`,
      `Attack: ${scaleKnob(c.attack, 'soft','moderate','distinct','sharp','percussive')}`,
      `Tone: ${scaleKnob(c.tone, 'dark','warm','balanced','bright','acidic')}`,
      `Sub: ${scaleKnob(c.sub, 'minimal','moderate','full','deep','subsonic')} content`,
      c.filter ? 'Filter: subtle motion within bar; reset each bar' : 'Filter: stable',
      c.distortion ? 'Distortion: mild analog saturation; no heavy clipping' : 'Distortion: none',
      'Start note on beat 1; no slides across seam'
    ].join('. ')
    case 'lead': return [
      'ROLE: single isolated lead synth only',
      'Melody: strictly diatonic; avoid chromatic passing tones',
      `Phrase length evenly divides ${Math.max(1, stemControlValues?.master?.bars || DEFAULT_BARS)} bar(s)`,
      `Complexity: ${scaleKnob(c.complexity, 'simple','moderate','interesting','intricate','ornate')} (quantized)`,
      `Brightness: ${scaleKnob(c.brightness, 'dark','mellow','balanced','bright','very bright')}`,
      `Motion: ${scaleKnob(c.motion, 'static','gentle','flowing','evolving','chaotic')}`,
      `Attack: ${scaleKnob(c.attack, 'soft','moderate','plucky','sharp','percussive')}`,
      `Range: ${scaleKnob(c.range, 'narrow','one octave','two octaves','three octaves','wide')}`,
      c.delay ? 'Delay: minimal tempo‑synced; cut at bar end' : 'Delay: off',
      c.chorus ? 'Chorus: subtle stereo spread; no detune at seam' : 'Chorus: off',
      'No bends/slides across loop seam'
    ].join('. ')
    case 'pad': return [
      'ROLE: single isolated pad only',
      'Chord: sustained diatonic chord(s); no modulation',
      `Evolution: ${scaleKnob(c.evolution, 'static','gentle','subtle motion','evolving','animated')} but reset every bar`,
      `Warmth: ${scaleKnob(c.warmth, 'cool','neutral','warm','lush','very lush')}`,
      `Brightness: ${scaleKnob(c.brightness, 'dark','warm','balanced','bright','shimmering')}`,
      `Motion: ${scaleKnob(c.motion, 'static','gentle','animated','evolving','shifting')}`,
      `Texture: ${scaleKnob(c.texture, 'smooth','airy','lush','grainy','noisy')}`,
      c.chorus ? 'Chorus: subtle; no stereo smear at seam' : 'Chorus: off',
      c.reverb ? 'Reverb: soft ambient; decay under bar; gate at seam' : 'Reverb: off',
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

// ----- Waveform dial controls -----
//
// The following helpers manage the horizontal dials that appear on each
// waveform when the user clicks on it.  These dials allow per‑stem
// adjustments of volume and the endpoint stretch factor.  When a
// waveform enters editing mode, the take navigation arrows are hidden
// and the overlay becomes interactive.  The corresponding functions
// handle showing/hiding this overlay, updating the volume both in
// the UI and the audio graph, and rebuilding the stem's loop buffer
// according to the selected endpoint factor.

/**
 * Toggle the visibility of the horizontal dial overlay on a waveform and
 * hide or show the take navigation arrows accordingly.  When
 * activated, the overlay becomes interactive (pointer events
 * enabled) and the arrow zones are hidden.  When deactivated, the
 * overlay is hidden and the arrows become usable again.
 *
 * @param {string} st The stem identifier.
 */
function toggleWaveformControls(st) {
  const cardEl = document.querySelector(`[data-stem="${st}"]`)
  if (!cardEl) return
  const overlay = cardEl.querySelector(`[data-stem-controls="${st}"]`)
  const prevZoneBtn = cardEl.querySelector(`[data-action="prev-take"]`)
  const nextZoneBtn = cardEl.querySelector(`[data-action="next-take"]`)
  const prevZone = prevZoneBtn ? prevZoneBtn.closest('div') : null
  const nextZone = nextZoneBtn ? nextZoneBtn.closest('div') : null
  if (!overlay || !prevZone || !nextZone) return
  const currentlyHidden = overlay.classList.contains('hidden')
  if (currentlyHidden) {
    overlay.classList.remove('hidden')
    overlay.classList.remove('pointer-events-none')
    overlay.classList.add('pointer-events-auto')
    prevZone.classList.add('hidden')
    nextZone.classList.add('hidden')
    waveformEditingState[st] = true
  } else {
    overlay.classList.add('hidden')
    overlay.classList.add('pointer-events-none')
    overlay.classList.remove('pointer-events-auto')
    prevZone.classList.remove('hidden')
    nextZone.classList.remove('hidden')
    waveformEditingState[st] = false
  }
}

/**
 * Handle updates from the volume dial slider.  Adjusts the unified
 * volume value for the stem, updates the waveform's vertical scale to
 * visualise the change, and reflects the change in the audio output.
 *
 * @param {string} st The stem identifier.
 * @param {number} val The new slider value (0–100).
 */
function handleVolumeSlider(st, val) {
  if (!st) return
  const v = Math.max(0, Math.min(100, Math.round(Number(val) || 0)))
  // Update the unified volume state and audio gain
  setVolumeUnified(st, v)
  // Do not scale the waveform canvas for the instrument card.  The
  // waveform should remain the same size regardless of the volume so
  // that the take remains clickable even when the volume is set to
  // zero.  Visual feedback for volume is provided only in the edit
  // popup preview.
}

/**
 * Handle updates from the endpoint dial slider.  Computes a stretch
 * factor from the slider value and rebuilds the loop buffer for the
 * stem accordingly.  The loop length remains the same, but the audio
 * content is compressed or expanded within that length.  After
 * rebuilding, the waveform display is updated and the stem restarts at
 * the next loop boundary if playback is active.
 *
 * @param {string} st The stem identifier.
 * @param {number} val The new slider value (50–150).
 */
function handleEndpointSlider(st, val) {
  if (!st) return
  const rawVal = Number(val) || 100
  // Map slider range 50–150 to a factor 0.5–1.5.  Clamp between 0.1 and 3.0 for safety.
  const factor = Math.max(0.1, Math.min(rawVal / 100, 3))
  endpointFactors[st] = factor
  adjustEndpoint(st, factor)
}

/**
 * Rebuild a stem's loop buffer based on a stretch/compression factor.  A
 * factor of 1.0 leaves the audio unchanged.  Values below 1.0 compress
 * the raw audio (it finishes sooner within the loop) and values above
 * 1.0 stretch the audio (it takes longer to reach the end) while
 * preserving the overall loop duration.  The algorithm performs a
 * simple resampling with wrap‑around, followed by applying the usual
 * edge ramps and seam crossfade to maintain loop smoothness.
 *
 * @param {string} st The stem identifier.
 * @param {number} factor The stretch factor (>0).
 */
function adjustEndpoint(st, factor) {
  const raw = stemRaw[st] || stemLoop[st]
  if (!raw) return
  const existing = stemLoop[st]
  // Preserve the current loop length if we have one; otherwise use the raw length
  const length = existing ? existing.length : raw.length
  const sr = raw.sampleRate
  const channels = raw.numberOfChannels
  const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: sr })
  /**
   * Perform a pitch‑preserving time stretch on a single channel using a
   * simple overlap‑add (OLA) algorithm.  We use a Hann window and
   * 50% overlap to ensure reasonably smooth reconstruction.  The
   * hop sizes in the input and output domains are related by the
   * stretch factor.  When factor > 1, the audio is compressed (we
   * move further ahead in the input for each output hop).  When
   * factor < 1, the audio is stretched (we move more slowly through
   * the input).  The input is treated as circular so that the loop
   * content wraps naturally.  See: standard OLA/WSOLA techniques in
   * time‑stretch literature【250912434198074†L742-L756】.
   *
   * @param {Float32Array} src The source channel data
   * @param {number} outLen The desired output length in samples
   * @param {number} factor The stretch factor (>0)
   */
  function timeStretchOLA(src, outLen, factor) {
    const srcLen = src.length
    const frameSize = 1024
    const hopOut = frameSize / 2 // 50% overlap
    const hopIn = hopOut * factor
    // Precompute Hann window for smooth crossfades.  With 50% overlap
    // the sum of overlapping Hann windows is unity, so no explicit
    // normalisation is required.
    const window = new Float32Array(frameSize)
    for (let i = 0; i < frameSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)))
    }
    const outBuf = new Float32Array(outLen)
    let posSrc = 0
    let posDst = 0
    // Continue until we have filled the output buffer.  We allow the
    // last window to wrap around at the end of the buffer.
    while (posDst < outLen + frameSize) {
      const baseDst = Math.floor(posDst)
      // For each sample in the frame, add the windowed source sample to the output.
      for (let i = 0; i < frameSize; i++) {
        const outIdx = baseDst + i
        if (outIdx >= outLen) break
        let srcIdx = Math.floor(posSrc + i)
        // Wrap around the source index
        srcIdx = ((srcIdx % srcLen) + srcLen) % srcLen
        outBuf[outIdx] += src[srcIdx] * window[i]
      }
      posSrc += hopIn
      posDst += hopOut
    }
    return outBuf
  }
  for (let c = 0; c < channels; c++) {
    const src = raw.getChannelData(c)
    const stretched = timeStretchOLA(src, length, factor)
    const dst = out.getChannelData(c)
    // Copy stretched data into the AudioBuffer channel
    dst.set(stretched)
  }
  // Apply longer edge ramps and crossfade for a smooth loop
  applyEdgeRamps(out, EDGE_RAMP_MS)
  applySeamCrossfade(out, LOOP_XFADE_MS)
  // Update loop buffer and duration
  stemLoop[st] = out
  stemLoopDuration[st] = out.duration
  // Redraw waveform
  const canvas = document.querySelector(`[data-stem="${st}"] .waveform-canvas`)
  if (canvas) {
    const cfg = stemConfigs[st]
    drawWaveform(canvas, out, `rgb(${getColorRGB(cfg.color)})`)
    // Do not scale the waveform on the card when adjusting the endpoint.
    // Keeping the canvas at a consistent height ensures the user can
    // always click the waveform, even if the volume is very low.
  }
  // Restart playback of this stem on the next boundary if currently playing
  if (isPlaying) {
    restartStemNextBoundary(st)
  }
}

/**
 * Open the waveform edit modal for a specific stem.  This modal
 * displays a preview of the current loop and provides full‑width
 * controls for adjusting volume and endpoint stretch.  Changes take
 * effect immediately (preview and audio), but can be discarded.
 *
 * @param {string} st The stem identifier
 */
function openWaveformEditModal(st) {
  if (!st) return
  const modal = document.getElementById('waveformEditModal')
  if (!modal) return
  waveformEditState.isOpen = true
  waveformEditState.stem = st
  // Store current values so we can revert on discard
  waveformEditState.prevVolume = stemControlValues[st]?.volume ?? 80
  waveformEditState.prevEndpointFactor = endpointFactors[st] ?? 1
  // Configure the new endpoint dial for this stem.  The dial uses
  // pointer and wheel events to adjust the endpoint factor.  Set the
  // data-stem attribute so generic dial handlers know which stem to
  // modify.  Reset its pattern offset to zero for a consistent
  // starting position when opening the modal.
  const endDial = document.getElementById('waveformEditEndpointDial')
  if (endDial) {
    endDial.setAttribute('data-stem', st)
    endDial.setAttribute('data-dial-type', 'endpoint')
    endDial.setAttribute('data-offset', '0')
    endDial.style.backgroundPosition = '0px 50%'
  }

  // Also update any plus/minus buttons associated with the endpoint dial so they know
  // which stem to adjust.  These buttons have the .dial-btn class and data-dial-type="endpoint".
  {
    const endpointBtns = modal.querySelectorAll('.dial-btn[data-dial-type="endpoint"]')
    endpointBtns.forEach(btn => {
      btn.setAttribute('data-stem', st)
    })
  }
  // Draw initial preview waveform and apply volume scaling
  const prevCanvas = document.getElementById('waveformEditCanvas')
  if (prevCanvas) {
    const cfg = stemConfigs[st]
    drawWaveform(prevCanvas, stemLoop[st], `rgb(${getColorRGB(cfg.color)})`)
    prevCanvas.style.transform = `scaleY(${(waveformEditState.prevVolume || 80) / 100})`
  }

  // Draw bar grid lines on the preview.  The grid divides the width
  // into equal segments corresponding to the number of bars in the loop.
  const gridContainer = document.getElementById('waveformEditGrid')
  if (gridContainer) {
    gridContainer.innerHTML = ''
    // Determine the number of bars from the master settings (default to 4)
    const bars = stemControlValues.master?.bars || DEFAULT_BARS
    for (let i = 0; i < bars; i++) {
      const seg = document.createElement('div')
      seg.style.flex = '1'
      if (i > 0) {
        seg.style.borderLeft = '1px solid rgba(255,255,255,0.15)'
      }
      gridContainer.appendChild(seg)
    }
  }
  // Set up action buttons
  const saveBtn = document.getElementById('editSaveBtn')
  const discardBtn = document.getElementById('editDiscardBtn')
  const defaultBtn = document.getElementById('editDefaultBtn')
  if (saveBtn) {
    saveBtn.onclick = () => closeWaveformEditModal(true)
  }
  if (discardBtn) {
    discardBtn.onclick = () => closeWaveformEditModal(false)
  }
  if (defaultBtn) {
    defaultBtn.onclick = () => {
      // Reset endpoint factor to original (1.0) for this take
      endpointFactors[st] = 1
      // Persist the reset factor on the active take
      const idx = stemActiveIndex[st]
      if (idx != null && idx >= 0 && stemHistory[st] && stemHistory[st][idx]) {
        stemHistory[st][idx].endpointFactor = 1
      }
      // Rebuild the loop and update waveform
      adjustEndpoint(st, 1)
      // Reset dial pattern offset to neutral position
      const endDialEl = document.getElementById('waveformEditEndpointDial')
      if (endDialEl) {
        endDialEl.setAttribute('data-offset', '0')
        endDialEl.style.backgroundPosition = '0px 50%'
      }
      // Redraw preview waveform with current volume scaling
      const prevCanvas2 = document.getElementById('waveformEditCanvas')
      if (prevCanvas2) {
        const cfg2 = stemConfigs[st]
        drawWaveform(prevCanvas2, stemLoop[st], `rgb(${getColorRGB(cfg2.color)})`)
        const volVal2 = stemControlValues[st]?.volume ?? 80
        prevCanvas2.style.transform = `scaleY(${volVal2 / 100})`
      }
    }
  }
  // Clicking on the semi‑transparent overlay should discard changes and close the modal
  const overlay = document.getElementById('waveformEditOverlay')
  if (overlay) {
    overlay.onclick = () => closeWaveformEditModal(false)
  }
  // Show modal
  modal.classList.remove('hidden')
  // Trigger transition; using requestAnimationFrame ensures that the class
  // removal is applied before setting opacity/scale.
  requestAnimationFrame(() => {
    modal.classList.remove('opacity-0')
  })
}

/**
 * Close the waveform edit modal.  If save is false, revert the
 * modifications to the stem's volume and endpoint.  After closing,
 * the editing state is cleared.
 *
 * @param {boolean} save Whether to keep the adjustments
 */
function closeWaveformEditModal(save) {
  if (!waveformEditState.isOpen) return
  const st = waveformEditState.stem
  if (!save && st) {
    // Revert to previous values
    setVolumeUnified(st, waveformEditState.prevVolume)
    endpointFactors[st] = waveformEditState.prevEndpointFactor
    adjustEndpoint(st, waveformEditState.prevEndpointFactor)
    // The card's waveform height is no longer scaled for volume, so there is
    // nothing to revert in terms of the canvas transform.
  }
  // Hide modal
  const modal = document.getElementById('waveformEditModal')
  if (modal) {
    // Start fade out
    modal.classList.add('opacity-0')
    // After animation, hide completely
    setTimeout(() => {
      modal.classList.add('hidden')
    }, 200)
  }
  waveformEditState.isOpen = false
  waveformEditState.stem = null
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
    if (statusEl) statusEl.textContent=`Creating… (${st}, tier ${tier+1}/3 @ 44.1k ${PRIMARY_OUTPUT_FORMAT})`
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

  // The create button (opens the settings modal) also acts as the trigger for generation.  Select
  // the button that opens the settings (open-create-settings) so we can show loading state.
  const button = document.querySelector(`[data-stem="${st}"] [data-action="open-create-settings"]`)
  const statusEl = document.querySelector(`[data-stem="${st}"] .status-line`)
  const card = document.querySelector(`[data-stem="${st}"]`)

  try {
    if (button) {
      button.disabled = true
      const icon = button.querySelector('[data-lucide]')
      if (icon) { icon.setAttribute('data-lucide', 'loader-2'); icon.classList.add('loading-spin'); window.lucide?.createIcons() }
    }
    if (card) card.classList.add('is-generating')
    if (statusEl) statusEl.textContent = `Creating… (Eleven Music v1)`

    const tempo = clampTempo(stemControlValues.master?.tempo ?? DEFAULT_TEMPO)
    const bars  = stemControlValues.master?.bars  ?? DEFAULT_BARS

    // Attempt to generate the stem via the Supabase edge function
    // `generate-techno-stem`.  This function builds the prompt, calls
    // the ElevenLabs API and trims the loop server-side.  On success
    // it returns a base64 encoded WAV along with prompt metadata.
    let audioBuffer, usedPrompt, tier = 0, validated = true, failedValidation = false
    try {
      const payload = {
        stem: st,
        controls: stemControlValues[st] || {},
        master: {
          tempo,
          bars,
          rootBase: stemControlValues.master?.rootBase || 'A',
          accidental: stemControlValues.master?.accidental || 'natural',
          mode: stemControlValues.master?.mode || 'Minor'
        },
        use_grok: false
      }
      const { data, error } = await supabase.functions.invoke('generate-techno-stem', { body: payload, signal })
      if (error || !data) {
        throw new Error(error?.message || 'Supabase invocation failed')
      }
      // data should contain audio_b64, usedPrompt, tier, validated
      const { audio_b64, usedPrompt: up, tier: tt, validated: val } = data
      usedPrompt = up || ''
      tier = typeof tt === 'number' ? tt : 0
      validated = val !== false
      // Decode the base64 audio string
      const commaIdx = (audio_b64 || '').indexOf(',')
      const b64 = commaIdx >= 0 ? audio_b64.slice(commaIdx + 1) : audio_b64
      const binaryStr = atob(b64 || '')
      const len = binaryStr.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i)
      audioBuffer = await audioContext.decodeAudioData(bytes.buffer)
      // Determine head index for record keeping
      referenceHeadIndex = detectHeadIndex(audioBuffer)
      referenceStemType = st
      // Use the returned audio as the strict loop
      stemRaw[st]  = audioBuffer
      stemLoop[st] = audioBuffer
      stemLoopDuration[st] = audioBuffer.duration
      failedValidation = !validated
    } catch (supErr) {
      // Supabase call failed or returned error; fallback to local generation
      console.error('Supabase request failed', supErr)
      // Use the old generate logic: call Eleven Labs via the proxy function
      // (`composeOnce` and `composeWithRetries`) and build a strict loop locally.
      if (st === 'hihat' || st === 'perc') {
        const res = await composeWithRetries(st, tempo, bars, signal, statusEl)
        audioBuffer = res.buffer
        usedPrompt = res.usedPrompt
        tier = res.tier
        failedValidation = !!res.failedValidation
      } else {
        const prompt = buildStemPrompt(st).trim()
        const beats = bars * 4
        const seconds = beats * (60 / tempo)
        let music_length_ms = Math.round(seconds * 1000) + GEN_TAIL_PAD_MS
        music_length_ms = Math.max(10000, Math.min(300000, music_length_ms))
        const body = USE_COMPOSITION_PLAN
          ? { composition_plan: buildCompositionPlan(getMasterForPrompt(), stemConfigs[st]?.basePrompt), prompt: null }
          : { prompt, music_length_ms }
        const ab = await composeOnce(body, signal)
        audioBuffer = await audioContext.decodeAudioData(ab)
        usedPrompt = prompt
        tier = 0
        failedValidation = false
      }
      // Determine head index and build a strict loop from the raw buffer
      referenceHeadIndex = detectHeadIndex(audioBuffer)
      referenceStemType = st
      const strictLoop = buildLoopBufferFromRawStrict(audioBuffer, tempo, bars, referenceHeadIndex)
      // Store the newly generated raw buffer and strict loop.  We explicitly
      // assign the raw to stemRaw so that endpoint adjustments can be
      // constructed from the unmodified audio later.  The strict loop is
      // stored in stemLoop to be used for playback.  Reset the
      // endpoint stretch factor to its default (1.0) for a fresh take so
      // that subsequent adjustments start from an unmodified loop.
      stemRaw[st]  = audioBuffer
      stemLoop[st] = strictLoop
      stemLoopDuration[st] = strictLoop.duration
      endpointFactors[st] = 1
    }

    // Push the new version into history
    pushStemVersion(st, {
      id: `${st}_${Date.now()}`,
      createdAt: new Date().toISOString(),
      prompt: usedPrompt,
      tempo, bars,
      sessionTag: SESSION_TAG,
      headIndex: referenceHeadIndex,
      raw: stemRaw[st],
      meta: { tier, validated: !failedValidation }
    })
    // Store the current endpoint factor on the newly created history entry so it can be restored when selecting the take.
    {
      ensureStemHistory(st)
      const list = stemHistory[st]
      if (list && list.length > 0) {
        const last = list[list.length - 1]
        last.endpointFactor = endpointFactors[st] ?? 1
      }
    }
    renderHistoryDrawer(st)
    // Draw waveform for the new loop
    const canvas = document.querySelector(`[data-stem="${st}"] .waveform-canvas`)
    if (canvas) {
      const cfg = stemConfigs[st]
      drawWaveform(canvas, stemLoop[st], `rgb(${getColorRGB(cfg.color)})`)
    }
    // After drawing the waveform, update the overlay controls to reflect
    // the current per‑stem volume and the reset endpoint factor.  Also
    // scale the waveform vertically according to the volume.  This
    // ensures that newly generated takes show the correct slider
    // positions and waveform height when the overlay is toggled.
    {
      const overlay = document.querySelector(`[data-stem-controls="${st}"]`)
      if (overlay) {
        const volInput = overlay.querySelector('[data-action="adjust-volume"]')
        if (volInput) volInput.value = String(stemControlValues[st]?.volume ?? 80)
        const endInput = overlay.querySelector('[data-action="adjust-endpoint"]')
        if (endInput) endInput.value = '100'
      }
      // Do not apply any vertical scaling based on volume here.  The
      // waveform on the card keeps a constant height regardless of
      // volume so that the take remains clickable even when the
      // volume is turned down.
    }
    if (statusEl) {
      const base = `Ready (${stemLoop[st].duration.toFixed(3)}s, loop-aligned)`
      statusEl.textContent = failedValidation
        ? `${base} — warning: validator failed after retries (kept strict take)`
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
  if(!buf){ alert(`No audio for ${stemConfigs[st]?.name || st}. Create first.`); return }
  const wav=encodeWAV(buf)
  const url=URL.createObjectURL(wav)
  const a=document.createElement('a')
  a.href=url; a.download=`techno_${st}_${Date.now()}.wav`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Download all active takes for every stem.  When the user clicks the
 * "download all" button, iterate over all configured stems and, if a
 * take has been generated and is currently selected (active), create a
 * WAV file and trigger a download.  This does nothing for stems
 * without a generated take.  The file names mirror the single
 * download button naming scheme and include a timestamp.
 */
function downloadAllActiveStems(){
  // Iterate over the keys of stemConfigs to include all stems defined in
  // the current session.  For each stem, check whether there is an
  // active history entry (active index >= 0) and that a loop buffer
  // exists.  If so, download that buffer.
  Object.keys(stemConfigs).forEach(st => {
    const hasActive = (stemActiveIndex[st] ?? -1) >= 0
    const buf = stemLoop[st]
    if (hasActive && buf) {
      downloadStem(st)
    }
  })
}

/* =========================================================
   UI rendering (per card) — with black generate btn, wider sliders, click‑overlay for toggles
   ========================================================= */
function knobToDb(val){
  const v=Math.max(0, Math.min(100, Number(val)||0))
  // Shift the 0 dB point to 75% of the slider to mirror professional DAW faders.
  const pivot = 75
  if (v <= pivot) return EQ_MIN_DB + (v / pivot) * (0 - EQ_MIN_DB)
  return ((v - pivot) / (100 - pivot)) * EQ_MAX_DB
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

// Mobile version of header action buttons.  On small screens the action icons
// appear below the card title at 25% smaller size and reduced spacing.  This
// helper is used in the card header markup to display a second row of
// buttons on mobile only (hidden on sm and larger).
function headerActionButtonsMobileHTML(st) {
  return `\n        <div class="flex items-center gap-1 sm:hidden mt-1">\n          <button class="sg-toggle w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="mute-stem" data-stem="${st}" title="Mute/Unmute" aria-pressed="false">\n            <i data-lucide="volume-2" class="w-3 h-3"></i>\n          </button>\n          <button class="sg-toggle w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="solo-stem" data-stem="${st}" title="Solo" aria-pressed="false">\n            <i data-lucide="headphones" class="w-3 h-3"></i>\n          </button>\n          <button class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-stem="${st}" title="Favorite (coming soon)">\n            <i data-lucide="heart" class="w-3 h-3"></i>\n          </button>\n          <button class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="download-stem" data-stem="${st}" title="Download">\n            <i data-lucide="download" class="w-3 h-3"></i>\n          </button>\n        </div>\n      `
}
function createBuilderStemCard(st, cfg){
  const card = document.createElement('div')
  // Use tighter padding on mobile and moderate padding on larger screens to make cards more compact on small devices.
  card.className = `glass card-border rounded-2xl p-3 sm:p-5 transition-all duration-300 hover:scale-[1.02] border-l-4 border-l-${cfg.color}-500 select-none cursor-default`
  card.setAttribute('data-stem', st)

  const idx = STEM_ORDER.indexOf(st) + 1

  // Build header markup.  On mobile (below sm), action buttons appear on a second row beneath
  // the title and number.  On sm and above, the action buttons appear inline to the right of
  // the title.  We wrap the desktop actions in a hidden container on mobile and include a
  // separate mobile action row using headerActionButtonsMobileHTML.
  const headerHTML = `\n        <div class="flex flex-col sm:flex-row sm:items-center mb-1 sm:mb-2">\n          <!-- First row on mobile: name and number indicator are aligned horizontally. -->\n          <div class="flex items-center justify-between w-full sm:w-auto gap-2">\n            <div class="flex items-center gap-2">\n              <h3 class="text-sm sm:text-base font-medium text-white">${cfg.name}</h3>\n            </div>\n            <span data-card-number="${st}" class="stem-index inline-flex items-center justify-center w-5 h-5 sm:w-5 sm:h-5 text-xs sm:text-xs font-semibold rounded-full border border-white/30">${idx}</span>\n          </div>\n          <!-- Action icons centered on desktop -->\n          <div class="hidden sm:flex flex-1 items-center justify-center gap-1.5">${customHeaderActionButtonsHTML(st)}</div>\n          ${customHeaderActionButtonsMobileHTML(st)}\n        </div>\n      `

  // Removed EQ and Filter controls from the card; these will be shown in the mixer instead.
  const eqFilterHTML = ''

  // Remove per-stem volume control from the card; volume is now controlled in the mixer
  let volumeHTML = ''

  // Waveform display: remove takes/tempo indicators/open button and add left/right arrow zones occupying 25% of the width each.
  // The overlay controls for volume and endpoint have been moved into a modal
  // rather than being drawn over the waveform.  Therefore, we no longer
  // include the overlay markup here.  Clicking on the waveform will open
  // the dedicated edit modal defined in index.html.
  const waveformHTML = `\n        <div class="mb-2">\n          <!-- Waveform container: relative so overlays can be positioned absolutely -->\n          <div class="relative group">\n            <canvas class="waveform-canvas w-full h-16 bg-white/5 rounded-md border border-white/10 cursor-pointer"\n                    width="400" height="64" data-stem="${st}" title="Click to edit this take"></canvas>\n            <!-- Indicator showing current playback position -->\n            <div class="absolute inset-y-0 left-0 w-0.5 bg-purple-400 shadow-glow pointer-events-none transition-all duration-75 ease-linear opacity-0"\n                 data-stem-indicator="${st}"></div>\n            <!-- Edit icon overlay: hand pointer icon always visible.  Pointer events are disabled so clicks pass through to the canvas. -->\n            <div class="absolute inset-0 flex items-center justify-center pointer-events-none">\n              <i data-lucide="mouse-pointer-2" class="w-6 h-6 text-white"></i>\n            </div>\n            <!-- Left and right arrow zones: occupy 25% width each.  Rounded corners match the waveform box on the edges. -->\n            <div class="absolute inset-y-0 left-0 w-1/4 bg-black/50 flex items-center justify-center rounded-l-md overflow-hidden pointer-events-auto">\n              <button class="p-1 bg-transparent text-white flex items-center justify-center hover:bg-white/20 transition"\n                      data-action="prev-take" data-stem="${st}" type="button" title="Previous take">\n                <i data-lucide="chevron-left" class="w-5 h-5"></i>\n              </button>\n            </div>\n            <div class="absolute inset-y-0 right-0 w-1/4 bg-black/50 flex items-center justify-center rounded-r-md overflow-hidden pointer-events-auto">\n              <button class="p-1 bg-transparent text-white flex items-center justify-center hover:bg-white/20 transition"\n                      data-action="next-take" data-stem="${st}" type="button" title="Next take">\n                <i data-lucide="chevron-right" class="w-5 h-5"></i>\n              </button>\n            </div>\n          </div>\n        </div>\n        <div class="overflow-hidden transition-all duration-200 ease-out max-h-0" data-history-drawer="${st}">\n          <div class="flex items-center justify-between text-xs text-white/60 mt-1 mb-2">\n            <span>Previous takes</span>\n            <button class="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-[11px]"\n                    data-action="close-history" data-stem="${st}">Close</button>\n          </div>\n          <div class="flex gap-2 overflow-x-auto pb-2 no-scrollbar" data-history-list="${st}"></div>\n        </div>\n      `

  // Volume dial: an infinite horizontal dial positioned between the
  // waveform and the create button.  A minus sign on the left and a plus
  // sign on the right provide a visual cue for volume down/up.  The dial
  // uses data-dial-type="volume" so the generic handlers adjust the
  // volume for this stem when it is dragged or scrolled.
  // Volume dial displays minus and plus buttons flanking an infinite dial.  On mobile the icons retain
  // their original size, while on desktop they double in size (via sm:text-xl).  The
  // .dial-btn class allows us to attach pointer handlers for discrete step adjustments.
  const volumeDialHTML = `\n        <div class="my-2 flex items-center">\n          <span class="dial-btn text-white/60 text-sm sm:text-xl font-extrabold mr-2" data-dial-type="volume" data-dial-step="-1" data-stem="${st}">-</span>\n          <div class="flex-1 infinite-dial" data-dial-type="volume" data-stem="${st}" data-offset="0"></div>\n          <span class="dial-btn text-white/60 text-sm sm:text-xl font-extrabold ml-2" data-dial-type="volume" data-dial-step="1" data-stem="${st}">+</span>\n        </div>\n      `

  // Sliders and toggles are now moved into a popup.  Keep empty strings here to avoid including them on the card.
  let slidersRowsHTML = ''
  let togglesMenuHTML = ''

  // Generate panel: player-surface look, black Generate button, click-to-toggle overlay above sliders
  const genPanelHTML = `\n        <div class="mt-3 rounded-xl player-surface text-white border-2 border-white/80 shadow-sm p-3 relative">\n          <div class="flex items-start gap-4">\n            <div class="relative flex-1">\n              <div class="grid grid-cols-1 gap-2">${slidersRowsHTML}</div>\n              <div class="absolute left-0 right-0 -top-2 z-20 hidden" data-options-panel="${st}">\n                <div class="bg-black border-2 border-white/80 rounded-xl p-3 shadow-xl">\n                  ${togglesMenuHTML || '<div class="text-xs text-white/60">No options</div>'}\n                </div>\n              </div>\n            </div>\n            <div class="flex flex-col items-end">\n              <button class="w-9 h-9 rounded-lg border border-white/30 flex items-center justify-center hover:bg-white/10"\n                      data-action="toggle-stem-options" data-stem="${st}" aria-pressed="false" title="Stem options">\n                <i data-lucide="sliders" class="w-4 h-4"></i>\n              </button>\n            </div>\n          </div>\n          <button class="mt-3 w-full py-2.5 rounded-xl bg-black text-white font-semibold border border-white/30 shadow-sm hover:shadow transition will-change-transform hover:-translate-y-0.5 active:translate-y-[1px]"\n                  data-action="generate" data-stem="${st}" title="Generate new take">\n            <span class="inline-flex items-center gap-2">\n              <i data-lucide="wand-2" class="w-4 h-4"></i>\n              Generate\n            </span>\n          </button>\n        </div>\n      `

  // Define a generate button fragment.  The sliders and toggles are shown in a popup instead of on the card.
  const genButtonHTML = `\n        <div class="mt-3 rounded-xl player-surface text-white border-2 border-white/80 shadow-sm p-2 sm:p-3 relative">\n          <button class="w-full py-2.5 rounded-xl bg-black text-white font-semibold border border-white/30 shadow-sm hover:shadow transition will-change-transform hover:-translate-y-0.5 active:translate-y-[1px]"\n                  data-action="open-generate-settings" data-stem="${st}" title="Generate new take">\n            <span class="inline-flex items-center gap-2">\n              <i data-lucide="wand-2" class="w-4 h-4"></i>\n              Generate\n            </span>\n          </button>\n        </div>\n      `;

  // Define a create button fragment.  This version removes borders and uses "Create" for the label.  It opens
  // a modal for configuring generation settings when clicked.
  const genCreateButtonHTML = `\n        <div class="mt-3 rounded-xl player-surface text-white shadow-sm p-2 sm:p-3 relative">\n          <button class="w-full py-2.5 rounded-xl bg-black text-white font-semibold shadow-sm hover:shadow transition will-change-transform hover:-translate-y-0.5 active:translate-y-[1px]"\n                  data-action="open-create-settings" data-stem="${st}" title="Create new take">\n            <span class="inline-flex items-center gap-2 text-xs sm:text-sm">\n              <i data-lucide="wand-2" class="w-3 h-3 sm:w-4 sm:h-4"></i>\n              Create\n            </span>\n          </button>\n        </div>\n      `;
  // Use our custom create button HTML instead of the default generate button.  Update status line text accordingly.
  card.innerHTML = headerHTML + eqFilterHTML + volumeHTML + waveformHTML + volumeDialHTML + genCreateButtonHTML + `\n        <div class="status-line hidden mt-2 text-sm text-white/80">Ready to create</div>\n      `
  // Enhance the create button markup by attaching classes that allow responsive font and icon sizing.
  // The span within the create button becomes the label, and the icon gets a special class so
  // CSS can target them on mobile.  We cannot edit the template literal easily, so we modify
  // the DOM after insertion.
  {
    const labelSpan = card.querySelector('[data-action="open-create-settings"] span')
    if (labelSpan) labelSpan.classList.add('create-label')
    const iconEl = card.querySelector('[data-action="open-create-settings"] i')
    if (iconEl) iconEl.classList.add('create-icon')

    // Apply responsive sizing for the create button's label and icon: make them 30% smaller on mobile.
    if (labelSpan) labelSpan.classList.add('text-xs', 'sm:text-sm')
    if (iconEl) iconEl.classList.add('w-3', 'h-3', 'sm:w-4', 'sm:h-4')
    // Adjust arrow button padding to bring icons closer to the edges.  Remove px-2/py-1 and use p-1 instead.
    const prevBtn = card.querySelector('[data-action="prev-take"]')
    const nextBtn = card.querySelector('[data-action="next-take"]')
    ;[prevBtn, nextBtn].forEach(btn => {
      if (btn) {
        btn.classList.remove('px-2', 'py-1')
        btn.classList.add('p-1')
      }
    })

    // Remove the "Previous takes" label from the history drawer.  We leave only the close button.
    const historySpan = card.querySelector(`[data-history-drawer="${st}"] span`)
    if (historySpan) {
      historySpan.remove()
    }

    // Do not scale the waveform vertically based on volume.  The card's
    // waveform remains at full height so that the user can always click
    // the take even when its volume is set to zero.  Visual feedback
    // for volume changes is provided exclusively in the edit modal.

      // On small screens, show the number indicator within the header row; hide it on
      // desktop so that it can be shown in the top-right corner of the card.
      const numEl = card.querySelector(`[data-card-number="${st}"]`)
      if (numEl) numEl.classList.add('sm:hidden')

      // Make the card relative so absolute positioning inside works for desktop indicators
      card.classList.add('relative')

      // Create a desktop-only number indicator positioned at the top right of the card.
      const desktopNum = document.createElement('span')
      desktopNum.setAttribute('data-card-number-desktop', st)
      desktopNum.textContent = String(idx)
      // Position with extra padding on desktop (sm:top-5 sm:right-5) so the number indicator isn't flush
      // against the edges. Hidden on mobile (sm:hidden applied on the header indicator instead).
      desktopNum.className = 'hidden sm:flex items-center justify-center w-5 h-5 text-xs font-semibold rounded-full border border-white/30 absolute top-2 right-2 sm:top-5 sm:right-5'
      card.appendChild(desktopNum)

      // Adjust the edit label overlay within the waveform container.  Always show it (remove hover-based
      // opacity) and scale its size responsively.  On mobile the text is smaller; on desktop it is
      // larger and bold white.  Remove the default fade classes to avoid relying on hover state.
      {
        const overlayEl = card.querySelector('.relative .pointer-events-none')
        if (overlayEl) {
          // Remove fade and original size classes
          overlayEl.classList.remove('opacity-0', 'group-hover:opacity-100', 'text-white/70', 'text-[10px]')
          // Always fully visible
          overlayEl.classList.add('opacity-100')
          // Use smaller text on mobile (approx 25% smaller) and larger bold text on desktop
          overlayEl.classList.add('text-white/70', 'text-[8px]', 'sm:text-[20px]', 'sm:font-bold', 'sm:text-white')
        }
      }
  }

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
      // Initialise endpoint stretch factor for each stem (1.0 = no stretch)
      endpointFactors[st] = 1
    if (!stemEqValues[st]) stemEqValues[st] = { low: 75, mid: 75, high: 75 }
    if (!stemFilterValues[st]) stemFilterValues[st] = { mode: 'lowpass', cutoff: defCutKnob }
    if (cfg.controls) {
      Object.entries(cfg.controls).forEach(([k, c]) => {
        // Initialise controls with provided defaults
        stemControlValues[st][k] = c.default
      })
      // Override volume default to 75 (toward the right) so all channels start at 0 dB with the new mapping
      if ('volume' in cfg.controls) {
        stemControlValues[st].volume = 75
      }
    }
  })
}

/* ---------- Mixer glow ---------- */
function isStemActuallyPlaying(st){ return isPlaying && !!stemNodes[st]?.source && !stemMuteStates[st] && (!soloedStem || soloedStem === st) }
function updateMixerGlow(st){ const card=document.querySelector(`[data-mix-card="${st}"]`); if(!card) return; card.classList.toggle('sg-glow', isStemActuallyPlaying(st)) }
function updateAllMixerGlows(){ Object.keys(stemConfigs).forEach(updateMixerGlow) }

/* ---------- Toggle visuals (Mute/Solo) ---------- */
function setToggleVisual(el, active){ if (!el) return; el.classList.toggle('sg-toggle-active', !!active); el.setAttribute('aria-pressed', active ? 'true' : 'false') }
function reflectMuteSoloButtons(st){
  const muted  = !!stemMuteStates[st]
  const soloed = (soloedStem === st)
  // Update all mute buttons on the instrument card (desktop and mobile)
  document.querySelectorAll(`[data-stem="${st}"] [data-action="mute-stem"]`).forEach(btn => setToggleVisual(btn, muted))
  // Update all solo buttons on the instrument card (desktop and mobile)
  document.querySelectorAll(`[data-stem="${st}"] [data-action="solo-stem"]`).forEach(btn => setToggleVisual(btn, soloed))
  // Update mute/solo buttons in the mixer
  document.querySelectorAll(`[data-action="mix-mute"][data-stem="${st}"]`).forEach(btn => setToggleVisual(btn, muted))
  document.querySelectorAll(`[data-action="mix-solo"][data-stem="${st}"]`).forEach(btn => setToggleVisual(btn, soloed))
}

/* ---------- Volume link ---------- */
function setVolumeUnified(st, newVal){
  const v=Math.max(0, Math.min(100, Math.round(Number(newVal)||0)))
  stemControlValues[st].volume=v

  // Update legacy card volume slider if present
  const cardSlider=document.querySelector(`[data-stem="${st}"] [data-control="volume"]`)
  if (cardSlider) {
    cardSlider.value=v
    const display=cardSlider.parentElement?.querySelector('span:last-child')
    const cfg=stemConfigs[st]?.controls?.volume
    if (display && cfg) display.textContent=`${v}${cfg.unit}`
  }
  // Update new mixer volume slider if present; value display is handled via tooltip
  const mixSlider=document.querySelector(`input[data-mix-slider="volume"][data-stem="${st}"]`)
  if (mixSlider) {
    mixSlider.value=String(v)
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

// Build a mixer channel row with sliders for volume, EQ and filter.  Each
// row spans the full width of the mixer panel on desktop.  EQ
// sliders control low, mid and high bands.  The filter slider
// controls cutoff frequency.  Mute and Solo buttons are included
// along with the channel number.  Use data attributes to attach
// event handlers.
function mixChannelRowHTML(st){
  const name = stemConfigs[st]?.name || st
  const idx  = STEM_ORDER.indexOf(st) + 1
  // Retrieve current state values; initialise to defaults (50 => 0 dB) if undefined
  const volVal = stemControlValues[st]?.volume ?? 50
  const eq = stemEqValues[st] || { low: EQ_DEFAULT, mid: EQ_DEFAULT, high: EQ_DEFAULT }
  const filt = stemFilterValues[st] || { cutoff: freqToKnob(FILTER_DEFAULT_HZ), mode: 'lowpass' }
  const modeLabel = (filt.mode === 'lowpass') ? 'LP' : 'HP'
  return `
    <div class="sg-mix-row flex flex-col border border-white/15 bg-white/5 backdrop-blur-lg rounded-lg p-3 gap-2" data-mix-card="${st}">
      <!-- Header: channel number and name -->
      <div class="flex items-center gap-2">
        <span data-mix-number="${st}" class="inline-flex items-center justify-center w-4 h-4 rounded-full border border-white/30 text-[10px] font-semibold">${idx}</span>
        <span class="text-xs font-medium">${name}</span>
      </div>
      <!-- Volume slider (0–100 mapped to dB) -->
      <!-- The .mix-vol-row class makes it easy to hide this row on mobile via CSS -->
      <div class="mix-vol-row flex items-center gap-2">
        <span class="text-[10px] w-12">Vol</span>
        <!-- Make the dB slider the same length as the shortest slider (cutoff) -->
        <input type="range" data-mix-slider="volume" data-stem="${st}" min="0" max="100" value="${volVal}"
               class="w-3/5 h-3 bg-white/10 rounded-lg cursor-pointer" style="touch-action:none;">
      </div>
      <!-- EQ sliders: Low/Mid/High -->
      <div class="flex items-center gap-2">
        <span class="text-[10px] w-12">Low</span>
        <input type="range" data-mix-eq="low" data-stem="${st}" min="0" max="100" value="${eq.low}"
               class="w-3/5 h-3 bg-white/10 rounded-lg cursor-pointer" style="touch-action:none;">
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] w-12">Mid</span>
        <input type="range" data-mix-eq="mid" data-stem="${st}" min="0" max="100" value="${eq.mid}"
               class="w-3/5 h-3 bg-white/10 rounded-lg cursor-pointer" style="touch-action:none;">
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] w-12">High</span>
        <input type="range" data-mix-eq="high" data-stem="${st}" min="0" max="100" value="${eq.high}"
               class="w-3/5 h-3 bg-white/10 rounded-lg cursor-pointer" style="touch-action:none;">
      </div>
      <!-- Filter cutoff and mode toggle -->
      <!-- The .mix-cutoff-row class makes it easy to hide this row on mobile via CSS -->
      <div class="mix-cutoff-row flex items-center gap-2">
        <span class="text-[10px] w-12">Cutoff</span>
        <!-- Shorter slider for cutoff so the LP/HP button remains visible -->
        <input type="range" data-mix-filter="cutoff" data-stem="${st}" min="0" max="100" value="${filt.cutoff}"
               class="w-3/5 h-3 bg-white/10 rounded-lg cursor-pointer" style="touch-action:none;">
        <button class="px-1.5 py-0.5 text-[10px] rounded border border-white/15 hover:bg-white/10"
                data-action="toggle-filter-mode" data-stem="${st}" data-filter-mode="${st}">${modeLabel}</button>
      </div>
      <!-- Bottom bar: Mute/Solo buttons -->
      <div class="flex justify-between mt-2">
        <button class="sg-toggle px-1.5 py-0.5 text-[10px] rounded border border-white/15 hover:bg-white/10" data-action="mix-mute" data-stem="${st}" aria-pressed="false">Mute</button>
        <button class="sg-toggle px-1.5 py-0.5 text-[10px] rounded border border-white/15 hover:bg-white/10" data-action="mix-solo" data-stem="${st}" aria-pressed="false">Solo</button>
      </div>
    </div>
  `
}
function buildFloatingMixerPanel(){
  const tray=document.getElementById('mixerTray')
  if (!tray) return
  let grid = tray.querySelector('#mixerGrid')
  // Create the grid element if it doesn't exist
  if (!grid) {
    grid = document.createElement('div')
    grid.id = 'mixerGrid'
    tray.querySelector('.mixer-inner')?.appendChild(grid)
  }
  // Always apply responsive classes: single column on extra small screens and two columns on small screens and above
  // On desktop (sm and up) this results in two channels per row; on very small screens there is one channel per row
  // Use two columns for the mixer on all screen sizes; maintain gap scaling on larger screens
  // Use two columns on small screens and three columns on medium and larger screens for the mixer layout
  // Display three channels per row on all screen sizes for consistency.
  grid.className = 'grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-3'
  // Populate with full-width channel rows
  grid.innerHTML = STEM_ORDER.map(st => mixChannelRowHTML(st)).join('')
  // Update mixer glow and card number colours
  STEM_ORDER.forEach(updateMixerGlow)
  STEM_ORDER.forEach(updateCardNumberColor)
}
function setMixerOpen(open){
  const tray=document.getElementById('mixerTray')
  if (!tray) return
  // Expand the mixer to full viewport height when open; collapse to zero when closed
  tray.style.maxHeight = open ? '100vh' : '0px'
  tray.dataset.open = open ? '1' : '0'
  // Update player toggle button label + ARIA
  const toggleBtn = document.getElementById('mixerToggleBtn')
  if (toggleBtn) {
    // Update the desktop label only.  The mobile label remains 'mixer' regardless of state.
    const desktopSpan = toggleBtn.querySelector('span.hidden.sm\\:inline')
    const mobileSpan  = toggleBtn.querySelector('span.inline.sm\\:hidden')
    if (desktopSpan) desktopSpan.textContent = open ? 'close mixer' : 'open mixer'
    // Do not modify the mobile label (mobileSpan) so it stays 'mixer'
    toggleBtn.setAttribute('aria-pressed', open ? 'true' : 'false')
  }

  // When the mixer is open on mobile, prevent the page from scrolling or panning.
  // Disable body overflow so touch interactions are confined to the mixer.
  if (open) {
    // Hide page scrolling and prevent gestures from propagating outside the mixer
    document.body.style.overflow = 'hidden'
    // When the mixer is open, disable touch-action on the tray so that horizontal drags are consumed by sliders and not by the page
    tray.style.touchAction = 'none'
  } else {
    document.body.style.overflow = ''
    tray.style.touchAction = ''
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

  // Download all button: save all active stems to WAV files
  const downloadAllBtn = document.getElementById('downloadAllBtn')
  if (downloadAllBtn) downloadAllBtn.addEventListener('click', () => downloadAllActiveStems())

  // Generate settings modal buttons.  Cancel simply closes the modal; Start applies settings and triggers generation.
  const genCancelBtn = document.getElementById('generateSettingsCancelBtn')
  const genStartBtn  = document.getElementById('generateSettingsStartBtn')
  const genOverlay   = document.getElementById('generateSettingsOverlay')
  if (genCancelBtn) genCancelBtn.addEventListener('click', () => hideGenerateSettingsModal())
  if (genOverlay) genOverlay.addEventListener('click', () => hideGenerateSettingsModal())
  if (genStartBtn) genStartBtn.addEventListener('click', () => { applyGenerateSettingsAndStart() })

  // Live update the value labels in the create settings modal.  When the user moves a slider, update
  // the adjacent span to reflect the new value and unit.
  const genSettingsContent = document.getElementById('generateSettingsContent')
  if (genSettingsContent) {
    genSettingsContent.addEventListener('input', (e) => {
      const target = e.target
      if (!target || !target.getAttribute) return
      const control = target.getAttribute('data-gen-control')
      if (control && target.type === 'range') {
        const unit = target.getAttribute('data-unit') || ''
        // The span displaying the value is the last child of the parent container
        const container = target.parentElement
        if (container) {
          const spans = container.getElementsByTagName('span')
          if (spans && spans.length) {
            const display = spans[spans.length - 1]
            display.textContent = `${target.value}${unit}`
          }
        }
      }
    })
  }

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
      // Do not update master tempo if the session has been locked
      if (sessionSetupDone) return
      const value = clampTempo(e.target.value)
      e.target.value = value
      stemControlValues.master.tempo = value
      // Update readout
      if (tempoValueEl) tempoValueEl.textContent = String(value)
    })
  }

  // Infinite dial: pointerdown event handled globally so that new dials
  // created dynamically do not require explicit listener registration.
  // See the dial handlers defined at the bottom of the script.

  // Bars
  const barsSelector = document.getElementById('barsSelector')
  if (barsSelector) {
    barsSelector.value = String(stemControlValues.master.bars)
    barsSelector.addEventListener('change', e => {
      if (sessionSetupDone) return
      stemControlValues.master.bars = parseInt(e.target.value, 10)
      STEM_ORDER.forEach(st => {
        const drawer = document.querySelector(`[data-history-drawer="${st}"]`)
        if (drawer?.classList.contains('open')) renderHistoryDrawer(st)
      })
    })
  }

  // Master Volume: controls the global output gain.  Updates the text display and ramps the master gain.
  const masterVolSlider = document.getElementById('masterVolumeSlider')
  const masterVolValue  = document.getElementById('masterVolumeValue')
  if (masterVolSlider) {
    // Initialize the slider display based on the current masterGain value, if available
    if (masterVolValue && typeof masterGain?.gain?.value === 'number') {
      const initVal = Math.round((masterGain.gain.value || 0) * 100)
      masterVolSlider.value = String(initVal)
      masterVolValue.textContent = `${initVal}%`
    }
    masterVolSlider.addEventListener('input', async e => {
      const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)))
      // Update displayed percentage
      if (masterVolValue) masterVolValue.textContent = `${v}%`
      // Ensure the audio context exists and update the gain
      await ensureAudioContext()
      if (masterGain) {
        const now = audioContext.currentTime
        // Ramp smoothly to new gain value
        masterGain.gain.cancelScheduledValues(now)
        masterGain.gain.setValueAtTime(masterGain.gain.value, now)
        masterGain.gain.linearRampToValueAtTime(v / 100, now + 0.02)
      }
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
      if (sessionSetupDone) return
      const vv = String(e.target.value || 'A')
      const mm = vv.match(/^[A-G]/i)
      if (mm) stemControlValues.master.rootBase = mm[0].toUpperCase()
    })
  }
  if (accidentalSelector) accidentalSelector.addEventListener('change', e => {
    if (sessionSetupDone) return
    stemControlValues.master.accidental = e.target.value
  })
  if (modeSelector) {
    modeSelector.value = stemControlValues.master.mode
    modeSelector.addEventListener('change', e => {
      if (sessionSetupDone) return
      stemControlValues.master.mode = e.target.value
    })
  }

  // Hide "Format" selector if present
  const fmt = document.getElementById('outputFormatSelector')
  if (fmt && fmt.parentElement) fmt.parentElement.style.display = 'none'

  // Card inputs (live + gen)
  document.addEventListener('input', e => {
    const target = e.target
    const st = target.dataset.stem
    // Mixer volume slider
    if (target.dataset.mixSlider === 'volume' && st) {
      const v = Math.max(0, Math.min(100, Math.round(Number(target.value) || 0)))
      stemControlValues[st].volume = v
      // update readout element (next sibling)
      const ro = target.nextElementSibling
      if (ro) ro.textContent = `${v}%`
      // update audio gain if playing
      if (stemNodes[st]?.gain) {
        const g = stemNodes[st].gain.gain
        const now = audioContext.currentTime
        g.cancelScheduledValues(now)
        g.setValueAtTime(g.value, now)
        const muted = stemMuteStates[st]
        const soloedOther = (soloedStem && soloedStem !== st)
        const val = (muted || soloedOther) ? 0 : (v/100)
        g.linearRampToValueAtTime(val, now + 0.01)
      }
      return
    }
    // Mixer EQ sliders
    if (target.dataset.mixEq && st) {
      const band = target.dataset.mixEq
      const v = Math.max(0, Math.min(100, Math.round(Number(target.value) || 0)))
      // update state
      stemEqValues[st] = { ...(stemEqValues[st] || {}), [band]: v }
      // apply to audio nodes if playing
      const eqNodes = stemNodes[st]?.eq
      if (eqNodes) applyEqValuesToNodes(eqNodes, stemEqValues[st])
      return
    }
    // Mixer filter slider
    if (target.dataset.mixFilter === 'cutoff' && st) {
      const v = Math.max(0, Math.min(100, Math.round(Number(target.value) || 0)))
      stemFilterValues[st] = { ...(stemFilterValues[st] || {}), cutoff: v }
      // apply to audio nodes if playing
      const filterNode = stemNodes[st]?.filter
      if (filterNode) applyFilterValuesToNode(filterNode, stemFilterValues[st])
      return
    }
    // Card control sliders/toggles
    if (target.dataset.stem && target.dataset.control) {
      const key = target.dataset.control
      const val = target.type === 'checkbox' ? target.checked : parseInt(target.value, 10)
      stemControlValues[st][key] = val
      if (target.type === 'range') {
        const display = target.parentElement.querySelector('span:last-child')
        const cfg = stemConfigs[st]?.controls[key]
        if (display) display.textContent = `${val}${cfg?.unit || ''}`
      }
      if (key === 'volume') setVolumeUnified(st, val)
    }
  })

  // Slider tooltip handling for mixer sliders.  Display a small popup showing dB or Hz while adjusting.
  let activeSlider = null
  // Helper to update tooltip content and position
  function updateSliderTooltip(sliderEl, pageX, pageY) {
    if (!sliderTooltipEl) return
    const val = Number(sliderEl.value) || 0
    let text = ''
    // Determine the type of slider and compute display value
    if (sliderEl.dataset.mixSlider === 'volume' || sliderEl.dataset.mixEq) {
      // Use knobToDb conversion for volume and EQ
      const db = knobToDb(val)
      // Format with sign and one decimal place
      const dbStr = db >= 0 ? `+${db.toFixed(1)}` : db.toFixed(1)
      text = `${dbStr} dB`
    } else if (sliderEl.dataset.mixFilter === 'cutoff') {
      // Show frequency
      const hz = knobToFreq(val)
      text = hz >= 1000 ? `${(hz/1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`
    }
    sliderTooltipEl.textContent = text
    // Position tooltip relative to pointer
    const offsetX = 8
    const offsetY = 24
    sliderTooltipEl.style.left = `${pageX + offsetX}px`
    sliderTooltipEl.style.top = `${pageY - offsetY}px`
  }
  // Show tooltip on pointerdown if target is a mixer slider
  document.addEventListener('pointerdown', e => {
    const t = e.target
    if (t && (t.matches('input[data-mix-slider="volume"]') || t.matches('input[data-mix-eq]') || t.matches('input[data-mix-filter="cutoff"]'))) {
      activeSlider = t
      updateSliderTooltip(t, e.pageX, e.pageY)
      if (sliderTooltipEl) sliderTooltipEl.style.opacity = '1'
    }
  })
  // Update tooltip position/value while dragging
  document.addEventListener('pointermove', e => {
    if (activeSlider) {
      updateSliderTooltip(activeSlider, e.pageX, e.pageY)
    }
  })
  // Hide tooltip on pointerup/cancel
  document.addEventListener('pointerup', () => {
    if (sliderTooltipEl) sliderTooltipEl.style.opacity = '0'
    activeSlider = null
  })
  document.addEventListener('pointercancel', () => {
    if (sliderTooltipEl) sliderTooltipEl.style.opacity = '0'
    activeSlider = null
  })

  /*
    -------------------------------------------------------------------------
    Dial plus/minus button handlers

    The volume and endpoint infinite dials are flanked by "−" and "+" buttons.
    These buttons allow fine adjustments without dragging the dial.  Holding
    a button continuously steps the value up or down.  Each button has
    data-dial-type ("volume" or "endpoint"), data-dial-step ("-1" or "1"),
    and data-stem attributes (assigned dynamically for the endpoint dial).
    We register a global listener for pointerdown on these buttons to
    initiate repeated adjustments via setInterval.  Pointerup/cancel
    listeners stop the interval.
  */
  // Track the active timer for continuous dial adjustments
  let dialButtonTimer = null
  // Apply a single adjustment according to the button's attributes
  function applyDialButtonStep(btn) {
    if (!btn) return
    const type = btn.getAttribute('data-dial-type')
    const st   = btn.getAttribute('data-stem')
    const stepAttr = btn.getAttribute('data-dial-step')
    const step = stepAttr ? parseFloat(stepAttr) || 0 : 0
    if (!type || !st || !step) return
    if (type === 'volume') {
      // Adjust volume by 1 unit per step
      const current = stemControlValues[st]?.volume ?? 80
      let newVal = current + step
      newVal = Math.max(0, Math.min(100, newVal))
      setVolumeUnified(st, newVal)
    } else if (type === 'endpoint') {
      // Adjust endpoint factor by a small increment (0.05 per step) to allow fine control
      const current = endpointFactors[st] ?? 1
      const delta = 0.05 * step
      let newVal = current + delta
      newVal = Math.max(0.1, Math.min(3, newVal))
      endpointFactors[st] = newVal
      // Persist this endpoint factor on the active take
      {
        const idx = stemActiveIndex[st]
        if (idx != null && idx >= 0 && stemHistory[st] && stemHistory[st][idx]) {
          stemHistory[st][idx].endpointFactor = newVal
        }
      }
      // Rebuild loop and update preview
      adjustEndpoint(st, newVal)
      const canvas = document.getElementById('waveformEditCanvas')
      if (canvas) {
        const cfg = stemConfigs[st]
        drawWaveform(canvas, stemLoop[st], `rgb(${getColorRGB(cfg.color)})`)
        // Apply current volume scaling to the preview
        const vval = stemControlValues[st]?.volume ?? 80
        canvas.style.transform = `scaleY(${vval / 100})`
      }
    }
  }
  // Start continuous adjustments for a button
  function startDialButtonInterval(btn) {
    applyDialButtonStep(btn)
    dialButtonTimer = setInterval(() => applyDialButtonStep(btn), 150)
  }
  // Stop the continuous adjustment
  function stopDialButtonInterval() {
    if (dialButtonTimer) {
      clearInterval(dialButtonTimer)
      dialButtonTimer = null
    }
  }
  // Global pointerdown to detect clicks on dial buttons
  document.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.dial-btn')
    if (btn) {
      // Prevent default to avoid text selection
      e.preventDefault()
      startDialButtonInterval(btn)
    }
  })
  // Global pointerup/cancel stops continuous adjustments
  document.addEventListener('pointerup', () => stopDialButtonInterval())
  document.addEventListener('pointercancel', () => stopDialButtonInterval())

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
    // If a dial drag has just completed, ignore the immediate click to avoid unintended muting.
    if (dialIgnoreClick) {
      dialIgnoreClick = false
      return
    }

    // Toggle mute/unmute when clicking on an instrument card outside of interactive elements.
    {
      const cardEl = e.target.closest('[data-stem]')
      if (cardEl) {
        // Do not toggle if the click is on a button, an element with a data-action,
        // a form element, or an infinite dial.  This prevents the volume and
        // endpoint dials from muting/unmuting the stem when clicked.
        const isInteractive = e.target.closest('button, [data-action], input, label, select, textarea, .infinite-dial')
        const isWaveform = e.target.closest('.waveform-canvas')
        if (!isInteractive && !isWaveform) {
          const st = cardEl.getAttribute('data-stem')
          if (st) {
            toggleMute(st)
            return
          }
        }
      }
    }

    // Toggle mute/unmute when clicking on a mixer channel outside of interactive elements.
    {
      const mixCardEl = e.target.closest('[data-mix-card]')
      if (mixCardEl) {
        // Prevent toggling if the click is on a slider, button or other interactive element
        const isInteractive = e.target.closest('button, [data-action], input, label, select, textarea, .infinite-dial')
        if (!isInteractive) {
          const st = mixCardEl.getAttribute('data-mix-card')
          if (st) {
            toggleMute(st)
            return
          }
        }
      }
    }
    const btn = e.target.closest('[data-action]')
    if (btn) {
      const action = btn.dataset.action
      const st = btn.dataset.stem
      if (action === 'generate' && st) { await generateStem(st); return }
      // When clicking the new generate button, open the settings modal instead of generating immediately
      if (action === 'open-create-settings' && st) { showGenerateSettingsModal(st); return }
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
        // Custom solo logic: if the stem is muted, soloing will unmute it and
        // remember its previous mute state.  When unsoloing, the previous
        // mute state is restored.  Only one stem can be soloed at a time.
        if (soloedStem === st) {
          // Unsolo: restore previous mute state if stored
          if (prevSoloMuteStates[st] !== undefined) {
            stemMuteStates[st] = prevSoloMuteStates[st]
            delete prevSoloMuteStates[st]
          }
          soloedStem = null
        } else {
          // Solo a new stem: save its current mute state and unmute
          prevSoloMuteStates[st] = stemMuteStates[st]
          stemMuteStates[st] = false
          soloedStem = st
        }
        // Apply volume changes across all stems and update UI
        STEM_ORDER.forEach(name => {
          const vol = (stemControlValues[name]?.volume ?? 80) / 100
          let target
          if (soloedStem) {
            // When soloed, mute all other stems.  The soloed stem respects its mute state.
            target = (name === soloedStem) ? (stemMuteStates[name] ? 0 : vol) : 0
          } else {
            // When no stem is soloed, honour each stem's mute state
            target = stemMuteStates[name] ? 0 : vol
          }
          const n = stemNodes[name]
          if (n?.gain) {
            const p = n.gain.gain, t = audioContext.currentTime
            p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(target, t + 0.01)
          }
          // Reflect button states even for stems without audio nodes so visual feedback
          // appears on the instrument cards and mixer.
          reflectMuteSoloButtons(name)
          updateMixerGlow(name)
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
      const cw = e.target.closest('.waveform-canvas')
      if (cw?.dataset.stem) {
        // Open the waveform edit modal instead of toggling an overlay or
        // opening the history drawer.  This modal allows the user to
        // adjust volume and endpoint with full controls and save/discard.
        openWaveformEditModal(cw.dataset.stem)
        return
      }
      const takeBtn = e.target.closest('[data-take-index]')
      if (takeBtn) {
        const st = takeBtn.getAttribute('data-stem')
        const idx = parseInt(takeBtn.getAttribute('data-take-index'), 10)
        selectStemVersion(st, idx)
        updateMixerGlow(st)
        return
      }
    }
  })

  // Handle input events on waveform dial sliders (volume and endpoint).  When the
  // user interacts with these range inputs, adjust the corresponding stem
  // parameters and update the visuals/audio.  We use a single listener on
  // the document to catch changes on dynamically created sliders.
  document.addEventListener('input', e => {
    const target = e.target
    if (!target || !target.getAttribute) return
    const action = target.getAttribute('data-action')
    const st     = target.getAttribute('data-stem')
    if (!st || !action) return
    if (action === 'adjust-volume') {
      handleVolumeSlider(st, target.value)
    } else if (action === 'adjust-endpoint') {
      handleEndpointSlider(st, target.value)
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
  if (!takes.length) { list.innerHTML = `<div class="text-xs text-white/60 px-2 py-6">No takes yet. Create some!</div>`; return }
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
  // Restore the saved endpoint factor for this take (if present).  If not present, default to 1.
  {
    const takes = stemHistory[st] || []
    const entry = takes[index]
    const factor = entry?.endpointFactor ?? 1
    endpointFactors[st] = factor
    // Rebuild the loop with the stored factor
    adjustEndpoint(st, factor)
  }
  // No need to reset or update obsolete overlay slider inputs, since endpoint control is now via infinite dial.
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

  // Create tooltip element for mixer sliders if it does not already exist
  if (!sliderTooltipEl) {
    sliderTooltipEl = document.createElement('div')
    sliderTooltipEl.id = 'sliderTooltip'
    sliderTooltipEl.className = 'fixed z-50 px-2 py-0.5 rounded bg-black/80 text-white text-[10px] pointer-events-none opacity-0 transition-opacity duration-75'
    document.body.appendChild(sliderTooltipEl)
  }

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
  // Present the session setup modal if settings have not been chosen
  // yet.  This ensures the user sets the master tempo, bars and key
  // before generating any stems.  The modal will only appear once
  // per session.
  showSessionSetupModal()
  console.log('✅ App ready (session ' + SESSION_TAG + ')')
}

export async function initApp(){
  console.log('🎬 Initializing App Navigation System…')
  setupNavigationListeners()
  // Start directly on the genre selection page instead of the login page
  showPage('selection-page')
  window.lucide?.createIcons()
  setupHelpModal()
  console.log('✅ Navigation system ready')
}

// -----------------------------------------------------------------------------
// UI Overrides
// These overrides adjust the behaviour and appearance of certain controls.
// 1) headerActionButtonsHTML: replace the solo icon with a simple 'S' label.
// 2) headerActionButtonsMobileHTML: on small screens, action buttons fill the card's width
//    and the solo button uses 'S'.

function customHeaderActionButtonsHTML(st) {
  return `\n        <div class="flex items-center gap-1.5">\n          <button class="sg-toggle w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="mute-stem" data-stem="${st}" title="Mute/Unmute" aria-pressed="false">\n            <i data-lucide="volume-2" class="w-4 h-4"></i>\n          </button>\n          <button class="sg-toggle w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="solo-stem" data-stem="${st}" title="Solo" aria-pressed="false">\n            <span class="font-bold text-sm">S</span>\n          </button>\n          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-stem="${st}" title="Favorite (coming soon)">\n            <i data-lucide="heart" class="w-4 h-4"></i>\n          </button>\n          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="download-stem" data-stem="${st}" title="Download">\n            <i data-lucide="download" class="w-4 h-4"></i>\n          </button>\n        </div>\n      `;
}

function customHeaderActionButtonsMobileHTML(st) {
  return `\n        <div class="flex w-full items-center gap-1 sm:hidden mt-1">\n          <button class="sg-toggle flex-1 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="mute-stem" data-stem="${st}" title="Mute/Unmute" aria-pressed="false">\n            <i data-lucide="volume-2" class="w-3 h-3"></i>\n          </button>\n          <button class="sg-toggle flex-1 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="solo-stem" data-stem="${st}" title="Solo" aria-pressed="false">\n            <span class="font-bold text-[10px]">S</span>\n          </button>\n          <button class="flex-1 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-stem="${st}" title="Favorite (coming soon)">\n            <i data-lucide="heart" class="w-3 h-3"></i>\n          </button>\n          <button class="flex-1 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="download-stem" data-stem="${st}" title="Download">\n            <i data-lucide="download" class="w-3 h-3"></i>\n          </button>\n        </div>\n      `;
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
    // Disable body scroll while help modal is open
    document.body.style.overflow = 'hidden'
  }
  function closeModal(){
    helpModal.style.opacity = '0'
    setTimeout(() => {
      helpModal.classList.add('hidden')
      // Restore body scroll when help modal is closed
      document.body.style.overflow = ''
    }, 300)
  }
  if (helpBtn) helpBtn.addEventListener('click', openModal)
  if (overlay) overlay.addEventListener('click', closeModal)
  if (closeBtn) closeBtn.addEventListener('click', closeModal)
}

// -----------------------------------------------------------------------------
// Note: The default headerActionButtonsMobileHTML defined earlier is retained.
// Custom layouts are implemented via customHeaderActionButtonsMobileHTML and used
// directly in createBuilderStemCard.  Duplicate overrides were removed to
// prevent redeclaration errors.

// Assign the default header action button helpers to our custom implementations.
// This ensures any call sites referencing headerActionButtonsHTML or
// headerActionButtonsMobileHTML will use the versions that replace the
// headphone icon with a plain "S" label and provide full-width buttons on mobile.
headerActionButtonsHTML = customHeaderActionButtonsHTML;
headerActionButtonsMobileHTML = customHeaderActionButtonsMobileHTML;

/* =========================================================
   Generate settings modal helpers
   When the user taps the Generate button on a stem card, we show a popup
   with all control sliders and toggles for that stem.  After the user
   clicks Start, we update stemControlValues and trigger generation.
   ========================================================= */

// Build the inner HTML for the generate settings modal.  Each control
// defined on the stem config (except volume) becomes a slider or checkbox.
function buildGenerateSettingsContent(st) {
  let html = ''
  const cfg = stemConfigs[st] || {}
  const controls = cfg.controls || {}
  const values = stemControlValues[st] || {}
  for (const [key, c] of Object.entries(controls)) {
    if (key === 'volume') continue // volume is controlled in the mixer
    const val = values[key] ?? c.default
    if (c.type === 'knob') {
      // Use a taller track for mobile (h-3) and add touch-action-none to prevent page scrolling while dragging.
      html += `<div class="flex items-center gap-2">\n` +
              `  <label class="w-24 shrink-0 text-xs text-white/80">${c.label}</label>\n` +
              // Make sliders taller on mobile for easier dragging.  Use h-4 on small screens and h-2 on larger screens.
              `  <input type="range" data-gen-control="${key}" data-unit="${c.unit || ''}" min="${c.min}" max="${c.max}" value="${val}" step="1" class="flex-1 h-4 sm:h-2 bg-white/10 rounded-lg cursor-pointer touch-action-none">\n` +
              `  <span class="text-xs w-8 text-right">${val}${c.unit || ''}</span>\n` +
              `</div>`
    } else if (c.type === 'toggle') {
      const checked = val ? 'checked' : ''
      html += `<label class="flex items-center gap-2 text-xs text-white/90">\n` +
              `  <input type="checkbox" data-gen-control="${key}" ${checked} class="w-4 h-4 rounded border-white/40 bg-transparent">\n` +
              `  <span>${c.label}</span>\n` +
              `</label>`
    }
  }
  return html
}

// Show the generate settings modal for the given stem
function showGenerateSettingsModal(st) {
  currentGenerateStem = st
  const modal = document.getElementById('generateSettingsModal')
  const content = document.getElementById('generateSettingsContent')
  if (modal && content) {
    content.innerHTML = buildGenerateSettingsContent(st)
    modal.classList.remove('hidden')
    requestAnimationFrame(() => { modal.style.opacity = '1' })

    // Reset start and cancel buttons to their default state whenever the modal is shown.
    const startBtn = document.getElementById('generateSettingsStartBtn')
    const cancelBtn = document.getElementById('generateSettingsCancelBtn')
    if (startBtn) {
      startBtn.disabled = false
      // Restore the original label if stored, else default to "Start"
      const orig = startBtn.dataset.originalLabel
      startBtn.innerHTML = orig || 'Start'
    }
    if (cancelBtn) {
      cancelBtn.disabled = false
    }
    // Disable body scrolling while any generate settings modal is open
    document.body.style.overflow = 'hidden'
  }
}

// Hide the generate settings modal
function hideGenerateSettingsModal() {
  const modal = document.getElementById('generateSettingsModal')
  if (modal) {
    modal.style.opacity = '0'
    setTimeout(() => {
      modal.classList.add('hidden')
    }, 200)
  }
  currentGenerateStem = null
  // Re-enable body scrolling when the generate settings modal is hidden
  document.body.style.overflow = ''
}

// Apply the settings from the modal to the current stem and trigger generation
async function applyGenerateSettingsAndStart() {
  const st = currentGenerateStem
  if (!st) return
  const content = document.getElementById('generateSettingsContent')
  if (content) {
    const inputs = content.querySelectorAll('[data-gen-control]')
    inputs.forEach(input => {
      const key = input.getAttribute('data-gen-control')
      if (!key) return
      if (input.type === 'range') {
        const val = parseInt(input.value, 10)
        stemControlValues[st][key] = val
      } else if (input.type === 'checkbox') {
        stemControlValues[st][key] = input.checked
      }
    })
  }
  // Provide feedback on the start and cancel buttons while generation is being scheduled.  Disable
  // both buttons and show a spinner on the start button.
  const startBtn = document.getElementById('generateSettingsStartBtn')
  const cancelBtn = document.getElementById('generateSettingsCancelBtn')
  if (startBtn) {
    startBtn.disabled = true
    // Preserve original label so we can restore it later if needed
    if (!startBtn.dataset.originalLabel) {
      startBtn.dataset.originalLabel = startBtn.innerHTML
    }
    startBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 loading-spin"></i>`
    window.lucide?.createIcons()
  }
  if (cancelBtn) {
    cancelBtn.disabled = true
  }
  hideGenerateSettingsModal()
  // Trigger generation for this stem
  await generateStem(st)
}

/* =========================================================
   Session Setup Modal
   ========================================================= */
// Display the session setup modal on page load.  If session settings have
// already been chosen (sessionSetupDone === true), the modal will not
// appear.  When the user confirms their selections, the values are
// stored in stemControlValues.master and the bottom controls are
// disabled accordingly.  The selected values persist for the
// remainder of the session.
function showSessionSetupModal() {
  if (sessionSetupDone) return
  const modal = document.getElementById('sessionSetupModal')
  if (!modal) return
  const overlay = document.getElementById('sessionSetupOverlay')
  const tempoSlider = document.getElementById('setupTempoSlider')
  const tempoValue = document.getElementById('setupTempoValue')
  const barsSelector = document.getElementById('setupBarsSelector')
  const rootSelector = document.getElementById('setupRootSelector')
  const accidentalSelector = document.getElementById('setupAccidentalSelector')
  const modeSelector = document.getElementById('setupModeSelector')
  const cancelBtn = document.getElementById('setupCancelBtn')
  const saveBtn = document.getElementById('setupSaveBtn')
  if (!tempoSlider || !tempoValue || !barsSelector || !rootSelector || !accidentalSelector || !modeSelector || !cancelBtn || !saveBtn) return
  // Update displayed tempo when slider moves
  tempoSlider.addEventListener('input', e => {
    const val = Math.round(Number(e.target.value) || DEFAULT_TEMPO)
    tempoValue.textContent = String(val)
  })
  // Cancel button closes modal without locking settings
  cancelBtn.addEventListener('click', () => {
    modal.style.opacity = '0'
    setTimeout(() => { modal.classList.add('hidden') }, 300)
    // Restore page scrolling when the session setup modal is closed
    document.body.style.overflow = ''
  })
  // Save button applies settings and locks them
  saveBtn.addEventListener('click', () => {
    const tempoVal = Math.round(Number(tempoSlider.value) || DEFAULT_TEMPO)
    const barsVal = parseInt(barsSelector.value, 10) || DEFAULT_BARS
    const rootText = String(rootSelector.value || 'A')
    // Determine base letter and accidental from the root selection
    let rootBase = rootText.replace(/[♯♭]/g, '').toUpperCase()
    const selectedAccidental = accidentalSelector.value
    const modeVal = String(modeSelector.value || 'Minor')
    // Set master values
    stemControlValues.master.tempo = tempoVal
    stemControlValues.master.bars = barsVal
    stemControlValues.master.rootBase = rootBase
    stemControlValues.master.accidental = selectedAccidental
    stemControlValues.master.mode = modeVal
    sessionSetupDone = true
    applySessionSettingsToUI()
    // Hide modal
    modal.style.opacity = '0'
    setTimeout(() => { modal.classList.add('hidden') }, 300)
    // Restore page scrolling when the session setup modal is closed
    document.body.style.overflow = ''
  })
  // Show the modal
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.style.opacity = '1'
  })
  // Disable page scrolling while the session setup modal is visible
  document.body.style.overflow = 'hidden'
}

// Apply the session settings to the UI: update the bottom controls
// with the locked values and disable them so the user cannot modify
// them mid-session.  Also refresh the tempo indicators on the
// waveform cards and update the history drawer where needed.
function applySessionSettingsToUI() {
  const master = stemControlValues.master
  // If any of the old master controls exist (tempo, bars, key selectors), disable them and set their values.
  // This keeps compatibility in case those elements are still present in the DOM for other generators.
  const tempoSlider = document.getElementById('tempoSlider')
  const tempoValueEl = document.getElementById('tempoValue')
  if (tempoSlider) {
    tempoSlider.value = String(master.tempo)
    tempoSlider.disabled = true
  }
  if (tempoValueEl) {
    tempoValueEl.textContent = String(master.tempo)
  }
  const barsSelector = document.getElementById('barsSelector')
  if (barsSelector) {
    barsSelector.value = String(master.bars)
    barsSelector.disabled = true
  }
  const rootSelector = document.getElementById('rootSelector')
  const accidentalSelector = document.getElementById('accidentalSelector')
  const modeSelector = document.getElementById('modeSelector')
  if (rootSelector) {
    let rootDisplay = master.rootBase
    if (master.accidental === 'sharp') rootDisplay += '#'
    else if (master.accidental === 'flat') rootDisplay += 'b'
    rootSelector.value = rootDisplay
    rootSelector.disabled = true
  }
  if (accidentalSelector) {
    accidentalSelector.value = master.accidental
    accidentalSelector.disabled = true
  }
  if (modeSelector) {
    modeSelector.value = master.mode
    modeSelector.disabled = true
  }
  // Update the session info card in the player bar.
  const infoEl = document.getElementById('sessionInfoText')
  const infoElMob = document.getElementById('sessionInfoTextMobile')
  const infoString = (() => {
    const rootName = getRootText()
    return `${master.tempo} BPM • ${master.bars} bars • ${rootName} ${master.mode}`
  })()
  if (infoEl) infoEl.textContent = infoString
  if (infoElMob) infoElMob.textContent = infoString
  // Refresh tempo indicators on all cards
  STEM_ORDER.forEach(st => {
    updateTempoIndicator(st)
  })
}

/* =========================================================
   Infinite Dial Controls

   These handlers implement an infinite horizontal dial for adjusting
   per-stem parameters such as volume on the card and endpoint
   stretch in the edit modal.  The dial responds to pointer drags
   and mouse wheel events.  It displays a repeating tick pattern
   that scrolls horizontally when the dial is moved, and a central
   marker to indicate the neutral position.  When the dial is
   adjusted, the corresponding stem control is updated immediately
   in the audio engine and any relevant UI.
========================================================= */

// Internal state for the currently active dial interaction.  When
// active is true, the pointermove handler computes deltas from the
// stored start position and value.  patternOffset tracks the
// horizontal shift of the dial's background pattern in pixels.
const dialState = {
  active: false,
  dial: null,
  type: '',
  stem: '',
  startX: 0,
  startVal: 0,
  patternOffset: 0
}

// When a user drags a dial and releases the pointer, a click event
// often fires on whatever element the pointer is over at the time of
// release.  This can cause accidental mute/unmute when the dial is
// positioned over a card.  Use this flag to ignore the next click
// after finishing a dial drag.
let dialIgnoreClick = false

function handleDialPointerDown(e) {
  // Only initiate a dial drag on elements with the .infinite-dial class
  const dial = e.target.closest('.infinite-dial')
  if (!dial) return
  const type = dial.getAttribute('data-dial-type')
  const st   = dial.getAttribute('data-stem')
  if (!type || !st) return
  dialState.active = true
  dialState.dial = dial
  dialState.type = type
  dialState.stem = st
  dialState.startX = e.clientX
  if (type === 'volume') {
    dialState.startVal = stemControlValues[st]?.volume ?? 80
  } else if (type === 'endpoint') {
    dialState.startVal = endpointFactors[st] ?? 1
  } else {
    dialState.startVal = 0
  }
  // patternOffset is stored on the dial element; parse or fallback to 0
  const offAttr = dial.getAttribute('data-offset')
  dialState.patternOffset = offAttr ? parseFloat(offAttr) || 0 : 0
  // Capture pointer move/up on the window to continue tracking outside the dial
  window.addEventListener('pointermove', handleDialPointerMove)
  window.addEventListener('pointerup', handleDialPointerUp)
  // Prevent text selection and other default behaviours
  e.preventDefault()
  // Reset the ignore click flag: starting a drag means any upcoming click should be processed normally
  dialIgnoreClick = false
}

function handleDialPointerMove(e) {
  if (!dialState.active) return
  const dx = e.clientX - dialState.startX
  let newVal = dialState.startVal
  if (dialState.type === 'volume') {
    // Sensitivity factor for volume adjustments.  Smaller values
    // produce finer control; larger values accelerate the change.
    const sensitivity = 0.2
    newVal = dialState.startVal + dx * sensitivity
    // Clamp between 0 and 100
    newVal = Math.max(0, Math.min(100, newVal))
    setVolumeUnified(dialState.stem, newVal)
  } else if (dialState.type === 'endpoint') {
    // Finer sensitivity for endpoint adjustments.  A small delta
    // produces a small change to the stretch factor.
    const sensitivity = 0.005
    newVal = dialState.startVal + dx * sensitivity
    newVal = Math.max(0.1, Math.min(3, newVal))
    endpointFactors[dialState.stem] = newVal
    // Persist this endpoint factor on the active take so switching takes remembers the adjustment
    {
      const stName = dialState.stem
      const idx = stemActiveIndex[stName]
      if (idx != null && idx >= 0 && stemHistory[stName] && stemHistory[stName][idx]) {
        stemHistory[stName][idx].endpointFactor = newVal
      }
    }
    // Rebuild loop for the new factor and redraw the card waveform
    adjustEndpoint(dialState.stem, newVal)
    // Update preview waveform in the edit modal
    const canvas = document.getElementById('waveformEditCanvas')
    if (canvas) {
      const cfg = stemConfigs[dialState.stem]
      drawWaveform(canvas, stemLoop[dialState.stem], `rgb(${getColorRGB(cfg.color)})`)
      // Apply the current volume scaling to the preview canvas only
      const volVal = stemControlValues[dialState.stem]?.volume ?? 80
      canvas.style.transform = `scaleY(${volVal / 100})`
    }
  }
  // Update pattern offset for the tick marks.  To keep the offset
  // bounded, wrap it by the pattern width (8 px).  This ensures the
  // background-position stays within a manageable range while still
  // conveying continuous movement.
  const patternWidth = 8
  const newOffset = dialState.patternOffset + dx
  dialState.patternOffset = ((newOffset % patternWidth) + patternWidth) % patternWidth
  // Set the dial background position and persist offset on the element
  dialState.dial.style.backgroundPosition = `${dialState.patternOffset}px 50%`
  dialState.dial.setAttribute('data-offset', String(dialState.patternOffset))
  // Prepare for next move: reset the starting point and value
  dialState.startX = e.clientX
  dialState.startVal = newVal
}

function handleDialPointerUp() {
  if (!dialState.active) return
  dialState.active = false
  window.removeEventListener('pointermove', handleDialPointerMove)
  window.removeEventListener('pointerup', handleDialPointerUp)

  // After releasing the dial, ignore the next click event to prevent
  // accidental mute/unmute when the pointer is over a non-interactive area
  dialIgnoreClick = true
}

function handleDialWheel(e) {
  // Respond to wheel events on a dial to allow quicker adjustments.
  const dial = e.target.closest('.infinite-dial')
  if (!dial) return
  const type = dial.getAttribute('data-dial-type')
  const st   = dial.getAttribute('data-stem')
  if (!type || !st) return
  let currentVal, newVal
  if (type === 'volume') {
    currentVal = stemControlValues[st]?.volume ?? 80
    // Each wheel step adjusts the volume by a small amount; deltaY is inverted
    newVal = currentVal - e.deltaY * 0.2
    newVal = Math.max(0, Math.min(100, newVal))
    setVolumeUnified(st, newVal)
  } else if (type === 'endpoint') {
    currentVal = endpointFactors[st] ?? 1
    newVal = currentVal - e.deltaY * 0.01
    newVal = Math.max(0.1, Math.min(3, newVal))
    endpointFactors[st] = newVal
    adjustEndpoint(st, newVal)
    // Update preview waveform if visible
    const canvas = document.getElementById('waveformEditCanvas')
    if (canvas) {
      const cfg = stemConfigs[st]
      drawWaveform(canvas, stemLoop[st], `rgb(${getColorRGB(cfg.color)})`)
      const volVal = stemControlValues[st]?.volume ?? 80
      canvas.style.transform = `scaleY(${volVal / 100})`
    }
  }
  // Advance the tick pattern offset so the dial visually moves with the scroll
  const offAttr = dial.getAttribute('data-offset')
  let off = offAttr ? parseFloat(offAttr) || 0 : 0
  off += -e.deltaY
  const patternWidth = 8
  off = ((off % patternWidth) + patternWidth) % patternWidth
  dial.style.backgroundPosition = `${off}px 50%`
  dial.setAttribute('data-offset', String(off))
  // Prevent the page from scrolling when interacting with the dial
  e.preventDefault()
}

// Global listeners for dial interactions
document.addEventListener('pointerdown', handleDialPointerDown)
document.addEventListener('wheel', handleDialWheel, { passive: false })