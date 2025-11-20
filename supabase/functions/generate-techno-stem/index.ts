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
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'true'
};
// Stem base descriptions used in prompt construction.  Only the
// basePrompt fields are required here; other UI‑related metadata is
// omitted.
const stemConfigs = {
  kick: {
    basePrompt: 'deep TR-909 style techno kick drum'
  },
  perc: {
    basePrompt: 'industrial TR-909 techno snare'
  },
  bass: {
    basePrompt: 'dark techno bassline'
  },
  lead: {
    basePrompt: 'hypnotic techno lead synth'
  },
  hihat: {
    basePrompt: 'crisp TR-909 closed hi-hat'
  },
  pad: {
    basePrompt: 'ambient techno pad'
  },
  arp: {
    basePrompt: 'techno synthesizer arpeggio'
  },
  fx: {
    basePrompt: 'techno transition effects and atmos'
  },
  perc2: {
    basePrompt: 'techno top percussion loop'
  }
};
// Scale a knob value (0–100) into one of five descriptive strings.
function scaleKnob(v, a, b, c, d, e) {
  const x = Number(v ?? 50);
  if (x <= 20) return a;
  if (x <= 40) return b;
  if (x <= 60) return c;
  if (x <= 80) return d;
  return e;
}
// Build a global scaffold for all stems.  This emphasises strict
// adherence to tempo and bar length and instructs the model to
// generate exactly the requested number of bars at a fixed BPM.
function globalScaffold({ tempo, bars, root, mode }) {
  const barDurationMs = Math.round((bars * 4 * 60 * 1000) / tempo);
  const beatDurationMs = Math.round((60 * 1000) / tempo);
  return [
    'Genre: modern techno (Berlin style; precise, mechanical, unwavering)',
    'Reference: Surgeon, Richie Hawtin, Ben Klock production aesthetic',
    'TimeSignature: 4/4 strict (absolutely zero swing; pure quantized grid)',
    `Tempo: LOCKED at ${tempo}.00 BPM (microsecond-precise timing; crystal-locked clock)`,
    `MetronomeTiming: Each beat must occur exactly every ${beatDurationMs}ms; zero deviation permitted`,
    `Length: EXACTLY ${bars} bars (total duration: ${barDurationMs}ms ± 0ms tolerance)`,
    `Key: ${root} ${mode} (strictly diatonic; no chromatic notes; no modulation; no key drift)`,
    'Start: hard sync to bar 1 beat 1 at sample 0 (no pre-roll; no fade-in; no silence; no count-in)',
    `End: hard stop at bar ${bars} beat 4 end (no tail; no reverb bleed; no delay spill; no sustain)`,
    'Loop: phase-coherent seamless boundary (waveform must match at loop points)',
    'DrumPalette: Roland TR-909 circuit emulation; dry; punchy; zero bleed between stems',
    'Quantization: perfect grid alignment (every note snaps to nearest 1/128th note; no groove; no humanization)',
    'Timing: industrial precision (robotic; mechanical; no feel; no swing; no shuffle)',
    'Delivery: solo instrument only (completely isolated; no other sounds; instrumental only)',
    // Absolute directives with multiple reinforcement
    `ABSOLUTE_RULE_1: Total audio duration MUST equal exactly ${barDurationMs}ms (${bars} bars at ${tempo} BPM)`,
    `ABSOLUTE_RULE_2: Tempo MUST remain locked at ${tempo}.00 BPM throughout with ZERO drift or acceleration`,
    `ABSOLUTE_RULE_3: All rhythmic events MUST align to perfect grid with NO off-grid hits`,
    `CRITICAL: This is a loop that MUST repeat seamlessly; verify phase alignment at boundaries`
  ].join('. ');
}
// Map a knob value to a rhythmic rate for arpeggiators.
function mapArpRate(v) {
  const x = Number(v ?? 55);
  return x <= 33 ? '1/8 notes' : x <= 66 ? '1/16 notes' : '1/32 notes';
}
// Root text helper (combines root base and accidental).
function getRootText(master) {
  const base = master.rootBase || 'A';
  const acc = master.accidental || 'natural';
  if (acc === 'sharp') return `${base}#`;
  if (acc === 'flat') return `${base}b`;
  return base;
}
// Role directives per stem.  These describe the expected pattern,
// articulation and tone for each stem type.  They rely on the control
// values passed from the client.
function roleDirectives(st, c) {
  switch(st){
    case 'kick':
      return [
        'ROLE: single isolated kick only (Roland TR-909 voicing)',
        'Pattern: four-on-the-floor; exactly one kick hit on beats 1, 2, 3 and 4 of every bar (no extra hits)',
        'Pitch: unpitched; no tonal sub notes or toms; no tonal drops',
        `Decay: ${scaleKnob(c.decay, 'very short', 'short', 'medium', 'long', 'very long')}`,
        `Punch: ${scaleKnob(c.punch, 'soft', 'firm', 'punchy', 'very punchy', 'aggressive')}`,
        c.texture ? 'Saturation: light; no tail' : 'Saturation: minimal; clean transient',
        'Exclude: fills, flam, intro crashes, rolls'
      ].join('. ');
    case 'bass':
      return [
        'ROLE: single isolated bass only',
        'Harmony: strictly diatonic in project key (no chromatic notes)',
        'Pitch: root + fifth primarily; occasional octave',
        `Movement: ${scaleKnob(c.movement, 'static', 'simple', 'groovy', 'animated', 'busy')} repeating per bar`,
        `Depth: ${scaleKnob(c.depth, 'light', 'medium', 'deep', 'deeper', 'subby')} low-end; controlled release`,
        c.filter ? 'Filter: subtle motion within bar; reset each bar' : 'Filter: stable',
        'Start note on beat 1; no slides across seam'
      ].join('. ');
    case 'lead':
      return [
        'ROLE: single isolated lead synth only',
        'Melody: strictly diatonic; avoid chromatic passing tones',
        `Phrase length evenly divides ${Math.max(1, c.bars || 4)} bar(s)`,
        `Complexity: ${scaleKnob(c.complexity, 'simple', 'moderate', 'interesting', 'intricate', 'ornate')} (quantized)`,
        `Brightness: ${scaleKnob(c.brightness, 'dark', 'mellow', 'balanced', 'bright', 'very bright')}`,
        c.delay ? 'Delay: minimal tempo-synced; cut at bar end' : 'Delay: off',
        'No bends/slides across loop seam'
      ].join('. ');
    case 'pad':
      return [
        'ROLE: single isolated pad only',
        'Chord: sustained diatonic chord(s); no modulation',
        `Evolution: ${scaleKnob(c.evolution, 'static', 'gentle', 'subtle motion', 'evolving', 'animated')} but reset every bar`,
        `Warmth: ${scaleKnob(c.warmth, 'cool', 'neutral', 'warm', 'lush', 'very lush')}`,
        c.chorus ? 'Chorus: subtle; no stereo smear at seam' : 'Chorus: off',
        'No long reverb tail; envelope ends before bar boundary'
      ].join('. ');
    default:
      return 'ROLE: single isolated instrument only';
  }
}
// Negative directives per stem to exclude unwanted instruments and
// effects.  Common negatives are always included.
function negatives(st) {
  const common = [
    'no vocals or speech',
    'no cymbal crash on the last beat',
    'no count-in',
    'no pre-roll',
    'no silence at start',
    'no tempo changes',
    'no swing',
    'no off-grid timing',
    'no modulation or key change'
  ];
  const per = {
    kick: [
      'no toms',
      'no pitch glides',
      'no tonal sub drops',
      'no reverb tail',
      'no hi-hat',
      'no snare',
      'no clap',
      'no rimshot',
      'no shaker',
      'no cymbal',
      'no percussion'
    ],
    hihat: [
      'no open hats',
      'no ride',
      'no shaker',
      'no clap',
      'no snare',
      'no pitch sweeps',
      'no reverb tail'
    ],
    perc: [
      'no clap',
      'no rimshot',
      'no hi-hat',
      'no kick',
      'no low-frequency thump',
      'no toms',
      'no melodic percussion',
      'no reverb tail',
      'no ride',
      'no shaker',
      'no cymbal',
      'no percussion'
    ],
    bass: [
      'no chords',
      'no distortion tail',
      'no slides across seam'
    ],
    lead: [
      'no atonal notes',
      'no portamento across seam',
      'no long delay tail'
    ],
    pad: [
      'no huge reverb',
      'no side instruments',
      'no arpeggios',
      'no tail at seam'
    ],
    arp: [
      'no drums',
      'no percussion',
      'no bass',
      'no pads',
      'no leads',
      'no vocals',
      'no FX'
    ],
    fx: [
      'no drums or percussion',
      'no pitched melodies',
      'no vocals',
      'no tails across seam'
    ],
    perc2: [
      'no kick',
      'no snare',
      'no clap',
      'no hi-hat',
      'no ride',
      'no toms',
      'no tonal hits',
      'no tail across seam'
    ]
  };
  return [
    ...common,
    ...per[st] || []
  ].join('; ');
}
// Build the hi-hat prompt.  Adjusts strictness to enforce exact 1/16
// grid and zero tails when retrying.
function buildHihatPrompt(controls, master, strictness = 0) {
  const { tempo, bars, root, mode } = master;
  const g = globalScaffold({
    tempo,
    bars,
    root,
    mode
  });
  const brightness = scaleKnob(controls.brightness, 'dark', 'balanced', 'crisp', 'bright', 'very bright');
  const space = controls.reverb ? 'Space: tiny room; decay < 120ms; gate tails before seam.' : 'Space: dry, minimal.';
  const common = [
    'STEM: HIHAT — solo closed hi-hat only.',
    'Identity: crisp techno closed hi-hat.',
    'Engine: Roland TR-909 closed hat; tight analog noise burst; zero bleed from other drums.',
    g,
    'ROLE: isolated closed hat (no open-hat).',
    'Pattern: strict 1/16 notes; first hit exactly at bar 1 beat 1; consistent every bar.',
    `Tone: ${brightness}; unpitched; short decay (40–120ms).`,
    space,
    'Exclude: ride, shaker, clap, snare, kick, toms, crashes; no melodic content, sweeps, or FX.',
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ];
  if (strictness === 1) {
    common.push('ABSOLUTE: Only closed-hat hits on a straight 1/16 grid; zero swing.', 'ABSOLUTE: Preserve Roland TR-909 closed-hat timbre; no other drums.');
  } else if (strictness >= 2) {
    common.push('MUST: closed-hat hits on each 1/16 step (16 hits/bar).', 'MUST: zero reverb tail at seam; gate hits before bar end.', 'MUST: exclude open hat, ride, shaker, snare, clap, toms, crashes.', 'MUST: emulate Roland TR-909 closed-hat spectrum only.');
  }
  return common.join(' ');
}
// Build the snare (perc) prompt.  Strictness controls enforcement of hits
// exactly on beats 2 and 4.
function buildSnarePrompt(controls, master, strictness = 0) {
  const { tempo, bars, root, mode } = master;
  const g = globalScaffold({
    tempo,
    bars,
    root,
    mode
  });
  const varTxt = scaleKnob(controls.variation, 'no variation', 'very subtle variation', 'subtle variation', 'light variation', 'moderate variation');
  const intensity = scaleKnob(controls.intensity, 'low', 'moderate', 'medium', 'strong', 'very strong');
  const body = controls.metallic ? 'Timbre: slightly metallic; tight transient; short decay (80–180ms).' : 'Timbre: dry, tight; short decay (80–180ms).';
  const common = [
    'STEM: SNARE — solo snare only.',
    'Identity: industrial techno snare; drum-machine style; no clap.',
    'Engine: Roland TR-909 snare circuit; tuned noise burst plus resonant body; keep low-frequency thump minimal.',
    g,
    'ROLE: isolated electronic snare.',
    'Pattern: hits exactly on beats 2 and 4 of every bar (no ghost notes or rolls).',
    `Dynamics: ${intensity}; ${body}`,
    `Variation: ${varTxt} but positions remain 2 & 4.`,
    'Exclude: clap/rim/kick/hat/shakers/toms/crashes; unpitched; no tails at seam; absolutely no layered kick drum.',
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ];
  if (strictness === 1) {
    common.push('ABSOLUTE: only beat 2 and beat 4 per bar; no extra hits.', 'ABSOLUTE: no off-grid timing.', 'ABSOLUTE: keep TR-909 snare tone only; do not mix in kick, clap or tom layers.');
  } else if (strictness >= 2) {
    common.push('MUST: exactly one snare on beat 2 and one on beat 4 per bar, nothing else.', 'MUST: gate decay fully before the seam; exclude clap/rim layers.', 'MUST: zero kick/bass energy below 150 Hz; pure TR-909 snare body.');
  }
  return common.join(' ');
}
// Build the arpeggiator prompt.
function buildArpPrompt(controls, master) {
  const { tempo, bars, root, mode } = master;
  const g = globalScaffold({
    tempo,
    bars,
    root,
    mode
  });
  const rate = mapArpRate(controls.rate);
  const complexity = scaleKnob(controls.complexity, 'simple', 'moderate', 'interesting', 'intricate', 'ornate');
  const gate = controls.gate ? 'long-ish gate (80–160ms)' : 'short gate (30–80ms)';
  return [
    'STEM: ARPEGGIATOR — solo synth arpeggio only.',
    `Identity: ${stemConfigs.arp.basePrompt}.`,
    g,
    `ROLE: isolated arp; strictly diatonic in ${root} ${mode}; no chords.`,
    `Pattern: ${rate}; fully quantized; phrase length must evenly divide ${bars} bars.`,
    `Complexity: ${complexity}; consistent motif and octave moves.`,
    `Envelope: ${gate}; no delay/reverb across seam.`,
    'Exclude: drums/percussion/bass/pads/leads/vocals.',
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ].join(' ');
}
// Build the FX prompt.
function buildFXPrompt(controls, master) {
  const { tempo, bars, root, mode } = master;
  const g = globalScaffold({
    tempo,
    bars,
    root,
    mode
  });
  const intensity = scaleKnob(controls.intensity, 'subtle', 'moderate', 'medium', 'strong', 'intense');
  const movement = scaleKnob(controls.movement, 'static', 'gentle motion', 'evolving', 'animated', 'dynamic');
  const space = controls.reverb ? 'Space: tiny room; decay ≤ 150ms; gate before bar end.' : 'Space: dry/minimal; gate before bar end.';
  return [
    'STEM: FX — solo techno transition effects & atmos only.',
    `Identity: ${stemConfigs.fx.basePrompt}.`,
    g,
    'ROLE: bar-internal whooshes/sweeps/noise beds that RESET each bar.',
    `Intensity: ${intensity}. Movement: ${movement}.`,
    space,
    'Exclude: pitched melodies/drums/percussion; avoid risers/falls that exceed a single bar.',
    'Deliver a bar-perfect seamless loop; zero tail beyond the bar.'
  ].join(' ');
}
// Build the percussion loop (perc2) prompt.
function buildPercLoopPrompt(controls, master) {
  const { tempo, bars, root, mode } = master;
  const g = globalScaffold({
    tempo,
    bars,
    root,
    mode
  });
  const density = scaleKnob(controls.density, 'sparse', 'light', 'medium', 'busy', 'dense');
  const metallic = controls.metallic ? 'slightly metallic timbre allowed' : 'organic timbre preferred';
  const groove = scaleKnob(controls.groove, 'straight', 'straight with mild syncopation', 'syncopated but quantized', 'complex yet quantized', 'complex yet quantized');
  return [
    'STEM: PERCUSSION — solo top percussion only (shakers/blocks/taps); not snare/hat/kick.',
    `Identity: ${stemConfigs.perc2.basePrompt}.`,
    g,
    `ROLE: quantized on-grid accents; ${groove}; zero swing.`,
    `Density: ${density}; keep consistent across bars.`,
    `Timbre: ${metallic}; short releases; zero tails at seam.`,
    'Exclude: tonal hits/kick/snare/clap/hat/ride/toms/crashes.',
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ].join(' ');
}
// Build a stem prompt based on the stem type.  Hihat and snare
// support strictness tiers for automatic retries.
function buildStemPrompt(st, controls, master, strictness = 0) {
  if (st === 'hihat') return buildHihatPrompt(controls, master, strictness);
  if (st === 'perc') return buildSnarePrompt(controls, master, strictness);
  if (st === 'kick') {
    const basePrompt = [
      `STEM: ${st.toUpperCase()} — solo ${stemConfigs[st]?.basePrompt || 'kick'}.`,
      globalScaffold(master),
      roleDirectives(st, controls),
      `Avoid: ${negatives(st)}`,
      'Deliver a bar-perfect loop that aligns exactly with bar boundaries and starts at bar 1 beat 1.'
    ];
    if (strictness === 1) {
      basePrompt.push('ABSOLUTE: Only one kick hit on beats 1, 2, 3 and 4 per bar; no off-grid timing; no additional percussion.', 'ABSOLUTE: Maintain pure Roland TR-909 kick voicing; do not layer snares, claps or bass notes.');
    } else if (strictness >= 2) {
      basePrompt.push('MUST: exactly four kick hits per bar (beats 1, 2, 3, 4) and nothing else; exclude hi-hats, snares, claps, toms or any other drums; quantization must be perfect.', 'MUST: emulate Roland TR-909 kick circuit only; zero additional percussion or bass drones.');
    }
    return basePrompt.join(' ');
  }
  if (st === 'arp') return buildArpPrompt(controls, master);
  if (st === 'fx') return buildFXPrompt(controls, master);
  if (st === 'perc2') return buildPercLoopPrompt(controls, master);
  const cfg = stemConfigs[st];
  const stemBase = cfg?.basePrompt || 'single instrument';
  const global = globalScaffold(master);
  const role = roleDirectives(st, controls);
  const negs = negatives(st);
  return [
    `STEM: ${st.toUpperCase()} — solo ${stemBase}.`,
    global,
    role,
    `Avoid: ${negs}.`,
    'Deliver a bar-perfect loop that aligns exactly with bar boundaries and starts at bar 1 beat 1.'
  ].join(' ');
}
function guessChannelsFromLength(pcmBytesLength, sampleRate, musicLengthMs) {
  const expectedFrames = Math.max(1, Math.round(sampleRate * (musicLengthMs / 1000)));
  const bytesPerMono = expectedFrames * 2;
  const bytesPerStereo = expectedFrames * 4;
  const tol = Math.max(4096, Math.round(0.15 * bytesPerStereo));
  const monoDiff = Math.abs(pcmBytesLength - bytesPerMono);
  const stereoDiff = Math.abs(pcmBytesLength - bytesPerStereo);
  if (stereoDiff <= monoDiff && stereoDiff <= tol) return 2;
  if (monoDiff < stereoDiff && monoDiff <= tol) return 1;
  return 2;
}
function convertRawPCMToChans(pcm, channels, sampleRate) {
  const totalSamples = pcm.length / 2;
  const frames = totalSamples / channels;
  const chans = Array.from({
    length: channels
  }, ()=>new Float32Array(frames));
  let offset = 0;
  for(let i = 0; i < frames; i++){
    for(let c = 0; c < channels; c++){
      const lo = pcm[offset];
      const hi = pcm[offset + 1];
      let val = hi << 8 | lo;
      if (val & 0x8000) val = val - 0x10000;
      const sample = val < 0 ? val / 0x8000 : val / 0x7fff;
      chans[c][i] = sample;
      offset += 2;
    }
  }
  return {
    data: chans,
    sr: sampleRate,
    ch: channels,
    length: frames
  };
}
function countOnsets(buf, refractorySec = 0.08, relThresh = 0.35) {
  const sr = buf.sr;
  const x = buf.data[0];
  let sum = 0;
  const step = 512;
  for(let i = 0; i < x.length; i += step){
    const v = x[i];
    sum += v * v;
  }
  const rms = Math.sqrt(sum / Math.max(1, Math.floor(x.length / step)));
  const thr = Math.max(0.02, rms * relThresh);
  const refr = Math.max(1, Math.round(refractorySec * sr));
  let peaks = 0;
  let i = 0;
  while(i < x.length){
    if (Math.abs(x[i]) >= thr) {
      peaks++;
      i += refr;
    } else {
      i++;
    }
  }
  return peaks;
}

