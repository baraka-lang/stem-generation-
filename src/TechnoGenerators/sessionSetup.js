/**
 * Session Setup Modal
 * Handles the initial session setup where users configure master settings
 * (tempo, bars, key signature) before generating stems.
 */

import { DEFAULT_TEMPO, DEFAULT_BARS } from '../Config/constants.js'
import { STEM_ORDER } from '../Config/stems.js'
import { getPlaybackBars } from '../Utilities/barUtils.js'
import { saveSessionSettingsToCloud } from '../Auth/stemApi.js'
import { getAuthGuard } from '../Auth/authGuard.js'
import { showSuccessToast } from '../UI/toast.js'

/**
 * Load session settings from localStorage if available
 * 
 */

function loadSessionSettingsFromStorage() {
  try {
    const stored = localStorage.getItem('currentSessionSetting')
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    console.error('Error loading session settings from localStorage:', error)
  }
  return null
}


/**
 * Save session settings to localStorage
 */
function saveSessionSettingsToStorage(settings) {
  try {
    // Remove the old session setting before saving the new one
    // Since we now have cloud storage, we only keep the current session in localStorage
    localStorage.removeItem('currentSessionSetting')
  } catch (error) {
    console.error('Error saving session settings to localStorage:', error)
  }
  // Save the new session setting
  localStorage.setItem('currentSessionSetting', JSON.stringify(settings))
  console.log('Session settings saved to localStorage:', settings)
}

/**
 * Clear session settings from localStorage
 */
export function clearSessionSettingsFromStorage() {
  try {
    localStorage.removeItem('currentSessionSetting')
    console.log('Session settings cleared from localStorage')
  } catch (error) {
    console.error('Error clearing session settings from localStorage:', error)
  }
}

/**
 * Display the session setup modal on page load.  If session settings have
 * already been chosen (sessionSetupDone === true), the modal will not
 * appear.  When the user confirms their selections, the values are
 * stored in stemControlValues.master and the bottom controls are
 * disabled accordingly.  The selected values persist for the
 * remainder of the session.
 */
