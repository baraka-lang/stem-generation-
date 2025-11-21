// Centralized configuration and constants for the AI Techno Generator
// Keep logic identical to original app.js values

/* =========================================================
   Feature flags / Env toggles
   ========================================================= */
export const USE_COMPOSITION_PLAN = String(import.meta.env.VITE_ELEVEN_USE_PLAN || 'false').toLowerCase() === 'true'
export const PRIMARY_OUTPUT_FORMAT = 'pcm_44100'
export const FALLBACK_OUTPUT_FORMAT = 'mp3_44100_128'

/* =========================================================
   Generation format (server)
   ========================================================= */
export const PRO_FORMAT = PRIMARY_OUTPUT_FORMAT

/* =========================================================
   UX flags
   ========================================================= */
export const PROMPTS_MODE = 'builder' // 'builder' | 'freeform'

/* =========================================================
   Transport / DSP constants
   ========================================================= */
export const TEMPO_MIN = 110
export const TEMPO_MAX = 140
export const DEFAULT_TEMPO = 130
export const DEFAULT_BARS  = 2

export const START_ENV_MS   = 5
// Increase ramp and crossfade durations to minimise audible clicks at loop
// boundaries.  A longer fade-in/out and crossfade smooths the transition
// when the loop restarts, reducing the chance of hearing a click.
export const EDGE_RAMP_MS   = 8
export const LOOP_XFADE_MS  = 24
export const ALIGN_SEARCH_MS = 45
export const ZERO_FALLBACK_SAMPLES = 384

export const BOUNDARY_LOOKAHEAD_MS = 120
export const GEN_TAIL_PAD_MS = 200

/* =========================================================
   EQ‑3 + Filter defaults
   ========================================================= */
export const EQ_MIN_DB = -80
export const EQ_MAX_DB =  +6
export const EQ_DEFAULT = 50
export const EQ_SMOOTH_TC = 0.02

export const EQ_LOW_FREQ  = 180
export const EQ_MID_FREQ  = 2200
export const EQ_MID_Q     = 1.20
export const EQ_HIGH_FREQ = 6500

export const FILTER_MIN_HZ = 40
export const FILTER_MAX_HZ = 18000
export const FILTER_Q = 0.707
export const FILTER_SMOOTH_TC = 0.02
export const FILTER_DEFAULT_HZ = 12000 // 12 kHz default