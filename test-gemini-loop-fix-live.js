/**
 * Test Gemini Loop Fix Functionality
 *
 * This script tests the loop-fix-gemini edge function to ensure:
 * 1. The function is deployed and accessible
 * 2. Gemini API integration works
 * 3. WSOLA time-stretching is applied correctly
 * 4. Diagnostics are returned properly
 */

import { readFileSync } from 'fs';

// Load environment variables manually
const envContent = readFileSync('.env', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    env[key.trim()] = valueParts.join('=').trim();
  }
});

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const GEMINI_API_KEY = env.GEMINI_API_KEY;

// Check if environment variables are set
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY not set - Gemini features will not work');
}

/**
 * Generate a simple test WAV file (sine wave at 130 BPM)
 */
function generateTestWav(durationSeconds = 8, sampleRate = 44100, frequency = 130) {
  // Calculate samples
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const numChannels = 2;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const fileSize = 44 + dataSize;

  // Create buffer
  const buffer = Buffer.alloc(fileSize);

  // Write RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write('WAVE', 8);

  // Write fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Chunk size
  buffer.writeUInt16LE(1, 20);  // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // Write data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Generate sine wave with kick drum pattern (4/4 time)
  let offset = 44;
  const beatsPerSecond = frequency / 60;
  const samplesPerBeat = sampleRate / beatsPerSecond;

  for (let i = 0; i < numSamples; i++) {
    // Calculate beat position (4 beats per bar)
    const beatPosition = (i / samplesPerBeat) % 4;

    // Generate kick drum envelope (attack on beat 1 and 3)
    let amplitude = 0;
    if (beatPosition < 0.1 || (beatPosition >= 2 && beatPosition < 2.1)) {
      // Kick drum (exponential decay)
      const beatTime = beatPosition < 0.1 ? beatPosition : beatPosition - 2;
      amplitude = Math.exp(-beatTime * 30) * 0.8;
    }

    // Add sine wave bass
    amplitude += Math.sin(2 * Math.PI * 65 * i / sampleRate) * 0.2;

    // Convert to 16-bit integer
    const sample = Math.max(-32768, Math.min(32767, Math.floor(amplitude * 32767)));

    // Write stereo (same for both channels)
    buffer.writeInt16LE(sample, offset);
    buffer.writeInt16LE(sample, offset + 2);
    offset += 4;
  }

  return buffer;
}

/**
 * Test the loop-fix-gemini function
 */
