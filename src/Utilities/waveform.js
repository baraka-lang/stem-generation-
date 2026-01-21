// Waveform drawing and color utilities extracted from app.js

export function getColorRGB(colorName) {
  const m = {
    red: '239, 68, 68',
    orange: '249, 115, 22',
    yellow: '234, 179, 8',
    green: '34, 197, 94',
    cyan: '6, 182, 212',
    purple: '147, 51, 234',
    blue: '59, 130, 246',
    pink: '236, 72, 153'
  }
  return m[colorName] || '156, 163, 175'
}

export function drawWaveform(canvas, audioBuffer, color) {
  if (!canvas || !audioBuffer) return
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  const data = audioBuffer.getChannelData(0)
  const step = Math.ceil(data.length / width)
  const amp = height / 2
  ctx.beginPath()
  for (let x = 0; x < width; x++) {
    let min = 1, max = -1
    for (let j = 0; j < step && (x*step + j) < data.length; j++) {
      const v = data[x*step + j]
      if (v < min) min = v
      if (v > max) max = v
    }
    const y1 = (1 + min) * amp
    const y2 = (1 + max) * amp
    ctx.moveTo(x, y1)
    ctx.lineTo(x, y2)
  }
  ctx.stroke()
}

export function drawTinyWaveform(
  canvas,
  audioBuffer,
  strokeColor = 'rgba(255,255,255,0.85)',
  fillColor = 'rgba(255,255,255,0.08)'
) {
  if (!canvas || !audioBuffer) return
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  if (fillColor) {
    ctx.fillStyle = fillColor
    ctx.fillRect(0, 0, width, height)
  }
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = 1
  const data = audioBuffer.getChannelData(0)
  const step = Math.max(1, Math.floor(data.length / (width * 2)))
  const amp = height / 2
  ctx.beginPath()
  for (let x = 0, i = 0; x < width; x++, i += step) {
    let min = 1, max = -1
    for (let k = 0; k < step && (i + k) < data.length; k++) {
      const v = data[i + k]
      if (v < min) min = v
      if (v > max) max = v
    }
    const y1 = (1 + min) * amp
    const y2 = (1 + max) * amp
    ctx.moveTo(x, y1)
    ctx.lineTo(x, y2)
  }
  ctx.stroke()
}


