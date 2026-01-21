# Likes & Sets Menu Implementation Guide

## Project Overview

**TunePal Beta AI Music Studio** is an AI-powered techno music generator that allows users to create, mix, and export multi-stem techno tracks. The application features:

- **9 Stem Types**: Kick, Snare, Bass, Lead, Hihat, Pad, Arp, FX, and Perc
- **Session-Based Workflow**: Users set tempo (110-140 BPM), bars (2 or 4), and key before generation
- **Multi-Take System**: Each stem can have multiple generated variations (takes)
- **Save Sets Feature**: Users can save entire session states with all stems and settings
- **Real-time Playback**: Interactive mixer with EQ, filters, volume, and solo/mute controls

## Current Architecture

### Technology Stack
- **Frontend**: Vanilla JavaScript with Vite build system
- **UI Framework**: TailwindCSS with Lucide icons
- **Audio**: Web Audio API for playback and processing
- **Backend**: Supabase Edge Functions for AI generation
- **State Management**: In-memory JavaScript objects

### Key Files
- `src/app.js` - Main application logic (7500+ lines)
- `src/pages/selection-page.html` - Genre selection page with header
- `public/src/templates.html` - Studio header template
- `src/Config/stems.js` - Stem configurations and order

### Current Header Structure

Both the selection page and studio page have headers with:
- Logo section (left): Music icon + "TunePal Beta" + "AI Music Studio"
- User status containers (right): `userStatusContainer` and `logedInUserMenu`

```html
<!-- Location: Top right of header -->
<div id="userStatusContainer"></div>
<div id="logedInUserMenu" class="hidden"></div>
```

### Data Structures

#### Stem Data
Each stem follows this structure from `src/Config/stems.js`:
```javascript
{
  kick: {
    name: 'Kick',
    color: 'red',
    basePrompt: 'deep techno kick drum',
    controls: { /* knobs and toggles */ }
  }
  // ... 8 more stems
}
```

**Stem Order (Fixed)**: `['kick','perc','bass','lead','hihat','pad','arp','fx','perc2']`

#### Session State
```javascript
stemControlValues = {
  master: {
    tempo: 130,        // BPM (110-140)
    bars: 4,           // Number of bars (2 or 4)
    rootBase: 'A',     // Key root note
    accidental: 'natural', // sharp/flat/natural
    mode: 'Minor'      // Major/Minor
  },
  kick: { /* control values */ },
  // ... all stems
}
```

#### Saved Sets
```javascript
const savedSets = [] // Array of snapshots

// Each snapshot contains:
{
  timestamp: Date.now(),
  tempo: 130,
  bars: 4,
  root: 'A Minor',
  stems: {
    kick: {
      takes: [/* audio buffers and metadata */],
      takeIndex: 0,
      controlValues: {},
      muted: false,
      // ... more state
    }
    // ... all 9 stems
  }
}
```

### Current Modal System

The app uses multiple modals with consistent patterns:
- Fixed full-screen overlay with backdrop blur
- Modal containers with `player-surface` styling
- Animations with opacity and scale transitions
- Z-index of 50 for modals, 40 for player bar, 30 for headers

Example modal pattern:
```javascript
function openModal() {
  const modal = document.getElementById('modalId')
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.classList.remove('opacity-0')
    modal.querySelector('.transform').classList.remove('scale-95')
  })
}

function closeModal() {
  const modal = document.getElementById('modalId')
  modal.classList.add('opacity-0')
  modal.querySelector('.transform').classList.add('scale-95')
  setTimeout(() => modal.classList.add('hidden'), 300)
}
```

## Feature Requirements: Likes & Sets Menu

### User Story
As a user, I want to access my liked tracks and saved sets through a menu in the top-right corner, so I can quickly browse and filter my work by BPM and key.

### Functional Requirements

#### 1. Account Icon Button
- **Location**: Top-right corner of both headers (selection page and studio page)
- **Icon**: User account icon (Lucide `user` icon)
- **Behavior**: Toggles dropdown menu on click
- **State**: Shows active state when menu is open

