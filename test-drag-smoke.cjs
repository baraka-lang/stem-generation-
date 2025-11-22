#!/usr/bin/env node
/**
 * Drag Smoke Test - Validates drag preparation without requiring DAW
 * Run: node test-drag-smoke.cjs
 *
 * This test validates the complete drag-and-drop pipeline:
 * 1. UAC detection (Windows)
 * 2. PCM generation and WAV wrapping
 * 3. Atomic write with fsync
 * 4. File validation and WAV header check
 * 5. File ready for webContents.startDrag()
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

// Import utilities (must be after electron-utils.cjs is created)
let utils
try {
  utils = require('./electron-utils.cjs')
} catch (err) {
  console.error('❌ Failed to load electron-utils.cjs')
  console.error('   Make sure electron-utils.cjs exists in the project root')
  process.exit(1)
}

const { validateWavHeader, ensureFileReady, isProcessElevated } = utils

/**
 * Generate test PCM data (1 second of 440Hz sine wave)
 */
function generateTestPCM(sampleRate = 44100, durationSec = 1) {
  const numSamples = sampleRate * durationSec
  const pcm = Buffer.alloc(numSamples * 2 * 2) // 16-bit stereo

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const sample = Math.sin(2 * Math.PI * 440 * t) * 0.5
    const intSample = Math.round(sample * 32767)

    // Write stereo (left and right)
    pcm.writeInt16LE(intSample, i * 4)
    pcm.writeInt16LE(intSample, i * 4 + 2)
  }

  return pcm
}

/**
 * Wrap PCM to WAV (16-bit S16LE format)
 */
function wrapPCMToWAV(pcmBuffer, sampleRate, numChannels) {
  const bitsPerSample = 16
  const blockAlign = numChannels * (bitsPerSample / 8)
  const byteRate = sampleRate * blockAlign
  const dataSize = pcmBuffer.length

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM format
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, pcmBuffer])
}

/**
 * Run all smoke tests
 */
