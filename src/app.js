// app.js — Techno Generator (Loop-Perfect Edition) — Player/Mixer toggle + wider sliders + hotkeys
// Modified to add card numbering, waveform navigation buttons, help modal and red borders on mute.

import { createClient } from '@supabase/supabase-js'

import {
  USE_COMPOSITION_PLAN,
  PRIMARY_OUTPUT_FORMAT,
  FALLBACK_OUTPUT_FORMAT,
  PRO_FORMAT,
  PROMPTS_MODE,
  TEMPO_MIN,
  TEMPO_MAX,
  DEFAULT_TEMPO,
  DEFAULT_BARS,
  START_ENV_MS,
  EDGE_RAMP_MS,
  LOOP_XFADE_MS,
  ALIGN_SEARCH_MS,
  ZERO_FALLBACK_SAMPLES,
  BOUNDARY_LOOKAHEAD_MS,
  GEN_TAIL_PAD_MS,
  EQ_MIN_DB,
  EQ_MAX_DB,
  EQ_DEFAULT,
  EQ_SMOOTH_TC,
  EQ_LOW_FREQ,
  EQ_MID_FREQ,
  EQ_MID_Q,
  EQ_HIGH_FREQ,
  FILTER_MIN_HZ,
  FILTER_MAX_HZ,
  FILTER_Q,
  FILTER_SMOOTH_TC,
  FILTER_DEFAULT_HZ,
} from './Config/constants.js'
import { knobToDb, formatDb, knobAngle } from './Utilities/index.js'
import { getColorRGB, drawWaveform, drawTinyWaveform } from './Utilities/waveform.js'
import { setupUserMenu, updateUserMenu, updateUserMenuVisibility } from './UI/userMenu.js'
import { initializeAuthGuard, addAuthListener } from './Auth/authGuard.js'
import { setupLoginPage } from './Auth/loginPage.js'
import { setupResetPasswordPage } from './Auth/resetPasswordPage.js'
import { setupSelectionPage } from './Auth/selectionPage.js'
import { setupTechnoGeneratorPage } from './Auth/tecnoGeneratorPage.js'
import { setupProfilePage } from './Auth/profilePage.js'
import { initializeUserProfile } from './Auth/userProfile.js'
import { checkCredits, updateCredits } from './Auth/userProfile.js'
import { getAuthGuard } from './Auth/authGuard.js'
import { setupHelpModal } from './UI/helpModal.js'
import { injectGlobalStyles } from './UI/styles.js'
import { stemConfigs, STEM_ORDER } from './Config/stems.js'
import { downloadStem as saveDownloadStem, downloadAllActiveStems as saveDownloadAllActiveStems } from './SaveAudio/index.js'
import { openDownloadConfirmModal, closeDownloadConfirmModal, confirmDownloadAll, setDownloadAllHandler } from './DownloadAudio/index.js'
import { scaleKnob, roleDirectives, negatives } from './TechnoGenerators/stemHelper.js'
import { showSessionSetupModal as showSessionSetupModalImpl, applySessionSettingsToUI as applySessionSettingsToUIImpl, clearSessionSettingsFromStorage } from './TechnoGenerators/sessionSetup.js'
import { showSuccessToast, showErrorToast } from './UI/toast.js'
import { updatePlayButtonIcon as updatePlayButtonIconImpl, updateSessionInfoCard as updateSessionInfoCardImpl, setMixerOpen as setMixerOpenImpl, toggleMixerOpen as toggleMixerOpenImpl, buildFloatingMixerPanel as buildFloatingMixerPanelImpl, initializeMasterVolumeSlider as initializeMasterVolumeSliderImpl } from './playerControl/index.js'
import { saveStem } from './Auth/stemApi.js'

let fsModule = null
try {
  if (typeof window !== 'undefined' && typeof window.require === 'function') {
    fsModule = window.require('fs')
  } else {
    const req = Function('return typeof require !== "undefined" ? require : null')()
    if (req) {
      fsModule = req('fs')
    }
  }
} catch (fsError) {
  console.warn('Filesystem module not available; audio files will not be written to disk.', fsError)
}

/* =========================================================
   Global state
   ========================================================= */
let audioContext = null
let masterGain = null
let isPlaying = false

const stemRaw = {}
const stemLoop = {}
// active nodes: { source, env, filter, eq:{low,mid,high}, gain }
const stemNodes = {}
const stemGains = {}

// Each stem maintains its own loop duration.  When a loop is built from a raw
// buffer (after generation or when selecting a take), its duration is stored
// here.  The transport uses these durations to compute per‑stem phases and
// restart offsets, ensuring each stem plays back at its own tempo without
// reference to a shared master tempo.
const stemLoopDuration = {}

let stemControlValues = {}
let stemMuteStates = {}
let soloedStem = null

// When a stem is soloed, store its previous mute state here so it can be restored
// when the solo is released.  Keys are stem IDs; values are booleans indicating
// whether the stem was muted prior to soloing.  Only the current soloed stem
// will have an entry in this object.
const prevSoloMuteStates = {}

const stemEqValues = {}
const stemFilterValues = {}

/* =========================================================
   Saved Sets (Player State Snapshots)
   ========================================================= */

// Array of saved player states.  Each entry is an object capturing
// the current stem version, mute status, volume, EQ settings,
// filter settings and endpoint factor for every stem.  A saved
// state can be restored later via the dropdown in the player bar.
const savedSets = []

// Track the currently selected saved set index.  When a user loads or saves
// a set, this variable is updated so the dropdown reflects the active set.
// A value of null indicates no set has been selected yet.
let currentSavedSetIndex = null

// Temporary variable storing the index of the set the user is about to load.
// This is set when the load confirmation modal opens and cleared when the
// modal closes.  It allows the cancel handler to revert the dropdown to
// its previous selection if the user aborts the load.
let pendingLoadSetIndex = null

/**
 * Capture the current player state across all stems.  This includes
 * the active take for each stem, its mute status, volume level,
 * EQ bands, filter cutoff/mode and endpoint stretch factor.  The
 * returned snapshot can be stored in savedSets and restored later.
 * @returns {object} snapshot of the current player state
 */
function getCurrentPlayerState() {
  const snapshot = { stems: {} }
  STEM_ORDER.forEach(st => {
    // ensure structures exist
    const activeIndex = stemActiveIndex[st] ?? -1
    const mute = !!stemMuteStates[st]
    const vol = stemControlValues[st]?.volume ?? 80
    const eq = { ...(stemEqValues[st] || {}) }
    const filt = { ...(stemFilterValues[st] || {}) }
    const endpoint = endpointFactors[st] ?? 1
    snapshot.stems[st] = {
      activeIndex,
      mute,
      volume: vol,
      eq,
      filter: filt,
      endpoint
    }
  })
  return snapshot
}

// Wrapper function for updating session info card
function updateSessionInfoCard() {
  updateSessionInfoCardImpl(stemControlValues, getRootText)
}

/**
 * Restore a previously saved player state.  This function iterates
 * through each stem and applies the saved settings: select the
 * appropriate take, set volume, mute/unmute, apply EQ and filter
 * values and adjust the endpoint stretch.  UI and audio nodes are
 * updated accordingly.  Returns a Promise that resolves once all
 * stems have been restored.  While the restoration is largely
 * synchronous, wrapping it in a Promise allows the caller to await
 * completion before closing modals or spinners.
 * @param {object} snapshot The saved state to apply
 */
async function applyPlayerState(snapshot) {
  if (!snapshot || !snapshot.stems) return
  // For each stem in the order, restore its state
  for (const st of STEM_ORDER) {
    const saved = snapshot.stems[st]
    if (!saved) continue
    // Select take if index is valid
    if (typeof saved.activeIndex === 'number' && saved.activeIndex >= 0) {
      selectStemVersion(st, saved.activeIndex)
    }
    // Volume
    if (typeof saved.volume === 'number') {
      setVolumeUnified(st, saved.volume)
    }
    // Mute state
    if (typeof saved.mute === 'boolean') {
      if (!!stemMuteStates[st] !== saved.mute) {
        toggleMute(st)
      }
    }
    // EQ bands
    if (saved.eq) {
      const eqVals = saved.eq
      if (typeof eqVals.low === 'number') setEqValue(st, 'low', eqVals.low)
      if (typeof eqVals.mid === 'number') setEqValue(st, 'mid', eqVals.mid)
      if (typeof eqVals.high === 'number') setEqValue(st, 'high', eqVals.high)
    }
    // Filter cutoff and mode
    if (saved.filter) {
      const f = saved.filter
      // cutoff value (0-100)
      if (typeof f.cutoff === 'number') setFilterCutoff(st, f.cutoff)
      // mode (lowpass/highpass)
      if (f.mode && stemFilterValues[st]?.mode !== f.mode) {
        // toggle until mode matches
        if ((stemFilterValues[st]?.mode || 'lowpass') !== f.mode) {
          toggleFilterMode(st)
        }
      }
    }
    // Endpoint factor
    if (typeof saved.endpoint === 'number') {
      endpointFactors[st] = saved.endpoint
      adjustEndpoint(st, saved.endpoint)
    }
  }
  // After restoring all stems, update session info display since tempo/bars
  // might change when selecting a different take.
  updateSessionInfoCard()
  // Update mixer panels and other UI (history indicators, card colours)
  STEM_ORDER.forEach(st => {
    updateHistoryIndicator(st)
    updateCardNumberColor(st)
    updateMutedBorder(st)
    updateTempoIndicator(st)
  })
  return
}

/**
 * Refresh the options in the saved sets dropdown based on the
 * current savedSets array.  The dropdown displays "Set 1", "Set 2", etc.
 * The placeholder option remains at the top with an empty value.
 */
function updateSavedSetsDropdown() {
  const dd = document.getElementById('savedSetsDropdown')
  if (!dd) return
  // Clear current options except the placeholder
  dd.innerHTML = ''
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = '------'
  dd.appendChild(placeholder)
  savedSets.forEach((set, idx) => {
    const opt = document.createElement('option')
    opt.value = String(idx)
    opt.textContent = `Set ${idx + 1}`
    dd.appendChild(opt)
  })
}

/**
 * Persist the current player state into the savedSets array.  After saving,
 * the dropdown is refreshed to include the new entry.  No user
 * confirmation is required when saving; the action always succeeds.
 */
function saveCurrentPlayerState() {
  const snapshot = getCurrentPlayerState()
  savedSets.push(snapshot)
  updateSavedSetsDropdown()
}

// ------------------------- Load Set Modal handlers -------------------------

/**
 * Open the load set confirmation modal for the given saved set index.  This
 * populates the description text, shows the modal and attaches event
 * handlers to the confirm and cancel buttons.  The dropdown is reset
 * after invocation, so the user must select again if they cancel.
 * @param {number} index Index of the set in savedSets
 */
function openLoadSetModal(index) {
  const modal = document.getElementById('loadSetModal')
  if (!modal) return
  const desc = document.getElementById('loadSetDescription')
  if (desc) desc.textContent = `Load Set ${index + 1}? This will replace your current mix.`
  // Store index on confirm button for reference
  const confirmBtn = document.getElementById('loadSetConfirmBtn')
  if (confirmBtn) confirmBtn.setAttribute('data-set-index', String(index))
  // Reset spinner and label
  const spinner = document.getElementById('loadSetSpinner')
  const label = document.getElementById('loadSetConfirmLabel')
  if (spinner) spinner.classList.add('hidden')
  if (label) label.textContent = 'Load'
  // Remember which set is pending for load; used to revert on cancel
  pendingLoadSetIndex = index
  // Show modal with fade-in
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.style.opacity = '1'
    modal.firstElementChild?.classList.remove('scale-95')
    modal.firstElementChild?.classList.add('scale-100')
  })
}

/**
 * Close the load set modal without taking any action.  This resets
 * opacity/scale transitions and clears any stored index on the confirm
 * button.  Should be called when the user cancels or after loading.
 */
function closeLoadSetModal() {
  const modal = document.getElementById('loadSetModal')
  if (!modal) return
  // Hide modal with fade-out
  modal.style.opacity = '0'
  modal.firstElementChild?.classList.remove('scale-100')
  modal.firstElementChild?.classList.add('scale-95')
  setTimeout(() => {
    modal.classList.add('hidden')
  }, 200)
  // Clear the stored index
  const confirmBtn = document.getElementById('loadSetConfirmBtn')
  if (confirmBtn) confirmBtn.removeAttribute('data-set-index')
  // Reset pending index
  pendingLoadSetIndex = null
}

/**
 * Restore the saved set at the specified index.  Shows a loading spinner
 * while applyPlayerState runs.  When the state has been applied,
 * hides the modal.  If the index is invalid, simply close the modal.
 * @param {number} index Index of the saved set to load
 */
async function loadSavedSet(index) {
  if (index == null || index < 0 || index >= savedSets.length) {
    closeLoadSetModal()
    return
  }
  const confirmBtn = document.getElementById('loadSetConfirmBtn')
  const spinner = document.getElementById('loadSetSpinner')
  const label = document.getElementById('loadSetConfirmLabel')
  if (confirmBtn && spinner && label) {
    // Show spinner and hide label
    label.textContent = 'Loading'
    spinner.classList.remove('hidden')
  }
  const snapshot = savedSets[index]
  try {
    await applyPlayerState(snapshot)
  } catch (err) {
    console.error('Failed to apply saved set', err)
  }
  // Hide spinner and close modal
  if (confirmBtn && spinner && label) {
    spinner.classList.add('hidden')
    label.textContent = 'Load'
  }
  closeLoadSetModal()
}

/**
 * Set up the saved state feature: attach listeners to the save button,
 * dropdown and modal buttons.  Call this once after the player bar and
 * mixer have been initialised.
 */
function initSavedStateFeature() {
  const saveBtn = document.getElementById('saveStateBtn')
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      // Check if user is authenticated before allowing save
      const { canUserSave } = await import('./Auth/selectionPage.js')
      const canSave = await canUserSave()

      if (canSave) {
        // User is authenticated, proceed with save
        openSaveSetModal()
      } else {
        // User not authenticated, show login modal
        const { showSaveLoginModal } = await import('./Auth/selectionPage.js')
        showSaveLoginModal()
      }
    })
  }
  const dropdown = document.getElementById('savedSetsDropdown')

  if (dropdown) {
    ;(async () => {
      try {
        // Populate dropdown from cloud sets (ascending by name)
        const { loadSavedStemsStatesFromCloudStorage } = await import('./playerControl/index.js')
        const sets = await loadSavedStemsStatesFromCloudStorage()
        if (Array.isArray(sets)) {
          // Reset options, keep placeholder
          dropdown.innerHTML = ''
          const placeholder = document.createElement('option')
          placeholder.value = ''
          placeholder.textContent = '------'
          dropdown.appendChild(placeholder)
          const sorted = [...sets].sort((a, b) => {
            const an = (a?.name || '').toLowerCase()
            const bn = (b?.name || '').toLowerCase()
            if (an < bn) return -1
            if (an > bn) return 1
            return 0
          })
          sorted.forEach(s => {
            const opt = document.createElement('option')
            opt.value = String(s.id)
            opt.textContent = s.name || s.id
            dropdown.appendChild(opt)
          })
        }
      } catch (e) {
        console.warn('Could not populate saved sets dropdown from cloud:', e)
      }
    })()
    dropdown.addEventListener('change', (e) => {
      const val = e.target.value
      // If no set selected, do nothing
      if (!val) return
      const index = parseInt(val, 10)
      if (isNaN(index)) return
      // Record current selection so it can be restored on cancel
      // currentSavedSetIndex holds the last successfully loaded or saved set
      // Open confirmation modal for loading
      openLoadSetModal(index)
    })
  }
  // Cancel button on load set modal
  const cancelBtn = document.getElementById('loadSetCancelBtn')
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      cancelLoadSet()
    })
  }
  // Confirm button on load set modal
  const confirmBtn = document.getElementById('loadSetConfirmBtn')
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      const idxAttr = confirmBtn.getAttribute('data-set-index')
      const idx = idxAttr ? parseInt(idxAttr, 10) : NaN
      if (!isNaN(idx)) {
        // On confirm, proceed with loading the set and update the selection
        confirmLoadSet(idx)
      } else {
        cancelLoadSet()
      }
    })
  }
  // Hook up the save set modal buttons
  const saveModalCancel = document.getElementById('saveSetCancelBtn')
  if (saveModalCancel) {
    saveModalCancel.addEventListener('click', () => {
      closeSaveSetModal()
    })
  }
  const saveModalConfirm = document.getElementById('saveSetConfirmBtn')
  if (saveModalConfirm) {
    saveModalConfirm.onclick = () => {
      console.log("saveNewSetBtn Clicked")
      saveNewSet()
    }
  }
  // Hook up download confirmation modal buttons
  const dlCancel = document.getElementById('downloadConfirmCancelBtn')
  if (dlCancel) {
    dlCancel.addEventListener('click', () => {
      closeDownloadConfirmModal()
    })
  }
  const dlConfirm = document.getElementById('downloadConfirmBtn')
  if (dlConfirm) {
    dlConfirm.addEventListener('click', () => {
      confirmDownloadAll()
    })
  }
}

/* =========================================================
   Header User Menu
   ========================================================= */
/**
 * Initialise the user avatar menu in the header.  When the avatar
 * button is clicked, a dropdown menu appears with credits, library,
 * account and logout options.  Clicking outside the menu closes it.
 */
// moved to ./UI/userMenu.js
// setupUserMenu moved to ./UI/userMenu.js

/**
 * Open the save set confirmation modal.  This prompts the user to
 * save the current state to a new set.  The next set number is
 * derived from savedSets.length + 1.  The modal shows no spinner
 * initially.
 */
function openSaveSetModal() {
  const modal = document.getElementById('saveSetModal')
  if (!modal) return
  const desc = document.getElementById('saveSetDescription')
  if (desc) {
    const nextNum = savedSets.length + 1
    desc.textContent = `Save current state as Set ${nextNum}?`
  }
  // Reset spinner and label
  const spinner = document.getElementById('saveSetSpinner')
  const label = document.getElementById('saveSetConfirmLabel')
  if (spinner) spinner.classList.add('hidden')
  if (label) label.textContent = 'Save'
  // Show modal with fade-in
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.style.opacity = '1'
    modal.firstElementChild?.classList.remove('scale-95')
    modal.firstElementChild?.classList.add('scale-100')
  })
}

/**
 * Close the save set modal.
 */
function closeSaveSetModal() {
  const modal = document.getElementById('saveSetModal')
  if (!modal) return
  modal.style.opacity = '0'
  modal.firstElementChild?.classList.remove('scale-100')
  modal.firstElementChild?.classList.add('scale-95')
  setTimeout(() => { modal.classList.add('hidden') }, 200)
}

/**
 * Persist the current state to a new saved set.  This function is
 * invoked by the save set confirm button.  It displays a spinner while
 * saving, updates the dropdown, selects the new set and closes the
 * modal when complete.
 */

function encodeWAV(audioBuffer) {
  try {
    if (!audioBuffer || typeof audioBuffer.numberOfChannels !== 'number') {
      throw new Error('Invalid AudioBuffer: missing numberOfChannels')
    }
    const srcCh = audioBuffer.numberOfChannels
    const len = audioBuffer.length
    const sr = audioBuffer.sampleRate
    if (srcCh <= 0 || len <= 0 || !sr) {
      throw new Error(`Invalid AudioBuffer dimensions: channels=${srcCh}, length=${len}, sampleRate=${sr}`)
    }
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
  } catch (error) {
    console.error('encodeWAV failed', error)
    throw error
  }
}
const SUPABASE_AUDIO_BUCKET = import.meta.env.VITE_SUPABASE_AUDIO_BUCKET || 'audio-files'

async function bufferToWavAndSave(buffer, filename) {
  try {
    const wav = encodeWAV(buffer)
    const timestampedFilename = `${Date.now()}_${filename}`

    if (fsModule) {
      // save the audio to a directory in the public folder
      const audio_dir = 'public/audio'
      if (!fsModule.existsSync(audio_dir)) {
        fsModule.mkdirSync(audio_dir, { recursive: true })
      }
      const audio_path = `${audio_dir}/${timestampedFilename}`
      fsModule.writeFileSync(audio_path, wav)
      console.log('wav saved to', audio_path)
      return audio_path
    }

    if (!supabase) {
      throw new Error('Supabase client not initialized for storage upload')
    }

    const storagePath = `audio/${timestampedFilename}`
    const { error: uploadError } = await supabase.storage
      .from(SUPABASE_AUDIO_BUCKET)
      .upload(storagePath, wav, {
        contentType: 'audio/wav',
        cacheControl: '3600',
        upsert: false
      })

    if (uploadError) {
      throw uploadError
    }

    const { data: { publicUrl } } = supabase.storage
      .from(SUPABASE_AUDIO_BUCKET)
      .getPublicUrl(storagePath)

    if (!publicUrl) {
      throw new Error('Failed to obtain public URL for uploaded audio')
    }

    console.log('wav uploaded to Supabase storage', publicUrl)
    return publicUrl
  } catch (error) {
    console.error('Failed to save WAV file', error)
    throw error
  }
}
async function saveNewSet() {
  const spinner = document.getElementById('saveSetSpinner')
  const label = document.getElementById('saveSetConfirmLabel')
  if (spinner && label) {
    spinner.classList.remove('hidden')
    label.textContent = 'Saving'
  }
  // Save the state
  const snapshot = getCurrentPlayerState()
  console.log("snapshot", snapshot)
  savedSets.push(snapshot)
  // Determine new index
  const newIndex = savedSets.length - 1
  const set_name = `Set ${newIndex + 1}`
  const set_description = `Saved on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`
  const set_data = {
    id: null,
    name: set_name,
    description: set_description,
    stems_states: snapshot
  }
  console.log("set_data", set_data)
  console.log("savedSets", savedSets)

  // fetching the current session setting from localStorage
  const currentSessionSetting = localStorage.getItem('currentSessionSetting')
  console.log("currentSessionSetting", currentSessionSetting)
  if (currentSessionSetting) {
    const currentSessionSettingObj = JSON.parse(currentSessionSetting)
    const existingSessionSettingIdRaw = currentSessionSettingObj.session_setting_id ?? currentSessionSettingObj.id ?? null
    const existingSessionSettingId =
      typeof existingSessionSettingIdRaw === 'number'
        ? existingSessionSettingIdRaw
        : (typeof existingSessionSettingIdRaw === 'string' && /^\d+$/.test(existingSessionSettingIdRaw)
            ? Number(existingSessionSettingIdRaw)
            : null)

    // check if the current session setting is saved in the database
    if (existingSessionSettingId) {
      if (currentSessionSettingObj.session_setting_id !== existingSessionSettingId) {
        currentSessionSettingObj.session_setting_id = existingSessionSettingId
        currentSessionSettingObj.id = existingSessionSettingId
        localStorage.setItem('currentSessionSetting', JSON.stringify(currentSessionSettingObj))
      }
      // Save the set data to the database in relation to the session setting
      const { saveSetToDb } = await import('./Auth/stemApi.js')
      const saveResult = await saveSetToDb(set_data, existingSessionSettingId)
      console.log("saveResult", saveResult)
      if (saveResult.success) {
        set_data.id = saveResult.set_id

        // save stems to the database
        const stemsToSave = collectStemsToSave();
        const stemSetId = saveResult.set_id
        let successCount = 0
        let failCount = 0
        const savedStemIds = []

        for (let i = 0; i < stemsToSave.length; i++) {
          const stemData = stemsToSave[i]
          try {

            // creating the audio from the audio buffer
           const audio_path = await bufferToWavAndSave(stemData.audioBuffer, `techno_${stemData.stemType}_${Date.now()}.wav`)
            const saveStemResult = await saveStemToDatabase(
              stemSetId,
              stemData.stemType,
              stemData.prompt,
              stemData.tempo,
              stemData.bars,
              stemData.audioBuffer,
              stemData.tier,
              stemData.validated,
              audio_path
            )

            if (saveStemResult && saveStemResult.success && saveStemResult.stemId) {
              savedStemIds.push({
                stemId: saveStemResult.stemId,
                stemType: stemData.stemType,
                position: i
              })
              successCount++
            } else {
              failCount++
            }
          } catch (error) {
            console.error(`Error saving stem ${stemData.stemType}:`, error)
            failCount++
          }
        }
      }
    } else {
      // Save the session setting to the database and get the id
      const { saveSessionSettingToDb } = await import('./Auth/stemApi.js')
      const result = await saveSessionSettingToDb(currentSessionSettingObj)
      console.log("result", result)
      if (result.success) {
        currentSessionSettingObj.session_setting_id = Number(result.session_setting_id)
        currentSessionSettingObj.id = Number(result.session_setting_id)
        localStorage.setItem('currentSessionSetting', JSON.stringify(currentSessionSettingObj))

        // Save the set data to the database in relation to the session setting
        const { saveSetToDb } = await import('./Auth/stemApi.js')
        const saveResult = await saveSetToDb(set_data, result.session_setting_id)
        console.log("saveResult", saveResult)
        if (saveResult.success) {
          set_data.id = saveResult.set_id
          const stemsToSave = collectStemsToSave();
          const stemSetId = saveResult.set_id
          let successCount = 0
          let failCount = 0
          const savedStemIds = []

          for (let i = 0; i < stemsToSave.length; i++) {
            const stemData = stemsToSave[i]
            try {
              const audio_path = await bufferToWavAndSave(stemData.audioBuffer, `techno_${stemData.stemType}_${Date.now()}.wav`)
              const saveStemResult = await saveStemToDatabase(
                stemSetId,
                stemData.stemType,
                stemData.prompt,
                stemData.tempo,
                stemData.bars,
                stemData.audioBuffer,
                stemData.tier,
                stemData.validated,
                audio_path,
              )

              if (saveStemResult && saveStemResult.success && saveStemResult.stemId) {
                savedStemIds.push({
                  stemId: saveStemResult.stemId,
                  stemType: stemData.stemType,
                  position: i
                })
                successCount++
              } else {
                failCount++
              }
            } catch (error) {
              console.error(`Error saving stem ${stemData.stemType}:`, error)
              failCount++
            }
          }
        }
      }
    }
  }
  // Update dropdown and select new set
  updateSavedSetsDropdown()
  const dropdown = document.getElementById('savedSetsDropdown')
  if (dropdown) {
    dropdown.value = String(newIndex)
  }
  currentSavedSetIndex = newIndex
  // Hide spinner and close modal
  if (spinner && label) {
    spinner.classList.add('hidden')
    label.textContent = 'Save'
  }
  closeSaveSetModal()
}

