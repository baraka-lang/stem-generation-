import { drawTinyWaveform, getColorRGB } from '../Utilities/waveform.js'

const KEY_OPTIONS = [
  'Any Key',
  'C Major', 'C Minor', 'C# Major', 'C# Minor', 'D Major', 'D Minor', 'D# Major', 'D# Minor',
  'E Major', 'E Minor', 'F Major', 'F Minor', 'F# Major', 'F# Minor', 'G Major', 'G Minor',
  'G# Major', 'G# Minor', 'A Major', 'A Minor', 'A# Major', 'A# Minor', 'B Major', 'B Minor'
]

const DEFAULT_FILTERS = {
  bpmMin: 110,
  bpmMax: 140,
  key: 'Any Key',
  stars: null
}

const likedTracks = []
let savedSetsCache = []
let dropdownEl = null
let favoritesPageRefs = null
let currentTab = 'likes'
let filters = { ...DEFAULT_FILTERS }
let sessionInfoProvider = () => ({ bpm: 130, key: 'A Minor' })
let loadSetHandler = null
let anchorButtons = []
let insertLikeHandler = null
let playLikeHandler = null
let stopPreviewHandler = null
let activePreviewId = null
let previewStopListenerAttached = false

export function initLikesSetsMenu({ getSessionInfo, onLoadSet, onInsertLike, onPlayLike, onStopPreview } = {}) {
  sessionInfoProvider = getSessionInfo || sessionInfoProvider
  loadSetHandler = onLoadSet || null
  insertLikeHandler = onInsertLike || insertLikeHandler
  playLikeHandler = onPlayLike || playLikeHandler
  stopPreviewHandler = onStopPreview || stopPreviewHandler

  anchorButtons = Array.from(document.querySelectorAll('[data-likes-menu-toggle]'))
  if (!anchorButtons.length) return

  buildDropdown()
  attachAnchorHandlers()
  renderFilters()
  renderLikes()
  renderSets()

  document.addEventListener('click', handleOutsideClick)
  document.addEventListener('keydown', handleEscape)
  attachPreviewStopListener()
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
    tabButtons: Array.from(document.querySelectorAll('.favorites-tab-btn'))
  }

  attachFavoritesTabHandlers()
  attachFavoritesScrollLinks()
  renderFilters()
  renderLikes()
  renderSets()
  switchTab(currentTab)
  attachPreviewStopListener()
}

export function refreshFavoritesUI() {
  renderFilters()
  renderLikes()
  renderSets()
}

export function toggleLikeForStem(stemId, track) {
  if (!stemId || !track) return false
  const takeIndex = track.takeIndex ?? -1
  const existingIndex = likedTracks.findIndex((item) => item.stemId === stemId && item.takeIndex === takeIndex)

  if (existingIndex >= 0) {
    likedTracks.splice(existingIndex, 1)
    renderLikes()
    notifyLikeChange(stemId)
    return false
  }

  likedTracks.unshift({
    id: `${stemId}-${Date.now()}`,
    stemId,
    takeIndex,
    stemName: track.stemName || stemId,
    stemColor: track.stemColor || 'purple',
    bpm: track.bpm || sessionInfoProvider().bpm || 130,
    key: track.key || sessionInfoProvider().key || 'A Minor',
    bars: track.bars || null,
    audioBuffer: track.audioBuffer || null,
    timestamp: Date.now(),
    rating: 3
  })
  renderLikes()
  notifyLikeChange(stemId)
  return true
}

