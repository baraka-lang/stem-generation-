#!/usr/bin/env node

/**
 * Test script for Gemini-assisted loop fix
 *
 * This script tests the loop-fix-gemini edge function by:
 * 1. Generating a simple test WAV file
 * 2. Calling the loop-fix-gemini function
 * 3. Checking if Gemini analysis was used
 * 4. Displaying diagnostics
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    env[match[1].trim()] = match[2].trim();
  }
});

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const GEMINI_API_KEY = env.GEMINI_API_KEY;

console.log('🔍 Testing Gemini-Assisted Loop Fix\n');
console.log('Configuration:');
console.log(`  Supabase URL: ${SUPABASE_URL}`);
console.log(`  Gemini API Key: ${GEMINI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
console.log(`  Use Gemini: ${env.VITE_USE_GEMINI_LOOP_FIX}\n`);

if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your-gemini-api-key-here') {
  console.error('❌ GEMINI_API_KEY is not properly configured in .env');
  console.error('   Get your key from: https://aistudio.google.com/app/apikey\n');
  process.exit(1);
}

/**
 * Generate a simple test WAV file (440Hz tone, 8 seconds, 44100Hz, mono)
 */
function generateTestWav() {
  const sampleRate = 44100;
  const duration = 8; // 8 seconds
  const frequency = 440; // A4 note
  const numSamples = sampleRate * duration;

  // Create WAV header
  const buffer = Buffer.alloc(44 + numSamples * 2);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // audio format (PCM)
  buffer.writeUInt16LE(1, 22); // num channels (mono)
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  // Generate sine wave with kick-like envelope (stronger beats every 4)
  const bpm = 128;
  const beatsPerSecond = bpm / 60;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const beatPhase = (t * beatsPerSecond) % 1;
    const beatIndex = Math.floor(t * beatsPerSecond);

    // Create kick-like pattern (emphasize every 4th beat)
    let amplitude = 0;
    if (beatPhase < 0.1) {
      const isDownbeat = beatIndex % 4 === 0;
      const kickDecay = Math.exp(-beatPhase * 30);
      const kickFreq = 60 + 100 * (1 - beatPhase * 10);
      amplitude = Math.sin(2 * Math.PI * kickFreq * beatPhase) * kickDecay * (isDownbeat ? 0.8 : 0.5);
    }

    // Add hi-hat like pattern
    if (beatPhase > 0.25 && beatPhase < 0.27) {
      amplitude += Math.random() * 0.15 - 0.075;
    }

    const sample = Math.max(-1, Math.min(1, amplitude));
    const intSample = Math.round(sample * 32767);
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

/**
 * Test the loop-fix-gemini edge function
 */
async function testLoopFixGemini() {
  console.log('📝 Step 1: Generating test WAV file...');
  const testWav = generateTestWav();
  console.log(`   Generated ${testWav.length} bytes (8 seconds @ 44.1kHz)\n`);

  console.log('📤 Step 2: Calling loop-fix-gemini edge function...');
  const audio_base64 = testWav.toString('base64');

  const startTime = Date.now();

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/loop-fix-gemini`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_base64,
        target_bpm: 130,
        bars: 4,
        use_gemini: true
      })
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`\n❌ Edge function failed: ${response.status}`);
      console.error(`   Error: ${errorText}\n`);
      return false;
    }

    const result = await response.json();
    const diagnosticsHeader = response.headers.get('X-LoopFix-Diagnostics');

    console.log(`   ✓ Response received in ${elapsed}ms\n`);

    if (diagnosticsHeader) {
      console.log('📊 Step 3: Analyzing diagnostics...');
      const diagnostics = JSON.parse(diagnosticsHeader);

      console.log('\n┌─────────────────────────────────────────────────────┐');
      console.log('│         GEMINI LOOP FIX DIAGNOSTICS                 │');
      console.log('└─────────────────────────────────────────────────────┘\n');

      console.log(`  🤖 Gemini Used:        ${diagnostics.gemini_used ? '✓ YES' : '✗ NO (Fallback)'}`);

      if (diagnostics.gemini_used) {
        console.log(`  🎵 Detected BPM:       ${diagnostics.detected_bpm?.toFixed(2) || 'N/A'}`);
        console.log(`  🎯 Target BPM:         130.00`);
        console.log(`  📊 Confidence:         ${((diagnostics.confidence || 0) * 100).toFixed(1)}%`);
        console.log(`  ⚡ Stretch Ratio:      ${diagnostics.stretch_ratio?.toFixed(3) || 'N/A'}`);
        console.log(`  📍 Start Frame:        ${diagnostics.suggested_start_frame || 'N/A'}`);
        console.log(`  🔗 Seam Frame:         ${diagnostics.seam_frame || 'N/A'}`);
        console.log(`\n  ⏱️  Timing:`);
        console.log(`     - Gemini Call:      ${diagnostics.gemini_call_ms?.toFixed(0) || 'N/A'}ms`);
        console.log(`     - WSOLA Process:    ${diagnostics.wsola_process_ms?.toFixed(0) || 'N/A'}ms`);
        console.log(`     - Total:            ${diagnostics.total_process_ms?.toFixed(0) || 'N/A'}ms`);
      } else {
        console.log(`  ⚠️  Fallback Reason:   ${diagnostics.gemini_error || 'Unknown'}`);
        console.log(`  ⏱️  Total Time:        ${diagnostics.total_process_ms?.toFixed(0) || 'N/A'}ms`);
      }

      console.log('\n  📏 Audio Metrics:');
      console.log(`     - Original Frames:  ${diagnostics.original_duration_frames || 'N/A'}`);
      console.log(`     - Target Frames:    ${diagnostics.target_duration_frames || 'N/A'}`);
      console.log(`     - Head Trim:        ${diagnostics.head_trim_frames || 'N/A'} frames`);
      console.log(`     - Seam Location:    ${diagnostics.seam_location_frames || 'N/A'} frames`);
      console.log(`     - Fade Samples:     ${diagnostics.fade_samples || 'N/A'}`);

      console.log('\n');

      if (diagnostics.gemini_used) {
        console.log('✅ SUCCESS: Gemini-assisted loop fix is working!\n');
        return true;
      } else {
        console.log('⚠️  WARNING: Gemini fallback occurred. Check logs above.\n');
        return false;
      }
    } else {
      console.log('⚠️  No diagnostics header found in response\n');
      return false;
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    return false;
  }
}

/**
 * Test the generate-techno-stem function with Gemini integration
 */
async function testGenerateStem() {
  console.log('\n════════════════════════════════════════════════════════\n');
  console.log('🎹 Testing generate-techno-stem with Gemini integration\n');

  const startTime = Date.now();

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-techno-stem`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stem: 'kick',
        controls: {},
        master: {
          tempo: 130,
          bars: 4,
          rootBase: 'A',
          accidental: 'natural',
          mode: 'Minor'
        },
        use_gemini: true
      })
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Edge function failed: ${response.status}`);
      console.error(`   Error: ${errorText}\n`);
      return false;
    }

    const result = await response.json();

    console.log(`✓ Response received in ${elapsed}ms\n`);
    console.log(`  🎵 Stem Type:          ${result.validated ? '✓' : '✗'} Validated`);
    console.log(`  🔧 Loop Method:        ${result.loopMethod || 'N/A'}`);
    console.log(`  📊 Tier:               ${result.tier}`);
    console.log(`  🎚️  Format:             ${result.format}`);
    console.log(`  🔊 Sample Rate:        ${result.sampleRate}Hz`);
    console.log(`  📻 Channels:           ${result.channels}\n`);

    if (result.loopMethod === 'gemini') {
      console.log('✅ SUCCESS: generate-techno-stem is using Gemini loop fix!\n');
      return true;
    } else {
      console.log(`⚠️  WARNING: Loop method is "${result.loopMethod}" (expected "gemini")\n`);
      return false;
    }

  } catch (error) {
    console.error(`❌ Error: ${error.message}\n`);
    return false;
  }
}

// Run tests
(async () => {
  console.log('════════════════════════════════════════════════════════\n');

  const loopFixResult = await testLoopFixGemini();

  // Only test generate-techno-stem if loop-fix-gemini worked
  if (loopFixResult) {
    const generateStemResult = await testGenerateStem();

    if (generateStemResult) {
      console.log('════════════════════════════════════════════════════════');
      console.log('✅ ALL TESTS PASSED!');
      console.log('   Gemini-assisted loop fix is fully operational.');
      console.log('════════════════════════════════════════════════════════\n');
      process.exit(0);
    }
  }

  console.log('════════════════════════════════════════════════════════');
  console.log('⚠️  TESTS INCOMPLETE');
  console.log('   Check the error messages above for details.');
  console.log('════════════════════════════════════════════════════════\n');
  process.exit(1);
})();