/**
 * Cancel loading of a saved set.  This reverts the dropdown to the
 * previously selected set (currentSavedSetIndex) and closes the modal.
 */
function cancelLoadSet() {
  // Revert dropdown to previous selection
  const dropdown = document.getElementById('savedSetsDropdown')
  if (dropdown) {
    if (currentSavedSetIndex != null) {
      dropdown.value = String(currentSavedSetIndex)
    } else {
      dropdown.value = ''
    }
  }
  closeLoadSetModal()
}

/**
 * Confirm loading of a saved set.  After the set is loaded, the
 * dropdown selection is updated to reflect the loaded set and the
 * currentSavedSetIndex is updated.  The modal is closed when done.
 * @param {number} idx Index of the set to load
 */
async function confirmLoadSet(idx) {
  // Guard invalid indices
  if (isNaN(idx) || idx < 0 || idx >= savedSets.length) {
    cancelLoadSet()
    return
  }
  // Show spinner on confirm button
  const confirmBtn = document.getElementById('loadSetConfirmBtn')
  const spinner = document.getElementById('loadSetSpinner')
  const label = document.getElementById('loadSetConfirmLabel')
  if (spinner && label) {
    spinner.classList.remove('hidden')
    label.textContent = 'Loading'
  }
  await loadSavedSet(idx)
  // After loadSavedSet returns, update the current set index and dropdown selection
  currentSavedSetIndex = idx
  const dropdown = document.getElementById('savedSetsDropdown')
  if (dropdown) dropdown.value = String(idx)
  // Hide spinner
  if (spinner && label) {
    spinner.classList.add('hidden')
    label.textContent = 'Load'
  }
  // Note: loadSavedSet() closes the modal
}

// moved: openDownloadConfirmModal, closeDownloadConfirmModal, confirmDownloadAll

// Per‑stem UI state for waveform editing.  When true for a given stem, the
// take navigation arrows on that waveform are hidden and the horizontal
// dial overlay for adjusting volume and the endpoint is shown.  Use
// toggleWaveformControls() to change this state.
const waveformEditingState = {}

// Endpoint stretch factors per stem.  A factor of 1.0 means the loop
// plays at its original rate.  Values below 1.0 compress the sound
// (it finishes sooner within the loop), while values above 1.0 stretch
// it (the sound plays back slower) without changing the loop duration.
const endpointFactors = {}

// State for the waveform edit popup.  When a waveform is tapped, we open
// a modal with its own controls for volume and endpoint.  We store
// the stem being edited along with its previous volume and endpoint
// factor so we can revert if the user discards changes.  When the
// modal is closed, isOpen becomes false and stem resets to null.
const waveformEditState = {
  isOpen: false,
  stem: null,
  prevVolume: 0,
  prevEndpointFactor: 1
}

let loopStartTime = 0
let loopDuration = 0
let transportTicker = null

let referenceStemType = null
let referenceHeadIndex = 0 // samples at decoded SR
// Tooltip element for mixer sliders; created during init.  Shows dB or Hz values while adjusting sliders.
let sliderTooltipEl = null

// Track which stem's settings are being edited in the generate settings modal
let currentGenerateStem = null

// Flag indicating whether the session master settings (tempo, bars, key)
// have been selected. Once this flag is true, the session settings are
// locked for the remainder of the session and the setup modal will not be shown again.
let sessionSetupDone = false

// Takes
const stemHistory = {}
const stemActiveIndex = {}
const HISTORY_LIMIT = 50
function ensureStemHistory(st) {
  if (!stemHistory[st]) stemHistory[st] = []
  if (stemActiveIndex[st] == null) stemActiveIndex[st] = -1
}
function pushStemVersion(st, entry) {
  ensureStemHistory(st)
  stemHistory[st].push(entry)
  if (stemHistory[st].length > HISTORY_LIMIT) stemHistory[st].shift()
  stemActiveIndex[st] = stemHistory[st].length - 1
  updateHistoryBadge(st)
  updateHistoryIndicator(st)
  updateCardNumberColor(st)
  updateTempoIndicator(st)
}
function getActiveVersion(st) {
  ensureStemHistory(st)
  const i = stemActiveIndex[st]
  if (i < 0) return null
  return stemHistory[st][i]
}

/* =========================================================
   Supabase client
   ========================================================= */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let supabase = null
if (supabaseUrl && supabaseKey && supabaseUrl !== 'your_supabase_url_here') {
  supabase = createClient(supabaseUrl, supabaseKey)
  console.log('✅ Supabase client initialized')
} else {
  console.warn('⚠️ Supabase not configured - using fallback generation only')
}




/* =========================================================
   Prompt scaffold (unchanged)
   ========================================================= */
const SESSION_TAG = (() => Math.random().toString(36).slice(2, 10))()
function globalScaffold({ tempo, bars, root, mode }) {
  //
  // Construct a global scaffold for the prompt that strongly emphasises
  // strict adherence to tempo and bar length. ElevenLabs documentation
  // notes that the model follows BPM when explicitly told to【732721151118734†L136-L146】.  To
  // reinforce this behaviour, we provide ABSOLUTE directives to insist
  // on the exact tempo and number of bars.  This helps minimise
  // deviations where the generated audio might otherwise be slightly
  // faster or slower than the requested BPM.  The loop description also
  // clarifies that the full length of the audio should match the
  // specified bars at the given tempo, with no extra or missing
  // material.
  return [
    `Project: ${SESSION_TAG}`,
    'Genre: modern techno',
    'TimeSignature: 4/4 (no swing)',
    `Tempo: ${tempo} BPM (constant; no variation)`,
    `Length: EXACT ${bars} bars (no extra bars)`,
    `Key: ${root} ${mode} (strictly diatonic; no modulation)`,
    'Start: bar 1 beat 1 (no count-in; no pre-roll)',
    `End: precisely at end of bar ${bars} (no tail; no reverb/delay bleed)`,
    'Loop: seamless at bar boundary (phase-coherent)',
    'Quantization: strict grid (no humanization)',
    'Delivery: instrumental only',
    // ABSOLUTE directive to follow the tempo and bar count exactly.  This
    // line explicitly instructs the model not to deviate from the given
    // BPM and not to add or remove bars.  We include this to
    // complement the existing instructions above and align with
    // ElevenLabs recommendations【732721151118734†L136-L146】.
    `ABSOLUTE: The loop length must be exactly ${bars} bars at ${tempo} BPM; do not alter the tempo or add/remove bars`
  ].join('. ')
}

/* ---------- Builders (legacy stubs removed; using TechnoGenerators exports) ---------- */


/* =========================================================
   Audio graph (Filter + EQ)
   ========================================================= */
async function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)()
    masterGain = audioContext.createGain()
    masterGain.gain.setValueAtTime(0.9, audioContext.currentTime)
    masterGain.connect(audioContext.destination)

    // On iOS 17+ devices, the Audio Session API allows web apps to specify
    // the intended audio behaviour.  When the phone's ringer switch is set
    // to silent, web audio is muted unless the session type is set to
    // "playback"【76389239852111†L94-L98】.  Attempting to set
    // navigator.audioSession.type informs the browser that audio is
    // essential and should ignore the silent switch.  Wrap in try/catch
    // because this API is only available in some Safari versions.
    try {
      if (navigator?.audioSession && navigator.audioSession.type !== 'playback') {
        navigator.audioSession.type = 'playback'
      }
    } catch (err) {
      console.warn('Failed to set navigator.audioSession.type:', err)
    }

    // ----------------------------------------------------------------------
    // Fallback for devices/browsers where navigator.audioSession is
    // unavailable (pre‑iOS 17 and some Android browsers).  On these
    // platforms, web audio will be muted if the hardware ringer switch is
    // set to silent.  To unmute web audio, we play a very short silent
    // MP3 via a temporary <audio> element and also trigger a one‑sample
    // buffer through a secondary AudioContext.  This pattern is based on
    // community recommendations and WaveSurfer's ignoreSilenceMode
    // implementation and ensures that the browser promotes the audio
    // session to media playback【76389239852111†L94-L98】.  Because the
    // silent track is inaudible and removed immediately after playback
    // begins, it does not disturb the user.  We only execute this once
    // and only when navigator.audioSession is not present.
    try {
      if (!navigator?.audioSession) {
        // Define a no‑op flag to prevent multiple invocations.
        if (!window.__sg_ignore_silent_mode_ran__) {
          window.__sg_ignore_silent_mode_ran__ = true
            ; (function playSilent() {
              try {
                // 1. Create a throwaway AudioContext and play a single sample
                const ac2 = new (window.AudioContext || window.webkitAudioContext)()
                const buf = ac2.createBuffer(1, 1, 44100)
                const src = ac2.createBufferSource()
                src.buffer = buf
                src.connect(ac2.destination)
                src.start(0)
                // 2. Create an <audio> element with a short silent MP3 (3 ms)
                const audio = document.createElement('audio')
                // iOS requires playsinline and denies AirPlay for such sounds
                audio.setAttribute('playsinline', '')
                audio.setAttribute('x-webkit-airplay', 'deny')
                // Base64‑encoded 3ms silent MP3
                audio.src =
                  'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjM2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////////////////////////////////////////////////////8AAAAATGF2YzU2LjQxAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV'
                audio.volume = 0
                // Load and play the silent audio; catch errors silently
                const playPromise = audio.play()
                if (playPromise && playPromise.catch) {
                  playPromise.catch(() => { })
                }
                // Remove the element after a brief delay
                setTimeout(() => {
                  if (audio.parentNode) audio.parentNode.removeChild(audio)
                }, 1000)
              } catch (inner) {
                console.warn('silent mode fallback failed', inner)
              }
            })()
        }
      }
    } catch (ignored) { }

    // Handle platform interruptions such as phone calls.  On some
    // mobile browsers (e.g. iOS Safari) receiving a call causes the
    // AudioContext state to transition to "interrupted".  In this
    // state, audio output is muted and resume() must be called once
    // the interruption ends【739661679219257†L232-L244】.  Attach
    // listeners to automatically resume the context whenever its
    // state transitions to suspended or interrupted, and whenever
    // the page becomes visible again.  These listeners fire even
    // without explicit user gestures, which is permitted when resuming
    // from an interruption.
    const resumeIfPaused = async () => {
      if (!audioContext) return
      const st = audioContext.state
      if (st !== 'running') {
        try {
          await audioContext.resume()
        } catch (err) {
          // Some browsers may reject resume() if hardware is still
          // unavailable (e.g. during an ongoing call).  Log and
          // silently ignore; playback will resume on the next attempt.
          console.warn('AudioContext resume failed:', err)
        }
      }
    }
    // Resume on statechange if the context leaves running state
    audioContext.addEventListener('statechange', () => {
      const st = audioContext.state
      if (st === 'suspended' || st === 'interrupted') {
        resumeIfPaused()
      }
    })
    // Resume when the page/tab becomes visible again
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        resumeIfPaused()
      }
    })
  }
  // If the context is paused (either suspended or interrupted), resume it.
  // The state property can be "suspended" or "interrupted" when the
  // audio hardware is not available.  In both cases, resume() will
  // restart the audio clock and restore playback【739661679219257†L232-L244】.
  if (audioContext.state !== 'running') await audioContext.resume()
}
function createEqNodes() {
  const low = audioContext.createBiquadFilter()
  low.type = 'lowshelf'
  low.frequency.setValueAtTime(EQ_LOW_FREQ, audioContext.currentTime)
  low.gain.setValueAtTime(0, audioContext.currentTime)

  const mid = audioContext.createBiquadFilter()
  mid.type = 'peaking'
  mid.frequency.setValueAtTime(EQ_MID_FREQ, audioContext.currentTime)
  mid.Q.setValueAtTime(EQ_MID_Q, audioContext.currentTime)
  mid.gain.setValueAtTime(0, audioContext.currentTime)

  const high = audioContext.createBiquadFilter()
  high.type = 'highshelf'
  high.frequency.setValueAtTime(EQ_HIGH_FREQ, audioContext.currentTime)
  high.gain.setValueAtTime(0, audioContext.currentTime)

  return { low, mid, high }
}
function knobToFreq(val) {
  const v = Math.max(0, Math.min(100, Number(val) || 0))
  const lnMin = Math.log(FILTER_MIN_HZ), lnMax = Math.log(FILTER_MAX_HZ)
  const lnF = lnMin + (v / 100) * (lnMax - lnMin)
  return Math.exp(lnF)
}
function freqToKnob(freq) {
  const f = Math.max(FILTER_MIN_HZ, Math.min(FILTER_MAX_HZ, Number(freq) || FILTER_DEFAULT_HZ))
  const lnMin = Math.log(FILTER_MIN_HZ), lnMax = Math.log(FILTER_MAX_HZ)
  const lnF = Math.log(f)
  return Math.round(((lnF - lnMin) / (lnMax - lnMin)) * 100)
}
function createFilterNode(st) {
  const filter = audioContext.createBiquadFilter()
  const vals = stemFilterValues[st] || { mode: 'lowpass', cutoff: freqToKnob(FILTER_DEFAULT_HZ) }
  filter.type = vals.mode
  filter.Q.setValueAtTime(FILTER_Q, audioContext.currentTime)
  filter.frequency.setValueAtTime(knobToFreq(vals.cutoff), audioContext.currentTime)
  return filter
}
function createStemNodes(st, loopBuffer) {
  const src = audioContext.createBufferSource()
  src.buffer = loopBuffer
  src.loop = true
  src.loopStart = 0
  src.loopEnd = loopBuffer.duration

  const env = audioContext.createGain()
  env.gain.setValueAtTime(0, audioContext.currentTime)

  const filter = createFilterNode(st)
  const eq = createEqNodes()

  const g = stemGains[st] || audioContext.createGain()
  if (!stemGains[st]) {
    stemGains[st] = g
    const vol = (stemControlValues[st]?.volume ?? 80) / 100
    g.gain.setValueAtTime(vol, audioContext.currentTime)
    g.connect(masterGain)
  }

  src.connect(env)
  env.connect(filter)
  filter.connect(eq.low)
  eq.low.connect(eq.mid)
  eq.mid.connect(eq.high)
  eq.high.connect(g)

  applyEqValuesToNodes(eq, stemEqValues[st] || { low: EQ_DEFAULT, mid: EQ_DEFAULT, high: EQ_DEFAULT })
  applyFilterValuesToNode(filter, stemFilterValues[st] || { mode: 'lowpass', cutoff: freqToKnob(FILTER_DEFAULT_HZ) })

  return { source: src, env, filter, eq, gain: g }
}

/* =========================================================
   Loop math + seam tools
   ========================================================= */
// (unchanged helpers)
function clampTempo(t) {
  const x = Math.round(Number(t) || DEFAULT_TEMPO);
  return Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, x))
}

function computeTargetFrames(sr, bpm, bars) {
  const beats = bars * 4;
  const seconds = beats * (60 / bpm);
  return Math.round(seconds * sr)
}

function removeDcOffset(buffer) {
  const ch = buffer.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    let sum = 0;
    for (let i = 0; i < d.length; i++)
      sum += d[i];
    const mean = sum / d.length;
    if (Math.abs(mean) > 1e-6) {
      for (let i = 0; i < d.length; i++)
        d[i] -= mean
    }
  }
}
function nearestZeroCrossing(data, around, radius) {
  const n = data.length;
  let best = around, bestVal = Math.abs(data[around] || 0);
  const a = Math.max(0, around - radius), b = Math.min(n - 1, around + radius);
  for (let i = a; i <= b; i++) {
    const v = Math.abs(data[i]);
    if (v < bestVal) {
      bestVal = v; best = i
    }
  }
  return best
}

function detectHeadIndex(buffer) {
  const sr = buffer.sampleRate;
  const maxMs = 1000;
  const maxN = Math.min(buffer.length, Math.round((maxMs / 1000) * sr));
  if (maxN <= 0)
    return 0;
  const x = buffer.getChannelData(0);
  const env = new Float32Array(maxN);
  for (let i = 0; i < maxN; i++) env[i] = Math.abs(x[i]);
  const win = Math.max(2, Math.round((8 / 1000) * sr));
  let acc = 0;
  for (let i = 0; i < win && i < env.length; i++) acc += env[i];
  const sm = new Float32Array(maxN);
  for (let i = 0; i < maxN; i++) {
    if (i >= win)
      acc += env[i] - env[i - win];
    sm[i] = acc / Math.min(win, i + 1)
  }
  let peak = 0;
  for (let i = 0; i < maxN; i++)
    if (sm[i] > peak) peak = sm[i];
  const th = Math.max(Math.pow(10, -45 / 20), peak * 0.12);
  const backOff = Math.round(0.0035 * sr);
  for (let i = 0; i < maxN; i++) if (sm[i] >= th) {
    const z = nearestZeroCrossing(x, Math.max(0, i - backOff), ZERO_FALLBACK_SAMPLES);
    return Math.max(0, z)
  }
  return 0
}

function sampleAt(data, idx) {
  const n = data.length;
  while (idx < 0) idx += n;
  while (idx >= n) idx -= n;
  return data[idx]
}

function findBestSeamOffset(raw, startIdx, targetLen, xfadeN) {
  const sr = raw.sampleRate
  const d0 = raw.getChannelData(0)
  const search = Math.max(0, Math.round((ALIGN_SEARCH_MS / 1000) * sr))
  const step = Math.max(1, Math.round(sr / 12000))
  let bestOffset = 0, bestScore = Number.POSITIVE_INFINITY
  for (let off = -search; off <= search; off += step) {
    let score = 0
    for (let i = 0; i < xfadeN; i += step) {
      const a = sampleAt(d0, startIdx + i + off)
      const b = sampleAt(d0, startIdx + targetLen - xfadeN + i + off)
      const diff = a - b
      score += diff * diff
    }
    if (score < bestScore) { bestScore = score; bestOffset = off }
  }
  return bestOffset
}
function applySeamCrossfade(buffer, xfadeMs = LOOP_XFADE_MS) {
  const sr = buffer.sampleRate, n = buffer.length
  const xfadeN = Math.max(2, Math.round((xfadeMs / 1000) * sr))
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c)
    for (let i = 0; i < xfadeN; i++) {
      const t = i / (xfadeN - 1)
      const wa = Math.cos(0.5 * Math.PI * t), wb = Math.sin(0.5 * Math.PI * t)
      const endIdx = n - xfadeN + i
      d[endIdx] = (d[endIdx] * wa + d[i] * wb)
    }
    d[n - 1] = d[0]
  }
}
function applyEdgeRamps(buffer, rampMs = EDGE_RAMP_MS) {
  const sr = buffer.sampleRate, n = buffer.length
  const ramp = Math.max(2, Math.round((rampMs / 1000) * sr))
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c)
    for (let i = 0; i < ramp && i < n; i++) d[i] *= Math.sin(0.5 * Math.PI * (i / (ramp - 1)))
    for (let i = 0; i < ramp && i < n; i++) d[n - 1 - i] *= Math.sin(0.5 * Math.PI * (1 - (i / (ramp - 1))))
  }
}


/* =========================================================
   Validators (unchanged)
   ========================================================= */
function countOnsets(buf, refractorySec = 0.08, relThresh = 0.35) {
  const sr = buf.sampleRate
  const x = buf.getChannelData(0)
  let sum = 0; for (let i = 0; i < x.length; i += 512) { const v = x[i]; sum += v * v }
  const rms = Math.sqrt(sum / Math.max(1, Math.floor(x.length / 512)))
  const thr = Math.max(0.02, rms * relThresh)
  const refr = Math.max(1, Math.round(refractorySec * sr))
  let peaks = 0, i = 0
  while (i < x.length) { if (Math.abs(x[i]) >= thr) { peaks++; i += refr } else i++ }
  return peaks
}
function validateSnare(buf, bpm, bars, tolMs = 40) {
  const sr = buf.sampleRate
  const barSec = 4 * (60 / bpm)
  const beatSec = 60 / bpm
  const tol = Math.round((tolMs / 1000) * sr)
  const x = buf.getChannelData(0)
  function hasPeakNear(sampleIdx, win = tol, mult = 3.0) {
    const a = Math.max(0, sampleIdx - win), b = Math.min(x.length - 1, sampleIdx + win)
    let s = 0, n = 0; for (let i = a; i <= b; i += 4) { const v = x[i]; s += v * v; n++ }
    const rms = Math.sqrt(s / Math.max(1, n))
    const thr = Math.max(0.02, rms * mult)
    for (let i = a; i <= b; i += 2) if (Math.abs(x[i]) >= thr) return true
    return false
  }
  for (let bar = 0; bar < bars; bar++) {
    const barStart = Math.round(bar * barSec * sr)
    const beat2 = barStart + Math.round(1 * beatSec * sr)
    const beat4 = barStart + Math.round(3 * beatSec * sr)
    if (!hasPeakNear(beat2) || !hasPeakNear(beat4)) return false
  }
  return true
}
function validateHihat(buf, bpm, bars) {
  const expected = bars * 16
  const found = countOnsets(buf, 0.07, 0.35)
  return found >= Math.max(10, Math.round(expected * 0.6))
}

/* =========================================================
   Playback indicators + Play button icon
   ========================================================= */
// Update the progress indicators for each stem.  Instead of using a single
// shared phase for all instruments, compute the phase per stem based on its
// individual loop duration.  This allows stems generated at different tempos
// to display progress accurately and ensures loops remain independent.
function updatePlaybackIndicators() {
  if (!audioContext) return
  const t = audioContext.currentTime
  Object.keys(stemConfigs).forEach(st => {
    const indicator = document.querySelector(`[data-stem-indicator="${st}"]`)
    const buf = stemLoop[st]
    if (!indicator || !buf) return
    const dur = stemLoopDuration[st] || buf.duration
    if (dur <= 0 || !isFinite(dur)) return
    const phase = ((t - loopStartTime) % dur) / dur
    indicator.style.left = `${phase * 100}%`
    indicator.style.opacity = '1'
  })
}
// Wrapper function for updating play button icon
function updatePlayButtonIcon() {
  updatePlayButtonIconImpl(isPlaying)
}

