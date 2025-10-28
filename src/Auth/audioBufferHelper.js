/**
 * Audio Buffer Helper
 * Utilities for converting between AudioBuffer and ArrayBuffer
 */

/**
 * Convert AudioBuffer to ArrayBuffer (WAV format)
 * @param {AudioBuffer} audioBuffer - The audio buffer to convert
 * @returns {ArrayBuffer} The WAV file as an ArrayBuffer
 */
export async function audioBufferToArrayBuffer(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const length = audioBuffer.length
  
  // Create interleaved buffer
  const data = new Float32Array(length * numChannels)
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel)
    for (let sample = 0; sample < length; sample++) {
      data[sample * numChannels + channel] = channelData[sample]
    }
  }
  
  // Convert to Int16 PCM
  const pcmData = new Int16Array(length * numChannels)
  for (let i = 0; i < length * numChannels; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }
  
  // Create WAV file
  const buffer = new ArrayBuffer(44 + pcmData.length * 2)
  const view = new DataView(buffer)
  
  // WAV header
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i))
    }
  }
  
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + pcmData.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM format
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * 2, true) // byte rate
  view.setUint16(32, numChannels * 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, pcmData.length * 2, true)
  
  // Copy PCM data
  const pcmBytes = new Uint8Array(buffer, 44)
  const pcmInt16 = new Int16Array(pcmData)
  for (let i = 0; i < pcmInt16.length; i++) {
    const val = pcmInt16[i]
    pcmBytes[i * 2] = val & 0xFF
    pcmBytes[i * 2 + 1] = (val >> 8) & 0xFF
  }
  
  return buffer
}

/**
 * Get the duration of an AudioBuffer in seconds
 * @param {AudioBuffer} audioBuffer - The audio buffer
 * @returns {number} Duration in seconds
 */
export function getAudioDuration(audioBuffer) {
  return audioBuffer.duration
}