#### 2. Dropdown Menu
- **Position**: Below account icon, aligned to right edge
- **Width**: 320px (mobile) to 400px (desktop)
- **Height**: Max 80vh with scrollable content
- **Style**: Match existing modal styling with `player-surface` and `card-border`
- **Close Behavior**:
  - Click outside dropdown
  - Click account icon again
  - Press Escape key

#### 3. Menu Structure
Two tab sections:
- **Likes Tab** (default)
- **Sets Tab**

#### 4. Likes Tab Features

**Content**: List of "liked" tracks (stems/takes that user hearts)

**Data Structure**:
```javascript
const likedTracks = [
  {
    id: 'unique-id',
    stemType: 'kick',      // One of STEM_ORDER
    stemName: 'Kick',      // Display name
    stemColor: 'red',      // For visual indicator
    takeIndex: 0,
    timestamp: Date.now(),
    bpm: 130,
    key: 'A Minor',
    audioBuffer: AudioBuffer, // Reference to audio
    // Optional metadata
    duration: 8.0,         // seconds
    liked: true
  }
]
```

**UI Elements**:
- Empty state: "No liked tracks yet. Press ♥ on any stem to add it here."
- Filter controls:
  - BPM range slider (110-140)
  - Key dropdown (all 12 notes × 2 modes = 24 options)
  - Clear filters button
- Track list:
  - Stem name with color indicator
  - BPM and Key display
  - Play/pause button (inline preview)
  - Unlike button (remove from list)
  - Timestamp or "X minutes ago"

**Interactions**:
- Click track to preview (plays in isolation)
- Click unlike to remove from list
- Filters update list in real-time
- Sorted by most recent first

#### 5. Sets Tab Features

**Content**: List of saved sets (existing `savedSets` array)

**Data Structure**: Uses existing saved sets structure with added metadata:
```javascript
{
  timestamp: Date.now(),
  tempo: 130,
  bars: 4,
  root: 'A Minor',
  name: 'Set 1',          // Auto-generated or user-named
  stems: { /* ... */ },
  // Add preview metadata
  activeStemCount: 5,     // Number of non-empty stems
  totalTakes: 12          // Total takes across all stems
}
```

**UI Elements**:
- Empty state: "No saved sets yet. Save your current session from the player bar."
- Filter controls:
  - BPM range slider (110-140)
  - Key dropdown (24 options)
  - Bar count filter (2 bars / 4 bars / All)
  - Clear filters button
- Set list:
  - Set name ("Set 1", "Set 2", etc.)
  - BPM, Key, and Bars display
  - Active stem count and total takes
  - Load button (replaces current session)
  - Delete button (removes from list)
  - Timestamp or "X minutes ago"

**Interactions**:
- Click "Load" to restore session (reuses existing `loadSetFromSnapshot` logic)
- Click delete to remove set
- Filters update list in real-time
- Sorted by most recent first

### Non-Functional Requirements

#### Session-Only Storage
- **No Persistence**: All data exists only in current browser session
- **Lost on Refresh**: Clear warning in UI if needed
- **Demo Purpose**: This is a prototype feature, not production-ready

#### Performance
- Filter operations should be instant (<16ms)
- List should support up to 100 items without lag
- Audio preview should start within 200ms

#### Accessibility
- Keyboard navigation for dropdown and tabs
- ARIA labels for all interactive elements
- Focus management when opening/closing menu
- Screen reader announcements for filter updates

## Implementation Plan

### Phase 1: UI Structure (60 minutes)

#### Step 1.1: Add Account Icon to Headers
**Files**:
- `src/pages/selection-page.html`
- `public/src/templates.html`

**Changes**:
1. Add account icon button in header right section (before or after existing user containers)
2. Use Lucide `user` icon
3. Add appropriate classes and data attributes
4. Include aria-expanded and aria-label attributes

```html
<button
  id="accountMenuBtn"
  class="w-10 h-10 flex items-center justify-center rounded-lg border border-white/20 player-surface hover:bg-white/10 transition"
  aria-label="Account menu"
  aria-expanded="false"
>
  <i data-lucide="user" class="w-5 h-5"></i>
</button>
```

#### Step 1.2: Create Dropdown Menu HTML
**File**: `public/src/templates.html`