async function testLoopFixGemini() {
  console.log('🎵 Testing Gemini Loop Fix\n');
  console.log('═══════════════════════════════════════════════\n');

  // Test 1: Check function availability
  console.log('Test 1: Checking function availability...');
  const functionUrl = `${SUPABASE_URL}/functions/v1/loop-fix-gemini`;
  console.log(`  URL: ${functionUrl}`);

  // Test 2: Generate test audio
  console.log('\nTest 2: Generating test audio...');
  const testWav = generateTestWav(8, 44100, 128.5); // Slightly off-tempo (128.5 BPM instead of 130)
  console.log(`  ✓ Generated ${testWav.length} bytes of test audio`);
  console.log(`  ✓ Audio: 8 seconds @ 128.5 BPM (will be stretched to 130 BPM)`);

  // Test 3: Call loop-fix-gemini
  console.log('\nTest 3: Calling loop-fix-gemini function...');
  const audio_base64 = testWav.toString('base64');

  const startTime = Date.now();

  try {
    const response = await fetch(functionUrl, {
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

    const elapsedTime = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`  ❌ Request failed: ${response.status}`);
      console.error(`  Error: ${errorText}`);
      return false;
    }

    console.log(`  ✓ Request successful (${response.status})`);
    console.log(`  ✓ Response time: ${elapsedTime}ms`);

    // Test 4: Parse response
    console.log('\nTest 4: Parsing response...');
    const result = await response.json();

    if (!result.fixed_audio_base64) {
      console.error('  ❌ No audio data in response');
      return false;
    }

    console.log(`  ✓ Received fixed audio: ${result.fixed_audio_base64.length} bytes (base64)`);

    // Test 5: Parse diagnostics
    console.log('\nTest 5: Checking diagnostics...');
    const diagnosticsHeader = response.headers.get('X-LoopFix-Diagnostics');

    if (!diagnosticsHeader) {
      console.error('  ❌ No diagnostics header found');
      return false;
    }

    const diagnostics = JSON.parse(diagnosticsHeader);
    console.log('  ✓ Diagnostics received:');
    console.log(`\n  ╔════════════════════════════════════════════`);
    console.log(`  ║ GEMINI LOOP FIX DIAGNOSTICS`);
    console.log(`  ╠════════════════════════════════════════════`);
    console.log(`  ║ Gemini Used:        ${diagnostics.gemini_used ? '✓ YES' : '✗ NO (fallback)'}`);

    if (diagnostics.gemini_used) {
      console.log(`  ║ Detected BPM:       ${diagnostics.detected_bpm} BPM`);
      console.log(`  ║ Confidence:         ${(diagnostics.confidence * 100).toFixed(1)}%`);
      console.log(`  ║ Stretch Ratio:      ${diagnostics.stretch_ratio?.toFixed(3)}x`);
      console.log(`  ║ `);
      console.log(`  ║ Processing Times:`);
      console.log(`  ║   • Gemini API:     ${diagnostics.gemini_call_ms}ms`);
      console.log(`  ║   • WSOLA:          ${diagnostics.wsola_process_ms}ms`);
      console.log(`  ║   • Total:          ${diagnostics.total_process_ms}ms`);
      console.log(`  ║ `);
      console.log(`  ║ Audio Processing:`);
      console.log(`  ║   • Original:       ${diagnostics.original_duration_frames} frames`);
      console.log(`  ║   • Target:         ${diagnostics.target_duration_frames} frames`);
      console.log(`  ║   • Head trim:      ${diagnostics.head_trim_frames} frames`);
      console.log(`  ║   • Seam location:  ${diagnostics.seam_location_frames} frames`);
      console.log(`  ║   • Fade samples:   ${diagnostics.fade_samples} samples`);
    } else {
      console.log(`  ║ Gemini Error:       ${diagnostics.gemini_error || 'Unknown'}`);
      console.log(`  ║ Used fallback:      Heuristic method`);
    }

    console.log(`  ╚════════════════════════════════════════════\n`);

    // Test 6: Validate results
    console.log('Test 6: Validating results...');

    const tests = [];

    // Check if Gemini was used
    if (diagnostics.gemini_used) {
      tests.push({ name: 'Gemini AI used', passed: true });

      // Check BPM detection
      if (diagnostics.detected_bpm) {
        const bpmDiff = Math.abs(diagnostics.detected_bpm - 128.5);
        tests.push({
          name: 'BPM detection accuracy',
          passed: bpmDiff < 2,
          detail: `Detected ${diagnostics.detected_bpm} BPM (expected ~128.5)`
        });
      }

      // Check confidence
      if (diagnostics.confidence) {
        tests.push({
          name: 'Confidence score',
          passed: diagnostics.confidence >= 0.6,
          detail: `${(diagnostics.confidence * 100).toFixed(1)}% (threshold: 60%)`
        });
      }

      // Check WSOLA was applied
      if (diagnostics.wsola_process_ms > 0) {
        tests.push({
          name: 'WSOLA time-stretching applied',
          passed: true,
          detail: `Processed in ${diagnostics.wsola_process_ms}ms`
        });
      }

      // Check stretch ratio is reasonable
      if (diagnostics.stretch_ratio) {
        const ratioValid = diagnostics.stretch_ratio >= 0.85 && diagnostics.stretch_ratio <= 1.15;
        tests.push({
          name: 'Stretch ratio within safe range',
          passed: ratioValid,
          detail: `${diagnostics.stretch_ratio.toFixed(3)}x (safe: 0.85-1.15x)`
        });
      }
    } else {
      tests.push({
        name: 'Gemini AI used',
        passed: false,
        detail: `Fallback used: ${diagnostics.gemini_error || 'Unknown reason'}`
      });
    }

    // Check timing
    tests.push({
      name: 'Total processing time acceptable',
      passed: diagnostics.total_process_ms < 10000,
      detail: `${diagnostics.total_process_ms}ms (< 10 seconds)`
    });

    // Check audio was processed
    tests.push({
      name: 'Audio processed',
      passed: diagnostics.target_duration_frames > 0,
      detail: `${diagnostics.target_duration_frames} frames`
    });

    // Print validation results
    console.log('');
    tests.forEach(test => {
      const icon = test.passed ? '✓' : '✗';
      const status = test.passed ? 'PASS' : 'FAIL';
      console.log(`  ${icon} ${test.name}: ${status}`);
      if (test.detail) {
        console.log(`    ${test.detail}`);
      }
    });

    const allPassed = tests.every(t => t.passed);

    console.log('\n═══════════════════════════════════════════════\n');

    if (allPassed) {
      console.log('✅ ALL TESTS PASSED - Gemini Loop Fix is working correctly!\n');
      return true;
    } else {
      console.log('⚠️  SOME TESTS FAILED - See details above\n');
      return false;
    }

  } catch (error) {
    console.error(`\n❌ Test failed with error:`);
    console.error(`  ${error.message}`);
    if (error.stack) {
      console.error(`\nStack trace:`);
      console.error(error.stack);
    }
    return false;
  }
}

// Run the test
testLoopFixGemini()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
