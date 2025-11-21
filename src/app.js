// app.js — Techno Generator (Loop-Perfect Edition) — Player/Mixer toggle + wider sliders + hotkeys
// Modified to add card numbering, waveform navigation buttons, help modal and red borders on mute.

import { createClient } from '@supabase/supabase-js'
import { initWavEncoder, encodeWAVAsync, encodeWAVSync, preComputeDataURI, terminateWavEncoder, manageCacheSize } from './audioEncoder.js'
import { storeStemPCM, getStemPCM, getStemFormat, isPCMReadyForDrag, clearStemPCM, getPCMCacheStats } from './stemDataManager.js'
import { pcm16leToWav, pcm16leToWavBlob, validatePcmData, parseElevenLabsFormat, generateWavFilename as generateWavFilenameFromFormat } from './pcmToWav.js'
import { initAutoDownloadManager, isAutoDownloadSupported, isAutoDownloadEnabled, requestAutoDownloadDirectory, disableAutoDownload, getAutoDownloadStatus, subscribeAutoDownloadEvents, queueAutoDownloadForStem, getStemAutoDownloadRecord } from './autoDownloadManager.js'
import { formatBarsForDisplay, getPlaybackBars, normalizeBarsValue } from './Utilities/barUtils.js'
import { retryEdgeFunctionCall, isRetryableError } from './Utilities/retryHelper.js'

/* =========================================================
   Feature flags / Env toggles
   ========================================================= */
const USE_COMPOSITION_PLAN = String(import.meta.env.VITE_ELEVEN_USE_PLAN || 'false').toLowerCase() === 'true'
const PRIMARY_OUTPUT_FORMAT = 'pcm_44100'
const FALLBACK_OUTPUT_FORMAT = 'mp3_44100_128'

/* =========================================================
   Generation format (server)
   ========================================================= */
const PRO_FORMAT = PRIMARY_OUTPUT_FORMAT

/* =========================================================
   UX flags
   ========================================================= */
const PROMPTS_MODE = 'builder' // 'builder' | 'freeform'

/* =========================================================
   Transport / DSP constants
   ========================================================= */
const TEMPO_MIN = 110
const TEMPO_MAX = 140
const DEFAULT_TEMPO = 130
const DEFAULT_BARS  = 4

const START_ENV_MS   = 5
// Increase ramp and crossfade durations to minimise audible clicks at loop
// boundaries.  A longer fade-in/out and crossfade smooths the transition
// when the loop restarts, reducing the chance of hearing a click.
const EDGE_RAMP_MS   = 8
const LOOP_XFADE_MS  = 28
const ENVELOPE_HOP_SAMPLES = 96
const ZERO_FALLBACK_SAMPLES = 384

const BOUNDARY_LOOKAHEAD_MS = 120
const GEN_TAIL_PAD_MS = 200

/* =========================================================
   EQ‑3 + Filter defaults
   ========================================================= */
const EQ_MIN_DB = -80
const EQ_MAX_DB =  +6
const EQ_DEFAULT = 50
const EQ_SMOOTH_TC = 0.02

const EQ_LOW_FREQ  = 180
const EQ_MID_FREQ  = 2200
const EQ_MID_Q     = 1.20
const EQ_HIGH_FREQ = 6500

const FILTER_MIN_HZ = 40
const FILTER_MAX_HZ = 18000
const FILTER_Q = 0.707
const FILTER_SMOOTH_TC = 0.02
const FILTER_DEFAULT_HZ = 12000 // 12 kHz default

/* =========================================================
   Global state
   ========================================================= */
let audioContext = null
let masterGain   = null
let isPlaying    = false

const stemRaw   = {}
const stemLoop  = {}
// active nodes: { source, env, filter, eq:{low,mid,high}, gain }
const stemNodes = {}
const stemGains = {}
const stemLoopIntent = {}

// Each stem maintains its own loop duration.  When a loop is built from a raw
// buffer (after generation or when selecting a take), its duration is stored
// here.  The transport uses these durations to compute per‑stem phases and
// restart offsets, ensuring each stem plays back at its own tempo without
// reference to a shared master tempo.
const stemLoopDuration = {}

const STEM_ALIGNMENT_HINTS = {
  kick: 'percussive',
  perc: 'percussive',
  perc2: 'percussive',
  hihat: 'percussive',
  bass: 'melodic',
  pad: 'melodic',
  lead: 'melodic',
  arp: 'melodic',
  fx: 'ambient'
}

function getStemAlignmentStrategy(st) {
  if (!st) return 'melodic'
  return STEM_ALIGNMENT_HINTS[st] || 'melodic'
}

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
   Auto-download / DAW helper state
   ========================================================= */
let autoDownloadSetupPromise = null
let autoDownloadPanelEl = null
let autoDownloadStatusEl = null
let autoDownloadNoteEl = null
let autoDownloadActionBtn = null
let autoDownloadDisableBtn = null

/* =========================================================
   Visible Instruments State
   ========================================================= */

// Track which instruments are currently visible in the session.
// By default, only kick and bass are shown.
let visibleInstruments = ['kick', 'bass']

// Track if the techno generator has been initialized to prevent duplicate initialization
let technoGeneratorInitialized = false

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
  const snapshot = { stems: {}, visibleInstruments: [...visibleInstruments] }
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

/**
 * Refresh the session information displayed in the bottom player bar.  This
 * helper derives the current master tempo, bar count and key from
 * stemControlValues.master and updates the text elements.  Some stems
 * may have been generated at different tempos/bars; however, the
 * session master values remain fixed after setup and are shown here.
 */
function updateSessionInfoCard() {
  const infoEl = document.getElementById('sessionInfoText')
  const infoElMob = document.getElementById('sessionInfoTextMobile')
  const master = stemControlValues.master || {}
  // Use helper getRootText() to derive the proper root name with accidentals
  const rootName = typeof getRootText === 'function' ? getRootText() : (master.rootBase || '')
  const tempo = master.tempo ?? DEFAULT_TEMPO
  const bars = master.bars ?? DEFAULT_BARS
  const displayBars = getPlaybackBars(bars, DEFAULT_BARS)
  const mode = master.mode ?? 'Minor'
  const infoString = `${tempo} BPM • ${displayBars} bars • ${rootName} ${mode}`
  if (infoEl) infoEl.textContent = infoString
  if (infoElMob) infoElMob.textContent = infoString
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

  // Restore visible instruments if saved
  if (snapshot.visibleInstruments && Array.isArray(snapshot.visibleInstruments)) {
    // Hide all instruments first
    STEM_ORDER.forEach(st => {
      const card = document.querySelector(`[data-stem="${st}"]`)
      if (card) {
        card.style.display = 'none'
      }
    })

    // Update visible instruments array
    visibleInstruments = [...snapshot.visibleInstruments]

    // Reorder cards in the DOM to match visibleInstruments order
    const container = document.getElementById('stem-container')
    const plusButton = document.getElementById('add-instrument-button')
    if (container) {
      visibleInstruments.forEach(st => {
        const card = document.querySelector(`[data-stem="${st}"]`)
        if (card) {
          card.style.display = ''
          // Move card to maintain visibleInstruments order
          if (plusButton) {
            container.insertBefore(card, plusButton)
          } else {
            container.appendChild(card)
          }
        }
      })
    }

    // Update card numbers to reflect the restored order
    updateAllCardNumbers()

    // Update plus button visibility
    updatePlusButtonVisibility()
  }

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
    updateDragButtonState(st); updateCleanButtonState(st)
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
    saveBtn.addEventListener('click', () => {
      // When save is pressed, open confirmation modal instead of saving directly
      openSaveSetModal()
    })
  }
  const dropdown = document.getElementById('savedSetsDropdown')
  if (dropdown) {
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
    saveModalConfirm.addEventListener('click', () => {
      saveNewSet()
    })
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
function setupUserMenu() {
  const btn = document.getElementById('userMenuBtn')
  const menu = document.getElementById('userMenu')
  if (!btn || !menu) return
  // Toggle menu visibility on button click
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const isHidden = menu.classList.contains('hidden')
    if (isHidden) {
      menu.classList.remove('hidden')
      btn.setAttribute('aria-expanded', 'true')
    } else {
      menu.classList.add('hidden')
      btn.setAttribute('aria-expanded', 'false')
    }
  })
  // Hide the menu when clicking outside
  document.addEventListener('click', (e) => {
    if (menu.classList.contains('hidden')) return
    const target = e.target
    if (menu.contains(target) || btn.contains(target)) return
    menu.classList.add('hidden')
    btn.setAttribute('aria-expanded', 'false')
  })
}

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
function saveNewSet() {
  const spinner = document.getElementById('saveSetSpinner')
  const label = document.getElementById('saveSetConfirmLabel')
  if (spinner && label) {
    spinner.classList.remove('hidden')
    label.textContent = 'Saving'
  }
  // Save the state
  const snapshot = getCurrentPlayerState()
  savedSets.push(snapshot)
  // Determine new index
  const newIndex = savedSets.length - 1
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

/**
 * Open the download all confirmation modal.
 */
function openDownloadConfirmModal() {
  const modal = document.getElementById('downloadConfirmModal')
  if (!modal) return
  // Reset spinner and label
  const spinner = document.getElementById('downloadConfirmSpinner')
  const label = document.getElementById('downloadConfirmLabel')
  if (spinner) spinner.classList.add('hidden')
  if (label) label.textContent = 'Download'
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.style.opacity = '1'
    modal.firstElementChild?.classList.remove('scale-95')
    modal.firstElementChild?.classList.add('scale-100')
  })
}

/**
 * Close the download confirmation modal.
 */
function closeDownloadConfirmModal() {
  const modal = document.getElementById('downloadConfirmModal')
  if (!modal) return
  modal.style.opacity = '0'
  modal.firstElementChild?.classList.remove('scale-100')
  modal.firstElementChild?.classList.add('scale-95')
  setTimeout(() => { modal.classList.add('hidden') }, 200)
}

/**
 * Execute the download of all active stems after user confirmation.  A
 * spinner is shown on the confirm button while the download is in
 * progress.  The modal is closed after the download starts.
 */
function confirmDownloadAll() {
  const spinner = document.getElementById('downloadConfirmSpinner')
  const label = document.getElementById('downloadConfirmLabel')
  if (spinner && label) {
    spinner.classList.remove('hidden')
    label.textContent = 'Downloading'
  }
  // Initiate download of all active stems
  downloadAllActiveStems()
  // After initiating, hide modal and reset
  if (spinner && label) {
    spinner.classList.add('hidden')
    label.textContent = 'Download'
  }
  closeDownloadConfirmModal()
}

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

let loopStartTime  = 0
let loopDuration   = 0
let transportTicker = null

function transportTick() {
  if (!isPlaying) {
    transportTicker = null
    return
  }
  updatePlaybackIndicators()
  transportTicker = requestAnimationFrame(transportTick)
}

let referenceStemType = null
let referenceHeadIndex = 0 // samples at decoded SR
// Tooltip element for mixer sliders; created during init.  Shows dB or Hz values while adjusting sliders.
let sliderTooltipEl = null

// Track which stem's settings are being edited in the generate settings modal
let currentGenerateStem = null

// Track which stem is being cleaned (for the clean confirmation modal)
let currentCleanStem = null

// Flag indicating whether the session master settings (tempo, bars, key)
// have been selected. Once this flag is true, the session settings are
// locked for the remainder of the session and the setup modal will not be shown again.
let sessionSetupDone = false

// Takes
const stemHistory = {}
const stemActiveIndex = {}
// Store WAV blobs for reuse in drag operations to avoid regeneration
const stemWavCache = {}
// Cache data URLs so DownloadURL payloads contain the full file for DAWs
const stemWavDataUrlCache = {}
// Cache ArrayBuffer for synchronous Electron IPC calls (prevents blocking during dragstart)
const stemArrayBufferCache = {}
// Store blob URLs with lifecycle management for drag-to-DAW
const stemBlobUrls = {}
// Track preparation state for drag operations (prevents blocking during dragstart)
const stemDragReady = {}

/**
 * Get cached data URI for a stem (synchronous - must be pre-computed)
 * @param {string} st - Stem identifier
 * @returns {string|null} data URI or null if not cached
 */
function getStemDataUri(st) {
  return stemWavDataUrlCache[st] || null
}

/**
 * Extract raw PCM S16LE data from an AudioBuffer
 * Converts floating-point audio data to 16-bit signed PCM
 * @param {AudioBuffer} audioBuffer - The audio buffer to extract from
 * @returns {ArrayBuffer} Raw PCM data as S16LE
 */
function extractPCMFromAudioBuffer(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels
  const length = audioBuffer.length
  const sampleRate = audioBuffer.sampleRate

  // Create interleaved PCM data
  const pcmData = new Int16Array(length * numChannels)

  // Get channel data
  const channels = []
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch))
  }

  // Interleave and convert to 16-bit PCM
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      // Convert float [-1, 1] to int16 [-32768, 32767]
      const sample = Math.max(-1, Math.min(1, channels[ch][i]))
      pcmData[i * numChannels + ch] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
    }
  }

  return pcmData.buffer
}

/**
 * Pre-compute WAV blob, data URI, and ArrayBuffer for a stem asynchronously
 * This should be called immediately after audio generation to avoid blocking during drag
 * @param {string} st - Stem identifier
 * @param {AudioBuffer} audioBuffer - The audio buffer to encode
 * @returns {Promise<void>}
 */
async function prepareStemmForDrag(st, audioBuffer) {
  if (!audioBuffer) {
    stemDragReady[st] = false
    return
  }

  try {
    stemDragReady[st] = false
    console.log(`Preparing ${st} for drag...`)

    const wavBlob = await encodeWAVAsync(audioBuffer)

    stemWavCache[st] = wavBlob
    manageCacheSize(stemWavCache, wavBlob.size)

    const dataUri = await preComputeDataURI(wavBlob)
    stemWavDataUrlCache[st] = dataUri

    const arrayBuffer = await wavBlob.arrayBuffer()
    stemArrayBufferCache[st] = arrayBuffer

    stemDragReady[st] = true
    updateDragButtonState(st); updateCleanButtonState(st)

    console.log(`✓ ${st} ready for drag: ${(wavBlob.size / 1024).toFixed(1)}KB`)
  } catch (err) {
    console.error(`Failed to prepare ${st} for drag:`, err)
    stemDragReady[st] = false
    updateDragButtonState(st); updateCleanButtonState(st)
  }
}

/**
 * Invalidate the cached WAV blob for a stem.
 * Call this whenever the stem's audio buffer is updated.
 * NOTE: Does NOT clear PCM cache - PCM is managed separately and should be
 * explicitly cleared only when new PCM data is about to be stored.
 * @param {string} st - Stem identifier
 */
function invalidateStemCache(st) {
  if (stemWavCache[st]) {
    delete stemWavCache[st]
    console.log(`Invalidated WAV cache for ${st}`)
  }
  if (stemWavDataUrlCache[st]) {
    delete stemWavDataUrlCache[st]
  }
  if (stemArrayBufferCache[st]) {
    delete stemArrayBufferCache[st]
    console.log(`Cleared ArrayBuffer cache for ${st}`)
  }
  if (stemBlobUrls[st]) {
    URL.revokeObjectURL(stemBlobUrls[st])
    delete stemBlobUrls[st]
    console.log(`Cleaned up blob URL for ${st}`)
  }
  stemDragReady[st] = false
}
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
  updateDragButtonState(st); updateCleanButtonState(st)
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
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

/* =========================================================
   Visual helpers
   ========================================================= */
