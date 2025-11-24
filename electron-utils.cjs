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
 * Verify file is accessible by attempting to open with shared read
 * This ensures no exclusive locks prevent DAW from reading the file
 */
function verifyFileAccessible(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    fs.closeSync(fd)
    return { accessible: true }
  } catch (err) {
    return { accessible: false, error: err.message }
  }
}

/**
 * Ensure file is fully written and ready for drag with retry logic
 * Critical for DAW compatibility - files must be completely ready before drag
 * @param {string} filePath - Absolute path to file
 * @param {number} expectedSize - Expected file size in bytes (optional)
 * @param {object} options - Retry options {maxRetries: 3, delayMs: 10}
 * @returns {{ready: boolean, error?: string, stats?: object, retries?: number}}
 */
function ensureFileReady(filePath, expectedSize, options = {}) {
  const { maxRetries = 3, delayMs = 10 } = options
  let lastError = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
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
        lastError = 'File does not exist'
        if (attempt < maxRetries - 1) {
          // Synchronous busy wait (required for IPC sync context)
          const start = Date.now()
          while (Date.now() - start < delayMs) { /* busy wait */ }
          continue
        }
        return { ready: false, error: lastError, retries: attempt + 1 }
      }

      const stats = fs.statSync(filePath)

      if (stats.size === 0) {
        lastError = 'File is empty'
        if (attempt < maxRetries - 1) {
          const start = Date.now()
          while (Date.now() - start < delayMs) { /* busy wait */ }
          continue
        }
        return { ready: false, error: lastError, retries: attempt + 1 }
      }

      if (expectedSize && stats.size !== expectedSize) {
        lastError = `Size mismatch: expected ${expectedSize}, got ${stats.size}`
        if (attempt < maxRetries - 1) {
          const start = Date.now()
          while (Date.now() - start < delayMs) { /* busy wait */ }
          continue
        }
        return {
          ready: false,
          error: lastError,
          retries: attempt + 1
        }
      }

      // Verify file is accessible (not locked by another process)
      const accessCheck = verifyFileAccessible(filePath)
      if (!accessCheck.accessible) {
        lastError = `File locked: ${accessCheck.error}`
        if (attempt < maxRetries - 1) {
          const start = Date.now()
          while (Date.now() - start < delayMs) { /* busy wait */ }
          continue
        }
        return { ready: false, error: lastError, retries: attempt + 1 }
      }

      // Success!
      if (attempt > 0) {
        console.log(`[FileReady] File ready after ${attempt + 1} attempts`)
      }
      return { ready: true, stats: { size: stats.size, mtime: stats.mtime }, retries: attempt + 1 }
    } catch (err) {
      lastError = err.message
      if (attempt < maxRetries - 1) {
        const start = Date.now()
        while (Date.now() - start < delayMs) { /* busy wait */ }
        continue
      }
      return { ready: false, error: lastError, retries: attempt + 1 }
    }
  }

  return { ready: false, error: lastError || 'Unknown error', retries: maxRetries }
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