**Structure**:
```html
<!-- Account Dropdown Menu -->
<div id="accountDropdown" class="fixed top-16 right-4 z-50 w-80 sm:w-96 max-h-[80vh] player-surface card-border rounded-xl shadow-2xl hidden opacity-0 transform scale-95 transition-all duration-200">
  <!-- Tab Headers -->
  <div class="flex border-b border-white/10">
    <button id="likesTab" class="flex-1 px-4 py-3 text-sm font-medium border-b-2 border-purple-500 text-white">
      <i data-lucide="heart" class="w-4 h-4 inline mr-2"></i>Likes
    </button>
    <button id="setsTab" class="flex-1 px-4 py-3 text-sm font-medium border-b-2 border-transparent text-white/60 hover:text-white">
      <i data-lucide="layers" class="w-4 h-4 inline mr-2"></i>Sets
    </button>
  </div>

  <!-- Likes Content -->
  <div id="likesContent" class="p-4">
    <!-- Filters -->
    <div class="space-y-3 mb-4 pb-4 border-b border-white/10">
      <div>
        <label class="text-xs text-white/60 mb-1 block">BPM Range</label>
        <div class="flex items-center gap-2">
          <input type="range" id="likesBpmMin" min="110" max="140" value="110" class="flex-1 h-1">
          <span id="likesBpmMinVal" class="text-xs w-8">110</span>
          <span class="text-xs text-white/40">-</span>
          <input type="range" id="likesBpmMax" min="110" max="140" value="140" class="flex-1 h-1">
          <span id="likesBpmMaxVal" class="text-xs w-8">140</span>
        </div>
      </div>
      <div>
        <label class="text-xs text-white/60 mb-1 block">Key</label>
        <select id="likesKeyFilter" class="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm">
          <option value="">All Keys</option>
          <!-- Will be populated by JS -->
        </select>
      </div>
      <button id="likesClearFilters" class="text-xs text-purple-400 hover:text-purple-300">
        Clear Filters
      </button>
    </div>

    <!-- Track List -->
    <div id="likesTrackList" class="space-y-2 overflow-y-auto max-h-96">
      <!-- Empty state or track items -->
    </div>
  </div>

  <!-- Sets Content -->
  <div id="setsContent" class="p-4 hidden">
    <!-- Similar structure to Likes but for Sets -->
  </div>
</div>
```

### Phase 2: Data Management (45 minutes)

#### Step 2.1: Create Likes State Manager
**New File**: `src/likesManager.js`

```javascript
// Likes state management (session-only)
let likedTracks = []
let likesFilterState = {
  bpmMin: 110,
  bpmMax: 140,
  key: ''
}

export function addLikedTrack(stemData) {
  const track = {
    id: `like-${Date.now()}-${Math.random()}`,
    stemType: stemData.stemType,
    stemName: stemData.stemName,
    stemColor: stemData.stemColor,
    takeIndex: stemData.takeIndex,
    timestamp: Date.now(),
    bpm: stemData.bpm,
    key: stemData.key,
    audioBuffer: stemData.audioBuffer,
    duration: stemData.audioBuffer.duration,
    liked: true
  }

  likedTracks.unshift(track) // Add to beginning
  return track.id
}

export function removeLikedTrack(trackId) {
  const index = likedTracks.findIndex(t => t.id === trackId)
  if (index !== -1) {
    likedTracks.splice(index, 1)
    return true
  }
  return false
}

export function getFilteredLikes() {
  return likedTracks.filter(track => {
    const bpmMatch = track.bpm >= likesFilterState.bpmMin &&
                     track.bpm <= likesFilterState.bpmMax
    const keyMatch = !likesFilterState.key || track.key === likesFilterState.key
    return bpmMatch && keyMatch
  })
}

export function setLikesFilter(filters) {
  Object.assign(likesFilterState, filters)
}

export function clearLikesFilters() {
  likesFilterState = { bpmMin: 110, bpmMax: 140, key: '' }
}

export function getLikesStats() {
  return {
    total: likedTracks.length,
    filtered: getFilteredLikes().length
  }
}
```

#### Step 2.2: Enhance Sets Data Manager
**File**: `src/app.js` (add helper functions)

