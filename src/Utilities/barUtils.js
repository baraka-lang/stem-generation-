const DEFAULT_FALLBACK_BARS = 4
export const PLAYBACK_BAR_DIVISOR = 2

function toPositiveInt(value, fallback = DEFAULT_FALLBACK_BARS) {
  const num = Number(value)
  if (!Number.isFinite(num)) return Math.max(1, Math.round(Number(fallback) || DEFAULT_FALLBACK_BARS))
  const rounded = Math.round(num)
  return Math.max(1, rounded)
}

export function normalizeBarsValue(bars, fallback = DEFAULT_FALLBACK_BARS) {
  return toPositiveInt(bars, fallback)
}

export function getPlaybackBarsFromActual(actualBars) {
  return Math.max(1, Math.round(actualBars / PLAYBACK_BAR_DIVISOR))
}

export function getPlaybackBars(bars, fallback = DEFAULT_FALLBACK_BARS) {
  const actual = normalizeBarsValue(bars, fallback)
  return getPlaybackBarsFromActual(actual)
}

export function getPlaybackBarInfo(bars, fallback = DEFAULT_FALLBACK_BARS) {
  const actualBars = normalizeBarsValue(bars, fallback)
  const playbackBars = getPlaybackBarsFromActual(actualBars)
  return {
    actualBars,
    playbackBars,
    ratio: playbackBars / actualBars
  }
}

export function formatBarsForDisplay(bars, fallback = DEFAULT_FALLBACK_BARS) {
  return `${getPlaybackBars(bars, fallback)}`
}
