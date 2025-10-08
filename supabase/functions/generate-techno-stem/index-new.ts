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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
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
  return [
    'Genre: modern techno',
    'TimeSignature: 4/4 (no swing)',
    `Tempo: ${tempo} BPM (constant; no variation)`,
    `Length: EXACT ${bars} bars (no extra bars)`,
    `Key: ${root} ${mode} (strictly diatonic; no modulation)`,
    'Start: bar 1 beat 1 (no count-in; no pre-roll)',
    `End: precisely at end of bar ${bars} (no tail; no reverb/delay bleed)`,
    'Loop: seamless at bar boundary (phase-coherent)',
    'DrumPalette: Roland TR-909 inspired; dry, punchy, fully isolated per stem',
    'Quantization: strict grid (no humanization)',
    'Delivery: instrumental only',
    `ABSOLUTE: The loop length must be exactly ${bars} bars at ${tempo} BPM; do not alter the tempo or add/remove bars`,
    `ABSOLUTE: Tempo must remain exactly ${tempo} BPM throughout; no variation or tempo drift`
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
        'Exclude: drums, percussion, bass, pads, vocals'
      ].join('. ');
    case 'pad':
      return [
        'ROLE: single isolated pad only',
        'Harmony: strictly diatonic chords; no chromatic movement',
        `Texture: ${scaleKnob(c.texture, 'simple', 'layered', 'rich', 'complex', 'dense')} pad sound`,
        `Movement: ${scaleKnob(c.movement, 'static', 'slow', 'gentle', 'moderate', 'active')} evolution within bars`,
        'Envelope: slow attack; sustained; smooth release at seam',
        c.reverb ? 'Space: moderate reverb; tail gated at bar end' : 'Space: dry',
        'Exclude: drums, percussion, bass, leads, vocals'
      ].join('. ');
    default:
      return '';
  }
}

// Build negative directives (things to avoid) for each stem type.
// These prevent contamination by unwanted elements.
function negatives(st) {
  const common = [
    'no vocals',
    'no speech',
    'no lyrics',
    'no counterfeit instruments'
  ];
  const per = {
    kick: [
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
      'no melody',
      'no arpeggios'
    ],
    arp: [
      'no chords',
      'no sustain',
      'no delay tail across seam'
    ],
    fx: [
      'no drums',
      'no tonal content',
      'no sustained notes'
    ],
    perc2: [
      'no kick',
      'no snare',
      'no clap',
      'no hi-hat',
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
  const density = scaleKnob(controls.density, 'sparse', 'light', 'moderate', 'busy', 'dense');
  const character = scaleKnob(controls.character, 'subtle', 'interesting', 'dramatic', 'wild', 'extreme');
  return [
    'STEM: FX — solo transition effects and atmos only.',
    `Identity: ${stemConfigs.fx.basePrompt}.`,
    g,
    `ROLE: isolated FX; no drums or tonal instruments.`,
    `Density: ${density}; timing aligns to bar grid.`,
    `Character: ${character}; sweeps, risers, impacts, noise bursts.`,
    'Envelope: all tails gated before bar end.',
    'Exclude: drums/percussion/bass/pads/leads/arps/vocals.',
    'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
  ].join(' ');
}

// Build the perc2 (top percussion loop) prompt.
function buildPercLoopPrompt(controls, master) {
  const { tempo, bars, root, mode } = master;
  const g = globalScaffold({
    tempo,
    bars,
    root,
    mode
  });
  const density = scaleKnob(controls.density, 'sparse', 'light', 'moderate', 'busy', 'dense');
  const metallic = controls.metallic ? 'metallic, bright' : 'dry, organic';
  return [
    'STEM: PERC2 — solo top percussion loop only.',
    `Identity: ${stemConfigs.perc2.basePrompt}.`,
    g,
    `ROLE: isolated percussion loop; shakers, congas, blocks, bells; no kick/snare/clap/hat.`,
    `Density: ${density}; repeating pattern every bar.`,
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

// Guess the number of channels given the expected sample rate and music length.
function guessChannelsFromLength(pcmBytesLength, sampleRate, musicLengthMs) {
  const expectedFrames = Math.max(1, Math.round(sampleRate * (musicLengthMs / 1000)));
  const bytesPerMono = expectedFrames * 2;
  const bytesPerStereo = expectedFrames * 4;
  if (Math.abs(pcmBytesLength - bytesPerMono) < Math.abs(pcmBytesLength - bytesPerStereo)) {
    return 1;
  }
  return 2;
}

// Convert raw PCM16 bytes to channel arrays.
function convertRawPCMToChans(pcm, channels, sampleRate) {
  const frames = Math.floor(pcm.length / (channels * 2));
  const data = [];
  for (let ch = 0; ch < channels; ch++) {
    data.push(new Float32Array(frames));
  }
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const byteIdx = (i * channels + ch) * 2;
      const int16 = view.getInt16(byteIdx, true);
      data[ch][i] = int16 / 32768.0;
    }
  }
  return { data, length: frames, sr: sampleRate };
}

// Count onsets in a buffer using a simple envelope follower and threshold.
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

// Utility: compute RMS of an array using a stride to keep things light.
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

// Utility: compute a 1-pole low-pass filtered RMS to detect kick energy
// bleeding into the snare stem.  A large ratio between low-band and
// full-band RMS indicates an unwanted kick/thump is present.
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

// Validate a hi-hat buffer: expect ~16 hits per bar; accept if at
// least 80% of expected hits are present.
function validateHihat(buf, bpm, bars) {
  const expected = bars * 16;
  const found = countOnsets(buf, 0.07, 0.35);
  return found >= Math.max(10, Math.round(expected * 0.8));
}

// Validate a snare buffer: ensure hits at beat 2 and 4 of each bar.
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
    if (!hasPeakNear(beat2) || !hasPeakNear(beat4)) {
      return false;
    }
  }
  return true;
}

