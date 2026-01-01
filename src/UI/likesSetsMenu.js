import { drawTinyWaveform, getColorRGB } from '../Utilities/waveform.js'
import { getStemStates, getAllStemStates, deleteStemState, getUserStems, deleteStem, upsertUserLike, removeUserLike } from '../Auth/stemApi.js'
import { supabase } from '../Auth/index.js'
import { encodeWAVSync } from '../audioEncoder.js'
import { bufferToWavAndDownload } from '../DownloadAudio/index.js'

const KEY_OPTIONS = [
  'Any Key',
  'C Major', 'C Minor', 'C# Major', 'C# Minor', 'D Major', 'D Minor', 'D# Major', 'D# Minor',
  'E Major', 'E Minor', 'F Major', 'F Minor', 'F# Major', 'F# Minor', 'G Major', 'G Minor',
  'G# Major', 'G# Minor', 'A Major', 'A Minor', 'A# Major', 'A# Minor', 'B Major', 'B Minor'
]

const DEFAULT_FILTERS = {
  bpmMin: 0,
  bpmMax: 999,
  key: 'Any Key',
  stars: null
}

const LS_KEY_LIKES = 'likedTracks'
const likedTracks = []
let savedSetsCache = []
let savedStemsCache = []
let stemStatesCache = []
let dropdownEl = null
let favoritesPageRefs = null
let currentTab = 'likes'
let filters = { ...DEFAULT_FILTERS }
let sessionInfoProvider = () => ({ bpm: 130, key: 'A Minor' })
let loadSetHandler = null
let anchorButtons = []
let overlayEl = null
let insertLikeHandler = null
let playLikeHandler = null
let stopPreviewHandler = null
let activePreviewId = null
let previewStopListenerAttached = false
let cloudSyncInProgress = false
let stemStatesSyncInProgress = false
let savedStemsSyncInProgress = false
const externalLikesContainers = []

let favoritesTabListenersAttached = false
let likesScope = 'current'
let setsScope = 'current'
let stemsScope = 'all'
let dropdownContentRendered = false
let favoritesPageRendered = false


// Shared supabase instance is imported from ../Auth/index.js
let waveformAudioContext = null
async function ensureWaveformAudioContext() {
  if (!waveformAudioContext) {
    waveformAudioContext = new (window.AudioContext || window.webkitAudioContext)()
  }
  // Essential for decoded audio to actually be playable/renderable in some browsers
  if (waveformAudioContext.state === 'suspended') {
    await waveformAudioContext.resume()
  }
  return waveformAudioContext
}



async function loadLikeAudio(item) {
  if (!item) return null

  const ctx = await ensureWaveformAudioContext()

  // 0. Direct audio data check (from DB bytea/base64)
  if (item.audio_data) {
    try {
      let arrayBuffer = null
      if (typeof item.audio_data === 'string') {
        if (item.audio_data.startsWith('\\x')) {
          // PostgreSQL Hex format: \x0102...
          const hex = item.audio_data.substring(2)
          const len = hex.length / 2
          const u8 = new Uint8Array(len)
          for (let i = 0; i < len; i++) {
            u8[i] = parseInt(hex.substr(i * 2, 2), 16)
          }
          arrayBuffer = u8.buffer
        } else {
          // Assume Base64
          try {
            const binaryString = atob(item.audio_data)
            const u8 = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              u8[i] = binaryString.charCodeAt(i)
            }
            arrayBuffer = u8.buffer
          } catch (b64Err) {
            console.warn('loadLikeAudio: Failed to parse as base64', b64Err)
          }
        }
      } else if (item.audio_data instanceof ArrayBuffer || item.audio_data.buffer instanceof ArrayBuffer) {
        arrayBuffer = item.audio_data.buffer || item.audio_data
      }

      if (arrayBuffer && arrayBuffer.byteLength > 0) {
        // Use slice(0) to pass a copy to avoid neutered buffer issues in some contexts
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
        item.audioBuffer = decoded
        return decoded
      }
    } catch (err) {
      console.error('loadLikeAudio: Failed to decode audio_data', err)
      // If decoding failed, maybe it's not a valid audio format or corrupted
    }
  }

  // 1. Storage bucket download
  if (!item.audioKey) return null

  // Direct URL check
  if (/^https?:\/\//i.test(item.audioKey)) {
    try {
      const res = await fetch(item.audioKey)
      if (res.ok) {
        const buf = await res.arrayBuffer()
        const decoded = await ctx.decodeAudioData(buf)
        item.audioBuffer = decoded
        return decoded
      }
    } catch (e) {
      console.error('loadLikeAudio: URL fetch failed', e)
    }
  }

  if (!supabase) return null

  let storagePath = item.audioKey

  // Decide primary bucket based on item metadata
  // Stems usually have stem_type, while Likes might not (or have it but we prioritize the liked-audios bucket)
  const stemsBucket = (import.meta.env.VITE_SUPABASE_AUDIO_BUCKET || 'audio-files').trim()
  const likesBucket = (import.meta.env.VITE_SUPABASE_LIKES_BUCKET || 'liked-audios').trim()

  // If item is a stem from the stems table (has tempo/bars/stem_type)
  const isDedicatedStem = !!(item.stem_type || (item.tempo && item.bars))
  const primaryBucket = isDedicatedStem ? stemsBucket : likesBucket
  const secondaryBucket = isDedicatedStem ? likesBucket : stemsBucket

  async function tryDownload(bucketName) {
    let cleanPath = storagePath
    if (cleanPath.startsWith(bucketName + '/')) {
      cleanPath = cleanPath.replace(bucketName + '/', '')
    }
    // General cleanup for other common bucket prefixes
    ['audio-files', 'liked-audios', 'unsaved-audios'].forEach(b => {
      if (cleanPath.startsWith(b + '/')) cleanPath = cleanPath.replace(b + '/', '')
    })

    console.log(`loadLikeAudio: Attempting download from [${bucketName}]:`, cleanPath)
    const { data, error } = await supabase.storage.from(bucketName).download(cleanPath)
    if (error) throw error

    const buf = await data.arrayBuffer()
    return await ctx.decodeAudioData(buf)
  }

  try {
    const decoded = await tryDownload(primaryBucket)
    item.audioBuffer = decoded
    return decoded
  } catch (primaryErr) {
    console.warn(`loadLikeAudio: Failed primary bucket [${primaryBucket}], trying [${secondaryBucket}]...`, primaryErr.message)
    try {
      const decoded = await tryDownload(secondaryBucket)
      item.audioBuffer = decoded
      return decoded
    } catch (secondaryErr) {
      console.error('loadLikeAudio: All download attempts failed', secondaryErr)
      return null
    }
  }
}

function ensureDropdownContentRendered() {
  if (dropdownContentRendered) return
  dropdownContentRendered = true

  // Trigger initial cloud syncs
  syncLikesWithCloud()
  syncStemStates()
  syncSavedStems()

  renderFilters()
  renderLikes()
  renderSets()
}



export function initLikesSetsMenu({ getSessionInfo, onLoadSet, onInsertLike, onPlayLike, onStopPreview } = {}) {
  sessionInfoProvider = getSessionInfo || sessionInfoProvider
  loadSetHandler = onLoadSet || null
  insertLikeHandler = onInsertLike || insertLikeHandler
  playLikeHandler = onPlayLike || playLikeHandler
  stopPreviewHandler = onStopPreview || stopPreviewHandler

  anchorButtons = Array.from(document.querySelectorAll('[data-likes-menu-toggle]'))
  if (!anchorButtons.length) return

  // No longer loading from localStorage as primary source.
  // We will fetch from Cloud instead to ensure data integrity.
  /*
  try {
    const raw = localStorage.getItem(LS_KEY_LIKES)
    if (raw) {
      ...
    }
  } catch { }
  */


  // buildDropdown() // Still build the element structure
  // but don't populate content until opened
  buildDropdown()
  attachAnchorHandlers()
  // renderFilters()
  // renderLikes()
  // renderSets()

  document.addEventListener('click', handleOutsideClick)
  document.addEventListener('keydown', handleEscape)
  attachPreviewStopListener()

  try {
    window.addEventListener('authStateChanged', async (e) => {
      const ev = e.detail?.event
      if (ev === 'SIGNED_IN') {
        await syncLikesWithCloud()
      }
    })
  } catch { }
}

export function initFavoritesPageView({ getSessionInfo, onLoadSet, onInsertLike, onPlayLike, onStopPreview } = {}) {
  sessionInfoProvider = getSessionInfo || sessionInfoProvider
  loadSetHandler = onLoadSet || loadSetHandler
  insertLikeHandler = onInsertLike || insertLikeHandler
  playLikeHandler = onPlayLike || playLikeHandler
  stopPreviewHandler = onStopPreview || stopPreviewHandler

  favoritesPageRefs = {
    likesFilters: document.getElementById('favoritesLikesFilters'),
    likesList: document.getElementById('favoritesLikesList'),
    setsFilters: document.getElementById('favoritesSetsFilters'),
    setsList: document.getElementById('favoritesSetsList'),
    likesSection: document.getElementById('favoritesLikesSection'),
    setsSection: document.getElementById('favoritesSetsSection'),
    stemsFilters: document.getElementById('favoritesStemsFilters'),
    stemsList: document.getElementById('favoritesStemsList'),
    stemsSection: document.getElementById('favoritesStemsSection'),
    stats: document.getElementById('favoritesStats'),
    tabButtons: Array.from(document.querySelectorAll('.favorites-tab-btn'))
  }

  attachFavoritesTabHandlers()
  attachFavoritesScrollLinks()
  attachSetsSubTabHandlers()
  // renderFilters()
  // renderLikes()
  // renderSets()
  // renderSavedStems()
  // switchTab(currentTab)
  attachPreviewStopListener()
  // Initial syncs moved to lazy loading when favorites page is shown
  refreshFavoritesUI()
}


export function refreshFavoritesUI() {
  if (!favoritesPageRendered) {
    favoritesPageRendered = true
    syncStemStates()
    syncSavedStems()
    switchTab(currentTab)
  }
  renderFilters()
  renderLikes()
  renderSets()
  renderSavedStems()
}


