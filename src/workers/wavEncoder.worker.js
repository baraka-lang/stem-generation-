/**
 * Web Worker for WAV encoding to prevent UI blocking
 * Handles heavy audio buffer encoding operations off the main thread
 */

self.addEventListener('message', (e) => {
  const { id, type, audioBufferData } = e.data;

  try {
    if (type === 'encode') {
      const wavBlob = encodeWAVInWorker(audioBufferData);

      self.postMessage({
        id,
        success: true,
        wavBlob,
        size: wavBlob.size
      });
    }
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error.message
    });
  }
});

/**
 * Encode audio buffer data to WAV format
 * @param {Object} audioBufferData - Contains channelData, sampleRate, numberOfChannels, length
 * @returns {Blob} WAV file blob
 */
function encodeWAVInWorker(audioBufferData) {
  const { channelData, sampleRate, numberOfChannels, length } = audioBufferData;

  if (!numberOfChannels || numberOfChannels < 1 || numberOfChannels > 2) {
    throw new Error(`Invalid number of channels: ${numberOfChannels}`);
  }

  if (!length || length <= 0) {
    throw new Error(`Invalid buffer length: ${length}`);
  }

  if (!sampleRate || sampleRate <= 0) {
    throw new Error(`Invalid sample rate: ${sampleRate}`);
  }

  const bps = 2; // 16-bit
  const interleaved = new Float32Array(length * numberOfChannels);
  let o = 0;

  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numberOfChannels; c++) {
      interleaved[o++] = channelData[c][i];
    }
  }

  const blockAlign = numberOfChannels * bps;
  const byteRate = sampleRate * blockAlign;
  const dataSize = interleaved.length * bps;

  if (dataSize <= 0 || dataSize > 500 * 1024 * 1024) {
    throw new Error(`Invalid data size: ${dataSize} bytes`);
  }

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeAscii(v, o, s) {
    for (let i = 0; i < s.length; i++) {
      v.setUint8(o + i, s.charCodeAt(i));
    }
  }

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < interleaved.length; i++, off += 2) {
    let s = Math.max(-1, Math.min(1, interleaved[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(off, s, true);
  }

  const blob = new Blob([view], { type: 'audio/wav' });

  if (!blob || blob.size === 0) {
    throw new Error('Failed to create WAV blob');
  }

  return blob;
}