// ----- Waveform dial controls -----
//
// The following helpers manage the horizontal dials that appear on each
// waveform when the user clicks on it.  These dials allow per‑stem
// adjustments of volume and the endpoint stretch factor.  When a
// waveform enters editing mode, the take navigation arrows are hidden
// and the overlay becomes interactive.  The corresponding functions
// handle showing/hiding this overlay, updating the volume both in
// the UI and the audio graph, and rebuilding the stem's loop buffer
// according to the selected endpoint factor.

/**
 * Toggle the visibility of the horizontal dial overlay on a waveform and
 * hide or show the take navigation arrows accordingly.  When
 * activated, the overlay becomes interactive (pointer events
 * enabled) and the arrow zones are hidden.  When deactivated, the
 * overlay is hidden and the arrows become usable again.
 *
 * @param {string} st The stem identifier.
 */
function toggleWaveformControls(st) {
  const cardEl = document.querySelector(`[data-stem="${st}"]`)
  if (!cardEl) return
  const overlay = cardEl.querySelector(`[data-stem-controls="${st}"]`)
  const prevZone = cardEl.querySelector(`[data-action="prev-take"]`)
  const nextZone = cardEl.querySelector(`[data-action="next-take"]`)
  if (!overlay || !prevZone || !nextZone) return
  const currentlyHidden = overlay.classList.contains('hidden')
  if (currentlyHidden) {
    overlay.classList.remove('hidden')
    overlay.classList.remove('pointer-events-none')
    overlay.classList.add('pointer-events-auto')
    prevZone.classList.add('hidden')
    nextZone.classList.add('hidden')
    waveformEditingState[st] = true
  } else {
    overlay.classList.add('hidden')
    overlay.classList.add('pointer-events-none')
    overlay.classList.remove('pointer-events-auto')
    prevZone.classList.remove('hidden')
    nextZone.classList.remove('hidden')
    waveformEditingState[st] = false
  }
}

/**
 * Handle updates from the volume dial slider.  Adjusts the unified
 * volume value for the stem, updates the waveform's vertical scale to
 * visualise the change, and reflects the change in the audio output.
 *
 * @param {string} st The stem identifier.
 * @param {number} val The new slider value (0–100).
 */
function handleVolumeSlider(st, val) {
  if (!st) return
  const v = Math.max(0, Math.min(100, Math.round(Number(val) || 0)))
  // Update the unified volume state and audio gain
  setVolumeUnified(st, v)
  // Do not scale the waveform canvas for the instrument card.  The
  // waveform should remain the same size regardless of the volume so
  // that the take remains clickable even when the volume is set to
  // zero.  Visual feedback for volume is provided only in the edit
  // popup preview.
}

/**
 * Handle updates from the endpoint dial slider.  Computes a stretch
 * factor from the slider value and rebuilds the loop buffer for the
 * stem accordingly.  The loop length remains the same, but the audio
 * content is compressed or expanded within that length.  After
 * rebuilding, the waveform display is updated and the stem restarts at
 * the next loop boundary if playback is active.
 *
 * @param {string} st The stem identifier.
 * @param {number} val The new slider value (50–150).
 */
function handleEndpointSlider(st, val) {
  if (!st) return
  const rawVal = Number(val) || 100
  // Map slider range 50–150 to a factor 0.5–1.5.  Clamp between 0.1 and 3.0 for safety.
  const factor = Math.max(0.1, Math.min(rawVal / 100, 3))
  endpointFactors[st] = factor
  // Persist the endpoint factor on the active take so that when the user
  // switches takes the correct stretch is restored.  Without this the
  // endpoint factor may carry over between takes, causing unexpected
  // changes when navigating through the history.
  {
    const idx = stemActiveIndex[st]
    if (idx != null && idx >= 0 && stemHistory[st] && stemHistory[st][idx]) {
      stemHistory[st][idx].endpointFactor = factor
    }
  }
  adjustEndpoint(st, factor)
}

/**
 * Rebuild a stem's loop buffer based on a stretch/compression factor.  A
 * factor of 1.0 leaves the audio unchanged.  Values below 1.0 compress
 * the raw audio (it finishes sooner within the loop) and values above
 * 1.0 stretch the audio (it takes longer to reach the end) while
 * preserving the overall loop duration.  The algorithm performs a
 * simple resampling with wrap‑around, followed by applying the usual
 * edge ramps and seam crossfade to maintain loop smoothness.
 *
 * @param {string} st The stem identifier.
 * @param {number} factor The stretch factor (>0).
 */
function adjustEndpoint(st, factor) {
  const raw = stemRaw[st] || stemLoop[st]
  if (!raw) return
  const existing = stemLoop[st]
  // Preserve the current loop length if we have one; otherwise use the raw length
  const length = existing ? existing.length : raw.length
  const sr = raw.sampleRate
  const channels = raw.numberOfChannels
  const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: sr })
  /**
   * Perform a pitch‑preserving time stretch on a single channel using a
   * simple overlap‑add (OLA) algorithm.  We use a Hann window and
   * 50% overlap to ensure reasonably smooth reconstruction.  The
   * hop sizes in the input and output domains are related by the
   * stretch factor.  When factor > 1, the audio is compressed (we
   * move further ahead in the input for each output hop).  When
   * factor < 1, the audio is stretched (we move more slowly through
   * the input).  The input is treated as circular so that the loop
   * content wraps naturally.  See: standard OLA/WSOLA techniques in
   * time‑stretch literature【250912434198074†L742-L756】.
   *
   * @param {Float32Array} src The source channel data
   * @param {number} outLen The desired output length in samples
   * @param {number} factor The stretch factor (>0)
   */
  function timeStretchOLA(src, outLen, factor) {
    const srcLen = src.length
    const frameSize = 1024
    const hopOut = frameSize / 2 // 50% overlap
    const hopIn = hopOut * factor
    // Precompute Hann window for smooth crossfades.  With 50% overlap
    // the sum of overlapping Hann windows is unity, so no explicit
    // normalisation is required.
    const window = new Float32Array(frameSize)
    for (let i = 0; i < frameSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)))
    }
    const outBuf = new Float32Array(outLen)
    let posSrc = 0
    let posDst = 0
    // Continue until we have filled the output buffer.  We allow the
    // last window to wrap around at the end of the buffer.
    while (posDst < outLen + frameSize) {
      const baseDst = Math.floor(posDst)
      // For each sample in the frame, add the windowed source sample to the output.
      for (let i = 0; i < frameSize; i++) {
        const outIdx = baseDst + i
        if (outIdx >= outLen) break
        let srcIdx = Math.floor(posSrc + i)
        // Wrap around the source index
        srcIdx = ((srcIdx % srcLen) + srcLen) % srcLen
        outBuf[outIdx] += src[srcIdx] * window[i]
      }
      posSrc += hopIn
      posDst += hopOut
    }
    return outBuf
  }
  for (let c = 0; c < channels; c++) {
    const src = raw.getChannelData(c)
    const stretched = timeStretchOLA(src, length, factor)
    const dst = out.getChannelData(c)
    // Copy stretched data into the AudioBuffer channel
    dst.set(stretched)
  }
  // Apply longer edge ramps and crossfade for a smooth loop
  applyEdgeRamps(out, EDGE_RAMP_MS)
  applySeamCrossfade(out, LOOP_XFADE_MS)
  // Update loop buffer and duration
  stemLoop[st] = out
  stemLoopDuration[st] = out.duration
  // Redraw waveform
  const canvas = document.querySelector(`[data-stem="${st}"] .waveform-canvas`)
  if (canvas) {
    const cfg = stemConfigs[st]
    drawWaveform(canvas, out, `rgb(${getColorRGB(cfg.color)})`)
    // Do not scale the waveform on the card when adjusting the endpoint.
    // Keeping the canvas at a consistent height ensures the user can
    // always click the waveform, even if the volume is very low.
  }
  // Restart playback of this stem on the next boundary if currently playing
  if (isPlaying) {
    restartStemNextBoundary(st)
  }
}

/**
 * Open the waveform edit modal for a specific stem.  This modal
 * displays a preview of the current loop and provides full‑width
 * controls for adjusting volume and endpoint stretch.  Changes take
 * effect immediately (preview and audio), but can be discarded.
 *
 * @param {string} st The stem identifier
 */
function openWaveformEditModal(st) {
  if (!st) return
  const modal = document.getElementById('waveformEditModal')
  if (!modal) return
  waveformEditState.isOpen = true
  waveformEditState.stem = st
  // Prevent background scrolling and interaction while the modal is open
  document.body.style.overflow = 'hidden'
  // Store current values so we can revert on discard
  waveformEditState.prevVolume = stemControlValues[st]?.volume ?? 80
  waveformEditState.prevEndpointFactor = endpointFactors[st] ?? 1
  // Configure the new endpoint dial for this stem.  The dial uses
  // pointer and wheel events to adjust the endpoint factor.  Set the
  // data-stem attribute so generic dial handlers know which stem to
  // modify.  Reset its pattern offset to zero for a consistent
  // starting position when opening the modal.
  const endDial = document.getElementById('waveformEditEndpointDial')
  if (endDial) {
    endDial.setAttribute('data-stem', st)
    endDial.setAttribute('data-dial-type', 'endpoint')
    endDial.setAttribute('data-offset', '0')
    endDial.style.backgroundPosition = '0px 50%'
  }

  // Also update any plus/minus buttons associated with the endpoint dial so they know
  // which stem to adjust.  These buttons have the .dial-btn class and data-dial-type="endpoint".
  {
    const endpointBtns = modal.querySelectorAll('.dial-btn[data-dial-type="endpoint"]')
    endpointBtns.forEach(btn => {
      btn.setAttribute('data-stem', st)
    })
  }
  // Draw initial preview waveform and apply volume scaling
  const prevCanvas = document.getElementById('waveformEditCanvas')
  if (prevCanvas) {
    const cfg = stemConfigs[st]
    drawWaveform(prevCanvas, stemLoop[st], `rgb(${getColorRGB(cfg.color)})`)
    prevCanvas.style.transform = `scaleY(${(waveformEditState.prevVolume || 80) / 100})`
  }

  // Draw bar grid lines on the preview.  The grid divides the width
  // into equal segments corresponding to the number of bars in the loop.
  const gridContainer = document.getElementById('waveformEditGrid')
  if (gridContainer) {
    gridContainer.innerHTML = ''
    // Determine the number of bars from the master settings (default to 4)
    const bars = stemControlValues.master?.bars || DEFAULT_BARS
    for (let i = 0; i < bars; i++) {
      const seg = document.createElement('div')
      seg.style.flex = '1'
      if (i > 0) {
        seg.style.borderLeft = '1px solid rgba(255,255,255,0.15)'
      }
      gridContainer.appendChild(seg)
    }
  }
  // Set up action buttons
  const saveBtn = document.getElementById('editSaveBtn')
  const discardBtn = document.getElementById('editDiscardBtn')
  const defaultBtn = document.getElementById('editDefaultBtn')
  if (saveBtn) {
    saveBtn.onclick = () => closeWaveformEditModal(true)
  }
  if (discardBtn) {
    discardBtn.onclick = () => closeWaveformEditModal(false)
  }
  if (defaultBtn) {
    defaultBtn.onclick = () => {
      // Reset endpoint factor to original (1.0) for this take
      endpointFactors[st] = 1
      // Persist the reset factor on the active take
      const idx = stemActiveIndex[st]
      if (idx != null && idx >= 0 && stemHistory[st] && stemHistory[st][idx]) {
        stemHistory[st][idx].endpointFactor = 1
      }
      // Rebuild the loop and update waveform
      adjustEndpoint(st, 1)
      // Reset dial pattern offset to neutral position
      const endDialEl = document.getElementById('waveformEditEndpointDial')
      if (endDialEl) {
        endDialEl.setAttribute('data-offset', '0')
        endDialEl.style.backgroundPosition = '0px 50%'
      }
      // Redraw preview waveform with current volume scaling
      const prevCanvas2 = document.getElementById('waveformEditCanvas')
      if (prevCanvas2) {
        const cfg2 = stemConfigs[st]
        drawWaveform(prevCanvas2, stemLoop[st], `rgb(${getColorRGB(cfg2.color)})`)
        const volVal2 = stemControlValues[st]?.volume ?? 80
        prevCanvas2.style.transform = `scaleY(${volVal2 / 100})`
      }
    }
  }
  // Clicking on the semi‑transparent overlay should discard changes and close the modal
  const overlay = document.getElementById('waveformEditOverlay')
  if (overlay) {
    overlay.onclick = () => closeWaveformEditModal(false)
  }
  // Show modal
  modal.classList.remove('hidden')
  // Trigger transition; using requestAnimationFrame ensures that the class
  // removal is applied before setting opacity/scale.
  requestAnimationFrame(() => {
    modal.classList.remove('opacity-0')
  })
}

/**
 * Close the waveform edit modal.  If save is false, revert the
 * modifications to the stem's volume and endpoint.  After closing,
 * the editing state is cleared.
 *
 * @param {boolean} save Whether to keep the adjustments
 */
function closeWaveformEditModal(save) {
  if (!waveformEditState.isOpen) return
  const st = waveformEditState.stem
  if (!save && st) {
    // Revert to previous values
    setVolumeUnified(st, waveformEditState.prevVolume)
    endpointFactors[st] = waveformEditState.prevEndpointFactor
    adjustEndpoint(st, waveformEditState.prevEndpointFactor)
    // The card's waveform height is no longer scaled for volume, so there is
    // nothing to revert in terms of the canvas transform.
  }
  // Hide modal
  const modal = document.getElementById('waveformEditModal')
  if (modal) {
    // Start fade out
    modal.classList.add('opacity-0')
    // After animation, hide completely
    setTimeout(() => {
      modal.classList.add('hidden')
    }, 200)
  }
  waveformEditState.isOpen = false
  waveformEditState.stem = null

  // Restore scrolling once the modal has closed
  document.body.style.overflow = ''
}

/* =========================================================
   Transport
   ========================================================= */
function startTransport() {
  if (isPlaying) {
    console.log('Transport already playing, ignoring start request')
    return
  }
  console.log('Starting transport...')
  isPlaying = true
  updatePlayButtonIcon()

  // We no longer compute a global loop duration.  Each stem uses its own
  // buffer length for looping.  Record the start time of this transport so
  // that per‑stem phases can be computed relative to a common origin.
  const t0 = audioContext.currentTime + START_ENV_MS / 1000
  loopStartTime = t0

  Object.keys(stemConfigs).forEach(st => {
    const indicator = document.querySelector(`[data-stem-indicator="${st}"]`)
    if (indicator) { indicator.style.left = '0%'; indicator.style.opacity = '1' }
  })

  Object.keys(stemLoop).forEach(st => {
    const buf = stemLoop[st]
    if (!buf) return
    const nodes = createStemNodes(st, buf)
    stemNodes[st] = nodes
    nodes.env.gain.setValueAtTime(0, t0)
    nodes.env.gain.linearRampToValueAtTime(1, t0 + START_ENV_MS / 1000)
    const vol = (stemControlValues[st]?.volume ?? 80) / 100
    const muted = stemMuteStates[st]
    const soloedOther = (soloedStem && soloedStem !== st)
    nodes.gain.gain.setValueAtTime((muted || soloedOther) ? 0 : vol, t0)
    nodes.source.start(t0)
  })

  if (transportTicker) clearInterval(transportTicker)
  transportTicker = setInterval(() => {
    if (!isPlaying) return
    updatePlaybackIndicators()
  }, 25)

  updateAllMixerGlows()
}
function stopTransport() {
  if (!isPlaying) {
    console.log('Transport not playing, ignoring stop request')
    return
  }
  console.log('Stopping transport...')
  isPlaying = false
  updatePlayButtonIcon()

  const now = audioContext.currentTime
  const stopAt = now + 0.01 // Slightly longer fade to ensure smooth stop

  Object.keys(stemConfigs).forEach(st => {
    const indicator = document.querySelector(`[data-stem-indicator="${st}"]`)
    if (indicator) { indicator.style.left = '0%'; indicator.style.opacity = '0' }
  })

  Object.values(stemNodes).forEach(n => {
    if (!n?.source) return

    // Cancel any scheduled gain changes
    n.env.gain.cancelScheduledValues(now)

    // Get current gain value and set it immediately
    const currentGain = n.env.gain.value
    n.env.gain.setValueAtTime(currentGain, now)

    // Fade out smoothly
    n.env.gain.linearRampToValueAtTime(0, stopAt)

    // Stop the source with proper error handling
    try {
      // Check if source is still playing before stopping
      if (n.source.playbackState !== undefined) {
        // Web Audio API source
        n.source.stop(stopAt)
      } else {
        // Fallback: try to stop immediately
        n.source.stop(now)
      }
    } catch (error) {
      // Source might already be stopped or invalid
      console.warn('Could not stop audio source:', error)
    }
  })

  // Clear all stem nodes
  Object.keys(stemNodes).forEach(k => delete stemNodes[k])

  // Clear transport ticker
  if (transportTicker) {
    clearInterval(transportTicker)
    transportTicker = null
  }

  updateAllMixerGlows()
}
function restartStemNextBoundary(st) {
  if (!isPlaying) return
  const buf = stemLoop[st]
  if (!buf) return
  const dur = stemLoopDuration[st] || buf.duration
  if (dur <= 0) return
  // Compute how far into the current loop we are relative to when playback started.
  // This allows the new buffer to start at the same phase as the old one.
  const elapsed = (audioContext.currentTime - loopStartTime) % dur
  const startAt = audioContext.currentTime
  const next = createStemNodes(st, buf)
  const prev = stemNodes[st]
  stemNodes[st] = next

  const vol = (stemControlValues[st]?.volume ?? 80) / 100
  const muted = stemMuteStates[st]
  const soloedOther = (soloedStem && soloedStem !== st)
  next.gain.gain.setValueAtTime((muted || soloedOther) ? 0 : vol, startAt)
  next.env.gain.setValueAtTime(1, startAt)
  try {
    next.source.start(startAt, elapsed)
  } catch { }
  if (prev?.source) {
    try { prev.source.stop(startAt) } catch { }
  }
  updateMixerGlow(st)
}

/* =========================================================
   Eleven Music compose (unchanged core)
   ========================================================= */
