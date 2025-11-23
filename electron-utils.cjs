/**
 * Electron utilities for DAW drag-and-drop
 * Validation, diagnostics, and UAC detection
 */

const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const { execSync } = require('child_process')

/**
 * Validate WAV file header structure
 * @param {string} filePath - Absolute path to WAV file
 * @returns {{valid: boolean, error?: string, details?: object}}
 */
function validateWavHeader(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    const header = Buffer.alloc(44)
    fs.readSync(fd, header, 0, 44, 0)
    fs.closeSync(fd)

    const riff = header.toString('ascii', 0, 4)
    const wave = header.toString('ascii', 8, 12)
    const fmt = header.toString('ascii', 12, 16)
    const data = header.toString('ascii', 36, 40)

    const fileSize = header.readUInt32LE(4)
    const audioFormat = header.readUInt16LE(20)
    const numChannels = header.readUInt16LE(22)
    const sampleRate = header.readUInt32LE(24)
    const bitsPerSample = header.readUInt16LE(34)
    const dataSize = header.readUInt32LE(40)

    if (riff !== 'RIFF' || wave !== 'WAVE' || fmt !== 'fmt ' || data !== 'data') {
      return {
        valid: false,
        error: `Invalid header: RIFF=${riff} WAVE=${wave} fmt=${fmt} data=${data}`
      }
    }

    if (audioFormat !== 1) {
      return { valid: false, error: `Not PCM format: audioFormat=${audioFormat}` }
    }

    return {
      valid: true,
      details: { fileSize, numChannels, sampleRate, bitsPerSample, dataSize }
    }
  } catch (err) {
    return { valid: false, error: err.message }
  }
}

/**
 * Ensure file is fully written and ready for drag
 * @param {string} filePath - Absolute path to file
 * @param {number} expectedSize - Expected file size in bytes (optional)
 * @returns {{ready: boolean, error?: string, stats?: object}}
 */
function ensureFileReady(filePath, expectedSize) {
  try {
    // Windows MAX_PATH validation (260 characters)
    if (process.platform === 'win32' && filePath.length > 260) {
      console.warn(`[PATH] Path exceeds Windows MAX_PATH limit: ${filePath.length} chars (max 260)`)
      return {
        ready: false,
        error: `Path too long for Windows (${filePath.length} chars, max 260). Use a shorter folder path.`
      }
    }

    if (!fs.existsSync(filePath)) {
      return { ready: false, error: 'File does not exist' }
    }

    const stats = fs.statSync(filePath)

    if (stats.size === 0) {
      return { ready: false, error: 'File is empty' }
    }

    if (expectedSize && stats.size !== expectedSize) {
      return {
        ready: false,
        error: `Size mismatch: expected ${expectedSize}, got ${stats.size}`
      }
    }

    // Verify file is not being written to (check if we can open it)
    try {
      const fd = fs.openSync(filePath, 'r')
      fs.closeSync(fd)
    } catch (err) {
      return { ready: false, error: `File locked: ${err.message}` }
    }

    return { ready: true, stats: { size: stats.size, mtime: stats.mtime } }
  } catch (err) {
    return { ready: false, error: err.message }
  }
}

/**
 * Check if process is running with elevated privileges
 * @returns {{elevated: boolean, method: string}}
 */
function isProcessElevated() {
  if (process.platform !== 'win32') {
    return { elevated: false, method: 'not-windows' }
  }

  try {
    // Method 1: Try to write to a system directory that requires admin
    const testPath = 'C:\\Windows\\System32\\test_elevation_check.tmp'
    try {
      fs.writeFileSync(testPath, '')
      fs.unlinkSync(testPath)
      return { elevated: true, method: 'write-test' }
    } catch {
      // Cannot write to system directory - not elevated
    }

    // Method 2: Try PowerShell check
    try {
      const result = execSync(
        'powershell -Command "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"',
        { encoding: 'utf8', timeout: 2000 }
      ).trim()

      if (result === 'True') {
        return { elevated: true, method: 'powershell' }
      }
    } catch {
      // PowerShell check failed, assume not elevated
    }

    return { elevated: false, method: 'write-test' }
  } catch {
    return { elevated: false, method: 'fallback' }
  }
}

/**
 * Get diagnostic information for troubleshooting
 */
function getDiagnostics() {
  const elevation = isProcessElevated()

  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    electronVersion: process.versions.electron,
    appVersion: app.getVersion(),
    elevated: elevation.elevated,
    elevationMethod: elevation.method,
    tmpDir: os.tmpdir(),
    homeDir: os.homedir(),
    timestamp: new Date().toISOString()
  }
}

module.exports = {
  validateWavHeader,
  ensureFileReady,
  isProcessElevated,
  getDiagnostics
}