export function isTrackLiked(stemId, takeIndex) {
  return likedTracks.some((item) => item.stemId === stemId && item.takeIndex === takeIndex)
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
  toastEl.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg text-sm z-50 transition-opacity ${
    type === 'error'
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

function generateBPMOptions(selected, min = 110, max = 140) {
  const options = []
  for (let bpm = min; bpm <= max; bpm++) {
    const isSelected = bpm === selected ? 'selected' : ''
    options.push(`<option value="${bpm}" ${isSelected}>${bpm} BPM</option>`)
  }
  return options.join('')
}

function buildDropdown() {
  dropdownEl = document.createElement('div')
  dropdownEl.id = 'likesSetsDropdown'
  dropdownEl.className = 'fixed z-40 w-full max-w-md sm:max-w-lg player-surface card-border border border-white/10 rounded-2xl shadow-2xl hidden opacity-0 transition-all duration-200'
  dropdownEl.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <div class="inline-flex bg-white/5 border border-white/10 rounded-lg overflow-hidden text-sm">
        <button data-tab="likes" class="tab-btn px-3 py-1.5 font-medium">Likes</button>
        <button data-tab="sets" class="tab-btn px-3 py-1.5 text-white/70">Sets</button>
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
      <div class="pt-1 border-t border-white/10 flex items-center justify-between text-xs text-white/70">
        <span class="hidden sm:inline">Need more space? Open the full favorites page.</span>
        <button data-open-favorites-page class="px-3 py-2 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white text-xs">Open favorites</button>
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

function attachAnchorHandlers() {
  anchorButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
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
  if (!dropdownEl) return
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

function closeMenu() {
  if (!dropdownEl) return
  dropdownEl.classList.add('opacity-0')
  dropdownEl.classList.add('hidden')
  anchorButtons.forEach((btn) => btn.classList.remove('ring-2', 'ring-purple-400/60', 'bg-white/5'))
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
}

function switchTab(tab) {
  currentTab = tab === 'sets' ? 'sets' : 'likes'
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
    if (likesFilters && likesList && setsPanel) {
      if (currentTab === 'likes') {
        likesFilters.classList.remove('hidden')
        likesList.classList.remove('hidden')
        setsPanel.classList.add('hidden')
      } else {
        likesFilters.classList.add('hidden')
        likesList.classList.add('hidden')
        setsPanel.classList.remove('hidden')
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
  if (favoritesLikes && favoritesSets) {
    if (currentTab === 'likes') {
      favoritesLikes.classList.remove('hidden')
      favoritesSets.classList.add('hidden')
    } else {
      favoritesLikes.classList.add('hidden')
      favoritesSets.classList.remove('hidden')
    }
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

function renderFilters() {
  renderFilterPanel(dropdownEl?.querySelector('#likesFilters'), 'likes')
  renderFilterPanel(dropdownEl?.querySelector('#setsFilters'), 'sets')
  renderFilterPanel(favoritesPageRefs?.likesFilters, 'likes', 'page')
  renderFilterPanel(favoritesPageRefs?.setsFilters, 'sets', 'page')
}

function renderFilterPanel(container, prefix, context = 'dropdown') {
  if (!container) return
  const columnClass = 'sm:grid-cols-4'
  const label = prefix === 'sets' ? 'Saved set filters' : 'Likes filters'
  const baseClass = context === 'page'
    ? `filter-panel space-y-3 text-xs text-white/80 bg-white/5 border border-white/10 rounded-xl p-3`
    : `filter-panel space-y-3 text-xs text-white/80 bg-white/5 border border-white/10 rounded-xl p-3`
  container.className = baseClass

  const currentStars = filters.stars || 0

  container.innerHTML = `
    <div class="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.2em] text-white/50">
      <span>${label}</span>
      <button data-filter="clear" class="text-[11px] text-purple-300 hover:text-white">Reset</button>
    </div>
    <div class="grid grid-cols-1 ${columnClass} gap-2 items-end">
      <div>
        <label class="block text-[11px] text-white/60 mb-1">BPM Min</label>
        <select data-filter="bpmMin" class="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm">
          ${generateBPMOptions(filters.bpmMin, 110, filters.bpmMax)}
        </select>
      </div>
      <div>
        <label class="block text-[11px] text-white/60 mb-1">BPM Max</label>
        <select data-filter="bpmMax" class="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm">
          ${generateBPMOptions(filters.bpmMax, filters.bpmMin, 140)}
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
  } else {
    renderSets()
  }
}

function renderLikes() {
  const containers = getLikesContainers()
  if (!containers.length) return

  const filtered = getFilteredLikes()
  const itemMap = new Map(filtered.map((item) => [item.id, item]))

  containers.forEach(({ el, variant }) => {
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
  const dropdownList = dropdownEl?.querySelector('#likesList')
  if (dropdownList) containers.push({ el: dropdownList, variant: 'dropdown' })
  if (favoritesPageRefs?.likesList) containers.push({ el: favoritesPageRefs.likesList, variant: 'page' })
  return containers
}

function getFilteredLikes() {
  return likedTracks.filter((item) => {
    const bpmOk = item.bpm >= filters.bpmMin && item.bpm <= filters.bpmMax
    const keyOk = filters.key === 'Any Key' || item.key === filters.key
    const starsOk = filters.stars === null || (item.rating ?? 3) === filters.stars
    return bpmOk && keyOk && starsOk
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
    btn.addEventListener('click', () => {
      const [stemId, takeIdx] = (btn.getAttribute('data-unlike') || '').split('|')
      const idxNum = parseInt(takeIdx, 10)
      removeLike(stemId, idxNum)
    })
  })

  container.querySelectorAll('[data-insert-like]').forEach((btn) => {
    const item = itemMap.get(btn.getAttribute('data-insert-like'))
    btn.addEventListener('click', () => handleInsertLike(item, variant))
  })

  container.querySelectorAll('[data-like-play]').forEach((btn) => {
    const item = itemMap.get(btn.getAttribute('data-like-play'))
    btn.addEventListener('click', () => handlePlayRequest(item))
  })

  // Attach star rating handlers for favorites page (interactive)
  if (variant === 'page') {
    attachStarHandlers(container, 'like')
  }
}

function renderLikeWaveforms(container, itemMap) {
  const canvases = Array.from(container.querySelectorAll('[data-like-waveform]'))
  if (!canvases.length) return

  requestAnimationFrame(() => {
    canvases.forEach((canvas) => {
      const item = itemMap.get(canvas.getAttribute('data-like-waveform'))
      const width = canvas.clientWidth || Number(canvas.getAttribute('width')) || 320
      const height = canvas.clientHeight || Number(canvas.getAttribute('height')) || 64
      canvas.width = width
      canvas.height = height

      if (item?.audioBuffer) {
        const color = `rgba(${getColorRGB(item.stemColor)},0.9)`
        drawTinyWaveform(canvas, item.audioBuffer, color, 'rgba(255,255,255,0.05)')
      } else {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = 'rgba(255,255,255,0.08)'
          ctx.fillRect(0, 0, width, height)
        }
      }
    })
  })
}

function handleInsertLike(item, variant = 'dropdown') {
  if (!item || !insertLikeHandler) return
  insertLikeHandler(item)
  if (variant === 'dropdown') closeMenu()
}

function handlePlayRequest(item) {
  if (!item || !playLikeHandler) return
  const result = playLikeHandler(item, activePreviewId)
  if (result instanceof Promise) {
    result.then((id) => {
      activePreviewId = id || null
      updateLikePlayButtons()
    }).catch(() => {})
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

  const filtered = getFilteredSets()

  containers.forEach(({ el, variant }) => {
    if (!filtered.length) {
      el.innerHTML = `<div class="text-sm text-white/60 bg-white/5 border border-white/10 rounded-xl p-4">No saved sets yet. Save your current session from the player bar.</div>`
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

    // Attach star rating handlers for favorites page (interactive)
    if (variant === 'page') {
      attachStarHandlers(el, 'set')
      attachRenameHandlers(el)
    }
  })

  renderStats()
}

function getSetContainers() {
  const containers = []
  const dropdownList = dropdownEl?.querySelector('#setsList')
  if (dropdownList) containers.push({ el: dropdownList, variant: 'dropdown' })
  if (favoritesPageRefs?.setsList) containers.push({ el: favoritesPageRefs.setsList, variant: 'page' })
  return containers
}

function getFilteredSets() {
  const decorated = savedSetsCache.map((item, idx) => {
    const meta = item.metadata || {}
    const bpm = meta.tempo ?? sessionInfoProvider().bpm
    const key = meta.key ?? sessionInfoProvider().key
    const activeStemCount = meta.activeStemCount ?? Object.values(item.stems || {}).filter((stem) => stem && (stem.takes?.length || stem.takeIndex >= 0)).length
    const totalTakes = meta.totalTakes ?? Object.values(item.stems || {}).reduce((sum, stem) => sum + (stem?.takes?.length || 0), 0)
    const timestamp = meta.timestamp || item.timestamp || 0
    const rating = meta.rating ?? 3
    return { item, idx, bpm, key, bars: meta.bars ?? meta.barCount ?? 4, activeStemCount, totalTakes, name: meta.name || `Set ${idx + 1}`, timestamp, rating }
  })

  return decorated
    .filter(({ bpm, key, rating }) => {
      const bpmOk = bpm >= filters.bpmMin && bpm <= filters.bpmMax
      const keyOk = filters.key === 'Any Key' || key === filters.key
      const starsOk = filters.stars === null || rating === filters.stars
      return bpmOk && keyOk && starsOk
    })
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
}

function renderSetCard(entry, variant = 'dropdown') {
  const { idx, bpm, key, bars, name, activeStemCount, totalTakes, rating } = entry
  const label = name || `Set ${idx + 1}`
  const displayRating = rating ?? 3

  if (variant === 'page') {
    return `
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white/5 border border-white/10 rounded-xl p-4" data-set-card="${idx}">
        <div class="space-y-2 flex-1">
          <div class="flex items-center gap-3">
            <span class="text-base font-semibold set-name-display" data-set-name-display="${idx}">${label}</span>
            <div class="star-rating-container" data-current-rating="${displayRating}">
              ${renderStarRating(displayRating, idx.toString(), 'sm-plus', true)}
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-[12px] text-white/70">
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${bpm} BPM</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${bars} bars</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${key}</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${activeStemCount} stems</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${totalTakes} takes</span>
          </div>
          <div class="set-rename-editor hidden" data-rename-editor="${idx}">
            <div class="flex items-center gap-2">
              <input type="text" class="flex-1 px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-sm focus:outline-none focus:border-purple-400/60 focus:ring-1 focus:ring-purple-400/30" data-rename-input="${idx}" value="${label}" maxlength="50" placeholder="Enter set name">
              <button data-rename-save="${idx}" class="px-3 py-1.5 rounded-lg border border-green-400/60 bg-green-500/20 hover:bg-green-500/30 text-sm flex-shrink-0">Save</button>
              <button data-rename-cancel="${idx}" class="px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-sm flex-shrink-0">Cancel</button>
            </div>
          </div>
        </div>
        <div class="flex flex-col gap-2 flex-shrink-0">
          <button data-rename-set="${idx}" class="text-sm px-4 py-2 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 w-full sm:w-auto">Rename</button>
          <button data-load-set="${idx}" class="text-sm px-4 py-2 rounded-lg border border-purple-400/60 bg-purple-500/20 hover:bg-purple-500/30 w-full sm:w-auto">Load set</button>
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
        <div class="text-xs text-white/60">${bpm} BPM · ${bars} bars · ${key}</div>
      </div>
      <button data-load-set="${idx}" class="text-sm text-purple-300 hover:text-white ml-3 flex-shrink-0">Load</button>
    </div>
  `
}

function renderStats() {
  const statsEl = favoritesPageRefs?.stats
  if (!statsEl) return

  const likesFiltered = getFilteredLikes()
  const setsFiltered = getFilteredSets()
  const filterSummary = `${filters.bpmMin}-${filters.bpmMax} BPM • ${filters.key}`

  statsEl.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