function computeRms(data, step = 512) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += step) {
    const v = data[i];
    sum += v * v;
    n++;
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

function removeDcOffset(chans) {
  for (const data of chans) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    const mean = sum / data.length;
    if (Math.abs(mean) > 1e-6) {
      for (let i = 0; i < data.length; i++) {
        data[i] -= mean;
      }
    }
  }
}

function detectTempoDrift(buf, expectedBpm, bars) {
  const sr = buf.sr;
  const x = buf.data[0];
  const expectedBeatSec = 60 / expectedBpm;
  const expectedBeatSamples = Math.round(expectedBeatSec * sr);

  const onsets = [];
  const windowSize = Math.round(0.05 * sr);
  const hopSize = Math.round(0.01 * sr);

  for (let i = 0; i < x.length - windowSize; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < windowSize; j++) {
      energy += x[i + j] * x[i + j];
    }
    const rms = Math.sqrt(energy / windowSize);

    if (rms > 0.1 && (onsets.length === 0 || i - onsets[onsets.length - 1] > expectedBeatSamples * 0.3)) {
      onsets.push(i);
    }
  }

  if (onsets.length < bars * 2) {
    return { valid: false, reason: 'insufficient_onsets', drift: 0 };
  }

  const intervals = [];
  for (let i = 1; i < onsets.length; i++) {
    intervals.push(onsets[i] - onsets[i - 1]);
  }

  const intervalBpms = intervals.map(int => (60 * sr) / int);
  const avgBpm = intervalBpms.reduce((a, b) => a + b, 0) / intervalBpms.length;
  const variance = intervalBpms.reduce((sum, bpm) => sum + Math.pow(bpm - avgBpm, 2), 0) / intervalBpms.length;
  const stdDev = Math.sqrt(variance);
  const drift = Math.abs(avgBpm - expectedBpm);

  const maxDrift = expectedBpm * 0.005;
  const valid = drift <= maxDrift && stdDev <= expectedBpm * 0.01;

  return {
    valid,
    reason: valid ? 'ok' : 'tempo_drift',
    drift,
    avgBpm,
    stdDev,
    onsetCount: onsets.length
  };
}

