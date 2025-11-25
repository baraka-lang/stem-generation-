import { generateUniqueFileId } from './Utilities/uniqueFileId.js'

const stemPCMCache = {}
const stemFormatInfo = {}

/**
 * Store PCM data and format info for a stem
 *
 * @param {string} stemId - Stem identifier
 * @param {ArrayBuffer} pcmData - Raw PCM S16LE data from ElevenLabs
 * @param {number} sampleRate - Sample rate (44100, 24000, etc.)
 * @param {number} numChannels - Number of channels (1 or 2)
 * @param {string} format - Format string like 'pcm_44100'
 */
export function storeStemPCM(stemId, pcmData, sampleRate, numChannels, format) {
  const uniqueFileId = generateUniqueFileId()

  stemPCMCache[stemId] = {
    pcmData: pcmData,
    sampleRate: sampleRate,
    numChannels: numChannels,
    format: format,
    timestamp: Date.now(),
    size: pcmData.byteLength,
    uniqueFileId: uniqueFileId
  }

  stemFormatInfo[stemId] = {
    sampleRate,
    numChannels,
    format
  }

  console.log(`[PCM] Stored ${stemId}: ${format} (${sampleRate}Hz, ${numChannels}ch, ${(pcmData.byteLength / 1024).toFixed(1)}KB) ID: ${uniqueFileId}`)
}

/**
 * Get stored PCM data for a stem
 *
 * @param {string} stemId - Stem identifier
 * @returns {Object|null} PCM data and metadata, or null if not found
 */
export function getStemPCM(stemId) {
  return stemPCMCache[stemId] || null
}

/**
 * Get format info for a stem
 *
 * @param {string} stemId - Stem identifier
 * @returns {Object|null} Format information
 */
export function getStemFormat(stemId) {
  return stemFormatInfo[stemId] || null
}

/**
 * Check if PCM data is available for drag
 *
 * @param {string} stemId - Stem identifier
 * @returns {boolean} True if PCM data is cached and ready
 */
export function isPCMReadyForDrag(stemId) {
  const data = stemPCMCache[stemId]
  return !!(data && data.pcmData && data.pcmData.byteLength > 0)
}

/**
 * Extract raw PCM from base64 WAV data received from edge function
 *
 * This function expects a complete WAV file and extracts just the PCM data.
 * The edge function currently returns WAV, but we want to store the raw PCM.
 *
 * @param {string} audio_b64 - Base64 encoded WAV file
 * @returns {Object} Extracted PCM data and format info
 */
export function extractPCMFromWAV(audio_b64) {
  const commaIdx = audio_b64.indexOf(',')
  const b64 = commaIdx >= 0 ? audio_b64.slice(commaIdx + 1) : audio_b64
  const binaryStr = atob(b64)
  const len = binaryStr.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }

  const view = new DataView(bytes.buffer)

  if (view.byteLength < 44) {
    throw new Error('WAV file too small to contain valid header')
  }

  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (riff !== 'RIFF') {
    throw new Error('Invalid WAV file: missing RIFF header')
  }

  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))
  if (wave !== 'WAVE') {
    throw new Error('Invalid WAV file: missing WAVE header')
  }

  const numChannels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const bitsPerSample = view.getUint16(34, true)

  if (bitsPerSample !== 16) {
    console.warn(`Unexpected bit depth: ${bitsPerSample}, expected 16`)
  }

  const dataSize = view.getUint32(40, true)
  const pcmData = bytes.buffer.slice(44, 44 + dataSize)

  const format = `pcm_${sampleRate}`

  return {
    pcmData,
    sampleRate,
    numChannels,
    bitsPerSample,
    format,
    totalSize: bytes.byteLength,
    headerSize: 44,
    dataSize
  }
}

/**
 * Clear PCM cache for a specific stem
 *
 * @param {string} stemId - Stem identifier
 */
export function clearStemPCM(stemId) {
  if (stemPCMCache[stemId]) {
    delete stemPCMCache[stemId]
    delete stemFormatInfo[stemId]
    console.log(`[PCM] Cleared cache for ${stemId}`)
  }
}

/**
 * Clear all cached PCM data
 */
export function clearAllPCM() {
  const count = Object.keys(stemPCMCache).length
  for (const key in stemPCMCache) {
    delete stemPCMCache[key]
  }
  for (const key in stemFormatInfo) {
    delete stemFormatInfo[key]
  }
  console.log(`[PCM] Cleared all cached data (${count} stems)`)
}

/**
 * Get total size of cached PCM data
 *
 * @returns {number} Total size in bytes
 */
export function getTotalPCMCacheSize() {
  let total = 0
  for (const key in stemPCMCache) {
    total += stemPCMCache[key].size || 0
  }
  return total
}

/**
 * Get cache statistics
 *
 * @returns {Object} Cache stats
 */
export function getPCMCacheStats() {
  const stems = Object.keys(stemPCMCache)
  const totalSize = getTotalPCMCacheSize()

  return {
    count: stems.length,
    totalSizeBytes: totalSize,
    totalSizeKB: (totalSize / 1024).toFixed(1),
    totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
    stems: stems.map(id => ({
      id,
      format: stemFormatInfo[id]?.format || 'unknown',
      sampleRate: stemFormatInfo[id]?.sampleRate || 0,
      sizeKB: ((stemPCMCache[id]?.size || 0) / 1024).toFixed(1)
    }))
  }
}