export function getLikedTracks() {
  return likedTracks.map((t) => ({ ...t }))
}

export function addLikesContainer(el, variant = 'page') {
  if (!el) return
  externalLikesContainers.push({ el, variant })
  renderLikes()
}

export function removeLikesContainer(el) {
  const idx = externalLikesContainers.findIndex((c) => c.el === el)
  if (idx >= 0) {
    externalLikesContainers.splice(idx, 1)
    renderLikes()
  }
}

export async function toggleLikeForStem(stemId, track) {
  console.log('toggleLikeForStem called', { stemId, track })
  if (!stemId || !track) return false
  const takeIndex = track.takeIndex ?? -1
  const existingIndex = likedTracks.findIndex((item) => item.stemId === stemId && item.takeIndex === takeIndex)

  if (existingIndex >= 0) {
    // UNLIKE
    console.log('Unliking stem', stemId)
    likedTracks.splice(existingIndex, 1)
    renderLikes()
    notifyLikeChange(stemId)
    persistLikesToLocalStorage()

    // Sync removal to DB
    removeUserLike(stemId, takeIndex).catch(err => console.error('Failed to remove like from DB:', err))

    return false
  }

  // LIKE
  console.log('Liking stem', stemId)
  const newLike = {
    id: `${stemId}-${takeIndex}`,
    stemId,
    takeIndex,
    stemName: track.stemName || stemId,
    stemColor: track.stemColor || 'purple',
    bpm: track.bpm || sessionInfoProvider().bpm || 130,
    key: track.key || sessionInfoProvider().key || 'A Minor',
    bars: track.bars || null,
    audioBuffer: track.audioBuffer || null,
    audioKey: track.audioKey || null,
    sessionSettingId: resolveSessionId(),
    timestamp: Date.now(),
    rating: 3
  }

  likedTracks.unshift(newLike)
  renderLikes()
  notifyLikeChange(stemId)
  persistLikesToLocalStorage()

  // Sync add to DB (Async upload await)
  try {
    let audioKey = newLike.audioKey
    const hasBuffer = !!newLike.audioBuffer
    const needsUpload = !audioKey || audioKey.includes('unsaved')

    console.log('Upload check:', { hasBuffer, audioKey, })

    // User requested strictly extracting/recording audio from memory then uploading
    // without fetching from unsaved-audio bucket.
    if (hasBuffer) {
      console.log('Encoding and uploading from RAM buffer...')
      let blob
      try {
        // Use the robust WAV encoder (same as processStemsInBackground/saveCurrentStems)
        blob = encodeWAVSync(newLike.audioBuffer)
      } catch (encErr) {
        console.error('WAV Encoding failed:', encErr)
        throw encErr
      }

      const filename = `liked_${stemId}_${takeIndex}_${Date.now()}.wav`
      const bucket = (import.meta.env.VITE_SUPABASE_LIKES_BUCKET || 'liked-audios').trim()

      console.log('Uploading to bucket:', bucket, 'filename:', filename)

      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(filename, blob, { contentType: 'audio/wav', upsert: false })

      if (error) {
        console.error('Upload failed details:', error)
        // Don't throw here to allow saving metadata even if audio upload fails? 
        // No, usually we want consistency. But user might want at least the card.
        // For now, logging error is sufficient.
      } else {
        console.log('Upload successful', data)
        audioKey = data.path
        newLike.audioKey = audioKey

        // Update local memory
        const idx = likedTracks.findIndex(l => l.id === newLike.id)
        if (idx !== -1) {
          likedTracks[idx].audioKey = audioKey
          persistLikesToLocalStorage()
        }
      }
    } else {
      // Fallback removed as per user request
      console.warn('Cannot upload: No audio buffer available in memory (Active Version must be loaded).')
    }

    const res = await upsertUserLike({
      ...newLike,
      audioKey: audioKey
    })

    if (!res.success) {
      console.error('Failed to save like to DB:', res.error)
    } else {
      console.log('Like saved to DB', res)
    }
  } catch (err) {
    console.error('Error uploading/saving like:', err)
  }

  return true
}

export function isTrackLiked(stemId, takeIndex) {
  return likedTracks.some((item) => item.stemId === stemId && item.takeIndex === takeIndex)
}

export function updateLikeAudioKey(stemId, takeIndex, audioKey) {
  const track = likedTracks.find(t => t.stemId === stemId && t.takeIndex === takeIndex)
  if (track) {
    track.audioKey = audioKey
    persistLikesToLocalStorage()
    // Don't need to re-render immediately as audioKey is internal, 
    // but if we were showing it or using it for active state, we might.
    // However, ensure future syncs pick it up.
    console.log(`Updated audioKey for liked track ${stemId} take ${takeIndex}`)
  }
}

export function syncSavedSetsMenu(list) {
  savedSetsCache = Array.isArray(list) ? list : []

  // Ensure all sets have default rating
  savedSetsCache.forEach(set => {
    if (!set.metadata) set.metadata = {}
    if (set.metadata.rating === undefined) {
      set.metadata.rating = 3
    }
  })

  renderSets()
}

export function setLikeRating(trackId, rating) {
  const track = likedTracks.find(t => t.id === trackId)
  if (track) {
    track.rating = Math.max(1, Math.min(5, rating))
    renderLikes()
  }
}

export function setSetRating(setIndex, rating) {
  if (setIndex >= 0 && setIndex < savedSetsCache.length) {
    const set = savedSetsCache[setIndex]
    if (!set.metadata) set.metadata = {}
    set.metadata.rating = Math.max(1, Math.min(5, rating))
    renderSets()
  }
}

export function setSetName(setIndex, newName) {
  if (setIndex >= 0 && setIndex < savedSetsCache.length) {
    const set = savedSetsCache[setIndex]
    if (!set.metadata) set.metadata = {}
    set.metadata.name = newName.trim()

    // Dispatch event to notify app.js to update its savedSets array
    window.dispatchEvent(new CustomEvent('setRenamed', {
      detail: { setIndex, newName: newName.trim() }
    }))

    renderSets()
    return true
  }
  return false
}

function renderStarRating(rating = 3, dataAttr = '', size = 'sm', interactive = false) {
  const starSize = size === 'md' ? 'w-4 h-4' : (size === 'sm-plus' ? 'w-[15px] h-[15px]' : 'w-3 h-3')
  const gapSize = size === 'md' ? 'gap-0.5' : (size === 'sm-plus' ? 'gap-[3px]' : 'gap-[2px]')
  const cursorClass = interactive ? 'cursor-pointer' : ''
  const hoverClass = interactive ? 'hover:scale-110 transition-transform' : ''

  const stars = Array.from({ length: 5 }, (_, i) => {
    const starNum = i + 1
    const isFilled = starNum <= rating
    const fillClass = isFilled ? 'fill-yellow-400 text-yellow-400' : 'text-white/20'
    const dataAttrStr = dataAttr ? `data-star-rating="${dataAttr}" data-star-value="${starNum}"` : ''

    return `
      <svg ${dataAttrStr}
        class="star-icon ${starSize} ${fillClass} ${cursorClass} ${hoverClass}"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        stroke-width="1"
        aria-label="${starNum} star${starNum > 1 ? 's' : ''}">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
    `
  }).join('')

  return `<div class="flex items-center ${gapSize}">${stars}</div>`
}

function attachStarHandlers(container, type) {
  if (!container) return

  container.querySelectorAll('[data-star-rating]').forEach(star => {
    star.addEventListener('click', (e) => {
      e.stopPropagation()
      const target = star.getAttribute('data-star-rating')
      const value = parseInt(star.getAttribute('data-star-value'), 10)

      if (type === 'like') {
        setLikeRating(target, value)
      } else if (type === 'set') {
        const setIndex = parseInt(target, 10)
        setSetRating(setIndex, value)
      } else if (type === 'filter') {
        // Toggle filter behavior
        if (filters.stars === value) {
          filters.stars = null
        } else {
          filters.stars = value
        }
        renderFilters()
        renderLikes()
        renderSets()
      }
    })

    // Optional: hover preview
    if (type !== 'filter') {
      star.addEventListener('mouseenter', () => {
        const value = parseInt(star.getAttribute('data-star-value'), 10)
        const parent = star.closest('.star-rating-container')
        if (parent) {
          parent.querySelectorAll('.star-icon').forEach((s, i) => {
            if (i < value) {
              s.classList.add('text-yellow-400', 'fill-yellow-400')
              s.classList.remove('text-white/20')
            } else {
              s.classList.remove('text-yellow-400', 'fill-yellow-400')
              s.classList.add('text-white/20')
            }
          })
        }
      })

      star.addEventListener('mouseleave', () => {
        const parent = star.closest('.star-rating-container')
        const currentRating = parseInt(parent?.dataset.currentRating || 3)
        if (parent) {
          parent.querySelectorAll('.star-icon').forEach((s, i) => {
            if (i < currentRating) {
              s.classList.add('text-yellow-400', 'fill-yellow-400')
              s.classList.remove('text-white/20')
            } else {
              s.classList.remove('text-yellow-400', 'fill-yellow-400')
              s.classList.add('text-white/20')
            }
          })
        }
      })
    }
  })
}