const genControllers = new Map()
function getNewStemController(st) {
  const prev = genControllers.get(st);
  if (prev && !prev.signal.aborted) prev.abort(new DOMException('Superseded', 'AbortError'));
  const ctrl = new AbortController();
  genControllers.set(st, ctrl);
  return ctrl
}
import { buildCompositionPlan, composeOnce, composeWithRetries as composeWithRetriesGen, buildLoopBufferFromRawStrict as buildLoopBufferFromRawStrictGen, buildHihatPrompt as buildHihatPromptGen, buildSnarePrompt as buildSnarePromptGen, buildStemPrompt as buildStemPromptGen } from './TechnoGenerators/index.js'
async function generateStem(st) {
  await ensureAudioContext()

  // Check if user is authenticated for credits system
  const user = getAuthGuard().getCurrentUser()
  let hasCredits = true
  let currentCredits = 0

  if (user) {
    // User is authenticated, check credits
    const CREDITS_PER_GENERATION = 5 // Cost per stem generation
    const creditsResult = await checkCredits(user.id, CREDITS_PER_GENERATION)

    if (creditsResult.error) {
      console.error('Error checking credits:', creditsResult.error)
      alert('Unable to check credits. Please try again.')
      return
    }

    hasCredits = creditsResult.hasCredits
    currentCredits = creditsResult.currentCredits

    if (!hasCredits) {
      alert(`Insufficient credits. You need ${CREDITS_PER_GENERATION} credits to generate a stem. You currently have ${currentCredits} credits.`)
      return
    }
  } else {
    // User is in guest mode, allow generation without credits
    console.log('🎵 Generating stem in guest mode (no credits required)')
  }

  const ctrl = getNewStemController(st)
  const { signal } = ctrl

  // The create button (opens the settings modal) also acts as the trigger for generation.  Select
  // the button that opens the settings (open-create-settings) so we can show loading state.
  const button = document.querySelector(`[data-stem="${st}"] [data-action="open-create-settings"]`)
  const statusEl = document.querySelector(`[data-stem="${st}"] .status-line`)
  const card = document.querySelector(`[data-stem="${st}"]`)

  try {
    if (button) {
      button.disabled = true
      const icon = button.querySelector('[data-lucide]')
      if (icon) {
        icon.setAttribute('data-lucide', 'loader-2');
        icon.classList.add('loading-spin');
        if (window.safeCreateIcons) {
          window.safeCreateIcons()
        }
      }
    }
    if (card) card.classList.add('is-generating')
    const tempo = clampTempo(stemControlValues.master?.tempo ?? DEFAULT_TEMPO)
    const bars = stemControlValues.master?.bars ?? DEFAULT_BARS

    // For guest mode or when Supabase functions are not available, use demo mode
    let audioBuffer, usedPrompt, tier = 0, validated = true, failedValidation = false

    // Check if we should use Supabase functions (only for authenticated users)
    let useSupabaseFunctions = user && supabase

    if (statusEl) {
      if (useSupabaseFunctions) {
        statusEl.textContent = `Creating… (Eleven Music v1)`
      } else {
        statusEl.textContent = `Creating… (Fallback Mode)`
      }
    }

    if (useSupabaseFunctions) {
      try {
        const payload = {
          stem: st,
          controls: stemControlValues[st] || {},
          master: {
            tempo,
            bars,
            rootBase: stemControlValues.master?.rootBase || 'A',
            accidental: stemControlValues.master?.accidental || 'natural',
            mode: stemControlValues.master?.mode || 'Minor'
          },
          use_grok: false
        }
        const { data, error } = await supabase.functions.invoke('generate-techno-stem', { body: payload, signal })
        if (error || !data) {
          throw new Error(error?.message || 'Supabase invocation failed')
        }
        // data should contain audio_b64, usedPrompt, tier, validated
        const { audio_b64, usedPrompt: up, tier: tt, validated: val } = data
        usedPrompt = up || ''
        tier = typeof tt === 'number' ? tt : 0
        validated = val !== false
        // Decode the base64 audio string
        const commaIdx = (audio_b64 || '').indexOf(',')
        const b64 = commaIdx >= 0 ? audio_b64.slice(commaIdx + 1) : audio_b64
        const binaryStr = atob(b64 || '')
        const len = binaryStr.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i)
        audioBuffer = await audioContext.decodeAudioData(bytes.buffer)
        // Determine head index for record keeping
        referenceHeadIndex = detectHeadIndex(audioBuffer)
        referenceStemType = st
        // Use the returned audio as the strict loop
        stemRaw[st] = audioBuffer
        stemLoop[st] = audioBuffer
        stemLoopDuration[st] = audioBuffer.duration
        failedValidation = !validated

        // Deduct credits after successful generation (only if user is authenticated)
        if (validated && user) {
          const CREDITS_PER_GENERATION = 5
          const { error: deductError } = await updateCredits(user.id, -CREDITS_PER_GENERATION)
          if (deductError) {
            console.error('Error deducting credits:', deductError)
          } else {
            console.log(`Credits deducted: ${CREDITS_PER_GENERATION}`)
            // Update user menu to show new credits
            await updateUserMenu()
          }
        }
      } catch (supErr) {
        // Supabase call failed or returned error; fallback to local generation
        console.error('Supabase request failed, falling back to local generation:', supErr)
        useSupabaseFunctions = false
      }
    }

    if (!useSupabaseFunctions) {
      // Fallback to local generation using the original logic
      console.log('🎵 Using fallback generation for stem:', st)

      if (st === 'hihat' || st === 'perc') {
        const res = await composeWithRetriesGen(st, tempo, bars, signal, {
          genTailPadMs: GEN_TAIL_PAD_MS,
          primaryFormat: PRIMARY_OUTPUT_FORMAT,
          usePlan: USE_COMPOSITION_PLAN,
          stemConfigs,
          getMasterForPrompt,
          getControls: (id) => stemControlValues[id],
          buildTierPrompt: (id, controls, master, tier) => id === 'hihat' ? buildHihatPromptGen(controls, master, tier) : buildSnarePromptGen(controls, master, tier),
          decodeAudio: (ab) => audioContext.decodeAudioData(ab),
          validateBuffer: (id, buf, t, b) => id === 'hihat' ? validateHihat(buf, t, b) : validateSnare(buf, t, b),
          statusUpdate: (txt) => { if (statusEl) statusEl.textContent = txt }
        })
        audioBuffer = res.buffer
        usedPrompt = res.usedPrompt
        tier = res.tier
        failedValidation = !!res.failedValidation
      } else {
        const controls = stemControlValues[st] || {}
        const master = getMasterForPrompt()
        const prompt = buildStemPromptGen(st, controls, master).trim()
        const beats = bars * 4
        const seconds = beats * (60 / tempo)
        let music_length_ms = Math.round(seconds * 1000) + GEN_TAIL_PAD_MS
        music_length_ms = Math.max(10000, Math.min(300000, music_length_ms))
        const body = USE_COMPOSITION_PLAN
          ? { composition_plan: buildCompositionPlan(getMasterForPrompt(), stemConfigs[st]?.basePrompt), prompt: null }
          : { prompt, music_length_ms }
        body.stem = st
        body.master = master
        body.tempo = tempo
        body.bars = bars
        const ab = await composeOnce(body, signal)
        audioBuffer = await audioContext.decodeAudioData(ab)
        usedPrompt = prompt
        tier = 0
        failedValidation = false
      }

      // Determine head index and build a strict loop from the raw buffer
      referenceHeadIndex = detectHeadIndex(audioBuffer)
      referenceStemType = st
      const strictLoop = buildLoopBufferFromRawStrictGen(audioBuffer, tempo, bars, referenceHeadIndex, { loopXfadeMs: LOOP_XFADE_MS, edgeRampMs: EDGE_RAMP_MS, alignSearchMs: ALIGN_SEARCH_MS })

      // Store the newly generated raw buffer and strict loop
      stemRaw[st] = audioBuffer
      stemLoop[st] = strictLoop
      stemLoopDuration[st] = strictLoop.duration
      endpointFactors[st] = 1
    }

    // If not using Supabase functions, we already generated demo audio above
    // No additional fallback logic needed

    // Push the new version into history
    pushStemVersion(st, {
      id: `${st}_${Date.now()}`,
      createdAt: new Date().toISOString(),
      prompt: usedPrompt,
      tempo, bars,
      sessionTag: SESSION_TAG,
      headIndex: referenceHeadIndex,
      raw: stemRaw[st],
      meta: { tier, validated: !failedValidation }
    })
    // Store the current endpoint factor on the newly created history entry so it can be restored when selecting the take.
    {
      ensureStemHistory(st)
      const list = stemHistory[st]
      if (list && list.length > 0) {
        const last = list[list.length - 1]
        last.endpointFactor = endpointFactors[st] ?? 1
      }
    }
    renderHistoryDrawer(st)

    // Note: saveStemToDatabase is now only called when user explicitly clicks the save button
    // Draw waveform for the new loop
    const canvas = document.querySelector(`[data-stem="${st}"] .waveform-canvas`)
    if (canvas) {
      const cfg = stemConfigs[st]
      drawWaveform(canvas, stemLoop[st], `rgb(${getColorRGB(cfg.color)})`)
    }
    // After drawing the waveform, update the overlay controls to reflect
    // the current per‑stem volume and the reset endpoint factor.  Also
    // scale the waveform vertically according to the volume.  This
    // ensures that newly generated takes show the correct slider
    // positions and waveform height when the overlay is toggled.
    {
      const overlay = document.querySelector(`[data-stem-controls="${st}"]`)
      if (overlay) {
        const volInput = overlay.querySelector('[data-action="adjust-volume"]')
        if (volInput) volInput.value = String(stemControlValues[st]?.volume ?? 80)
        const endInput = overlay.querySelector('[data-action="adjust-endpoint"]')
        if (endInput) endInput.value = '100'
      }
      // Do not apply any vertical scaling based on volume here.  The
      // waveform on the card keeps a constant height regardless of
      // volume so that the take remains clickable even when the
      // volume is turned down.
    }
    if (statusEl) {
      const base = `Ready (${stemLoop[st].duration.toFixed(3)}s, loop-aligned)`
      statusEl.textContent = failedValidation
        ? `${base} — warning: validator failed after retries (kept strict take)`
        : (tier > 0 ? `${base} — strict tier ${tier + 1}` : `${base}`)
    }

    if (isPlaying) {
      // If the transport is currently running, schedule this stem to restart
      // at the next bar boundary so it aligns with the other loops.
      restartStemNextBoundary(st)
    } else {
      // If nothing is playing yet and we have at least one stem ready,
      // automatically start the transport.  Because the generation is
      // initiated by a user gesture (the stem creation button), browsers
      // permit autoplay here.  Count only non‑null loops to determine
      // whether this is the first generated stem.
      const readyLoops = Object.keys(stemLoop).filter(id => !!stemLoop[id]).length
      if (readyLoops > 0) {
        try {
          await ensureAudioContext()
          startTransport()
        } catch (err) {
          console.warn('Failed to auto‑start transport:', err)
        }
      }
    }
    updateMixerGlow(st)
    updateCardNumberColor(st)
    updateHistoryIndicator(st)
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(`❌ Generation error (${st}):`, err)
      if (statusEl) statusEl.textContent = `Error: ${err.message}`
    } else {
      if (statusEl) statusEl.textContent = 'Generation cancelled'
    }
  } finally {
    if (genControllers.get(st) === ctrl) genControllers.delete(st)
    if (button) {
      button.disabled = false
      const icon = button.querySelector('[data-lucide]')
      if (icon) {
        icon.setAttribute('data-lucide', 'wand-2');
        icon.classList.remove('loading-spin');
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
          try {
            if (window.safeCreateIcons) {
              window.safeCreateIcons()
            }
          } catch (error) {
            console.error('Error updating wand icon:', error)
          }
        }
      }
    }
    if (card) card.classList.remove('is-generating')
  }
}

/* =========================================================
   Downloads (modularized)
   ========================================================= */
function downloadStem(st) { return saveDownloadStem(st, stemLoop, stemConfigs) }

function downloadAllActiveStems() { return saveDownloadAllActiveStems(stemConfigs, stemActiveIndex, stemLoop) }

/* =========================================================
   UI rendering (per card) — with black generate btn, wider sliders, click‑overlay for toggles
   ========================================================= */
// knobToDb, formatDb, knobAngle now imported from Utilities/index.js
function applyEqValuesToNodes(eqNodes, vals) {
  if (!eqNodes || !audioContext) return
  const now = audioContext.currentTime
  eqNodes.low.gain.setTargetAtTime(knobToDb(vals.low), now, EQ_SMOOTH_TC)
  eqNodes.mid.gain.setTargetAtTime(knobToDb(vals.mid), now, EQ_SMOOTH_TC)
  eqNodes.high.gain.setTargetAtTime(knobToDb(vals.high), now, EQ_SMOOTH_TC)
}
function applyFilterValuesToNode(filterNode, vals) {
  if (!filterNode || !audioContext) return
  const now = audioContext.currentTime
  filterNode.type = vals.mode
  filterNode.Q.setTargetAtTime(FILTER_Q, now, FILTER_SMOOTH_TC)
  filterNode.frequency.setTargetAtTime(knobToFreq(vals.cutoff), now, FILTER_SMOOTH_TC)
}
function updateEqKnobVisual(knobEl, val) {
  if (!knobEl) return
  knobEl.dataset.value = String(val)
  const ptr = knobEl.querySelector('[data-eq-pointer]')
  if (ptr) ptr.style.transform = `translateX(-50%) rotate(${knobAngle(val)}deg)`
}
function updateEqReadout(st, band) {
  const v = (stemEqValues[st] || {})[band] ?? EQ_DEFAULT
  const db = knobToDb(v)
  const ro = document.querySelector(`[data-eq-readout="${st}:${band}"]`)
  if (ro) ro.textContent = formatDb(db)
}

/* ---------- Filter UI ---------- */
function updateFilterKnobVisual(knobEl, val) {
  if (!knobEl) return
  knobEl.dataset.value = String(val)
  const ptr = knobEl.querySelector('[data-filter-pointer]')
  if (ptr) ptr.style.transform = `translateX(-50%) rotate(${knobAngle(val)}deg)`
}
function updateFilterReadout(st) {
  const v = (stemFilterValues[st] || {}).cutoff ?? freqToKnob(FILTER_DEFAULT_HZ)
  const hz = knobToFreq(v)
  const ro = document.querySelector(`[data-filter-readout="${st}"]`)
  if (ro) ro.textContent = hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`
}
function updateFilterModeButton(st) {
  const btn = document.querySelector(`[data-filter-mode="${st}"]`)
  if (!btn) return
  const mode = (stemFilterValues[st] || {}).mode || 'lowpass'
  btn.textContent = mode === 'lowpass' ? 'LP' : 'HP'
}

/* ---------- Per-card HTML ---------- */
function eqKnobHTML(st, band, label) {
  const v = (stemEqValues[st] || {})[band] ?? EQ_DEFAULT
  const ang = knobAngle(v)
  return `\n        <div class="flex flex-col items-center select-none">\n          <div class="relative w-10 h-10 rounded-full border border-white/20 bg-white/5 shadow-inner cursor-[ns-resize]"\n               data-eq-knob data-stem="${st}" data-band="${band}" data-value="${v}" title="${label}: drag to adjust">\n            <div class="absolute inset-0 rounded-full" style="box-shadow: inset 0 2px 6px rgba(0,0,0,0.35), inset 0 -1px 2px rgba(255,255,255,0.05)"></div>\n            <div class="absolute w-0.5 h-3 bg-white/90 rounded pointer-events-none"\n                 data-eq-pointer\n                 style="left:50%; bottom:50%; transform: translateX(-50%) rotate(${ang}deg); transform-origin: bottom center;"></div>\n          </div>\n          <div class="mt-1 text-[10px] tracking-wider text-white/80">${label.toUpperCase()}</div>\n          <div class="text-[10px] text-white/60" data-eq-readout="${st}:${band}">${formatDb(knobToDb(v))}</div>\n        </div>\n      `
}
function filterKnobHTML(st) {
  const v = (stemFilterValues[st] || {}).cutoff ?? freqToKnob(FILTER_DEFAULT_HZ)
  const ang = knobAngle(v)
  const mode = (stemFilterValues[st] || {}).mode || 'lowpass'
  return `\n        <div class="flex items-center gap-2">\n          <div class="flex flex-col items-center select-none">\n            <div class="relative w-10 h-10 rounded-full border border-white/20 bg-white/5 shadow-inner cursor-[ns-resize]"\n                 data-filter-knob data-stem="${st}" data-value="${v}" title="Filter Cutoff: drag to adjust">\n              <div class="absolute inset-0 rounded-full" style="box-shadow: inset 0 2px 6px rgba(0,0,0,0.35), inset 0 -1px 2px rgba(255,255,255,0.05)"></div>\n              <div class="absolute w-0.5 h-3 bg-white/90 rounded pointer-events-none"\n                   data-filter-pointer\n                   style="left:50%; bottom:50%; transform: translateX(-50%) rotate(${ang}deg); transform-origin: bottom center;"></div>\n            </div>\n            <div class="mt-1 text-[10px] tracking-wider text-white/80">CUTOFF</div>\n            <div class="text-[10px] text-white/60" data-filter-readout="${st}"></div>\n          </div>\n          <button class="h-6 px-2 rounded-md border border-white/15 bg-white/80 text-black text-[10px] font-semibold tracking-wider hover:bg-white active:translate-y-[1px] transition"\n                  data-action="toggle-filter-mode" data-stem="${st}" data-filter-mode="${st}" title="Toggle LP/HP">\n            ${mode === 'lowpass' ? 'LP' : 'HP'}\n          </button>\n        </div>\n      `
}
function headerActionButtonsHTML(st) {
  return `\n        <div class="flex items-center gap-1.5">\n          <button class="sg-toggle w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="mute-stem" data-stem="${st}" title="Mute/Unmute" aria-pressed="false">\n            <i data-lucide="volume-2" class="w-4 h-4"></i>\n          </button>\n          <button class="sg-toggle w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="solo-stem" data-stem="${st}" title="Solo" aria-pressed="false">\n            <i data-lucide="headphones" class="w-4 h-4"></i>\n          </button>\n          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-stem="${st}" title="Favorite (coming soon)">\n            <i data-lucide="heart" class="w-4 h-4"></i>\n          </button>\n          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="download-stem" data-stem="${st}" title="Download">\n            <i data-lucide="download" class="w-4 h-4"></i>\n          </button>\n        </div>\n      `
}

// Mobile version of header action buttons.  On small screens the action icons
// appear below the card title at 25% smaller size and reduced spacing.  This
// helper is used in the card header markup to display a second row of
// buttons on mobile only (hidden on sm and larger).
function headerActionButtonsMobileHTML(st) {
  return `\n        <div class="flex items-center gap-1 sm:hidden mt-1">\n          <button class="sg-toggle w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="mute-stem" data-stem="${st}" title="Mute/Unmute" aria-pressed="false">\n            <i data-lucide="volume-2" class="w-3 h-3"></i>\n          </button>\n          <button class="sg-toggle w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="solo-stem" data-stem="${st}" title="Solo" aria-pressed="false">\n            <i data-lucide="headphones" class="w-3 h-3"></i>\n          </button>\n          <button class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-stem="${st}" title="Favorite (coming soon)">\n            <i data-lucide="heart" class="w-3 h-3"></i>\n          </button>\n          <button class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="download-stem" data-stem="${st}" title="Download">\n            <i data-lucide="download" class="w-3 h-3"></i>\n          </button>\n        </div>\n      `
}
function createBuilderStemCard(st, cfg) {
  const card = document.createElement('div')
  // Use tighter padding on mobile and moderate padding on larger screens to make cards more compact on small devices.
  card.className = `glass card-border rounded-2xl p-3 sm:p-5 transition-all duration-300 hover:scale-[1.02] border-l-4 border-l-${cfg.color}-500 select-none cursor-default`
  card.setAttribute('data-stem', st)

  const idx = STEM_ORDER.indexOf(st) + 1

  // Build header markup.  On mobile (below sm), action buttons appear on a second row beneath
  // the title and number.  On sm and above, the action buttons appear inline to the right of
  // the title.  We wrap the desktop actions in a hidden container on mobile and include a
  // separate mobile action row using headerActionButtonsMobileHTML.
  const headerHTML = `\n        <div class="flex flex-col sm:flex-row sm:items-center mb-1 sm:mb-2">\n          <!-- First row on mobile: name and number indicator are aligned horizontally. -->\n          <div class="flex items-center justify-between w-full sm:w-auto gap-2">\n            <div class="flex items-center gap-2">\n              <h3 class="text-sm sm:text-base font-medium text-white">${cfg.name}</h3>\n            </div>\n            <span data-card-number="${st}" class="stem-index inline-flex items-center justify-center w-5 h-5 sm:w-5 sm:h-5 text-xs sm:text-xs font-semibold rounded-full border border-white/30">${idx}</span>\n          </div>\n          <!-- Action icons centered on desktop -->\n          <div class="hidden sm:flex flex-1 items-center justify-center gap-1.5">${customHeaderActionButtonsHTML(st)}</div>\n          ${customHeaderActionButtonsMobileHTML(st)}\n        </div>\n      `

  // Removed EQ and Filter controls from the card; these will be shown in the mixer instead.
  const eqFilterHTML = ''

  // Remove per-stem volume control from the card; volume is now controlled in the mixer
  let volumeHTML = ''

  // Waveform display: remove takes/tempo indicators/open button and add left/right arrow zones occupying 25% of the width each.
  // The overlay controls for volume and endpoint have been moved into a modal
  // rather than being drawn over the waveform.  Therefore, we no longer
  // include the overlay markup here.  Clicking on the waveform will open
  // the dedicated edit modal defined in index.html.
  const waveformHTML = `\n        <div class="mb-2">\n          <!-- Waveform container: relative so overlays can be positioned absolutely -->\n          <div class="relative group">\n            <canvas class="waveform-canvas w-full h-16 bg-white/5 rounded-md border border-white/10 cursor-pointer"\n                    width="400" height="64" data-stem="${st}" title="Click to edit this take"></canvas>\n            <!-- Indicator showing current playback position -->\n            <div class="absolute inset-y-0 left-0 w-0.5 bg-purple-400 shadow-glow pointer-events-none transition-all duration-75 ease-linear opacity-0"\n                 data-stem-indicator="${st}"></div>\n            <!-- Edit label overlay: appears on hover to invite editing.  Pointer events are disabled so clicks pass through to the canvas. -->\n            <div class="absolute inset-0 flex items-center justify-center pointer-events-none text-white/70 text-[10px] uppercase tracking-wide opacity-0 group-hover:opacity-100 transition">\n              edit take\n            </div>\n            <!-- Left and right arrow zones: occupy 25% width each.  Entire zone is clickable. Rounded corners match the waveform box on the edges. -->\n            <div class="absolute inset-y-0 left-0 w-1/4 bg-black/50 hover:bg-white/20 flex items-center justify-center rounded-l-md overflow-hidden pointer-events-auto cursor-pointer transition"\n                 role="button" tabindex="0" aria-label="Previous take"\n                 data-action="prev-take" data-stem="${st}" title="Previous take">\n              <i data-lucide="chevron-left" class="w-5 h-5 text-white pointer-events-none"></i>\n            </div>\n            <div class="absolute inset-y-0 right-0 w-1/4 bg-black/50 hover:bg-white/20 flex items-center justify-center rounded-r-md overflow-hidden pointer-events-auto cursor-pointer transition"\n                 role="button" tabindex="0" aria-label="Next take"\n                 data-action="next-take" data-stem="${st}" title="Next take">\n              <i data-lucide="chevron-right" class="w-5 h-5 text-white pointer-events-none"></i>\n            </div>\n          </div>\n        </div>\n        <div class="overflow-hidden transition-all duration-200 ease-out max-h-0" data-history-drawer="${st}">\n          <div class="flex items-center justify-between text-xs text-white/60 mt-1 mb-2">\n            <span>Previous takes</span>\n            <button class="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-[11px]"\n                    data-action="close-history" data-stem="${st}">Close</button>\n          </div>\n          <div class="flex gap-2 overflow-x-auto pb-2 no-scrollbar" data-history-list="${st}"></div>\n        </div>\n      `

  // Volume dial: an infinite horizontal dial positioned between the
  // waveform and the create button.  A minus sign on the left and a plus
  // sign on the right provide a visual cue for volume down/up.  The dial
  // uses data-dial-type="volume" so the generic handlers adjust the
  // volume for this stem when it is dragged or scrolled.
  // Volume dial displays minus and plus buttons flanking an infinite dial.  On mobile the icons retain
  // their original size, while on desktop they double in size (via sm:text-xl).  The
  // .dial-btn class allows us to attach pointer handlers for discrete step adjustments.
  const volumeDialHTML = `\n        <div class="my-2 flex items-center">\n          <span class="dial-btn text-white/60 text-sm sm:text-xl font-extrabold mr-2" data-dial-type="volume" data-dial-step="-1" data-stem="${st}">-</span>\n          <div class="flex-1 infinite-dial" data-dial-type="volume" data-stem="${st}" data-offset="0"></div>\n          <span class="dial-btn text-white/60 text-sm sm:text-xl font-extrabold ml-2" data-dial-type="volume" data-dial-step="1" data-stem="${st}">+</span>\n        </div>\n      `

  // Sliders and toggles are now moved into a popup.  Keep empty strings here to avoid including them on the card.
  let slidersRowsHTML = ''
  let togglesMenuHTML = ''

  // Generate panel: player-surface look, black Generate button, click-to-toggle overlay above sliders
  const genPanelHTML = `\n        <div class="mt-3 rounded-xl player-surface text-white border-2 border-white/80 shadow-sm p-3 relative">\n          <div class="flex items-start gap-4">\n            <div class="relative flex-1">\n              <div class="grid grid-cols-1 gap-2">${slidersRowsHTML}</div>\n              <div class="absolute left-0 right-0 -top-2 z-20 hidden" data-options-panel="${st}">\n                <div class="bg-black border-2 border-white/80 rounded-xl p-3 shadow-xl">\n                  ${togglesMenuHTML || '<div class="text-xs text-white/60">No options</div>'}\n                </div>\n              </div>\n            </div>\n            <div class="flex flex-col items-end">\n              <button class="w-9 h-9 rounded-lg border border-white/30 flex items-center justify-center hover:bg-white/10"\n                      data-action="toggle-stem-options" data-stem="${st}" aria-pressed="false" title="Stem options">\n                <i data-lucide="sliders" class="w-4 h-4"></i>\n              </button>\n            </div>\n          </div>\n          <button class="mt-3 w-full py-2.5 rounded-xl bg-black text-white font-semibold border border-white/30 shadow-sm hover:shadow transition will-change-transform hover:-translate-y-0.5 active:translate-y-[1px]"\n                  data-action="generate" data-stem="${st}" title="Generate new take">\n            <span class="inline-flex items-center gap-2">\n              <i data-lucide="wand-2" class="w-4 h-4"></i>\n              Generate\n            </span>\n          </button>\n        </div>\n      `

  // Define a generate button fragment.  The sliders and toggles are shown in a popup instead of on the card.
  const genButtonHTML = `\n        <div class="mt-3 rounded-xl player-surface text-white border-2 border-white/80 shadow-sm p-2 sm:p-3 relative">\n          <button class="w-full py-2.5 rounded-xl bg-black text-white font-semibold border border-white/30 shadow-sm hover:shadow transition will-change-transform hover:-translate-y-0.5 active:translate-y-[1px]"\n                  data-action="open-generate-settings" data-stem="${st}" title="Generate new take">\n            <span class="inline-flex items-center gap-2">\n              <i data-lucide="wand-2" class="w-4 h-4"></i>\n              Generate\n            </span>\n          </button>\n        </div>\n      `;

  // Define a create button fragment.  This version removes borders and uses "Create" for the label.  It opens
  // a modal for configuring generation settings when clicked.
  const genCreateButtonHTML = `\n        <div class="mt-3 rounded-xl player-surface text-white shadow-sm p-2 sm:p-3 relative">\n          <button class="w-full py-2.5 rounded-xl bg-black text-white font-semibold shadow-sm hover:shadow transition will-change-transform hover:-translate-y-0.5 active:translate-y-[1px]"\n                  data-action="open-create-settings" data-stem="${st}" title="Create new take">\n            <span class="inline-flex items-center gap-2 text-xs sm:text-sm">\n              <i data-lucide="wand-2" class="w-3 h-3 sm:w-4 sm:h-4"></i>\n              Create\n            </span>\n          </button>\n        </div>\n      `;
  // Use our custom create button HTML instead of the default generate button.  Update status line text accordingly.
  card.innerHTML = headerHTML + eqFilterHTML + volumeHTML + waveformHTML + volumeDialHTML + genCreateButtonHTML + `\n        <div class="status-line hidden mt-2 text-sm text-white/80">Ready to create</div>\n      `
  // Enhance the create button markup by attaching classes that allow responsive font and icon sizing.
  // The span within the create button becomes the label, and the icon gets a special class so
  // CSS can target them on mobile.  We cannot edit the template literal easily, so we modify
  // the DOM after insertion.
  {
    const labelSpan = card.querySelector('[data-action="open-create-settings"] span')
    if (labelSpan) labelSpan.classList.add('create-label')
    const iconEl = card.querySelector('[data-action="open-create-settings"] i')
    if (iconEl) iconEl.classList.add('create-icon')

    // Apply responsive sizing for the create button's label and icon: make them 30% smaller on mobile.
    if (labelSpan) labelSpan.classList.add('text-xs', 'sm:text-sm')
    if (iconEl) iconEl.classList.add('w-3', 'h-3', 'sm:w-4', 'sm:h-4')

    // Remove the "Previous takes" label from the history drawer.  We leave only the close button.
    const historySpan = card.querySelector(`[data-history-drawer="${st}"] span`)
    if (historySpan) {
      historySpan.remove()
    }


    // for volume changes is provided exclusively in the edit modal.

    // On small screens, show the number indicator within the header row; hide it on
    // desktop so that it can be shown in the top-right corner of the card.
    const numEl = card.querySelector(`[data-card-number="${st}"]`)
    if (numEl) numEl.classList.add('sm:hidden')

    // Make the card relative so absolute positioning inside works for desktop indicators
    card.classList.add('relative')

    // Create a desktop-only number indicator positioned at the top right of the card.
    const desktopNum = document.createElement('span')
    desktopNum.setAttribute('data-card-number-desktop', st)
    desktopNum.textContent = String(idx)
    // Position with extra padding on desktop (sm:top-5 sm:right-5) so the number indicator isn't flush
    // against the edges. Hidden on mobile (sm:hidden applied on the header indicator instead).
    desktopNum.className = 'hidden sm:flex items-center justify-center w-5 h-5 text-xs font-semibold rounded-full border border-white/30 absolute top-2 right-2 sm:top-5 sm:right-5'
    card.appendChild(desktopNum)

    // Adjust the edit label overlay within the waveform container.  Always show it (remove hover-based
    // opacity) and scale its size responsively.  On mobile the text is smaller; on desktop it is
    // larger and bold white.  Remove the default fade classes to avoid relying on hover state.
    {
      const overlayEl = card.querySelector('.relative .pointer-events-none')
      if (overlayEl) {
        // Remove fade and original size classes
        overlayEl.classList.remove('opacity-0', 'group-hover:opacity-100', 'text-white/70', 'text-[10px]')
        // Always fully visible
        overlayEl.classList.add('opacity-100')
        // Use smaller text on mobile (approx 25% smaller) and larger bold text on desktop
        overlayEl.classList.add('text-white/70', 'text-[8px]', 'sm:text-[20px]', 'sm:font-bold', 'sm:text-white')
      }
    }
  }

  updateHistoryBadge(st)
  updateFilterReadout(st)
  return card
}

/* =========================================================
   Master controls, Mixer (Docked), events
   ========================================================= */
function initializeStemControlValues() {
  stemControlValues = {
    master: { tempo: DEFAULT_TEMPO, bars: DEFAULT_BARS, rootBase: 'A', accidental: 'natural', mode: 'Minor' }
  }
  stemMuteStates = {}
  const defCutKnob = freqToKnob(FILTER_DEFAULT_HZ)
  Object.entries(stemConfigs).forEach(([st, cfg]) => {
    stemControlValues[st] = {}
    stemMuteStates[st] = false
    // Initialise endpoint stretch factor for each stem (1.0 = no stretch)
    endpointFactors[st] = 1
    if (!stemEqValues[st]) stemEqValues[st] = { low: 75, mid: 75, high: 75 }
    if (!stemFilterValues[st]) stemFilterValues[st] = { mode: 'lowpass', cutoff: defCutKnob }
    if (cfg.controls) {
      Object.entries(cfg.controls).forEach(([k, c]) => {
        // Initialise controls with provided defaults
        stemControlValues[st][k] = c.default
      })
      // Override volume default to 75 (toward the right) so all channels start at 0 dB with the new mapping
      if ('volume' in cfg.controls) {
        stemControlValues[st].volume = 75
      }
    }
  })
}

/* ---------- Mixer glow ---------- */
function isStemActuallyPlaying(st) { return isPlaying && !!stemNodes[st]?.source && !stemMuteStates[st] && (!soloedStem || soloedStem === st) }
function updateMixerGlow(st) { const card = document.querySelector(`[data-mix-card="${st}"]`); if (!card) return; card.classList.toggle('sg-glow', isStemActuallyPlaying(st)) }
function updateAllMixerGlows() { Object.keys(stemConfigs).forEach(updateMixerGlow) }

/* ---------- Toggle visuals (Mute/Solo) ---------- */
function setToggleVisual(el, active) { if (!el) return; el.classList.toggle('sg-toggle-active', !!active); el.setAttribute('aria-pressed', active ? 'true' : 'false') }
function reflectMuteSoloButtons(st) {
  const muted = !!stemMuteStates[st]
  const soloed = (soloedStem === st)
  // Update all mute buttons on the instrument card (desktop and mobile)
  document.querySelectorAll(`[data-stem="${st}"] [data-action="mute-stem"]`).forEach(btn => setToggleVisual(btn, muted))
  // Update all solo buttons on the instrument card (desktop and mobile)
  document.querySelectorAll(`[data-stem="${st}"] [data-action="solo-stem"]`).forEach(btn => setToggleVisual(btn, soloed))
  // Update mute/solo buttons in the mixer
  document.querySelectorAll(`[data-action="mix-mute"][data-stem="${st}"]`).forEach(btn => setToggleVisual(btn, muted))
  document.querySelectorAll(`[data-action="mix-solo"][data-stem="${st}"]`).forEach(btn => setToggleVisual(btn, soloed))
}

/* ---------- Volume link ---------- */
function setVolumeUnified(st, newVal) {
  const v = Math.max(0, Math.min(100, Math.round(Number(newVal) || 0)))
  stemControlValues[st].volume = v

  // Update legacy card volume slider if present
  const cardSlider = document.querySelector(`[data-stem="${st}"] [data-control="volume"]`)
  if (cardSlider) {
    cardSlider.value = v
    const display = cardSlider.parentElement?.querySelector('span:last-child')
    const cfg = stemConfigs[st]?.controls?.volume
    if (display && cfg) display.textContent = `${v}${cfg.unit}`
  }
  // Update new mixer volume slider if present; value display is handled via tooltip
  const mixSlider = document.querySelector(`input[data-mix-slider="volume"][data-stem="${st}"]`)
  if (mixSlider) {
    mixSlider.value = String(v)
  }

  if (isPlaying && stemNodes[st]?.gain) {
    const vol = v / 100
    const muted = stemMuteStates[st]
    const blocked = (soloedStem && soloedStem !== st)
    if (!muted && !blocked) {
      const p = stemNodes[st].gain.gain, t = audioContext.currentTime
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(vol, t + 0.01)
    }
  }
}

/* ---------- Master state helpers ---------- */
function getRootText() {
  const base = stemControlValues.master?.rootBase || 'A'
  const acc = stemControlValues.master?.accidental || 'natural'
  return acc === 'sharp' ? `${base}#` : acc === 'flat' ? `${base}b` : base
}
/**
 * Save a generated stem to the database
 * Runs in background without blocking UI
 * @param {string} st - Stem type
 * @param {string} prompt - Generation prompt
 * @param {number} tempo - Tempo in BPM
 * @param {number} bars - Number of bars
 * @param {AudioBuffer} audioBuffer - Audio buffer
 * @param {number} tier - Generation tier
 * @param {boolean} validated - Whether validation passed
 */