async function runTests() {
  console.log('🧪 Drag Smoke Test - DAW Drop Validation\n')
  console.log('=' .repeat(60))

  const testDir = path.join(os.tmpdir(), 'drag-test')
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true })
  }

  let passed = 0
  let failed = 0

  // Test 1: UAC Detection
  console.log('\n[Test 1] UAC Detection (Windows only)')
  console.log('-'.repeat(60))
  try {
    const elevation = isProcessElevated()
    console.log(`  Platform: ${process.platform}`)
    console.log(`  Elevated: ${elevation.elevated}`)
    console.log(`  Method: ${elevation.method}`)

    if (elevation.elevated && process.platform === 'win32') {
      console.warn('  ⚠️  WARNING: Running as Administrator!')
      console.warn('  ⚠️  DAW drag may fail if DAW is not also elevated')
    } else {
      console.log('  ✅ Not elevated (recommended for DAW compatibility)')
    }
    passed++
  } catch (err) {
    console.error(`  ❌ FAILED: ${err.message}`)
    failed++
  }

  // Test 2: PCM Generation
  console.log('\n[Test 2] PCM Generation (1s @ 44.1kHz)')
  console.log('-'.repeat(60))
  let pcmData
  try {
    pcmData = generateTestPCM(44100, 1)
    console.log(`  Generated: ${(pcmData.length / 1024).toFixed(1)}KB PCM`)
    console.log(`  Format: S16LE stereo`)
    console.log(`  ✅ PCM generation successful`)
    passed++
  } catch (err) {
    console.error(`  ❌ FAILED: ${err.message}`)
    failed++
    process.exit(1)
  }

  // Test 3: WAV Wrapping (no resampling)
  console.log('\n[Test 3] WAV Wrapping (no resampling)')
  console.log('-'.repeat(60))
  let wavData
  try {
    wavData = wrapPCMToWAV(pcmData, 44100, 2)
    console.log(`  Wrapped: ${(wavData.length / 1024).toFixed(1)}KB WAV`)
    console.log(`  Header: 44 bytes + ${pcmData.length} bytes data`)
    console.log(`  ✅ WAV wrapping successful (no resampling)`)
    passed++
  } catch (err) {
    console.error(`  ❌ FAILED: ${err.message}`)
    failed++
    process.exit(1)
  }

  // Test 4: Atomic Write with fsync
  console.log('\n[Test 4] Atomic Write Pattern (.part → rename)')
  console.log('-'.repeat(60))
  const tempPath = path.join(testDir, '.part-test.wav')
  const finalPath = path.join(testDir, 'test-drag-smoke.wav')
  try {
    const writeStart = Date.now()

    // Write to .part file
    fs.writeFileSync(tempPath, wavData)

    // Flush to disk (fsync)
    const tempFd = fs.openSync(tempPath, 'r+')
    fs.fsyncSync(tempFd)
    fs.closeSync(tempFd)

    const writeElapsed = Date.now() - writeStart
    console.log(`  Wrote: ${tempPath}`)
    console.log(`  Size: ${(wavData.length / 1024).toFixed(1)}KB`)
    console.log(`  Time: ${writeElapsed}ms (with fsync)`)
    console.log(`  ✅ Atomic write successful`)
    passed++
  } catch (err) {
    console.error(`  ❌ FAILED: ${err.message}`)
    failed++
    process.exit(1)
  }

  // Test 5: File Validation
  console.log('\n[Test 5] File Readiness Check')
  console.log('-'.repeat(60))
  try {
    const readyCheck = ensureFileReady(tempPath, wavData.length)
    if (readyCheck.ready) {
      console.log(`  File exists: ✓`)
      console.log(`  Size match: ✓ ${readyCheck.stats.size} bytes`)
      console.log(`  Can open: ✓`)
      console.log(`  ✅ File ready for drag`)
      passed++
    } else {
      throw new Error(readyCheck.error)
    }
  } catch (err) {
    console.error(`  ❌ FAILED: ${err.message}`)
    failed++
    process.exit(1)
  }

  // Test 6: WAV Header Validation
  console.log('\n[Test 6] WAV Header Validation')
  console.log('-'.repeat(60))
  try {
    const headerCheck = validateWavHeader(tempPath)
    if (headerCheck.valid) {
      const { numChannels, sampleRate, bitsPerSample, dataSize } = headerCheck.details
      console.log(`  RIFF/WAVE/fmt /data: ✓`)
      console.log(`  PCM format (1): ✓`)
      console.log(`  Sample rate: ${sampleRate}Hz`)
      console.log(`  Channels: ${numChannels}`)
      console.log(`  Bits/sample: ${bitsPerSample}`)
      console.log(`  Data size: ${dataSize} bytes`)
      console.log(`  ✅ WAV header valid`)
      passed++
    } else {
      throw new Error(headerCheck.error)
    }
  } catch (err) {
    console.error(`  ❌ FAILED: ${err.message}`)
    failed++
    process.exit(1)
  }

  // Test 7: Atomic Rename
  console.log('\n[Test 7] Atomic Rename to Final Path')
  console.log('-'.repeat(60))
  try {
    if (fs.existsSync(finalPath)) {
      fs.unlinkSync(finalPath)
    }
    fs.renameSync(tempPath, finalPath)
    console.log(`  Renamed: ${path.basename(tempPath)} → ${path.basename(finalPath)}`)
    console.log(`  ✅ Atomic rename successful`)
    passed++
  } catch (err) {
    console.error(`  ❌ FAILED: ${err.message}`)
    failed++
    process.exit(1)
  }

  // Test 8: Final Validation
  console.log('\n[Test 8] Final File Validation')
  console.log('-'.repeat(60))
  try {
    const finalCheck = ensureFileReady(finalPath, wavData.length)
    const finalHeader = validateWavHeader(finalPath)

    if (finalCheck.ready && finalHeader.valid) {
      console.log(`  File ready: ✓`)
      console.log(`  Header valid: ✓`)
      console.log(`  Size: ${(finalCheck.stats.size / 1024).toFixed(1)}KB`)
      console.log(`  Path: ${finalPath}`)
      console.log(`  ✅ File ready for webContents.startDrag()`)
      passed++
    } else {
      throw new Error('Final validation failed')
    }
  } catch (err) {
    console.error(`  ❌ FAILED: ${err.message}`)
    failed++
    process.exit(1)
  }

  // Cleanup
  console.log('\n[Cleanup] Removing test files')
  console.log('-'.repeat(60))
  try {
    fs.unlinkSync(finalPath)
    console.log(`  Removed: ${finalPath}`)
    console.log(`  ✅ Cleanup complete`)
    passed++
  } catch (err) {
    console.warn(`  ⚠️  Cleanup warning: ${err.message}`)
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log(`\n✅ All ${passed} tests passed!`)

  if (failed > 0) {
    console.log(`❌ ${failed} tests failed`)
    process.exit(1)
  }

  console.log('\n📋 Summary:')
  console.log('  - UAC detection working')
  console.log('  - PCM → WAV wrapping correct (no resampling)')
  console.log('  - Atomic write with fsync successful')
  console.log('  - File validation passing')
  console.log('  - WAV header structure valid')
  console.log('  - Files ready for Electron startDrag()')
  console.log('\n🎯 This pipeline is ready for DAW drops!')
}

// Run tests
runTests().catch(err => {
  console.error('\n❌ Test suite failed:', err)
  process.exit(1)
})