function attachRenameHandlers(container) {
  if (!container) return

  // Handle rename button click
  container.querySelectorAll('[data-rename-set]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const idx = btn.getAttribute('data-rename-set')
      const card = container.querySelector(`[data-set-card="${idx}"]`)
      if (!card) return

      const nameDisplay = card.querySelector(`[data-set-name-display="${idx}"]`)
      const renameEditor = card.querySelector(`[data-rename-editor="${idx}"]`)
      const renameInput = card.querySelector(`[data-rename-input="${idx}"]`)
      const renameBtn = card.querySelector(`[data-rename-set="${idx}"]`)

      if (nameDisplay && renameEditor && renameInput && renameBtn) {
        nameDisplay.classList.add('hidden')
        renameEditor.classList.remove('hidden')
        renameBtn.disabled = true
        renameBtn.classList.add('opacity-50', 'cursor-not-allowed')
        renameInput.focus()
        renameInput.select()
      }
    })
  })

  // Handle save button click
  container.querySelectorAll('[data-rename-save]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const idx = parseInt(btn.getAttribute('data-rename-save'), 10)
      const card = container.querySelector(`[data-set-card="${idx}"]`)
      if (!card) return

      const renameInput = card.querySelector(`[data-rename-input="${idx}"]`)
      const newName = renameInput?.value.trim()

      if (newName && newName.length > 0) {
        const success = setSetName(idx, newName)
        if (success) {
          showToast('Set renamed successfully')
        }
      } else {
        showToast('Set name cannot be empty', 'error')
      }
    })
  })

  // Handle cancel button click
  container.querySelectorAll('[data-rename-cancel]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const idx = btn.getAttribute('data-rename-cancel')
      const card = container.querySelector(`[data-set-card="${idx}"]`)
      if (!card) return

      const nameDisplay = card.querySelector(`[data-set-name-display="${idx}"]`)
      const renameEditor = card.querySelector(`[data-rename-editor="${idx}"]`)
      const renameBtn = card.querySelector(`[data-rename-set="${idx}"]`)

      if (nameDisplay && renameEditor && renameBtn) {
        nameDisplay.classList.remove('hidden')
        renameEditor.classList.add('hidden')
        renameBtn.disabled = false
        renameBtn.classList.remove('opacity-50', 'cursor-not-allowed')
      }
    })
  })

  // Handle Enter key to save
  container.querySelectorAll('[data-rename-input]').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const idx = input.getAttribute('data-rename-input')
        const saveBtn = container.querySelector(`[data-rename-save="${idx}"]`)
        if (saveBtn) saveBtn.click()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        const idx = input.getAttribute('data-rename-input')
        const cancelBtn = container.querySelector(`[data-rename-cancel="${idx}"]`)
        if (cancelBtn) cancelBtn.click()
      }
    })
  })
}

function showToast(message, type = 'success') {
  // Simple toast implementation - can be improved later
  const toastEl = document.createElement('div')
  toastEl.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg text-sm z-50 transition-opacity ${type === 'error'
    ? 'bg-red-500/90 border border-red-400/60'
    : 'bg-green-500/90 border border-green-400/60'
    }`
  toastEl.textContent = message
  document.body.appendChild(toastEl)

  setTimeout(() => {
    toastEl.style.opacity = '0'
    setTimeout(() => toastEl.remove(), 300)
  }, 2000)
}

function generateBPMOptions(selected, min = 0, max = 300) {
  const options = []
  // If the range is huge, maybe we shouldn't generate every single integer option?
  // Let's generate common ranges or just keep it simple for now but cap the UI options to something reasonable if min/max are wide.
  // For the dropdown, 0 to 999 is too many options. 
  // Let's stick to a reasonable UI range for the dropdowns, but allow the internal filter to be wider.
  // We'll generate 50-200 for the UI dropdowns by default, but if the selected value is outside, we add it.

  const uiMin = Math.max(0, min === 0 ? 50 : min)
  const uiMax = Math.min(300, max === 999 ? 200 : max)

  // Only add if not 0 (handled manually as "Any")
  if (selected < uiMin && selected !== 0) options.push(`<option value="${selected}" selected>${selected} BPM</option>`)

  for (let bpm = uiMin; bpm <= uiMax; bpm++) {
    const isSelected = bpm === selected ? 'selected' : ''
    options.push(`<option value="${bpm}" ${isSelected}>${bpm} BPM</option>`)
  }

  // Only add if not 999 (handled manually as "Any")
  if (selected > uiMax && selected !== 999) options.push(`<option value="${selected}" selected>${selected} BPM</option>`)

  return options.join('')
}

function buildDropdown() {
  if (dropdownEl) return
  const existing = document.getElementById('likesSetsDropdown')
  if (existing) {
    dropdownEl = existing
    return
  }
  dropdownEl = document.createElement('div')
  dropdownEl.id = 'likesSetsDropdown'
  dropdownEl.className = 'fixed z-50 w-full max-w-md sm:max-w-lg player-surface card-border border border-white/10 rounded-2xl shadow-2xl hidden opacity-0 transition-all duration-200'
  dropdownEl.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <div class="inline-flex bg-white/5 border border-white/10 rounded-lg overflow-hidden text-sm">
        <button data-tab="likes" class="tab-btn px-3 py-1.5 font-medium">Likes</button>
        <button data-tab="sets" class="tab-btn px-3 py-1.5 text-white/70">Sets</button>
        <button data-tab="stems" class="tab-btn px-3 py-1.5 text-white/70">Stems</button>
      </div>
      <button data-close-menu class="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center" aria-label="Close menu">
        <i data-lucide="x" class="w-4 h-4"></i>
      </button>
    </div>
    <div class="p-4 space-y-3">
      <div id="likesFilters" class="filter-panel"></div>
      <div id="likesList" class="max-h-80 overflow-y-auto space-y-2"></div>
      <div id="setsPanel" class="hidden space-y-3">
        <div id="setsFilters" class="filter-panel"></div>
        <div id="setsList" class="max-h-80 overflow-y-auto space-y-2"></div>
      </div>
      <div id="stemsPanel" class="hidden space-y-3">
        <div id="stemsFilters" class="filter-panel"></div>
        <div id="stemsList" class="max-h-80 overflow-y-auto space-y-2"></div>
      </div>
      <div class="pt-1 border-t border-white/10 flex items-center justify-between text-xs text-white/70">
        <span class="hidden sm:inline">Need more space? Open your library.</span>
        <button data-open-favorites-page class="px-3 py-2 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white text-xs">Open Library</button>
      </div>
    </div>
  `

  document.body.appendChild(dropdownEl)
  dropdownEl.querySelector('[data-close-menu]')?.addEventListener('click', closeMenu)
  dropdownEl.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')))
  })
  dropdownEl.querySelector('[data-open-favorites-page]')?.addEventListener('click', () => {
    openFavoritesPageView()
    closeMenu()
  })
}

function ensureOverlay() {
  if (overlayEl) return
  const existing = document.getElementById('likesSetsOverlay')
  if (existing) {
    overlayEl = existing
    return
  }
  overlayEl = document.createElement('div')
  overlayEl.id = 'likesSetsOverlay'
  overlayEl.className = 'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm hidden opacity-0 transition-opacity'
  overlayEl.addEventListener('click', () => closeMenu())
  document.body.appendChild(overlayEl)
}

function attachAnchorHandlers() {
  anchorButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (btn.dataset.anchorId === 'studio-menu' || btn.dataset.anchorId === 'selection-menu') {
        openLikesModal(btn)
        return
      }
      if (shouldUsePageView()) {
        openFavoritesPageView()
        return
      }
      const isOpen = dropdownEl && !dropdownEl.classList.contains('hidden') && dropdownEl.dataset.anchor === btn.dataset.anchorId
      if (isOpen) {
        closeMenu()
        return
      }
      openMenu(btn)
    })
  })
}

function shouldUsePageView() {
  return window.matchMedia('(max-width: 768px)').matches
}

function openMenu(anchor) {
  if (!dropdownEl) buildDropdown()

  ensureDropdownContentRendered()

  dropdownEl.dataset.anchor = anchor.dataset.anchorId || ''
  dropdownEl.classList.remove('hidden')
  requestAnimationFrame(() => {
    dropdownEl.classList.remove('opacity-0')
  })
  anchorButtons.forEach((btn) => btn.classList.remove('ring-2', 'ring-purple-400/60', 'bg-white/5'))
  anchor.classList.add('ring-2', 'ring-purple-400/60', 'bg-white/5')
  positionDropdown(anchor)
  window.lucide?.createIcons()
}

function openLikesModal(anchor) {
  if (!dropdownEl) buildDropdown()
  ensureOverlay()
  if (!dropdownEl || !overlayEl) return

  ensureDropdownContentRendered()

  dropdownEl.dataset.anchor = anchor.dataset.anchorId || ''

  overlayEl.classList.remove('hidden')
  // Force reflow then fade in overlay
  void overlayEl.offsetHeight
  overlayEl.classList.remove('opacity-0')
  dropdownEl.classList.remove('hidden')
  // Center the dropdown as a modal
  dropdownEl.style.right = 'auto'
  dropdownEl.style.left = '50%'
  dropdownEl.style.top = '50%'
  dropdownEl.style.transform = 'translate(-50%, -50%)'
  // Force reflow then fade in dropdown
  void dropdownEl.offsetHeight
  dropdownEl.classList.remove('opacity-0')
  anchorButtons.forEach((btn) => btn.classList.remove('ring-2', 'ring-purple-400/60', 'bg-white/5'))
  anchor.classList.add('ring-2', 'ring-purple-400/60', 'bg-white/5')
  window.lucide?.createIcons()
}

function closeMenu() {
  if (!dropdownEl) return
  dropdownEl.classList.add('opacity-0')
  dropdownEl.classList.add('hidden')
  // Reset modal positioning
  dropdownEl.style.right = ''
  dropdownEl.style.left = ''
  dropdownEl.style.top = ''
  dropdownEl.style.transform = ''
  if (overlayEl) {
    overlayEl.classList.add('opacity-0')
    setTimeout(() => { overlayEl.classList.add('hidden') }, 150)
  }
  anchorButtons.forEach((btn) => btn.classList.remove('ring-2', 'ring-purple-400/60', 'bg-white/5'))
  // Stop any active like preview when closing menu
  if (stopPreviewHandler) {
    stopPreviewHandler()
  }
}

function positionDropdown(anchor) {
  if (!dropdownEl || !anchor) return
  const rect = anchor.getBoundingClientRect()
  const margin = 8
  dropdownEl.style.right = `${Math.max(12, window.innerWidth - rect.right - margin)}px`
  dropdownEl.style.top = `${rect.bottom + window.scrollY + margin}px`
}

function handleOutsideClick(e) {
  if (!dropdownEl || dropdownEl.classList.contains('hidden')) return
  if (dropdownEl.contains(e.target)) return
  if (anchorButtons.some((btn) => btn.contains(e.target))) return
  closeMenu()
}

