/**
 * Player Control Module
 * Handles the floating player bar UI elements and their display updates
 */

import { STEM_ORDER } from '../Config/stems.js'
import { DEFAULT_TEMPO, DEFAULT_BARS } from '../Config/constants.js'
import {getSetsById } from '../Auth/stemApi.js'

/**
 * Update play/pause button icon based on playback state
 */
export function updatePlayButtonIcon(isPlaying) {
  const btn = document.getElementById('playBtn')
  if (!btn) return
  const icon = btn.querySelector('[data-lucide]')
  if (icon) { 
    icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play')
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try {
        if (window.safeCreateIcons) {
          window.safeCreateIcons()
        }
      } catch (error) {
        console.error('Error updating play/pause icon:', error)
      }
    }
  } else {
    btn.textContent = isPlaying ? 'Pause' : 'Play'
  }
}

/**
 * Update session info card display
 */
export function updateSessionInfoCard(stemControlValues, getRootText) {
  const infoEl = document.getElementById('sessionInfoText')
  const infoElMob = document.getElementById('sessionInfoTextMobile')
  const master = stemControlValues.master || {}
  const rootName = typeof getRootText === 'function' ? getRootText() : (master.rootBase || '')
  const tempo = master.tempo ?? DEFAULT_TEMPO
  const bars = master.bars ?? DEFAULT_BARS
  const mode = master.mode ?? 'Minor'
  const infoString = `${tempo} BPM • ${bars} bars • ${rootName} ${mode}`
  if (infoEl) infoEl.textContent = infoString
  if (infoElMob) infoElMob.textContent = infoString
}

/**
 * Set mixer open/closed state
 */
export function setMixerOpen(open) {
  const tray = document.getElementById('mixerTray')
  if (!tray) return
  tray.style.maxHeight = open ? '100vh' : '0px'
  tray.dataset.open = open ? '1' : '0'
  
  const toggleBtn = document.getElementById('mixerToggleBtn')
  if (toggleBtn) {
    const desktopSpan = toggleBtn.querySelector('span.hidden.sm\\:inline')
    if (desktopSpan) desktopSpan.textContent = open ? 'close mixer' : 'open mixer'
    toggleBtn.setAttribute('aria-pressed', open ? 'true' : 'false')
  }

  if (open) {
    document.body.style.overflow = 'hidden'
    tray.style.touchAction = 'none'
    const overlay = document.getElementById('mixerOverlay')
    if (overlay) overlay.classList.remove('hidden')
    const closeBtn = document.getElementById('mixerCloseBtn')
    if (closeBtn) closeBtn.classList.remove('hidden')
  } else {
    document.body.style.overflow = ''
    tray.style.touchAction = ''
    const overlay = document.getElementById('mixerOverlay')
    if (overlay) overlay.classList.add('hidden')
    const closeBtn = document.getElementById('mixerCloseBtn')
    if (closeBtn) closeBtn.classList.add('hidden')
  }
}

/**
 * Toggle mixer open/closed state
 */
export function toggleMixerOpen(setMixerOpenFn) {
  const tray = document.getElementById('mixerTray')
  if (!tray) return
  const open = tray.dataset.open === '1'
  setMixerOpenFn(!open)
}

/**
 * Build the floating mixer panel
 */
export function buildFloatingMixerPanel(mixChannelRowHTML, updateMixerGlow, updateCardNumberColor) {
  const tray = document.getElementById('mixerTray')
  if (!tray) return
  let grid = tray.querySelector('#mixerGrid')
  if (!grid) {
    grid = document.createElement('div')
    grid.id = 'mixerGrid'
    tray.querySelector('.mixer-inner')?.appendChild(grid)
  }
  grid.className = 'grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-3'
  grid.innerHTML = STEM_ORDER.map(st => mixChannelRowHTML(st)).join('')
  STEM_ORDER.forEach(updateMixerGlow)
  STEM_ORDER.forEach(updateCardNumberColor)
}

/**
 * Initialize master volume slider
 */
export function initializeMasterVolumeSlider(masterGain, ensureAudioContext, audioContext) {
  const masterVolSlider = document.getElementById('masterVolumeSlider')
  const masterVolValue = document.getElementById('masterVolumeValue')
  if (masterVolSlider) {
    if (masterVolValue && typeof masterGain?.gain?.value === 'number') {
      const initVal = Math.round((masterGain.gain.value || 0) * 100)
      masterVolSlider.value = String(initVal)
      masterVolValue.textContent = `${initVal}%`
    }
    masterVolSlider.addEventListener('input', async e => {
      const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)))
      if (masterVolValue) masterVolValue.textContent = `${v}%`
      await ensureAudioContext()
      if (masterGain) {
        const now = audioContext.currentTime
        masterGain.gain.cancelScheduledValues(now)
        masterGain.gain.setValueAtTime(masterGain.gain.value, now)
        masterGain.gain.linearRampToValueAtTime(v / 100, now + 0.02)
      }
    })
  }
}

// Function to load saved stems states from the cloud storage
export async function loadSavedStemsStatesFromCloudStorage() {
  try {
    let savedStemsStates = [];
    // first check for the current session setting in localStorage
    const currentSessionSetting = localStorage.getItem('currentSessionSetting')
    if (currentSessionSetting) {
      const currentSessionSettingObj = JSON.parse(currentSessionSetting)
      const sessionSettingId = currentSessionSettingObj.session_setting_id ?? currentSessionSettingObj.id ?? null
      if (sessionSettingId){
        const setResult = await getSetsById(sessionSettingId)
        console.log("stem sets by session_setting_id result", setResult)
        if (setResult?.success) {
          // Expect an array of { id, name } for the given session_setting_id
          savedStemsStates = Array.isArray(setResult.sets) ? setResult.sets : []
        }
      }
    }
    return savedStemsStates
  } catch (error) {
    console.error('Failed to load saved stems states from cloud storage:', error)
    return []
  }
}