// Validate a kick buffer: ensure hits at beats 1, 2, 3, 4 of each bar.
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
    for (let beat = 0; beat < 4; beat++) {
      const beatIdx = barStart + Math.round(beat * beatSec * sr);
      if (!hasPeakNear(beatIdx)) {
        return false;
      }
    }
  }
  return true;
}

// Modulo operation that always returns positive results.
function mod(n, m) {
  return ((n % m) + m) % m;
}

// Detect the first significant transient (head) in the audio.
function detectHeadIndexArray(mono, sr) {
  const stepMs = 10;
  const step = Math.max(1, Math.round(stepMs / 1000 * sr));
  let maxEnv = 0;
  for (let i = 0; i < mono.length; i += step) {
    const v = Math.abs(mono[i]);
    if (v > maxEnv) maxEnv = v;
  }
  const thr = maxEnv * 0.15;
  for (let i = 0; i < mono.length; i++) {
    if (Math.abs(mono[i]) >= thr) return i;
  }
  return 0;
}

// Find the best offset that minimizes discontinuity at the seam.
function findBestSeamOffsetArray(mono, headIdx, targetLen, xfadeN, sr) {
  const searchMs = 80;
  const searchN = Math.round(searchMs / 1000 * sr);
  let bestOff = 0;
  let bestScore = Infinity;
  for (let off = -searchN; off <= searchN; off += Math.max(1, Math.round(searchN / 40))) {
    const start = mod(headIdx + off, mono.length);
    let score = 0;
    for (let i = 0; i < xfadeN; i++) {
      const idxA = mod(start + i, mono.length);
      const idxB = mod(start + targetLen - xfadeN + i, mono.length);
      const d = mono[idxA] - mono[idxB];
      score += d * d;
    }
    if (score < bestScore) {
      bestScore = score;
      bestOff = off;
    }
  }
  return bestOff;
}

// Slice and wrap the audio to create a loop of exactly targetLen frames.
function sliceWrapArray(chans, start, targetLen) {
  const out = [];
  for (const ch of chans) {
    const arr = new Float32Array(targetLen);
    for (let i = 0; i < targetLen; i++) {
      arr[i] = ch[mod(start + i, ch.length)];
    }
    out.push(arr);
  }
  return out;
}

// Apply short edge ramps to avoid clicks at loop boundaries.
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

// Apply seam crossfade to ensure seamless looping.
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

// Apply high-pass filter to remove low-frequency contamination.
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

// Convert channel arrays back to a PCM16 WAV.
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
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const sample = Math.max(-1, Math.min(1, chans[c][i]));
      const int16 = Math.round(sample * 32767);
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }

  try {
    const { stem, controls, master } = await req.json();
    const { tempo, bars } = master;
    const root = getRootText(master);
    const mode = master.mode || 'minor';

    const sampleRate = 24000;
    const durationSec = bars * 4 * (60 / tempo);
    const musicLengthMs = durationSec * 1000;

    let rawPCM = null;
    let tier = 0;
    let validated = false;
    let usedPrompt = '';

    for (let strictness = 0; strictness <= 2; strictness++) {
      const prompt = buildStemPrompt(stem, controls, { tempo, bars, root, mode }, strictness);
      usedPrompt = prompt;

      const elevenlabsApiKey = Deno.env.get('ELEVENLABS_API_KEY');
      if (!elevenlabsApiKey) {
        return new Response(JSON.stringify({ error: 'ElevenLabs API key not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const response = await fetch('https://api.elevenlabs.io/v1/music-generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': elevenlabsApiKey
        },
        body: JSON.stringify({
          model: 'music_v1',
          prompt: prompt,
          duration: durationSec
        })
      });

      if (!response.ok) {
        continue;
      }

      const rawBytes = new Uint8Array(await response.arrayBuffer());
      const channels = guessChannelsFromLength(rawBytes.length, sampleRate, musicLengthMs);
      const pcm = convertRawPCMToChans(rawBytes, channels, sampleRate);

      if (stem === 'hihat') {
        validated = validateHihat(pcm, tempo, bars);
      } else if (stem === 'perc') {
        validated = validateSnare(pcm, tempo, bars);
      } else if (stem === 'kick') {
        validated = validateKick(pcm, tempo, bars);
      } else {
        validated = true;
      }

      rawPCM = rawBytes;
      tier = strictness;

      if (validated || strictness >= 2 || (stem !== 'hihat' && stem !== 'perc' && stem !== 'kick')) {
        break;
      }
    }

    if (!rawPCM) {
      return new Response(JSON.stringify({ error: 'Failed to generate audio' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const channels = guessChannelsFromLength(rawPCM.length, sampleRate, musicLengthMs);
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
    applyEdgeRampsArray(trimmed, sampleRate, 5);
    applySeamCrossfadeArray(trimmed, sampleRate, xfadeMs);

    if (stem === 'perc') {
      applyHighPassArray(trimmed, sampleRate, 180);
    }

    const outBytes = makeWavFromPCM16(trimmed, sampleRate);

    let binary = '';
    for(let i = 0; i < outBytes.length; i++) binary += String.fromCharCode(outBytes[i]);
    const b64 = btoa(binary);
    const audio_b64 = `data:audio/wav;base64,${b64}`;

    const responseBody = {
      audio_b64,
      usedPrompt,
      tier,
      validated
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (err) {
    console.error('generate-techno-stem error', err);
    return new Response(JSON.stringify({
      error: 'Internal error',
      details: err?.message || String(err)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
});