async function saveStemToDatabase(stemSetId, st, prompt, tempo, bars, audioBuffer, tier, validated, audioUrl) {
  try {
    // Only save if user is authenticated
    const user = getAuthGuard().getCurrentUser()
    if (!user) {
      console.log('Skipping database save for guest user')
      return { success: false, error: 'User not authenticated' }
    }

    // Get master settings for key signature
    const master = getMasterForPrompt()
    const keySignature = `${master.root} ${master.mode}`

    // Prepare stem data for persistence
    const stemData = {
      stemSetId: stemSetId,
      stemType: st,
      prompt: prompt,
      tempo: tempo,
      bars: bars,
      keySignature: keySignature,
      generationTier: tier || 0,
      validated: validated || false,
      audioData: audioBuffer, // AudioBuffer will be converted to ArrayBuffer in saveStem
      audioUrl: audioUrl || null,
      durationSeconds: audioBuffer.duration
    }

    // Save the stem (this links it to the set via stem_set_id)
    const result = await saveStem(stemData)

    if (result.success) {
      console.log(`✅ Stem saved to database: ${st} (ID: ${result.stemId})`)
      return result
    } else {
      console.warn(`Failed to save stem to database: ${st}`, result.error)
      return result
    }
  } catch (error) {
    console.error(`Error saving stem ${st} to database:`, error)
    return { success: false, error: error.message }
  }
}

/**
 * Collect all stems that have been generated and can be saved
 * @returns {Array} Array of stem data objects ready for saving
 */
function collectStemsToSave() {
  const stemsToSave = []

  STEM_ORDER.forEach(st => {
    const activeIndex = stemActiveIndex[st] ?? -1
    if (activeIndex >= 0 && stemHistory[st] && stemHistory[st][activeIndex]) {
      const version = stemHistory[st][activeIndex]
      if (version.raw) {
        const master = getMasterForPrompt()
        stemsToSave.push({
          stemType: st,
          prompt: version.prompt || '',
          tempo: version.tempo || clampTempo(master.tempo),
          bars: version.bars || master.bars,
          audioBuffer: version.raw,
          tier: version.meta?.tier || 0,
          validated: version.meta?.validated !== false
        })
      }
    }
  })

  return stemsToSave
}

/**
 * Show the save to database confirmation modal for authenticated users
 * @param {Array} stemsToSave - Array of stems to save
 */
function showSaveToDbConfirmModal(stemsToSave) {
  const modal = document.getElementById('saveToDbConfirmModal')
  if (!modal) return

  // Update stem list
  const stemListEl = document.getElementById('saveToDbStemList')
  if (stemListEl) {
    if (stemsToSave.length === 0) {
      stemListEl.innerHTML = '<p class="text-white/60">No stems available to save.</p>'
    } else {
      stemListEl.innerHTML = stemsToSave.map(s => {
        const cfg = stemConfigs[s.stemType]
        return `<div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full" style="background-color: rgb(${getColorRGB(cfg.color)})"></div>
          <span>${cfg.name}</span>
        </div>`
      }).join('')
    }
  }

  // Update description
  const descEl = document.getElementById('saveToDbConfirmDescription')
  if (descEl) {
    descEl.textContent = stemsToSave.length === 0
      ? 'No stems available to save.'
      : `Save ${stemsToSave.length} stem${stemsToSave.length > 1 ? 's' : ''} to your cloud storage?`
  }

  // Show modal
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.style.opacity = '1'
    const content = modal.querySelector('.transform') || modal.querySelector('.player-surface')
    if (content) {
      content.classList.remove('scale-95')
      content.classList.add('scale-100')
    }
    // Initialize icons
    if (window.safeCreateIcons) {
      window.safeCreateIcons()
    }
  })
}

/**
 * Close the save to database confirmation modal
 */
function closeSaveToDbConfirmModal() {
  const modal = document.getElementById('saveToDbConfirmModal')
  if (!modal) return

  modal.style.opacity = '0'
  const content = modal.querySelector('.transform') || modal.querySelector('.player-surface')
  if (content) {
    content.classList.remove('scale-100')
    content.classList.add('scale-95')
  }

  setTimeout(() => {
    modal.classList.add('hidden')
  }, 300)
}

/**
 * Show the email input modal for non-authenticated users
 */
function showSaveToDbEmailModal() {
  const modal = document.getElementById('saveToDbEmailModal')
  if (!modal) return

  // Reset to email input state
  const emailInputState = document.getElementById('saveToDbEmailInputState')
  const checkEmailState = document.getElementById('saveToDbCheckEmailState')
  if (emailInputState) emailInputState.classList.remove('hidden')
  if (checkEmailState) checkEmailState.classList.add('hidden')

  const emailInput = document.getElementById('saveToDbEmailInput')
  if (emailInput) {
    emailInput.value = ''
    emailInput.disabled = false
  }

  const errorEl = document.getElementById('saveToDbEmailError')
  if (errorEl) {
    errorEl.classList.add('hidden')
    errorEl.textContent = ''
  }

  // Show modal
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.style.opacity = '1'
    const content = modal.querySelector('.transform') || modal.querySelector('.player-surface')
    if (content) {
      content.classList.remove('scale-95')
      content.classList.add('scale-100')
    }
    // Initialize icons
    if (window.safeCreateIcons) {
      window.safeCreateIcons()
    }
  })
}

/**
 * Close the email input modal
 */
function closeSaveToDbEmailModal() {
  const modal = document.getElementById('saveToDbEmailModal')
  if (!modal) return

  modal.style.opacity = '0'
  const content = modal.querySelector('.transform') || modal.querySelector('.player-surface')
  if (content) {
    content.classList.remove('scale-100')
    content.classList.add('scale-95')
  }

  setTimeout(() => {
    modal.classList.add('hidden')
  }, 300)
}

/**
 * Show check email state in the email modal
 * @param {string} email - User's email address
 */
function showSaveToDbCheckEmailState(email) {
  const emailInputState = document.getElementById('saveToDbEmailInputState')
  const checkEmailState = document.getElementById('saveToDbCheckEmailState')
  const userEmailEl = document.getElementById('saveToDbUserEmail')

  if (emailInputState) emailInputState.classList.add('hidden')
  if (checkEmailState) checkEmailState.classList.remove('hidden')
  if (userEmailEl) userEmailEl.textContent = email
}

/**
 * Handle save to database button click - check auth and show appropriate modal
 */
async function handleSaveToDbClick() {
  const stemsToSave = collectStemsToSave()

  if (stemsToSave.length === 0) {
    showErrorToast('No stems available to save. Please generate some stems first.', 3000)
    return
  }

  // Check if a saved set exists - user must save set first
  if (currentSavedSetIndex === null || !savedSets[currentSavedSetIndex]) {
    // No saved set exists, prompt user to save set first
    showErrorToast('Please save your set first before saving to cloud. Use the "Save Set" button.', 4000)
    // Optionally open the save set modal
    const saveStateBtn = document.getElementById('saveStateBtn')
    if (saveStateBtn) {
      // Highlight the save set button or show a helper message
      setTimeout(() => {
        openSaveSetModal()
      }, 500)
    }
    return
  }

  // Check authentication status
  const user = getAuthGuard().getCurrentUser()

  if (user) {
    // User is authenticated, show confirmation modal
    showSaveToDbConfirmModal(stemsToSave)
  } else {
    // User is not authenticated, show email input modal
    showSaveToDbEmailModal()
  }
}

/**
 * Save all collected stems to database after user confirmation
 * Links stems -> stem_set -> session_setting according to database structure
 * @param {Array} stemsToSave - Array of stems to save
 */
async function saveAllStemsToDatabase(stemsToSave) {
  const spinner = document.getElementById('saveToDbConfirmSpinner')
  const label = document.getElementById('saveToDbConfirmLabel')
  const confirmBtn = document.getElementById('saveToDbConfirmBtn')

  try {
    // Show loading state
    if (spinner) spinner.classList.remove('hidden')
    if (label) label.textContent = 'Saving...'
    if (confirmBtn) confirmBtn.disabled = true

    // Import required functions
    const { saveSessionSetting, createStemSet } = await import('./Auth/stemApi.js')

    // Get current saved set for set name
    const currentSet = savedSets[currentSavedSetIndex]
    if (!currentSet) {
      throw new Error('No saved set found')
    }

    // Get session settings from stemControlValues.master
    const master = stemControlValues.master || {}
    // Generate default session name if not set
    const generateDefaultSessionName = () => {
      const now = new Date()
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      const hours = String(now.getHours()).padStart(2, '0')
      const minutes = String(now.getMinutes()).padStart(2, '0')
      const seconds = String(now.getSeconds()).padStart(2, '0')
      return `Session_${year}-${month}-${day}_${hours}-${minutes}-${seconds}`
    }
    const sessionData = {
      genre: 'techno', // Default genre
      sessionName: master.sessionName || generateDefaultSessionName(),
      temp: String(master.tempo || DEFAULT_TEMPO),
      bars: String(master.bars || DEFAULT_BARS),
      rootBase: master.rootBase || 'A',
      selectedAccidental: master.accidental || 'natural',
      mode: master.mode || 'Minor'
    }

    // Step 1: Save or get session setting
    const sessionResult = await saveSessionSetting(sessionData)
    if (!sessionResult.success) {
      throw new Error(`Failed to save session setting: ${sessionResult.error}`)
    }
    const sessionSettingId = sessionResult.sessionSettingId
    console.log('Session setting saved:', sessionSettingId)

    // Step 2: Create stem set linked to session setting
    const setName = `Set ${currentSavedSetIndex + 1}`
    const setResult = await createStemSet({
      name: setName,
      sessionSettingId: sessionSettingId
    })
    if (!setResult.success) {
      throw new Error(`Failed to create stem set: ${setResult.error}`)
    }
    const setId = setResult.setId
    console.log('Stem set created:', setId)

    // Step 3: Save each stem and link to set
    let successCount = 0
    let failCount = 0
    const savedStemIds = []

    for (let i = 0; i < stemsToSave.length; i++) {
      const stemData = stemsToSave[i]
      try {
        // Save stem to database (state is stored in stem_sets.stems_states array)
        const result = await saveStemToDatabase(
          setId,
          stemData.stemType,
          stemData.prompt,
          stemData.tempo,
          stemData.bars,
          stemData.audioBuffer,
          stemData.tier,
          stemData.validated
        )

        if (result && result.success && result.stemId) {
          savedStemIds.push({
            stemId: result.stemId,
            stemType: stemData.stemType,
            position: i
          })
          successCount++
        } else {
          failCount++
        }
      } catch (error) {
        console.error(`Error saving stem ${stemData.stemType}:`, error)
        failCount++
      }
    }

    // Step 4: State information is stored in stem_sets.stems_states array
    // The stems are linked to the set via stems.stem_set_id

    // Close modal
    closeSaveToDbConfirmModal()

    // Show result
    if (successCount > 0) {
      showSuccessToast(`Successfully saved ${successCount} stem${successCount > 1 ? 's' : ''} to cloud in "${setName}"`, 3000)
    }
    if (failCount > 0) {
      showErrorToast(`Failed to save ${failCount} stem${failCount > 1 ? 's' : ''}`, 3000)
    }
  } catch (error) {
    console.error('Error saving stems:', error)
    showErrorToast(`Error saving stems to cloud: ${error.message}`, 4000)
  } finally {
    // Reset button state
    if (spinner) spinner.classList.add('hidden')
    if (label) label.textContent = 'Save'
    if (confirmBtn) confirmBtn.disabled = false
  }
}

/**
 * Send confirmation email for non-authenticated users
 * @param {string} email - User's email address
 */
async function sendSaveToDbConfirmationEmail(email) {
  try {
    const { supabase } = await import('./Auth/index.js')
    if (!supabase) {
      throw new Error('Supabase not configured')
    }

    // Send magic link email
    const { error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        emailRedirectTo: `${window.location.origin}/#auth-callback`
      }
    })

    if (error) {
      throw error
    }

    // Show check email state
    showSaveToDbCheckEmailState(email)
  } catch (error) {
    console.error('Error sending confirmation email:', error)
    const errorEl = document.getElementById('saveToDbEmailError')
    if (errorEl) {
      errorEl.textContent = error.message || 'Failed to send email. Please try again.'
      errorEl.classList.remove('hidden')
    }
  }
}

function getMasterForPrompt() {
  return {
    tempo: clampTempo(stemControlValues.master?.tempo ?? DEFAULT_TEMPO),
    bars: stemControlValues.master?.bars ?? DEFAULT_BARS,
    root: getRootText(),
    mode: stemControlValues.master?.mode || 'Minor'
  }
}

/* ---------- Mixer (Docked tray) ---------- */
function volumeKnobHTML(st) {
  const v = stemControlValues[st]?.volume ?? 80
  const label = stemConfigs[st]?.name || st
  const ang = knobAngle(v)
  const idx = STEM_ORDER.indexOf(st) + 1
  return `\n        <div class="sg-mix-card relative flex flex-col items-center justify-center rounded-xl border border-white/15 bg-white/10 p-2 aspect-square select-none"\n             data-mix-card="${st}">\n          <span data-mix-number="${st}" class="absolute left-1 top-1 flex items-center justify-center w-4 h-4 rounded-full border border-white/30 text-[10px] font-semibold">${idx}</span>\n          <div class="text-[10px] mb-1 text-white/85">${label}</div>\n          <div class="relative w-12 h-12 rounded-full border border-white/25 bg-white/10 shadow-inner cursor-[ns-resize]"\n               data-mix-knob data-stem="${st}" data-value="${v}" title="${label} Volume">\n            <div class="absolute inset-0 rounded-full" style="box-shadow: inset 0 2px 6px rgba(0,0,0,0.35), inset 0 -1px 2px rgba(255,255,255,0.05)"></div>\n            <div class="absolute w-0.5 h-4 bg-white/90 rounded pointer-events-none"\n                 data-mix-pointer style="left:50%; bottom:50%; transform: translateX(-50%) rotate(${ang}deg); transform-origin: bottom center;"></div>\n          </div>\n          <div class="mt-1 text-[10px] text-white/80"><span data-mix-readout="${st}">${v}</span>%</div>\n          <div class="mt-1 flex gap-1">\n            <button class="sg-toggle px-1.5 py-0.5 text-[10px] rounded border border-white/15 hover:bg-white/10"\n                    data-action="mix-mute" data-stem="${st}" aria-pressed="false">Mute</button>\n            <button class="sg-toggle px-1.5 py-0.5 text-[10px] rounded border border-white/15 hover:bg-white/10"\n                    data-action="mix-solo" data-stem="${st}" aria-pressed="false">Solo</button>\n          </div>\n        </div>\n      `
}

// Build a mixer channel row with sliders for volume, EQ and filter.  Each
// row spans the full width of the mixer panel on desktop.  EQ
// sliders control low, mid and high bands.  The filter slider
// controls cutoff frequency.  Mute and Solo buttons are included
// along with the channel number.  Use data attributes to attach
// event handlers.
function mixChannelRowHTML(st) {
  const name = stemConfigs[st]?.name || st
  const idx = STEM_ORDER.indexOf(st) + 1
  // Retrieve current state values; initialise to defaults (50 => 0 dB) if undefined
  const volVal = stemControlValues[st]?.volume ?? 50
  const eq = stemEqValues[st] || { low: EQ_DEFAULT, mid: EQ_DEFAULT, high: EQ_DEFAULT }
  const filt = stemFilterValues[st] || { cutoff: freqToKnob(FILTER_DEFAULT_HZ), mode: 'lowpass' }
  const modeLabel = (filt.mode === 'lowpass') ? 'LP' : 'HP'
  return `
    <div class="sg-mix-row flex flex-col border border-white/15 bg-white/5 backdrop-blur-lg rounded-lg p-3 gap-2" data-mix-card="${st}">
      <!-- Header: channel number and name -->
      <div class="flex items-center gap-2">
        <span data-mix-number="${st}" class="inline-flex items-center justify-center w-4 h-4 rounded-full border border-white/30 text-[10px] font-semibold">${idx}</span>
        <span class="text-xs font-medium">${name}</span>
      </div>
      <!-- Volume slider (0–100 mapped to dB) -->
      <!-- The .mix-vol-row class makes it easy to hide this row on mobile via CSS -->
      <div class="mix-vol-row flex items-center gap-2">
        <span class="text-[10px] w-12">Vol</span>
        <!-- Make the dB slider the same length as the shortest slider (cutoff) -->
        <input type="range" data-mix-slider="volume" data-stem="${st}" min="0" max="100" value="${volVal}"
               class="w-3/5 h-3 bg-white/10 rounded-lg cursor-pointer" style="touch-action:none;">
      </div>
      <!-- EQ sliders: Low/Mid/High -->
      <div class="flex items-center gap-2">
        <span class="text-[10px] w-12">Low</span>
        <input type="range" data-mix-eq="low" data-stem="${st}" min="0" max="100" value="${eq.low}"
               class="w-3/5 h-3 bg-white/10 rounded-lg cursor-pointer" style="touch-action:none;">
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] w-12">Mid</span>
        <input type="range" data-mix-eq="mid" data-stem="${st}" min="0" max="100" value="${eq.mid}"
               class="w-3/5 h-3 bg-white/10 rounded-lg cursor-pointer" style="touch-action:none;">
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] w-12">High</span>
        <input type="range" data-mix-eq="high" data-stem="${st}" min="0" max="100" value="${eq.high}"
               class="w-3/5 h-3 bg-white/10 rounded-lg cursor-pointer" style="touch-action:none;">
      </div>
      <!-- Filter cutoff and mode toggle -->
      <!-- The .mix-cutoff-row class makes it easy to hide this row on mobile via CSS -->
      <div class="mix-cutoff-row flex items-center gap-2">
        <span class="text-[10px] w-12">Cutoff</span>
        <!-- Shorter slider for cutoff so the LP/HP button remains visible -->
        <input type="range" data-mix-filter="cutoff" data-stem="${st}" min="0" max="100" value="${filt.cutoff}"
               class="w-3/5 h-3 bg-white/10 rounded-lg cursor-pointer" style="touch-action:none;">
        <button class="px-1.5 py-0.5 text-[10px] rounded border border-white/15 hover:bg-white/10"
                data-action="toggle-filter-mode" data-stem="${st}" data-filter-mode="${st}">${modeLabel}</button>
      </div>
      <!-- Bottom bar: Mute/Solo buttons -->
      <div class="flex justify-between mt-2">
        <button class="sg-toggle px-1.5 py-0.5 text-[10px] rounded border border-white/15 hover:bg-white/10" data-action="mix-mute" data-stem="${st}" aria-pressed="false">Mute</button>
        <button class="sg-toggle px-1.5 py-0.5 text-[10px] rounded border border-white/15 hover:bg-white/10" data-action="mix-solo" data-stem="${st}" aria-pressed="false">Solo</button>
      </div>
    </div>
  `
}
// Wrapper function for building floating mixer panel
function buildFloatingMixerPanel() {
  buildFloatingMixerPanelImpl(mixChannelRowHTML, updateMixerGlow, updateCardNumberColor)
}
// Wrapper function for setting mixer open state
function setMixerOpen(open) {
  setMixerOpenImpl(open)
}

