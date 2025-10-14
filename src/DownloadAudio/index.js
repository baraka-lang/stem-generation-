// Audio download helpers: encode AudioBuffer to WAV and trigger downloads

export function encodeWAV(audioBuffer) {
  const srcCh = audioBuffer.numberOfChannels
  const len = audioBuffer.length
  const sr = audioBuffer.sampleRate
  const bps = 2
  const chans = Array.from({ length: srcCh }, (_, c) => audioBuffer.getChannelData(c))
  const interleaved = new Float32Array(len * srcCh)
  let o = 0; for (let i = 0; i < len; i++) for (let c = 0; c < srcCh; c++) interleaved[o++] = chans[c][i]
  const blockAlign = srcCh * bps, byteRate = sr * blockAlign, dataSize = interleaved.length * bps
  const buffer = new ArrayBuffer(44 + dataSize); const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  writeAscii(view, 22, String.fromCharCode(srcCh)); view.setUint16(22, srcCh, true)
  view.setUint32(24, sr, true); view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data'); view.setUint32(40, dataSize, true)
  let off = 44
  for (let i = 0; i < interleaved.length; i++, off += 2) { let s = Math.max(-1, Math.min(1, interleaved[i])); s = s < 0 ? s * 0x8000 : s * 0x7FFF; view.setInt16(off, s, true) }
  return new Blob([view], { type: 'audio/wav' })
  function writeAscii(v, o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function bufferToWavAndDownload(buffer, filename) {
  const wav = encodeWAV(buffer)
  triggerDownload(wav, filename)
}