```javascript
// Add filtering for saved sets
function getFilteredSets(filters) {
  return savedSets.filter(set => {
    const bpmMatch = set.tempo >= filters.bpmMin &&
                     set.tempo <= filters.bpmMax
    const keyMatch = !filters.key || set.root === filters.key
    const barsMatch = !filters.bars || set.bars === filters.bars
    return bpmMatch && keyMatch && barsMatch
  })
}

// Add set statistics
function getSetStats(snapshot) {
  const activeStemCount = Object.values(snapshot.stems)
    .filter(stem => stem.takes && stem.takes.length > 0).length

  const totalTakes = Object.values(snapshot.stems)
    .reduce((sum, stem) => sum + (stem.takes?.length || 0), 0)

  return { activeStemCount, totalTakes }
}
```

### Phase 3: Menu Interactions (60 minutes)

#### Step 3.1: Dropdown Toggle Logic
**File**: `src/app.js`

```javascript
let accountMenuOpen = false

function toggleAccountMenu() {
  const dropdown = document.getElementById('accountDropdown')
  const btn = document.getElementById('accountMenuBtn')

  if (!dropdown) return

  accountMenuOpen = !accountMenuOpen

  if (accountMenuOpen) {
    openAccountMenu()
  } else {
    closeAccountMenu()
  }

  btn.setAttribute('aria-expanded', accountMenuOpen)
}

function openAccountMenu() {
  const dropdown = document.getElementById('accountDropdown')
  dropdown.classList.remove('hidden')

  // Animate in
  requestAnimationFrame(() => {
    dropdown.classList.remove('opacity-0', 'scale-95')
  })

  // Render current tab content
  renderAccountMenuContent()

  // Add event listeners
  document.addEventListener('click', handleAccountMenuClickOutside)
  document.addEventListener('keydown', handleAccountMenuKeydown)
}

function closeAccountMenu() {
  const dropdown = document.getElementById('accountDropdown')
  dropdown.classList.add('opacity-0', 'scale-95')

  setTimeout(() => {
    dropdown.classList.add('hidden')
  }, 200)

  accountMenuOpen = false

  // Remove event listeners
  document.removeEventListener('click', handleAccountMenuClickOutside)
  document.removeEventListener('keydown', handleAccountMenuKeydown)
}

function handleAccountMenuClickOutside(e) {
  const dropdown = document.getElementById('accountDropdown')
  const btn = document.getElementById('accountMenuBtn')

  if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
    closeAccountMenu()
  }
}

function handleAccountMenuKeydown(e) {
  if (e.key === 'Escape') {
    closeAccountMenu()
  }
}
```

#### Step 3.2: Tab Switching
```javascript
let activeAccountTab = 'likes' // 'likes' | 'sets'

function switchAccountTab(tabName) {
  activeAccountTab = tabName

  // Update tab buttons
  const likesTab = document.getElementById('likesTab')
  const setsTab = document.getElementById('setsTab')

  likesTab.classList.toggle('border-purple-500', tabName === 'likes')
  likesTab.classList.toggle('text-white', tabName === 'likes')
  likesTab.classList.toggle('border-transparent', tabName !== 'likes')
  likesTab.classList.toggle('text-white/60', tabName !== 'likes')

  setsTab.classList.toggle('border-purple-500', tabName === 'sets')
  setsTab.classList.toggle('text-white', tabName === 'sets')
  setsTab.classList.toggle('border-transparent', tabName !== 'sets')
  setsTab.classList.toggle('text-white/60', tabName !== 'sets')

  // Update content visibility
  const likesContent = document.getElementById('likesContent')
  const setsContent = document.getElementById('setsContent')

  likesContent.classList.toggle('hidden', tabName !== 'likes')
  setsContent.classList.toggle('hidden', tabName !== 'sets')

  // Render content
  renderAccountMenuContent()
}
```

### Phase 4: Likes Implementation (90 minutes)

#### Step 4.1: Add Heart Button to Stem Cards
**File**: `src/app.js` (modify card creation)

Add heart button to each stem card near the stem name:
```javascript
function createStemCard(stemType) {
  // ... existing card creation code ...

  // Add heart button in header
  const heartBtn = document.createElement('button')
  heartBtn.className = 'w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition'
  heartBtn.dataset.action = 'like-stem'
  heartBtn.dataset.stem = stemType
  heartBtn.setAttribute('aria-label', 'Like this stem')
  heartBtn.innerHTML = '<i data-lucide="heart" class="w-4 h-4"></i>'

  // Insert into card header
  // ... position appropriately ...
}
```