// Wrapper function for toggling mixer open state
function toggleMixerOpen() {
  toggleMixerOpenImpl(setMixerOpen)
}

/* ---------- Hotkey helpers ---------- */
function toggleMute(st) {
  stemMuteStates[st] = !stemMuteStates[st]
  const vol = (stemControlValues[st]?.volume ?? 80) / 100
  const target = stemMuteStates[st] ? 0 : vol
  if (stemNodes[st]?.gain) {
    const p = stemNodes[st].gain.gain, t = audioContext.currentTime
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(target, t + 0.01)
  }
  const icon = document.querySelector(`[data-stem="${st}"] [data-action="mute-stem"] [data-lucide]`)
  if (icon) {
    icon.setAttribute('data-lucide', stemMuteStates[st] ? 'volume-x' : 'volume-2');
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try {
        if (window.safeCreateIcons) {
          window.safeCreateIcons()
        }
      } catch (error) {
        console.error('Error updating volume icon:', error)
      }
    }
  }
  reflectMuteSoloButtons(st); updateMixerGlow(st)
  updateCardNumberColor(st)
  updateMutedBorder(st)
}

/* ---------- Events ---------- */
// Removed: getTempoValueEl and updateTempoReadout are no longer needed because
// the app no longer exposes a master tempo slider or readout.

// new helper functions for card numbers and history indicators
function updateHistoryIndicator(st) {
  ensureStemHistory(st)
  const count = stemHistory[st]?.length || 0
  const active = (stemActiveIndex[st] != null && stemActiveIndex[st] >= 0) ? (stemActiveIndex[st] + 1) : 0
  const countEl = document.querySelector(`[data-history-count="${st}"]`)
  const activeEl = document.querySelector(`[data-active-index="${st}"]`)
  if (countEl) countEl.textContent = String(count)
  if (activeEl) activeEl.textContent = active > 0 ? String(active) : '0'
  updateTempoIndicator(st)
}
// Update the tempo indicator on waveform card
function updateTempoIndicator(st) {
  const el = document.querySelector(`[data-tempo-indicator="${st}"]`)
  if (!el) return
  ensureStemHistory(st)
  const activeIdx = stemActiveIndex[st]
  let tempo = stemControlValues.master?.tempo ?? DEFAULT_TEMPO
  if (activeIdx != null && activeIdx >= 0 && stemHistory[st] && stemHistory[st][activeIdx]) {
    tempo = stemHistory[st][activeIdx].tempo
  }
  el.textContent = `tempo: ${tempo}`
}
function updateCardNumberColor(st) {
  const nTakes = (stemHistory[st]?.length || 0)
  const muted = stemMuteStates[st]
  const color = (nTakes === 0 || muted) ? '#ef4444' : '#ffffff'
  const cardNumEl = document.querySelector(`[data-card-number="${st}"]`)
  if (cardNumEl) {
    cardNumEl.style.color = color
    cardNumEl.style.borderColor = color
  }
  const mixNumEl = document.querySelector(`[data-mix-number="${st}"]`)
  if (mixNumEl) {
    mixNumEl.style.color = color
    mixNumEl.style.borderColor = color
  }
}
function updateMutedBorder(st) {
  const card = document.querySelector(`[data-stem="${st}"]`)
  if (card) {
    if (stemMuteStates[st]) card.classList.add('sg-muted-border')
    else card.classList.remove('sg-muted-border')
  }
  const mixCard = document.querySelector(`[data-mix-card="${st}"]`)
  if (mixCard) {
    if (stemMuteStates[st]) mixCard.classList.add('sg-muted-border')
    else mixCard.classList.remove('sg-muted-border')
  }
}