function analyzeSpectrum(buf, stem) {
  const sr = buf.sr;
  const x = buf.data[0];

  const analyzeBand = (data, lowHz, highHz) => {
    const lowPass = (d, fc) => {
      const rc = 1 / (2 * Math.PI * fc);
      const dt = 1 / sr;
      const alpha = dt / (rc + dt);
      const out = new Float32Array(d.length);
      out[0] = d[0];
      for (let i = 1; i < d.length; i++) {
        out[i] = out[i - 1] + alpha * (d[i] - out[i - 1]);
      }
      return out;
    };

    let filtered = new Float32Array(data);
    if (highHz < sr / 2) {
      filtered = lowPass(filtered, highHz);
    }

    return computeRms(filtered, 256);
  };

  const subBass = analyzeBand(x, 0, 80);
  const lowBass = analyzeBand(x, 80, 180);
  const midLow = analyzeBand(x, 180, 500);
  const midHigh = analyzeBand(x, 500, 2000);
  const high = analyzeBand(x, 2000, 8000);
  const total = computeRms(x, 256);

  const spectrum = {
    subBass: subBass / (total + 1e-10),
    lowBass: lowBass / (total + 1e-10),
    midLow: midLow / (total + 1e-10),
    midHigh: midHigh / (total + 1e-10),
    high: high / (total + 1e-10)
  };

  let valid = true;
  let reason = 'ok';

  if (stem === 'kick') {
    if (spectrum.subBass < 0.3 || spectrum.high > 0.15) {
      valid = false;
      reason = 'kick_spectrum_invalid';
    }
  } else if (stem === 'hihat') {
    if (spectrum.high < 0.4 || spectrum.subBass > 0.1) {
      valid = false;
      reason = 'hihat_has_low_freq_bleed';
    }
  } else if (stem === 'perc') {
    if (spectrum.subBass > 0.2 || (spectrum.midLow + spectrum.midHigh) < 0.3) {
      valid = false;
      reason = 'snare_spectrum_invalid';
    }
  } else if (stem === 'bass') {
    if ((spectrum.subBass + spectrum.lowBass) < 0.5) {
      valid = false;
      reason = 'bass_lacks_low_end';
    }
  }

  return { valid, reason, spectrum };
}

