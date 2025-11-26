const KEY_OPTIONS = [
  'Any Key',
  'C Major', 'C Minor', 'C# Major', 'C# Minor', 'D Major', 'D Minor', 'D# Major', 'D# Minor',
  'E Major', 'E Minor', 'F Major', 'F Minor', 'F# Major', 'F# Minor', 'G Major', 'G Minor',
  'G# Major', 'G# Minor', 'A Major', 'A Minor', 'A# Major', 'A# Minor', 'B Major', 'B Minor'
]

const DEFAULT_FILTERS = {
  bpmMin: 110,
  bpmMax: 140,
  key: 'Any Key'
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

export function initLikesSetsMenu({ getSessionInfo, onLoadSet } = {}) {
  sessionInfoProvider = getSessionInfo || sessionInfoProvider
  loadSetHandler = onLoadSet || null

  anchorButtons = Array.from(document.querySelectorAll('[data-likes-menu-toggle]'))
  if (!anchorButtons.length) return

  buildDropdown()
  attachAnchorHandlers()
  renderFilters()
  renderLikes()
  renderSets()

  document.addEventListener('click', handleOutsideClick)
  document.addEventListener('keydown', handleEscape)
}

export function initFavoritesPageView({ getSessionInfo, onLoadSet } = {}) {
  sessionInfoProvider = getSessionInfo || sessionInfoProvider
  loadSetHandler = onLoadSet || loadSetHandler

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
    timestamp: Date.now()
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
  renderSets()
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
  const columnClass = 'sm:grid-cols-3'
  const label = prefix === 'sets' ? 'Saved set filters' : 'Likes filters'
  const baseClass = context === 'page'
    ? `filter-panel space-y-3 text-xs text-white/80 bg-white/5 border border-white/10 rounded-xl p-3`
    : `filter-panel space-y-3 text-xs text-white/80 bg-white/5 border border-white/10 rounded-xl p-3`
  container.className = baseClass
  container.innerHTML = `
    <div class="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.2em] text-white/50">
      <span>${label}</span>
      <button data-filter="clear" class="text-[11px] text-purple-300 hover:text-white">Reset</button>
    </div>
    <div class="grid grid-cols-1 ${columnClass} gap-3">
      <div class="col-span-1">
        <label class="block text-[11px] text-white/60">BPM Min</label>
        <input type="range" min="110" max="140" value="${filters.bpmMin}" data-filter="bpmMin" class="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer">
        <div class="text-[11px] mt-1">${filters.bpmMin} BPM</div>
      </div>
      <div class="col-span-1">
        <label class="block text-[11px] text-white/60">BPM Max</label>
        <input type="range" min="110" max="140" value="${filters.bpmMax}" data-filter="bpmMax" class="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer">
        <div class="text-[11px] mt-1">${filters.bpmMax} BPM</div>
      </div>
      <div class="col-span-1">
        <label class="block text-[11px] text-white/60">Key</label>
        <select data-filter="key" class="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm">
          ${KEY_OPTIONS.map((key) => `<option ${filters.key === key ? 'selected' : ''}>${key}</option>`).join('')}
        </select>
      </div>
    </div>
  `

  container.querySelectorAll('[data-filter]').forEach((el) => {
    el.addEventListener('input', (e) => handleFilterChange(e, prefix))
    el.addEventListener('change', (e) => handleFilterChange(e, prefix))
    el.addEventListener('click', (e) => handleFilterChange(e, prefix))
  })
}

function handleFilterChange(e, prefix) {
  const type = e.target.getAttribute('data-filter')
  if (type === 'clear') {
    filters = { ...DEFAULT_FILTERS }
    renderFilters()
  } else if (type === 'bpmMin') {
    filters.bpmMin = Math.min(parseInt(e.target.value, 10) || DEFAULT_FILTERS.bpmMin, filters.bpmMax)
  } else if (type === 'bpmMax') {
    filters.bpmMax = Math.max(parseInt(e.target.value, 10) || DEFAULT_FILTERS.bpmMax, filters.bpmMin)
  } else if (type === 'key') {
    filters.key = e.target.value
  }

  if (prefix === 'likes') {
    renderLikes()
  } else {
    renderSets()
  }
}

function renderWaveform(seed, color = 'rgba(168,85,247,0.85)') {
  if (!seed) return ''
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 9973
  }

  const bars = Array.from({ length: 24 }).map((_, idx) => {
    const value = ((hash + idx * 17) % 70) + 25
    return `<span class="flex-1 rounded-full" style="height:${value}%; background: linear-gradient(180deg, ${color}, rgba(255,255,255,0.25));"></span>`
  })

  return `<div class="flex items-end gap-[3px] h-16 w-full max-w-md" aria-hidden="true">${bars.join('')}</div>`
}