function setupEventListeners() {
  // Player Play/Pause
  const playBtn = document.getElementById('playBtn')
  if (playBtn) playBtn.addEventListener('click', async () => {
    console.log('Play/Pause button clicked, isPlaying:', isPlaying)
    await ensureAudioContext()
    if (isPlaying) {
      console.log('Stopping transport...')
      stopTransport()
    } else {
      console.log('Starting transport...')
      // Do not rebuild loops when starting transport.  Each stem retains its own
      // loop duration and tempo.
      startTransport()
    }
  })

  // Mixer toggle inside player
  const mixerToggleBtn = document.getElementById('mixerToggleBtn')
  if (mixerToggleBtn) mixerToggleBtn.addEventListener('click', () => toggleMixerOpen())

  // Mixer close (X) button: close the mixer when clicked
  const mixerCloseBtn = document.getElementById('mixerCloseBtn')
  if (mixerCloseBtn) mixerCloseBtn.addEventListener('click', () => setMixerOpen(false))

  // Session setup button: allow user to reconfigure session settings
  const sessionSetupBtn = document.getElementById('sessionSetupBtn')
  if (sessionSetupBtn) {
    sessionSetupBtn.addEventListener('click', () => {
      // Reset session setup flag and clear localStorage
      sessionSetupDone = false
      clearSessionSettingsFromStorage()
      // Show the session setup modal again
      showSessionSetupModal()
    })
  }

  // Download all button: prompt the user to confirm downloading all files
  const downloadAllBtn = document.getElementById('downloadAllBtn')
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', async () => {
      // Check if user can download (requires email confirmation)
      const { canUserDownload } = await import('./Auth/selectionPage.js')
      const canDownload = await canUserDownload()

      if (canDownload) {
        // User can download, proceed with download
        openDownloadConfirmModal()
      } else {
        // User cannot download, show restriction modal
        const { showDownloadRestrictionModal } = await import('./Auth/selectionPage.js')
        showDownloadRestrictionModal()
      }
    })
  }

  // Save to database button: check auth and show appropriate modal
  const saveToDbTrigger = document.getElementById('saveToDbTrigger')
  if (saveToDbTrigger) {
    saveToDbTrigger.addEventListener('click', handleSaveToDbClick)
  }

  // Save to database confirmation modal handlers
  const saveToDbConfirmModal = document.getElementById('saveToDbConfirmModal')
  if (saveToDbConfirmModal) {
    const overlay = document.getElementById('saveToDbConfirmOverlay')
    const closeBtn = document.getElementById('saveToDbConfirmCloseBtn')
    const cancelBtn = document.getElementById('saveToDbConfirmCancelBtn')
    const confirmBtn = document.getElementById('saveToDbConfirmBtn')

    const closeModal = () => closeSaveToDbConfirmModal()

    if (overlay) overlay.addEventListener('click', closeModal)
    if (closeBtn) closeBtn.addEventListener('click', closeModal)
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal)
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const stemsToSave = collectStemsToSave()
        saveAllStemsToDatabase(stemsToSave)
      })
    }
  }

  // Save to database email modal handlers
  const saveToDbEmailModal = document.getElementById('saveToDbEmailModal')
  if (saveToDbEmailModal) {
    const overlay = document.getElementById('saveToDbEmailOverlay')
    const closeBtn = document.getElementById('saveToDbEmailCloseBtn')
    const cancelBtn = document.getElementById('saveToDbEmailCancelBtn')
    const continueBtn = document.getElementById('saveToDbEmailContinueBtn')
    const resendBtn = document.getElementById('saveToDbResendEmailBtn')
    const changeEmailBtn = document.getElementById('saveToDbChangeEmailBtn')
    const emailInput = document.getElementById('saveToDbEmailInput')

    const closeModal = () => closeSaveToDbEmailModal()

    if (overlay) overlay.addEventListener('click', closeModal)
    if (closeBtn) closeBtn.addEventListener('click', closeModal)
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal)

    if (continueBtn) {
      continueBtn.addEventListener('click', async () => {
        const email = emailInput?.value?.trim()
        if (!email) {
          const errorEl = document.getElementById('saveToDbEmailError')
          if (errorEl) {
            errorEl.textContent = 'Please enter your email address'
            errorEl.classList.remove('hidden')
          }
          return
        }

        // Validate email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email)) {
          const errorEl = document.getElementById('saveToDbEmailError')
          if (errorEl) {
            errorEl.textContent = 'Please enter a valid email address'
            errorEl.classList.remove('hidden')
          }
          return
        }

        // Send confirmation email
        await sendSaveToDbConfirmationEmail(email)
      })
    }

    if (resendBtn) {
      resendBtn.addEventListener('click', async () => {
        const email = emailInput?.value?.trim()
        if (email) {
          await sendSaveToDbConfirmationEmail(email)
        }
      })
    }

    if (changeEmailBtn) {
      changeEmailBtn.addEventListener('click', () => {
        const emailInputState = document.getElementById('saveToDbEmailInputState')
        const checkEmailState = document.getElementById('saveToDbCheckEmailState')
        if (emailInputState) emailInputState.classList.remove('hidden')
        if (checkEmailState) checkEmailState.classList.add('hidden')
      })
    }

    if (emailInput) {
      emailInput.addEventListener('input', () => {
        const errorEl = document.getElementById('saveToDbEmailError')
        if (errorEl) {
          errorEl.classList.add('hidden')
          errorEl.textContent = ''
        }
      })

      emailInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          continueBtn?.click()
        }
      })
    }
  }

  // Generate settings modal buttons.  Cancel simply closes the modal; Start applies settings and triggers generation.
  const genCancelBtn = document.getElementById('generateSettingsCancelBtn')
  const genStartBtn = document.getElementById('generateSettingsStartBtn')
  const genOverlay = document.getElementById('generateSettingsOverlay')
  if (genCancelBtn) genCancelBtn.addEventListener('click', () => hideGenerateSettingsModal())
  if (genOverlay) genOverlay.addEventListener('click', () => hideGenerateSettingsModal())
  if (genStartBtn) genStartBtn.addEventListener('click', () => { applyGenerateSettingsAndStart() })

  // Live update the value labels in the create settings modal.  When the user moves a slider, update
  // the adjacent span to reflect the new value and unit.
  const genSettingsContent = document.getElementById('generateSettingsContent')
  if (genSettingsContent) {
    genSettingsContent.addEventListener('input', (e) => {
      const target = e.target
      if (!target || !target.getAttribute) return
      const control = target.getAttribute('data-gen-control')
      if (control && target.type === 'range') {
        const unit = target.getAttribute('data-unit') || ''
        // The span displaying the value is the last child of the parent container
        const container = target.parentElement
        if (container) {
          const spans = container.getElementsByTagName('span')
          if (spans && spans.length) {
            const display = spans[spans.length - 1]
            display.textContent = `${target.value}${unit}`
          }
        }
      }
    })
  }

  // (Space) toggle playback; (1–9) mute/unmute; ignore while editing
  document.addEventListener('keydown', async (e) => {
    const ae = document.activeElement
    const tag = (ae && ae.tagName) || ''
    const editing = (ae && (ae.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)))
    if (editing) return

    // Space: toggle transport
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault()
      await ensureAudioContext()
      if (isPlaying) stopTransport()
      else {
        // Do not rebuild loops on playback toggle.  Use existing per‑stem loops.
        startTransport()
      }
      return
    }

    // Digits/Numpad 1..9 → mute/unmute mapped stems
    const code = e.code || ''
    let num = null
    if (code.startsWith('Digit')) num = Number(code.slice(5))
    else if (code.startsWith('Numpad')) {
      const d = code.slice(6)
      if (/^[1-9]$/.test(d)) num = Number(d)
    }
    if (num && num >= 1 && num <= 9) {
      const st = STEM_ORDER[num - 1]
      if (st) toggleMute(st)
    }
  })

  // Keyboard support for arrow zone buttons (Enter and Space keys)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const target = e.target
      if (target && target.hasAttribute('data-action') && target.getAttribute('role') === 'button') {
        const action = target.getAttribute('data-action')
        if (action === 'prev-take' || action === 'next-take') {
          e.preventDefault()
          target.click()
        }
      }
    }
  })

  // Tempo slider: controls the generation tempo only.  Adjusting this value
  // does not affect the playback speed of already‑generated stems.
  const tempoSlider = document.getElementById('tempoSlider')
  const tempoValueEl = document.getElementById('tempoValue')
  if (tempoSlider) {
    // Initialize the slider with the current master tempo
    tempoSlider.value = stemControlValues.master.tempo || DEFAULT_TEMPO
    if (tempoValueEl) tempoValueEl.textContent = String(stemControlValues.master.tempo || DEFAULT_TEMPO)
    tempoSlider.addEventListener('input', e => {
      // Do not update master tempo if the session has been locked
      if (sessionSetupDone) return
      const value = clampTempo(e.target.value)
      e.target.value = value
      stemControlValues.master.tempo = value
      // Update readout
      if (tempoValueEl) tempoValueEl.textContent = String(value)
    })
  }

  // Infinite dial: pointerdown event handled globally so that new dials
  // created dynamically do not require explicit listener registration.
  // See the dial handlers defined at the bottom of the script.

  // Bars
  const barsSelector = document.getElementById('barsSelector')
  if (barsSelector) {
    barsSelector.value = String(stemControlValues.master.bars)
    barsSelector.addEventListener('change', e => {
      if (sessionSetupDone) return
      stemControlValues.master.bars = parseInt(e.target.value, 10)
      STEM_ORDER.forEach(st => {
        const drawer = document.querySelector(`[data-history-drawer="${st}"]`)
        if (drawer?.classList.contains('open')) renderHistoryDrawer(st)
      })
    })
  }

  // Master Volume: controls the global output gain.  Uses imported function
  initializeMasterVolumeSliderImpl(masterGain, ensureAudioContext, audioContext)

  // Key: root + accidental + mode
  const rootSelector = document.getElementById('rootSelector')
  const modeSelector = document.getElementById('modeSelector')
  const accidentalSelector = document.getElementById('accidentalSelector')
  if (rootSelector) {
    const v = String(rootSelector.value || 'A')
    const m = v.match(/^[A-G]/i)
    if (m) stemControlValues.master.rootBase = m[0].toUpperCase()
    if (/#/i.test(v)) stemControlValues.master.accidental = 'sharp'
    else if (/b/i.test(v)) stemControlValues.master.accidental = 'flat'
    if (accidentalSelector) accidentalSelector.value = stemControlValues.master.accidental
    rootSelector.addEventListener('change', e => {
      if (sessionSetupDone) return
      const vv = String(e.target.value || 'A')
      const mm = vv.match(/^[A-G]/i)
      if (mm) stemControlValues.master.rootBase = mm[0].toUpperCase()
    })
  }
  if (accidentalSelector) accidentalSelector.addEventListener('change', e => {
    if (sessionSetupDone) return
    stemControlValues.master.accidental = e.target.value
  })
  if (modeSelector) {
    modeSelector.value = stemControlValues.master.mode
    modeSelector.addEventListener('change', e => {
      if (sessionSetupDone) return
      stemControlValues.master.mode = e.target.value
    })
  }

  // Hide "Format" selector if present
  const fmt = document.getElementById('outputFormatSelector')
  if (fmt && fmt.parentElement) fmt.parentElement.style.display = 'none'

  // Card inputs (live + gen)
  document.addEventListener('input', e => {
    const target = e.target
    const st = target.dataset.stem
    // Mixer volume slider
    if (target.dataset.mixSlider === 'volume' && st) {
      const v = Math.max(0, Math.min(100, Math.round(Number(target.value) || 0)))
      stemControlValues[st].volume = v
      // update readout element (next sibling)
      const ro = target.nextElementSibling
      if (ro) ro.textContent = `${v}%`
      // update audio gain if playing
      if (stemNodes[st]?.gain) {
        const g = stemNodes[st].gain.gain
        const now = audioContext.currentTime
        g.cancelScheduledValues(now)
        g.setValueAtTime(g.value, now)
        const muted = stemMuteStates[st]
        const soloedOther = (soloedStem && soloedStem !== st)
        const val = (muted || soloedOther) ? 0 : (v / 100)
        g.linearRampToValueAtTime(val, now + 0.01)
      }
      return
    }
    // Mixer EQ sliders
    if (target.dataset.mixEq && st) {
      const band = target.dataset.mixEq
      const v = Math.max(0, Math.min(100, Math.round(Number(target.value) || 0)))
      // update state
      stemEqValues[st] = { ...(stemEqValues[st] || {}), [band]: v }
      // apply to audio nodes if playing
      const eqNodes = stemNodes[st]?.eq
      if (eqNodes) applyEqValuesToNodes(eqNodes, stemEqValues[st])
      return
    }
    // Mixer filter slider
    if (target.dataset.mixFilter === 'cutoff' && st) {
      const v = Math.max(0, Math.min(100, Math.round(Number(target.value) || 0)))
      stemFilterValues[st] = { ...(stemFilterValues[st] || {}), cutoff: v }
      // apply to audio nodes if playing
      const filterNode = stemNodes[st]?.filter
      if (filterNode) applyFilterValuesToNode(filterNode, stemFilterValues[st])
      return
    }
    // Card control sliders/toggles
    if (target.dataset.stem && target.dataset.control) {
      const key = target.dataset.control
      const val = target.type === 'checkbox' ? target.checked : parseInt(target.value, 10)
      stemControlValues[st][key] = val
      if (target.type === 'range') {
        const display = target.parentElement.querySelector('span:last-child')
        const cfg = stemConfigs[st]?.controls[key]
        if (display) display.textContent = `${val}${cfg?.unit || ''}`
      }
      if (key === 'volume') setVolumeUnified(st, val)
    }
  })

  // Slider tooltip handling for mixer sliders.  Display a small popup showing dB or Hz while adjusting.
  let activeSlider = null
  // Helper to update tooltip content and position
  function updateSliderTooltip(sliderEl, pageX, pageY) {
    if (!sliderTooltipEl) return
    const val = Number(sliderEl.value) || 0
    let text = ''
    // Determine the type of slider and compute display value
    if (sliderEl.dataset.mixSlider === 'volume' || sliderEl.dataset.mixEq) {
      // Use knobToDb conversion for volume and EQ
      const db = knobToDb(val)
      // Format with sign and one decimal place
      const dbStr = db >= 0 ? `+${db.toFixed(1)}` : db.toFixed(1)
      text = `${dbStr} dB`
    } else if (sliderEl.dataset.mixFilter === 'cutoff') {
      // Show frequency
      const hz = knobToFreq(val)
      text = hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`
    }
    sliderTooltipEl.textContent = text
    // Position tooltip relative to pointer
    const offsetX = 8
    const offsetY = 24
    sliderTooltipEl.style.left = `${pageX + offsetX}px`
    sliderTooltipEl.style.top = `${pageY - offsetY}px`
  }
  // Show tooltip on pointerdown if target is a mixer slider
  document.addEventListener('pointerdown', e => {
    const t = e.target
    if (t && (t.matches('input[data-mix-slider="volume"]') || t.matches('input[data-mix-eq]') || t.matches('input[data-mix-filter="cutoff"]'))) {
      activeSlider = t
      updateSliderTooltip(t, e.pageX, e.pageY)
      if (sliderTooltipEl) sliderTooltipEl.style.opacity = '1'
    }
  })
  // Update tooltip position/value while dragging
  document.addEventListener('pointermove', e => {
    if (activeSlider) {
      updateSliderTooltip(activeSlider, e.pageX, e.pageY)
    }
  })
  // Hide tooltip on pointerup/cancel
  document.addEventListener('pointerup', () => {
    if (sliderTooltipEl) sliderTooltipEl.style.opacity = '0'
    activeSlider = null
  })
  document.addEventListener('pointercancel', () => {
    if (sliderTooltipEl) sliderTooltipEl.style.opacity = '0'
    activeSlider = null
  })

  /*
    -------------------------------------------------------------------------
    Dial plus/minus button handlers

    The volume and endpoint infinite dials are flanked by "-" and "+" buttons.
    These buttons allow fine adjustments without dragging the dial.  Holding
    a button continuously steps the value up or down.  Each button has
    data-dial-type ("volume" or "endpoint"), data-dial-step ("-1" or "1"),
    and data-stem attributes (assigned dynamically for the endpoint dial).
    We register a global listener for pointerdown on these buttons to
    initiate repeated adjustments via setInterval.  Pointerup/cancel
    listeners stop the interval.
  */
  // Track the active timer for continuous dial adjustments
  let dialButtonTimer = null
  // Apply a single adjustment according to the button's attributes
  function applyDialButtonStep(btn) {
    if (!btn) return
    const type = btn.getAttribute('data-dial-type')
    const st = btn.getAttribute('data-stem')
    const stepAttr = btn.getAttribute('data-dial-step')
    const step = stepAttr ? parseFloat(stepAttr) || 0 : 0
    if (!type || !st || !step) return
    if (type === 'volume') {
      // Adjust volume by ±1 unit per step (interpreted as approximately 1 dB)
      const current = stemControlValues[st]?.volume ?? 80
      let newVal = current + step
      newVal = Math.max(0, Math.min(100, newVal))
      setVolumeUnified(st, newVal)
    } else if (type === 'endpoint') {
      // Adjust endpoint factor by ±1/128th of a bar per step.  Compute the
      // adjustment based on the current master bar count.  Bars default to
      // DEFAULT_BARS if not set.  The delta is positive when step is
      // positive and negative otherwise.
      const current = endpointFactors[st] ?? 1
      const bars = stemControlValues.master?.bars ?? DEFAULT_BARS
      const delta = (1 / (bars * 128)) * step
      let newVal = current + delta
      newVal = Math.max(0.1, Math.min(3, newVal))
      endpointFactors[st] = newVal
      // Persist this endpoint factor on the active take
      {
        const idx = stemActiveIndex[st]
        if (idx != null && idx >= 0 && stemHistory[st] && stemHistory[st][idx]) {
          stemHistory[st][idx].endpointFactor = newVal
        }
      }
      // Rebuild loop and update preview
      adjustEndpoint(st, newVal)
      const canvas = document.getElementById('waveformEditCanvas')
      if (canvas) {
        const cfg = stemConfigs[st]
        drawWaveform(canvas, stemLoop[st], `rgb(${getColorRGB(cfg.color)})`)
        // Apply current volume scaling to the preview
        const vval = stemControlValues[st]?.volume ?? 80
        canvas.style.transform = `scaleY(${vval / 100})`
      }
    }
  }
  // Start continuous adjustments for a button
  function startDialButtonInterval(btn) {
    applyDialButtonStep(btn)
    dialButtonTimer = setInterval(() => applyDialButtonStep(btn), 150)
  }
  // Stop the continuous adjustment
  function stopDialButtonInterval() {
    if (dialButtonTimer) {
      clearInterval(dialButtonTimer)
      dialButtonTimer = null
    }
  }
  // Global pointerdown to detect clicks on dial buttons
  document.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.dial-btn')
    if (btn) {
      // Prevent default to avoid text selection
      e.preventDefault()
      startDialButtonInterval(btn)
    }
  })
  // Global pointerup/cancel stops continuous adjustments
  document.addEventListener('pointerup', () => stopDialButtonInterval())
  document.addEventListener('pointercancel', () => stopDialButtonInterval())

  // EQ knob gestures
  let activeEqKnob = null, startX = 0, startY = 0, startVal = 0
  function onEqMove(e) { if (!activeEqKnob) return; const dx = (e.clientX ?? 0) - startX; const dy = startY - (e.clientY ?? 0); const delta = dy + dx * 0.35; const v = Math.max(0, Math.min(100, startVal + delta * 0.5)); setEqValue(activeEqKnob.stem, activeEqKnob.band, v) }
  function onEqUp() { activeEqKnob = null; window.removeEventListener('pointermove', onEqMove); window.removeEventListener('pointerup', onEqUp) }
  document.addEventListener('pointerdown', e => {
    const k = e.target.closest('[data-eq-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); const band = k.getAttribute('data-band'); const val = Number(k.getAttribute('data-value')) || EQ_DEFAULT
    if (e.shiftKey) { setEqValue(st, band, 0); return }
    activeEqKnob = { stem: st, band }; startX = e.clientX ?? 0; startY = e.clientY ?? 0; startVal = val
    window.addEventListener('pointermove', onEqMove); window.addEventListener('pointerup', onEqUp)
  })
  document.addEventListener('dblclick', e => {
    const k = e.target.closest('[data-eq-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); const band = k.getAttribute('data-band'); setEqValue(st, band, EQ_DEFAULT)
  })

  // Filter knob gestures
  let activeFilterKnob = null, fStartVal = 0
  function onFilterMove(e) { if (!activeFilterKnob) return; const dx = (e.clientX ?? 0) - startX; const dy = startY - (e.clientY ?? 0); const delta = dy + dx * 0.35; const v = Math.max(0, Math.min(100, fStartVal + delta * 0.5)); setFilterCutoff(activeFilterKnob.stem, v) }
  function onFilterUp() { activeFilterKnob = null; window.removeEventListener('pointermove', onFilterMove); window.removeEventListener('pointerup', onFilterUp) }
  document.addEventListener('pointerdown', e => {
    const k = e.target.closest('[data-filter-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); const val = Number(k.getAttribute('data-value')) || freqToKnob(FILTER_DEFAULT_HZ)
    if (e.shiftKey) { setFilterCutoff(st, freqToKnob(FILTER_DEFAULT_HZ)); return }
    activeFilterKnob = { stem: st }; startX = e.clientX ?? 0; startY = e.clientY ?? 0; fStartVal = val
    window.addEventListener('pointermove', onFilterMove); window.addEventListener('pointerup', onFilterUp)
  })
  document.addEventListener('dblclick', e => {
    const k = e.target.closest('[data-filter-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); setFilterCutoff(st, freqToKnob(FILTER_DEFAULT_HZ))
  })

  // Mixer knobs
  let activeMixKnob = null, mStartVal = 0
  function onMixMove(e) { if (!activeMixKnob) return; const dx = (e.clientX ?? 0) - startX; const dy = startY - (e.clientY ?? 0); const delta = dy + dx * 0.35; const v = Math.max(0, Math.min(100, mStartVal + delta * 0.5)); setVolumeUnified(activeMixKnob.stem, v) }
  function onMixUp() { activeMixKnob = null; window.removeEventListener('pointermove', onMixMove); window.removeEventListener('pointerup', onMixUp) }
  document.addEventListener('pointerdown', e => {
    const k = e.target.closest('[data-mix-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); const val = Number(k.getAttribute('data-value')) || (stemControlValues[st]?.volume ?? 80)
    if (e.shiftKey) { setVolumeUnified(st, 0); return }
    activeMixKnob = { stem: st }; startX = e.clientX ?? 0; startY = e.clientY ?? 0; mStartVal = val
    window.addEventListener('pointermove', onMixMove); window.addEventListener('pointerup', onMixUp)
  })
  document.addEventListener('dblclick', e => {
    const k = e.target.closest('[data-mix-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); setVolumeUnified(st, stemConfigs[st]?.controls?.volume?.default ?? 80)
  })

  // Click actions (Generate / Download / Filter mode / options overlay / history / waveform navigation)
  document.addEventListener('click', async e => {
    // If a dial drag has just completed, ignore the immediate click to avoid unintended muting.
    if (dialIgnoreClick) {
      dialIgnoreClick = false
      return
    }

    // Toggle mute/unmute when clicking on an instrument card outside of interactive elements.
    {
      const cardEl = e.target.closest('[data-stem]')
      if (cardEl) {
        // Do not toggle if the click is on a button, an element with a data-action,
        // a form element, or an infinite dial.  This prevents the volume and
        // endpoint dials from muting/unmuting the stem when clicked.
        const isInteractive = e.target.closest('button, [data-action], input, label, select, textarea, .infinite-dial')
        const isWaveform = e.target.closest('.waveform-canvas')
        if (!isInteractive && !isWaveform) {
          const st = cardEl.getAttribute('data-stem')
          if (st) {
            toggleMute(st)
            return
          }
        }
      }
    }

    // Toggle mute/unmute when clicking on a mixer channel outside of interactive elements.
    {
      const mixCardEl = e.target.closest('[data-mix-card]')
      if (mixCardEl) {
        // Prevent toggling if the click is on a slider, button or other interactive element
        const isInteractive = e.target.closest('button, [data-action], input, label, select, textarea, .infinite-dial')
        if (!isInteractive) {
          const st = mixCardEl.getAttribute('data-mix-card')
          if (st) {
            toggleMute(st)
            return
          }
        }
      }
    }
    const btn = e.target.closest('[data-action]')
    if (btn) {
      const action = btn.dataset.action
      const st = btn.dataset.stem
      if (action === 'generate' && st) { await generateStem(st); return }
      // When clicking the new generate button, open the settings modal instead of generating immediately
      if (action === 'open-create-settings' && st) { showGenerateSettingsModal(st); return }
      if (action === 'download-stem' && st) { downloadStem(st); return }
      if (action === 'toggle-filter-mode' && st) { toggleFilterMode(st); return }
      // Open the takes browser via the "open" button
      if (action === 'open-takes' && st) { toggleHistoryDrawer(st, null); return }
      // Cycle to previous take; wraps around
      if (action === 'prev-take' && st) {
        ensureStemHistory(st)
        const takes = stemHistory[st] || []
        if (takes.length > 0) {
          const current = stemActiveIndex[st] ?? -1
          // move left: if nothing selected, select last; else decrement and wrap
          let nextIdx = (current <= 0) ? (takes.length - 1) : (current - 1)
          selectStemVersion(st, nextIdx)
        }
        return
      }
      // Cycle to next take; wraps around
      if (action === 'next-take' && st) {
        ensureStemHistory(st)
        const takes = stemHistory[st] || []
        if (takes.length > 0) {
          const current = stemActiveIndex[st] ?? -1
          // move right: if nothing selected, select first; else increment and wrap
          let nextIdx = (current >= takes.length - 1 || current < 0) ? 0 : (current + 1)
          selectStemVersion(st, nextIdx)
        }
        return
      }
      if (action === 'toggle-stem-options' && st) {
        const panel = document.querySelector(`[data-options-panel="${st}"]`)
        const open = !(panel?.classList.contains('hidden') === false)
        if (panel) panel.classList.toggle('hidden', !open)
        btn.setAttribute('aria-pressed', open ? 'true' : 'false')
        return
      }
      if (action === 'close-history' && st) { toggleHistoryDrawer(st, false); return }
      if (action === 'mix-mute' || action === 'mute-stem') { toggleMute(st); return }
      if (action === 'mix-solo' || action === 'solo-stem') {
        // Custom solo logic: if the stem is muted, soloing will unmute it and
        // remember its previous mute state.  When unsoloing, the previous
        // mute state is restored.  Only one stem can be soloed at a time.
        if (soloedStem === st) {
          // Unsolo: restore previous mute state if stored
          if (prevSoloMuteStates[st] !== undefined) {
            stemMuteStates[st] = prevSoloMuteStates[st]
            delete prevSoloMuteStates[st]
          }
          soloedStem = null
        } else {
          // Solo a new stem: save its current mute state and unmute
          prevSoloMuteStates[st] = stemMuteStates[st]
          stemMuteStates[st] = false
          soloedStem = st
        }
        // Apply volume changes across all stems and update UI
        STEM_ORDER.forEach(name => {
          const vol = (stemControlValues[name]?.volume ?? 80) / 100
          let target
          if (soloedStem) {
            // When soloed, mute all other stems.  The soloed stem respects its mute state.
            target = (name === soloedStem) ? (stemMuteStates[name] ? 0 : vol) : 0
          } else {
            // When no stem is soloed, honour each stem's mute state
            target = stemMuteStates[name] ? 0 : vol
          }
          const n = stemNodes[name]
          if (n?.gain) {
            const p = n.gain.gain, t = audioContext.currentTime
            p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(target, t + 0.01)
          }
          // Reflect button states even for stems without audio nodes so visual feedback
          // appears on the instrument cards and mixer.
          reflectMuteSoloButtons(name)
          updateMixerGlow(name)
        })
        return
      }
      // New actions: open-takes, prev-take, next-take
      if (action === 'open-takes' && st) {
        toggleHistoryDrawer(st, true)
        return
      }
      if (action === 'prev-take' && st) {
        ensureStemHistory(st)
        const list = stemHistory[st]
        if (list && list.length > 0) {
          const cur = stemActiveIndex[st]
          const count = list.length
          const newIndex = cur <= 0 ? count - 1 : cur - 1
          selectStemVersion(st, newIndex)
          updateHistoryIndicator(st)
          updateCardNumberColor(st)
        }
        return
      }
      if (action === 'next-take' && st) {
        ensureStemHistory(st)
        const list = stemHistory[st]
        if (list && list.length > 0) {
          const cur = stemActiveIndex[st]
          const count = list.length
          const newIndex = cur < count - 1 ? cur + 1 : 0
          selectStemVersion(st, newIndex)
          updateHistoryIndicator(st)
          updateCardNumberColor(st)
        }
        return
      }
    } else {
      const cw = e.target.closest('.waveform-canvas')
      if (cw?.dataset.stem) {
        // Open the waveform edit modal instead of toggling an overlay or
        // opening the history drawer.  This modal allows the user to
        // adjust volume and endpoint with full controls and save/discard.
        openWaveformEditModal(cw.dataset.stem)
        return
      }
      const takeBtn = e.target.closest('[data-take-index]')
      if (takeBtn) {
        const st = takeBtn.getAttribute('data-stem')
        const idx = parseInt(takeBtn.getAttribute('data-take-index'), 10)
        selectStemVersion(st, idx)
        updateMixerGlow(st)
        return
      }
    }
  })

  // Handle input events on waveform dial sliders (volume and endpoint).  When the
  // user interacts with these range inputs, adjust the corresponding stem
  // parameters and update the visuals/audio.  We use a single listener on
  // the document to catch changes on dynamically created sliders.
  document.addEventListener('input', e => {
    const target = e.target
    if (!target || !target.getAttribute) return
    const action = target.getAttribute('data-action')
    const st = target.getAttribute('data-stem')
    if (!st || !action) return
    if (action === 'adjust-volume') {
      handleVolumeSlider(st, target.value)
    } else if (action === 'adjust-endpoint') {
      handleEndpointSlider(st, target.value)
    }
  })

  // Takes tray wheel→horizontal
  document.addEventListener('wheel', (e) => {
    const list = e.target.closest('[data-history-list]')
    if (!list) return
    const absY = Math.abs(e.deltaY), absX = Math.abs(e.deltaX)
    if (absY >= absX) { list.scrollLeft += e.deltaY; e.preventDefault() }
  }, { passive: false })
}

/* ---------- EQ/Filter setters ---------- */
function setEqValue(st, band, newVal) {
  const v = Math.max(0, Math.min(100, Math.round(newVal)))
  stemEqValues[st] = { ...(stemEqValues[st] || {}), [band]: v }
  const knob = document.querySelector(`[data-eq-knob][data-stem="${st}"][data-band="${band}"]`)
  if (knob) updateEqKnobVisual(knob, v)
  updateEqReadout(st, band)
  const eq = stemNodes[st]?.eq
  if (eq) applyEqValuesToNodes(eq, stemEqValues[st])
}
function setFilterCutoff(st, newVal) {
  const v = Math.max(0, Math.min(100, Math.round(newVal)))
  stemFilterValues[st] = { ...(stemFilterValues[st] || {}), cutoff: v }
  const knob = document.querySelector(`[data-filter-knob][data-stem="${st}"]`)
  if (knob) updateFilterKnobVisual(knob, v)
  updateFilterReadout(st)
  const filter = stemNodes[st]?.filter
  if (filter) applyFilterValuesToNode(filter, stemFilterValues[st])
}
function toggleFilterMode(st) {
  const current = (stemFilterValues[st] || {}).mode || 'lowpass'
  const next = current === 'lowpass' ? 'highpass' : 'lowpass'
  stemFilterValues[st] = { ...(stemFilterValues[st] || {}), mode: next }
  updateFilterModeButton(st)
  const filter = stemNodes[st]?.filter
  if (filter) applyFilterValuesToNode(filter, stemFilterValues[st])
}

/* =========================================================
   History UI
   ========================================================= */
function updateHistoryBadge(st) {
  const badgeEls = document.querySelectorAll(`[data-history-count="${st}"]`)
  const n = stemHistory[st]?.length || 0
  badgeEls.forEach(badge => { badge.textContent = n; badge.style.opacity = n > 0 ? '1' : '0.4' })
  updateHistoryIndicator(st)
  updateCardNumberColor(st)
}
function toggleHistoryDrawer(st, forceOpen = null) {
  const drawer = document.querySelector(`[data-history-drawer="${st}"]`); if (!drawer) return
  const isOpen = drawer.classList.contains('open')
  const open = forceOpen === null ? !isOpen : !!forceOpen
  drawer.classList.toggle('open', open)
  drawer.style.maxHeight = open ? '160px' : '0px'
  if (open) renderHistoryDrawer(st)
}
function renderHistoryDrawer(st) {
  const list = document.querySelector(`[data-history-list="${st}"]`); if (!list) return
  ensureStemHistory(st)
  list.innerHTML = ''
  const takes = stemHistory[st]
  if (!takes.length) { list.innerHTML = `<div class="text-xs text-white/60 px-2 py-6">No takes yet. Create some!</div>`; return }
  const active = stemActiveIndex[st]
  takes.forEach((take, i) => {
    const item = document.createElement('button')
    item.className = `relative shrink-0 w-28 h-16 rounded-md border ${i === active ? 'border-purple-400 shadow-[0_0_0_2px_rgba(168,85,247,0.35)]' : 'border-white/10 hover:border-white/30'} bg-white/5 focus:outline-none focus:ring-2 focus:ring-purple-500/30`
    item.setAttribute('data-take-index', i)
    item.setAttribute('data-stem', st)
    item.title = `v${i + 1} • ${take.tempo} BPM • ${take.bars} bars`

    const c = document.createElement('canvas'); c.width = 112; c.height = 64; c.className = 'w-full h-full rounded-md'
    item.appendChild(c)

    const meta = document.createElement('div')
    meta.className = 'absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[10px] leading-none bg-black/50 text-white/90 truncate'
    meta.textContent = `v${i + 1} • ${take.tempo} • ${take.bars}b`
    item.appendChild(meta)

    list.appendChild(item)

    // Draw a preview of the raw take without trimming or stretching.  This
    // avoids squeezing the waveform when the generation tempo differs from
    // the current master tempo.
    drawTinyWaveform(c, take.raw)
  })
}
function selectStemVersion(st, index) {
  ensureStemHistory(st)
  const takes = stemHistory[st]; if (!takes || index < 0 || index >= takes.length) return
  stemActiveIndex[st] = index
  const take = takes[index]
  // Use the stored tempo and bar count from the take itself to build a
  // loop that matches the original generation.  Do not reference the current
  // master tempo, as each stem may have been generated at a different BPM.
  const tempo = take.tempo
  const bars = take.bars
  stemRaw[st] = take.raw
  // Loop directly from the raw audio; do not rebuild loop based on tempo
  stemLoop[st] = take.raw
  // Record the loop duration for this stem
  stemLoopDuration[st] = take.raw.duration
  const canvas = document.querySelector(`[data-stem="${st}"] .waveform-canvas`)
  if (canvas) {
    const cfg = stemConfigs[st]; drawWaveform(canvas, stemLoop[st], `rgb(${getColorRGB(cfg.color)})`)
  }
  const statusEl = document.querySelector(`[data-stem="${st}"] .status-line`)
  if (statusEl) statusEl.textContent = `Selected v${index + 1} (${tempo} BPM • ${bars} bars)`
  renderHistoryDrawer(st)
  // Restore the saved endpoint factor for this take (if present).  If not present, default to 1.
  {
    const takes = stemHistory[st] || []
    const entry = takes[index]
    const factor = entry?.endpointFactor ?? 1
    endpointFactors[st] = factor
    // Rebuild the loop with the stored factor
    adjustEndpoint(st, factor)
  }
  // No need to reset or update obsolete overlay slider inputs, since endpoint control is now via infinite dial.
  if (isPlaying) restartStemNextBoundary(st)
  updateHistoryIndicator(st)
  updateCardNumberColor(st)
  updateTempoIndicator(st)
}

/* =========================================================
   App init + navigation
   ========================================================= */
function showPage(pageId) {
  try { console.log('[router] showPage ->', pageId) } catch { }
  const pages = ['login-page', 'selection-page', 'techno-generator-page', 'reset-password-page', 'confirm-email-page', 'profile-page']
  pages.forEach(id => { const page = document.getElementById(id); if (page) page.classList.add('hidden') })
  const targetPage = document.getElementById(pageId);
  if (targetPage) {
    targetPage.classList.remove('hidden')
    console.log('[router] Page shown:', pageId, 'Element:', targetPage, 'Classes:', targetPage.className)
  } else {
    console.error('[router] Page not found:', pageId)
  }

  // Show studio header only on studio pages (techno-generator-page)
  const studioHeader = document.getElementById('studioHeader')
  const showStudioHeader = pageId === 'techno-generator-page'
  if (studioHeader) studioHeader.classList.toggle('hidden', !showStudioHeader)

  // Show bottom player only on Studio page
  const playerBar = document.getElementById('playerBar')
  const showDock = pageId === 'techno-generator-page'
  if (playerBar) playerBar.classList.toggle('hidden', !showDock)
  if (!showDock) setMixerOpen(false)

  // Show guest mode notice on techno generator page if user is not authenticated
  if (pageId === 'techno-generator-page') {
    updateGuestModeNotice()
  }
}


/**
 * Update guest mode notice visibility based on authentication status
 */
async function updateGuestModeNotice() {
  const guestModeNotice = document.getElementById('guestModeNotice')
  if (!guestModeNotice) return

  const user = getAuthGuard().getCurrentUser()
  if (user) {
    // User is authenticated, hide guest mode notice
    guestModeNotice.classList.add('hidden')
  } else {
    // User is in guest mode, show notice
    guestModeNotice.classList.remove('hidden')
  }
}

// Make showPage and initTechnoGenerator globally accessible
window.showPage = showPage
window.initTechnoGenerator = initTechnoGenerator
function setupNavigationListeners() {
  // Note: loginBtn is now handled by setupLoginPage() in Auth/loginPage.js
  const launchTechno = document.getElementById('launchTechno')
  if (launchTechno) launchTechno.addEventListener('click', () => {
    showPage('techno-generator-page');
    initTechnoGenerator()
  })
  const launchHipHop = document.getElementById('launchHipHop'); if (launchHipHop) launchHipHop?.addEventListener('click', () => { })
  const launchHouse = document.getElementById('launchHouse'); if (launchHouse) launchHouse?.addEventListener('click', () => { })
}

function setupRouteHandling() {
  // Handle hash changes for routing
  window.addEventListener('hashchange', handleHashChange)

  // Handle initial hash on page load
  handleHashChange()

}

/**
 * Handle email verification when user clicks confirmation link
 */
async function handleEmailVerification() {
  try {
    console.log('[email-verification] Starting email verification process')

    // Parse URL parameters to get verification tokens
    const urlParams = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.split('?')[1] || '')

    // Check for new token format (from custom email template)
    const token = urlParams.get('token') || hashParams.get('token')
    const email = urlParams.get('email') || hashParams.get('email')

    // Check for old token format (from Supabase default)
    const accessToken = urlParams.get('access_token') || hashParams.get('access_token')
    const refreshToken = urlParams.get('refresh_token') || hashParams.get('refresh_token')
    const type = urlParams.get('type') || hashParams.get('type')

    console.log('[email-verification] Found tokens:', {
      hasToken: !!token,
      hasEmail: !!email,
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      type
    })

    // Import supabase client
    const { supabase } = await import('./Auth/index.js')

    let data, error

    // Handle new token format (token hash for verifyOtp)
    if (token) {
      console.log('[email-verification] Using new token format (verifyOtp)')

      const result = await supabase.auth.verifyOtp({
        token_hash: token,
        type: 'signup'
      })

      data = result.data
      error = result.error

    }
    // Handle old token format (access_token/refresh_token for setSession)
    else if (accessToken && refreshToken) {
      console.log('[email-verification] Using old token format (setSession)')

      if (type !== 'signup') {
        console.log('[email-verification] Not a signup verification, type:', type)
        return
      }

      const result = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      })

      data = result.data
      error = result.error

    } else {
      console.log('[email-verification] No verification tokens found')
      return
    }

    if (error) {
      console.error('[email-verification] Failed to verify email:', error)
      showEmailVerificationError('Email verification failed. Please try again.')
      return
    }

    console.log('[email-verification] Email verified successfully:', data.user?.email)

    // Show success message and redirect to login
    showEmailVerificationSuccess('Email verified successfully! You can now log in.')

    // Store verification success flag for login page
    localStorage.setItem('emailVerified', 'true')
    localStorage.setItem('verifiedEmail', data.user?.email || email || '')

    // Clear URL parameters and redirect to login after a delay
    setTimeout(() => {
      window.location.hash = '#login'
    }, 3000)

  } catch (error) {
    console.error('[email-verification] Unexpected error:', error)
    showEmailVerificationError('An unexpected error occurred during email verification.')
  }
}

/**
 * Show email verification success message
 */
function showEmailVerificationSuccess(message) {
  const page = document.getElementById('confirm-email-page')
  if (!page) return

  // Update the page content to show success message
  page.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="max-w-md w-full text-center">
        <div class="glass card-border rounded-2xl p-8">
          <div class="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <i data-lucide="check-circle" class="w-8 h-8 text-green-400"></i>
          </div>
          <h2 class="text-2xl font-bold text-white mb-4">Email Verified!</h2>
          <p class="text-white/70 mb-6">${message}</p>
          <div class="text-sm text-white/50">
            Redirecting to login page...
          </div>
        </div>
      </div>
    </div>
  `

  // Initialize Lucide icons safely
  if (window.safeCreateIcons) {
    window.safeCreateIcons()
  }
}

/**
 * Show email verification error message
 */
function showEmailVerificationError(message) {
  const page = document.getElementById('confirm-email-page')
  if (!page) return

  // Update the page content to show error message
  page.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="max-w-md w-full text-center">
        <div class="glass card-border rounded-2xl p-8">
          <div class="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <i data-lucide="x-circle" class="w-8 h-8 text-red-400"></i>
          </div>
          <h2 class="text-2xl font-bold text-white mb-4">Verification Failed</h2>
          <p class="text-white/70 mb-6">${message}</p>
          <a href="#login" class="inline-block px-6 py-3 bg-purple-500 hover:bg-purple-600 rounded-lg text-white font-medium transition-colors">
            Go to Login
          </a>
        </div>
      </div>
    </div>
  `

  // Initialize Lucide icons safely
  if (window.safeCreateIcons) {
    window.safeCreateIcons()
  }
}

function handleHashChange() {
  const rawHash = window.location.hash.substring(1) // Remove the # symbol
  try { console.log('[router] handleHashChange rawHash=', rawHash) } catch { }
  const baseRoute = rawHash.split('?')[0].replace(/\/$/, '') // support params like reset-password?x=1
  try { console.log('[router] baseRoute=', baseRoute) } catch { }

  // Check for Supabase password reset parameters in hash
  const hashParams = new URLSearchParams(rawHash.split('?')[1] || '')
  const hasResetToken = hashParams.get('token') || hashParams.get('access_token')
  const hasResetEmail = hashParams.get('email')
  try { console.log('[router] reset params in hash:', { hasToken: !!hasResetToken, hasEmail: !!hasResetEmail }) } catch { }

  switch (baseRoute) {
    case 'login':
      showPage('login-page')
      break
    case 'selection':
      showPage('selection-page')
      break
    case 'studio':
    case 'techno-generator':
      showPage('techno-generator-page')
      initTechnoGenerator()
      break
    case 'reset-password':
      try { console.log('[router] showing reset-password-page') } catch { }
      showPage('reset-password-page')
      console.log('[router] Reset password page should be visible now')
      // Force a small delay to ensure DOM is ready
      setTimeout(() => {
        const page = document.getElementById('reset-password-page')
        console.log('[router] Reset password page element:', page)
        console.log('[router] Reset password page classes:', page?.className)
        console.log('[router] Reset password page hidden:', page?.classList.contains('hidden'))
      }, 100)
      break
    case 'confirm-email':
      showPage('confirm-email-page')
      // Handle email verification tokens if present
      handleEmailVerification()
      break
    case 'profile':
      // Check if user is authenticated before showing profile page
      const authGuard = getAuthGuard()
      if (!authGuard.getIsAuthenticated()) {
        // Redirect to homepage (techno generator page) if not authenticated
        showPage('techno-generator-page')
        initTechnoGenerator()
        break
      }
      showPage('profile-page')
      break
    default:
      // If the hash contains auth params, route to the reset page
      if (/access_token|type=recovery|token=/.test(rawHash)) {
        showPage('reset-password-page')
        break
      }
      // Default to techno generator page if no valid hash
      if (!baseRoute) {
        showPage('techno-generator-page')
        initTechnoGenerator()
      }
      break
  }
}



function initTechnoGenerator() {
  injectGlobalStyles()
  initializeStemControlValues()

  // Check authentication status for techno generator page
  setTimeout(async () => {
    try {
      const { checkAuthenticationStatus } = await import('./Auth/tecnoGeneratorPage.js')
      if (typeof checkAuthenticationStatus === 'function') {
        checkAuthenticationStatus()
      }
    } catch (error) {
      console.error('Error loading techno generator auth:', error)
    }
  }, 100)

  // Build cards
  const container = document.getElementById('stem-container')
  if (container && PROMPTS_MODE === 'builder') {
    container.innerHTML = ''
    STEM_ORDER.forEach(st => container.appendChild(createBuilderStemCard(st, stemConfigs[st])))

    // Re-initialize Lucide icons after cards are created
    setTimeout(() => {
      if (window.initializeIcons) {
        window.initializeIcons()
      } else if (window.safeCreateIcons) {
        window.safeCreateIcons()
      }
    }, 50)
  }

  setupEventListeners()

  // Initialize Lucide icons with a delay to ensure templates are loaded
  setTimeout(() => {
    if (window.initializeIcons) {
      window.initializeIcons()
    } else if (window.safeCreateIcons) {
      window.safeCreateIcons()
    }
  }, 200) // Small delay to ensure templates are fully loaded

  // Build docked mixer
  buildFloatingMixerPanel()
  setMixerOpen(false) // hidden by default

  // Initialise saved state feature (save/load sets)
  initSavedStateFeature()

  // Close mixer when tapping/clicking on the blurred overlay outside of it
  const mixerOverlay = document.getElementById('mixerOverlay')
  if (mixerOverlay) {
    mixerOverlay.addEventListener('click', () => {
      setMixerOpen(false)
    })
  }

  // Create tooltip element for mixer sliders if it does not already exist
  if (!sliderTooltipEl) {
    sliderTooltipEl = document.createElement('div')
    sliderTooltipEl.id = 'sliderTooltip'
    sliderTooltipEl.className = 'fixed z-50 px-2 py-0.5 rounded bg-black/80 text-white text-[10px] pointer-events-none opacity-0 transition-opacity duration-75'
    document.body.appendChild(sliderTooltipEl)
  }

  if (typeof window !== 'undefined') {
    window.debugAudio = {
      getRaw: () => stemRaw,
      getLoop: () => stemLoop,
      getRefHead: () => referenceHeadIndex,
      getHistory: () => stemHistory,
      select: selectStemVersion,
      getEqValues: () => stemEqValues,
      getFilterValues: () => stemFilterValues
    }
  }
  // Initialise card numbers and indicators
  STEM_ORDER.forEach(st => {
    updateHistoryIndicator(st)
    updateCardNumberColor(st)
    updateMutedBorder(st)
    updateTempoIndicator(st)
  })
  // Present the session setup modal if settings have not been chosen
  // yet.  This ensures the user sets the master tempo, bars and key
  // before generating any stems.  The modal will only appear once
  // per session.
  showSessionSetupModal()
}

export async function initApp() {


  try {
    // Initialize authentication guard
    await initializeAuthGuard()

    // Set up auth state change listener
    addAuthListener((event, session, user) => {
      // handleAuthStateChange(event, session, user)  
    })

    // Set up navigation listeners
    setupNavigationListeners()
    // Enable hash-based routing for deep links like #reset-password?access_token=...
    setupRouteHandling()

    // Set up UI components
    // Safe Lucide icon initialization using global safe function
    if (window.safeCreateIcons) {
      const success = window.safeCreateIcons()
      if (!success) {
        console.warn('Lucide icons initialization failed in main app')
        if (window.initializeFallbackIcons) {
          window.initializeFallbackIcons()
        }
      }
    }
    setupHelpModal()
    setupUserMenu() // Setup main header user menu
    updateUserMenuVisibility() // Set initial visibility based on auth state
    setupLoginPage()
    setupResetPasswordPage()
    setupSelectionPage()
    setupTechnoGeneratorPage()
    setupProfilePage()

    // Determine initial page based on URL hash first, then auth state
    const hash = window.location.hash.substring(1)
    const authGuard = getAuthGuard()
    const isAuthenticated = authGuard.isAuthenticated

    if (hash) {
      // If there's a hash, use hash-based routing
      handleHashChange()
    } else {
      // If no hash, show techno generator page by default
      console.log('🎛️ Showing techno generator page')
      showPage('techno-generator-page')
      initTechnoGenerator()
    }

    // console.log('✅ Navigation system ready')
  } catch (error) {
    console.error('❌ App initialization error:', error)
    // Fallback to login page if auth initialization fails
    showPage('login-page')
  }
}

/**
 * Handle authentication state changes
 */
async function handleAuthStateChange(event, session, user) {
  try {
    if (event === 'SIGNED_IN' && user) {

      // Initialize user profile
      await initializeUserProfile(user)

      // Update user menu with user info
      await updateUserMenu()

      // Show user menu since user is now authenticated
      updateUserMenuVisibility()

      // Dispatch auth state change event for other components
      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: { event, session, user }
      }))

      // Update guest mode notice if on techno generator page
      updateGuestModeNotice()

      // Only navigate if we're not already on the selection page and there's no hash
      const currentHash = window.location.hash.substring(1)
      const currentPage = document.querySelector('[id$="-page"]:not(.hidden)')?.id

      // Don't redirect if we're on the reset-password page (user is in the middle of resetting)
      if (currentPage === 'reset-password-page') {
        console.log('User is on reset-password page, not redirecting')
        return
      }

      if (!currentHash && currentPage !== 'techno-generator-page') {
        showPage('techno-generator-page')
        initTechnoGenerator()
      } else {
      }
    } else if (event === 'SIGNED_OUT') {
      console.log('🚪 SIGNED_OUT event received, handling logout...')

      // Clear user menu
      await updateUserMenu()

      // Hide user menu since user is no longer authenticated
      updateUserMenuVisibility()

      // Dispatch auth state change event for other components
      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: { event, session: null, user: null }
      }))

      // Update guest mode notice if on techno generator page
      updateGuestModeNotice()

      // Only navigate if we're not already on the login page and there's no hash
      const currentHash = window.location.hash.substring(1)
      const currentPage = document.querySelector('[id$="-page"]:not(.hidden)')?.id

      console.log('🚪 Current page:', currentPage, 'Current hash:', currentHash)

      if (!currentHash && currentPage !== 'login-page') {
        console.log('🚪 Redirecting to login page...')
        showPage('login-page')
      } else {
        console.log('🚪 Not redirecting - already on login page or hash present')
      }
    }
  } catch (error) {
    console.error('Error handling auth state change:', error)
  }
}

// -----------------------------------------------------------------------------
// UI Overrides
// These overrides adjust the behaviour and appearance of certain controls.
// 1) headerActionButtonsHTML: replace the solo icon with a simple 'S' label.
// 2) headerActionButtonsMobileHTML: on small screens, action buttons fill the card's width
//    and the solo button uses 'S'.

function customHeaderActionButtonsHTML(st) {
  return `\n        <div class="flex items-center gap-1.5">\n          <button class="sg-toggle w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="mute-stem" data-stem="${st}" title="Mute/Unmute" aria-pressed="false">\n            <i data-lucide="volume-2" class="w-4 h-4"></i>\n          </button>\n          <button class="sg-toggle w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="solo-stem" data-stem="${st}" title="Solo" aria-pressed="false">\n            <span class="font-bold text-sm">S</span>\n          </button>\n          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-stem="${st}" title="Favorite (coming soon)">\n            <i data-lucide="heart" class="w-4 h-4"></i>\n          </button>\n          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="download-stem" data-stem="${st}" title="Download">\n            <i data-lucide="download" class="w-4 h-4"></i>\n          </button>\n        </div>\n      `;
}

function customHeaderActionButtonsMobileHTML(st) {
  return `\n        <div class="flex w-full items-center gap-1 sm:hidden mt-1">\n          <button class="sg-toggle flex-1 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="mute-stem" data-stem="${st}" title="Mute/Unmute" aria-pressed="false">\n            <i data-lucide="volume-2" class="w-3 h-3"></i>\n          </button>\n          <button class="sg-toggle flex-1 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="solo-stem" data-stem="${st}" title="Solo" aria-pressed="false">\n            <span class="font-bold text-[10px]">S</span>\n          </button>\n          <button class="flex-1 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-stem="${st}" title="Favorite (coming soon)">\n            <i data-lucide="heart" class="w-3 h-3"></i>\n          </button>\n          <button class="flex-1 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="download-stem" data-stem="${st}" title="Download">\n            <i data-lucide="download" class="w-3 h-3"></i>\n          </button>\n        </div>\n      `;
}

/* =========================================================
   Global styles
   ========================================================= */
// injectGlobalStyles moved to ./UI/styles.js

/* =========================================================
   Help Modal setup
   ========================================================= */
// moved to ./UI/helpModal.js
// setupHelpModal moved to ./UI/helpModal.js

// -----------------------------------------------------------------------------
// Note: The default headerActionButtonsMobileHTML defined earlier is retained.
// Custom layouts are implemented via customHeaderActionButtonsMobileHTML and used
// directly in createBuilderStemCard.  Duplicate overrides were removed to
// prevent redeclaration errors.

// Assign the default header action button helpers to our custom implementations.
// This ensures any call sites referencing headerActionButtonsHTML or
// headerActionButtonsMobileHTML will use the versions that replace the
// headphone icon with a plain "S" label and provide full-width buttons on mobile.
headerActionButtonsHTML = customHeaderActionButtonsHTML;
headerActionButtonsMobileHTML = customHeaderActionButtonsMobileHTML;

/* =========================================================
   Generate settings modal helpers
   When the user taps the Generate button on a stem card, we show a popup
   with all control sliders and toggles for that stem.  After the user
   clicks Start, we update stemControlValues and trigger generation.
   ========================================================= */

// Build the inner HTML for the generate settings modal.  Each control
// defined on the stem config (except volume) becomes a slider or checkbox.
function buildGenerateSettingsContent(st) {
  let html = ''
  const cfg = stemConfigs[st] || {}
  const controls = cfg.controls || {}
  const values = stemControlValues[st] || {}
  for (const [key, c] of Object.entries(controls)) {
    if (key === 'volume') continue // volume is controlled in the mixer
    const val = values[key] ?? c.default
    if (c.type === 'knob') {
      // Use a taller track for mobile (h-3) and add touch-action-none to prevent page scrolling while dragging.
      html += `<div class="flex items-center gap-2">\n` +
        `  <label class="w-24 shrink-0 text-xs text-white/80">${c.label}</label>\n` +
        // Make sliders taller on mobile for easier dragging.  Use h-4 on small screens and h-2 on larger screens.
        `  <input type="range" data-gen-control="${key}" data-unit="${c.unit || ''}" min="${c.min}" max="${c.max}" value="${val}" step="1" class="flex-1 h-4 sm:h-2 bg-white/10 rounded-lg cursor-pointer touch-action-none">\n` +
        `  <span class="text-xs w-8 text-right">${val}${c.unit || ''}</span>\n` +
        `</div>`
    } else if (c.type === 'toggle') {
      const checked = val ? 'checked' : ''
      html += `<label class="flex items-center gap-2 text-xs text-white/90">\n` +
        `  <input type="checkbox" data-gen-control="${key}" ${checked} class="w-4 h-4 rounded border-white/40 bg-transparent">\n` +
        `  <span>${c.label}</span>\n` +
        `</label>`
    }
  }
  return html
}

// Show the generate settings modal for the given stem
function showGenerateSettingsModal(st) {
  currentGenerateStem = st
  const modal = document.getElementById('generateSettingsModal')
  const content = document.getElementById('generateSettingsContent')
  if (modal && content) {
    content.innerHTML = buildGenerateSettingsContent(st)
    modal.classList.remove('hidden')
    requestAnimationFrame(() => { modal.style.opacity = '1' })

    // Reset start and cancel buttons to their default state whenever the modal is shown.
    const startBtn = document.getElementById('generateSettingsStartBtn')
    const cancelBtn = document.getElementById('generateSettingsCancelBtn')
    if (startBtn) {
      startBtn.disabled = false
      // Restore the original label if stored, else default to "Start"
      const orig = startBtn.dataset.originalLabel
      startBtn.innerHTML = orig || 'Start'
    }
    if (cancelBtn) {
      cancelBtn.disabled = false
    }
    // Disable body scrolling while any generate settings modal is open
    document.body.style.overflow = 'hidden'
  }
}

// Hide the generate settings modal
function hideGenerateSettingsModal() {
  const modal = document.getElementById('generateSettingsModal')
  if (modal) {
    modal.style.opacity = '0'
    setTimeout(() => {
      modal.classList.add('hidden')
    }, 200)
  }
  currentGenerateStem = null
  // Re-enable body scrolling when the generate settings modal is hidden
  document.body.style.overflow = ''
}

// Apply the settings from the modal to the current stem and trigger generation
async function applyGenerateSettingsAndStart() {
  const st = currentGenerateStem
  if (!st) return
  const content = document.getElementById('generateSettingsContent')
  if (content) {
    const inputs = content.querySelectorAll('[data-gen-control]')
    inputs.forEach(input => {
      const key = input.getAttribute('data-gen-control')
      if (!key) return
      if (input.type === 'range') {
        const val = parseInt(input.value, 10)
        stemControlValues[st][key] = val
      } else if (input.type === 'checkbox') {
        stemControlValues[st][key] = input.checked
      }
    })
  }
  // Provide feedback on the start and cancel buttons while generation is being scheduled.  Disable
  // both buttons and show a spinner on the start button.
  const startBtn = document.getElementById('generateSettingsStartBtn')
  const cancelBtn = document.getElementById('generateSettingsCancelBtn')
  if (startBtn) {
    startBtn.disabled = true
    // Preserve original label so we can restore it later if needed
    if (!startBtn.dataset.originalLabel) {
      startBtn.dataset.originalLabel = startBtn.innerHTML
    }
    startBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 loading-spin"></i>`
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try {
        if (window.safeCreateIcons) {
          window.safeCreateIcons()
        }
      } catch (error) {
        console.error('Error updating Lucide icons:', error)
      }
    }
  }
  if (cancelBtn) {
    cancelBtn.disabled = true
  }
  hideGenerateSettingsModal()
  // Trigger generation for this stem
  await generateStem(st)
}