function checkPhaseCoherence(chans, sr, xfadeN) {
  const data = chans[0];
  const n = data.length;

  if (n < xfadeN * 2) {
    return { valid: false, reason: 'buffer_too_short', coherence: 0 };
  }

  let correlation = 0;
  let startEnergy = 0;
  let endEnergy = 0;

  for (let i = 0; i < xfadeN; i++) {
    const startSample = data[i];
    const endSample = data[n - xfadeN + i];
    correlation += startSample * endSample;
    startEnergy += startSample * startSample;
    endEnergy += endSample * endSample;
  }

  const coherence = correlation / (Math.sqrt(startEnergy * endEnergy) + 1e-10);
  const valid = coherence > 0.5;

  return { valid, reason: valid ? 'ok' : 'phase_mismatch', coherence };
}

function computeLowBandRms(data, sr, cutoffHz = 180) {
  if (!data.length) return 0;
  const dt = 1 / sr;
  const rc = 1 / (2 * Math.PI * Math.max(10, cutoffHz));
  const alpha = dt / (rc + dt);
  let y = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    y = y + alpha * (x - y);
    sum += y * y;
  }
  return Math.sqrt(sum / data.length);
}
function validateHihat(buf, bpm, bars) {
  const expected = bars * 16;
  const found = countOnsets(buf, 0.07, 0.35);
  return found >= Math.max(10, Math.round(expected * 0.8));
}
function validateSnare(buf, bpm, bars) {
  const sr = buf.sr;
  const x = buf.data[0];
  const barSec = 4 * (60 / bpm);
  const beatSec = 60 / bpm;
  const tol = Math.round(40 / 1000 * sr);
  const fullRms = computeRms(x, 256);
  if (fullRms > 0) {
    const lowRms = computeLowBandRms(x, sr, 170);
    if (lowRms / fullRms > 0.48) {
      return false;
    }
  }
  function hasPeakNear(sampleIdx) {
    const a = Math.max(0, sampleIdx - tol);
    const b = Math.min(x.length - 1, sampleIdx + tol);
    let sum = 0;
    let n = 0;
    for (let i = a; i <= b; i += 4) {
      const v = x[i];
      sum += v * v;
      n++;
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    const thr = Math.max(0.02, rms * 3.0);
    for (let i = a; i <= b; i += 2) {
      if (Math.abs(x[i]) >= thr) return true;
    }
    return false;
  }
  for (let bar = 0; bar < bars; bar++) {
    const barStart = Math.round(bar * barSec * sr);
    const beat2 = barStart + Math.round(1 * beatSec * sr);
    const beat4 = barStart + Math.round(3 * beatSec * sr);
    if (!hasPeakNear(beat2) || !hasPeakNear(beat4)) return false;
  }
  let sumAll = 0;
  for (let i = 0; i < x.length; i += 512) {
    const v = x[i];
    sumAll += v * v;
  }
  const rmsAll = Math.sqrt(sumAll / Math.max(1, Math.floor(x.length / 512)));
  const globalThr = Math.max(0.02, rmsAll * 3.0);
  const allowed = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = Math.round(bar * barSec * sr);
    const b2 = barStart + Math.round(1 * beatSec * sr);
    const b4 = barStart + Math.round(3 * beatSec * sr);
    allowed.push([b2 - tol, b2 + tol]);
    allowed.push([b4 - tol, b4 + tol]);
  }
  function inAllowed(i) {
    for (const [a, b] of allowed) {
      if (i >= a && i <= b) return true;
    }
    return false;
  }
  for (let i = 0; i < x.length; i += Math.max(1, Math.round(sr / 2000))) {
    if (Math.abs(x[i]) >= globalThr && !inAllowed(i)) {
      return false;
    }
  }
  return true;
}

