/**
 * DAW Drag Inspector Utility
 * Diagnostic tool to analyze drag operations and identify DAW compatibility issues
 *
 * Usage: node daw-drag-inspector.cjs <path-to-wav-file>
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

function inspectWavFile(filePath) {
  console.log('\n========================================')
  console.log('DAW DRAG INSPECTOR')
  console.log('========================================\n')

  const results = {
    file: {
      path: filePath,
      exists: false,
      size: 0,
      readable: false,
      permissions: null
    },
    wav: {
      valid: false,
      format: null,
      sampleRate: null,
      channels: null,
      bitsPerSample: null,
      hasBWF: false
    },
    platform: {
      os: process.platform,
      quarantine: null,
      fileType: null
    },
    compatibility: {
      chromium: null,
      ableton: null,
      logic: null,
      flstudio: null
    }
  }

  // 1. File existence and basic stats
  console.log('1. FILE CHECKS')
  console.log('---------------')

  if (!fs.existsSync(filePath)) {
    console.log('❌ File does not exist')
    return results
  }
  results.file.exists = true
  console.log('✓ File exists')

  const stats = fs.statSync(filePath)
  results.file.size = stats.size
  console.log(`✓ Size: ${(stats.size / 1024).toFixed(2)} KB`)

  // Test readability
  try {
    const fd = fs.openSync(filePath, 'r')
    fs.closeSync(fd)
    results.file.readable = true
    console.log('✓ File is readable')
  } catch (err) {
    console.log(`❌ File not readable: ${err.message}`)
    return results
  }

  // Permissions
  const mode = stats.mode & parseInt('777', 8)
  results.file.permissions = mode.toString(8)
  console.log(`✓ Permissions: ${results.file.permissions}`)
  if (results.file.permissions !== '644' && results.file.permissions !== '666') {
    console.log(`  ⚠️  Recommended: 644 for DAW compatibility`)
  }

  // 2. WAV Format Validation
  console.log('\n2. WAV FORMAT')
  console.log('---------------')

  const header = Buffer.alloc(1024) // Read more to check for BWF
  const fd = fs.openSync(filePath, 'r')
  fs.readSync(fd, header, 0, 1024, 0)
  fs.closeSync(fd)

  const riff = header.toString('ascii', 0, 4)
  const wave = header.toString('ascii', 8, 12)
  const fmt = header.toString('ascii', 12, 16)

  if (riff !== 'RIFF' || wave !== 'WAVE') {
    console.log('❌ Not a valid WAV file')
    return results
  }
  console.log('✓ Valid RIFF/WAVE header')

  const audioFormat = header.readUInt16LE(20)
  const numChannels = header.readUInt16LE(22)
  const sampleRate = header.readUInt32LE(24)
  const bitsPerSample = header.readUInt16LE(34)

  results.wav.valid = true
  results.wav.format = audioFormat === 1 ? 'PCM' : `Unknown (${audioFormat})`
  results.wav.sampleRate = sampleRate
  results.wav.channels = numChannels
  results.wav.bitsPerSample = bitsPerSample

  console.log(`✓ Format: ${results.wav.format}`)
  console.log(`✓ Sample Rate: ${sampleRate} Hz`)
  console.log(`✓ Channels: ${numChannels}`)
  console.log(`✓ Bit Depth: ${bitsPerSample} bits`)

  if (audioFormat !== 1) {
    console.log('  ⚠️  DAWs prefer PCM format (format code 1)')
  }

  // Check for BWF (bext chunk)
  const headerStr = header.toString('ascii', 0, 1024)
  if (headerStr.includes('bext')) {
    results.wav.hasBWF = true
    console.log('✓ BWF metadata (bext chunk) present - EXCELLENT for DAWs!')
  } else {
    console.log('⚠️  No BWF metadata - DAWs prefer Broadcast Wave Format')
  }

  // 3. Platform-Specific Checks
  console.log('\n3. PLATFORM CHECKS')
  console.log('-------------------')

  if (process.platform === 'darwin') {
    // macOS: Check quarantine attribute
    try {
      const xattrOutput = execSync(`xattr "${filePath}" 2>/dev/null || echo ""`, {
        encoding: 'utf8',
        timeout: 2000
      })

      if (xattrOutput.includes('com.apple.quarantine')) {
        results.platform.quarantine = true
        console.log('❌ CRITICAL: Quarantine attribute present!')
        console.log('   This BLOCKS Ableton, Logic, and most DAWs from accepting drag')
        console.log(`   FIX: xattr -d com.apple.quarantine "${filePath}"`)
      } else {
        results.platform.quarantine = false
        console.log('✓ No quarantine attribute (good)')
      }
    } catch (err) {
      console.log('⚠️  Could not check quarantine attribute')
    }

    // Check file type
    try {
      const typeOutput = execSync(`file "${filePath}"`, {
        encoding: 'utf8',
        timeout: 2000
      }).trim()
      results.platform.fileType = typeOutput
      console.log(`✓ File type: ${typeOutput}`)
    } catch {}
  } else if (process.platform === 'win32') {
    console.log('✓ Windows platform')

    // Check path length
    if (filePath.length > 260) {
      console.log('❌ CRITICAL: Path exceeds MAX_PATH (260 chars)')
      console.log(`   Current length: ${filePath.length}`)
      console.log('   This causes issues with many Windows DAWs')
    } else {
      console.log(`✓ Path length OK (${filePath.length} chars)`)
    }

    // Check for network/UNC path
    if (filePath.startsWith('\\\\')) {
      console.log('⚠️  UNC/Network path - some DAWs have issues with these')
    }
  }

  // 4. DAW Compatibility Assessment
  console.log('\n4. DAW COMPATIBILITY')
  console.log('---------------------')

  let abletonScore = 100
  let logicScore = 100
  let flScore = 100

  // Deduct points for issues
  if (!results.wav.hasBWF) {
    abletonScore -= 20
    logicScore -= 20
    flScore -= 10
    console.log('⚠️  Missing BWF metadata (-20 Ableton, -20 Logic, -10 FL)')
  }

  if (results.platform.quarantine === true) {
    abletonScore -= 80
    logicScore -= 80
    flScore -= 50
    console.log('❌ Quarantine attribute (-80 Ableton, -80 Logic, -50 FL)')
  }

  if (results.wav.format !== 'PCM') {
    abletonScore -= 50
    logicScore -= 50
    flScore -= 50
    console.log('❌ Non-PCM format (-50 all DAWs)')
  }

  if (results.file.permissions !== '644' && results.file.permissions !== '666') {
    abletonScore -= 10
    logicScore -= 10
    flScore -= 10
    console.log('⚠️  Non-standard permissions (-10 all DAWs)')
  }

  results.compatibility.ableton = abletonScore
  results.compatibility.logic = logicScore
  results.compatibility.flstudio = flScore

  console.log(`\nAbleton Live:  ${abletonScore}% ${getScoreEmoji(abletonScore)}`)
  console.log(`Logic Pro:     ${logicScore}% ${getScoreEmoji(logicScore)}`)
  console.log(`FL Studio:     ${flScore}% ${getScoreEmoji(flScore)}`)

  // 5. Recommendations
  console.log('\n5. RECOMMENDATIONS')
  console.log('-------------------')

  const fixes = []

  if (results.platform.quarantine === true) {
    fixes.push({
      priority: 'CRITICAL',
      issue: 'Quarantine attribute prevents DAW drag',
      fix: `xattr -d com.apple.quarantine "${filePath}"`
    })
  }

  if (!results.wav.hasBWF) {
    fixes.push({
      priority: 'HIGH',
      issue: 'Missing BWF metadata',
      fix: 'Regenerate file with Broadcast Wave Format (bext chunk)'
    })
  }

  if (results.file.permissions !== '644') {
    fixes.push({
      priority: 'MEDIUM',
      issue: 'Non-standard permissions',
      fix: `chmod 644 "${filePath}"`
    })
  }

  if (fixes.length === 0) {
    console.log('✓ File appears to be DAW-ready!')
    console.log('\nIf drag still fails:')
    console.log('1. Check DAW is not running as Administrator (Windows)')
    console.log('2. Try dragging to Desktop first (test OS drag works)')
    console.log('3. Check Electron startDrag is called synchronously')
    console.log('4. Verify file path is passed, not blob URL')
  } else {
    fixes.forEach((fix, i) => {
      console.log(`\n${i + 1}. [${fix.priority}] ${fix.issue}`)
      console.log(`   Fix: ${fix.fix}`)
    })
  }

  console.log('\n========================================\n')

  return results
}

function getScoreEmoji(score) {
  if (score >= 90) return '✅ Excellent'
  if (score >= 70) return '✓ Good'
  if (score >= 50) return '⚠️  Fair'
  return '❌ Poor'
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.log('Usage: node daw-drag-inspector.cjs <path-to-wav-file>')
    console.log('\nExample:')
    console.log('  node daw-drag-inspector.cjs /tmp/kick_130bpm_Cmin_44k.wav')
    process.exit(1)
  }

  const filePath = path.resolve(args[0])
  inspectWavFile(filePath)
}

module.exports = { inspectWavFile }