function handleEscape(e) {
  if (e.key === 'Escape') {
    closeMenu()
  }
}

function attachPreviewStopListener() {
  if (previewStopListenerAttached) return
  window.addEventListener('likePreviewStopped', resetPreviewState)
  previewStopListenerAttached = true
}

function resetPreviewState() {
  activePreviewId = null
  updateLikePlayButtons()
  updateSavedStemPlayButtons()
}

function switchTab(tab) {
  currentTab = tab
  if (dropdownEl) {
    dropdownEl.querySelectorAll('.tab-btn').forEach((btn) => {
      const isActive = btn.getAttribute('data-tab') === currentTab
      btn.classList.toggle('bg-white/10', isActive)
      btn.classList.toggle('text-white', isActive)
      btn.classList.toggle('text-white/70', !isActive)
    })

    const likesFilters = dropdownEl.querySelector('#likesFilters')
    const likesList = dropdownEl.querySelector('#likesList')
    const setsPanel = dropdownEl.querySelector('#setsPanel')
    const stemsPanel = dropdownEl.querySelector('#stemsPanel')

    if (likesFilters && likesList && setsPanel && stemsPanel) {
      if (currentTab === 'likes') {
        likesFilters.classList.remove('hidden')
        likesList.classList.remove('hidden')
        setsPanel.classList.add('hidden')
        stemsPanel.classList.add('hidden')
      } else if (currentTab === 'sets') {
        likesFilters.classList.add('hidden')
        likesList.classList.add('hidden')
        setsPanel.classList.remove('hidden')
        stemsPanel.classList.add('hidden')
      } else if (currentTab === 'stems') {
        likesFilters.classList.add('hidden')
        likesList.classList.add('hidden')
        setsPanel.classList.add('hidden')
        stemsPanel.classList.remove('hidden')
        // Trigger sync when switching to stems
        syncStemStates()
      }
    }
  }

  favoritesPageRefs?.tabButtons?.forEach((btn) => {
    const isActive = btn.getAttribute('data-favorites-tab') === currentTab
    btn.classList.toggle('border-purple-400', isActive)
    btn.classList.toggle('text-white', isActive)
    btn.classList.toggle('text-white/70', !isActive)
    btn.classList.toggle('border-transparent', !isActive)
  })

  const favoritesLikes = favoritesPageRefs?.likesSection
  const favoritesSets = favoritesPageRefs?.setsSection
  const favoritesStems = favoritesPageRefs?.stemsSection
  if (favoritesLikes && favoritesSets) {
    favoritesLikes.classList.toggle('hidden', currentTab !== 'likes')
    favoritesSets.classList.toggle('hidden', currentTab !== 'sets')
  }
  if (favoritesStems) {
    favoritesStems.classList.toggle('hidden', currentTab !== 'stems')
  }
}

function attachFavoritesTabHandlers() {
  if (!favoritesPageRefs) return
  favoritesPageRefs.tabButtons?.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-favorites-tab')))
  })
}

function attachFavoritesScrollLinks() {
  document.querySelectorAll('[data-favorites-scroll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-favorites-scroll') === 'sets'
        ? favoritesPageRefs?.setsSection
        : favoritesPageRefs?.likesSection
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  })
}

function attachSetsSubTabHandlers() {
  const buttons = document.querySelectorAll('[data-favorites-sets-subtab]')
  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const subtab = btn.getAttribute('data-favorites-sets-subtab')

      // Update button styles
      buttons.forEach(b => {
        const isTarget = b.getAttribute('data-favorites-sets-subtab') === subtab
        b.classList.toggle('text-white', isTarget)
        b.classList.toggle('bg-white/10', isTarget)
        b.classList.toggle('text-white/70', !isTarget)
        b.classList.toggle('hover:text-white', !isTarget)
        b.classList.toggle('hover:bg-white/10', !isTarget)
      })

      // Toggle lists
      const setsList = favoritesPageRefs?.setsList
      const stemsList = favoritesPageRefs?.stemsList
      const setsFilters = favoritesPageRefs?.setsFilters
      const stemsFilters = favoritesPageRefs?.stemsFilters

      if (setsList && stemsList) {
        if (subtab === 'sets') {
          setsList.classList.remove('hidden')
          stemsList.classList.add('hidden')
          if (setsFilters) setsFilters.classList.remove('hidden')
          if (stemsFilters) stemsFilters.classList.add('hidden')
        } else {
          setsList.classList.add('hidden')
          stemsList.classList.remove('hidden')
          if (setsFilters) setsFilters.classList.add('hidden')
          if (stemsFilters) stemsFilters.classList.remove('hidden')
          // Trigger sync if needed
          if (stemStatesCache.length === 0 && !stemStatesSyncInProgress) {
            syncStemStates()
          }
        }
      }
    })
  })
}

function renderFilters() {
  renderFilterPanel(dropdownEl?.querySelector('#likesFilters'), 'likes')
  renderFilterPanel(dropdownEl?.querySelector('#setsFilters'), 'sets')
  renderFilterPanel(dropdownEl?.querySelector('#stemsFilters'), 'stems')
  renderFilterPanel(favoritesPageRefs?.likesFilters, 'likes', 'page')
  renderFilterPanel(favoritesPageRefs?.setsFilters, 'sets', 'page')
  renderFilterPanel(favoritesPageRefs?.stemsFilters, 'stems', 'page')
}