function validateKick(buf, bpm, bars) {
  const sr = buf.sr;
  const x = buf.data[0];
  const barSec = 4 * (60 / bpm);
  const beatSec = 60 / bpm;
  const tol = Math.round(40 / 1000 * sr);
  function hasPeakNear(sampleIdx) {
    const a = Math.max(0, sampleIdx - tol);
    const b = Math.min(x.length - 1, sampleIdx + tol);
    let sum = 0;
    let n = 0;
    for (let i = a; i <= b; i += 4) {
      const v = x[i];
      sum += v * v;
      n++;
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    const thr = Math.max(0.02, rms * 3.0);
    for (let i = a; i <= b; i += 2) {
      if (Math.abs(x[i]) >= thr) return true;
    }
    return false;
  }
  for (let bar = 0; bar < bars; bar++) {
    const barStart = Math.round(bar * barSec * sr);
    for (let bBeat = 0; bBeat < 4; bBeat++) {
      const beatPos = barStart + Math.round(bBeat * beatSec * sr);
      if (!hasPeakNear(beatPos)) return false;
    }
  }
  let sumAll = 0;
  for (let i = 0; i < x.length; i += 512) {
    const v = x[i];
    sumAll += v * v;
  }
  const rmsAll = Math.sqrt(sumAll / Math.max(1, Math.floor(x.length / 512)));
  const globalThr = Math.max(0.02, rmsAll * 3.0);
  const allowed = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = Math.round(bar * barSec * sr);
    for (let bBeat = 0; bBeat < 4; bBeat++) {
      const beatPos = barStart + Math.round(bBeat * beatSec * sr);
      allowed.push([beatPos - tol, beatPos + tol]);
    }
  }
  function inAllowed(i) {
    for (const [a, b] of allowed) {
      if (i >= a && i <= b) return true;
    }
    return false;
  }
  for (let i = 0; i < x.length; i += Math.max(1, Math.round(sr / 2000))) {
    if (Math.abs(x[i]) >= globalThr && !inAllowed(i)) {
      return false;
    }
  }
  return true;
}
function mod(a, n) {
  return (a % n + n) % n;
}
function detectHeadIndexArray(data, sr) {
  const maxMs = 1000;
  const maxN = Math.min(data.length, Math.round(maxMs / 1000 * sr));
  if (maxN <= 0) return 0;
  const env = new Float32Array(maxN);
  for(let i = 0; i < maxN; i++)env[i] = Math.abs(data[i]);
  const win = Math.max(2, Math.round(8 / 1000 * sr));
  let acc = 0;
  for(let i = 0; i < win && i < env.length; i++)acc += env[i];
  const sm = new Float32Array(maxN);
  for(let i = 0; i < maxN; i++){
    if (i >= win) acc += env[i] - env[i - win];
    sm[i] = acc / Math.min(win, i + 1);
  }
  let peak = 0;
  for(let i = 0; i < maxN; i++)if (sm[i] > peak) peak = sm[i];
  const th = Math.max(Math.pow(10, -45 / 20), peak * 0.12);
  const backOff = Math.round(0.0035 * sr);
  const zeroFallback = Math.max(64, Math.round(0.008 * sr));
  function nearestZero(around) {
    let best = around;
    let bestVal = Math.abs(data[around] || 0);
    const a = Math.max(0, around - zeroFallback);
    const b = Math.min(data.length - 1, around + zeroFallback);
    for(let i = a; i <= b; i++){
      const v = Math.abs(data[i]);
      if (v < bestVal) {
        bestVal = v;
        best = i;
      }
    }
    return best;
  }
  for(let i = 0; i < maxN; i++){
    if (sm[i] >= th) {
      const idx = Math.max(0, i - backOff);
      return Math.max(0, nearestZero(idx));
    }
  }
  return 0;
}
function findBestSeamOffsetArray(data, startIdx, targetLen, xfadeN, sr) {
  const n = data.length;
  const search = Math.max(0, Math.round(90 / 1000 * sr));
  const step = Math.max(1, Math.round(sr / 12000));
  let bestOff = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  const sampleAt = (idx)=>{
    while(idx < 0)idx += n;
    while(idx >= n)idx -= n;
    return data[idx];
  };
  for(let off = -search; off <= search; off += step){
    let score = 0;
    for(let i = 0; i < xfadeN; i += step){
      const a = sampleAt(startIdx + i + off);
      const b = sampleAt(startIdx + targetLen - xfadeN + i + off);
      const diff = a - b;
      score += diff * diff;
    }
    if (score < bestScore) {
      bestScore = score;
      bestOff = off;
    }
  }
  return bestOff;
}
function sliceWrapArray(data, start, len) {
  const ch = data.length;
  const out = Array.from({
    length: ch
  }, ()=>new Float32Array(len));
  const n = data[0].length;
  for(let c = 0; c < ch; c++){
    const src = data[c];
    const dst = out[c];
    const end = start + len;
    if (end <= n) {
      dst.set(src.subarray(start, end), 0);
    } else {
      const first = n - start;
      dst.set(src.subarray(start), 0);
      dst.set(src.subarray(0, len - first), first);
    }
  }
  return out;
}
function applyEdgeRampsArray(chans, sr, rampMs) {
  const n = chans[0].length;
  const ramp = Math.max(2, Math.round(rampMs / 1000 * sr));
  for (const d of chans){
    for(let i = 0; i < Math.min(ramp, n); i++){
      d[i] *= Math.sin(0.5 * Math.PI * (i / (ramp - 1)));
    }
    for(let i = 0; i < Math.min(ramp, n); i++){
      d[n - 1 - i] *= Math.sin(0.5 * Math.PI * (1 - i / (ramp - 1)));
    }
  }
}
function applySeamCrossfadeArray(chans, sr, xfadeMs) {
  const n = chans[0].length;
  const xfadeN = Math.max(2, Math.round(xfadeMs / 1000 * sr));
  for (const d of chans){
    for(let i = 0; i < xfadeN; i++){
      const t = i / (xfadeN - 1);
      const wa = Math.cos(0.5 * Math.PI * t);
      const wb = Math.sin(0.5 * Math.PI * t);
      const endIdx = n - xfadeN + i;
      d[endIdx] = d[endIdx] * wa + d[i] * wb;
    }
    d[n - 1] = d[0];
  }
}