#### Step 4.2: Like/Unlike Handler
```javascript
function handleLikeStem(stemType) {
  // Get current stem data
  const stemData = getActiveStemData(stemType)
  if (!stemData) {
    console.warn('No active take to like for stem:', stemType)
    return
  }

  // Check if already liked
  const existingLike = likedTracks.find(
    t => t.stemType === stemType && t.takeIndex === stemData.takeIndex
  )

  if (existingLike) {
    // Unlike
    removeLikedTrack(existingLike.id)
    updateHeartButton(stemType, false)
    showToast('Removed from likes')
  } else {
    // Like
    const trackData = {
      stemType: stemType,
      stemName: stemConfigs[stemType].name,
      stemColor: stemConfigs[stemType].color,
      takeIndex: stemData.takeIndex,
      bpm: stemControlValues.master.tempo,
      key: getRootText(),
      audioBuffer: stemData.audioBuffer
    }

    addLikedTrack(trackData)
    updateHeartButton(stemType, true)
    showToast(`Added ${trackData.stemName} to likes`)
  }

  // Refresh likes list if menu is open
  if (accountMenuOpen && activeAccountTab === 'likes') {
    renderLikesList()
  }
}

function updateHeartButton(stemType, liked) {
  const btn = document.querySelector(`[data-stem="${stemType}"] [data-action="like-stem"]`)
  if (!btn) return

  btn.classList.toggle('text-red-500', liked)
  btn.querySelector('i').classList.toggle('fill-current', liked)
}
```

#### Step 4.3: Render Likes List
```javascript
function renderLikesList() {
  const container = document.getElementById('likesTrackList')
  if (!container) return

  const filtered = getFilteredLikes()

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-white/40 text-sm">
        <i data-lucide="heart" class="w-8 h-8 mx-auto mb-2 opacity-20"></i>
        <p>No liked tracks yet.</p>
        <p class="text-xs mt-1">Press ♥ on any stem to add it here.</p>
      </div>
    `
    lucide.createIcons()
    return
  }

  container.innerHTML = filtered.map(track => `
    <div class="p-3 bg-white/5 rounded-lg border border-white/10 hover:bg-white/8 transition" data-track-id="${track.id}">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-${track.stemColor}-500"></div>
          <span class="text-sm font-medium">${track.stemName}</span>
        </div>
        <button class="w-6 h-6 text-red-500 hover:bg-white/10 rounded" data-action="unlike" data-track-id="${track.id}">
          <i data-lucide="heart" class="w-4 h-4 fill-current"></i>
        </button>
      </div>
      <div class="flex items-center justify-between text-xs text-white/60">
        <span>${track.bpm} BPM • ${track.key}</span>
        <span>${formatTimestamp(track.timestamp)}</span>
      </div>
      <div class="flex items-center gap-2 mt-2">
        <button class="flex-1 px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 rounded text-xs" data-action="preview" data-track-id="${track.id}">
          <i data-lucide="play" class="w-3 h-3 inline mr-1"></i>Preview
        </button>
      </div>
    </div>
  `).join('')

  lucide.createIcons()

  // Add event listeners
  container.querySelectorAll('[data-action="unlike"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const trackId = btn.dataset.trackId
      removeLikedTrack(trackId)
      renderLikesList()
      showToast('Removed from likes')
    })
  })

  container.querySelectorAll('[data-action="preview"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const trackId = btn.dataset.trackId
      previewLikedTrack(trackId)
    })
  })
}
```

#### Step 4.4: Likes Filtering
```javascript
function setupLikesFilters() {
  const bpmMinSlider = document.getElementById('likesBpmMin')
  const bpmMaxSlider = document.getElementById('likesBpmMax')
  const bpmMinVal = document.getElementById('likesBpmMinVal')
  const bpmMaxVal = document.getElementById('likesBpmMaxVal')
  const keyFilter = document.getElementById('likesKeyFilter')
  const clearBtn = document.getElementById('likesClearFilters')

  // Populate key filter options
  const keys = generateKeyOptions() // All 24 key combinations
  keyFilter.innerHTML = '<option value="">All Keys</option>' +
    keys.map(k => `<option value="${k}">${k}</option>`).join('')

  // BPM sliders
  bpmMinSlider.addEventListener('input', (e) => {
    let val = parseInt(e.target.value)
    const maxVal = parseInt(bpmMaxSlider.value)
    if (val > maxVal) val = maxVal
    bpmMinSlider.value = val
    bpmMinVal.textContent = val
    setLikesFilter({ bpmMin: val })
    renderLikesList()
  })

  bpmMaxSlider.addEventListener('input', (e) => {
    let val = parseInt(e.target.value)
    const minVal = parseInt(bpmMinSlider.value)
    if (val < minVal) val = minVal
    bpmMaxSlider.value = val
    bpmMaxVal.textContent = val
    setLikesFilter({ bpmMax: val })
    renderLikesList()
  })

  // Key filter
  keyFilter.addEventListener('change', (e) => {
    setLikesFilter({ key: e.target.value })
    renderLikesList()
  })

  // Clear filters
  clearBtn.addEventListener('click', () => {
    clearLikesFilters()
    bpmMinSlider.value = 110
    bpmMaxSlider.value = 140
    bpmMinVal.textContent = '110'
    bpmMaxVal.textContent = '140'
    keyFilter.value = ''
    renderLikesList()
  })
}

