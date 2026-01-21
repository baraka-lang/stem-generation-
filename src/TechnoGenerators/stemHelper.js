// Centralized stem helper utilities
// Shared across app.js and TechnoGenerators prompt builders

// Import shared constants for defaults
import { DEFAULT_BARS } from '../Config/constants.js'

export function scaleKnob(v, a, b, c, d, e) {
  const x = Number(v ?? 50)
  if (x <= 20) return a
  if (x <= 40) return b
  if (x <= 60) return c
  if (x <= 80) return d
  return e
}

export function mapArpRate(v) {
  const x = Number(v ?? 55)
  return x <= 33 ? '1/8 notes' : x <= 66 ? '1/16 notes' : '1/32 notes'
}

// Additional stem-related helpers centralized from app.js
export function roleDirectives(st, c, bars) {
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
      c.rumble ? 'Rumble: deep sub tail under 50 Hz; subtle' : 'Rumble: none',
      'Exclude: fills/intro flam/crashes'
    ].join('. ')
    case 'bass': return [
      'ROLE: single isolated bass only',
      'Harmony: strictly diatonic in project key (no chromatic notes)',
      'Pitch: root + fifth primarily; occasional octave',
      `Movement: ${scaleKnob(c.movement, 'static','simple','groovy','animated','busy')} repeating per bar`,
      `Depth: ${scaleKnob(c.depth, 'light','medium','deep','deeper','subby')} low-end; controlled release`,
      `Attack: ${scaleKnob(c.attack, 'soft','moderate','distinct','sharp','percussive')}`,
      `Tone: ${scaleKnob(c.tone, 'dark','warm','balanced','bright','acidic')}`,
      `Sub: ${scaleKnob(c.sub, 'minimal','moderate','full','deep','subsonic')} content`,
      c.filter ? 'Filter: subtle motion within bar; reset each bar' : 'Filter: stable',
      c.distortion ? 'Distortion: mild analog saturation; no heavy clipping' : 'Distortion: none',
      'Start note on beat 1; no slides across seam'
    ].join('. ')  
    case 'lead': {
      const barCount = Math.max(1, (bars ?? DEFAULT_BARS))
      return [
        'ROLE: single isolated lead synth only',
        'Melody: strictly diatonic; avoid chromatic passing tones',
        `Phrase length evenly divides ${barCount} bar(s)`,
        `Complexity: ${scaleKnob(c.complexity, 'simple','moderate','interesting','intricate','ornate')} (quantized)`,
        `Brightness: ${scaleKnob(c.brightness, 'dark','mellow','balanced','bright','very bright')}`,
        `Motion: ${scaleKnob(c.motion, 'static','gentle','flowing','evolving','chaotic')}`,
        `Attack: ${scaleKnob(c.attack, 'soft','moderate','plucky','sharp','percussive')}`,
        `Range: ${scaleKnob(c.range, 'narrow','one octave','two octaves','three octaves','wide')}`,
        c.delay ? 'Delay: minimal tempo-synced; cut at bar end' : 'Delay: off',
        c.chorus ? 'Chorus: subtle stereo spread; no detune at seam' : 'Chorus: off',
        'No bends/slides across loop seam'
      ].join('. ')
    }
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
    // New instrument roles
    case 'hihat': return [
      'ROLE: isolated closed hi-hat only (no open-hat)',
      `Pattern: ${scaleKnob(c.pattern, 'straight 1/16','slight shuffle 1/16','moderate syncopation','complex syncopation','polyrhythmic accents')}`,
      `Length: ${scaleKnob(c.decay, '30–80ms','60–120ms','100–180ms','150–250ms','250–400ms')}`,
      `Tone: ${scaleKnob(c.brightness, 'dark','balanced','crisp','bright','very bright')}`,
      `Texture: ${scaleKnob(c.texture, 'soft','dry','balanced','crisp','metallic')}`,
      `Swing: ${scaleKnob(c.shuffle, 'straight','light shuffle','moderate shuffle','noticeable shuffle','heavy shuffle')}`,
      `FX: ${(c.reverb ? 'tiny room (gated)' : 'dry')}; ${(c.chorus ? 'subtle chorus' : 'no chorus')}`
    ].join('. ')
    case 'arp': {
      const barCount = Math.max(1, (bars ?? DEFAULT_BARS))
      return [
        'ROLE: isolated synthesizer arpeggio; strictly diatonic in project key; no chords',
        `Pattern: ${mapArpRate(c.rate)}; ${scaleKnob(c.swing, 'straight','slight swing','moderate swing','pronounced swing','syncopated')}; phrase length evenly divides ${barCount} bar(s)`,
        `Complexity: ${scaleKnob(c.complexity, 'simple','moderate','interesting','intricate','ornate')}`,
        `Range: ${scaleKnob(c.range, 'narrow','one octave','two octaves','three octaves','wide')}`,
        `Tone: ${scaleKnob(c.tone, 'dark','warm','balanced','bright','sparkling')}`,
        `Envelope: ${c.gate ? 'long-ish gate (80–160 ms)' : 'short gate (30–80 ms)'}`,
        `FX: ${c.delay ? 'subtle tempo-synced delay (gated at seam)' : 'no delay'}`
      ].join('. ')
    }
    case 'fx': return [
      'ROLE: bar-contained techno FX bed (whooshes/sweeps/noise) that resets each bar; no pitched melody',
      `Intensity: ${scaleKnob(c.intensity, 'subtle','moderate','medium','strong','intense')}`,
      `Movement: ${scaleKnob(c.movement, 'static','gentle motion','evolving','animated','dynamic')}`,
      `Texture: ${scaleKnob(c.texture, 'soft','grainy','noisy','harsh','metallic')}`,
      `Sweep: ${scaleKnob(c.sweep, 'none','small','medium','large','very large')}`,
      `Filter: ${scaleKnob(c.filter, 'closed','narrow','balanced','open','very open')}`,
      `Space: ${c.reverb ? 'small room; short decay; gate tails' : 'dry'}`,
      `Delay: ${c.delay ? 'light tempo-synced echoes; stop at seam' : 'off'}`
    ].join('. ')
    case 'perc': return [
      'ROLE: isolated electronic snare only',
      'Pattern: hits exactly on beats 2 and 4 of every bar (no ghost notes or rolls)',
      `Intensity: ${scaleKnob(c.intensity, 'low','moderate','medium','strong','very strong')}`,
      `Snap: ${scaleKnob(c.snap, 'soft','medium-soft','balanced','sharp','cracking')}`,
      `Tail: ${scaleKnob(c.decay, 'very short','short','medium','long','very long')}`,
      `Tone: ${scaleKnob(c.tone, 'thin','dry','balanced','full','deep')}`,
      `Timbre: ${c.metallic ? 'slightly metallic; tight transient' : 'organic and dry'}`,
      `Variation: ${scaleKnob(c.variation, 'no variation','very subtle variation','subtle variation','light variation','moderate variation')} but positions remain 2 & 4`,
      `Space: ${c.reverb ? 'tiny room; decay < 150 ms; gate tails before seam' : 'dry; short decay; no tail'}`
    ].join('. ')
    case 'perc2': return [
      'ROLE: quantized top percussion accents (shakers/blocks/taps); not snare/hat/kick',
      `Density: ${scaleKnob(c.density, 'sparse','light','medium','busy','dense')}`,
      `Groove: ${scaleKnob(c.groove, 'straight','straight with mild syncopation','syncopated but quantized','complex yet quantized','complex yet quantized')}`,
      `Variation: ${scaleKnob(c.variation, 'repetitive','subtle','moderate','intricate','wild')}`,
      `Tone: ${scaleKnob(c.tone, 'dark','warm','balanced','bright','metallic')}`,
      `Syncopation: ${scaleKnob(c.syncopation, 'straight','mild','groovy','complex','polyrhythmic')}`,
      `Timbre: ${c.metallic ? 'slightly metallic allowed' : 'organic preferred'}`,
      `Space: ${c.reverb ? 'tiny room; gate before seam' : 'dry; no reverb'}`
    ].join('. ')
    default: return 'ROLE: single isolated instrument only'
  }
}

export function negatives(st) {
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