/**
 * PCM to WAV Converter for ElevenLabs Audio
 *
 * This module wraps raw PCM S16LE data from ElevenLabs into a proper WAV file
 * WITHOUT re-encoding or changing the sample rate. This is critical for DAW
 * compatibility as it preserves the exact audio format from the API.
 *
 * ElevenLabs PCM format: 16-bit signed little-endian PCM
 * Supported sample rates: 44100, 24000, 22050, 16000 Hz
 * Channels: Stereo (2 channels) for music
 */

/**
 * Wrap raw PCM S16LE data into a WAV file with proper RIFF header
 *
 * @param {ArrayBuffer|Uint8Array} pcmData - Raw PCM data from ElevenLabs
 * @param {number} sampleRate - Sample rate (44100, 24000, 22050, or 16000)
 * @param {number} numChannels - Number of channels (1 for mono, 2 for stereo)
 * @returns {ArrayBuffer} Complete WAV file with headers
 */
export function pcm16leToWav(pcmData, sampleRate, numChannels = 2) {
  const pcmBytes = pcmData instanceof Uint8Array ? pcmData : new Uint8Array(pcmData);

  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBytes.byteLength;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer, 44).set(pcmBytes);

  return buffer;
}

/**
 * Create a WAV Blob from PCM data for browser use
 *
 * @param {ArrayBuffer|Uint8Array} pcmData - Raw PCM data
 * @param {number} sampleRate - Sample rate
 * @param {number} numChannels - Number of channels
 * @returns {Blob} WAV blob ready for download or drag operations
 */
export function pcm16leToWavBlob(pcmData, sampleRate, numChannels = 2) {
  const wavBuffer = pcm16leToWav(pcmData, sampleRate, numChannels);
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Validate that PCM data and parameters are correct
 *
 * @param {ArrayBuffer|Uint8Array} pcmData - PCM data to validate
 * @param {number} sampleRate - Sample rate
 * @param {number} numChannels - Number of channels
 * @returns {Object} Validation result with success flag and any errors
 */
export function validatePcmData(pcmData, sampleRate, numChannels) {
  const errors = [];

  if (!pcmData || pcmData.byteLength === 0) {
    errors.push('PCM data is empty');
  }

  const validSampleRates = [44100, 24000, 22050, 16000];
  if (!validSampleRates.includes(sampleRate)) {
    errors.push(`Invalid sample rate: ${sampleRate}. Expected one of: ${validSampleRates.join(', ')}`);
  }

  if (numChannels < 1 || numChannels > 2) {
    errors.push(`Invalid channel count: ${numChannels}. Expected 1 (mono) or 2 (stereo)`);
  }

  const pcmBytes = pcmData instanceof Uint8Array ? pcmData : new Uint8Array(pcmData);
  const bytesPerSample = 2;
  const expectedAlignment = numChannels * bytesPerSample;

  if (pcmBytes.byteLength % expectedAlignment !== 0) {
    errors.push(`PCM data size (${pcmBytes.byteLength}) not aligned to ${expectedAlignment} bytes (${numChannels} channels × 16-bit)`);
  }

  const durationSeconds = pcmBytes.byteLength / (sampleRate * numChannels * bytesPerSample);
  if (durationSeconds < 0.1) {
    errors.push(`Audio too short: ${durationSeconds.toFixed(3)}s`);
  }

  if (durationSeconds > 600) {
    errors.push(`Audio too long: ${durationSeconds.toFixed(1)}s (max 600s)`);
  }

  return {
    success: errors.length === 0,
    errors,
    durationSeconds: durationSeconds.toFixed(3),
    sizeKB: (pcmBytes.byteLength / 1024).toFixed(1)
  };
}

/**
 * Get format information from ElevenLabs format string
 *
 * @param {string} format - Format string like 'pcm_44100'
 * @returns {Object} Format info with sample rate and type
 */
export function parseElevenLabsFormat(format) {
  if (!format || typeof format !== 'string') {
    return { sampleRate: 24000, isPCM: false };
  }

  const match = format.match(/^pcm_(\d+)$/);
  if (match) {
    return {
      sampleRate: parseInt(match[1]),
      isPCM: true,
      format
    };
  }

  return {
    sampleRate: 44100,
    isPCM: false,
    format
  };
}

/**
 * Generate a filename for the WAV file based on stem and session info
 *
 * @param {string} stemName - Name of the stem (kick, bass, etc.)
 * @param {number} tempo - BPM
 * @param {string} key - Musical key
 * @param {number} sampleRate - Sample rate in Hz
 * @returns {string} Filename like "kick_130bpm_Cmin_44k.wav"
 */
export function generateWavFilename(stemName, tempo, key, sampleRate) {
  const sanitizedStem = stemName.replace(/[^a-z0-9]/gi, '');
  const sanitizedKey = key.replace(/[^a-zA-Z0-9#]/g, '');
  const rateLabel = sampleRate >= 1000 ? `${Math.round(sampleRate / 1000)}k` : `${sampleRate}`;

  return `${sanitizedStem}_${tempo}bpm_${sanitizedKey}_${rateLabel}.wav`;
}

/**
 * Validate WAV file header structure
 * Quick sanity check that saved files have proper RIFF/WAVE/fmt/data structure
 *
 * @param {ArrayBuffer} arrayBuffer - WAV file buffer (at least first 44 bytes)
 * @returns {boolean} True if header appears valid
 */
export function isValidWavHeader(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 44) {
    return false;
  }

  try {
    const view = new DataView(arrayBuffer);

    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );

    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    );

    const fmt = String.fromCharCode(
      view.getUint8(12),
      view.getUint8(13),
      view.getUint8(14),
      view.getUint8(15)
    );

    const data = String.fromCharCode(
      view.getUint8(36),
      view.getUint8(37),
      view.getUint8(38),
      view.getUint8(39)
    );

    return riff === 'RIFF' && wave === 'WAVE' && fmt === 'fmt ' && data === 'data';
  } catch (err) {
    console.error('[WAV Validator] Error checking header:', err);
    return false;
  }
}
