// Shared utilities for UI and DSP helpers
import { EQ_MIN_DB, EQ_MAX_DB } from '../Config/constants.js'

export function knobToDb(val){
  const v=Math.max(0, Math.min(100, Number(val)||0))
  const pivot = 75 // Professional fader pivot for 0 dB
  if (v <= pivot) return EQ_MIN_DB + (v / pivot) * (0 - EQ_MIN_DB)
  return ((v - pivot) / (100 - pivot)) * EQ_MAX_DB
}

export function formatDb(db){
  if (db <= EQ_MIN_DB + 0.5) return 'CUT'
  if (Math.abs(db) < 0.05) return '0 dB'
  return `${db.toFixed(1)} dB`
}

export function knobAngle(val){
  return -135 + (val/100)*270
}