export function showSessionSetupModal(sessionSetupDone, stemControlValues, setSessionSetupDone, applySessionSettingsToUI, updateTempoIndicator, options = {}) {
  const forceShow = options?.forceShow === true
  if (sessionSetupDone && !forceShow) return

  // Check localStorage for existing settings
  const savedSettings = loadSessionSettingsFromStorage()
  console.log('savedSettings', savedSettings)
  if (savedSettings && !forceShow) {
    console.log('Loading session settings from localStorage:', savedSettings)
    // Apply the saved settings
    stemControlValues.master.sessionName = savedSettings.sessionName
    stemControlValues.master.tempo = savedSettings.tempo
    stemControlValues.master.bars = savedSettings.bars
    stemControlValues.master.rootBase = savedSettings.rootBase
    stemControlValues.master.accidental = savedSettings.selectedAccidental
    stemControlValues.master.mode = savedSettings.mode
    stemControlValues.master.session_setting_id = savedSettings.session_setting_id

    // Apply settings to UI
    setSessionSetupDone(true)
    applySessionSettingsToUI(stemControlValues, updateTempoIndicator)

    // Don't show modal, return early
    return
  }

  // No saved settings, show the modal
  const modal = document.getElementById('sessionSetupModal')
  if (!modal) return
  const overlay = document.getElementById('sessionSetupOverlay')
  const sessionNameInput = document.getElementById('setupSessionName')
  const tempoSlider = document.getElementById('setupTempoSlider')
  const tempoValue = document.getElementById('setupTempoValue')
  const barsSelector = document.getElementById('setupBarsSelector')
  const rootSelector = document.getElementById('setupRootSelector')
  const accidentalSelector = document.getElementById('setupAccidentalSelector')
  const modeSelector = document.getElementById('setupModeSelector')
  // The cancel button has been removed (the session setup cannot be dismissed).  It may
  // still exist in older templates, but we treat it as optional.
  const cancelBtn = document.getElementById('setupCancelBtn')
  const saveBtn = document.getElementById('setupSaveBtn')
  if (!tempoSlider || !tempoValue || !barsSelector || !rootSelector || !accidentalSelector || !modeSelector || !saveBtn) return

  // Generate default session name with current date and time
  // Format: Session Setting (YYYY-MM-DD_HH:mm)
  const generateDefaultSessionName = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    return `Session Setting (${year}-${month}-${day}_${hours}:${minutes})`
  }

  // Set default session name if input exists
  if (sessionNameInput) {
    sessionNameInput.value = stemControlValues?.master?.sessionName || generateDefaultSessionName()
  }
  // Prepopulate controls from current master settings
  const master = stemControlValues?.master || {}
  if (tempoSlider) tempoSlider.value = String(master.tempo ?? DEFAULT_TEMPO)
  if (tempoValue) tempoValue.textContent = String(master.tempo ?? DEFAULT_TEMPO)
  if (barsSelector) barsSelector.value = String(master.bars ?? DEFAULT_BARS)
  if (rootSelector) rootSelector.value = String(master.rootBase ?? 'A')
  if (accidentalSelector) accidentalSelector.value = String(master.accidental ?? 'natural')
  if (modeSelector) modeSelector.value = String(master.mode ?? 'Minor')
  // Update displayed tempo when slider moves (ensure single handler)
  tempoSlider.oninput = e => {
    const val = Math.round(Number(e.target.value) || DEFAULT_TEMPO)
    tempoValue.textContent = String(val)
  }
  // If a cancel button exists, handle the cancel logic.
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      const storedSettings = loadSessionSettingsFromStorage()

      if (storedSettings) {
        // If settings already exist, just close the modal
        modal.style.opacity = '0'
        setTimeout(() => { modal.classList.add('hidden') }, 300)
        document.body.style.overflow = ''
      } else {
        // No settings found, ask for confirmation
        if (window.confirm("No session settings found. Close and use default settings in the background?")) {
          // Collect current (default or changed) values from the modal
          const sessionName = sessionNameInput ? sessionNameInput.value.trim() || generateDefaultSessionName() : generateDefaultSessionName()
          const tempoVal = Math.round(Number(tempoSlider.value) || DEFAULT_TEMPO)
          const barsVal = parseInt(barsSelector.value, 10) || DEFAULT_BARS
          const rootText = String(rootSelector.value || 'A')
          let rootBase = rootText.replace(/[#♯b♭]/g, '').toUpperCase()
          const selectedAccidental = accidentalSelector.value
          const modeVal = String(modeSelector.value || 'Minor')

          // Prepare session values object
          const sessionValues = {
            session_setting_id: null,
            session_name: sessionName,
            tempo: tempoVal,
            bars: barsVal,
            root_base: rootBase,
            selected_accidental: selectedAccidental,
            mode: modeVal
          }

          // Apply to internal values
          stemControlValues.master.sessionName = sessionName
          stemControlValues.master.tempo = tempoVal
          stemControlValues.master.bars = barsVal
          stemControlValues.master.rootBase = rootBase
          stemControlValues.master.accidental = selectedAccidental
          stemControlValues.master.mode = modeVal

          // 1. Replace the session setting in local storage immediately
          saveSessionSettingsToStorage(sessionValues)

          // Proceed with UI transition
          setSessionSetupDone(true)
          applySessionSettingsToUI(stemControlValues, updateTempoIndicator)

          // Hide modal
          modal.style.opacity = '0'
          setTimeout(() => { modal.classList.add('hidden') }, 300)
          document.body.style.overflow = ''

          // Perform cloud save in background if possible
          const guardUser = getAuthGuard()?.getCurrentUser()
          if (guardUser?.id) {
            sessionValues.user_id = guardUser.id
            showSuccessToast("Session setup complete. Saving settings in background...")

            // 2. Save values to the cloud
            saveSessionSettingsToCloud(sessionValues).then(cloudResult => {
              if (cloudResult.success && cloudResult.session_setting_id) {
                // 3. Update the session_setting_id with the ID of the current saved to cloud
                const finalId = cloudResult.session_setting_id
                sessionValues.session_setting_id = finalId
                stemControlValues.master.session_setting_id = finalId
                saveSessionSettingsToStorage(sessionValues)
                showSuccessToast("Session settings synchronized successfully.")
              } else {
                console.warn('Background cloud save failed results:', cloudResult.error)
              }
            }).catch(err => {
              console.error('Background cloud save exception:', err)
            })
          }
        }
      }
    }
  }
  // Save button applies settings and locks them (single handler to avoid duplicates)
  saveBtn.onclick = async (e) => {
    console.log('saveBtn clicked');
    try { e.preventDefault() } catch { }
    try { e.stopPropagation() } catch { }
    const sessionName = sessionNameInput ? sessionNameInput.value.trim() || generateDefaultSessionName() : generateDefaultSessionName()
    const tempoVal = Math.round(Number(tempoSlider.value) || DEFAULT_TEMPO)
    const barsVal = parseInt(barsSelector.value, 10) || DEFAULT_BARS
    const rootText = String(rootSelector.value || 'A')
    // Determine base letter and accidental from the root selection
    // Remove both Unicode and standard sharp/flat symbols to get the base note
    let rootBase = rootText.replace(/[#♯b♭]/g, '').toUpperCase()
    const selectedAccidental = accidentalSelector.value
    const modeVal = String(modeSelector.value || 'Minor')
    // Set master values
    stemControlValues.master.sessionName = sessionName
    stemControlValues.master.tempo = tempoVal
    stemControlValues.master.bars = barsVal
    stemControlValues.master.rootBase = rootBase
    stemControlValues.master.accidental = selectedAccidental
    stemControlValues.master.mode = modeVal

    // Log all values as an array
    const sessionValues = {
      session_setting_id: null,
      session_name: sessionName,
      tempo: tempoVal,
      bars: barsVal,
      root_base: rootBase,
      selected_accidental: selectedAccidental,
      mode: modeVal
    }

    // 1. Replace the session setting in local storage immediately
    saveSessionSettingsToStorage(sessionValues)

    // Check if user is logged in
    const guardUser = getAuthGuard()?.getCurrentUser()
    if (guardUser?.id) {
      sessionValues.user_id = guardUser.id

      // 2. Save values to the cloud
      try {
        const cloudResult = await saveSessionSettingsToCloud(sessionValues)
        if (cloudResult.success && cloudResult.session_setting_id) {
          // 3. Update the session_setting_id with the ID of the current saved to cloud
          const finalId = cloudResult.session_setting_id
          sessionValues.session_setting_id = finalId
          stemControlValues.master.session_setting_id = finalId
          saveSessionSettingsToStorage(sessionValues)
          console.log('Session synced with cloud, ID:', finalId)
        } else {
          console.warn('Could not save session to cloud, continuing with local only:', cloudResult.error)
        }
      } catch (err) {
        console.error('Error during cloud session save:', err)
      }
    }

    showSuccessToast("Session setup complete!")

    setSessionSetupDone(true)
    applySessionSettingsToUI(stemControlValues, updateTempoIndicator)
    // Hide modal
    modal.style.opacity = '0'
    setTimeout(() => { modal.classList.add('hidden') }, 300)
    // Restore page scrolling when the session setup modal is closed
    document.body.style.overflow = ''
  }
  // Show the modal
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.style.opacity = '1'
  })
  // Disable page scrolling while the session setup modal is visible
  document.body.style.overflow = 'hidden'
}