function applyHighPassArray(chans, sr, cutoffHz = 180) {
  const dt = 1 / sr;
  const rc = 1 / (2 * Math.PI * Math.max(10, cutoffHz));
  const alpha = rc / (rc + dt);
  for (const d of chans) {
    let prevY = 0;
    let prevX = d[0] || 0;
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      const y = alpha * (prevY + x - prevX);
      d[i] = y;
      prevY = y;
      prevX = x;
    }
  }
}

function applyGentleLimiter(chans, thresholdDb = -0.3) {
  const threshold = Math.pow(10, thresholdDb / 20);

  for (const data of chans) {
    for (let i = 0; i < data.length; i++) {
      const sample = data[i];
      const abs = Math.abs(sample);

      if (abs > threshold) {
        const sign = sample < 0 ? -1 : 1;
        const excess = abs - threshold;
        const compressed = threshold + excess * 0.5;
        data[i] = sign * Math.min(compressed, 1.0);
      }
    }
  }
}
async function callLoopFixGemini(wavBytes: Uint8Array, tempo: number, bars: number): Promise<Uint8Array | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("Supabase credentials not available for loop-fix-gemini call");
    return null;
  }

  try {
    let binary = '';
    for (let i = 0; i < wavBytes.length; i++) {
      binary += String.fromCharCode(wavBytes[i]);
    }
    const audio_base64 = btoa(binary);

    const response = await fetch(`${supabaseUrl}/functions/v1/loop-fix-gemini`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_base64,
        target_bpm: tempo,
        bars,
        use_gemini: true
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`loop-fix-gemini failed: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json();
    const diagnostics = response.headers.get('X-LoopFix-Diagnostics');

    if (diagnostics) {
      console.log('Loop-fix diagnostics:', diagnostics);
    }

    if (!result.fixed_audio_base64) {
      console.warn('loop-fix-gemini returned no audio data');
      return null;
    }

    const fixedBinary = atob(result.fixed_audio_base64);
    const fixedBytes = new Uint8Array(fixedBinary.length);
    for (let i = 0; i < fixedBinary.length; i++) {
      fixedBytes[i] = fixedBinary.charCodeAt(i);
    }

    return fixedBytes;
  } catch (error) {
    console.warn('loop-fix-gemini error:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

function makeWavFromPCM16(chans, sr) {
  const ch = chans.length;
  const frames = chans[0].length;
  const blockAlign = ch * 2;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false);
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, dataSize, true);
  let off = 44;
  for(let i = 0; i < frames; i++){
    for(let c = 0; c < ch; c++){
      let s = chans[c][i];
      if (s < -1) s = -1;
      else if (s > 1) s = 1;
      const v = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(off, v, true);
      off += 2;
    }
  }
  return new Uint8Array(buffer);
}
Deno.serve(async (req)=>{
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        status: 200,
        headers: corsHeaders
      });
    }
    let body = null;
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const payloadParam = url.searchParams.get('payload');
      if (payloadParam) {
        try {
          const b64 = decodeURIComponent(payloadParam);
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for(let i = 0; i < binary.length; i++){
            bytes[i] = binary.charCodeAt(i);
          }
          const decoder = new TextDecoder('utf-8');
          const jsonStr = decoder.decode(bytes);
          body = JSON.parse(jsonStr);
        } catch (_err) {
          body = null;
        }
      }
    } else if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch (_jsonErr) {
        try {
          const textPayload = await req.text();
          body = JSON.parse(textPayload);
        } catch (_textErr) {
          body = null;
        }
      }
    } else {
      return new Response('Not found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain',
          ...corsHeaders
        }
      });
    }
    if (!body) {
      return new Response(JSON.stringify({
        error: 'Invalid request body'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    const stem = String(body.stem || '').toLowerCase();
    const controls = body.controls || {};
    const use_gemini = body.use_gemini !== undefined ? body.use_gemini : true;
    const master = body.master || {
      tempo: 130,
      bars: 4,
      rootBase: 'A',
      accidental: 'natural',
      mode: 'Minor'
    };
    const tempo = Math.max(40, Math.min(300, Math.round(Number(master.tempo) || 130)));
    const bars = Math.max(1, Math.min(32, Math.round(Number(master.bars) || 4)));
    const rootText = getRootText(master);
    const masterForPrompt = {
      tempo,
      bars,
      root: rootText,
      mode: master.mode || 'Minor'
    };
    const xiKey = Deno.env.get('ELEVENLABS_API_KEY');
    if (!xiKey) {
      return new Response(JSON.stringify({
        error: 'ELEVENLABS_API_KEY is not configured'
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    let strictness = 0;
    let usedPrompt = '';
    let validated = true;
    let tier = 0;
    let rawPCM = null;
    let sampleRate = 24000;
    let channels = 1;
    let musicLengthMs = 0;
    const preferredFormats = ['pcm_44100', 'pcm_24000', 'pcm_22050', 'pcm_16000'];
    let usedFormat = 'pcm_24000';
    let formatSampleRate = 24000;

    for(strictness = 0; strictness < 3; strictness++){
      usedPrompt = buildStemPrompt(stem, controls, masterForPrompt, strictness);
      const beats = bars * 4;
      const seconds = beats * (60 / tempo);
      musicLengthMs = Math.round(seconds * 1000) + 200;
      musicLengthMs = Math.max(10000, Math.min(300000, musicLengthMs));

      let resp = null;
      let formatError = false;

      for (const outputFormat of preferredFormats) {
        const upstream = new URL('https://api.elevenlabs.io/v1/music');
        upstream.searchParams.set('output_format', outputFormat);
        const upstreamBody = {
          prompt: usedPrompt,
          music_length_ms: musicLengthMs,
          model_id: 'music_v1'
        };

        try {
          resp = await fetch(upstream.toString(), {
            method: 'POST',
            headers: {
              'xi-api-key': xiKey,
              'Content-Type': 'application/json',
              'Accept': 'audio/*,application/octet-stream'
            },
            body: JSON.stringify(upstreamBody)
          });

          if (resp.ok) {
            usedFormat = outputFormat;
            formatSampleRate = parseInt(outputFormat.split('_')[1]) || 24000;
            console.log(`Successfully using format: ${usedFormat} (${formatSampleRate}Hz)`);
            break;
          } else if (resp.status === 400 || resp.status === 403) {
            const txt = await resp.text().catch(() => '');
            if (txt.includes('output_format') || txt.includes('plan') || txt.includes('tier')) {
              console.log(`Format ${outputFormat} not available, trying fallback...`);
              formatError = true;
              continue;
            } else {
              return new Response(JSON.stringify({
                error: `Upstream error ${resp.status}`,
                upstream: txt
              }), {
                status: resp.status,
                headers: {
                  'Content-Type': 'application/json',
                  ...corsHeaders
                }
              });
            }
          } else {
            const txt = await resp.text().catch(() => '');
            return new Response(JSON.stringify({
              error: `Upstream error ${resp.status}`,
              upstream: txt
            }), {
              status: resp.status,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }
        } catch (fetchErr) {
          console.error(`Error trying format ${outputFormat}:`, fetchErr);
          continue;
        }
      }

      if (!resp || !resp.ok) {
        return new Response(JSON.stringify({
          error: 'No supported PCM format available for this account',
          triedFormats: preferredFormats
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      sampleRate = formatSampleRate;
      const rawBytes = new Uint8Array(await resp.arrayBuffer());
      channels = guessChannelsFromLength(rawBytes.length, sampleRate, musicLengthMs);
      const pcm = convertRawPCMToChans(rawBytes, channels, sampleRate);
      let stemValidated = true;
      const validationErrors = [];

      if (stem === 'hihat') {
        stemValidated = validateHihat(pcm, tempo, bars);
        if (!stemValidated) validationErrors.push('hihat pattern invalid');
      } else if (stem === 'perc') {
        stemValidated = validateSnare(pcm, tempo, bars);
        if (!stemValidated) validationErrors.push('snare pattern invalid');
      } else if (stem === 'kick') {
        stemValidated = validateKick(pcm, tempo, bars);
        if (!stemValidated) validationErrors.push('kick pattern invalid');
      }

      const tempoDriftOk = detectTempoDrift(pcm, tempo, bars);
      if (!tempoDriftOk) {
        validationErrors.push('tempo drift detected');
      }

      const spectrumOk = analyzeSpectrum(pcm, stem);
      if (!spectrumOk) {
        validationErrors.push('unwanted frequency content');
      }

      const phaseOk = checkPhaseCoherence(pcm.data, sampleRate, Math.round(12 / 1000 * sampleRate));
      if (!phaseOk) {
        validationErrors.push('phase discontinuity at loop boundary');
      }

      validated = stemValidated && tempoDriftOk && spectrumOk && phaseOk;

      if (!validated && validationErrors.length > 0) {
        console.log(`Validation failed for ${stem} (attempt ${strictness}): ${validationErrors.join(', ')}`);
      }
      rawPCM = rawBytes;
      tier = strictness;
      if (validated || strictness >= 2 || (stem !== 'hihat' && stem !== 'perc' && stem !== 'kick')) {
        break;
      }
    }
    if (!rawPCM) {
      return new Response(JSON.stringify({
        error: 'Failed to generate audio'
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    let outBytes: Uint8Array;
    let loopMethod = 'heuristic';

    if (use_gemini && Deno.env.get("GEMINI_API_KEY")) {
      const pcm = convertRawPCMToChans(rawPCM, channels, sampleRate);
      const initialWav = makeWavFromPCM16(pcm.data, sampleRate);

      const geminiFixed = await callLoopFixGemini(initialWav, tempo, bars);

      if (geminiFixed) {
        console.log('✓ Using Gemini-enhanced loop fix');
        outBytes = geminiFixed;
        loopMethod = 'gemini';
      } else {
        console.log('⚠ Gemini loop fix failed, using heuristic fallback');
      }
    }

    if (!outBytes) {
      const pcm = convertRawPCMToChans(rawPCM, channels, sampleRate);
      const framesPerBeatFloat = sampleRate * (60 / tempo);
      const framesPerBeatInt = Math.max(1, Math.round(framesPerBeatFloat));
      let targetFrames = framesPerBeatInt * 4 * bars;
      if (targetFrames > pcm.length) {
        const beatMultiple = Math.max(1, Math.floor(pcm.length / framesPerBeatInt));
        targetFrames = Math.max(framesPerBeatInt, beatMultiple * framesPerBeatInt);
      }
      const headIdx = detectHeadIndexArray(pcm.data[0], sampleRate);
      const xfadeMs = 12;
      const xfadeN = Math.max(2, Math.round(xfadeMs / 1000 * sampleRate));
      const bestOff = findBestSeamOffsetArray(pcm.data[0], headIdx, targetFrames, xfadeN, sampleRate);
      let start = mod(headIdx + bestOff, pcm.length);
      const framesPerBeat = framesPerBeatFloat;
      if (Number.isFinite(framesPerBeat) && framesPerBeat > 0) {
        const quantStart = Math.round(start / framesPerBeat) * framesPerBeat;
        if (Number.isFinite(quantStart) && Math.abs(quantStart - start) <= framesPerBeat * 0.35) {
          start = Math.max(0, Math.min(pcm.length - 1, Math.round(quantStart)));
        } else {
          start = Math.round(start);
        }
      } else {
        start = Math.round(start);
      }
      const trimmed = sliceWrapArray(pcm.data, start, targetFrames);

      removeDcOffset(trimmed);
      applyEdgeRampsArray(trimmed, sampleRate, 5);
      applySeamCrossfadeArray(trimmed, sampleRate, xfadeMs);

      if (stem === 'perc') {
        applyHighPassArray(trimmed, sampleRate, 180);
      }

      applyGentleLimiter(trimmed, -0.3);
      outBytes = makeWavFromPCM16(trimmed, sampleRate);
    }
    let binary = '';
    for(let i = 0; i < outBytes.length; i++)binary += String.fromCharCode(outBytes[i]);
    const b64 = btoa(binary);
    const audio_b64 = `data:audio/wav;base64,${b64}`;
    const responseBody = {
      audio_b64,
      usedPrompt,
      tier,
      validated,
      format: usedFormat,
      sampleRate: sampleRate,
      channels: channels,
      loopMethod: loopMethod
    };
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (err) {
    console.error('generate-techno-stem error', err);
    return new Response(JSON.stringify({
      error: 'Internal error',
      details: err?.message || String(err)
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
});