function generateKeyOptions() {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const modes = ['Major', 'Minor']
  const keys = []

  notes.forEach(note => {
    modes.forEach(mode => {
      keys.push(`${note} ${mode}`)
    })
  })

  return keys
}
```

### Phase 5: Sets Implementation (60 minutes)

#### Step 5.1: Render Sets List
```javascript
function renderSetsList() {
  const container = document.getElementById('setsTrackList')
  if (!container) return

  const filtered = getFilteredSets(setsFilterState)

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-white/40 text-sm">
        <i data-lucide="layers" class="w-8 h-8 mx-auto mb-2 opacity-20"></i>
        <p>No saved sets yet.</p>
        <p class="text-xs mt-1">Save your session from the player bar.</p>
      </div>
    `
    lucide.createIcons()
    return
  }

  container.innerHTML = filtered.map((set, index) => {
    const stats = getSetStats(set)
    return `
      <div class="p-3 bg-white/5 rounded-lg border border-white/10 hover:bg-white/8 transition" data-set-index="${index}">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium">${set.name || 'Set ' + (index + 1)}</span>
          <button class="w-6 h-6 text-red-400 hover:bg-white/10 rounded" data-action="delete-set" data-set-index="${index}">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
        <div class="text-xs text-white/60 space-y-1 mb-2">
          <div>${set.tempo} BPM • ${set.root} • ${set.bars} bars</div>
          <div>${stats.activeStemCount} stems • ${stats.totalTakes} takes</div>
          <div>${formatTimestamp(set.timestamp)}</div>
        </div>
        <button class="w-full px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 rounded text-xs" data-action="load-set" data-set-index="${index}">
          <i data-lucide="play-circle" class="w-3 h-3 inline mr-1"></i>Load Set
        </button>
      </div>
    `
  }).join('')

  lucide.createIcons()

  // Add event listeners
  container.querySelectorAll('[data-action="load-set"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const index = parseInt(btn.dataset.setIndex)
      closeAccountMenu()
      loadSetAtIndex(index) // Reuse existing logic
    })
  })

  container.querySelectorAll('[data-action="delete-set"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const index = parseInt(btn.dataset.setIndex)
      if (confirm('Delete this set?')) {
        savedSets.splice(index, 1)
        renderSetsList()
        showToast('Set deleted')
      }
    })
  })
}
```

#### Step 5.2: Sets Filtering
Similar to likes filtering, but include bars filter:
```javascript
let setsFilterState = {
  bpmMin: 110,
  bpmMax: 140,
  key: '',
  bars: '' // '' | 2 | 4
}

function setupSetsFilters() {
  // Similar to likes filters but add bars dropdown
  const barsFilter = document.getElementById('setsBarsFilter')

  barsFilter.addEventListener('change', (e) => {
    const val = e.target.value === '' ? '' : parseInt(e.target.value)
    setsFilterState.bars = val
    renderSetsList()
  })

  // ... rest similar to likes filters
}
```

### Phase 6: Audio Preview (30 minutes)

#### Step 6.1: Preview Player
```javascript
let previewAudioContext = null
let previewSource = null

function previewLikedTrack(trackId) {
  const track = likedTracks.find(t => t.id === trackId)
  if (!track || !track.audioBuffer) {
    console.warn('Track not found or no audio buffer:', trackId)
    return
  }

  // Stop any existing preview
  stopPreview()

  // Create audio context if needed
  if (!previewAudioContext) {
    previewAudioContext = new (window.AudioContext || window.webkitAudioContext)()
  }

  // Create and start source
  previewSource = previewAudioContext.createBufferSource()
  previewSource.buffer = track.audioBuffer
  previewSource.connect(previewAudioContext.destination)
  previewSource.loop = true
  previewSource.start(0)

  // Update button state
  const btn = document.querySelector(`[data-track-id="${trackId}"] [data-action="preview"]`)
  if (btn) {
    btn.innerHTML = '<i data-lucide="stop-circle" class="w-3 h-3 inline mr-1"></i>Stop'
    btn.dataset.action = 'stop-preview'
    lucide.createIcons()
  }

  // Auto-stop on track end (if not looping)
  previewSource.onended = () => {
    stopPreview()
  }
}

function stopPreview() {
  if (previewSource) {
    try {
      previewSource.stop()
    } catch (e) {
      // Already stopped
    }
    previewSource = null
  }

  // Reset all preview buttons
  document.querySelectorAll('[data-action="stop-preview"]').forEach(btn => {
    btn.innerHTML = '<i data-lucide="play" class="w-3 h-3 inline mr-1"></i>Preview'
    btn.dataset.action = 'preview'
  })
  lucide.createIcons()
}
```

### Phase 7: Integration & Polish (45 minutes)

#### Step 7.1: Initialize Menu System
```javascript
function initializeAccountMenu() {
  const accountBtn = document.getElementById('accountMenuBtn')
  const likesTabBtn = document.getElementById('likesTab')
  const setsTabBtn = document.getElementById('setsTab')

  if (!accountBtn) {
    console.warn('Account button not found in header')
    return
  }

  // Main toggle
  accountBtn.addEventListener('click', toggleAccountMenu)

  // Tab switching
  likesTabBtn?.addEventListener('click', () => switchAccountTab('likes'))
  setsTabBtn?.addEventListener('click', () => switchAccountTab('sets'))

  // Setup filters
  setupLikesFilters()
  setupSetsFilters()

  console.log('Account menu initialized')
}
```

#### Step 7.2: Update App Initialization
```javascript
// In existing initialization code, add:
window.addEventListener('DOMContentLoaded', () => {
  // ... existing init code ...

  initializeAccountMenu()

  // ... rest of init ...
})
```

#### Step 7.3: Utility Functions
```javascript
function formatTimestamp(timestamp) {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getActiveStemData(stemType) {
  // Get currently active take for stem
  const takes = stemTakes[stemType]
  const takeIndex = stemTakeIndex[stemType]

  if (!takes || !takes[takeIndex]) return null

  return {
    takeIndex: takeIndex,
    audioBuffer: takes[takeIndex].aligned,
    // ... other relevant data
  }
}

function getRootText() {
  // Get current key as string (e.g., "A Minor")
  const root = stemControlValues.master.rootBase
  const mode = stemControlValues.master.mode
  return `${root} ${mode}`
}
```

## Testing Checklist

### Functional Tests
- [ ] Account icon appears in both selection and studio headers
- [ ] Clicking account icon opens dropdown menu
- [ ] Clicking outside menu closes it
- [ ] Pressing Escape closes menu
- [ ] Tab switching between Likes and Sets works
- [ ] Heart button appears on all stem cards
- [ ] Clicking heart adds/removes track from likes
- [ ] Heart button visual state updates correctly
- [ ] Likes list displays correctly
- [ ] Likes filters work (BPM min/max, Key)
- [ ] Clear filters button resets all filters
- [ ] Preview button plays liked track
- [ ] Unlike button removes track from list
- [ ] Sets list displays correctly
- [ ] Sets filters work (BPM, Key, Bars)
- [ ] Load button restores saved set
- [ ] Delete button removes set
- [ ] Empty states show appropriate messages
- [ ] Timestamps display correctly

### Edge Cases
- [ ] Menu works when no likes exist
- [ ] Menu works when no sets exist
- [ ] Filtering with no matches shows empty state
- [ ] Liking same stem multiple times (different takes)
- [ ] Loading set while preview is playing
- [ ] Closing menu while preview is playing
- [ ] Menu positioning on mobile devices
- [ ] Menu scrolling with many items (50+)
- [ ] BPM sliders don't cross each other

### Performance
- [ ] Filter operations are instant
- [ ] Menu opens/closes smoothly
- [ ] No lag with 50+ items in list
- [ ] Preview starts within 200ms
- [ ] No memory leaks from audio previews

### Accessibility
- [ ] Keyboard navigation works throughout
- [ ] Screen reader announces menu state
- [ ] Focus management when opening/closing
- [ ] All buttons have proper ARIA labels
- [ ] Contrast ratios meet WCAG standards

## Future Enhancements (Not in Scope)

1. **Persistence**: Save likes and sets to localStorage or Supabase
2. **Naming**: Allow users to name liked tracks and sets
3. **Tagging**: Add custom tags to organize tracks
4. **Export**: Export likes list as playlist
5. **Sharing**: Share sets with other users
6. **Waveform Preview**: Show mini waveforms in list
7. **Batch Operations**: Select multiple items to delete/export
8. **Search**: Text search within likes and sets
9. **Sorting**: Custom sort options (BPM, date, name)
10. **Statistics**: Show overall stats (total duration, most liked stem type, etc.)

## Technical Considerations

### Browser Compatibility
- Modern browsers only (Chrome 90+, Firefox 88+, Safari 14+)
- Web Audio API required
- CSS Grid and Flexbox
- ES6+ JavaScript features

### Performance Targets
- Time to Interactive (TTI): < 3 seconds
- First Contentful Paint (FCP): < 1.5 seconds
- Filter response: < 16ms (60fps)
- Menu animation: 200ms total

### Code Style
- Follow existing app.js patterns
- Use existing utility functions where possible
- Match existing modal/dropdown styling
- Maintain TailwindCSS class conventions
- Keep functions under 50 lines
- Add descriptive comments for complex logic

## Questions & Decisions

1. **Heart Button Placement**: Where exactly on stem card? (Header vs bottom)
   - **Recommendation**: Top-right of card header, next to stem number

2. **Multiple Likes of Same Stem**: Allow liking multiple takes of same stem?
   - **Recommendation**: Yes, each take can be liked independently

3. **Preview Behavior**: Stop on menu close or keep playing?
   - **Recommendation**: Stop preview when menu closes

4. **Filter Persistence**: Remember filter state between menu opens?
   - **Recommendation**: Yes, maintain state during session

5. **Loading Indicator**: Show loading when switching tabs with many items?
   - **Recommendation**: Only if rendering takes > 100ms

6. **Mobile Menu Width**: Full width on mobile or maintain max width?
   - **Recommendation**: Near full-width (calc(100vw - 2rem)) on mobile

## Success Metrics

### MVP Success Criteria
1. Users can heart stems and see them in likes list
2. Users can filter likes by BPM and key
3. Users can preview liked tracks
4. Users can view and filter saved sets
5. Users can load sets from menu
6. All interactions feel smooth and responsive
7. No console errors or warnings

### User Experience Goals
- Menu feels like natural part of app
- Actions are obvious and discoverable
- Filtering is fast and predictable
- Visual feedback for all interactions
- Empty states are helpful and clear

---

## Summary

This guide provides a complete blueprint for implementing a session-based Likes & Sets menu system for TunePal Beta. The implementation follows existing code patterns, maintains visual consistency, and focuses on creating a smooth user experience for browsing and managing generated content within a session.

The feature is designed as a **demo/prototype** with session-only storage, making it perfect for user testing without requiring database changes or authentication logic. Future iterations can add persistence once the UX is validated.