function renderLikes() {
  const containers = getLikesContainers()
  if (!containers.length) return

  const filtered = getFilteredLikes()

  containers.forEach(({ el, variant }) => {
    if (!filtered.length) {
      el.innerHTML = `<div class="text-sm text-white/60 bg-white/5 border border-white/10 rounded-xl p-4">No liked tracks yet. Press ♥ on any stem to add it here.</div>`
      return
    }

    el.innerHTML = filtered
      .map((item) => renderLikeCard(item, variant))
      .join('')

    el.querySelectorAll('[data-unlike]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [stemId, takeIdx] = (btn.getAttribute('data-unlike') || '').split('|')
        const idxNum = parseInt(takeIdx, 10)
        const index = likedTracks.findIndex((entry) => entry.stemId === stemId && entry.takeIndex === idxNum)
        if (index >= 0) {
          likedTracks.splice(index, 1)
          renderLikes()
          notifyLikeChange(stemId)
        }
      })
    })
  })

  renderStats()
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
    return bpmOk && keyOk
  })
}

function renderLikeCard(item, variant = 'dropdown') {
  const minutesAgo = Math.max(1, Math.round((Date.now() - item.timestamp) / 60000))
  const baseInfo = `${item.bpm} BPM · ${item.key}`
  const timeLabel = minutesAgo < 60 ? `${minutesAgo} min ago` : `${Math.round(minutesAgo / 60)}h ago`

  if (variant === 'page') {
    return `
      <div class="flex flex-col gap-3 bg-white/5 border border-white/10 rounded-xl p-4">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div class="flex items-start gap-3">
            <span class="mt-1 w-2 h-2 rounded-full bg-${item.stemColor}-400"></span>
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-base font-semibold">${item.stemName}</span>
                <span class="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[11px]">Take ${item.takeIndex + 1}</span>
                <span class="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[11px]">${baseInfo}</span>
              </div>
              <div class="text-[12px] text-white/60">${timeLabel}</div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-white/60 px-2 py-1 rounded-full bg-white/5 border border-white/10">Session like</span>
            <button data-unlike="${item.stemId}|${item.takeIndex}" class="text-sm text-red-300 hover:text-red-100">Remove</button>
          </div>
        </div>
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div class="flex-1">
            ${renderWaveform(`${item.stemId}-${item.takeIndex}-${item.timestamp}`)}
          </div>
          <div class="flex gap-2 text-[12px] text-white/70">
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">BPM ${item.bpm}</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${item.key}</span>
          </div>
        </div>
      </div>
    `
  }

  return `
    <div class="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl p-3">
      <div class="flex flex-col">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-${item.stemColor}-400"></span>
          <span class="text-sm font-medium">${item.stemName}</span>
        </div>
        <div class="text-xs text-white/60">${baseInfo}</div>
        <div class="text-[11px] text-white/40">${timeLabel}</div>
      </div>
      <button data-unlike="${item.stemId}|${item.takeIndex}" class="text-sm text-red-300 hover:text-red-100">Remove</button>
    </div>
  `
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
    return { item, idx, bpm, key, bars: meta.bars ?? meta.barCount ?? 4, activeStemCount, totalTakes, name: meta.name || `Set ${idx + 1}`, timestamp }
  })

  return decorated
    .filter(({ bpm, key }) => {
      const bpmOk = bpm >= filters.bpmMin && bpm <= filters.bpmMax
      const keyOk = filters.key === 'Any Key' || key === filters.key
      return bpmOk && keyOk
    })
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
}

function renderSetCard(entry, variant = 'dropdown') {
  const { idx, bpm, key, bars, name, activeStemCount, totalTakes } = entry
  const label = name || `Set ${idx + 1}`
  const timestamp = entry.timestamp || 0
  const minutesAgo = timestamp ? Math.max(1, Math.round((Date.now() - timestamp) / 60000)) : null
  const timeLabel = minutesAgo ? (minutesAgo < 60 ? `${minutesAgo} min ago` : `${Math.round(minutesAgo / 60)}h ago`) : 'Saved this session'

  if (variant === 'page') {
    return `
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white/5 border border-white/10 rounded-xl p-4">
        <div>
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <span class="text-base font-semibold">${label}</span>
            <span class="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[11px]">${timeLabel}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-[12px] text-white/70">
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${bpm} BPM</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${bars} bars</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${key}</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${activeStemCount} active stems</span>
            <span class="px-2 py-1 rounded-lg bg-white/5 border border-white/10">${totalTakes} takes</span>
          </div>
        </div>
        <button data-load-set="${idx}" class="text-sm px-3 py-2 rounded-lg border border-purple-400/60 bg-purple-500/20 hover:bg-purple-500/30">Load set</button>
      </div>
    `
  }

  return `
    <div class="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl p-3">
      <div>
        <div class="text-sm font-medium">${label}</div>
        <div class="text-xs text-white/60">${bpm} BPM · ${bars} bars · ${key}</div>
        <div class="text-[11px] text-white/40">${timeLabel}</div>
      </div>
      <button data-load-set="${idx}" class="text-sm text-purple-300 hover:text-white">Load</button>
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