/**
 * Apply the session settings to the UI: update the bottom controls
 * with the locked values and disable them so the user cannot modify
 * them mid-session.  Also refresh the tempo indicators on the
 * waveform cards and update the history drawer where needed.
 */
export function applySessionSettingsToUI(stemControlValues, updateTempoIndicator) {
  const master = stemControlValues.master
  // If any of the old master controls exist (tempo, bars, key selectors), disable them and set their values.
  // This keeps compatibility in case those elements are still present in the DOM for other generators.
  const tempoSlider = document.getElementById('tempoSlider')
  const tempoValueEl = document.getElementById('tempoValue')
  if (tempoSlider) {
    tempoSlider.value = String(master.tempo)
    tempoSlider.disabled = true
  }
  if (tempoValueEl) {
    tempoValueEl.textContent = String(master.tempo)
  }
  const barsSelector = document.getElementById('barsSelector')
  if (barsSelector) {
    barsSelector.value = String(master.bars)
    barsSelector.disabled = true
  }
  const rootSelector = document.getElementById('rootSelector')
  const accidentalSelector = document.getElementById('accidentalSelector')
  const modeSelector = document.getElementById('modeSelector')
  if (rootSelector) {
    let rootDisplay = master.rootBase
    if (master.accidental === 'sharp') rootDisplay += '#'
    else if (master.accidental === 'flat') rootDisplay += 'b'
    rootSelector.value = rootDisplay
    rootSelector.disabled = true
  }
  if (accidentalSelector) {
    accidentalSelector.value = master.accidental
    accidentalSelector.disabled = true
  }
  if (modeSelector) {
    modeSelector.value = master.mode
    modeSelector.disabled = true
  }
  // Update the session info card in the player bar.
  const infoEl = document.getElementById('sessionInfoText')
  const infoElMob = document.getElementById('sessionInfoTextMobile')
  const infoString = (() => {
    const base = master.rootBase || 'A'
    const acc = master.accidental || 'natural'
    const rootName = acc === 'sharp' ? `${base}#` : acc === 'flat' ? `${base}b` : base
    const displayBars = getPlaybackBars(master.bars ?? DEFAULT_BARS, DEFAULT_BARS)
    return `${master.tempo} BPM • ${displayBars} bars • ${rootName} ${master.mode}`
  })()
  if (infoEl) infoEl.textContent = infoString
  if (infoElMob) infoElMob.textContent = infoString
  // Refresh tempo indicators on all cards
  STEM_ORDER.forEach(st => {
    updateTempoIndicator(st)
  })
}

