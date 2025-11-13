/**
 * Audio Encoder with Web Worker support for non-blocking WAV encoding
 * Falls back to main thread encoding if workers are not available
 */

let wavWorker = null;
let workerJobId = 0;
let pendingJobs = new Map();

const CACHE_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB total cache limit
let currentCacheSize = 0;

/**
 * Initialize the WAV encoder worker
 */
export function initWavEncoder() {
  if (!wavWorker && typeof Worker !== 'undefined') {
    try {
      wavWorker = new Worker(new URL('./workers/wavEncoder.worker.js', import.meta.url), {
        type: 'module'
      });

      wavWorker.addEventListener('message', (e) => {
        const { id, success, wavBlob, error } = e.data;
        const job = pendingJobs.get(id);

        if (job) {
          if (success) {
            job.resolve(wavBlob);
          } else {
            job.reject(new Error(error || 'WAV encoding failed'));
          }
          pendingJobs.delete(id);
        }
      });

      wavWorker.addEventListener('error', (err) => {
        console.error('WAV Worker error:', err);
      });

      console.log('WAV Encoder Worker initialized');
    } catch (err) {
      console.warn('Failed to initialize WAV worker, using fallback:', err);
    }
  }
}

/**
 * Encode an AudioBuffer to WAV using worker (non-blocking) or fallback to main thread
 * @param {AudioBuffer} audioBuffer
 * @returns {Promise<Blob>}
 */
export async function encodeWAVAsync(audioBuffer) {
  if (!audioBuffer) {
    throw new Error('Audio buffer is null or undefined');
  }

  if (!(audioBuffer instanceof AudioBuffer)) {
    throw new Error('Invalid audio buffer type');
  }

  const srcCh = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  const sr = audioBuffer.sampleRate;

  if (!srcCh || srcCh < 1 || srcCh > 2) {
    throw new Error(`Invalid number of channels: ${srcCh}`);
  }

  if (!len || len <= 0) {
    throw new Error(`Invalid buffer length: ${len}`);
  }

  if (!sr || sr <= 0) {
    throw new Error(`Invalid sample rate: ${sr}`);
  }

  if (wavWorker) {
    return encodeWithWorker(audioBuffer);
  } else {
    return encodeWAVSync(audioBuffer);
  }
}

/**
 * Encode using Web Worker (non-blocking)
 */
function encodeWithWorker(audioBuffer) {
  return new Promise((resolve, reject) => {
    const id = ++workerJobId;

    const channelData = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      channelData.push(audioBuffer.getChannelData(c));
    }

    const audioBufferData = {
      channelData,
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
      length: audioBuffer.length
    };

    pendingJobs.set(id, { resolve, reject });

    try {
      wavWorker.postMessage({
        id,
        type: 'encode',
        audioBufferData
      });
    } catch (err) {
      pendingJobs.delete(id);
      reject(err);
    }
  });
}

/**
 * Synchronous WAV encoding (fallback for non-worker scenarios)
 * @param {AudioBuffer} audioBuffer
 * @returns {Blob}
 */
export function encodeWAVSync(audioBuffer) {
  if (!audioBuffer) {
    throw new Error('Audio buffer is null or undefined');
  }

  if (!(audioBuffer instanceof AudioBuffer)) {
    throw new Error('Invalid audio buffer type');
  }

  const srcCh = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  const sr = audioBuffer.sampleRate;

  if (!srcCh || srcCh < 1 || srcCh > 2) {
    throw new Error(`Invalid number of channels: ${srcCh}`);
  }

  if (!len || len <= 0) {
    throw new Error(`Invalid buffer length: ${len}`);
  }

  if (!sr || sr <= 0) {
    throw new Error(`Invalid sample rate: ${sr}`);
  }

  const chans = [];
  for (let c = 0; c < srcCh; c++) {
    const channelData = audioBuffer.getChannelData(c);
    if (!channelData || channelData.length === 0) {
      throw new Error(`Channel ${c} data is empty or invalid`);
    }
    chans.push(channelData);
  }

  let hasAudio = false;
  for (let c = 0; c < srcCh; c++) {
    for (let i = 0; i < Math.min(len, 1000); i++) {
      if (Math.abs(chans[c][i]) > 0.0001) {
        hasAudio = true;
        break;
      }
    }
    if (hasAudio) break;
  }

  if (!hasAudio) {
    console.warn('Audio buffer appears to contain only silence');
  }

  const bps = 2;
  const interleaved = new Float32Array(len * srcCh);
  let o = 0;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < srcCh; c++) {
      interleaved[o++] = chans[c][i];
    }
  }

  const blockAlign = srcCh * bps;
  const byteRate = sr * blockAlign;
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
  view.setUint16(22, srcCh, true);
  view.setUint32(24, sr, true);
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

  console.log(`✓ Encoded WAV: ${(blob.size / 1024).toFixed(1)}KB, ${sr}Hz, ${srcCh}ch, ${len} samples`);

  return blob;
}

/**
 * Pre-compute data URI from blob asynchronously
 * This should be called immediately after WAV generation to avoid blocking dragstart
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function preComputeDataURI(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read blob as data URL'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Blob read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Terminate the worker
 */
export function terminateWavEncoder() {
  if (wavWorker) {
    wavWorker.terminate();
    wavWorker = null;
    pendingJobs.clear();
    console.log('WAV Encoder Worker terminated');
  }
}

/**
 * Check if cache size exceeds limit and clear if needed
 * @param {Object} cache - The cache object to manage
 * @param {number} newSize - Size of new item to add
 */
export function manageCacheSize(cache, newSize) {
  currentCacheSize += newSize;

  if (currentCacheSize > CACHE_SIZE_LIMIT) {
    const keys = Object.keys(cache);
    if (keys.length > 0) {
      const oldestKey = keys[0];
      delete cache[oldestKey];
      currentCacheSize -= newSize;
      console.log(`Cache limit reached, removed oldest entry: ${oldestKey}`);
    }
  }
}