function renderFilterPanel(container, prefix, context = 'dropdown') {
  if (!container) return
  const columnClass = 'sm:grid-cols-4'
  let label = 'Likes filters'
  let currentScope = likesScope

  if (prefix === 'sets') {
    label = 'Saved set filters'
    currentScope = setsScope
  }
  if (prefix === 'stems') {
    label = 'Stem states filters'
    currentScope = stemsScope
  }

  const baseClass = context === 'page'
    ? `filter-panel space-y-3 text-xs text-white/80 bg-white/5 border border-white/10 rounded-xl p-3`
    : `filter-panel space-y-3 text-xs text-white/80 bg-white/5 border border-white/10 rounded-xl p-3`
  const preserveHidden = container.classList.contains('hidden')
  container.className = preserveHidden ? `${baseClass} hidden` : baseClass

  const currentStars = filters.stars || 0

  // Scope Toggle HTML
  const scopeHtml = `
    <div class="flex bg-white/10 rounded-lg p-0.5 ml-auto mr-2">
        <button data-scope="${prefix}" data-value="current" class="px-2 py-0.5 rounded-md text-[10px] transition-colors ${currentScope === 'current' ? 'bg-purple-500 text-white' : 'text-white/60 hover:text-white'}">Session</button>
        <button data-scope="${prefix}" data-value="all" class="px-2 py-0.5 rounded-md text-[10px] transition-colors ${currentScope === 'all' ? 'bg-purple-500 text-white' : 'text-white/60 hover:text-white'}">All</button>
    </div>
  `

  container.innerHTML = `
    <div class="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.2em] text-white/50">
      <div class="flex items-center flex-1">
          <span>${label}</span>
          ${scopeHtml}
      </div>
      <button data-filter="clear" class="text-[11px] text-purple-300 hover:text-white">Reset</button>
    </div>
    <div class="grid grid-cols-1 ${columnClass} gap-2 items-end">
      <div>
        <label class="block text-[11px] text-white/60 mb-1">BPM Min</label>
        <select data-filter="bpmMin" class="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm">
          <option value="0" ${filters.bpmMin === 0 ? 'selected' : ''}>0 (Any)</option>
          ${generateBPMOptions(filters.bpmMin, 50, filters.bpmMax === 999 ? 200 : filters.bpmMax)}
        </select>
      </div>
      <div>
        <label class="block text-[11px] text-white/60 mb-1">BPM Max</label>
        <select data-filter="bpmMax" class="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm">
          ${generateBPMOptions(filters.bpmMax, filters.bpmMin === 0 ? 50 : filters.bpmMin, 200)}
          <option value="999" ${filters.bpmMax === 999 ? 'selected' : ''}>999+ (Any)</option>
        </select>
      </div>
      <div>
        <label class="block text-[11px] text-white/60 mb-1">Key</label>
        <select data-filter="key" class="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm">
          ${KEY_OPTIONS.map((key) => `<option ${filters.key === key ? 'selected' : ''}>${key}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="block text-[11px] text-white/60 mb-1">Rating</label>
        <div class="flex items-center justify-center h-[34px] px-2 bg-white/5 border border-white/10 rounded-lg">
          ${renderStarRating(currentStars, 'filter-stars', 'sm', true)}
        </div>
      </div>
    </div>
  `

  container.querySelectorAll('[data-filter]').forEach((el) => {
    if (el.tagName === 'SELECT') {
      el.addEventListener('change', (e) => handleFilterChange(e, prefix))
    } else {
      el.addEventListener('click', (e) => handleFilterChange(e, prefix))
    }
  })

  // Scope handlers
  container.querySelectorAll('[data-scope]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const p = btn.getAttribute('data-scope')
      const v = btn.getAttribute('data-value')
      if (p === 'likes') setLikesScope(v)
      else if (p === 'sets') setSessionScope(v)
      else if (p === 'stems') setStemsScope(v)

      // Re-render all panels since scope might affect others (like sets)
      renderFilters()
    })
  })

  // Attach star filter handlers
  attachStarHandlers(container, 'filter')
}

function handleFilterChange(e, prefix) {
  const type = e.target.getAttribute('data-filter')
  if (type === 'clear') {
    filters = { ...DEFAULT_FILTERS }
    renderFilters()
  } else if (type === 'bpmMin') {
    filters.bpmMin = parseInt(e.target.value, 10) || DEFAULT_FILTERS.bpmMin
  } else if (type === 'bpmMax') {
    filters.bpmMax = parseInt(e.target.value, 10) || DEFAULT_FILTERS.bpmMax
  } else if (type === 'key') {
    filters.key = e.target.value
  }

  if (prefix === 'likes') {
    renderLikes()
  } else if (prefix === 'sets') {
    renderSets()
  } else if (prefix === 'stems') {
    renderSavedStems()
  }
}

function renderLikes() {
  const containers = getLikesContainers()
  if (!containers.length) return

  containers.forEach(({ el, variant }) => {
    if (cloudSyncInProgress) {
      el.innerHTML = `
        <div class="space-y-2">
          ${renderLikeSkeleton(variant)}
          ${renderLikeSkeleton(variant)}
          ${renderLikeSkeleton(variant)}
        </div>
      `
      return
    }

    const filtered = getFilteredLikes()
    const itemMap = new Map(filtered.map((item) => [item.id, item]))
    if (!filtered.length) {
      el.innerHTML = `<div class="text-sm text-white/60 bg-white/5 border border-white/10 rounded-xl p-4">No liked tracks yet. Press ♥ on any stem to add it here.</div>`
      return
    }

    el.innerHTML = filtered
      .map((item) => renderLikeCard(item, variant))
      .join('')

    attachLikeCardHandlers(el, variant, itemMap)
    renderLikeWaveforms(el, itemMap)
  })

  updateLikePlayButtons()
  renderStats()
  window.lucide?.createIcons()
}

function getLikesContainers() {
  const containers = []
  if (dropdownContentRendered) {
    const dropdownList = dropdownEl?.querySelector('#likesList')
    if (dropdownList) containers.push({ el: dropdownList, variant: 'dropdown' })
  }
  if (favoritesPageRefs?.likesList) containers.push({ el: favoritesPageRefs.likesList, variant: 'page' })
  externalLikesContainers.forEach((c) => containers.push(c))
  return containers
}


function getFilteredLikes() {
  const currentSessionId = resolveSessionId()
  return likedTracks.filter((item) => {
    const bpmOk = item.bpm >= filters.bpmMin && item.bpm <= filters.bpmMax
    const keyOk = filters.key === 'Any Key' || item.key === filters.key
    const starsOk = filters.stars === null || (item.rating ?? 3) === filters.stars

    let scopeOk = true
    if (likesScope === 'current') {
      if (currentSessionId && item.sessionSettingId) {
        scopeOk = Number(item.sessionSettingId) === Number(currentSessionId)
      } else {
        // Fallback to BPM/Key match if no IDs are available
        scopeOk = (item.bpm === sessionInfoProvider().bpm && item.key === sessionInfoProvider().key)
      }
    }

    return bpmOk && keyOk && starsOk && scopeOk
  })
}

function renderLikeCard(item, variant = 'dropdown') {
  const rating = item.rating ?? 3

  if (variant === 'page') {
    return `
      <div class="flex flex-col gap-3 bg-white/5 border border-white/10 rounded-xl p-4" data-like-card="${item.id}">
        <div class="flex flex-col sm:flex-row sm:items-start gap-4">
          <div class="flex items-start gap-3 flex-shrink-0 min-w-[200px]">
            <button data-like-play="${item.id}" class="w-11 h-11 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 flex items-center justify-center transition" aria-label="Play ${item.stemName}">
              <i data-lucide="${activePreviewId === item.id ? 'pause' : 'play'}" class="w-4 h-4" data-like-play-icon></i>
            </button>
            <div class="space-y-0.5">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-${item.stemColor}-400"></span>
                <span class="text-base font-semibold">${item.stemName}</span>
              </div>
              <div class="text-[12px] text-white/70">${item.bpm} BPM · ${item.key}</div>
              <div class="star-rating-container" data-current-rating="${rating}">
                ${renderStarRating(rating, item.id, 'sm-plus', true)}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-4 flex-1 min-w-0">
            <div class="flex-[1.15] min-w-0">
              ${renderLikeWaveformCanvas(item, 'page')}
            </div>
            <div class="flex flex-col items-end gap-2 flex-shrink-0 min-w-[120px]">
              <button data-insert-like="${item.id}" class="px-3 py-1.5 rounded-lg border border-purple-400/60 bg-purple-500/10 hover:bg-purple-500/20 text-sm w-full">Insert</button>
              <button data-unlike="${item.stemId}|${item.takeIndex}" class="px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-sm text-red-200 w-full">Remove</button>
            </div>
          </div>
        </div>
      </div>
    `
  }

  return `
    <div class="flex items-start gap-3 bg-white/5 border border-white/10 rounded-xl p-2.5" data-like-card="${item.id}">
      <div class="flex flex-col gap-1 flex-shrink-0" style="min-width: 100px;">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-${item.stemColor}-400"></span>
          <span class="text-sm font-medium">${item.stemName}</span>
        </div>
        <div class="text-[11px] text-white/70">${item.bpm} BPM · ${item.key}</div>
        <div class="mt-0.5">
          ${renderStarRating(rating, '', 'sm', false)}
        </div>
      </div>
      <div class="flex items-center gap-2 flex-1 min-w-0 relative">
        <button data-like-play="${item.id}" class="absolute left-2 z-10 w-8 h-8 rounded-full border border-white/20 bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center transition" aria-label="Play ${item.stemName}">
          <i data-lucide="${activePreviewId === item.id ? 'pause' : 'play'}" class="w-3.5 h-3.5" data-like-play-icon></i>
        </button>
        ${renderLikeWaveformCanvas(item, 'dropdown')}
        <button data-insert-like="${item.id}" class="absolute right-2 px-3 py-1.5 rounded-lg border border-white/20 bg-black/40 hover:bg-black/60 backdrop-blur-sm text-xs font-medium">Insert</button>
      </div>
    </div>
  `
}

function renderLikeWaveformCanvas(item, variant = 'dropdown') {
  const heightClass = variant === 'dropdown' ? 'h-12' : 'h-16'
  const width = variant === 'dropdown' ? 520 : 720
  const height = variant === 'dropdown' ? 68 : 96
  return `
    <canvas class="like-waveform w-full ${heightClass} bg-white/5 rounded-lg border border-white/10"
      data-like-waveform="${item.id}"
      width="${width}"
      height="${height}"
      aria-label="Waveform for ${item.stemName}"></canvas>
  `
}

function attachLikeCardHandlers(container, variant, itemMap) {
  container.querySelectorAll('[data-unlike]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const [stemId, takeIdx] = (btn.getAttribute('data-unlike') || '').split('|')
      const idxNum = parseInt(takeIdx, 10)
      removeLike(stemId, idxNum)
    })
  })

  container.querySelectorAll('[data-insert-like]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const id = btn.getAttribute('data-insert-like')
      const item = itemMap.get(id)
      if (item) {
        handleInsertLike(item, variant, btn)
      } else {
        console.warn('attachLikeCardHandlers: Item not found for insert', id)
      }
    })
  })

  container.querySelectorAll('[data-like-play]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const id = btn.getAttribute('data-like-play')
      const item = itemMap.get(id)
      if (item) {
        handlePlayRequest(item)
      } else {
        console.warn('attachLikeCardHandlers: Item not found for play', id)
      }
    })
  })

  // Attach star rating handlers for favorites page (interactive)
  if (variant === 'page') {
    attachStarHandlers(container, 'like')
  }
}

function renderLikeWaveforms(container, itemMap) {
  const canvases = Array.from(container.querySelectorAll('[data-like-waveform]'))
  if (!canvases.length) return

  // Small delay to ensure DOM dimensions are calculated if we're in a transition
  requestAnimationFrame(() => {
    canvases.forEach(async (canvas) => {
      const id = canvas.getAttribute('data-like-waveform')
      const item = itemMap.get(id)

      if (!item) {
        console.warn('renderLikeWaveforms: Item not found for ID', id)
        return
      }

      const rect = canvas.getBoundingClientRect()
      const width = rect.width || Number(canvas.getAttribute('width')) || 320
      const height = rect.height || Number(canvas.getAttribute('height')) || 64

      // Update canvas internal resolution to match displayed size
      // Multiplying by devicePixelRatio for sharper waveforms on retina screens
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr

      const draw = (buf) => {
        const color = `rgba(${getColorRGB(item.stemColor)},0.9)`
        drawTinyWaveform(canvas, buf, color, 'rgba(255,255,255,0.05)')
      }

      if (item.audioBuffer) {
        draw(item.audioBuffer)
      } else if (item.audioKey || item.audio_data) {
        // Show placeholder while loading
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = 'rgba(255,255,255,0.08)'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }

        try {
          const decoded = await loadLikeAudio(item)
          if (decoded && canvas.isConnected) {
            draw(decoded)
          }
        } catch (err) {
          console.error('renderLikeWaveforms: Error loading/drawing waveform', err)
        }
      }
    })
  })
}

async function handleInsertLike(item, variant = 'dropdown', btn = null) {
  if (!item || !insertLikeHandler) return

  const originalHtml = btn ? btn.innerHTML : ''
  if (btn) {
    btn.disabled = true
    btn.innerHTML = `
      <div class="flex items-center justify-center gap-2">
        <svg class="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Inserting...</span>
      </div>
    `
  }

  try {
    const result = insertLikeHandler(item)
    if (result instanceof Promise) await result
  } catch (err) {
    console.error('handleInsertLike: Error during insertion:', err)
  } finally {
    if (btn) {
      btn.disabled = false
      btn.innerHTML = originalHtml
    }
  }

  if (variant === 'dropdown') closeMenu()
  else if (variant === 'page' && typeof window.showPage === 'function') {
    window.showPage('techno-generator-page')
  }
}

function handlePlayRequest(item) {
  if (!item || !playLikeHandler) return
  const result = playLikeHandler(item, activePreviewId)
  if (result instanceof Promise) {
    result.then((id) => {
      activePreviewId = id || null
      updateLikePlayButtons()
    }).catch(() => { })
    return
  }
  activePreviewId = result || null
  updateLikePlayButtons()
}

function stopPreviewForItem(item) {
  if (!item || activePreviewId !== item.id) return
  if (stopPreviewHandler) stopPreviewHandler(item)
  resetPreviewState()
}

function removeLike(stemId, takeIndex) {
  const index = likedTracks.findIndex((entry) => entry.stemId === stemId && entry.takeIndex === takeIndex)
  if (index >= 0) {
    const [removed] = likedTracks.splice(index, 1)
    stopPreviewForItem(removed)
    renderLikes()
    notifyLikeChange(stemId)
    persistLikesToLocalStorage()
  }
}

function updateLikePlayButtons() {
  document.querySelectorAll('[data-like-play]').forEach((btn) => {
    const id = btn.getAttribute('data-like-play')
    const isActive = id === activePreviewId
    btn.classList.toggle('border-purple-400/60', isActive)
    btn.classList.toggle('bg-purple-500/20', isActive)
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false')
    const label = btn.querySelector('[data-like-play-label]')
    if (label) label.textContent = isActive ? 'Stop' : 'Play'
    const icon = btn.querySelector('[data-like-play-icon]')
    if (icon) icon.setAttribute('data-lucide', isActive ? 'pause' : 'play')
  })
  window.lucide?.createIcons()
}

function renderSets() {
  const containers = getSetContainers()
  if (!containers.length) return

  containers.forEach(({ el, variant }) => {
    if (stemStatesSyncInProgress) {
      el.innerHTML = `
        <div class="space-y-2">
          ${renderSetSkeleton(variant)}
          ${renderSetSkeleton(variant)}
          ${renderSetSkeleton(variant)}
        </div>
      `
      return
    }

    const filtered = getFilteredSets()
    if (!filtered.length) {
      el.innerHTML = `<div class="text-sm text-white/60 bg-white/5 border border-white/10 rounded-xl p-4">No saved sets found. Save your current session from the player bar.</div>`
      return
    }

    el.innerHTML = filtered
      .map((entry) => renderSetCard(entry, variant))
      .join('')

    el.querySelectorAll('[data-load-set]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.getAttribute('data-load-set'), 10)
        if (Number.isInteger(index) && loadSetHandler) {
          loadSetHandler(index)
          closeMenu()
        }
      })
    })

    el.querySelectorAll('[data-load-cloud-set]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-load-cloud-set'), 10)
        const state = stemStatesCache.find(s => s.stem_state_id === id)
        if (state) {
          window.dispatchEvent(new CustomEvent('loadStemState', { detail: state }))
          closeMenu()
        }
      })
    })

    el.querySelectorAll('[data-delete-cloud-set]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (!confirm('Are you sure you want to delete this saved set?')) return
        const id = parseInt(btn.getAttribute('data-delete-cloud-set'), 10)
        const res = await deleteStemState(id)
        if (res.success) {
          stemStatesCache = stemStatesCache.filter(s => s.stem_state_id !== id)
          renderSets()
        } else {
          // showToast('Failed to delete set', 'error')
          console.error('Failed to delete set')
        }
      })
    })

    // Attach star rating handlers for favorites page (interactive)
    if (variant === 'page') {
      attachStarHandlers(el, 'set')
      attachRenameHandlers(el)
    }
  })

  renderStats()
}

async function syncStemStates() {
  if (stemStatesSyncInProgress) return
  stemStatesSyncInProgress = true
  renderSets() // Show skeletons

  try {
    if (setsScope === 'all') {
      const resAll = await getAllStemStates()
      console.log('syncStemStates [All]: Got states', resAll.states?.length)
      if (resAll.success && Array.isArray(resAll.states)) {
        stemStatesCache = resAll.states
      } else {
        stemStatesCache = []
      }
    } else {
      const sessionSettingId = resolveSessionId()
      console.log('syncStemStates [Current]: Resolved sessionSettingId', sessionSettingId)

      if (!sessionSettingId) {
        console.log('syncStemStates [Current]: No session ID found, clearing list')
        stemStatesCache = []
        renderSets()
        stemStatesSyncInProgress = false
        return
      }

      console.log('syncStemStates [Current]: Calling getAllStemStates with', sessionSettingId)
      const result = await getAllStemStates(sessionSettingId)
      console.log('syncStemStates [Current]: result', result)
      if (result.success && Array.isArray(result.states)) {
        stemStatesCache = result.states
      } else {
        stemStatesCache = []
      }
    }
  } catch (err) {
    console.error('Exception syncing stem states:', err)
  } finally {
    stemStatesSyncInProgress = false
    // renderStemStates() // No longer rendering snapshots in Stems tab
    renderSets()
  }
}

async function syncSavedStems() {
  if (savedStemsSyncInProgress) return
  savedStemsSyncInProgress = true
  renderSavedStems() // Show skeletons

  try {
    let sessionSettingId = null

    // Determine session ID if needed
    if (stemsScope === 'current') {
      sessionSettingId = resolveSessionId()
      console.log('syncSavedStems [Current]: Resolved sessionSettingId', sessionSettingId)

      // If filtering by current but no session ID, clear list
      if (!sessionSettingId) {
        console.log('syncSavedStems [Current]: No session ID found, clearing list')
        savedStemsCache = []
        renderSavedStems()
        savedStemsSyncInProgress = false
        return
      }
    }

    // If scope is 'all', sessionSettingId remains null, which getUserStems interprets as "fetch all"
    // If scope is 'current', we pass the ID.
    console.log('syncSavedStems: Calling getUserStems with scope:', stemsScope, 'ID:', sessionSettingId)
    const res = await getUserStems(stemsScope === 'all' ? null : sessionSettingId)
    console.log('syncSavedStems: API Response', res)

    if (res.success && Array.isArray(res.stems)) {
      console.log('syncSavedStems: Raw stems count:', res.stems.length)
      // Relaxed filter: include those with audio_url OR audio_data (bytea check might be implied if url missing)
      // For now, let's log how many have audio_url
      const withUrl = res.stems.filter(s => s.audio_url && s.audio_url.trim() !== '')
      console.log('syncSavedStems: Stems with audio_url:', withUrl.length)

      // If user wants to see their generated stems, we should probably show them even if no url yet
      savedStemsCache = res.stems.filter(s => (s.audio_url && s.audio_url.trim() !== '') || (s.audio_data))
      console.log('syncSavedStems: Cache updated, final count:', savedStemsCache.length)
    } else {
      console.warn('syncSavedStems: Failed to get stems or empty', res)
      savedStemsCache = []
    }
  } catch (err) {
    console.error('Exception syncing saved stems:', err)
  } finally {
    savedStemsSyncInProgress = false
    renderSavedStems()
  }
}

export function setLikesScope(scope) {
  likesScope = scope === 'all' ? 'all' : 'current'
  renderLikes()
  renderStats()
}

export function setSessionScope(scope) {
  const s = scope === 'all' ? 'all' : 'current'
  likesScope = s
  setsScope = s
  stemsScope = s
  renderLikes()
    ; (async () => {
      await syncStemStates()
      await syncSavedStems()
    })()
  renderStats()
}

export function setStemsScope(scope) {
  stemsScope = scope === 'all' ? 'all' : 'current'
    ; (async () => {
      await syncSavedStems()
    })()
}

function resolveSessionId() {
  try {
    const currentSessionSetting = localStorage.getItem('currentSessionSetting')
    if (!currentSessionSetting) return null

    const parsed = JSON.parse(currentSessionSetting)
    const raw = parsed?.session_setting_id ?? null

    if (raw === null || raw === undefined) return null

    if (typeof raw === 'number') return raw
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw)

    return null
  } catch (e) {
    console.error('Error resolving session ID from localStorage:', e)
    return null
  }
}

function getStemContainers() {
  const containers = []
  if (dropdownContentRendered) {
    const dropdownList = dropdownEl?.querySelector('#stemsList')
    if (dropdownList) containers.push(dropdownList)
  }
  if (favoritesPageRefs?.stemsList) containers.push(favoritesPageRefs.stemsList)
  return containers
}



function renderLikeSkeleton(variant = 'dropdown') {
  if (variant === 'page') {
    return `
      <div class="flex flex-col gap-3 bg-white/5 border border-white/10 rounded-xl p-4 animate-pulse">
        <div class="flex flex-col sm:flex-row sm:items-start gap-4">
          <div class="flex items-start gap-3 flex-shrink-0 min-w-[200px]">
            <div class="w-11 h-11 rounded-full bg-white/10"></div>
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full bg-white/20"></div>
                <div class="h-4 w-24 bg-white/10 rounded"></div>
              </div>
              <div class="h-3 w-32 bg-white/10 rounded"></div>
              <div class="flex gap-1">
                ${'<div class="h-3 w-3 bg-white/10 rounded"></div>'.repeat(5)}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-4 flex-1 min-w-0">
            <div class="h-16 flex-1 bg-white/5 rounded-lg border border-white/10"></div>
            <div class="flex flex-col gap-2 w-[120px]">
              <div class="h-8 bg-white/10 rounded-lg"></div>
              <div class="h-8 bg-white/10 rounded-lg"></div>
            </div>
          </div>
        </div>
      </div>
    `
  }
  return `
    <div class="flex items-start gap-3 bg-white/5 border border-white/10 rounded-xl p-2.5 animate-pulse">
      <div class="flex flex-col gap-1.5 flex-shrink-0" style="min-width: 100px;">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-white/20"></div>
          <div class="h-3.5 w-16 bg-white/10 rounded"></div>
        </div>
        <div class="h-3 w-20 bg-white/10 rounded"></div>
        <div class="flex gap-0.5 mt-0.5">
          ${'<div class="h-2.5 w-2.5 bg-white/10 rounded-full"></div>'.repeat(5)}
        </div>
      </div>
      <div class="flex items-center gap-2 flex-1 h-12 bg-white/5 rounded-lg border border-white/10"></div>
    </div>
  `
}

function renderSetSkeleton(variant = 'dropdown') {
  if (variant === 'page') {
    return `
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white/5 border border-white/10 rounded-xl p-4 animate-pulse">
        <div class="space-y-2 flex-1">
          <div class="flex items-center gap-3">
            <div class="h-5 w-40 bg-white/10 rounded"></div>
            <div class="flex gap-1">
              ${'<div class="h-3 w-3 bg-white/10 rounded"></div>'.repeat(5)}
            </div>
          </div>
          <div class="flex gap-2">
            ${'<div class="h-5 w-20 bg-white/5 rounded-lg border border-white/10"></div>'.repeat(5)}
          </div>
        </div>
        <div class="w-full sm:w-24 h-9 bg-white/10 rounded-lg"></div>
      </div>
    `
  }
  return `
    <div class="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl p-3 animate-pulse">
      <div class="space-y-2 flex-1">
        <div class="flex items-center justify-between">
          <div class="h-4 w-24 bg-white/10 rounded"></div>
          <div class="flex gap-0.5">
            ${'<div class="h-2.5 w-2.5 bg-white/10 rounded-full"></div>'.repeat(5)}
          </div>
        </div>
        <div class="h-3 w-32 bg-white/5 rounded"></div>
      </div>
      <div class="ml-3 h-4 w-8 bg-white/10 rounded"></div>
    </div>
  `
}

function renderStemSkeleton() {
  return `
    <div class="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl p-3 animate-pulse">
      <div class="space-y-2 flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full bg-white/20"></div>
            <div class="h-3 w-24 bg-white/10 rounded"></div>
          </div>
          <div class="h-3 w-12 bg-white/10 rounded"></div>
        </div>
        <div class="flex items-center gap-2">
          <div class="h-3 w-16 bg-white/10 rounded"></div>
          <div class="h-3 w-3 bg-white/10 rounded"></div>
          <div class="h-3 w-20 bg-white/10 rounded"></div>
        </div>
      </div>
      <div class="flex items-center gap-2 ml-3 flex-shrink-0">
        <div class="w-8 h-8 rounded-full bg-white/10 border border-white/10"></div>
        <div class="w-8 h-8 rounded-full bg-white/10 border border-white/10"></div>
        <div class="w-8 h-8 rounded-full bg-white/10 border border-white/10"></div>
      </div>
    </div>
  `
}

function renderSavedStems() {
  const containers = getStemContainers()
  if (!containers.length) return

  const filtered = getFilteredSavedStems()
  console.log('renderSavedStems: Rendering', {
    total: savedStemsCache.length,
    filtered: filtered.length,
    containers: containers.length
  })

  containers.forEach((container) => {
    if (savedStemsSyncInProgress) {
      container.innerHTML = `
        <div class="space-y-2">
          ${renderStemSkeleton()}
          ${renderStemSkeleton()}
          ${renderStemSkeleton()}
        </div>
      `
      window.lucide?.createIcons()
      return
    }
    if (!filtered.length) {
      if (savedStemsCache.length > 0) {
        container.innerHTML = `<div class="text-sm text-white/60 bg-white/5 border border-white/10 rounded-xl p-4"> No saved stems match the current filters.</div> `
      } else {
        container.innerHTML = `<div class="text-sm text-white/60 bg-white/5 border border-white/10 rounded-xl p-4"> No saved stems found.</div> `
      }
      return
    }

    container.innerHTML = filtered
      .map((item) => renderSavedStemCard(item))
      .join('')

    window.lucide?.createIcons()

    const itemMap = new Map(filtered.map((i) => [i.id, i]))
    renderSavedStemWaveforms(container, itemMap)

    container.querySelectorAll('[data-play-saved-stem]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const id = btn.getAttribute('data-play-saved-stem')
        const item = filtered.find(s => s.id === id)

        if (activePreviewId === id) {
          // Stop
          stopPreviewForItem(item)
          return
        }

        if (item) {
          // Play
          if (stopPreviewHandler) stopPreviewHandler(item)
          activePreviewId = id
          updateSavedStemPlayButtons(container) // update UI

          try {
            // Ensure audio is loaded
            if (!item.audioBuffer) {
              // Map audio_url to audioKey for loadLikeAudio
              if (item.audio_url) item.audioKey = item.audio_url
              await loadLikeAudio(item)
            }

            if (item.audioBuffer && playLikeHandler) {
              playLikeHandler(item, true) // true = isPreview/isLoop
              // Listen for end to reset UI
              // Note: playLikeHandler logic in app.js might need to trigger an event or callback when done.
              // For now we rely on manual stop or loop.
            } else {
              console.error('Playback failed: Missing buffer or handler')
            }
          } catch (err) {
            console.error('Failed to play saved stem', err)
            activePreviewId = null
            updateSavedStemPlayButtons(container)
          }
        }
      })
    })

    // Attach Download Handlers
    container.querySelectorAll('[data-download-saved-stem]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const id = btn.getAttribute('data-download-saved-stem')
        const item = filtered.find(s => s.id === id)

        if (item) {
          const originalIcon = btn.innerHTML
          btn.innerHTML = `< i data - lucide="loader-2" class="w-4 h-4 animate-spin" ></i > `
          window.lucide?.createIcons()

          try {
            // Ensure audio is loaded
            if (!item.audioBuffer) {
              if (item.audio_url) item.audioKey = item.audio_url
              await loadLikeAudio(item)
            }

            if (item.audioBuffer) {
              const filename = `${item.stem_type || 'stem'}_${item.bpm} bpm.wav`
              bufferToWavAndDownload(item.audioBuffer, filename)
            } else {
              console.error('Download failed: No audio buffer available')
              // showToast('Could not load audio', 'error')
            }
          } catch (err) {
            console.error('Download error', err)
          } finally {
            btn.innerHTML = originalIcon
            window.lucide?.createIcons()
          }
        }
      })
    })

    // Attach Delete Handlers
    container.querySelectorAll('[data-delete-saved-stem]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (!confirm('Are you sure you want to delete this stem?')) return
        const id = btn.getAttribute('data-delete-saved-stem') // UUID string

        // Import deleteStem if not already imported or available
        // We imported it at the top.
        const res = await deleteStem(id)

        if (res.success) {
          savedStemsCache = savedStemsCache.filter(s => s.id !== id)
          renderSavedStems()
        } else {
          // showToast('Failed to delete stem', 'error')
          console.error('Failed to delete stem', res.error)
        }
      })
    })
  })
}

function renderSavedStemWaveforms(container, itemMap) {
  const canvases = Array.from(container.querySelectorAll('[data-saved-stem-waveform]'))
  if (!canvases.length) return

  console.log('renderSavedStemWaveforms: Processing', canvases.length, 'canvases')

  requestAnimationFrame(() => {
    canvases.forEach(async (canvas) => {
      const id = canvas.getAttribute('data-saved-stem-waveform')
      const item = itemMap.get(id)
      if (!item) {
        console.warn('renderSavedStemWaveforms: Item not found', id)
        return
      }
      const rect = canvas.getBoundingClientRect()
      const width = rect.width || Number(canvas.getAttribute('width')) || 320
      const height = rect.height || Number(canvas.getAttribute('height')) || 64
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      const draw = (buf) => {
        const color = 'rgba(255,255,255,0.85)'
        drawTinyWaveform(canvas, buf, color, 'rgba(255,255,255,0.05)')
      }
      if (item.audioBuffer) {
        draw(item.audioBuffer)
      } else if (item.audioKey || item.audio_data) {
        console.log('renderSavedStemWaveforms: Loading audio for', id)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = 'rgba(255,255,255,0.08)'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
        try {
          const decoded = await loadLikeAudio(item)
          if (decoded && canvas.isConnected) {
            draw(decoded)
          } else {
            console.warn('renderSavedStemWaveforms: Failed to decode or canvas disconnected', id)
          }
        } catch (err) {
          console.error('renderSavedStemWaveforms: Error', err)
        }
      } else {
        console.warn('renderSavedStemWaveforms: No audio data available for', id)
      }
    })
  })
}
function updateSavedStemPlayButtons(container) {
  const targets = container ? [container] : getStemContainers()
  targets.forEach((c) => {
    if (!c) return
    c.querySelectorAll('[data-play-saved-stem]').forEach(btn => {
      const id = btn.getAttribute('data-play-saved-stem')
      const isPlaying = id === activePreviewId
      const icon = btn.querySelector('[data-lucide]')
      if (icon) {
        icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play')
      }
      btn.classList.toggle('text-purple-300', isPlaying)
      btn.classList.toggle('text-white', !isPlaying)
    })
  })
  window.lucide?.createIcons()
}

function getFilteredSavedStems() {
  return savedStemsCache.map(item => {
    // Map DB columns to our internal structure
    const bpm = item.tempo || 0
    const key = item.key_signature || ''
    const timestamp = new Date(item.created_at).getTime()

    return {
      ...item,
      bpm,
      key,
      timestamp,
      stemName: item.stem_type || 'Stem',
      audioKey: item.audio_url || null // For playback
    }
  })
    .filter(item => {
      const bpmOk = item.bpm >= filters.bpmMin && item.bpm <= filters.bpmMax
      const keyOk = filters.key === 'Any Key' || item.key === filters.key
      return bpmOk && keyOk
    })
    .sort((a, b) => b.timestamp - a.timestamp)
}

function renderSavedStemCard(item) {
  const dateStr = new Date(item.created_at).toLocaleDateString()
  const duration = item.duration_seconds ? `${Math.round(item.duration_seconds)}s` : ''
  const size = item.file_size ? `${(item.file_size / 1024 / 1024).toFixed(1)}MB` : ''

  return `
    <div class="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl p-3 group hover:bg-white/10 transition-colors">
      <div class="space-y-1 flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
             <span class="w-2 h-2 rounded-full" style="background-color: ${getColorRGB(item.stem_type) || '#999'}"></span>
             <span class="text-sm font-medium truncate capitalize">${item.stem_type}</span>
          </div>
          <span class="text-[10px] text-white/50">${dateStr}</span>
        </div>
        
        <div class="mt-2">
          <canvas class="w-full h-12 bg-white/5 rounded-lg border border-white/10"
            data-saved-stem-waveform="${item.id}"
            width="720"
            height="96"
            aria-label="Waveform for ${item.stem_type}"></canvas>
        </div>
        <div class="text-xs text-white/60 flex items-center gap-2">
           <span>${item.bpm} BPM</span>
           <span>•</span>
           <span>${item.key}</span>
           ${duration ? `<span>• ${duration}</span>` : ''}
        </div>
      </div>
      
      <div class="flex items-center gap-2 ml-3 flex-shrink-0">
        <button data-play-saved-stem="${item.id}" class="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white">
          <i data-lucide="${activePreviewId === item.id ? 'pause' : 'play'}" class="w-4 h-4"></i>
        </button>
        
        <button data-download-saved-stem="${item.id}" class="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white" title="Download">
          <i data-lucide="download" class="w-4 h-4"></i>
        </button>
        
        <button data-delete-saved-stem="${item.id}" class="p-2 rounded-full bg-white/10 hover:bg-red-500/20 hover:text-red-400 transition-colors text-white/60" title="Delete">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    </div>
  `
}

function getSetContainers() {
  const containers = []
  if (dropdownContentRendered) {
    const dropdownList = dropdownEl?.querySelector('#setsList')
    if (dropdownList) containers.push({ el: dropdownList, variant: 'dropdown' })
  }
  if (favoritesPageRefs?.setsList) containers.push({ el: favoritesPageRefs.setsList, variant: 'page' })
  return containers
}


function getFilteredSets() {
  // localSets are explicitly ignored per user request to avoid sync confusion
  // and because the stem_sets table has been deleted in favor of stem_states.

  const cloudSets = stemStatesCache.map((item) => {
    const snapshot = item.stems_snapshot || {}
    const meta = snapshot.metadata || {}
    const bpm = meta.tempo ?? (sessionInfoProvider ? sessionInfoProvider().bpm : 130)
    const key = meta.key ?? (sessionInfoProvider ? sessionInfoProvider().key : 'A Minor')
    const activeStemCount = meta.activeStemCount ?? Object.values(snapshot.stems || {}).filter((stem) => stem && (stem.takes?.length || stem.takeIndex >= 0)).length
    const totalTakes = meta.totalTakes ?? Object.values(snapshot.stems || {}).reduce((sum, stem) => sum + (stem?.takes?.length || 0), 0)
    const timestamp = new Date(item.created_at).getTime()
    const rating = meta.rating ?? 3
    return {
      type: 'cloud',
      item,
      id: item.stem_state_id,
      bpm,
      key,
      bars: meta.bars ?? meta.barCount ?? 4,
      activeStemCount,
      totalTakes,
      name: item.state_name || `Cloud Set ${item.stem_state_id}`,
      timestamp,
      rating
    }
  })

  return cloudSets
    .filter(({ bpm, key, rating }) => {
      const bpmOk = bpm >= filters.bpmMin && bpm <= filters.bpmMax
      const keyOk = filters.key === 'Any Key' || key === filters.key
      const starsOk = filters.stars === null || rating === filters.stars
      return bpmOk && keyOk && starsOk
    })
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
}


function renderSetCard(entry, variant = 'dropdown') {
  const { type, id, bpm, key, bars, name, activeStemCount, totalTakes, rating } = entry
  const label = name
  const displayRating = rating ?? 3

  const isLocal = type === 'local'

  if (variant === 'page') {
    return `
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white/5 border border-white/10 rounded-xl p-4" data-set-card="${isLocal ? id : 'cloud-' + id}">
        <div class="space-y-2 flex-1">
          <div class="flex items-center gap-3">
            <span class="text-base font-semibold set-name-display" ${isLocal ? `data-set-name-display="${id}"` : ''}>${label}</span>
            <div class="star-rating-container" data-current-rating="${displayRating}">
              ${renderStarRating(displayRating, isLocal ? id.toString() : '', 'sm-plus', isLocal)}
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-[12px] text-white/70">
            ${!isLocal ? '<span class="px-2 py-1 rounded-lg bg-blue-500/20 border border-blue-400/30 text-blue-200">Cloud</span>' : ''}
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${bpm} BPM</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${bars} bars</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${key}</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${activeStemCount} stems</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${totalTakes} takes</span>
          </div>
          ${isLocal ? `
          <div class="set-rename-editor hidden" data-rename-editor="${id}">
            <div class="flex items-center gap-2">
              <input type="text" class="flex-1 px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-sm focus:outline-none focus:border-purple-400/60 focus:ring-1 focus:ring-purple-400/30" data-rename-input="${id}" value="${label}" maxlength="50" placeholder="Enter set name">
              <button data-rename-save="${id}" class="px-3 py-1.5 rounded-lg border border-green-400/60 bg-green-500/20 hover:bg-green-500/30 text-sm flex-shrink-0">Save</button>
              <button data-rename-cancel="${id}" class="px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-sm flex-shrink-0">Cancel</button>
            </div>
          </div>` : ''}
        </div>
        <div class="flex flex-col gap-2 flex-shrink-0">
          ${isLocal ? `<button data-rename-set="${id}" class="text-sm px-4 py-2 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 w-full sm:w-auto">Rename</button>` : ''}
          ${isLocal
        ? `<button data-load-set="${id}" class="text-sm px-4 py-2 rounded-lg border border-purple-400/60 bg-purple-500/20 hover:bg-purple-500/30 w-full sm:w-auto">Load set</button>`
        : `<div class="flex gap-2">
                 <button data-delete-cloud-set="${id}" class="text-sm px-3 py-2 rounded-lg border border-red-400/30 bg-red-500/10 hover:bg-red-500/20 text-red-200 w-full sm:w-auto" title="Delete from cloud">
                   <i data-lucide="trash-2" class="w-4 h-4"></i>
                 </button>
                 <button data-load-cloud-set="${id}" class="flex-1 text-sm px-4 py-2 rounded-lg border border-purple-400/60 bg-purple-500/20 hover:bg-purple-500/30 w-full sm:w-auto">Load set</button>
               </div>`
      }
        </div>
      </div>
    `
  }

  return `
    <div class="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl p-3">
      <div class="space-y-1 flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium truncate">${label}</span>
          ${renderStarRating(displayRating, '', 'sm', false)}
        </div>
        <div class="text-xs text-white/60">${!isLocal ? 'Cloud · ' : ''}${bpm} BPM · ${bars} bars · ${key}</div>
      </div>
      ${isLocal
      ? `<button data-load-set="${id}" class="text-sm text-purple-300 hover:text-white ml-3 flex-shrink-0">Load</button>`
      : `<button data-load-cloud-set="${id}" class="text-sm text-purple-300 hover:text-white ml-3 flex-shrink-0">Load</button>`
    }
    </div>
  `
}

function renderStats() {
  const statsEl = favoritesPageRefs?.stats
  if (!statsEl) return

  const likesFiltered = getFilteredLikes()
  const setsFiltered = getFilteredSets()
  const stemsFiltered = getFilteredSavedStems()
  const filterSummary = `${filters.bpmMin}-${filters.bpmMax} BPM • ${filters.key}`

  statsEl.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
      <div class="p-4 rounded-xl bg-white/5 border border-white/10">
        <div class="text-xs uppercase tracking-wide text-white/50">Liked tracks</div>
        <div class="text-2xl font-bold">${likedTracks.length}</div>
        <div class="text-[12px] text-white/60">${likesFiltered.length} match current filters</div>
      </div>
      <div class="p-4 rounded-xl bg-white/5 border border-white/10">
        <div class="text-xs uppercase tracking-wide text-white/50">Saved sets</div>
        <div class="text-2xl font-bold">${savedSetsCache.length}</div>
        <div class="text-[12px] text-white/60">${setsFiltered.length} match current filters</div>
      </div>
      <div class="p-4 rounded-xl bg-white/5 border border-white/10">
        <div class="text-xs uppercase tracking-wide text-white/50">Saved stems</div>
        <div class="text-2xl font-bold">${savedStemsCache.length}</div>
        <div class="text-[12px] text-white/60">${stemsFiltered.length} match current filters</div>
      </div>
      <div class="p-4 rounded-xl bg-white/5 border border-white/10">
        <div class="text-xs uppercase tracking-wide text-white/50">Filters</div>
        <div class="text-sm text-white/80">${filterSummary}</div>
        <div class="text-[12px] text-white/60">Session only • clears on refresh</div>
      </div>
    </div>
  `
}