function getColorRGB(colorName) {
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
function drawWaveform(canvas, audioBuffer, color) {
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
function drawTinyWaveform(canvas, audioBuffer) {
  if (!canvas || !audioBuffer) return
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
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

/**
 * Draw waveform in the edit modal canvas
 * @param {string} st - Stem identifier
 * @param {AudioBuffer} audioBuffer - Audio buffer to visualize
 */
function drawEditWaveform(st, audioBuffer) {
  if (!st || !audioBuffer) return
  const canvas = document.getElementById('waveformEditCanvas')
  if (!canvas) return
  const cfg = stemConfigs[st]
  if (!cfg) return
  drawWaveform(canvas, audioBuffer, `rgb(${getColorRGB(cfg.color)})`)
  const volVal = stemControlValues[st]?.volume ?? 80
  canvas.style.transform = `scaleY(${volVal / 100})`
}

/* =========================================================
   Stem configs (9 cards) — order defines 1–9 hotkeys
   ========================================================= */
// Expanded stem configuration.  Each instrument now exposes five
// parametric sliders (knobs) that map to musical descriptors such as
// attack, body, tone and pattern, plus two toggles for auxiliary
// processing (e.g. distortion, reverb).  Volume remains a
// non‑generative control and is therefore excluded from the count of
// five sliders.  These descriptors draw upon common envelope and
// timbre terminology suggested in ElevenLabs prompting guidelines and
// the sound‑effect prompt cheatsheet【250912434198074†L742-L756】.
const stemConfigs = {
  kick: {
    name: 'Kick',
    color: 'red',
    basePrompt: 'deep techno kick drum',
    controls: {
      punch:   { type: 'knob', min: 0, max: 100, default: 70, unit: '%', label: 'Punch' },
      attack:  { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Attack' },
      decay:   { type: 'knob', min: 0, max: 100, default: 40, unit: '%', label: 'Decay' },
      body:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Body' },
      tone:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Tone' },
      distortion: { type: 'toggle', default: false, label: 'Distortion' },
      rumble:     { type: 'toggle', default: false, label: 'Rumble' },
      volume:  { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  perc: {
    name: 'Snare',
    color: 'cyan',
    basePrompt: 'industrial techno snare',
    controls: {
      intensity: { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Intensity' },
      variation: { type: 'knob', min: 0, max: 100, default: 40, unit: '%', label: 'Variation' },
      snap:     { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Snap' },
      decay:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Decay' },
      tone:     { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Tone' },
      metallic: { type: 'toggle', default: false, label: 'Metallic' },
      reverb:   { type: 'toggle', default: false, label: 'Reverb' },
      volume:   { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  bass: {
    name: 'Bass',
    color: 'yellow',
    basePrompt: 'dark techno bassline',
    controls: {
      depth:     { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Depth' },
      movement:  { type: 'knob', min: 0, max: 100, default: 30, unit: '%', label: 'Movement' },
      attack:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Attack' },
      tone:      { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Tone' },
      sub:       { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Sub' },
      filter:    { type: 'toggle', default: true, label: 'Filter Sweep' },
      distortion:{ type: 'toggle', default: false, label: 'Distortion' },
      volume:    { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  lead: {
    name: 'Lead',
    color: 'green',
    basePrompt: 'hypnotic techno lead synth',
    controls: {
      brightness:{ type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Brightness' },
      complexity:{ type: 'knob', min: 0, max: 100, default: 40, unit: '%', label: 'Complexity' },
      motion:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Motion' },
      attack:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Attack' },
      range:     { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Range' },
      delay:     { type: 'toggle', default: false, label: 'Delay' },
      chorus:    { type: 'toggle', default: false, label: 'Chorus' },
      volume:    { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  hihat: {
    name: 'Hihat',
    color: 'orange',
    basePrompt: 'crisp techno closed hi-hat',
    controls: {
      brightness: { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Brightness' },
      pattern:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Pattern' },
      decay:      { type: 'knob', min: 0, max: 100, default: 40, unit: '%', label: 'Decay' },
      texture:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Texture' },
      shuffle:    { type: 'knob', min: 0, max: 100, default: 40, unit: '%', label: 'Shuffle' },
      reverb:     { type: 'toggle', default: false, label: 'Reverb' },
      chorus:     { type: 'toggle', default: false, label: 'Chorus' },
      volume:     { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  pad: {
    name: 'Pad',
    color: 'purple',
    basePrompt: 'ambient techno pad',
    controls: {
      warmth:    { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Warmth' },
      evolution: { type: 'knob', min: 0, max: 100, default: 30, unit: '%', label: 'Evolution' },
      brightness:{ type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Brightness' },
      motion:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Motion' },
      texture:   { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Texture' },
      chorus:    { type: 'toggle', default: true, label: 'Chorus' },
      reverb:    { type: 'toggle', default: false, label: 'Reverb' },
      volume:    { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  arp: {
    name: 'Arp',
    color: 'blue',
    basePrompt: 'techno synthesizer arpeggio',
    controls: {
      rate:      { type: 'knob', min: 0, max: 100, default: 55, unit: '%', label: 'Rate' },
      complexity:{ type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Complexity' },
      range:     { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Range' },
      swing:     { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Swing' },
      tone:      { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Tone' },
      gate:      { type: 'toggle', default: false, label: 'Long Gate' },
      delay:     { type: 'toggle', default: false, label: 'Delay' },
      volume:    { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  fx: {
    name: 'FX',
    color: 'pink',
    basePrompt: 'techno transition effects and atmos',
    controls: {
      intensity: { type: 'knob', min: 0, max: 100, default: 65, unit: '%', label: 'Intensity' },
      movement:  { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Movement' },
      texture:   { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Texture' },
      sweep:     { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Sweep' },
      filter:    { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Filter' },
      reverb:    { type: 'toggle', default: true, label: 'Reverb' },
      delay:     { type: 'toggle', default: false, label: 'Delay' },
      volume:    { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
  perc2: {
    name: 'Perc',
    color: 'orange',
    basePrompt: 'techno top percussion loop',
    controls: {
      density:     { type: 'knob', min: 0, max: 100, default: 60, unit: '%', label: 'Density' },
      groove:      { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Groove' },
      variation:   { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Variation' },
      tone:        { type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Tone' },
      syncopation:{ type: 'knob', min: 0, max: 100, default: 50, unit: '%', label: 'Syncopation' },
      metallic:    { type: 'toggle', default: false, label: 'Metallic' },
      reverb:      { type: 'toggle', default: false, label: 'Reverb' },
      volume:      { type: 'knob', min: 0, max: 100, default: 80, unit: '%', label: 'Volume' },
    },
  },
}
// Fixed hotkey order (1–9)
const STEM_ORDER = ['kick','perc','bass','lead','hihat','pad','arp','fx','perc2']

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
function scaleKnob(v, a, b, c, d, e) {
  const x = Number(v ?? 50)
  if (x <= 20) return a
  if (x <= 40) return b
  if (x <= 60) return c
  if (x <= 80) return d
  return e
}

/* ---------- Builders (hihat/snare strict + others) ---------- */
// (Builders unchanged; omitted for brevity in comments — logic preserved)
function buildHihatPrompt(controls, master, strictness=0){ /* ... same as before ... */ 
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const brightness = scaleKnob(controls.brightness, 'dark', 'balanced', 'crisp', 'bright', 'very bright')
  const patternDesc = scaleKnob(controls.pattern, 'straight 1/16 notes', 'slight 1/16 shuffle', 'moderate syncopation', 'complex syncopation', 'polyrhythmic accents')
  const lengthDesc = scaleKnob(controls.decay, '30–80ms', '60–120ms', '100–180ms', '150–250ms', '250–400ms')
  const textureDesc = scaleKnob(controls.texture, 'soft', 'dry', 'balanced', 'crisp', 'metallic')
  const swingDesc = scaleKnob(controls.shuffle, 'straight', 'light shuffle', 'moderate shuffle', 'noticeable shuffle', 'heavy shuffle')
  const space = controls.reverb ? 'Space: tiny room; decay < 120 ms; gate tails before seam.' : 'Space: dry/minimal.'
  const chorus = controls.chorus ? 'Chorus: subtle shimmer; avoid smear across seam.' : 'Chorus: off.'
  const common = [
    'STEM: HIHAT — solo closed hi‑hat only.',
    'Identity: crisp techno closed hi‑hat.',
    g,
    'ROLE: isolated closed hat (no open‑hat).',
    `Pattern: ${patternDesc}; first hit exactly at bar 1 beat 1; consistent every bar.`,
    `Length: ${lengthDesc}.`,
    `Tone: ${brightness}; Texture: ${textureDesc}.`,
    `Swing: ${swingDesc}.`,
    space,
    chorus,
    'Exclude: ride, shaker, clap, snare, kick, toms, crashes; no melodic content, sweeps, or FX.',
    'Deliver a bar‑perfect seamless loop aligned to bar boundaries.'
  ]
  if (strictness === 1) common.push('ABSOLUTE: Only closed‑hat hits on a straight 1/16 grid; zero swing.')
  else if (strictness >= 2) common.push(
    'MUST: closed‑hat hits on each 1/16 step (16 hits/bar).',
    'MUST: zero reverb tail at seam; gate hits before bar end.',
    'MUST: exclude open hat, ride, shaker, snare, clap, toms, crashes.'
  )
  return common.join(' ')
}
function buildSnarePrompt(controls, master, strictness=0){ /* ... same as before ... */
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const playbackBars = getPlaybackBars(bars, DEFAULT_BARS)
  const playbackLabel = playbackBars === 1 ? 'first bar' : `first ${playbackBars} bars`
  const varTxt     = scaleKnob(controls.variation, 'no variation', 'very subtle variation', 'subtle variation', 'light variation', 'moderate variation')
  const intensity  = scaleKnob(controls.intensity, 'low', 'moderate', 'medium', 'strong', 'very strong')
  const snap       = scaleKnob(controls.snap, 'soft', 'medium‑soft', 'balanced', 'sharp', 'cracking')
  const tail       = scaleKnob(controls.decay, 'very short', 'short', 'medium', 'long', 'very long')
  const toneDesc   = scaleKnob(controls.tone, 'thin', 'dry', 'balanced', 'full', 'deep')
  const timbreTxt  = controls.metallic ? 'Timbre: slightly metallic; tight transient.' : 'Timbre: organic and dry.'
  const space      = controls.reverb ? 'Space: tiny room; decay < 150 ms; gate tails before seam.' : 'Space: dry; short decay; no tail.'
  const common = [
    'STEM: SNARE — solo snare only.',
    'Identity: industrial techno snare; drum‑machine style; no clap.',
    g,
    'ROLE: isolated electronic snare.',
    'Pattern: hits exactly on beats 2 and 4 of every bar (no ghost notes or rolls).',
    `LoopFocus: only the ${playbackLabel} plays back, so beats 2 & 4 there must be perfect every time.`,
    `Dynamics: ${intensity}; Snap: ${snap}; Tail: ${tail}.`,
    `Tone: ${toneDesc}. ${timbreTxt}`,
    `Variation: ${varTxt} but positions remain 2 & 4.`,
    space,
    'ABSOLUTE: snare-only audio — no clap, rim, kick, tom, hat, shaker, crash, percussion layers or FX.',
    'Center-panned single snare strike per hit; no stacks or additional drums.',
    'Exclude: clap/rim/kick/hat/shakers/toms/crashes; unpitched; no tails at seam.',
    'Deliver a bar‑perfect seamless loop aligned to bar boundaries.'
  ]
  if (strictness === 1) common.push('ABSOLUTE: only beat 2 and beat 4 per bar; no extra hits.', 'ABSOLUTE: no off‑grid timing.')
  else if (strictness >= 2) common.push('MUST: exactly one snare on beat 2 and one on beat 4 per bar, nothing else.', 'MUST: gate decay fully before the seam; exclude clap/rim layers.')
  return common.join(' ')
}
function mapArpRate(v){ const x=Number(v??55); return x<=33?'1/8 notes': x<=66?'1/16 notes':'1/32 notes' }
function buildArpPrompt(controls, master){ /* ... same as before ... */
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const playbackBars = getPlaybackBars(bars, DEFAULT_BARS)
  const playbackNote = playbackBars === 1 ? 'first bar' : `first ${playbackBars} bars`
  const rate       = mapArpRate(controls.rate)
  const complexity = scaleKnob(controls.complexity, 'simple', 'moderate', 'interesting', 'intricate', 'ornate')
  const rangeDesc  = scaleKnob(controls.range, 'narrow', 'one octave', 'two octaves', 'three octaves', 'wide')
  const swingDesc  = scaleKnob(controls.swing, 'straight', 'slight swing', 'moderate swing', 'pronounced swing', 'syncopated')
  const toneDesc   = scaleKnob(controls.tone, 'dark', 'warm', 'balanced', 'bright', 'sparkling')
  const gate       = controls.gate ? 'long‑ish gate (80–160 ms)' : 'short gate (30–80 ms)'
  const delay      = controls.delay ? 'Delay: subtle tempo‑synced echoes; cut at bar end.' : 'Delay: off.'
  return [
    'STEM: ARPEGGIATOR — solo synth arpeggio only.',
    `Identity: ${stemConfigs.arp.basePrompt}.`,
    g,
    `ROLE: isolated arp; strictly diatonic in ${root} ${mode}; no chords.`,
    `Pattern: ${rate}; ${swingDesc}; fully quantized; phrase length must evenly divide ${bars} bars.`,
    `LoopFocus: the ${playbackNote} is the exposed playback loop — start on bar 1 beat 1 and resolve before that boundary repeats.`,
    `Complexity: ${complexity}; consistent motif and octave moves.`,
    `Range: ${rangeDesc}; Tone: ${toneDesc}.`,
    `Envelope: ${gate}.`,
    delay,
    'Exclude: drums/percussion/bass/pads/leads/vocals.',
    'Deliver a bar‑perfect seamless loop aligned to bar boundaries; keep the first playback chunk identical each repeat.'
  ].join(' ')
}
function buildFXPrompt(controls, master){ /* ... same as before ... */ 
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const intensity   = scaleKnob(controls.intensity, 'subtle', 'moderate', 'medium', 'strong', 'intense')
  const movement    = scaleKnob(controls.movement, 'static', 'gentle motion', 'evolving', 'animated', 'dynamic')
  const textureDesc = scaleKnob(controls.texture, 'smooth', 'grainy', 'noisy', 'metallic', 'chaotic')
  const sweepDesc   = scaleKnob(controls.sweep, 'short sweep', 'moderate sweep', 'long sweep', 'full‑bar sweep', 'multi‑bar sweep')
  const filterDesc  = scaleKnob(controls.filter, 'low emphasis', 'mid emphasis', 'balanced', 'high emphasis', 'resonant high‑pass')
  const space       = controls.reverb ? 'Space: tiny room; decay ≤ 150 ms; gate before bar end.' : 'Space: dry/minimal; gate before bar end.'
  const delayTxt    = controls.delay ? 'Delay: subtle echo; decay under bar.' : 'Delay: off.'
  return [
    'STEM: FX — solo techno transition effects & atmos only.',
    `Identity: ${stemConfigs.fx.basePrompt}.`,
    g,
    'ROLE: bar‑internal whooshes/sweeps/noise beds that RESET each bar.',
    `Intensity: ${intensity}. Movement: ${movement}. Texture: ${textureDesc}. Sweep: ${sweepDesc}. Filter: ${filterDesc}.`,
    space,
    delayTxt,
    'Exclude: pitched melodies/drums/percussion; avoid risers/falls that exceed a single bar.',
    'Deliver a bar‑perfect seamless loop; zero tail beyond the bar.'
  ].join(' ')
}
function buildPercLoopPrompt(controls, master){ /* ... same as before ... */ 
  const { tempo, bars, root, mode } = master
  const g = globalScaffold({ tempo, bars, root, mode })
  const density     = scaleKnob(controls.density, 'sparse', 'light', 'medium', 'busy', 'dense')
  const groove      = scaleKnob(controls.groove, 'straight', 'straight with mild syncopation', 'syncopated but quantized', 'complex yet quantized', 'complex yet quantized')
  const variation   = scaleKnob(controls.variation, 'repetitive', 'subtle', 'moderate', 'intricate', 'wild')
  const toneDesc    = scaleKnob(controls.tone, 'dark', 'warm', 'balanced', 'bright', 'metallic')
  const syncDesc    = scaleKnob(controls.syncopation, 'straight', 'mild', 'groovy', 'complex', 'polyrhythmic')
  const metallic    = controls.metallic ? 'slightly metallic timbre allowed' : 'organic timbre preferred'
  const space       = controls.reverb ? 'Space: tiny room; gate before seam.' : 'Space: dry; no reverb.'
  return [
    'STEM: PERCUSSION — solo top percussion only (shakers/blocks/taps); not snare/hat/kick.',
    `Identity: ${stemConfigs.perc2.basePrompt}.`,
    g,
    `ROLE: quantized on‑grid accents; ${groove}; zero swing.`,
    `Density: ${density}; keep consistent across bars.`,
    `Variation: ${variation}.`,
    `Tone: ${toneDesc}.`,
    `Syncopation: ${syncDesc}.`,
    `Timbre: ${metallic}; short releases; zero tails at seam.`,
    space,
    'Exclude: tonal hits/kick/snare/clap/hat/ride/toms/crashes.',
    'Deliver a bar‑perfect seamless loop aligned to bar boundaries.'
  ].join(' ')
}
function roleDirectives(st, c){ /* ... same as before ... */
  const playbackBars = getPlaybackBars(stemControlValues?.master?.bars ?? DEFAULT_BARS, DEFAULT_BARS)
  const playbackLabel = playbackBars === 1 ? 'the first bar' : `the first ${playbackBars} bars`
  switch (st) {
    case 'kick': return [
      'ROLE: single isolated kick only',
      'Pattern: four-on-the-floor; hits on beats 1–4 every bar',
      'Pitch: unpitched; no tonal sub note; no toms',
      // Envelope and tone descriptors
      `Attack: ${scaleKnob(c.attack, 'slow','soft','balanced','sharp','instant')}`,
      `Decay: ${scaleKnob(c.decay, 'very short','short','medium','long','very long')}`,
      `Punch: ${scaleKnob(c.punch, 'soft','firm','punchy','very punchy','aggressive')}`,
      `Body: ${scaleKnob(c.body, 'thin','firm','full','thick','boomy')}`,
      `Tone: ${scaleKnob(c.tone, 'dark','warm','balanced','bright','very bright')}`,
      // Toggle descriptors
      c.distortion ? 'Distortion: moderate saturation; no excessive clipping' : 'Distortion: none; clean transient',
      c.rumble ? 'Rumble: deep sub tail under 50 Hz; subtle' : 'Rumble: none',
      'Exclude: fills/intro flam/crashes'
    ].join('. ')
    case 'bass': return [
      'ROLE: single isolated bass only',
      'Harmony: strictly diatonic in project key (no chromatic notes)',
      'Pitch: root + fifth primarily; occasional octave',
      `Movement: ${scaleKnob(c.movement, 'static','simple','groovy','animated','busy')} repeating per bar`,
      `Depth: ${scaleKnob(c.depth, 'light','medium','deep','deeper','subby')} low‑end; controlled release`,
      `Attack: ${scaleKnob(c.attack, 'soft','moderate','distinct','sharp','percussive')}`,
      `Tone: ${scaleKnob(c.tone, 'dark','warm','balanced','bright','acidic')}`,
      `Sub: ${scaleKnob(c.sub, 'minimal','moderate','full','deep','subsonic')} content`,
      c.filter ? 'Filter: subtle motion within bar; reset each bar' : 'Filter: stable',
      c.distortion ? 'Distortion: mild analog saturation; no heavy clipping' : 'Distortion: none',
      'Start note on beat 1; no slides across seam'
    ].join('. ')
    case 'lead': return [
      'ROLE: single isolated lead synth only',
      'Melody: strictly diatonic; avoid chromatic passing tones',
      `Phrase length evenly divides ${Math.max(1, stemControlValues?.master?.bars || DEFAULT_BARS)} bar(s)`,
      `LoopFocus: ${playbackLabel} is what users hear — attack must start at sample 0 (bar 1 beat 1) and resolve before the seam.`,
      `Complexity: ${scaleKnob(c.complexity, 'simple','moderate','interesting','intricate','ornate')} (quantized)`,
      `Brightness: ${scaleKnob(c.brightness, 'dark','mellow','balanced','bright','very bright')}`,
      `Motion: ${scaleKnob(c.motion, 'static','gentle','flowing','evolving','chaotic')}`,
      `Attack: ${scaleKnob(c.attack, 'soft','moderate','plucky','sharp','percussive')}`,
      `Range: ${scaleKnob(c.range, 'narrow','one octave','two octaves','three octaves','wide')}`,
      c.delay ? 'Delay: minimal tempo‑synced; cut at bar end' : 'Delay: off',
      c.chorus ? 'Chorus: subtle stereo spread; no detune at seam' : 'Chorus: off',
      'No bends/slides across loop seam'
    ].join('. ')
    case 'pad': return [
      'ROLE: single isolated pad only',
      'Chord: sustained diatonic chord(s); no modulation',
      `Evolution: ${scaleKnob(c.evolution, 'static','gentle','subtle motion','evolving','animated')} but reset every bar`,
      `Warmth: ${scaleKnob(c.warmth, 'cool','neutral','warm','lush','very lush')}`,
      `Brightness: ${scaleKnob(c.brightness, 'dark','warm','balanced','bright','shimmering')}`,
      `Motion: ${scaleKnob(c.motion, 'static','gentle','animated','evolving','shifting')}`,
      `Texture: ${scaleKnob(c.texture, 'smooth','airy','lush','grainy','noisy')}`,
      c.chorus ? 'Chorus: subtle; no stereo smear at seam' : 'Chorus: off',
      c.reverb ? 'Reverb: soft ambient; decay under bar; gate at seam' : 'Reverb: off',
      'No long reverb tail; envelope ends before bar boundary'
    ].join('. ')
    default: return 'ROLE: single isolated instrument only'
  }
}
function negatives(st){ /* ... same as before ... */ 
  const common = [
    'no vocals or speech','no cymbal crash on the last beat','no count-in','no pre-roll',
    'no silence at start','no tempo changes','no swing','no off-grid timing','no modulation or key change'
  ]
  const per = {
    kick:['no toms','no pitch glides','no tonal sub drops','no reverb tail'],
    hihat:['no open hats','no ride','no shaker','no clap','no snare','no pitch sweeps','no reverb tail'],
    perc:['no clap','no rimshot','no hi-hat','no kick','no toms','no melodic percussion','no reverb tail'],
    bass:['no chords','no distortion tail','no slides across seam'],
    lead:['no atonal notes','no portamento across seam','no long delay tail'],
    pad:['no huge reverb','no side instruments','no arpeggios','no tail at seam'],
    arp:['no drums','no percussion','no bass','no pads','no leads','no vocals','no FX'],
    fx:['no drums or percussion','no pitched melodies','no vocals','no tails across seam'],
    perc2:['no kick','no snare','no clap','no hi-hat','no ride','no toms','no tonal hits','no tail across seam']
  }
  return [...common, ...(per[st] || [])].join('; ')
}
function buildStemPrompt(st, strictness=0){
  const controls = stemControlValues[st] || {}
  const master = getMasterForPrompt()
  if (st === 'hihat') return buildHihatPrompt(controls, master, strictness)
  if (st === 'perc')  return buildSnarePrompt(controls, master, strictness)
  if (st === 'arp')   return buildArpPrompt(controls, master)
  if (st === 'fx')    return buildFXPrompt(controls, master)
  if (st === 'perc2') return buildPercLoopPrompt(controls, master)
  const cfg = stemConfigs[st]
  const stemBase = cfg?.basePrompt || 'single instrument'
  const global   = globalScaffold(master)
  const role     = roleDirectives(st, controls)
  const negs     = negatives(st)
  return [
    `STEM: ${st.toUpperCase()} — solo ${stemBase}.`,
    global,
    role,
    `Avoid: ${negs}.`,
    'Deliver a bar-perfect loop that aligns exactly with bar boundaries and starts at bar 1 beat 1.'
  ].join(' ')
}

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
      // community recommendations and WaveSurfer’s ignoreSilenceMode
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
            ;(function playSilent() {
              try {
                // 1. Create a throwaway AudioContext and play a single sample
                const ac2 = new (window.AudioContext || window.webkitAudioContext)()
                const buf = ac2.createBuffer(1, 1, 44100)
                const src = ac2.createBufferSource()
                src.buffer = buf
                src.connect(ac2.destination)
                src.start(0)
                // 2. Create an <audio> element with a short silent MP3 (3 ms)
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
                  playPromise.catch(() => {})
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
      } catch (ignored) {}

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
  const low  = audioContext.createBiquadFilter()
  low.type = 'lowshelf'
  low.frequency.setValueAtTime(EQ_LOW_FREQ, audioContext.currentTime)
  low.gain.setValueAtTime(0, audioContext.currentTime)

  const mid  = audioContext.createBiquadFilter()
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
  const v = Math.max(0, Math.min(100, Number(val)||0))
  const lnMin = Math.log(FILTER_MIN_HZ), lnMax = Math.log(FILTER_MAX_HZ)
  const lnF = lnMin + (v/100) * (lnMax - lnMin)
  return Math.exp(lnF)
}
function freqToKnob(freq) {
  const f = Math.max(FILTER_MIN_HZ, Math.min(FILTER_MAX_HZ, Number(freq)||FILTER_DEFAULT_HZ))
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
function clampTempo(t){ const x=Math.round(Number(t)||DEFAULT_TEMPO); return Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, x)) }
function computeTargetFrames(sr, bpm, bars){ const beats=bars*4; const seconds=beats*(60/bpm); return Math.round(seconds*sr) }
function removeDcOffset(buffer){ const ch=buffer.numberOfChannels; for(let c=0;c<ch;c++){ const d=buffer.getChannelData(c); let sum=0; for(let i=0;i<d.length;i++) sum+=d[i]; const mean=sum/d.length; if(Math.abs(mean)>1e-6){ for(let i=0;i<d.length;i++) d[i]-=mean } } }
function nearestZeroCrossing(data, around, radius){ const n=data.length; let best=around,bestVal=Math.abs(data[around]||0); const a=Math.max(0,around-radius), b=Math.min(n-1,around+radius); for(let i=a;i<=b;i++){ const v=Math.abs(data[i]); if(v<bestVal){ bestVal=v; best=i } } return best }
function detectHeadIndex(buffer){ const sr=buffer.sampleRate; const maxMs=1000; const maxN=Math.min(buffer.length, Math.round((maxMs/1000)*sr)); if(maxN<=0) return 0; const x=buffer.getChannelData(0); const env=new Float32Array(maxN); for(let i=0;i<maxN;i++) env[i]=Math.abs(x[i]); const win=Math.max(2, Math.round((8/1000)*sr)); let acc=0; for(let i=0;i<win && i<env.length;i++) acc+=env[i]; const sm=new Float32Array(maxN); for(let i=0;i<maxN;i++){ if(i>=win) acc+=env[i]-env[i-win]; sm[i]=acc/Math.min(win,i+1) } let peak=0; for(let i=0;i<maxN;i++) if(sm[i]>peak) peak=sm[i]; const th=Math.max(Math.pow(10,-45/20), peak*0.12); const backOff=Math.round(0.0035*sr); for(let i=0;i<maxN;i++) if(sm[i]>=th){ const z=nearestZeroCrossing(x, Math.max(0,i-backOff), ZERO_FALLBACK_SAMPLES); return Math.max(0,z) } return 0 }
function applySeamCrossfade(buffer, xfadeMs=LOOP_XFADE_MS){
  if(!buffer) return
  const sr = buffer.sampleRate || 44100
  const n = buffer.length || 0
  if(n <= 2) return
  const maxCross = Math.floor(n/2)
  const xfadeN = Math.min(maxCross, Math.max(2, Math.round((xfadeMs/1000)*sr)))
  if(xfadeN < 2) return
  const fadeIn = new Float32Array(xfadeN)
  const fadeOut = new Float32Array(xfadeN)
  for(let i=0;i<xfadeN;i++){
    const t = i/(xfadeN-1)
    const sinT = Math.sin(0.5*Math.PI*t)
    const cosT = Math.cos(0.5*Math.PI*t)
    fadeIn[i] = sinT*sinT
    fadeOut[i] = cosT*cosT
  }
  for(let c=0;c<buffer.numberOfChannels;c++){
    const d = buffer.getChannelData(c)
    const blend = new Float32Array(xfadeN)
    const tailStart = n - xfadeN
    for(let i=0;i<xfadeN;i++){
      const headVal = d[i]
      const tailVal = d[tailStart + i]
      blend[i] = tailVal * fadeOut[i] + headVal * fadeIn[i]
    }
    d.set(blend, 0)
    d.set(blend, tailStart)
    d[n-1] = d[0]
  }
}
function applyEdgeRamps(buffer, rampMs=EDGE_RAMP_MS){
  const sr=buffer.sampleRate, n=buffer.length
  const ramp=Math.max(2, Math.round((rampMs/1000)*sr))
  for(let c=0;c<buffer.numberOfChannels;c++){
    const d=buffer.getChannelData(c)
    for(let i=0;i<ramp && i<n;i++) d[i]*=Math.sin(0.5*Math.PI*(i/(ramp-1)))
    for(let i=0;i<ramp && i<n;i++) d[n-1-i]*=Math.sin(0.5*Math.PI*(1-(i/(ramp-1))))
  }
}

function smoothEnvelopeInPlace(arr, alpha=0.35){
  if(!arr || arr.length===0) return
  let prev=arr[0]
  for(let i=0;i<arr.length;i++){
    const current=arr[i]
    prev = prev*(1-alpha) + current*alpha
    arr[i]=prev
  }
}

function wrapSampleIndex(idx, length){
  if(length<=0) return 0
  let r=idx%length
  if(r<0) r+=length
  return r
}

function quantizeHeadToBeat(sampleIndex, beatSamples, totalLength) {
  if (!isFinite(beatSamples) || beatSamples <= 0 || !isFinite(sampleIndex)) {
    return wrapSampleIndex(Math.round(sampleIndex || 0), totalLength)
  }
  const beats = Math.round(sampleIndex / beatSamples)
  const snapped = beats * beatSamples
  return wrapSampleIndex(snapped, totalLength)
}

function measureLocalPeak(data, totalLength, aroundIndex, windowSamples) {
  if (!data || data.length === 0 || totalLength <= 0) return 1
  const win = Math.max(1, windowSamples || 1)
  let peak = 0
  for (let i = 0; i < win; i++) {
    const idx = wrapSampleIndex(Math.round(aroundIndex + i), totalLength)
    const v = Math.abs(data[idx] || 0)
    if (v > peak) peak = v
  }
  return Math.max(peak, 1e-5)
}

function snapHeadBackToSilence(data, totalLength, approxHead, opts={}) {
  if (!data || !data.length || totalLength <= 0) return wrapSampleIndex(Math.round(approxHead || 0), totalLength)
  const sr = opts.sampleRate || 44100
  const searchSamples = Math.min(totalLength, Math.max(1, opts.searchSamples || Math.round((opts.searchMs || 0.05) * sr)))
  const quietRunSamples = Math.max(2, opts.quietSamples || Math.round((opts.quietMs || 0.006) * sr))
  const zeroSearch = Math.max(1, opts.zeroSearch || Math.round((opts.zeroSearchMs || 0.004) * sr))
  const peakWindow = Math.max(quietRunSamples, opts.peakWindow || Math.round((opts.peakWindowMs || 0.04) * sr))
  const baseIndex = wrapSampleIndex(Math.round(approxHead || 0), totalLength)
  const peak = measureLocalPeak(data, totalLength, baseIndex, peakWindow)
  const thresholdRatio = typeof opts.thresholdRatio === 'number' ? opts.thresholdRatio : 0.045
  const minFloor = typeof opts.noiseFloor === 'number' ? opts.noiseFloor : 1e-5
  const threshold = Math.max(minFloor, peak * thresholdRatio)
  let quietRun = 0
  for (let step = 0; step < searchSamples; step++) {
    const idx = wrapSampleIndex(baseIndex - step, totalLength)
    if (Math.abs(data[idx] || 0) <= threshold) {
      quietRun++
      if (quietRun >= quietRunSamples) {
        const candidate = wrapSampleIndex(idx, totalLength)
        return nearestZeroCrossing(data, candidate, zeroSearch)
      }
    } else {
      quietRun = 0
    }
  }
  return baseIndex
}

function computeWindowAbsEnergy(data, totalLength, startIndex, windowSamples) {
  if (!data || !data.length || totalLength <= 0 || windowSamples <= 0) return 0
  let sum = 0
  for (let i = 0; i < windowSamples; i++) {
    const idx = wrapSampleIndex(Math.round(startIndex + i), totalLength)
    sum += Math.abs(data[idx] || 0)
  }
  return sum / windowSamples
}

function enforceQuietLoopStart(data, totalLength, approxHead, opts={}) {
  if (!data || !data.length || totalLength <= 0) return wrapSampleIndex(Math.round(approxHead || 0), totalLength)
  const sr = opts.sampleRate || 44100
  const tempo = clampTempo(opts.tempo || DEFAULT_TEMPO)
  const beatSamples = Math.max(1, Math.round((60 / tempo) * sr))
  const searchBeats = typeof opts.searchBeats === 'number' ? opts.searchBeats : 0.75
  const searchSamples = Math.min(totalLength, Math.max(Math.round(searchBeats * beatSamples), Math.round(0.05 * sr)))
  const windowSamples = Math.max(4, opts.windowSamples || Math.round((opts.windowMs || 0.012) * sr))
  const zeroSearch = Math.max(1, opts.zeroSearch || Math.round((opts.zeroMs || 0.007) * sr))
  const attackWindow = Math.max(windowSamples * 2, opts.attackWindow || Math.round((opts.attackWindowMs || 0.045) * sr))
  const head = wrapSampleIndex(Math.round(approxHead || 0), totalLength)
  const attackPeak = measureLocalPeak(data, totalLength, head + windowSamples * 2, attackWindow)
  const noiseFloor = typeof opts.noiseFloor === 'number' ? opts.noiseFloor : 0.00035
  const ratio = typeof opts.thresholdRatio === 'number' ? opts.thresholdRatio : (opts.strategy === 'percussive' ? 0.018 : 0.028)
  const quietThreshold = Math.max(noiseFloor, attackPeak * ratio)
  const baseEnergy = computeWindowAbsEnergy(data, totalLength, head, windowSamples)
  if (baseEnergy <= quietThreshold) return head
  let bestHead = head
  let bestEnergy = baseEnergy
  for (let offset = 1; offset <= searchSamples; offset++) {
    const candidate = wrapSampleIndex(head - offset, totalLength)
    const energy = computeWindowAbsEnergy(data, totalLength, candidate, windowSamples)
    if (energy < bestEnergy) {
      bestEnergy = energy
      bestHead = candidate
      if (energy <= quietThreshold * 0.85) break
    }
  }
  if (bestHead !== head) {
    return nearestZeroCrossing(data, bestHead, zeroSearch)
  }
  return head
}

function refineLoopHead(raw, approxHead, opts={}) {
  if (!raw || !isFinite(raw.length) || raw.length <= 0) return 0
  const strategy = opts.strategy || 'melodic'
  const sr = raw.sampleRate || 44100
  const channelData = raw.numberOfChannels > 0 ? raw.getChannelData(0) : null
  if (!channelData || channelData.length === 0) {
    return wrapSampleIndex(Math.round(approxHead || 0), raw.length)
  }
  const tempo = clampTempo(opts.tempo || DEFAULT_TEMPO)
  const beatSamples = Math.max(1, Math.round((60 / tempo) * sr))
  const searchBeats = typeof opts.searchBeats === 'number'
    ? opts.searchBeats
    : (strategy === 'percussive' ? 0.85 : 0.65)
  const searchSamples = Math.min(raw.length, Math.max(Math.round(searchBeats * beatSamples), Math.round(0.08 * sr)))
  const quietMs = strategy === 'percussive' ? 0.009 : 0.011
  const ratio = strategy === 'percussive' ? 0.028 : 0.024
  const zeroMs = 0.007
  const peakMs = strategy === 'percussive' ? 0.06 : 0.07
  const snapped = snapHeadBackToSilence(channelData, raw.length, approxHead, {
    sampleRate: sr,
    searchSamples,
    quietMs,
    thresholdRatio: ratio,
    zeroSearchMs: zeroMs,
    peakWindowMs: peakMs,
    noiseFloor: strategy === 'percussive' ? 0.00025 : 0.0004
  })
  return enforceQuietLoopStart(channelData, raw.length, snapped, {
    sampleRate: sr,
    tempo,
    searchBeats,
    zeroSearch: Math.max(1, Math.round(zeroMs * sr)),
    windowSamples: Math.max(4, Math.round(0.012 * sr)),
    strategy,
    thresholdRatio: strategy === 'percussive' ? 0.02 : 0.03,
    noiseFloor: strategy === 'percussive' ? 0.00025 : 0.0004
  })
}

function buildRhythmProfiles(buffer, hop=ENVELOPE_HOP_SAMPLES){
  if(!buffer) return { sampleRate: 44100, hop: hop||1, kickEnv: new Float32Array(0), snareEnv: new Float32Array(0), length: 0 }
  const sr=buffer.sampleRate||44100
  const hopSize=Math.max(1, hop||1)
  const data=buffer.numberOfChannels>0 ? buffer.getChannelData(0) : new Float32Array(0)
  const len=Math.ceil(data.length / hopSize)
  const kickEnv=new Float32Array(len)
  const snareEnv=new Float32Array(len)
  let idx=0
  let prevSample=0
  for(let frame=0; frame<len; frame++){
    let kickSum=0
    let snareSum=0
    let count=0
    for(let j=0; j<hopSize && idx<data.length; j++, idx++){
      const sample=data[idx]
      kickSum+=Math.abs(sample)
      snareSum+=Math.abs(sample - prevSample)
      prevSample=sample
      count++
    }
    const denom=count||1
    kickEnv[frame]=kickSum/denom
    snareEnv[frame]=snareSum/denom
  }
  smoothEnvelopeInPlace(kickEnv, 0.3)
  smoothEnvelopeInPlace(snareEnv, 0.4)
  return { sampleRate: sr, hop: hopSize, kickEnv, snareEnv, length: len }
}

function sampleEnvelopeAt(envArr, hop, sampleIdx, windowSamples=0){
  if(!envArr || envArr.length===0) return 0
  const hopSize=Math.max(1, hop||1)
  const n=envArr.length
  const envIndex=wrapSampleIndex(Math.round(sampleIdx / hopSize), n)
  const radius=Math.max(0, Math.round((windowSamples||0)/hopSize))
  if(radius===0) return envArr[envIndex]
  let sum=0
  let count=0
  for(let i=-radius;i<=radius;i++){
    const j=wrapSampleIndex(envIndex+i, n)
    sum+=envArr[j]
    count++
  }
  return sum/Math.max(1,count)
}

function scoreBeatAlignment(profiles, startSample, beatSamples, beatsToCheck){
  if(!profiles || beatSamples<=0) return 0
  const beats=Math.max(1, beatsToCheck)
  const focusWin=Math.round(0.02 * profiles.sampleRate)
  const snareWin=Math.round(0.025 * profiles.sampleRate)
  const ghostWin=Math.round(0.03 * profiles.sampleRate)
  let kickScore=0
  let snareScore=0
  let ghostScore=0
  for(let beat=0; beat<beats; beat++){
    const center=startSample + beat*beatSamples
    kickScore += sampleEnvelopeAt(profiles.kickEnv, profiles.hop, center, focusWin)
    if(beat % 4 === 1 || beat % 4 === 3){
      snareScore += sampleEnvelopeAt(profiles.snareEnv, profiles.hop, center, snareWin)
    }
    ghostScore += sampleEnvelopeAt(profiles.kickEnv, profiles.hop, center + beatSamples/2, ghostWin)
  }
  return kickScore*1.05 + snareScore*0.85 - ghostScore*0.65
}

function alignHeadToBeatGrid(raw, bpm, bars, approxHeadIndex=0, opts={}){
  if(!raw || !isFinite(raw.length) || raw.length<=0) return approxHeadIndex||0
  const strategy=opts.strategy || 'percussive'
  const tempo=Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, bpm || DEFAULT_TEMPO))
  const sr=raw.sampleRate||44100
  const beatSamples=Math.max(1, Math.round((60/tempo)*sr))
  const approx=wrapSampleIndex(Math.round(approxHeadIndex||0), raw.length)
  if(strategy==='melodic'){
    return quantizeHeadToBeat(approx, beatSamples, raw.length)
  }
  if(strategy==='ambient'){
    return approx
  }
  const beatsToCheck=Math.min(32, Math.max(8, Math.round((bars || DEFAULT_BARS)*4)))
  const searchRadius=Math.min(raw.length, Math.round(beatSamples*2))
  const profiles=buildRhythmProfiles(raw)
  const step=Math.max(1, Math.round(beatSamples/64))
  let bestIdx=approx
  let bestScore=scoreBeatAlignment(profiles, bestIdx, beatSamples, beatsToCheck)
  for(let offset=approxHeadIndex - searchRadius; offset<=approxHeadIndex + searchRadius; offset+=step){
    const candidate=wrapSampleIndex(Math.round(offset), raw.length)
    const s=scoreBeatAlignment(profiles, candidate, beatSamples, beatsToCheck)
    if(s>bestScore){
      bestScore=s
      bestIdx=candidate
    }
  }
  if(!Number.isFinite(bestScore) || bestScore<=0){
    return quantizeHeadToBeat(approx, beatSamples, raw.length)
  }
  return bestIdx
}

function parsePromptTiming(promptText=''){
  if(typeof promptText!=='string' || !promptText.trim()) return {}
  const tempoMatch=promptText.match(/(\d+(?:\.\d+)?)\s*BPM/i)
  const barsMatch=promptText.match(/(\d+(?:\.\d+)?)\s*(?:bars|bar\s*loop|bar-loop|bar\s*length|bar\s*phrase|bar\s*sequence)/i)
    || promptText.match(/(\d+(?:\.\d+)?)\s*-\s*bar/i)
  const parsed={}
  if(tempoMatch) parsed.tempo=Number(tempoMatch[1])
  if(barsMatch) parsed.bars=Number(barsMatch[1])
  return parsed
}

function createLoopIntent(meta={}){
  if(meta && meta.__isLoopIntent) return { ...meta }
  const parsed=parsePromptTiming(meta.promptText || '')
  const tempo=clampTempo(isFinite(parsed.tempo)?parsed.tempo:meta.tempo)
  const promptBars=normalizeBarsValue(isFinite(parsed.bars)?parsed.bars:meta.promptBars)
  const playbackCandidate = meta.playbackBars ?? getPlaybackBars(promptBars, DEFAULT_BARS)
  const playbackBars=normalizeBarsValue(playbackCandidate)
  const srCandidate = Number(meta.sampleRate)
  const frameCandidate = Number(meta.sourceFrames)
  const sourceFrames = Number.isFinite(frameCandidate) ? Math.max(1, Math.round(frameCandidate)) : null
  const sampleRate = Number.isFinite(srCandidate) ? srCandidate : null
  const sourceDurationSec = Number.isFinite(meta.sourceDurationSec)
    ? meta.sourceDurationSec
    : (sourceFrames && sampleRate ? sourceFrames / sampleRate : null)
  return {
    tempo,
    promptBars,
    playbackBars,
    promptText: meta.promptText || '',
    parsedFromPrompt: Boolean(parsed.tempo || parsed.bars),
    sampleRate,
    sourceFrames,
    sourceDurationSec,
    __isLoopIntent: true
  }
}

function setStemLoopIntent(st, meta={}){
  const intent=createLoopIntent(meta)
  if(st) stemLoopIntent[st]=intent
  return intent
}

function getStemLoopIntent(st, fallbackMeta={}){
  if(st && stemLoopIntent[st]) return stemLoopIntent[st]
  return createLoopIntent(fallbackMeta)
}

function copyCircularRange(raw, startSample, desiredLength){
  if(!raw || !isFinite(raw.length) || raw.length<=0) return null
  const total=Math.max(1, Math.round(desiredLength || raw.length))
  const sr=raw.sampleRate||44100
  const channels=raw.numberOfChannels||1
  const out=new AudioBuffer({ length: total, numberOfChannels: channels, sampleRate: sr })
  const start=wrapSampleIndex(Math.round(startSample||0), raw.length)
  for(let c=0;c<channels;c++){
    const src=raw.getChannelData(c)
    const dst=out.getChannelData(c)
    let read=start
    let write=0
    let remaining=total
    while(remaining>0){
      const available=Math.min(remaining, raw.length-read)
      if(available<=0){
        read=0
        continue
      }
      dst.set(src.subarray(read, read+available), write)
      write+=available
      remaining-=available
      read+=available
      if(read>=raw.length) read=0
    }
  }
  return out
}

function buildAlignedLoopFromIntent(raw, meta, approxHeadIndex=0, options={}){
  if(!raw || !isFinite(raw.length) || raw.length<=0) return null
  const intent = meta && meta.__isLoopIntent ? { ...meta } : createLoopIntent(meta || {})
  const tempo=intent.tempo
  const promptBars=intent.promptBars
  const playbackBars=intent.playbackBars
  const strategy=options.strategy || getStemAlignmentStrategy(options.stem)
  const head=alignHeadToBeatGrid(raw, tempo, promptBars, approxHeadIndex, { strategy })
  const refinedHead=refineLoopHead(raw, head, { strategy, tempo, promptBars })
  const sr=raw.sampleRate || audioContext?.sampleRate || 44100
  const playbackTarget=computeTargetFrames(sr, tempo, playbackBars)
  const promptTarget=computeTargetFrames(sr, tempo, promptBars)
  const intentSourceFrames = intent.sampleRate && intent.sampleRate === sr && Number.isFinite(intent.sourceFrames)
    ? Math.max(1, Math.round(intent.sourceFrames))
    : null
  const expectedLength = intentSourceFrames || promptTarget || raw.length
  const promptLength = Math.min(raw.length, expectedLength)
  const copyLength=Math.max(playbackTarget, promptLength)
  const normalizedRaw=copyCircularRange(raw, refinedHead, copyLength)
  if(!normalizedRaw) return null
  const playbackLoop=buildLoopBufferFromRawStrict(normalizedRaw, tempo, playbackBars, 0)
  const updatedIntent = {
    ...intent,
    sampleRate: normalizedRaw.sampleRate,
    sourceFrames: normalizedRaw.length,
    sourceDurationSec: normalizedRaw.duration
  }
  return { normalizedRaw, loop: playbackLoop, detectedHead: refinedHead, intent: updatedIntent }
}

function ensureTakeLoopReady(st, take){
  if(!take || !take.raw) return null
  const fallbackTempo = take.tempo ?? stemControlValues.master?.tempo ?? DEFAULT_TEMPO
  const fallbackBars  = take.bars  ?? stemControlValues.master?.bars  ?? DEFAULT_BARS
  const approxHead = typeof take.detectedHeadIndex==='number'
    ? take.detectedHeadIndex
    : (typeof take.headIndex==='number' ? take.headIndex : 0)
  const baseIntent = take.loopIntent && take.loopIntent.__isLoopIntent
    ? take.loopIntent
    : getStemLoopIntent(st, {
        tempo: fallbackTempo,
        promptBars: fallbackBars,
        playbackBars: getPlaybackBars(fallbackBars, DEFAULT_BARS),
        promptText: take.prompt || '',
        sampleRate: take.raw?.sampleRate,
        sourceFrames: take.raw?.length,
        sourceDurationSec: take.raw?.duration
      })
  if(take.isHeadNormalized && baseIntent){
    const playbackLoop=buildLoopBufferFromRawStrict(take.raw, baseIntent.tempo, baseIntent.playbackBars, take.headIndex || 0)
    return { loop: playbackLoop, intent: baseIntent, detectedHead: take.detectedHeadIndex ?? approxHead }
  }
  const aligned=buildAlignedLoopFromIntent(take.raw, baseIntent, approxHead, { stem: st, strategy: getStemAlignmentStrategy(st) })
  if(!aligned) return null
  take.raw=aligned.normalizedRaw
  take.headIndex=0
  take.detectedHeadIndex=aligned.detectedHead
  take.loopIntent=aligned.intent
  take.isHeadNormalized=true
  return aligned
}

function buildLoopBufferFromRawStrict(raw, bpm, bars, headIndex){
  removeDcOffset(raw)
  const sr=raw.sampleRate
  const target=computeTargetFrames(sr,bpm,bars)
  const ch=raw.numberOfChannels
  const out=new AudioBuffer({ length: target, numberOfChannels: ch, sampleRate: sr })
  const start=wrapSampleIndex(Math.round(headIndex||0), raw.length)
  for(let c=0;c<ch;c++){
    const src=raw.getChannelData(c)
    const dst=out.getChannelData(c)
    let writeIdx=0
    let readIdx=start
    while(writeIdx<target){
      const remaining=target-writeIdx
      const canCopy=Math.min(remaining, raw.length-readIdx)
      dst.set(src.subarray(readIdx, readIdx+canCopy), writeIdx)
      writeIdx+=canCopy
      readIdx=(readIdx+canCopy)%raw.length
    }
  }
  applyEdgeRamps(out, EDGE_RAMP_MS)
  applySeamCrossfade(out, LOOP_XFADE_MS)
  return out
}

/* =========================================================
   Validators (unchanged)
   ========================================================= */
function countOnsets(buf, refractorySec=0.08, relThresh=0.35){
  const sr=buf.sampleRate
  const x=buf.getChannelData(0)
  let sum=0; for(let i=0;i<x.length;i+=512){ const v=x[i]; sum+=v*v }
  const rms=Math.sqrt(sum/Math.max(1, Math.floor(x.length/512)))
  const thr=Math.max(0.02, rms*relThresh)
  const refr=Math.max(1, Math.round(refractorySec*sr))
  let peaks=0,i=0
  while(i<x.length){ if(Math.abs(x[i])>=thr){ peaks++; i+=refr } else i++ }
  return peaks
}
function validateSnare(buf, bpm, bars, tolMs=40){
  const sr=buf.sampleRate
  const barSec=4*(60/bpm)
  const beatSec=60/bpm
  const tol=Math.round((tolMs/1000)*sr)
  const x=buf.getChannelData(0)
  function hasPeakNear(sampleIdx, win=tol, mult=3.0){
    const a=Math.max(0, sampleIdx-win), b=Math.min(x.length-1, sampleIdx+win)
    let s=0,n=0; for(let i=a;i<=b;i+=4){ const v=x[i]; s+=v*v; n++ }
    const rms=Math.sqrt(s/Math.max(1,n))
    const thr=Math.max(0.02, rms*mult)
    for(let i=a;i<=b;i+=2) if(Math.abs(x[i])>=thr) return true
    return false
  }
  for(let bar=0; bar<bars; bar++){
    const barStart=Math.round(bar*barSec*sr)
    const beat2=barStart+Math.round(1*beatSec*sr)
    const beat4=barStart+Math.round(3*beatSec*sr)
    if(!hasPeakNear(beat2) || !hasPeakNear(beat4)) return false
  }
  return true
}
function validateHihat(buf, bpm, bars){
  const expected=bars*16
  const found=countOnsets(buf, 0.07, 0.35)
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
    indicator.style.setProperty('--indicator-phase', String(phase))
    indicator.style.opacity = '1'
  })
}
function updatePlayButtonIcon() {
  const btn = document.getElementById('playBtn')
  if (!btn) return
  const icon = btn.querySelector('[data-lucide]')
  if (icon) { icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play'); window.lucide?.createIcons() }
  else { btn.textContent = isPlaying ? 'Pause' : 'Play' }
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
  // Invalidate cached WAV since loop has been adjusted
  invalidateStemCache(st)

  // Extract PCM from the adjusted AudioBuffer for drag-and-drop
  try {
    clearStemPCM(st) // Clear any existing PCM data before storing new
    const pcmData = extractPCMFromAudioBuffer(out)
    storeStemPCM(st, pcmData, out.sampleRate, out.numberOfChannels, `pcm_${out.sampleRate}`)
    console.log(`[Endpoint] Extracted PCM for ${st}: ${(pcmData.byteLength / 1024).toFixed(1)}KB`)
    scheduleAutoDownloadForStem(st)
  } catch (pcmErr) {
    console.warn(`[Endpoint] Failed to extract PCM for ${st}:`, pcmErr.message)
  }
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
    const bars = getPlaybackBars(stemControlValues.master?.bars || DEFAULT_BARS, DEFAULT_BARS)
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
  const separateBtn = document.getElementById('editSeparateBtn')

  if (saveBtn) {
    saveBtn.onclick = () => closeWaveformEditModal(true)
  }
  if (discardBtn) {
    discardBtn.onclick = () => closeWaveformEditModal(false)
  }
  if (separateBtn) {
    separateBtn.onclick = async () => {
      await separateCurrentStem(st)
    }
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

/**
 * Show the clean stem confirmation modal for a specific stem
 * @param {string} st The stem identifier
 */
function showCleanStemModal(st) {
  console.log(`[Clean] showCleanStemModal called for stem: ${st}`)

  if (!st) {
    console.warn('[Clean] No stem provided to showCleanStemModal')
    return
  }

  const modal = document.getElementById('cleanStemModal')
  if (!modal) {
    console.error('[Clean] cleanStemModal element not found in DOM!')
    return
  }

  // Store the stem being cleaned
  currentCleanStem = st
  console.log(`[Clean] Set currentCleanStem to: ${currentCleanStem}`)

  // Update the stem name in the modal
  const stemNameSpan = document.getElementById('cleanStemName')
  if (stemNameSpan) {
    const cfg = stemConfigs[st]
    stemNameSpan.textContent = cfg?.label || st
    console.log(`[Clean] Updated modal with stem name: ${cfg?.label || st}`)
  }

  // Show modal with animation
  modal.classList.remove('hidden')
  setTimeout(() => {
    modal.classList.remove('opacity-0')
    modal.querySelector('.transform').classList.remove('scale-95')
  }, 10)

  // Prevent background scrolling
  document.body.style.overflow = 'hidden'
  console.log('[Clean] Modal displayed')
}

/**
 * Hide the clean stem confirmation modal
 */
function hideCleanStemModal() {
  const modal = document.getElementById('cleanStemModal')
  if (!modal) return

  // Start fade out
  modal.classList.add('opacity-0')
  modal.querySelector('.transform')?.classList.add('scale-95')

  // After animation, hide completely
  setTimeout(() => {
    modal.classList.add('hidden')
    currentCleanStem = null
  }, 300)

  // Restore scrolling
  document.body.style.overflow = ''
}

/**
 * Separate the current stem's audio into individual components using
 * ElevenLabs stem separation API. The separated stem that matches the
 * instrument type will automatically be selected and loaded.
 *
 * @param {string} st The stem identifier (kick, bass, pad, etc.)
 */
async function separateCurrentStem(st) {
  if (!st) return

  // Get the current active take
  const activeIdx = stemActiveIndex[st]
  if (activeIdx == null || activeIdx < 0 || !stemHistory[st] || !stemHistory[st][activeIdx]) {
    console.warn('No active take to separate for stem:', st)
    return
  }

  const currentTake = stemHistory[st][activeIdx]
  if (!currentTake || !currentTake.raw) {
    console.warn('Current take has no audio data:', st)
    return
  }

  // Preserve current endpoint factor (Gemini loop fix state) to reapply after separation
  const preservedEndpointFactor = endpointFactors[st] || 1
  console.log(`[stem-separation] Preserving endpoint factor for ${st}:`, preservedEndpointFactor)

  // Update UI to show processing state
  const separateBtn = document.getElementById('editSeparateBtn')
  const separateLabel = document.getElementById('editSeparateLabel')
  const separateSpinner = document.getElementById('editSeparateSpinner')
  const separateHint = document.getElementById('editSeparateHint')

  // Also update the clean button if it exists
  const cleanBtn = document.querySelector(`[data-action="clean-stem"][data-stem="${st}"]`)
  const cleanLabel = document.querySelector(`[data-clean-label="${st}"]`)
  if (cleanBtn) cleanBtn.disabled = true
  if (cleanLabel) cleanLabel.textContent = 'Cleaning...'

  if (separateBtn) separateBtn.disabled = true
  if (separateLabel) separateLabel.textContent = 'Separating...'
  if (separateSpinner) separateSpinner.classList.remove('hidden')
  if (separateHint) separateHint.textContent = 'Processing audio (this may take 10-30 seconds)...'

  try {
    console.log('[stem-separation] Starting separation for:', st);

    // Validate current take has valid audio data
    const rawBuffer = currentTake.raw
    if (!rawBuffer || !rawBuffer.length || rawBuffer.length === 0) {
      throw new Error('No valid audio data in current take. Try regenerating the stem.');
    }

    const sampleRate = audioContext.sampleRate
    if (!sampleRate || sampleRate < 8000 || sampleRate > 96000) {
      throw new Error(`Invalid sample rate: ${sampleRate}. Expected 8000-96000 Hz.`);
    }

    console.log('[stem-separation] Converting audio to WAV - channels:', rawBuffer.numberOfChannels, 'length:', rawBuffer.length, 'sampleRate:', sampleRate, 'duration:', rawBuffer.duration, 's');

    // Validate audio duration
    if (rawBuffer.duration > 300) {
      throw new Error('Audio too long. Maximum duration is 5 minutes. Try using fewer bars.');
    }

    // Create a WAV file from the audio buffer
    let wavBuffer;
    try {
      wavBuffer = audioBufferToWav(rawBuffer, sampleRate);
    } catch (wavError) {
      console.error('[stem-separation] WAV conversion failed:', wavError);
      throw new Error('Failed to convert audio to WAV format. Try regenerating the stem.');
    }

    const wavSizeMB = (wavBuffer.byteLength / 1024 / 1024).toFixed(2);
    console.log('[stem-separation] WAV buffer size:', wavBuffer.byteLength, 'bytes', `(${wavSizeMB} MB)`);

    // Validate WAV buffer is not empty
    if (wavBuffer.byteLength === 0) {
      throw new Error('Generated WAV file is empty. Try regenerating the stem.');
    }

    // Validate payload size (ElevenLabs has limits, typically around 25MB)
    const MAX_PAYLOAD_SIZE = 25 * 1024 * 1024;
    if (wavBuffer.byteLength > MAX_PAYLOAD_SIZE) {
      throw new Error(`Audio file too large (${wavSizeMB}MB). Maximum size is 25MB. Try using fewer bars or shorter duration.`);
    }

    // Convert to base64 for transmission with validation
    let base64Audio;
    try {
      base64Audio = arrayBufferToBase64(wavBuffer);
      if (!base64Audio || base64Audio.length === 0) {
        throw new Error('Base64 encoding produced empty result');
      }
    } catch (b64Error) {
      console.error('[stem-separation] Base64 encoding failed:', b64Error);
      throw new Error('Failed to encode audio data. Try regenerating the stem.');
    }

    const base64SizeMB = (base64Audio.length / 1024 / 1024).toFixed(2);
    console.log('[stem-separation] Base64 audio length:', base64Audio.length, 'characters', `(${base64SizeMB} MB)`);

    // Final size check on base64 data
    if (base64Audio.length > 35 * 1024 * 1024) {
      throw new Error(`Encoded audio too large (${base64SizeMB}MB). Try using fewer bars.`);
    }

    // Call the separation edge function with retry logic
    console.log('[stem-separation] Calling edge function with stemType:', st);

    let retryCount = 0
    const { data, error } = await retryEdgeFunctionCall(
      () => supabase.functions.invoke('separate-stems', {
        body: {
          audioData: base64Audio,
          stemType: st,
          outputFormat: 'mp3_44100_128'
        }
      }),
      {
        functionName: 'separate-stems',
        maxAttempts: 3,
        initialDelay: 2000,
        maxDelay: 8000,
        onRetry: (attempt, maxAttempts, delay) => {
          retryCount = attempt
          if (separateHint) {
            separateHint.textContent = `Connection issue, retrying (${attempt}/${maxAttempts})...`
          }
        }
      }
    )

    console.log('[stem-separation] Edge function response - data:', !!data, 'error:', !!error, 'retries:', retryCount);

    // Validate error response
    if (error) {
      console.error('[stem-separation] Edge function error:', error);
      console.error('[stem-separation] Error type:', typeof error);
      console.error('[stem-separation] Error keys:', Object.keys(error || {}));

      // Try to extract more detailed error information
      let errorMessage = error.message || 'Stem separation failed';

      // Check if the error contains helpful details
      if (error.context) {
        console.error('[stem-separation] Error context:', error.context);
        if (error.context.error) {
          errorMessage = error.context.error;
        }
        if (error.context.hint) {
          errorMessage += ' - ' + error.context.hint;
        }
      }

      throw new Error(errorMessage);
    }

    // Comprehensive response validation
    if (!data) {
      console.error('[stem-separation] No data received from edge function');
      throw new Error('No response data received from separation API');
    }

    console.log('[stem-separation] Response data keys:', Object.keys(data));
    console.log('[stem-separation] Response success:', data.success);
    console.log('[stem-separation] Response has audioData:', !!data.audioData);

    // Check for API error in response
    if (data.error) {
      console.error('[stem-separation] API returned error:', data.error);
      const errorMsg = data.error + (data.hint ? ' - ' + data.hint : '');
      throw new Error(errorMsg);
    }

    // Validate success flag
    if (!data.success) {
      console.error('[stem-separation] API returned success=false');
      throw new Error('Separation API returned unsuccessful status. ' + (data.hint || 'Please try again.'));
    }

    // Validate audio data presence
    if (!data.audioData) {
      console.error('[stem-separation] No audioData in response');
      throw new Error('No audio data in separation API response. The service may be unavailable.');
    }

    // Validate audio data is a string
    if (typeof data.audioData !== 'string') {
      console.error('[stem-separation] audioData is not a string:', typeof data.audioData);
      throw new Error('Invalid audio data format in response');
    }

    // Validate audio data is not empty
    if (data.audioData.length === 0) {
      console.error('[stem-separation] audioData is empty');
      throw new Error('Received empty audio data from separation API');
    }

    console.log('[stem-separation] Received separated audio - stemType:', data.stemType, 'audioData length:', data.audioData.length);

    // Decode the separated audio data with validation
    console.log('[stem-separation] Decoding base64 audio data...');
    let separatedAudioData;
    try {
      separatedAudioData = base64ToArrayBuffer(data.audioData);
      if (!separatedAudioData || separatedAudioData.byteLength === 0) {
        throw new Error('Decoded audio buffer is empty');
      }
      console.log('[stem-separation] Decoded array buffer size:', separatedAudioData.byteLength, 'bytes');
    } catch (decodeError) {
      console.error('[stem-separation] Base64 decode failed:', decodeError);
      throw new Error('Failed to decode separated audio data. Response may be corrupted.');
    }

    // Validate decoded size is reasonable
    if (separatedAudioData.byteLength < 44) {
      throw new Error('Decoded audio is too small to be valid. Response may be corrupted.');
    }

    // Decode the audio file using Web Audio API
    console.log('[stem-separation] Decoding audio with Web Audio API...');
    let decodedBuffer;
    try {
      decodedBuffer = await audioContext.decodeAudioData(separatedAudioData);
      if (!decodedBuffer) {
        throw new Error('Audio context returned null buffer');
      }
      console.log('[stem-separation] Audio decoded successfully - duration:', decodedBuffer.duration, 'seconds, channels:', decodedBuffer.numberOfChannels, 'sampleRate:', decodedBuffer.sampleRate);
    } catch (audioDecodeError) {
      console.error('[stem-separation] Web Audio API decode failed:', audioDecodeError);
      throw new Error('Failed to decode separated audio. The file may be corrupted or in an unsupported format.');
    }

    // Validate decoded buffer properties
    if (decodedBuffer.length === 0 || decodedBuffer.duration === 0) {
      throw new Error('Decoded audio has zero duration. Separation may have failed.');
    }

    if (decodedBuffer.numberOfChannels === 0) {
      throw new Error('Decoded audio has no channels. Separation may have failed.');
    }

    // Add the separated stem as a new take in the history
    const master = stemControlValues.master || {}
    const tempo = master.tempo ?? DEFAULT_TEMPO
    const bars = master.bars ?? DEFAULT_BARS
    const playbackBars = getPlaybackBars(bars, DEFAULT_BARS)

    const parentIntent = currentTake.loopIntent && currentTake.loopIntent.__isLoopIntent
      ? currentTake.loopIntent
      : getStemLoopIntent(st, {
          tempo,
          promptBars: bars,
          playbackBars,
          promptText: currentTake.prompt || '',
          sampleRate: decodedBuffer.sampleRate,
          sourceFrames: decodedBuffer.length,
          sourceDurationSec: decodedBuffer.duration
        })

    const aligned = buildAlignedLoopFromIntent(decodedBuffer, parentIntent, 0, { stem: st, strategy: getStemAlignmentStrategy(st) })
    if (!aligned) {
      console.error('[stem-separation] Failed to build loop buffer');
      throw new Error('Failed to build loop from separated audio - audio may be too short or incompatible');
    }

    console.log('[stem-separation] Loop buffer created - duration:', aligned.loop.duration, 'seconds');

    // Create a new history entry
    const newEntry = {
      raw: aligned.normalizedRaw,
      loop: aligned.loop,
      prompt: `Separated ${data.stemType} stem from ${st}`,
      validationTier: 'separated',
      timestamp: Date.now(),
      isSeparated: true,
      separatedFrom: data.requestedInstrument,
      originalStemType: data.stemType,
      headIndex: 0,
      detectedHeadIndex: aligned.detectedHead,
      tempo,
      bars,
      loopIntent: aligned.intent,
      isHeadNormalized: true
    }

    // Add to history and select it
    if (!stemHistory[st]) stemHistory[st] = []
    stemHistory[st].push(newEntry)
    if (stemHistory[st].length > HISTORY_LIMIT) stemHistory[st].shift()

    const newIndex = stemHistory[st].length - 1
    stemActiveIndex[st] = newIndex

    // Load the new separated stem
    stemRaw[st] = aligned.normalizedRaw
    stemLoop[st] = aligned.loop
    setStemLoopIntent(st, aligned.intent)

    // Store loop duration
    if (aligned.loop) {
      stemLoopDuration[st] = aligned.loop.duration
    }

    // Invalidate cached WAV since we have new separated audio
    invalidateStemCache(st)

    // Extract PCM from the separated audio for drag-and-drop
    if (aligned.loop) {
      try {
        clearStemPCM(st) // Clear any existing PCM data before storing new
        const pcmData = extractPCMFromAudioBuffer(aligned.loop)
        storeStemPCM(st, pcmData, aligned.loop.sampleRate, aligned.loop.numberOfChannels, `pcm_${aligned.loop.sampleRate}`)
        console.log(`[Separation] Extracted PCM for ${st}: ${(pcmData.byteLength / 1024).toFixed(1)}KB`)
        scheduleAutoDownloadForStem(st)
      } catch (pcmErr) {
        console.warn(`[Separation] Failed to extract PCM for ${st}:`, pcmErr.message)
      }
    }

    // Update waveform visualization
    drawWaveform(st)

    // Update history indicators
    updateHistoryIndicator(st)
    updateCardNumberColor(st)

    // Update the edit modal canvas with the new waveform
      drawEditWaveform(st, aligned.loop)

    // Reapply the preserved endpoint factor (Gemini loop fix) to maintain loop quality
    if (preservedEndpointFactor !== 1) {
      console.log(`[stem-separation] Reapplying endpoint factor ${preservedEndpointFactor} to maintain loop quality`)
      endpointFactors[st] = preservedEndpointFactor
      await adjustEndpoint(st, preservedEndpointFactor)
    }

    // Show success message
    if (separateHint) {
      separateHint.textContent = `Successfully extracted ${data.stemType} stem!`
      separateHint.classList.remove('text-white/50')
      separateHint.classList.add('text-green-400')

      // Reset hint after 3 seconds
      setTimeout(() => {
        if (separateHint) {
          separateHint.textContent = 'Automatically extract and select this instrument from the mix'
          separateHint.classList.remove('text-green-400')
          separateHint.classList.add('text-white/50')
        }
      }, 3000)
    }

  } catch (err) {
    console.error('[stem-separation] Error during separation:', err);
    console.error('[stem-separation] Error stack:', err.stack);
    console.error('[stem-separation] Error name:', err.name);
    console.error('[stem-separation] Error context:', err.context);

    // Determine user-friendly error message with specific diagnostics
    let userMessage = err.message || 'An unknown error occurred';
    let errorCategory = 'unknown';

    // Check for specific error patterns and categorize
    const errMsg = err.message?.toLowerCase() || '';

    if (errMsg.includes('api key') || errMsg.includes('not configured') || errMsg.includes('authentication')) {
      errorCategory = 'auth';
      if (errMsg.includes('not configured')) {
        userMessage = 'API key not configured. Contact support to enable stem separation.';
      } else if (errMsg.includes('invalid') || errMsg.includes('401')) {
        userMessage = 'Authentication failed. Invalid API key.';
      } else {
        userMessage = 'Authentication error. Please contact support.';
      }
    } else if (errMsg.includes('invalid audio') || errMsg.includes('422') || errMsg.includes('format')) {
      errorCategory = 'format';
      userMessage = 'Invalid audio format. Try regenerating this stem.';
    } else if (errMsg.includes('too large') || errMsg.includes('413') || errMsg.includes('file size')) {
      errorCategory = 'size';
      userMessage = 'Audio too large. Try fewer bars or shorter duration.';
    } else if (errMsg.includes('rate limit') || errMsg.includes('429')) {
      errorCategory = 'rate_limit';
      userMessage = 'Rate limit reached. Please wait a moment and try again.';
    } else if (errMsg.includes('timeout') || errMsg.includes('504')) {
      errorCategory = 'timeout';
      userMessage = 'Processing timed out. Try a shorter audio clip.';
    } else if (errMsg.includes('failed to send') || errMsg.includes('functionsfetcherror') || errMsg.includes('connection')) {
      errorCategory = 'connection';
      userMessage = 'Connection failed. Check internet and try again.';
    } else if (errMsg.includes('network') || errMsg.includes('networkerror')) {
      errorCategory = 'network';
      userMessage = 'Network error. Check your connection.';
    } else if (errMsg.includes('500') || errMsg.includes('503') || errMsg.includes('unavailable') || errMsg.includes('server error')) {
      errorCategory = 'server';
      userMessage = 'Service temporarily unavailable. Try again in a moment.';
    } else if (errMsg.includes('zip') || errMsg.includes('parse') || errMsg.includes('extract')) {
      errorCategory = 'parse';
      userMessage = 'Failed to process separation result. Try again or contact support.';
    } else if (errMsg.includes('decode') || errMsg.includes('audio') || errMsg.includes('buffer')) {
      errorCategory = 'decode';
      userMessage = 'Audio processing failed. Try regenerating the stem.';
    } else if (errMsg.includes('no response') || errMsg.includes('invalid response')) {
      errorCategory = 'response';
      userMessage = 'Invalid server response. Try again.';
    } else if (isRetryableError(err)) {
      errorCategory = 'retry_exhausted';
      userMessage = 'Connection issue persisted after retries. Try again later.';
    }

    // Log the categorized error for debugging
    console.error('[stem-separation] Error category:', errorCategory);
    console.error('[stem-separation] User message:', userMessage);

    // Show error message
    if (separateHint) {
      separateHint.textContent = `Error: ${userMessage}`
      separateHint.classList.remove('text-white/50')
      separateHint.classList.add('text-red-400')

      // Reset hint after 8 seconds for better readability
      setTimeout(() => {
        if (separateHint) {
          separateHint.textContent = 'Automatically extract and select this instrument from the mix'
          separateHint.classList.remove('text-red-400')
          separateHint.classList.add('text-white/50')
        }
      }, 8000)
    }
  } finally {
    // Reset button states
    if (separateBtn) separateBtn.disabled = false
    if (separateLabel) separateLabel.textContent = 'Separate Stem'
    if (separateSpinner) separateSpinner.classList.add('hidden')

    // Reset clean button state
    const cleanBtn = document.querySelector(`[data-action="clean-stem"][data-stem="${st}"]`)
    const cleanLabel = document.querySelector(`[data-clean-label="${st}"]`)
    if (cleanBtn) cleanBtn.disabled = false
    if (cleanLabel) cleanLabel.textContent = 'Clean'
  }
}

/**
 * Convert an AudioBuffer to a WAV file ArrayBuffer
 */
function audioBufferToWav(buffer, sampleRate) {
  const numChannels = buffer.numberOfChannels
  const length = buffer.length * numChannels * 2
  const arrayBuffer = new ArrayBuffer(44 + length)
  const view = new DataView(arrayBuffer)

  // WAV header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + length, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM format
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * 2, true)
  view.setUint16(32, numChannels * 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, length, true)

  // Write audio data
  const offset = 44
  const channels = []
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i))
  }

  let pos = 0
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]))
      view.setInt16(offset + pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
      pos += 2
    }
  }

  return arrayBuffer
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

/* =========================================================
   Transport
   ========================================================= */
function startTransport() {
  if (isPlaying) return
  isPlaying = true
  updatePlayButtonIcon()

  // We no longer compute a global loop duration.  Each stem uses its own
  // buffer length for looping.  Record the start time of this transport so
  // that per‑stem phases can be computed relative to a common origin.
  const t0 = audioContext.currentTime + START_ENV_MS/1000
  loopStartTime = t0

  Object.keys(stemConfigs).forEach(st => {
    const indicator = document.querySelector(`[data-stem-indicator="${st}"]`)
    if (indicator) {
      indicator.style.setProperty('--indicator-phase', '0')
      indicator.style.opacity = '1'
    }
  })

  Object.keys(stemLoop).forEach(st => {
    const buf = stemLoop[st]
    if (!buf) return
    const nodes = createStemNodes(st, buf)
    stemNodes[st] = nodes
    nodes.env.gain.setValueAtTime(0, t0)
    nodes.env.gain.linearRampToValueAtTime(1, t0 + START_ENV_MS/1000)
    const vol = (stemControlValues[st]?.volume ?? 80)/100
    const muted = stemMuteStates[st]
    const soloedOther = (soloedStem && soloedStem !== st)
    nodes.gain.gain.setValueAtTime((muted || soloedOther) ? 0 : vol, t0)
    nodes.source.start(t0)
  })

  if (transportTicker) cancelAnimationFrame(transportTicker)
  transportTicker = requestAnimationFrame(transportTick)

  updateAllMixerGlows()
}
function stopTransport() {
  if (!isPlaying) return
  isPlaying = false
  updatePlayButtonIcon()

  const stopAt = audioContext.currentTime + 0.005
  Object.keys(stemConfigs).forEach(st => {
    const indicator = document.querySelector(`[data-stem-indicator="${st}"]`)
    if (indicator) {
      indicator.style.setProperty('--indicator-phase', '0')
      indicator.style.opacity = '0'
    }
  })

  Object.values(stemNodes).forEach(n => {
    if (!n?.source) return
    n.env.gain.cancelScheduledValues(audioContext.currentTime)
    n.env.gain.setValueAtTime(n.env.gain.value, audioContext.currentTime)
    n.env.gain.linearRampToValueAtTime(0, stopAt)
    try { n.source.stop(stopAt) } catch {}
  })
  Object.keys(stemNodes).forEach(k => delete stemNodes[k])
  if (transportTicker) cancelAnimationFrame(transportTicker)
  transportTicker = null

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
  } catch {}
  if (prev?.source) {
    try { prev.source.stop(startAt) } catch {}
  }
  updateMixerGlow(st)
}

/* =========================================================
   Eleven Music compose (unchanged core)
   ========================================================= */
const genControllers = new Map()
function getNewStemController(st){ const prev=genControllers.get(st); if(prev && !prev.signal.aborted) prev.abort(new DOMException('Superseded','AbortError')); const ctrl=new AbortController(); genControllers.set(st, ctrl); return ctrl }
function buildCompositionPlan({ tempo, bars }, descriptor){ const ms=Math.round(bars*4*(60/tempo)*1000); return { positive_global_styles:["techno","instrumental","loop"], negative_global_styles:["vocals","fade-in","fade-out","free-time"], sections:[{ section_name:"Loop", positive_local_styles:[descriptor||"modern techno"], negative_local_styles:["rubato","modulation","improv cadenza"], duration_ms: ms, lines: [] }] } }
async function composeOnce(payload, signal, statusEl = null){
  const tryPayload = (fmt) => ({ ...payload, output_format: fmt, model_id: 'music_v1', respect_sections_durations: true })
  let lastErr = null
  let retryCount = 0

  for (const fmt of [PRIMARY_OUTPUT_FORMAT, FALLBACK_OUTPUT_FORMAT]) {
    try {
      console.log(`[composeOnce] Attempting with format: ${fmt}`)

      const { data, error } = await retryEdgeFunctionCall(
        () => supabase.functions.invoke('eleven-music-compose', {
          body: tryPayload(fmt)
        }),
        {
          functionName: 'eleven-music-compose',
          maxAttempts: 3,
          initialDelay: 2000,
          maxDelay: 8000,
          onRetry: (attempt, maxAttempts, delay) => {
            retryCount = attempt
            console.log(`[composeOnce] Retry ${attempt}/${maxAttempts} for ${fmt} after ${delay}ms`)
            if (statusEl) {
              statusEl.textContent = `Connection issue, retrying (${attempt}/${maxAttempts})...`
            }
          }
        }
      )

      console.log(`[composeOnce] Response:`, { hasData: !!data, hasError: !!error, dataType: typeof data, retries: retryCount })

      if (error) {
        const errMsg = error.message || error.toString()
        console.error(`[composeOnce] Supabase invoke error with ${fmt}:`, errMsg)

        if (fmt === PRIMARY_OUTPUT_FORMAT && /only allowed for Pro|PCM|plan|tier/i.test(errMsg)) {
          lastErr = error
          continue
        }
        throw error
      }

      if (!data) {
        throw new Error('No data received from eleven-music-compose function')
      }

      if (data instanceof ArrayBuffer) {
        console.log(`[composeOnce] Success with ${fmt}, received ArrayBuffer: ${data.byteLength} bytes`)
        return data
      } else if (data instanceof Blob) {
        console.log(`[composeOnce] Success with ${fmt}, received Blob: ${data.size} bytes`)
        return await data.arrayBuffer()
      } else if (typeof data === 'object' && data.error) {
        const errMsg = data.error + (data.hint ? ` - ${data.hint}` : '')
        console.error(`[composeOnce] API error with ${fmt}:`, errMsg)
        if (fmt === PRIMARY_OUTPUT_FORMAT && /only allowed for Pro|PCM|plan|tier/i.test(errMsg)) {
          lastErr = new Error(errMsg)
          continue
        }
        throw new Error(errMsg)
      } else {
        console.error(`[composeOnce] Unexpected response type:`, typeof data, data?.constructor?.name)
        throw new Error(`Unexpected response type from eleven-music-compose: ${typeof data}`)
      }
    } catch (e) {
      console.error(`[composeOnce] Error with format ${fmt}:`, e)
      lastErr = e

      if (fmt !== PRIMARY_OUTPUT_FORMAT) {
        throw e
      }
    }
  }

  throw lastErr || new Error('composeOnce failed with all formats')
}
async function composeWithRetries(st, tempo, bars, signal, statusEl){
  const beats=bars*4
  const seconds=beats*(60/tempo)
  let music_length_ms=Math.round(seconds*1000)+GEN_TAIL_PAD_MS
  music_length_ms=Math.max(10000, Math.min(300000, music_length_ms))
  const master=getMasterForPrompt()
  const controls=stemControlValues[st]||{}
  for(let tier=0;tier<3;tier++){
    const prompt=(st==='hihat')?buildHihatPrompt(controls, master, tier):buildSnarePrompt(controls, master, tier)
    if (statusEl) statusEl.textContent=`Creating… (${st}, tier ${tier+1}/3 @ 44.1k ${PRIMARY_OUTPUT_FORMAT})`
    const body=USE_COMPOSITION_PLAN?{ composition_plan: buildCompositionPlan(master, stemConfigs[st]?.basePrompt), prompt: null }:{ prompt, music_length_ms }
    const ab=await composeOnce(body, signal, statusEl)
    const buf=await audioContext.decodeAudioData(ab)
    const ok=(st==='hihat')?validateHihat(buf, tempo, bars):validateSnare(buf, tempo, bars)
    if(ok) return { buffer: buf, usedPrompt: prompt, tier }
  }
  const finalPrompt=(st==='hihat')?buildHihatPrompt(controls, master, 2):buildSnarePrompt(controls, master, 2)
  const body=USE_COMPOSITION_PLAN?{ composition_plan: buildCompositionPlan(master, stemConfigs[st]?.basePrompt), prompt: null }:{ prompt: finalPrompt, music_length_ms }
  const ab=await composeOnce(body, signal, statusEl)
  const buf=await audioContext.decodeAudioData(ab)
  return { buffer: buf, usedPrompt: finalPrompt, tier: 2, failedValidation: true }
}
async function generateStem(st) {
  await ensureAudioContext()
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
      if (icon) { icon.setAttribute('data-lucide', 'loader-2'); icon.classList.add('loading-spin'); window.lucide?.createIcons() }
    }
    if (card) card.classList.add('is-generating')
    if (statusEl) statusEl.textContent = `Creating… (Eleven Music v1)`

    const tempo = clampTempo(stemControlValues.master?.tempo ?? DEFAULT_TEMPO)
    const bars  = stemControlValues.master?.bars  ?? DEFAULT_BARS
    const playbackBars = getPlaybackBars(bars, DEFAULT_BARS)
    let loopIntent = null

    // Attempt to generate the stem via the Supabase edge function
    // `generate-techno-stem`.  This function builds the prompt, calls
    // the ElevenLabs API and trims the loop server-side.  On success
    // it returns a base64 encoded WAV along with prompt metadata.
    let audioBuffer, usedPrompt, tier = 0, validated = true, failedValidation = false
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
      // data should contain audio_b64, usedPrompt, tier, validated, format, sampleRate, channels
      const { audio_b64, usedPrompt: up, tier: tt, validated: val, format, sampleRate: sr, channels: ch } = data
      usedPrompt = up || ''
      tier = typeof tt === 'number' ? tt : 0
      validated = val !== false
      const receivedFormat = format || 'pcm_24000'
      const receivedSampleRate = sr || 24000
      const receivedChannels = ch || 2

      console.log(`[Gen] Received ${st}: ${receivedFormat} (${receivedSampleRate}Hz, ${receivedChannels}ch)`)

      // Decode the base64 audio string for playback
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
      loopIntent = setStemLoopIntent(st, {
        tempo,
        promptBars: bars,
        playbackBars,
        promptText: usedPrompt || '',
        sampleRate: audioBuffer.sampleRate,
        sourceFrames: audioBuffer.length,
        sourceDurationSec: audioBuffer.duration
      })
      const aligned = buildAlignedLoopFromIntent(audioBuffer, loopIntent, referenceHeadIndex, { stem: st, strategy: getStemAlignmentStrategy(st) })
      if (!aligned) throw new Error('Failed to align generated audio')
      referenceHeadIndex = aligned.detectedHead
      stemRaw[st]  = aligned.normalizedRaw
      stemLoop[st] = aligned.loop
      stemLoopDuration[st] = aligned.loop.duration
      endpointFactors[st] = 1
      failedValidation = !validated
      // Invalidate cached WAV since we have new audio
      invalidateStemCache(st)

      try {
        clearStemPCM(st)
        const pcmData = extractPCMFromAudioBuffer(aligned.loop)
        storeStemPCM(st, pcmData, aligned.loop.sampleRate, aligned.loop.numberOfChannels, `pcm_${aligned.loop.sampleRate}`)
        console.log(`[Gen] Extracted PCM from playback loop for ${st}: ${(pcmData.byteLength / 1024).toFixed(1)}KB`)
        scheduleAutoDownloadForStem(st)
      } catch (pcmErr) {
        console.warn(`[Gen] Failed to extract PCM from playback loop for ${st}:`, pcmErr.message)
      }
    } catch (supErr) {
      // Supabase call failed or returned error; fallback to local generation
      console.error('Supabase request failed', supErr)
      // Use the old generate logic: call Eleven Labs via the proxy function
      // (`composeOnce` and `composeWithRetries`) and build a strict loop locally.
      if (st === 'hihat' || st === 'perc') {
        const res = await composeWithRetries(st, tempo, bars, signal, statusEl)
        audioBuffer = res.buffer
        usedPrompt = res.usedPrompt
        tier = res.tier
        failedValidation = !!res.failedValidation
      } else {
        const prompt = buildStemPrompt(st).trim()
        const beats = bars * 4
        const seconds = beats * (60 / tempo)
        let music_length_ms = Math.round(seconds * 1000) + GEN_TAIL_PAD_MS
        music_length_ms = Math.max(10000, Math.min(300000, music_length_ms))
        const body = USE_COMPOSITION_PLAN
          ? { composition_plan: buildCompositionPlan(getMasterForPrompt(), stemConfigs[st]?.basePrompt), prompt: null }
          : { prompt, music_length_ms }
        const ab = await composeOnce(body, signal, statusEl)
        audioBuffer = await audioContext.decodeAudioData(ab)
        usedPrompt = prompt
        tier = 0
        failedValidation = false
      }
      // Determine head index and build a strict loop from the raw buffer
      referenceHeadIndex = detectHeadIndex(audioBuffer)
      referenceStemType = st
      loopIntent = setStemLoopIntent(st, {
        tempo,
        promptBars: bars,
        playbackBars,
        promptText: usedPrompt || '',
        sampleRate: audioBuffer.sampleRate,
        sourceFrames: audioBuffer.length,
        sourceDurationSec: audioBuffer.duration
      })
      const aligned = buildAlignedLoopFromIntent(audioBuffer, loopIntent, referenceHeadIndex, { stem: st, strategy: getStemAlignmentStrategy(st) })
      if (!aligned) throw new Error('Failed to align locally generated audio')
      referenceHeadIndex = aligned.detectedHead
      stemRaw[st]  = aligned.normalizedRaw
      stemLoop[st] = aligned.loop
      stemLoopDuration[st] = aligned.loop.duration
      endpointFactors[st] = 1
      // Invalidate cached WAV since we have new audio
      invalidateStemCache(st)

      // Extract PCM from AudioBuffer for drag-and-drop (fallback path)
      try {
        clearStemPCM(st) // Clear any existing PCM data before storing new
        const pcmData = extractPCMFromAudioBuffer(aligned.loop)
        storeStemPCM(st, pcmData, aligned.loop.sampleRate, aligned.loop.numberOfChannels, `pcm_${aligned.loop.sampleRate}`)
        console.log(`[Gen] Extracted PCM from AudioBuffer for ${st}: ${(pcmData.byteLength / 1024).toFixed(1)}KB`)
        scheduleAutoDownloadForStem(st)
      } catch (pcmErr) {
        console.warn(`[Gen] Failed to extract PCM from AudioBuffer for ${st}:`, pcmErr.message)
      }
    }

    // Push the new version into history
    pushStemVersion(st, {
      id: `${st}_${Date.now()}`,
      createdAt: new Date().toISOString(),
      prompt: usedPrompt,
      tempo, bars,
      sessionTag: SESSION_TAG,
      headIndex: 0,
      detectedHeadIndex: referenceHeadIndex,
      raw: stemRaw[st],
      loopIntent,
      isHeadNormalized: true,
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
    updateDragButtonState(st); updateCleanButtonState(st)
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(`❌ Generation error (${st}):`, err)

      // Provide user-friendly error messages based on error type
      let userMessage = err.message
      if (err.message.includes('429') || err.message.includes('rate limit')) {
        userMessage = 'Rate limit exceeded. Wait 30 seconds and try again.'
      } else if (err.message.includes('CORS') || err.message.includes('preflight')) {
        userMessage = 'Service configuration error. Please contact support.'
      } else if (err.message.includes('500') || err.message.includes('502') || err.message.includes('503')) {
        userMessage = 'Service temporarily unavailable. Try again in a moment.'
      } else if (err.message.includes('timeout') || err.message.includes('network')) {
        userMessage = 'Network error. Check your connection.'
      } else if (err.message.includes('Failed to fetch')) {
        userMessage = 'Connection failed. Check your internet connection.'
      } else if (err.message.includes('decode') || err.message.includes('audio')) {
        userMessage = 'Audio processing error. Try regenerating.'
      }

      if (statusEl) {
        statusEl.textContent = `Error: ${userMessage}`
        statusEl.style.color = '#ef4444' // red color for errors
      }

      // Show alert for critical errors that prevent generation
      if (err.message.includes('429') || err.message.includes('CORS')) {
        alert(`Generation failed: ${userMessage}`)
      }
    } else {
      if (statusEl) {
        statusEl.textContent = 'Generation cancelled'
        statusEl.style.color = '' // reset color
      }
    }
  } finally {
    if (genControllers.get(st) === ctrl) genControllers.delete(st)
    if (button) {
      button.disabled = false
      const icon = button.querySelector('[data-lucide]')
      if (icon) { icon.setAttribute('data-lucide', 'wand-2'); icon.classList.remove('loading-spin'); window.lucide?.createIcons() }
    }
    if (card) card.classList.remove('is-generating')
  }
}

/* =========================================================
   Browser detection and drag-and-drop helpers
   ========================================================= */

/**
 * Detect if the browser supports the DownloadURL drag data type.
 * This feature is only available in Chromium-based browsers (Chrome, Edge).
 * @returns {boolean} true if DownloadURL is supported
 */
function isChromiumBrowser() {
  const ua = navigator.userAgent.toLowerCase()
  return ua.includes('chrome') || ua.includes('edg') || ua.includes('chromium')
}

/**
 * Detect whether the browser can attach FileSystemHandles to drag payloads.
 * Chrome/Edge expose this via the File System Access drag-out API.
 */
function supportsFileHandleDragOut() {
  if (typeof window === 'undefined') return false
  const itemListProto = window.DataTransferItemList?.prototype || DataTransfer.prototype?.items?.constructor?.prototype
  const itemProto = window.DataTransferItem?.prototype
  const hasFsHandle = 'FileSystemHandle' in window || 'FileSystemFileHandle' in window
  return Boolean(
    hasFsHandle &&
    itemListProto &&
    typeof itemListProto.add === 'function' &&
    itemProto &&
    ('getAsFileSystemHandle' in itemProto || 'webkitGetAsEntry' in itemProto)
  )
}

/**
 * Generate a properly formatted WAV filename for drag-and-drop.
 * Format: ProjectName_InstrumentName_BPM_Key_Bars.wav
 * Example: Nexus_Kick_130_Am_4bars.wav
 * @param {string} st Stem identifier
 * @returns {string} formatted filename
 */
function generateWavFilename(st) {
  const cfg = stemConfigs[st]
  const master = stemControlValues.master || {}
  const tempo = master.tempo ?? DEFAULT_TEMPO
  const bars = master.bars ?? DEFAULT_BARS

  // Get root note with accidentals
  const rootName = typeof getRootText === 'function' ? getRootText() : (master.rootBase || 'A')
  const mode = master.mode ?? 'Minor'
  const keyStr = rootName.replace('♯', '#').replace('♭', 'b') + (mode === 'Minor' ? 'm' : '')

  const instrumentName = cfg?.name || st
  const safeName = instrumentName.replace(/\s+/g, '')

  return `Techno_${safeName}_${tempo}_${keyStr}_${bars}bars.wav`
}

function setDragImageForFilename(event, filename) {
  try {
    const dragImg = document.createElement('div')
    dragImg.style.cssText = `
      position: absolute;
      top: -9999px;
      padding: 12px 16px;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      white-space: nowrap;
      pointer-events: none;
    `
    dragImg.textContent = `🎵 ${filename}`
    document.body.appendChild(dragImg)

    event.dataTransfer.setDragImage(dragImg, 0, 0)

    setTimeout(() => dragImg.remove(), 100)
  } catch (imgErr) {
    console.warn('Failed to set custom drag image:', imgErr)
  }
}

function tryAttachFileHandleDrag(e, st, btn) {
  if (!supportsFileHandleDragOut()) return false
  if (!isAutoDownloadSupported() || !isAutoDownloadEnabled()) return false
  const record = getStemAutoDownloadRecord(st)
  if (!record || record.status !== 'saved' || !record.fileHandle) return false

  const list = e.dataTransfer?.items
  if (!list || typeof list.add !== 'function') return false

  try {
    list.add(record.fileHandle)
    const filename = record.filename || generateWavFilename(st)
    e.dataTransfer.setData('text/plain', filename)
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.dropEffect = 'copy'
    setDragImageForFilename(e, filename)
    if (btn) {
      btn.style.opacity = '0.7'
    }
    console.log(`[Drag] Using saved FileSystemHandle for ${st}: ${filename}`)
    return true
  } catch (handleErr) {
    console.warn(`[Drag] File handle drag failed for ${st}, falling back:`, handleErr)
    return false
  }
}

/* =========================================================
   Auto-download helpers
   ========================================================= */
function scheduleAutoDownloadForStem(st) {
  if (!isAutoDownloadSupported() || !isAutoDownloadEnabled()) return
  const pcmCache = getStemPCM(st)
  if (!pcmCache || !pcmCache.pcmData) return
  const filename = generateWavFilename(st)
  queueAutoDownloadForStem(st, {
    pcmData: pcmCache.pcmData,
    sampleRate: pcmCache.sampleRate,
    numChannels: pcmCache.numChannels,
    filename,
    timestamp: pcmCache.timestamp
  }).catch(err => {
    console.warn(`[AutoDownload] Failed to save ${st}:`, err?.message || err)
  })
}

function queueAutoDownloadsForAvailableStems() {
  if (!isAutoDownloadSupported() || !isAutoDownloadEnabled()) return
  STEM_ORDER.forEach(st => scheduleAutoDownloadForStem(st))
}

async function setupAutoDownloadPanel() {
  if (!isAutoDownloadSupported() || autoDownloadPanelEl || !document?.body) return
  autoDownloadPanelEl = document.createElement('div')
  autoDownloadPanelEl.id = 'autoDownloadPanel'
  autoDownloadPanelEl.className = 'fixed bottom-28 right-4 left-4 sm:left-auto sm:right-6 sm:w-80 z-30 bg-black/80 border border-white/15 rounded-2xl backdrop-blur-lg shadow-2xl p-4 space-y-2'
  autoDownloadPanelEl.innerHTML = `
    <div class="text-[11px] uppercase tracking-[0.3em] text-white/60">DAW Drop Helper</div>
    <div class="flex items-start gap-3">
      <div class="flex-1">
        <div class="text-sm font-semibold" data-auto-download-status>Auto-download disabled</div>
        <p class="text-[12px] text-white/70 mt-1" data-auto-download-note>
          Enable this to drag samples directly into your DAW. Stems will be pre-saved when you click the drag button.
        </p>
      </div>
      <div class="flex flex-col gap-2">
        <button class="px-3 py-1.5 rounded-lg bg-white/90 text-black text-xs font-semibold hover:bg-white" data-action="auto-download-configure">Enable</button>
        <button class="text-[11px] text-white/70 hover:text-white hidden" data-action="auto-download-disable">Disable</button>
      </div>
    </div>
  `
  document.body.appendChild(autoDownloadPanelEl)
  autoDownloadStatusEl = autoDownloadPanelEl.querySelector('[data-auto-download-status]')
  autoDownloadNoteEl = autoDownloadPanelEl.querySelector('[data-auto-download-note]')
  autoDownloadActionBtn = autoDownloadPanelEl.querySelector('[data-action="auto-download-configure"]')
  autoDownloadDisableBtn = autoDownloadPanelEl.querySelector('[data-action="auto-download-disable"]')

  if (autoDownloadActionBtn) {
    autoDownloadActionBtn.addEventListener('click', async () => {
      try {
        await requestAutoDownloadDirectory()
        updateAutoDownloadPanel()
        queueAutoDownloadsForAvailableStems()
      } catch (err) {
        alert(`Unable to enable auto-downloads: ${err?.message || err}`)
      }
    })
  }

  if (autoDownloadDisableBtn) {
    autoDownloadDisableBtn.addEventListener('click', async () => {
      try {
        await disableAutoDownload()
        updateAutoDownloadPanel()
      } catch (err) {
        console.warn('Failed to disable auto-download:', err)
      }
    })
  }
}

function updateAutoDownloadPanel(status = getAutoDownloadStatus()) {
  if (!autoDownloadPanelEl) return
  if (!status?.supported) {
    autoDownloadPanelEl.classList.add('hidden')
    return
  }
  autoDownloadPanelEl.classList.remove('hidden')
  if (autoDownloadStatusEl) {
    autoDownloadStatusEl.textContent = status.enabled
      ? `Auto-download ready${status.directoryName ? ` → ${status.directoryName}` : ''}`
      : 'Auto-download disabled'
  }
  if (autoDownloadNoteEl) {
    if (!status.enabled) {
      autoDownloadNoteEl.textContent = 'Enable this to drag samples directly into your DAW. Stems will be pre-saved when you click the drag button.'
    } else if (status.lastSavedStem) {
      autoDownloadNoteEl.textContent = `Last saved: ${status.lastSavedStem.filename || status.lastSavedStem.stemId}. Ready for DAW drag & drop.`
    } else {
      autoDownloadNoteEl.textContent = 'Ready for DAW drag & drop. Stems auto-save when generated.'
    }
  }
  if (autoDownloadActionBtn) {
    autoDownloadActionBtn.textContent = status.enabled ? 'Change folder' : 'Enable'
  }
  if (autoDownloadDisableBtn) {
    autoDownloadDisableBtn.classList.toggle('hidden', !status.enabled)
  }
}

function updateAutoDownloadChip(st) {
  // Update inline status indicator inside drag button
  const statusSpan = document.querySelector(`[data-auto-download-status="${st}"]`)
  if (!statusSpan) return

  const status = getAutoDownloadStatus()
  if (!isAutoDownloadSupported() || !status.enabled) {
    statusSpan.textContent = ''
    return
  }

  const record = getStemAutoDownloadRecord(st)
  if (!record) {
    statusSpan.textContent = ''
    return
  }

  if (record.status === 'pending') {
    statusSpan.innerHTML = '<i data-lucide="clock" class="w-3 h-3 inline"></i>'
    // Re-render Lucide icons for the new icon
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons()
    }
    return
  }

  if (record.status === 'error') {
    statusSpan.textContent = ''
    return
  }

  if (record.status === 'saved') {
    statusSpan.innerHTML = '<i data-lucide="check" class="w-3 h-3 inline"></i>'
    // Re-render Lucide icons for the new icon
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons()
    }
  }
}

async function initializeAutoDownloadSupport() {
  if (autoDownloadSetupPromise) return autoDownloadSetupPromise
  autoDownloadSetupPromise = (async () => {
    const status = await initAutoDownloadManager()
    if (!isAutoDownloadSupported()) return status
    await setupAutoDownloadPanel()
    updateAutoDownloadPanel(status)
    STEM_ORDER.forEach(st => updateAutoDownloadChip(st))
    subscribeAutoDownloadEvents((event, payload) => {
      if (event === 'state') {
        updateAutoDownloadPanel(payload)
        STEM_ORDER.forEach(st => updateAutoDownloadChip(st))
      } else if (event === 'progress' && payload?.stemId) {
        updateAutoDownloadChip(payload.stemId)
      }
    })
    return status
  })()
  return autoDownloadSetupPromise
}

/* =========================================================
   Downloads with validation and error handling
   ========================================================= */
/**
 * Encode an AudioBuffer to WAV format (uses synchronous fallback)
 * For non-blocking encoding, use encodeWAVAsync from audioEncoder.js
 * @param {AudioBuffer} audioBuffer - The audio buffer to encode
 * @returns {Blob} WAV file blob
 * @throws {Error} If buffer is invalid or encoding fails
 */
function encodeWAV(audioBuffer){
  return encodeWAVSync(audioBuffer)
}

/**
 * Legacy synchronous WAV encoder implementation
 * @param {AudioBuffer} audioBuffer - The audio buffer to encode
 * @returns {Blob} WAV file blob
 * @throws {Error} If buffer is invalid or encoding fails
 * @deprecated Kept for backward compatibility
 */
function encodeWAVLegacy(audioBuffer){
  // Comprehensive validation
  if (!audioBuffer) {
    throw new Error('Audio buffer is null or undefined')
  }

  if (!(audioBuffer instanceof AudioBuffer)) {
    throw new Error('Invalid audio buffer type')
  }

  const srcCh = audioBuffer.numberOfChannels
  const len = audioBuffer.length
  const sr = audioBuffer.sampleRate

  // Validate audio buffer properties
  if (!srcCh || srcCh < 1 || srcCh > 2) {
    throw new Error(`Invalid number of channels: ${srcCh}`)
  }

  if (!len || len <= 0) {
    throw new Error(`Invalid buffer length: ${len}`)
  }

  if (!sr || sr <= 0) {
    throw new Error(`Invalid sample rate: ${sr}`)
  }

  // Get channel data and validate
  const chans = []
  for (let c = 0; c < srcCh; c++) {
    const channelData = audioBuffer.getChannelData(c)
    if (!channelData || channelData.length === 0) {
      throw new Error(`Channel ${c} data is empty or invalid`)
    }
    chans.push(channelData)
  }

  // Check if audio buffer contains actual audio data (not all zeros/silence)
  let hasAudio = false
  for (let c = 0; c < srcCh; c++) {
    for (let i = 0; i < Math.min(len, 1000); i++) {
      if (Math.abs(chans[c][i]) > 0.0001) {
        hasAudio = true
        break
      }
    }
    if (hasAudio) break
  }

  if (!hasAudio) {
    console.warn('Audio buffer appears to contain only silence')
  }

  const bps = 2 // 16-bit
  const interleaved = new Float32Array(len * srcCh)
  let o = 0
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < srcCh; c++) {
      interleaved[o++] = chans[c][i]
    }
  }

  const blockAlign = srcCh * bps
  const byteRate = sr * blockAlign
  const dataSize = interleaved.length * bps

  // Validate calculated sizes
  if (dataSize <= 0 || dataSize > 500 * 1024 * 1024) { // Max 500MB
    throw new Error(`Invalid data size: ${dataSize} bytes`)
  }

  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // Helper function to write ASCII strings
  function writeAscii(v, o, s) {
    for (let i = 0; i < s.length; i++) {
      v.setUint8(o + i, s.charCodeAt(i))
    }
  }

  // Write WAV header
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true)  // PCM format
  view.setUint16(22, srcCh, true) // number of channels
  view.setUint32(24, sr, true) // sample rate
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Write audio data
  let off = 44
  for (let i = 0; i < interleaved.length; i++, off += 2) {
    let s = Math.max(-1, Math.min(1, interleaved[i]))
    s = s < 0 ? s * 0x8000 : s * 0x7FFF
    view.setInt16(off, s, true)
  }

  const blob = new Blob([view], { type: 'audio/wav' })

  // Verify blob was created successfully
  if (!blob || blob.size === 0) {
    throw new Error('Failed to create WAV blob')
  }

  console.log(`✓ Encoded WAV: ${(blob.size / 1024).toFixed(1)}KB, ${sr}Hz, ${srcCh}ch, ${len} samples`)

  return blob
}
/**
 * Download a stem as a WAV file with comprehensive validation and error handling.
 * @param {string} st - Stem identifier
 */
function downloadStem(st){
  try {
    const buf = stemLoop[st]

    // Validate buffer exists
    if (!buf) {
      console.error(`No audio buffer for stem: ${st}`)
      alert(`No audio for ${stemConfigs[st]?.name || st}. Generate audio first.`)
      return
    }

    // Validate buffer has data
    if (buf.length === 0) {
      console.error(`Empty audio buffer for stem: ${st}`)
      alert(`Audio buffer is empty. Please regenerate the audio.`)
      return
    }

    console.log(`Downloading stem ${st}: ${buf.length} samples, ${buf.duration.toFixed(2)}s`)

    // Encode to WAV with error handling
    let wav
    try {
      wav = encodeWAV(buf)
    } catch (encodeErr) {
      console.error('WAV encoding failed:', encodeErr)
      alert(`Failed to encode audio: ${encodeErr.message}. Please try regenerating.`)
      return
    }

    // Verify blob size
    if (!wav || wav.size === 0) {
      console.error('Generated WAV blob is empty')
      alert('Generated audio file is empty. Please try again.')
      return
    }

    console.log(`WAV blob created: ${(wav.size / 1024).toFixed(1)}KB`)

    // Use proper filename with session info
    const filename = generateWavFilename(st)

    // Create download link
    const url = URL.createObjectURL(wav)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)

    // Trigger download
    a.click()

    // Cleanup with delay to ensure download starts
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 100)

    console.log(`✓ Download initiated: ${filename}`)
  } catch (err) {
    console.error('Download failed:', err)
    alert(`Download failed: ${err.message}`)
  }
}

/**
 * Download all active takes for every stem.  When the user clicks the
 * "download all" button, iterate over all configured stems and, if a
 * take has been generated and is currently selected (active), create a
 * WAV file and trigger a download.  This does nothing for stems
 * without a generated take.  The file names mirror the single
 * download button naming scheme and include a timestamp.
 */
function downloadAllActiveStems(){
  // Iterate over the keys of stemConfigs to include all stems defined in
  // the current session.  For each stem, check whether there is an
  // active history entry (active index >= 0) and that a loop buffer
  // exists.  If so, download that buffer.
  Object.keys(stemConfigs).forEach(st => {
    const hasActive = (stemActiveIndex[st] ?? -1) >= 0
    const buf = stemLoop[st]
    if (hasActive && buf) {
      downloadStem(st)
    }
  })
}

/* =========================================================
   UI rendering (per card) — with black generate btn, wider sliders, click‑overlay for toggles
   ========================================================= */
function knobToDb(val){
  const v=Math.max(0, Math.min(100, Number(val)||0))
  // Shift the 0 dB point to 75% of the slider to mirror professional DAW faders.
  const pivot = 75
  if (v <= pivot) return EQ_MIN_DB + (v / pivot) * (0 - EQ_MIN_DB)
  return ((v - pivot) / (100 - pivot)) * EQ_MAX_DB
}
function formatDb(db){
  if (db <= EQ_MIN_DB + 0.5) return 'CUT'
  if (Math.abs(db) < 0.05) return '0 dB'
  return `${db.toFixed(1)} dB`
}
function knobAngle(val){ return -135 + (val/100)*270 }
function applyEqValuesToNodes(eqNodes, vals){
  if (!eqNodes || !audioContext) return
  const now=audioContext.currentTime
  eqNodes.low.gain.setTargetAtTime(knobToDb(vals.low), now, EQ_SMOOTH_TC)
  eqNodes.mid.gain.setTargetAtTime(knobToDb(vals.mid), now, EQ_SMOOTH_TC)
  eqNodes.high.gain.setTargetAtTime(knobToDb(vals.high), now, EQ_SMOOTH_TC)
}
function applyFilterValuesToNode(filterNode, vals){
  if (!filterNode || !audioContext) return
  const now=audioContext.currentTime
  filterNode.type=vals.mode
  filterNode.Q.setTargetAtTime(FILTER_Q, now, FILTER_SMOOTH_TC)
  filterNode.frequency.setTargetAtTime(knobToFreq(vals.cutoff), now, FILTER_SMOOTH_TC)
}
function updateEqKnobVisual(knobEl, val){
  if(!knobEl) return
  knobEl.dataset.value=String(val)
  const ptr=knobEl.querySelector('[data-eq-pointer]')
  if (ptr) ptr.style.transform=`translateX(-50%) rotate(${knobAngle(val)}deg)`
}
function updateEqReadout(st, band){
  const v=(stemEqValues[st]||{})[band] ?? EQ_DEFAULT
  const db=knobToDb(v)
  const ro=document.querySelector(`[data-eq-readout="${st}:${band}"]`)
  if (ro) ro.textContent=formatDb(db)
}

/* ---------- Filter UI ---------- */
function updateFilterKnobVisual(knobEl, val){
  if(!knobEl) return
  knobEl.dataset.value=String(val)
  const ptr=knobEl.querySelector('[data-filter-pointer]')
  if (ptr) ptr.style.transform=`translateX(-50%) rotate(${knobAngle(val)}deg)`
}
function updateFilterReadout(st){
  const v=(stemFilterValues[st]||{}).cutoff ?? freqToKnob(FILTER_DEFAULT_HZ)
  const hz=knobToFreq(v)
  const ro=document.querySelector(`[data-filter-readout="${st}"]`)
  if (ro) ro.textContent = hz >= 1000 ? `${(hz/1000).toFixed(hz>=10000?0:1)} kHz` : `${Math.round(hz)} Hz`
}
function updateFilterModeButton(st){
  const btn=document.querySelector(`[data-filter-mode="${st}"]`)
  if(!btn) return
  const mode=(stemFilterValues[st]||{}).mode || 'lowpass'
  btn.textContent = mode === 'lowpass' ? 'LP' : 'HP'
}

/* ---------- Per-card HTML ---------- */
function eqKnobHTML(st, band, label){
  const v=(stemEqValues[st]||{})[band] ?? EQ_DEFAULT
  const ang=knobAngle(v)
  return `\n        <div class="flex flex-col items-center select-none">\n          <div class="relative w-10 h-10 rounded-full border border-white/20 bg-white/5 shadow-inner cursor-[ns-resize]"\n               data-eq-knob data-stem="${st}" data-band="${band}" data-value="${v}" title="${label}: drag to adjust">\n            <div class="absolute inset-0 rounded-full" style="box-shadow: inset 0 2px 6px rgba(0,0,0,0.35), inset 0 -1px 2px rgba(255,255,255,0.05)"></div>\n            <div class="absolute w-0.5 h-3 bg-white/90 rounded pointer-events-none"\n                 data-eq-pointer\n                 style="left:50%; bottom:50%; transform: translateX(-50%) rotate(${ang}deg); transform-origin: bottom center;"></div>\n          </div>\n          <div class="mt-1 text-[10px] tracking-wider text-white/80">${label.toUpperCase()}</div>\n          <div class="text-[10px] text-white/60" data-eq-readout="${st}:${band}">${formatDb(knobToDb(v))}</div>\n        </div>\n      `
}
function filterKnobHTML(st){
  const v=(stemFilterValues[st]||{}).cutoff ?? freqToKnob(FILTER_DEFAULT_HZ)
  const ang=knobAngle(v)
  const mode=(stemFilterValues[st]||{}).mode || 'lowpass'
  return `\n        <div class="flex items-center gap-2">\n          <div class="flex flex-col items-center select-none">\n            <div class="relative w-10 h-10 rounded-full border border-white/20 bg-white/5 shadow-inner cursor-[ns-resize]"\n                 data-filter-knob data-stem="${st}" data-value="${v}" title="Filter Cutoff: drag to adjust">\n              <div class="absolute inset-0 rounded-full" style="box-shadow: inset 0 2px 6px rgba(0,0,0,0.35), inset 0 -1px 2px rgba(255,255,255,0.05)"></div>\n              <div class="absolute w-0.5 h-3 bg-white/90 rounded pointer-events-none"\n                   data-filter-pointer\n                   style="left:50%; bottom:50%; transform: translateX(-50%) rotate(${ang}deg); transform-origin: bottom center;"></div>\n            </div>\n            <div class="mt-1 text-[10px] tracking-wider text-white/80">CUTOFF</div>\n            <div class="text-[10px] text-white/60" data-filter-readout="${st}"></div>\n          </div>\n          <button class="h-6 px-2 rounded-md border border-white/15 bg-white/80 text-black text-[10px] font-semibold tracking-wider hover:bg-white active:translate-y-[1px] transition"\n                  data-action="toggle-filter-mode" data-stem="${st}" data-filter-mode="${st}" title="Toggle LP/HP">\n            ${mode === 'lowpass' ? 'LP' : 'HP'}\n          </button>\n        </div>\n      `
}
function headerActionButtonsHTML(st){
  return `\n        <div class="flex items-center gap-1.5">\n          <button class="sg-toggle w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="mute-stem" data-stem="${st}" title="Mute/Unmute" aria-pressed="false">\n            <i data-lucide="volume-2" class="w-4 h-4"></i>\n          </button>\n          <button class="sg-toggle w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="solo-stem" data-stem="${st}" title="Solo" aria-pressed="false">\n            <i data-lucide="headphones" class="w-4 h-4"></i>\n          </button>\n          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-stem="${st}" title="Favorite (coming soon)">\n            <i data-lucide="heart" class="w-4 h-4"></i>\n          </button>\n          <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="download-stem" data-stem="${st}" title="Download">\n            <i data-lucide="download" class="w-4 h-4"></i>\n          </button>\n        </div>\n      `
}

// Mobile version of header action buttons.  On small screens the action icons
// appear below the card title at 25% smaller size and reduced spacing.  This
// helper is used in the card header markup to display a second row of
// buttons on mobile only (hidden on sm and larger).
function headerActionButtonsMobileHTML(st) {
  return `\n        <div class="flex items-center gap-1 sm:hidden mt-1">\n          <button class="sg-toggle w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="mute-stem" data-stem="${st}" title="Mute/Unmute" aria-pressed="false">\n            <i data-lucide="volume-2" class="w-3 h-3"></i>\n          </button>\n          <button class="sg-toggle w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="solo-stem" data-stem="${st}" title="Solo" aria-pressed="false">\n            <i data-lucide="headphones" class="w-3 h-3"></i>\n          </button>\n          <button class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-stem="${st}" title="Favorite (coming soon)">\n            <i data-lucide="heart" class="w-3 h-3"></i>\n          </button>\n          <button class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition"\n                  data-action="download-stem" data-stem="${st}" title="Download">\n            <i data-lucide="download" class="w-3 h-3"></i>\n          </button>\n        </div>\n      `
}
function createBuilderStemCard(st, cfg){
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

  // Define a drag button for desktop browsers (Chromium only).  This button appears above
  // the Create button and allows users to drag the active sample directly to their DAW or desktop.
  // Hidden on mobile and non-Chromium browsers.
  const dragButtonHTML = `\n        <div class="mt-3 rounded-xl player-surface text-white shadow-sm p-2 sm:p-3 relative hidden sm:block" data-drag-container="${st}">\n          <button class="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-500/80 to-cyan-500/80 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold shadow-sm hover:shadow transition will-change-transform hover:-translate-y-0.5 active:translate-y-[1px] cursor-move disabled:opacity-40 disabled:cursor-not-allowed"\n                  data-action="drag-stem" data-stem="${st}" draggable="true" title="Drag & Drop to DAW or Desktop (Chrome/Edge only)">\n            <span class="inline-flex items-center justify-center gap-2 text-xs sm:text-sm relative w-full">\n              <i data-lucide="grip-vertical" class="w-3 h-3 sm:w-4 sm:h-4"></i>\n              Drag & Drop\n              <span class="absolute right-0 text-[10px] opacity-60" data-auto-download-status="${st}"></span>\n            </span>\n          </button>\n        </div>\n      `;

  // Clean button: allows users to separate stems (remove unwanted instruments) from the current sample
  const cleanButtonHTML = `\n        <div class="mt-3 rounded-xl player-surface text-white shadow-sm p-2 sm:p-3 relative" data-clean-container="${st}">\n          <button class="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500/80 to-teal-500/80 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold shadow-sm hover:shadow transition will-change-transform hover:-translate-y-0.5 active:translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed"\n                  data-action="clean-stem" data-stem="${st}" title="Remove unwanted instruments from this sample">\n            <span class="inline-flex items-center justify-center gap-2 text-xs sm:text-sm">\n              <i data-lucide="sparkles" class="w-3 h-3 sm:w-4 sm:h-4"></i>\n              <span data-clean-label="${st}">Clean</span>\n            </span>\n          </button>\n        </div>\n      `;

  // Define a create button fragment.  This version removes borders and uses "Create" for the label.  It opens
  // a modal for configuring generation settings when clicked.
  const genCreateButtonHTML = `\n        <div class="mt-3 rounded-xl player-surface text-white shadow-sm p-2 sm:p-3 relative">\n          <button class="w-full py-2.5 rounded-xl bg-black text-white font-semibold shadow-sm hover:shadow transition will-change-transform hover:-translate-y-0.5 active:translate-y-[1px]"\n                  data-action="open-create-settings" data-stem="${st}" title="Create new take">\n            <span class="inline-flex items-center justify-center gap-2 text-xs sm:text-sm">\n              <i data-lucide="wand-2" class="w-3 h-3 sm:w-4 sm:h-4"></i>\n              Create\n            </span>\n          </button>\n        </div>\n      `;
  // Use our custom create button HTML with drag, clean, and create buttons.  Update status line text accordingly.
  card.innerHTML = headerHTML + eqFilterHTML + volumeHTML + waveformHTML + dragButtonHTML + cleanButtonHTML + genCreateButtonHTML + `\n        <div class="status-line hidden mt-2 text-sm text-white/80">Ready to create</div>\n      `
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

    // Do not scale the waveform vertically based on volume.  The card's
    // waveform remains at full height so that the user can always click
    // the take even when its volume is set to zero.  Visual feedback
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
function isStemActuallyPlaying(st){ return isPlaying && !!stemNodes[st]?.source && !stemMuteStates[st] && (!soloedStem || soloedStem === st) }
function updateMixerGlow(st){ const card=document.querySelector(`[data-mix-card="${st}"]`); if(!card) return; card.classList.toggle('sg-glow', isStemActuallyPlaying(st)) }
function updateAllMixerGlows(){ Object.keys(stemConfigs).forEach(updateMixerGlow) }

/* ---------- Toggle visuals (Mute/Solo) ---------- */
function setToggleVisual(el, active){ if (!el) return; el.classList.toggle('sg-toggle-active', !!active); el.setAttribute('aria-pressed', active ? 'true' : 'false') }
function reflectMuteSoloButtons(st){
  const muted  = !!stemMuteStates[st]
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
function setVolumeUnified(st, newVal){
  const v=Math.max(0, Math.min(100, Math.round(Number(newVal)||0)))
  stemControlValues[st].volume=v

  // Update legacy card volume slider if present
  const cardSlider=document.querySelector(`[data-stem="${st}"] [data-control="volume"]`)
  if (cardSlider) {
    cardSlider.value=v
    const display=cardSlider.parentElement?.querySelector('span:last-child')
    const cfg=stemConfigs[st]?.controls?.volume
    if (display && cfg) display.textContent=`${v}${cfg.unit}`
  }
  // Update new mixer volume slider if present; value display is handled via tooltip
  const mixSlider=document.querySelector(`input[data-mix-slider="volume"][data-stem="${st}"]`)
  if (mixSlider) {
    mixSlider.value=String(v)
  }

  if (isPlaying && stemNodes[st]?.gain) {
    const vol=v/100
    const muted=stemMuteStates[st]
    const blocked=(soloedStem && soloedStem !== st)
    if (!muted && !blocked) {
      const p=stemNodes[st].gain.gain, t=audioContext.currentTime
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(vol, t + 0.01)
    }
  }
}

/* ---------- Master state helpers ---------- */
function getRootText(){
  const base=stemControlValues.master?.rootBase || 'A'
  const acc =stemControlValues.master?.accidental || 'natural'
  return acc==='sharp'?`${base}#` : acc==='flat'?`${base}b` : base
}
function getMasterForPrompt(){
  return {
    tempo: clampTempo(stemControlValues.master?.tempo ?? DEFAULT_TEMPO),
    bars:  stemControlValues.master?.bars ?? DEFAULT_BARS,
    root:  getRootText(),
    mode:  stemControlValues.master?.mode || 'Minor'
  }
}

/* ---------- Mixer (Docked tray) ---------- */
function volumeKnobHTML(st){
  const v=stemControlValues[st]?.volume ?? 80
  const label=stemConfigs[st]?.name || st
  const ang=knobAngle(v)
  const idx = STEM_ORDER.indexOf(st) + 1
  return `\n        <div class="sg-mix-card relative flex flex-col items-center justify-center rounded-xl border border-white/15 bg-white/10 p-2 aspect-square select-none"\n             data-mix-card="${st}">\n          <span data-mix-number="${st}" class="absolute left-1 top-1 flex items-center justify-center w-4 h-4 rounded-full border border-white/30 text-[10px] font-semibold">${idx}</span>\n          <div class="text-[10px] mb-1 text-white/85">${label}</div>\n          <div class="relative w-12 h-12 rounded-full border border-white/25 bg-white/10 shadow-inner cursor-[ns-resize]"\n               data-mix-knob data-stem="${st}" data-value="${v}" title="${label} Volume">\n            <div class="absolute inset-0 rounded-full" style="box-shadow: inset 0 2px 6px rgba(0,0,0,0.35), inset 0 -1px 2px rgba(255,255,255,0.05)"></div>\n            <div class="absolute w-0.5 h-4 bg-white/90 rounded pointer-events-none"\n                 data-mix-pointer style="left:50%; bottom:50%; transform: translateX(-50%) rotate(${ang}deg); transform-origin: bottom center;"></div>\n          </div>\n          <div class="mt-1 text-[10px] text-white/80"><span data-mix-readout="${st}">${v}</span>%</div>\n          <div class="mt-1 flex gap-1">\n            <button class="sg-toggle px-1.5 py-0.5 text-[10px] rounded border border-white/15 hover:bg-white/10"\n                    data-action="mix-mute" data-stem="${st}" aria-pressed="false">Mute</button>\n            <button class="sg-toggle px-1.5 py-0.5 text-[10px] rounded border border-white/15 hover:bg-white/10"\n                    data-action="mix-solo" data-stem="${st}" aria-pressed="false">Solo</button>\n          </div>\n        </div>\n      `
}

// Build a mixer channel row with sliders for volume, EQ and filter.  Each
// row spans the full width of the mixer panel on desktop.  EQ
// sliders control low, mid and high bands.  The filter slider
// controls cutoff frequency.  Mute and Solo buttons are included
// along with the channel number.  Use data attributes to attach
// event handlers.
function mixChannelRowHTML(st){
  const name = stemConfigs[st]?.name || st
  const idx  = STEM_ORDER.indexOf(st) + 1
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
function buildFloatingMixerPanel(){
  const tray=document.getElementById('mixerTray')
  if (!tray) return
  let grid = tray.querySelector('#mixerGrid')
  // Create the grid element if it doesn't exist
  if (!grid) {
    grid = document.createElement('div')
    grid.id = 'mixerGrid'
    tray.querySelector('.mixer-inner')?.appendChild(grid)
  }
  // Always apply responsive classes: single column on extra small screens and two columns on small screens and above
  // On desktop (sm and up) this results in two channels per row; on very small screens there is one channel per row
  // Use two columns for the mixer on all screen sizes; maintain gap scaling on larger screens
  // Use two columns on small screens and three columns on medium and larger screens for the mixer layout
  // Display three channels per row on all screen sizes for consistency.
  grid.className = 'grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-3'
  // Populate with full-width channel rows
  // Use visibleInstruments order instead of STEM_ORDER for consistent ordering
  grid.innerHTML = visibleInstruments.map(st => mixChannelRowHTML(st)).join('')
  // Update mixer glow and card number colours
  visibleInstruments.forEach(updateMixerGlow)
  visibleInstruments.forEach(updateCardNumberColor)
}
function setMixerOpen(open){
  const tray=document.getElementById('mixerTray')
  if (!tray) return
  // Expand the mixer to full viewport height when open; collapse to zero when closed
  tray.style.maxHeight = open ? '100vh' : '0px'
  tray.dataset.open = open ? '1' : '0'
  // Update player toggle button label + ARIA
  const toggleBtn = document.getElementById('mixerToggleBtn')
  if (toggleBtn) {
    // Update the desktop label only.  The mobile label remains 'mixer' regardless of state.
    const desktopSpan = toggleBtn.querySelector('span.hidden.sm\\:inline')
    const mobileSpan  = toggleBtn.querySelector('span.inline.sm\\:hidden')
    if (desktopSpan) desktopSpan.textContent = open ? 'close mixer' : 'open mixer'
    // Do not modify the mobile label (mobileSpan) so it stays 'mixer'
    toggleBtn.setAttribute('aria-pressed', open ? 'true' : 'false')
  }

  // When the mixer is open on mobile, prevent the page from scrolling or panning.
  // Disable body overflow so touch interactions are confined to the mixer.
  if (open) {
    // Hide page scrolling and prevent gestures from propagating outside the mixer
    document.body.style.overflow = 'hidden'
    // When the mixer is open, disable touch-action on the tray so that horizontal drags are consumed by sliders and not by the page
    tray.style.touchAction = 'none'
    // Show overlay and close button when mixer is open
    const overlay = document.getElementById('mixerOverlay')
    if (overlay) overlay.classList.remove('hidden')
    const closeBtn = document.getElementById('mixerCloseBtn')
    if (closeBtn) closeBtn.classList.remove('hidden')
  } else {
    document.body.style.overflow = ''
    tray.style.touchAction = ''
    // Hide overlay and close button when mixer is closed
    const overlay = document.getElementById('mixerOverlay')
    if (overlay) overlay.classList.add('hidden')
    const closeBtn = document.getElementById('mixerCloseBtn')
    if (closeBtn) closeBtn.classList.add('hidden')
  }
}
function toggleMixerOpen(){
  const tray=document.getElementById('mixerTray')
  if (!tray) return
  const open = tray.dataset.open === '1'
  setMixerOpen(!open)
}

/* ---------- Hotkey helpers ---------- */
function toggleMute(st){
  stemMuteStates[st] = !stemMuteStates[st]
  const vol = (stemControlValues[st]?.volume ?? 80)/100
  const target = stemMuteStates[st] ? 0 : vol
  if (stemNodes[st]?.gain) {
    const p = stemNodes[st].gain.gain, t = audioContext.currentTime
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(target, t + 0.01)
  }
  const icon = document.querySelector(`[data-stem="${st}"] [data-action="mute-stem"] [data-lucide]`)
  if (icon) { icon.setAttribute('data-lucide', stemMuteStates[st] ? 'volume-x' : 'volume-2'); window.lucide?.createIcons() }
  reflectMuteSoloButtons(st); updateMixerGlow(st)
  updateCardNumberColor(st)
  updateMutedBorder(st)
  updateDragButtonState(st); updateCleanButtonState(st)
}

/* ---------- Events ---------- */
// Removed: getTempoValueEl and updateTempoReadout are no longer needed because
// the app no longer exposes a master tempo slider or readout.

// new helper functions for card numbers and history indicators
function updateHistoryIndicator(st){
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
/**
 * Update the drag button state with validation and file size information.
 * The button is disabled when no sample is available, data isn't ready, or on non-Chromium browsers.
 * @param {string} st - Stem identifier
 */
function updateDragButtonState(st) {
  const dragBtn = document.querySelector(`[data-action="drag-stem"][data-stem="${st}"]`)
  if (!dragBtn) return

  const buf = stemLoop[st]
  const hasActiveSample = (stemActiveIndex[st] ?? -1) >= 0 && buf
  const isChromium = isChromiumBrowser()

  // Check if PCM data is ready for drag (new implementation using PCM cache)
  const isPCMReady = isPCMReadyForDrag(st)
  const pcmCache = getStemPCM(st)
  const autoStatus = getAutoDownloadStatus()
  const autoRecord = getStemAutoDownloadRecord(st)
  const fileHandleReady = Boolean(
    autoRecord?.status === 'saved' &&
    autoRecord.fileHandle &&
    supportsFileHandleDragOut() &&
    isAutoDownloadSupported() &&
    autoStatus.enabled
  )
  const dragPayloadReady = isPCMReady || fileHandleReady

  // Validate buffer has actual data
  const hasValidData = hasActiveSample && buf.length > 0 && buf.duration > 0

  // Enable button only if valid data exists, PCM is ready, and browser is Chromium
  dragBtn.disabled = !hasValidData || !isChromium || !dragPayloadReady

  // Log PCM cache status for debugging
  console.log(`[DragButton] ${st} - hasValidData: ${hasValidData}, isPCMReady: ${isPCMReady}, fileHandleReady: ${fileHandleReady}, isChromium: ${isChromium}, pcmCache: ${pcmCache ? 'exists' : 'missing'}`)
  if (hasValidData && !isPCMReady && !fileHandleReady) {
    console.warn(`[DragButton] ${st} has audio buffer but PCM not ready. PCM cache:`, pcmCache)
  }

  // Update tooltip with detailed information
  if (!isChromium) {
    dragBtn.title = 'Drag & Drop feature requires Chrome or Edge browser'
  } else if (!hasActiveSample) {
    dragBtn.title = 'Create a sample first to enable Drag & Drop'
  } else if (!hasValidData) {
    dragBtn.title = 'Audio buffer is empty - please regenerate'
  } else if (!isPCMReady) {
    dragBtn.title = 'Preparing audio file... Please wait'
  } else {
    const filename = generateWavFilename(st)
    // Calculate approximate WAV file size (16-bit stereo) from PCM data
    const estimatedSize = pcmCache ? (pcmCache.size + 44) : (buf.length * buf.numberOfChannels * 2 + 44)
    const sizeKB = (estimatedSize / 1024).toFixed(1)
    let tooltip = `Drag & Drop: ${filename} (~${sizeKB}KB, ${buf.duration.toFixed(1)}s)`
    if (isAutoDownloadSupported() && autoStatus.enabled) {
      if (autoRecord?.status === 'pending') {
        tooltip += `\nSaving to ${autoStatus.directoryName || 'selected folder'}…`
      } else if (autoRecord?.status === 'saved') {
        tooltip += `\nAuto-saved in ${autoStatus.directoryName || 'your folder'}`
        if (fileHandleReady) {
          tooltip += `\nDrag handoff will use the on-disk file`
        }
      }
    }
    dragBtn.title = tooltip
  }

  // Hide the entire drag container on non-Chromium browsers
  const container = document.querySelector(`[data-drag-container="${st}"]`)
  if (container && !isChromium) {
    container.style.display = 'none'
  } else if (container && (!hasValidData || !isPCMReady)) {
    // Visual feedback for empty buffer or not ready
    dragBtn.style.opacity = '0.5'
  } else if (container) {
    dragBtn.style.opacity = '1'
  }

  updateAutoDownloadChip(st)
}

/**
 * Update the clean button's enabled state based on audio availability
 * @param {string} st Stem identifier
 */
function updateCleanButtonState(st) {
  const cleanBtn = document.querySelector(`[data-action="clean-stem"][data-stem="${st}"]`)

  if (!cleanBtn) return

  const buf = stemLoop[st]
  const hasValidData = buf && buf.length > 0
  const hasActiveSample = stemActiveIndex[st] != null && stemActiveIndex[st] >= 0

  // Enable clean button only when there's valid audio
  if (!hasActiveSample || !hasValidData) {
    cleanBtn.disabled = true
    cleanBtn.style.opacity = '0.5'
  } else {
    cleanBtn.disabled = false
    cleanBtn.style.opacity = '1'
  }
}

function updateCardNumberColor(st){
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
function updateMutedBorder(st){
  const card = document.querySelector(`[data-stem="${st}"]`)
  if (card) {
    if (stemMuteStates[st]) card.classList.add('sg-muted-border')
    else card.classList.remove('sg-muted-border')
  }
  const mixCard=document.querySelector(`[data-mix-card="${st}"]`)
  if (mixCard) {
    if (stemMuteStates[st]) mixCard.classList.add('sg-muted-border')
    else mixCard.classList.remove('sg-muted-border')
  }
}

function setupEventListeners() {
  // Clean up blob URLs when page unloads to prevent memory leaks
  window.addEventListener('beforeunload', () => {
    Object.keys(stemBlobUrls).forEach(st => {
      if (stemBlobUrls[st]) {
        URL.revokeObjectURL(stemBlobUrls[st])
        console.log(`Cleaned up blob URL for ${st} on page unload`)
      }
    })
  })

  // Player Play/Pause
  const playBtn = document.getElementById('playBtn')
  if (playBtn) playBtn.addEventListener('click', async () => {
    await ensureAudioContext()
    if (isPlaying) stopTransport()
    else {
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

  // Download all button: prompt the user to confirm downloading all files
  const downloadAllBtn = document.getElementById('downloadAllBtn')
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', () => {
      openDownloadConfirmModal()
    })
  }

  // Generate settings modal buttons.  Cancel simply closes the modal; Start applies settings and triggers generation.
  const genCancelBtn = document.getElementById('generateSettingsCancelBtn')
  const genStartBtn  = document.getElementById('generateSettingsStartBtn')
  const genOverlay   = document.getElementById('generateSettingsOverlay')
  if (genCancelBtn) genCancelBtn.addEventListener('click', () => hideGenerateSettingsModal())
  if (genOverlay) genOverlay.addEventListener('click', () => hideGenerateSettingsModal())
  if (genStartBtn) genStartBtn.addEventListener('click', () => { applyGenerateSettingsAndStart() })

  // Clean stem modal buttons
  const cleanCancelBtn = document.getElementById('cleanModalCancelBtn')
  const cleanConfirmBtn = document.getElementById('cleanModalConfirmBtn')
  const cleanCloseBtn = document.getElementById('cleanModalCloseBtn')
  const cleanOverlay = document.getElementById('cleanStemOverlay')

  console.log('[Setup] Clean modal buttons found:', {
    cancel: !!cleanCancelBtn,
    confirm: !!cleanConfirmBtn,
    close: !!cleanCloseBtn,
    overlay: !!cleanOverlay
  })

  if (cleanCancelBtn) cleanCancelBtn.addEventListener('click', () => hideCleanStemModal())
  if (cleanCloseBtn) cleanCloseBtn.addEventListener('click', () => hideCleanStemModal())
  if (cleanOverlay) cleanOverlay.addEventListener('click', () => hideCleanStemModal())
  if (cleanConfirmBtn) {
    cleanConfirmBtn.addEventListener('click', async () => {
      console.log('[Clean] Confirm button clicked, currentCleanStem:', currentCleanStem)
      const st = currentCleanStem
      if (st) {
        console.log(`[Clean] Starting separation for ${st}`)
        hideCleanStemModal()
        await separateCurrentStem(st)
      } else {
        console.warn('[Clean] No stem selected for cleaning')
      }
    })
    console.log('[Setup] Clean confirm button event listener attached')
  } else {
    console.error('[Setup] Clean confirm button NOT found! Modal may not have loaded.')
  }

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
    const editing = (ae && (ae.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(tag)))
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

  // Master Volume: controls the global output gain.  Updates the text display and ramps the master gain.
  const masterVolSlider = document.getElementById('masterVolumeSlider')
  const masterVolValue  = document.getElementById('masterVolumeValue')
  if (masterVolSlider) {
    // Initialize the slider display based on the current masterGain value, if available
    if (masterVolValue && typeof masterGain?.gain?.value === 'number') {
      const initVal = Math.round((masterGain.gain.value || 0) * 100)
      masterVolSlider.value = String(initVal)
      masterVolValue.textContent = `${initVal}%`
    }
    masterVolSlider.addEventListener('input', async e => {
      const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)))
      // Update displayed percentage
      if (masterVolValue) masterVolValue.textContent = `${v}%`
      // Ensure the audio context exists and update the gain
      await ensureAudioContext()
      if (masterGain) {
        const now = audioContext.currentTime
        // Ramp smoothly to new gain value
        masterGain.gain.cancelScheduledValues(now)
        masterGain.gain.setValueAtTime(masterGain.gain.value, now)
        masterGain.gain.linearRampToValueAtTime(v / 100, now + 0.02)
      }
    })
  }

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
        const val = (muted || soloedOther) ? 0 : (v/100)
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
  let tooltipUpdateFrame = null
  let tooltipPendingSlider = null
  let tooltipPendingX = 0
  let tooltipPendingY = 0

  function requestTooltipUpdate(sliderEl, pageX, pageY) {
    tooltipPendingSlider = sliderEl
    tooltipPendingX = pageX
    tooltipPendingY = pageY
    if (tooltipUpdateFrame !== null) return
    tooltipUpdateFrame = requestAnimationFrame(() => {
      tooltipUpdateFrame = null
      if (tooltipPendingSlider) {
        updateSliderTooltip(tooltipPendingSlider, tooltipPendingX, tooltipPendingY)
      }
    })
  }
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
      text = hz >= 1000 ? `${(hz/1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`
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
      tooltipPendingSlider = t
      if (sliderTooltipEl) sliderTooltipEl.style.opacity = '1'
    }
  })
  // Update tooltip position/value while dragging
  document.addEventListener('pointermove', e => {
    if (activeSlider) {
      requestTooltipUpdate(activeSlider, e.pageX, e.pageY)
    }
  })
  // Hide tooltip on pointerup/cancel
  document.addEventListener('pointerup', () => {
    if (sliderTooltipEl) sliderTooltipEl.style.opacity = '0'
    activeSlider = null
    tooltipPendingSlider = null
    if (tooltipUpdateFrame !== null) {
      cancelAnimationFrame(tooltipUpdateFrame)
      tooltipUpdateFrame = null
    }
  })
  document.addEventListener('pointercancel', () => {
    if (sliderTooltipEl) sliderTooltipEl.style.opacity = '0'
    activeSlider = null
    tooltipPendingSlider = null
    if (tooltipUpdateFrame !== null) {
      cancelAnimationFrame(tooltipUpdateFrame)
      tooltipUpdateFrame = null
    }
  })

  /*
    -------------------------------------------------------------------------
    Dial plus/minus button handlers

    The volume and endpoint infinite dials are flanked by "−" and "+" buttons.
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
    const st   = btn.getAttribute('data-stem')
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
  function onEqMove(e){ if(!activeEqKnob) return; const dx=(e.clientX??0)-startX; const dy=startY-(e.clientY??0); const delta=dy+dx*0.35; const v=Math.max(0,Math.min(100,startVal+delta*0.5)); setEqValue(activeEqKnob.stem, activeEqKnob.band, v) }
  function onEqUp(){ activeEqKnob=null; window.removeEventListener('pointermove',onEqMove); window.removeEventListener('pointerup',onEqUp) }
  document.addEventListener('pointerdown', e => {
    const k = e.target.closest('[data-eq-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); const band = k.getAttribute('data-band'); const val=Number(k.getAttribute('data-value'))||EQ_DEFAULT
    if (e.shiftKey) { setEqValue(st, band, 0); return }
    activeEqKnob={stem:st, band}; startX=e.clientX??0; startY=e.clientY??0; startVal=val
    window.addEventListener('pointermove', onEqMove); window.addEventListener('pointerup', onEqUp)
  })
  document.addEventListener('dblclick', e => {
    const k = e.target.closest('[data-eq-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); const band = k.getAttribute('data-band'); setEqValue(st, band, EQ_DEFAULT)
  })

  // Filter knob gestures
  let activeFilterKnob = null, fStartVal = 0
  function onFilterMove(e){ if(!activeFilterKnob) return; const dx=(e.clientX??0)-startX; const dy=startY-(e.clientY??0); const delta=dy+dx*0.35; const v=Math.max(0,Math.min(100,fStartVal+delta*0.5)); setFilterCutoff(activeFilterKnob.stem, v) }
  function onFilterUp(){ activeFilterKnob=null; window.removeEventListener('pointermove',onFilterMove); window.removeEventListener('pointerup',onFilterUp) }
  document.addEventListener('pointerdown', e => {
    const k = e.target.closest('[data-filter-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); const val=Number(k.getAttribute('data-value'))||freqToKnob(FILTER_DEFAULT_HZ)
    if (e.shiftKey) { setFilterCutoff(st, freqToKnob(FILTER_DEFAULT_HZ)); return }
    activeFilterKnob={stem:st}; startX=e.clientX??0; startY=e.clientY??0; fStartVal=val
    window.addEventListener('pointermove', onFilterMove); window.addEventListener('pointerup', onFilterUp)
  })
  document.addEventListener('dblclick', e => {
    const k = e.target.closest('[data-filter-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); setFilterCutoff(st, freqToKnob(FILTER_DEFAULT_HZ))
  })

  // Mixer knobs
  let activeMixKnob = null, mStartVal = 0
  function onMixMove(e){ if(!activeMixKnob) return; const dx=(e.clientX??0)-startX; const dy=startY-(e.clientY??0); const delta=dy+dx*0.35; const v=Math.max(0,Math.min(100,mStartVal+delta*0.5)); setVolumeUnified(activeMixKnob.stem, v) }
  function onMixUp(){ activeMixKnob=null; window.removeEventListener('pointermove',onMixMove); window.removeEventListener('pointerup',onMixUp) }
  document.addEventListener('pointerdown', e => {
    const k = e.target.closest('[data-mix-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); const val=Number(k.getAttribute('data-value')) || (stemControlValues[st]?.volume ?? 80)
    if (e.shiftKey) { setVolumeUnified(st, 0); return }
    activeMixKnob={stem:st}; startX=e.clientX??0; startY=e.clientY??0; mStartVal=val
    window.addEventListener('pointermove', onMixMove); window.addEventListener('pointerup', onMixUp)
  })
  document.addEventListener('dblclick', e => {
    const k = e.target.closest('[data-mix-knob]'); if (!k) return
    const st = k.getAttribute('data-stem'); setVolumeUnified(st, stemConfigs[st]?.controls?.volume?.default ?? 80)
  })

  // Dragstart handler for drag-to-DAW functionality
  // Uses raw PCM data from ElevenLabs for native OS drag
  document.addEventListener('dragstart', e => {
    const btn = e.target.closest('[data-action="drag-stem"]')
    if (!btn) return

    const st = btn.dataset.stem
    if (!st) return

    if (tryAttachFileHandleDrag(e, st, btn)) {
      return
    }

    try {
      // Check if PCM data is ready for drag
      if (!isPCMReadyForDrag(st)) {
        console.warn(`[Drag] PCM data not ready for ${st}`)
        e.preventDefault()
        alert('Audio is still being prepared. Please wait a moment and try again.')
        return
      }

      // Get stored PCM data and format info
      const pcmCache = getStemPCM(st)
      if (!pcmCache) {
        console.error(`[Drag] No PCM data cached for ${st}`)
        e.preventDefault()
        alert('Audio data is not available. Please regenerate the audio.')
        return
      }

      const { pcmData, sampleRate, numChannels, format } = pcmCache
      console.log(`[Drag] Initiating drag for ${st}: ${format} (${sampleRate}Hz, ${numChannels}ch, ${(pcmData.byteLength / 1024).toFixed(1)}KB)`)

      const filename = generateWavFilename(st)

      // Check if running in Electron environment
      const isElectron = typeof window.electronAPI !== 'undefined'

      if (isElectron) {
        // Use Electron native drag with raw PCM data
        // IMPORTANT: Do NOT call e.preventDefault() - let the drag gesture flow naturally
        // The synchronous IPC call will set up the native drag within the timing window

        console.log(`[Drag] Electron mode: calling synchronous IPC for ${st}`)

        try {
          // Call Electron API synchronously - returns immediately
          const result = window.electronAPI.startNativeDrag(st, pcmData, sampleRate, numChannels, filename)

          if (result.success) {
            console.log(`✓ Electron native drag started for ${st} using ${result.method} (${result.elapsed}ms)`)
            console.log(`[Drag] Temp file: ${result.filePath}`)

            // Also set browser DataTransfer as backup/complement
            // This creates a hybrid approach: both native Electron drag AND HTML5 drag
            try {
              const wavBlob = pcm16leToWavBlob(pcmData, sampleRate, numChannels)
              const wavFile = new File([wavBlob], filename, {
                type: 'audio/wav',
                lastModified: Date.now()
              })

              // Add file to DataTransfer for additional compatibility
              if (e.dataTransfer.items && typeof e.dataTransfer.items.add === 'function') {
                e.dataTransfer.items.add(wavFile)
                console.log(`[Drag] Also added WAV to HTML5 DataTransfer for hybrid approach`)
              }

              e.dataTransfer.effectAllowed = 'copy'
              setDragImageForFilename(e, filename)
            } catch (hybridErr) {
              console.warn('[Drag] Failed to set hybrid DataTransfer:', hybridErr)
            }

            if (btn) btn.style.opacity = '0.7'
          } else {
            console.error('[Drag] Electron drag failed:', result.error)
            // Don't prevent default - let browser drag work as fallback
          }
        } catch (err) {
          console.error('[Drag] Electron drag error:', err)
          // Don't prevent default - let browser drag work as fallback
        }

        // Let the drag gesture continue naturally
        return
      }

      // Fallback to browser-based drag (limited DAW compatibility)
      // WARNING: This works for drag-to-desktop in Chromium, but most DAWs won't accept it
      // For proper DAW drag support, use the Electron desktop app
      console.warn(`[Drag] Using browser fallback mode - DAW compatibility limited`)
      console.warn(`[Drag] For Ableton/Logic/FL support, use the Electron desktop app`)

      // Wrap PCM to WAV for browser drag
      const wavBlob = pcm16leToWavBlob(pcmData, sampleRate, numChannels)
      const wavFile = new File([wavBlob], filename, {
        type: 'audio/wav',  // Primary MIME type
        lastModified: Date.now()
      })

      console.log(`[Drag] Created WAV file: ${filename} (${(wavFile.size / 1024).toFixed(1)}KB)`)

      // Clean up any existing blob URL for this stem
      if (stemBlobUrls[st]) {
        URL.revokeObjectURL(stemBlobUrls[st])
        delete stemBlobUrls[st]
      }

      // Create blob URL for browser drag
      const url = URL.createObjectURL(wavFile)
      stemBlobUrls[st] = url

      // Try to add file using DataTransferItem API (most reliable for file drops)
      let addedViaItems = false
      if (e.dataTransfer.items && typeof e.dataTransfer.items.add === 'function') {
        try {
          e.dataTransfer.items.add(wavFile)
          addedViaItems = true
          console.log(`[Drag] ✓ Added file via DataTransferItem API`)
        } catch (itemErr) {
          console.warn('[Drag] DataTransferItem.add() failed:', itemErr)
        }
      }

      // Set multiple data formats for maximum compatibility
      // DownloadURL format (Chrome-specific for better file downloads)
      try {
        const downloadURL = `audio/wav:${filename}:${url}`
        e.dataTransfer.setData('DownloadURL', downloadURL)
        console.log(`[Drag] Set DownloadURL format`)
      } catch (dlErr) {
        console.warn('[Drag] DownloadURL not supported:', dlErr)
      }

      // Standard formats
      e.dataTransfer.setData('text/uri-list', url)
      e.dataTransfer.setData('text/plain', filename)  // Use filename instead of URL

      // Set multiple MIME type hints
      try {
        e.dataTransfer.setData('audio/wav', url)
        e.dataTransfer.setData('audio/x-wav', url)
      } catch (mimeErr) {
        console.warn('[Drag] MIME type data not supported:', mimeErr)
      }

      e.dataTransfer.effectAllowed = 'copy'
      e.dataTransfer.dropEffect = 'copy'

      console.log(`[Drag] Browser drag prepared: ${addedViaItems ? 'File+URL+DownloadURL' : 'URL+DownloadURL'}`)

      // Create custom drag image with filename display
      setDragImageForFilename(e, filename)

      if (btn) {
        btn.style.opacity = '0.7'
      }

    } catch (err) {
      console.error('Drag preparation failed:', err)
      e.preventDefault()
      alert(`Failed to prepare audio for drag: ${err.message}`)
    }
  })

  // Dragend handler to clean up and restore UI
  document.addEventListener('dragend', e => {
    const btn = e.target.closest('[data-action="drag-stem"]')
    if (!btn) return

    const st = btn.dataset.stem
    if (!st) return

    // Restore button appearance
    btn.style.opacity = '1'

    // Clean up blob URL immediately after drag completes (DAWs should have read the data by now)
    // Reduced from 5 minutes to 1 second for better memory management
    setTimeout(() => {
      if (stemBlobUrls[st]) {
        URL.revokeObjectURL(stemBlobUrls[st])
        delete stemBlobUrls[st]
        console.log(`Cleaned up blob URL for ${st}`)
      }
    }, 1000) // 1 second - enough time for the drag operation to complete

    console.log(`Drag operation completed for ${st}`)
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
      // Handle clean button: show confirmation modal before separating
      if (action === 'clean-stem' && st) {
        console.log(`[Clean] Clean button clicked for stem: ${st}`)
        showCleanStemModal(st)
        return
      }
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
          updateDragButtonState(st); updateCleanButtonState(st)
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
          updateDragButtonState(st); updateCleanButtonState(st)
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
    const st     = target.getAttribute('data-stem')
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
function setEqValue(st, band, newVal){
  const v=Math.max(0, Math.min(100, Math.round(newVal)))
  stemEqValues[st] = { ...(stemEqValues[st] || {}), [band]: v }
  const knob=document.querySelector(`[data-eq-knob][data-stem="${st}"][data-band="${band}"]`)
  if (knob) updateEqKnobVisual(knob, v)
  updateEqReadout(st, band)
  const eq=stemNodes[st]?.eq
  if (eq) applyEqValuesToNodes(eq, stemEqValues[st])
}
function setFilterCutoff(st, newVal){
  const v=Math.max(0, Math.min(100, Math.round(newVal)))
  stemFilterValues[st] = { ...(stemFilterValues[st] || {}), cutoff: v }
  const knob=document.querySelector(`[data-filter-knob][data-stem="${st}"]`)
  if (knob) updateFilterKnobVisual(knob, v)
  updateFilterReadout(st)
  const filter=stemNodes[st]?.filter
  if (filter) applyFilterValuesToNode(filter, stemFilterValues[st])
}
function toggleFilterMode(st){
  const current=(stemFilterValues[st]||{}).mode || 'lowpass'
  const next=current==='lowpass' ? 'highpass' : 'lowpass'
  stemFilterValues[st] = { ...(stemFilterValues[st] || {}), mode: next }
  updateFilterModeButton(st)
  const filter=stemNodes[st]?.filter
  if (filter) applyFilterValuesToNode(filter, stemFilterValues[st])
}

/* =========================================================
   History UI
   ========================================================= */
function updateHistoryBadge(st){
  const badgeEls=document.querySelectorAll(`[data-history-count="${st}"]`)
  const n=stemHistory[st]?.length || 0
  badgeEls.forEach(badge => { badge.textContent=n; badge.style.opacity = n > 0 ? '1' : '0.4' })
  updateHistoryIndicator(st)
  updateCardNumberColor(st)
  updateDragButtonState(st); updateCleanButtonState(st)
}
function toggleHistoryDrawer(st, forceOpen=null){
  const drawer=document.querySelector(`[data-history-drawer="${st}"]`); if (!drawer) return
  const isOpen=drawer.classList.contains('open')
  const open=forceOpen===null ? !isOpen : !!forceOpen
  drawer.classList.toggle('open', open)
  drawer.style.maxHeight = open ? '160px' : '0px'
  if (open) renderHistoryDrawer(st)
}
function renderHistoryDrawer(st){
  const list=document.querySelector(`[data-history-list="${st}"]`); if (!list) return
  ensureStemHistory(st)
  list.innerHTML=''
  const takes=stemHistory[st]
  if (!takes.length) { list.innerHTML = `<div class="text-xs text-white/60 px-2 py-6">No takes yet. Create some!</div>`; return }
  const active=stemActiveIndex[st]
  takes.forEach((take, i) => {
    const item=document.createElement('button')
    item.className=`relative shrink-0 w-28 h-16 rounded-md border ${i===active?'border-purple-400 shadow-[0_0_0_2px_rgba(168,85,247,0.35)]':'border-white/10 hover:border-white/30'} bg-white/5 focus:outline-none focus:ring-2 focus:ring-purple-500/30`
    item.setAttribute('data-take-index', i)
    item.setAttribute('data-stem', st)
    item.title=`v${i+1} • ${take.tempo} BPM • ${formatBarsForDisplay(take.bars, DEFAULT_BARS)} bars${take.isSeparated ? ' • Separated' : ''}`

    const c=document.createElement('canvas'); c.width=112; c.height=64; c.className='w-full h-full rounded-md'
    item.appendChild(c)

    // Add separated badge if this is a separated take
    if (take.isSeparated) {
      const badge=document.createElement('div')
      badge.className='absolute top-1 right-1 px-1.5 py-0.5 text-[9px] leading-none bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded flex items-center gap-0.5'
      badge.innerHTML='<svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg><span>SEP</span>'
      item.appendChild(badge)
    }

    const meta=document.createElement('div')
    meta.className='absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[10px] leading-none bg-black/50 text-white/90 truncate'
    meta.textContent=`v${i+1} • ${take.tempo} • ${formatBarsForDisplay(take.bars, DEFAULT_BARS)}b`
    item.appendChild(meta)

    list.appendChild(item)

    // Draw a preview of the raw take without trimming or stretching.  This
    // avoids squeezing the waveform when the generation tempo differs from
    // the current master tempo.
    drawTinyWaveform(c, take.raw)
  })
}
function selectStemVersion(st, index){
  ensureStemHistory(st)
  const takes=stemHistory[st]; if (!takes || index<0 || index>=takes.length) return
  stemActiveIndex[st]=index
  const take=takes[index]
  // Use the stored tempo and bar count from the take itself to build a
  // loop that matches the original generation.  Do not reference the current
  // master tempo, as each stem may have been generated at a different BPM.
  const tempo  = take.tempo
  const bars   = take.bars
  stemRaw[st]  = take.raw
  const playbackBars = getPlaybackBars(bars, DEFAULT_BARS)
  const aligned = ensureTakeLoopReady(st, take)
  let playbackLoop = aligned?.loop
  let intentForStem = aligned?.intent
  if (!playbackLoop) {
    let headIndex = typeof take.headIndex === 'number' ? take.headIndex : detectHeadIndex(take.raw)
    headIndex = alignHeadToBeatGrid(take.raw, tempo, bars, headIndex, { strategy: getStemAlignmentStrategy(st) })
    take.headIndex = headIndex
    playbackLoop = buildLoopBufferFromRawStrict(take.raw, tempo, playbackBars, headIndex)
    intentForStem = setStemLoopIntent(st, {
      tempo: tempo,
      promptBars: bars,
      playbackBars,
      promptText: take.prompt || '',
      sampleRate: take.raw?.sampleRate,
      sourceFrames: take.raw?.length,
      sourceDurationSec: take.raw?.duration
    })
  } else if (intentForStem) {
    setStemLoopIntent(st, intentForStem)
  }
  stemLoop[st] = playbackLoop
  stemLoopDuration[st] = playbackLoop.duration
  // Invalidate cached WAV since we've switched to different audio
  invalidateStemCache(st)

  // Extract PCM from the selected version for drag-and-drop
  try {
    clearStemPCM(st) // Clear any existing PCM data before storing new
    const pcmData = extractPCMFromAudioBuffer(playbackLoop)
    storeStemPCM(st, pcmData, playbackLoop.sampleRate, playbackLoop.numberOfChannels, `pcm_${playbackLoop.sampleRate}`)
    console.log(`[Version] Extracted PCM for ${st} v${index+1}: ${(pcmData.byteLength / 1024).toFixed(1)}KB`)
    scheduleAutoDownloadForStem(st)
  } catch (pcmErr) {
    console.warn(`[Version] Failed to extract PCM for ${st}:`, pcmErr.message)
  }
  const canvas=document.querySelector(`[data-stem="${st}"] .waveform-canvas`)
  if (canvas) {
    const cfg=stemConfigs[st]; drawWaveform(canvas, stemLoop[st], `rgb(${getColorRGB(cfg.color)})`)
  }
  const statusEl=document.querySelector(`[data-stem="${st}"] .status-line`)
  if (statusEl) statusEl.textContent=`Selected v${index+1} (${tempo} BPM • ${formatBarsForDisplay(bars, DEFAULT_BARS)} bars)`
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
  updateDragButtonState(st); updateCleanButtonState(st)
  updateTempoIndicator(st)
}

/* =========================================================
   App init + navigation
   ========================================================= */
function showPage(pageId){
  const pages=['login-page', 'selection-page', 'techno-generator-page']
  pages.forEach(id => { const page=document.getElementById(id); if (page) page.classList.add('hidden') })
  const targetPage=document.getElementById(pageId); if (targetPage) targetPage.classList.remove('hidden')

  // Show bottom player only on Studio page
  const playerBar=document.getElementById('playerBar')
  const showDock = pageId === 'techno-generator-page'
  if (playerBar) playerBar.classList.toggle('hidden', !showDock)
  if (!showDock) setMixerOpen(false)
}
function setupNavigationListeners(){
  const loginBtn = document.getElementById('loginBtn')
  if (loginBtn) loginBtn.addEventListener('click', () => { showPage('selection-page') })
  const launchTechno = document.getElementById('launchTechno')
  if (launchTechno) launchTechno.addEventListener('click', () => { showPage('techno-generator-page'); initTechnoGenerator() })
  const launchHipHop = document.getElementById('launchHipHop'); if (launchHipHop) launchHipHop?.addEventListener('click', () => {})
  const launchHouse = document.getElementById('launchHouse'); if (launchHouse) launchHouse?.addEventListener('click', () => {})
}

/* =========================================================
   Add Instrument Functionality
   ========================================================= */

function createAddInstrumentButton(container) {
  const plusButton = document.createElement('div')
  plusButton.id = 'add-instrument-button'
  plusButton.className = 'glass card-border rounded-2xl p-3 sm:p-5 transition-all duration-300 hover:scale-[1.02] select-none cursor-pointer flex items-center justify-center min-h-[200px]'
  plusButton.innerHTML = `
    <div class="flex flex-col items-center gap-2">
      <div class="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
        <i data-lucide="plus" class="w-6 h-6 text-white/70"></i>
      </div>
      <span class="text-xs text-white/70">Add Instrument</span>
    </div>
  `

  plusButton.addEventListener('click', () => {
    showInstrumentDropdown(plusButton)
  })

  container.appendChild(plusButton)
  updatePlusButtonVisibility()
}

function showInstrumentDropdown(buttonElement) {
  // Remove existing dropdown if any
  const existingDropdown = document.getElementById('instrument-dropdown')
  if (existingDropdown) {
    existingDropdown.remove()
    return
  }

  // Get available instruments (not yet visible)
  const availableInstruments = STEM_ORDER.filter(st => !visibleInstruments.includes(st))

  if (availableInstruments.length === 0) {
    return
  }

  // Create dropdown
  const dropdown = document.createElement('div')
  dropdown.id = 'instrument-dropdown'
  dropdown.className = 'absolute z-50 mt-2 w-56 bg-black/90 border border-white/20 rounded-xl shadow-2xl backdrop-blur-lg'

  let dropdownHTML = '<div class="p-2 space-y-1">'
  availableInstruments.forEach(st => {
    const cfg = stemConfigs[st]
    dropdownHTML += `
      <button class="w-full px-3 py-2 text-left text-sm text-white rounded-lg hover:bg-white/10 transition flex items-center gap-2"
              data-add-instrument="${st}">
        <div class="w-3 h-3 rounded-full bg-${cfg.color}-500"></div>
        <span>${cfg.name}</span>
      </button>
    `
  })
  dropdownHTML += '</div>'

  dropdown.innerHTML = dropdownHTML

  // Position dropdown to the right of the button
  const rect = buttonElement.getBoundingClientRect()
  dropdown.style.position = 'fixed'
  dropdown.style.top = `${rect.top}px`
  dropdown.style.left = `${rect.right + 12}px`

  // Ensure dropdown stays within viewport bounds
  setTimeout(() => {
    const dropdownRect = dropdown.getBoundingClientRect()
    if (dropdownRect.right > window.innerWidth) {
      // If dropdown overflows right, position it to the left of the button instead
      dropdown.style.left = `${rect.left - dropdownRect.width - 12}px`
    }
  }, 0)

  document.body.appendChild(dropdown)

  // Add click handlers for each instrument
  availableInstruments.forEach(st => {
    const btn = dropdown.querySelector(`[data-add-instrument="${st}"]`)
    if (btn) {
      btn.addEventListener('click', () => {
        addInstrument(st)
        dropdown.remove()
      })
    }
  })

  // Close dropdown when clicking outside
  const closeDropdown = (e) => {
    if (!dropdown.contains(e.target) && !buttonElement.contains(e.target)) {
      dropdown.remove()
      document.removeEventListener('click', closeDropdown)
    }
  }

  setTimeout(() => {
    document.addEventListener('click', closeDropdown)
  }, 10)
}

function addInstrument(stemId) {
  if (visibleInstruments.includes(stemId)) {
    return
  }

  // Add to visible instruments at the end
  visibleInstruments.push(stemId)

  // Get the card and container
  const card = document.querySelector(`[data-stem="${stemId}"]`)
  const container = document.getElementById('stem-container')
  const plusButton = document.getElementById('add-instrument-button')

  if (card && container) {
    // Show the card
    card.style.display = ''

    // Move the card to the end, right before the plus button
    if (plusButton) {
      container.insertBefore(card, plusButton)
    } else {
      container.appendChild(card)
    }

    // Update card number to reflect new position
    updateAllCardNumbers()
  }

  // Update plus button visibility
  updatePlusButtonVisibility()

  // Reinitialize lucide icons for the newly shown card
  window.lucide?.createIcons()

  console.log(`✅ Added instrument: ${stemId}`)
}

function updateAllCardNumbers() {
  // Update card numbers to reflect the current order in visibleInstruments
  visibleInstruments.forEach((st, index) => {
    const cardNumEl = document.querySelector(`[data-card-number="${st}"]`)
    if (cardNumEl) {
      cardNumEl.textContent = index + 1
    }
    // Also update mixer number if it exists
    const mixNumEl = document.querySelector(`[data-mix-number="${st}"]`)
    if (mixNumEl) {
      mixNumEl.textContent = index + 1
    }
  })
}

function updatePlusButtonVisibility() {
  const plusButton = document.getElementById('add-instrument-button')
  if (!plusButton) return

  // Hide plus button if all instruments are visible
  if (visibleInstruments.length >= STEM_ORDER.length) {
    plusButton.style.display = 'none'
  } else {
    plusButton.style.display = ''
  }
}

function initTechnoGenerator(){
  // Prevent duplicate initialization
  if (technoGeneratorInitialized) {
    console.log('🎛️ Techno Generator already initialized')
    return
  }

  console.log('🎛️ Initializing Techno Generator…')
  injectGlobalStyles()
  initializeStemControlValues()

  // Build cards
  const container = document.getElementById('stem-container')
  if (container && PROMPTS_MODE === 'builder') {
    container.innerHTML = ''

    // First, add visible instruments in their specified order
    visibleInstruments.forEach(st => {
      const card = createBuilderStemCard(st, stemConfigs[st])
      container.appendChild(card)
    })

    // Then, add hidden instruments for remaining stems
    STEM_ORDER.forEach(st => {
      if (!visibleInstruments.includes(st)) {
        const card = createBuilderStemCard(st, stemConfigs[st])
        card.style.display = 'none'
        container.appendChild(card)
      }
    })

    // Update card numbers based on visibleInstruments order
    updateAllCardNumbers()

    // Add plus button to add more instruments
    createAddInstrumentButton(container)
  }

  setupEventListeners()
  window.lucide?.createIcons()

  // Mark as initialized
  technoGeneratorInitialized = true

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
    updateDragButtonState(st); updateCleanButtonState(st)
  })
  // Present the session setup modal if settings have not been chosen
  // yet.  This ensures the user sets the master tempo, bars and key
  // before generating any stems.  The modal will only appear once
  // per session.
  showSessionSetupModal()
  console.log('✅ App ready (session ' + SESSION_TAG + ')')
}

export async function initApp(){
  console.log('🎬 Initializing App Navigation System…')

  // Initialize WAV encoder worker for non-blocking audio encoding
  initWavEncoder()
  await initializeAutoDownloadSupport()

  setupNavigationListeners()
  // Start directly on the genre selection page instead of the login page
  showPage('selection-page')
  window.lucide?.createIcons()
  setupHelpModal()
  // Initialise the user menu in the header
  setupUserMenu()
  console.log('✅ Navigation system ready')

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    terminateWavEncoder()
  })
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
function injectGlobalStyles(){
  if (document.getElementById('sg-global-styles')) return
  const style=document.createElement('style')
  style.id='sg-global-styles'
  style.textContent=
    `@keyframes soft-pulse-glow {\n      0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.28), 0 0 16px rgba(255,255,255,0.12); transform: translateY(0) scale(1); }\n      50%      { box-shadow: 0 0 0 12px rgba(255,255,255,0), 0 0 22px rgba(255,255,255,0.22); transform: translateY(-0.5px) scale(1.012); }\n    }\n    #playBtn { animation: soft-pulse-glow 2.6s ease-in-out infinite; transition: transform 160ms ease, box-shadow 160ms ease; will-change: transform, box-shadow; }\n    #playBtn:hover { transform: translateY(-1px) scale(1.02); }\n    #playBtn:active { transform: translateY(0); }\n    .sg-mix-card.sg-glow { animation: soft-pulse-glow 2.6s ease-in-out infinite; }\n    .sg-toggle-active { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.35); }`;
  document.head.appendChild(style)
}

/* =========================================================
   Help Modal setup
   ========================================================= */
function setupHelpModal(){
  const helpBtn = document.getElementById('helpBtn')
  const helpModal = document.getElementById('helpModal')
  const overlay = document.getElementById('helpModalOverlay')
  const closeBtn = document.getElementById('helpModalCloseBtn')
  if (!helpModal) return
  function openModal(){
    helpModal.classList.remove('hidden')
    requestAnimationFrame(() => {
      helpModal.style.opacity = '1'
    })
    // Disable body scroll while help modal is open
    document.body.style.overflow = 'hidden'
  }
  function closeModal(){
    helpModal.style.opacity = '0'
    setTimeout(() => {
      helpModal.classList.add('hidden')
      // Restore body scroll when help modal is closed
      document.body.style.overflow = ''
    }, 300)
  }
  if (helpBtn) helpBtn.addEventListener('click', openModal)
  if (overlay) overlay.addEventListener('click', closeModal)
  if (closeBtn) closeBtn.addEventListener('click', closeModal)
}

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
    window.lucide?.createIcons()
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
function showSessionSetupModal() {
  if (sessionSetupDone) return
  const modal = document.getElementById('sessionSetupModal')
  if (!modal) return
  const overlay = document.getElementById('sessionSetupOverlay')
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
  // Update displayed tempo when slider moves
  tempoSlider.addEventListener('input', e => {
    const val = Math.round(Number(e.target.value) || DEFAULT_TEMPO)
    tempoValue.textContent = String(val)
  })
  // If a cancel button exists (legacy HTML), wire it to simply hide the modal.
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      modal.style.opacity = '0'
      setTimeout(() => { modal.classList.add('hidden') }, 300)
      document.body.style.overflow = ''
    })
  }
  // Save button applies settings and locks them
  saveBtn.addEventListener('click', () => {
    const tempoVal = Math.round(Number(tempoSlider.value) || DEFAULT_TEMPO)
    const barsVal = parseInt(barsSelector.value, 10) || DEFAULT_BARS
    const rootText = String(rootSelector.value || 'A')
    // Determine base letter and accidental from the root selection
    let rootBase = rootText.replace(/[♯♭]/g, '').toUpperCase()
    const selectedAccidental = accidentalSelector.value
    const modeVal = String(modeSelector.value || 'Minor')
    // Set master values
    stemControlValues.master.tempo = tempoVal
    stemControlValues.master.bars = barsVal
    stemControlValues.master.rootBase = rootBase
    stemControlValues.master.accidental = selectedAccidental
    stemControlValues.master.mode = modeVal
    sessionSetupDone = true
    applySessionSettingsToUI()
    // Hide modal
    modal.style.opacity = '0'
    setTimeout(() => { modal.classList.add('hidden') }, 300)
    // Restore page scrolling when the session setup modal is closed
    document.body.style.overflow = ''
  })
  // Show the modal
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.style.opacity = '1'
  })
  // Disable page scrolling while the session setup modal is visible
  document.body.style.overflow = 'hidden'
}

// Apply the session settings to the UI: update the bottom controls
// with the locked values and disable them so the user cannot modify
// them mid-session.  Also refresh the tempo indicators on the
// waveform cards and update the history drawer where needed.
function applySessionSettingsToUI() {
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
    const rootName = getRootText()
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
  const st   = dial.getAttribute('data-stem')
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
  const st   = dial.getAttribute('data-stem')
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