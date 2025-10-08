diff --git a/supabase/functions/generate-techno-stem/index.ts b/supabase/functions/generate-techno-stem/index.ts
index 42292193284c770045ea7847f9ad560768191398..33a1cb04b0d85388e0d2796292a8a78b02e9fd6d 100644
--- a/supabase/functions/generate-techno-stem/index.ts
+++ b/supabase/functions/generate-techno-stem/index.ts
@@ -1,135 +1,136 @@
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
-    basePrompt: 'deep techno kick drum'
+    basePrompt: 'deep TR-909 style techno kick drum'
   },
   perc: {
-    basePrompt: 'industrial techno snare'
+    basePrompt: 'industrial TR-909 techno snare'
   },
   bass: {
     basePrompt: 'dark techno bassline'
   },
   lead: {
     basePrompt: 'hypnotic techno lead synth'
   },
   hihat: {
-    basePrompt: 'crisp techno closed hi-hat'
+    basePrompt: 'crisp TR-909 closed hi-hat'
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
+    'DrumPalette: Roland TR-909 inspired; dry, punchy, fully isolated per stem',
     'Quantization: strict grid (no humanization)',
     'Delivery: instrumental only',
     // Absolute directive reinforcing loop length
     `ABSOLUTE: The loop length must be exactly ${bars} bars at ${tempo} BPM; do not alter the tempo or add/remove bars`,
     // Reinforce constant tempo.  Some users report subtle tempo drift; this
     // statement makes explicit that the BPM cannot vary at all within the
     // loop【690628932457069†L64-L80】.
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
       // For techno, the kick must adhere to a strict four‑on‑the‑floor pattern.  We
       // explicitly instruct the model to place exactly one kick hit on each
       // quarter note (beats 1, 2, 3 and 4) of every bar with no extra hits or
       // fills.  Additional percussion (toms, claps, hats, snares) are
       // explicitly excluded here; we reinforce this again in the negative
       // directives below.  When retrying with higher strictness, the
       // buildStemPrompt function appends stronger ABSOLUTE directives.
       return [
-        'ROLE: single isolated kick only',
+        'ROLE: single isolated kick only (Roland TR-909 voicing)',
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
diff --git a/supabase/functions/generate-techno-stem/index.ts b/supabase/functions/generate-techno-stem/index.ts
index 42292193284c770045ea7847f9ad560768191398..33a1cb04b0d85388e0d2796292a8a78b02e9fd6d 100644
--- a/supabase/functions/generate-techno-stem/index.ts
+++ b/supabase/functions/generate-techno-stem/index.ts
@@ -172,50 +173,51 @@ function negatives(st) {
       // stem.  This includes hi-hats, snares, claps, rimshots, shakers and other
       // percussive elements that are occasionally produced by the Eleven Labs
       // model when the prompt is underspecified.
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
+      'no low-frequency thump',
       'no toms',
       'no melodic percussion',
       'no reverb tail',
       // Exclude any additional drums or percussion (ride, shaker, cymbal) to
       // prevent contamination of the snare stem.  These extra negatives work
       // together with the strict pattern directive to keep the snare loop
       // simple and bar‑perfect.
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
diff --git a/supabase/functions/generate-techno-stem/index.ts b/supabase/functions/generate-techno-stem/index.ts
index 42292193284c770045ea7847f9ad560768191398..33a1cb04b0d85388e0d2796292a8a78b02e9fd6d 100644
--- a/supabase/functions/generate-techno-stem/index.ts
+++ b/supabase/functions/generate-techno-stem/index.ts
@@ -246,93 +248,95 @@ function negatives(st) {
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
+    'Engine: Roland TR-909 closed hat; tight analog noise burst; zero bleed from other drums.',
     g,
     'ROLE: isolated closed hat (no open-hat).',
     'Pattern: strict 1/16 notes; first hit exactly at bar 1 beat 1; consistent every bar.',
     `Tone: ${brightness}; unpitched; short decay (40–120ms).`,
     space,
     'Exclude: ride, shaker, clap, snare, kick, toms, crashes; no melodic content, sweeps, or FX.',
     'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
   ];
   if (strictness === 1) {
-    common.push('ABSOLUTE: Only closed-hat hits on a straight 1/16 grid; zero swing.');
+    common.push('ABSOLUTE: Only closed-hat hits on a straight 1/16 grid; zero swing.', 'ABSOLUTE: Preserve Roland TR-909 closed-hat timbre; no other drums.');
   } else if (strictness >= 2) {
-    common.push('MUST: closed-hat hits on each 1/16 step (16 hits/bar).', 'MUST: zero reverb tail at seam; gate hits before bar end.', 'MUST: exclude open hat, ride, shaker, snare, clap, toms, crashes.');
+    common.push('MUST: closed-hat hits on each 1/16 step (16 hits/bar).', 'MUST: zero reverb tail at seam; gate hits before bar end.', 'MUST: exclude open hat, ride, shaker, snare, clap, toms, crashes.', 'MUST: emulate Roland TR-909 closed-hat spectrum only.');
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
+    'Engine: Roland TR-909 snare circuit; tuned noise burst plus resonant body; keep low-frequency thump minimal.',
     g,
     'ROLE: isolated electronic snare.',
     'Pattern: hits exactly on beats 2 and 4 of every bar (no ghost notes or rolls).',
     `Dynamics: ${intensity}; ${body}`,
     `Variation: ${varTxt} but positions remain 2 & 4.`,
-    'Exclude: clap/rim/kick/hat/shakers/toms/crashes; unpitched; no tails at seam.',
+    'Exclude: clap/rim/kick/hat/shakers/toms/crashes; unpitched; no tails at seam; absolutely no layered kick drum.',
     'Deliver a bar-perfect seamless loop aligned to bar boundaries.'
   ];
   if (strictness === 1) {
-    common.push('ABSOLUTE: only beat 2 and beat 4 per bar; no extra hits.', 'ABSOLUTE: no off-grid timing.');
+    common.push('ABSOLUTE: only beat 2 and beat 4 per bar; no extra hits.', 'ABSOLUTE: no off-grid timing.', 'ABSOLUTE: keep TR-909 snare tone only; do not mix in kick, clap or tom layers.');
   } else if (strictness >= 2) {
-    common.push('MUST: exactly one snare on beat 2 and one on beat 4 per bar, nothing else.', 'MUST: gate decay fully before the seam; exclude clap/rim layers.');
+    common.push('MUST: exactly one snare on beat 2 and one on beat 4 per bar, nothing else.', 'MUST: gate decay fully before the seam; exclude clap/rim layers.', 'MUST: zero kick/bass energy below 150 Hz; pure TR-909 snare body.');
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
diff --git a/supabase/functions/generate-techno-stem/index.ts b/supabase/functions/generate-techno-stem/index.ts
index 42292193284c770045ea7847f9ad560768191398..33a1cb04b0d85388e0d2796292a8a78b02e9fd6d 100644
--- a/supabase/functions/generate-techno-stem/index.ts
+++ b/supabase/functions/generate-techno-stem/index.ts
@@ -382,53 +386,53 @@ function buildPercLoopPrompt(controls, master) {
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
   // Kick also supports strictness tiers.  When strictness is increased,
   // we append absolute directives to the prompt to enforce exactly one
   // kick per beat and prohibit any extra hits.  This helps the model
   // converge on a four‑on‑the‑floor pattern when it produces extra
   // percussion in initial attempts.
   if (st === 'kick') {
     const basePrompt = [
       `STEM: ${st.toUpperCase()} — solo ${stemConfigs[st]?.basePrompt || 'kick'}.`,
       globalScaffold(master),
       roleDirectives(st, controls),
       `Avoid: ${negatives(st)}`,
       'Deliver a bar-perfect loop that aligns exactly with bar boundaries and starts at bar 1 beat 1.'
     ];
     // Strictness tiers add increasingly strong mandates
     if (strictness === 1) {
-      basePrompt.push('ABSOLUTE: Only one kick hit on beats 1, 2, 3 and 4 per bar; no off-grid timing; no additional percussion.');
+      basePrompt.push('ABSOLUTE: Only one kick hit on beats 1, 2, 3 and 4 per bar; no off-grid timing; no additional percussion.', 'ABSOLUTE: Maintain pure Roland TR-909 kick voicing; do not layer snares, claps or bass notes.');
     } else if (strictness >= 2) {
-      basePrompt.push('MUST: exactly four kick hits per bar (beats 1, 2, 3, 4) and nothing else; exclude hi-hats, snares, claps, toms or any other drums; quantization must be perfect.');
+      basePrompt.push('MUST: exactly four kick hits per bar (beats 1, 2, 3, 4) and nothing else; exclude hi-hats, snares, claps, toms or any other drums; quantization must be perfect.', 'MUST: emulate Roland TR-909 kick circuit only; zero additional percussion or bass drones.');
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
 // Guess the number of channels given the expected sample rate and music
 // length.  This mirrors the ElevenLabs proxy implementation.
 function guessChannelsFromLength(pcmBytesLength, sampleRate, musicLengthMs) {
   const expectedFrames = Math.max(1, Math.round(sampleRate * (musicLengthMs / 1000)));
   const bytesPerMono = expectedFrames * 2;
   const bytesPerStereo = expectedFrames * 4;
diff --git a/supabase/functions/generate-techno-stem/index.ts b/supabase/functions/generate-techno-stem/index.ts
index 42292193284c770045ea7847f9ad560768191398..33a1cb04b0d85388e0d2796292a8a78b02e9fd6d 100644
--- a/supabase/functions/generate-techno-stem/index.ts
+++ b/supabase/functions/generate-techno-stem/index.ts
@@ -470,68 +474,105 @@ function convertRawPCMToChans(pcm, channels, sampleRate) {
 // threshold.  Used by hi-hat validation.
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
+
+// Utility: compute RMS of an array using a stride to keep things light.
+function computeRms(data, step = 512) {
+  let sum = 0;
+  let n = 0;
+  for (let i = 0; i < data.length; i += step) {
+    const v = data[i];
+    sum += v * v;
+    n++;
+  }
+  return n > 0 ? Math.sqrt(sum / n) : 0;
+}
+
+// Utility: compute a 1-pole low-pass filtered RMS to detect kick energy
+// bleeding into the snare stem.  A large ratio between low-band and
+// full-band RMS indicates an unwanted kick/thump is present.
+function computeLowBandRms(data, sr, cutoffHz = 180) {
+  if (!data.length) return 0;
+  const dt = 1 / sr;
+  const rc = 1 / (2 * Math.PI * Math.max(10, cutoffHz));
+  const alpha = dt / (rc + dt);
+  let y = 0;
+  let sum = 0;
+  for (let i = 0; i < data.length; i++) {
+    const x = data[i];
+    y = y + alpha * (x - y);
+    sum += y * y;
+  }
+  return Math.sqrt(sum / data.length);
+}
 // Validate a hi-hat buffer: expect ~16 hits per bar; accept if at
 // least 60% of expected hits are present.
 function validateHihat(buf, bpm, bars) {
   const expected = bars * 16;
   const found = countOnsets(buf, 0.07, 0.35);
   // Raise the minimum required onsets to at least 80% of the expected hits.
   // A stricter threshold ensures the hat pattern remains dense and avoids
   // sparse or off‑time loops【721972514835288†L320-L324】.  We still allow a
   // minimum of 10 hits in very short loops to avoid rejecting all outputs.
   return found >= Math.max(10, Math.round(expected * 0.8));
 }
 // Validate a snare buffer: ensure hits at beat 2 and 4 of each bar.
 function validateSnare(buf, bpm, bars) {
   const sr = buf.sr;
   const x = buf.data[0];
   const barSec = 4 * (60 / bpm);
   const beatSec = 60 / bpm;
   const tol = Math.round(40 / 1000 * sr);
+  const fullRms = computeRms(x, 256);
+  if (fullRms > 0) {
+    const lowRms = computeLowBandRms(x, sr, 170);
+    if (lowRms / fullRms > 0.48) {
+      return false;
+    }
+  }
   // Helper to detect a peak near the given sample index.  Computes an
   // RMS in a small window and sets a threshold relative to that RMS.  If
   // any sample exceeds the threshold, we consider a hit present.
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
   // Validate expected hits on beats 2 and 4 for each bar
   for (let bar = 0; bar < bars; bar++) {
     const barStart = Math.round(bar * barSec * sr);
     const beat2 = barStart + Math.round(1 * beatSec * sr);
     const beat4 = barStart + Math.round(3 * beatSec * sr);
diff --git a/supabase/functions/generate-techno-stem/index.ts b/supabase/functions/generate-techno-stem/index.ts
index 42292193284c770045ea7847f9ad560768191398..33a1cb04b0d85388e0d2796292a8a78b02e9fd6d 100644
--- a/supabase/functions/generate-techno-stem/index.ts
+++ b/supabase/functions/generate-techno-stem/index.ts
@@ -738,50 +779,67 @@ function applyEdgeRampsArray(chans, sr, rampMs) {
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
+
+function applyHighPassArray(chans, sr, cutoffHz = 180) {
+  const dt = 1 / sr;
+  const rc = 1 / (2 * Math.PI * Math.max(10, cutoffHz));
+  const alpha = rc / (rc + dt);
+  for (const d of chans) {
+    let prevY = 0;
+    let prevX = d[0] || 0;
+    for (let i = 0; i < d.length; i++) {
+      const x = d[i];
+      const y = alpha * (prevY + x - prevX);
+      d[i] = y;
+      prevY = y;
+      prevX = x;
+    }
+  }
+}
 // Convert channel arrays back to a PCM16 WAV.  Borrowed from loop-fix.
 function makeWavFromPCM16(chans, sr) {
   const ch = chans.length;
   const frames = chans[0].length;
   const blockAlign = ch * 2;
   const dataSize = frames * blockAlign;
   const buffer = new ArrayBuffer(44 + dataSize);
   const view = new DataView(buffer);
   view.setUint32(0, 0x52494646, false) // 'RIFF'
   ;
   view.setUint32(4, 36 + dataSize, true);
   view.setUint32(8, 0x57415645, false) // 'WAVE'
   ;
   view.setUint32(12, 0x666d7420, false) // 'fmt '
   ;
   view.setUint32(16, 16, true);
   view.setUint16(20, 1, true);
   view.setUint16(22, ch, true);
   view.setUint32(24, sr, true);
   view.setUint32(28, sr * blockAlign, true);
   view.setUint16(32, blockAlign, true);
   view.setUint16(34, 16, true);
   view.setUint32(36, 0x64617461, false) // 'data'
   ;
   view.setUint32(40, dataSize, true);
diff --git a/supabase/functions/generate-techno-stem/index.ts b/supabase/functions/generate-techno-stem/index.ts
index 42292193284c770045ea7847f9ad560768191398..33a1cb04b0d85388e0d2796292a8a78b02e9fd6d 100644
--- a/supabase/functions/generate-techno-stem/index.ts
+++ b/supabase/functions/generate-techno-stem/index.ts
@@ -969,60 +1027,80 @@ Deno.serve(async (req)=>{
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
     // Convert raw PCM to channel arrays for trimming
     const pcm = convertRawPCMToChans(rawPCM, channels, sampleRate);
     // Compute trimming parameters
-    const targetFrames = Math.round(bars * 4 * (60 / tempo) * sampleRate);
+    const framesPerBeatFloat = sampleRate * (60 / tempo);
+    const framesPerBeatInt = Math.max(1, Math.round(framesPerBeatFloat));
+    let targetFrames = framesPerBeatInt * 4 * bars;
+    if (targetFrames > pcm.length) {
+      const beatMultiple = Math.max(1, Math.floor(pcm.length / framesPerBeatInt));
+      targetFrames = Math.max(framesPerBeatInt, beatMultiple * framesPerBeatInt);
+    }
     const headIdx = detectHeadIndexArray(pcm.data[0], sampleRate);
     const xfadeMs = 12;
     const xfadeN = Math.max(2, Math.round(xfadeMs / 1000 * sampleRate));
     const bestOff = findBestSeamOffsetArray(pcm.data[0], headIdx, targetFrames, xfadeN, sampleRate);
-    const start = mod(headIdx + bestOff, pcm.length);
+    let start = mod(headIdx + bestOff, pcm.length);
+    const framesPerBeat = framesPerBeatFloat;
+    if (Number.isFinite(framesPerBeat) && framesPerBeat > 0) {
+      const quantStart = Math.round(start / framesPerBeat) * framesPerBeat;
+      if (Number.isFinite(quantStart) && Math.abs(quantStart - start) <= framesPerBeat * 0.35) {
+        start = Math.max(0, Math.min(pcm.length - 1, Math.round(quantStart)));
+      } else {
+        start = Math.round(start);
+      }
+    } else {
+      start = Math.round(start);
+    }
     const trimmed = sliceWrapArray(pcm.data, start, targetFrames);
     // Apply ramps and crossfade
     applyEdgeRampsArray(trimmed, sampleRate, 5);
     applySeamCrossfadeArray(trimmed, sampleRate, xfadeMs);
+    if (stem === 'perc') {
+      applyHighPassArray(trimmed, sampleRate, 180);
+    }
     const outBytes = makeWavFromPCM16(trimmed, sampleRate);
     // Encode to base64
     let binary = '';
     for(let i = 0; i < outBytes.length; i++)binary += String.fromCharCode(outBytes[i]);
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