/* =========================================================
   Session Setup Modal
   ========================================================= */
// Display the session setup modal on page load.  If session settings have
// already been chosen (sessionSetupDone === true), the modal will not
// appear.  When the user confirms their selections, the values are
// stored in stemControlValues.master and the bottom controls are
// disabled accordingly.  The selected values persist for the
// remainder of the session.
// Wrapper function that calls the imported session setup function
function showSessionSetupModal() {
  showSessionSetupModalImpl(
    sessionSetupDone,
    stemControlValues,
    (value) => { sessionSetupDone = value },
    applySessionSettingsToUI,
    updateTempoIndicator
  )
}

// Wrapper function that calls the imported apply session settings function
function applySessionSettingsToUI() {
  applySessionSettingsToUIImpl(stemControlValues, updateTempoIndicator)
}

/* =========================================================
   Infinite Dial Controls

   These handlers implement an infinite horizontal dial for adjusting
   per-stem parameters such as volume on the card and endpoint
   stretch in the edit modal.  The dial responds to pointer drags
   and mouse wheel events.  It displays a repeating tick pattern
   that scrolls horizontally when the dial is moved, and a central
   marker to indicate the neutral position.  When the dial is
   adjusted, the corresponding stem control is updated immediately
   in the audio engine and any relevant UI.
========================================================= */

// Internal state for the currently active dial interaction.  When
// active is true, the pointermove handler computes deltas from the
// stored start position and value.  patternOffset tracks the
// horizontal shift of the dial's background pattern in pixels.
const dialState = {
  active: false,
  dial: null,
  type: '',
  stem: '',
  startX: 0,
  startVal: 0,
  patternOffset: 0
}

// When a user drags a dial and releases the pointer, a click event
// often fires on whatever element the pointer is over at the time of
// release.  This can cause accidental mute/unmute when the dial is
// positioned over a card.  Use this flag to ignore the next click
// after finishing a dial drag.
let dialIgnoreClick = false

function handleDialPointerDown(e) {
  // Only initiate a dial drag on elements with the .infinite-dial class
  const dial = e.target.closest('.infinite-dial')
  if (!dial) return
  const type = dial.getAttribute('data-dial-type')
  const st = dial.getAttribute('data-stem')
  if (!type || !st) return
  dialState.active = true
  dialState.dial = dial
  dialState.type = type
  dialState.stem = st
  dialState.startX = e.clientX
  if (type === 'volume') {
    dialState.startVal = stemControlValues[st]?.volume ?? 80
  } else if (type === 'endpoint') {
    dialState.startVal = endpointFactors[st] ?? 1
  } else {
    dialState.startVal = 0
  }
  // patternOffset is stored on the dial element; parse or fallback to 0
  const offAttr = dial.getAttribute('data-offset')
  dialState.patternOffset = offAttr ? parseFloat(offAttr) || 0 : 0
  // Capture pointer move/up on the window to continue tracking outside the dial
  window.addEventListener('pointermove', handleDialPointerMove)
  window.addEventListener('pointerup', handleDialPointerUp)
  // Prevent text selection and other default behaviours
  e.preventDefault()
  // Reset the ignore click flag: starting a drag means any upcoming click should be processed normally
  dialIgnoreClick = false
}

function handleDialPointerMove(e) {
  if (!dialState.active) return
  const dx = e.clientX - dialState.startX
  let newVal = dialState.startVal
  if (dialState.type === 'volume') {
    // Sensitivity factor for volume adjustments.  Smaller values
    // produce finer control; larger values accelerate the change.
    const sensitivity = 0.2
    newVal = dialState.startVal + dx * sensitivity
    // Clamp between 0 and 100
    newVal = Math.max(0, Math.min(100, newVal))
    setVolumeUnified(dialState.stem, newVal)
  } else if (dialState.type === 'endpoint') {
    // Finer sensitivity for endpoint adjustments.  A small delta
    // produces a small change to the stretch factor.
    const sensitivity = 0.005
    newVal = dialState.startVal + dx * sensitivity
    newVal = Math.max(0.1, Math.min(3, newVal))
    endpointFactors[dialState.stem] = newVal
    // Persist this endpoint factor on the active take so switching takes remembers the adjustment
    {
      const stName = dialState.stem
      const idx = stemActiveIndex[stName]
      if (idx != null && idx >= 0 && stemHistory[stName] && stemHistory[stName][idx]) {
        stemHistory[stName][idx].endpointFactor = newVal
      }
    }
    // Rebuild loop for the new factor and redraw the card waveform
    adjustEndpoint(dialState.stem, newVal)
    // Update preview waveform in the edit modal
    const canvas = document.getElementById('waveformEditCanvas')
    if (canvas) {
      const cfg = stemConfigs[dialState.stem]
      drawWaveform(canvas, stemLoop[dialState.stem], `rgb(${getColorRGB(cfg.color)})`)
      // Apply the current volume scaling to the preview canvas only
      const volVal = stemControlValues[dialState.stem]?.volume ?? 80
      canvas.style.transform = `scaleY(${volVal / 100})`
    }
  }
  // Update pattern offset for the tick marks.  To keep the offset
  // bounded, wrap it by the pattern width (8 px).  This ensures the
  // background-position stays within a manageable range while still
  // conveying continuous movement.
  const patternWidth = 8
  const newOffset = dialState.patternOffset + dx
  dialState.patternOffset = ((newOffset % patternWidth) + patternWidth) % patternWidth
  // Set the dial background position and persist offset on the element
  dialState.dial.style.backgroundPosition = `${dialState.patternOffset}px 50%`
  dialState.dial.setAttribute('data-offset', String(dialState.patternOffset))
  // Prepare for next move: reset the starting point and value
  dialState.startX = e.clientX
  dialState.startVal = newVal
}

function handleDialPointerUp() {
  if (!dialState.active) return
  dialState.active = false
  window.removeEventListener('pointermove', handleDialPointerMove)
  window.removeEventListener('pointerup', handleDialPointerUp)

  // After releasing the dial, ignore the next click event to prevent
  // accidental mute/unmute when the pointer is over a non-interactive area
  dialIgnoreClick = true
}

function handleDialWheel(e) {
  // Respond to wheel events on a dial to allow quicker adjustments.
  const dial = e.target.closest('.infinite-dial')
  if (!dial) return
  const type = dial.getAttribute('data-dial-type')
  const st = dial.getAttribute('data-stem')
  if (!type || !st) return
  let currentVal, newVal
  if (type === 'volume') {
    currentVal = stemControlValues[st]?.volume ?? 80
    // Each wheel step adjusts the volume by a small amount; deltaY is inverted
    newVal = currentVal - e.deltaY * 0.2
    newVal = Math.max(0, Math.min(100, newVal))
    setVolumeUnified(st, newVal)
  } else if (type === 'endpoint') {
    currentVal = endpointFactors[st] ?? 1
    newVal = currentVal - e.deltaY * 0.01
    newVal = Math.max(0.1, Math.min(3, newVal))
    endpointFactors[st] = newVal
    adjustEndpoint(st, newVal)
    // Update preview waveform if visible
    const canvas = document.getElementById('waveformEditCanvas')
    if (canvas) {
      const cfg = stemConfigs[st]
      drawWaveform(canvas, stemLoop[st], `rgb(${getColorRGB(cfg.color)})`)
      const volVal = stemControlValues[st]?.volume ?? 80
      canvas.style.transform = `scaleY(${volVal / 100})`
    }
  }
  // Advance the tick pattern offset so the dial visually moves with the scroll
  const offAttr = dial.getAttribute('data-offset')
  let off = offAttr ? parseFloat(offAttr) || 0 : 0
  off += -e.deltaY
  const patternWidth = 8
  off = ((off % patternWidth) + patternWidth) % patternWidth
  dial.style.backgroundPosition = `${off}px 50%`
  dial.setAttribute('data-offset', String(off))
  // Prevent the page from scrolling when interacting with the dial
  e.preventDefault()
}

// Global listeners for dial interactions
document.addEventListener('pointerdown', handleDialPointerDown)
document.addEventListener('wheel', handleDialWheel, { passive: false })