function notifyLikeChange(stemId) {
  window.dispatchEvent(new CustomEvent('likesUpdated', { detail: { stemId } }))
}

function openFavoritesPageView() {
  window.dispatchEvent(new CustomEvent('openFavoritesPage'))
}

function persistLikesToLocalStorage() {
  try {
    const slim = likedTracks.map((t) => ({
      id: t.id,
      stemId: t.stemId,
      takeIndex: t.takeIndex,
      stemName: t.stemName,
      stemColor: t.stemColor,
      bpm: t.bpm,
      key: t.key,
      bars: t.bars,
      audioKey: t.audioKey || null,
      timestamp: t.timestamp || Date.now(),
      rating: t.rating ?? 3
    }))
    localStorage.setItem(LS_KEY_LIKES, JSON.stringify(slim))
  } catch { }
}

async function syncLikesWithCloud() {
  if (cloudSyncInProgress) return
  cloudSyncInProgress = true
  renderLikes() // Show skeletons
  try {
    const { getUserLikes } = await import('../Auth/stemApi.js')
    const res = await getUserLikes()
    if (!res.success) {
      cloudSyncInProgress = false
      renderLikes()
      return
    }

    const cloud = Array.isArray(res.likes) ? res.likes : []

    // Map cloud likes to local format while preserving existing audio buffers
    const merged = cloud.map((c) => {
      const id = `${c.stem_id}-${c.take_index}`
      const existing = likedTracks.find(t => t.id === id)

      return {
        id: id,
        stemId: c.stem_id,
        takeIndex: c.take_index ?? -1,
        stemName: c.stem_name || c.stem_id,
        stemColor: c.stem_color || 'purple',
        bpm: c.bpm || (sessionInfoProvider ? sessionInfoProvider().bpm : 130),
        key: c.key_signature || (sessionInfoProvider ? sessionInfoProvider().key : 'A Minor'),
        bars: c.bars || null,
        audioBuffer: existing?.audioBuffer || null, // Keep already loaded sound!
        audioKey: c.audio_key || null,
        audio_data: c.audio_data || null,
        timestamp: new Date(c.updated_at).getTime() || Date.now(),
        rating: c.rating ?? 3
      }
    })

    likedTracks.splice(0, likedTracks.length, ...merged)
    persistLikesToLocalStorage()
  } catch (err) {
    console.error('syncLikesWithCloud: Error', err)
  } finally {
    cloudSyncInProgress = false
    renderLikes()
  }
}

