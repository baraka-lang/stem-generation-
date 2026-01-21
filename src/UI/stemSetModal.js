import { formatBarsForDisplay, normalizeBarsValue } from '../Utilities/barUtils.js'

/**
 * Stem Set Modal
 * UI component for managing stem sets
 */

/**
 * Show the save stem set modal
 * @param {Object} currentSessionData - Current session data
 * @param {Function} onSave - Callback when set is saved
 * @param {Function} onCancel - Callback when modal is cancelled
 */
export function showSaveStemSetModal(currentSessionData, onSave, onCancel) {
  // Create modal HTML if it doesn't exist
  let modal = document.getElementById('saveStemSetModal')
  if (!modal) {
    modal = createStemSetModalHTML()
    document.body.appendChild(modal)
  }
  
  // Populate with current session data
  populateModalWithSessionData(modal, currentSessionData)
  
  // Show modal
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.style.opacity = '1'
  })
  document.body.style.overflow = 'hidden'
  
  // Set up event listeners
  setupStemSetModalListeners(modal, onSave, onCancel)
}

/**
 * Create the stem set modal HTML
 * @returns {HTMLElement} Modal element
 */
function createStemSetModalHTML() {
  const modal = document.createElement('div')
  modal.id = 'saveStemSetModal'
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 hidden opacity-0 transition-all duration-300 ease-out'
  
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" id="stemSetModalOverlay"></div>
    <div class="relative w-full max-w-md player-surface card-border rounded-2xl p-6 transform scale-95 transition-all duration-300 ease-out">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-medium text-white">Save Stem Set</h2>
        <button id="stemSetModalCloseBtn" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
      </div>
      
      <div class="space-y-4">
        <div>
          <label class="block text-sm text-white/80 mb-2">Set Name</label>
          <input 
            type="text" 
            id="stemSetName" 
            class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/50 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
            placeholder="My Techno Set"
            maxlength="50"
          />
        </div>
        
        <div>
          <label class="block text-sm text-white/80 mb-2">Description (Optional)</label>
          <textarea 
            id="stemSetDescription" 
            class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/50 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-purple-500/20 resize-none"
            placeholder="Describe your stem set..."
            rows="3"
            maxlength="200"
          ></textarea>
        </div>
        
        <div class="bg-white/5 rounded-lg p-3">
          <h3 class="text-sm font-medium text-white/90 mb-2">Session Info</h3>
          <div class="text-xs text-white/70 space-y-1">
            <div>Tempo: <span id="sessionTempo">130</span> BPM</div>
            <div>Bars: <span id="sessionBars">4</span></div>
            <div>Key: <span id="sessionKey">A Minor</span></div>
            <div>Stems: <span id="sessionStems">0</span> generated</div>
          </div>
        </div>
        
        <div class="bg-white/5 rounded-lg p-3">
          <h3 class="text-sm font-medium text-white/90 mb-2">Included Stems</h3>
          <div id="includedStems" class="text-xs text-white/70">
            <!-- Dynamically populated -->
          </div>
        </div>
      </div>
      
      <div class="flex gap-3 justify-end mt-6">
        <button 
          id="stemSetCancelBtn" 
          class="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition text-sm"
        >
          Cancel
        </button>
        <button 
          id="stemSetSaveBtn" 
          class="px-4 py-2 bg-purple-500/80 hover:bg-purple-500 border border-purple-500 rounded-lg transition text-sm font-medium"
        >
          Save Set
        </button>
      </div>
    </div>
  `
  
  return modal
}

/**
 * Populate modal with current session data
 * @param {HTMLElement} modal - Modal element
 * @param {Object} sessionData - Current session data
 */
function populateModalWithSessionData(modal, sessionData) {
  // Set session info
  const tempoEl = modal.querySelector('#sessionTempo')
  const barsEl = modal.querySelector('#sessionBars')
  const keyEl = modal.querySelector('#sessionKey')
  const stemsEl = modal.querySelector('#sessionStems')
  
  if (tempoEl) tempoEl.textContent = sessionData.tempo || 130
  if (barsEl) {
    const actualBars = normalizeBarsValue(sessionData.bars || 4)
    barsEl.textContent = formatBarsForDisplay(actualBars)
    barsEl.dataset.actualBars = String(actualBars)
  }
  if (keyEl) keyEl.textContent = sessionData.keySignature || 'A Minor'
  
  // Count generated stems
  const stemCount = Object.keys(sessionData.stems || {}).length
  if (stemsEl) stemsEl.textContent = stemCount
  
  // List included stems
  const includedStemsEl = modal.querySelector('#includedStems')
  if (includedStemsEl) {
    const stemTypes = Object.keys(sessionData.stems || {})
    if (stemTypes.length === 0) {
      includedStemsEl.innerHTML = '<div class="text-white/50">No stems generated yet</div>'
    } else {
      includedStemsEl.innerHTML = stemTypes.map(stemType => 
        `<div class="flex items-center gap-2">
          <div class="w-2 h-2 bg-purple-500 rounded-full"></div>
          <span>${stemType.charAt(0).toUpperCase() + stemType.slice(1)}</span>
        </div>`
      ).join('')
    }
  }
  
  // Set default name
  const nameInput = modal.querySelector('#stemSetName')
  if (nameInput && !nameInput.value) {
    const now = new Date()
    const dateStr = now.toLocaleDateString()
    nameInput.value = `Techno Set ${dateStr}`
  }
}

/**
 * Set up event listeners for the modal
 * @param {HTMLElement} modal - Modal element
 * @param {Function} onSave - Save callback
 * @param {Function} onCancel - Cancel callback
 */
function setupStemSetModalListeners(modal, onSave, onCancel) {
  const overlay = modal.querySelector('#stemSetModalOverlay')
  const closeBtn = modal.querySelector('#stemSetModalCloseBtn')
  const cancelBtn = modal.querySelector('#stemSetCancelBtn')
  const saveBtn = modal.querySelector('#stemSetSaveBtn')
  
  // Close modal handlers
  const closeModal = () => {
    modal.style.opacity = '0'
    setTimeout(() => {
      modal.classList.add('hidden')
      document.body.style.overflow = ''
    }, 300)
  }
  
  if (overlay) overlay.addEventListener('click', closeModal)
  if (closeBtn) closeBtn.addEventListener('click', closeModal)
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    closeModal()
    if (onCancel) onCancel()
  })
  
  // Save handler
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const nameInput = modal.querySelector('#stemSetName')
      const descInput = modal.querySelector('#stemSetDescription')
      
      const setName = nameInput?.value?.trim()
      if (!setName) {
        alert('Please enter a set name')
        return
      }
      
      // Disable save button and show loading
      saveBtn.disabled = true
      saveBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 loading-spin"></i> Saving...'
      
      try {
        if (onSave) {
          await onSave({
            name: setName,
            description: descInput?.value?.trim() || '',
            tempo: parseInt(modal.querySelector('#sessionTempo')?.textContent) || 130,
            bars: parseInt(modal.querySelector('#sessionBars')?.dataset.actualBars || '4', 10) || 4,
            keySignature: modal.querySelector('#sessionKey')?.textContent || 'A Minor'
          })
        }
        
        closeModal()
      } catch (error) {
        console.error('Error saving stem set:', error)
        alert('Failed to save stem set. Please try again.')
        
        // Reset save button
        saveBtn.disabled = false
        saveBtn.innerHTML = 'Save Set'
      }
    })
  }
}

/**
 * Show the load stem set modal
 * @param {Array} stemSets - Available stem sets
 * @param {Function} onLoad - Callback when set is loaded
 * @param {Function} onCancel - Callback when modal is cancelled
 */
export function showLoadStemSetModal(stemSets, onLoad, onCancel) {
  // Create modal HTML if it doesn't exist
  let modal = document.getElementById('loadStemSetModal')
  if (!modal) {
    modal = createLoadStemSetModalHTML()
    document.body.appendChild(modal)
  }
  
  // Populate with available sets
  populateLoadModalWithSets(modal, stemSets)
  
  // Show modal
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.style.opacity = '1'
  })
  document.body.style.overflow = 'hidden'
  
  // Set up event listeners
  setupLoadStemSetModalListeners(modal, onLoad, onCancel)
}

/**
 * Create the load stem set modal HTML
 * @returns {HTMLElement} Modal element
 */
function createLoadStemSetModalHTML() {
  const modal = document.createElement('div')
  modal.id = 'loadStemSetModal'
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 hidden opacity-0 transition-all duration-300 ease-out'
  
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" id="loadStemSetModalOverlay"></div>
    <div class="relative w-full max-w-lg player-surface card-border rounded-2xl p-6 transform scale-95 transition-all duration-300 ease-out">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-medium text-white">Load Stem Set</h2>
        <button id="loadStemSetModalCloseBtn" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
      </div>
      
      <div class="space-y-3 max-h-96 overflow-y-auto">
        <div id="stemSetsList">
          <!-- Dynamically populated -->
        </div>
      </div>
      
      <div class="flex gap-3 justify-end mt-6">
        <button 
          id="loadStemSetCancelBtn" 
          class="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  `
  
  return modal
}

/**
 * Populate load modal with available sets
 * @param {HTMLElement} modal - Modal element
 * @param {Array} stemSets - Available stem sets
 */
function populateLoadModalWithSets(modal, stemSets) {
  const listEl = modal.querySelector('#stemSetsList')
  if (!listEl) return
  
  if (stemSets.length === 0) {
    listEl.innerHTML = '<div class="text-center text-white/50 py-8">No stem sets found</div>'
    return
  }
  
  listEl.innerHTML = stemSets.map((set, index) => `
    <div class="stem-set-item bg-white/5 rounded-lg p-3 cursor-pointer hover:bg-white/10 transition" data-set-index="${index}">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-medium text-white">${set.name}</h3>
          ${set.description ? `<p class="text-xs text-white/70 mt-1">${set.description}</p>` : ''}
        </div>
        <div class="text-xs text-white/50">
          ${new Date(set.created_at).toLocaleDateString()}
        </div>
      </div>
      <div class="text-xs text-white/60 mt-2">
        ${set.tempo} BPM • ${formatBarsForDisplay(set.bars)} bars • ${set.key_signature}
      </div>
    </div>
  `).join('')
}

/**
 * Set up event listeners for the load modal
 * @param {HTMLElement} modal - Modal element
 * @param {Function} onLoad - Load callback
 * @param {Function} onCancel - Cancel callback
 */
function setupLoadStemSetModalListeners(modal, onLoad, onCancel) {
  const overlay = modal.querySelector('#loadStemSetModalOverlay')
  const closeBtn = modal.querySelector('#loadStemSetModalCloseBtn')
  const cancelBtn = modal.querySelector('#loadStemSetCancelBtn')
  const setItems = modal.querySelectorAll('.stem-set-item')
  
  // Close modal handlers
  const closeModal = () => {
    modal.style.opacity = '0'
    setTimeout(() => {
      modal.classList.add('hidden')
      document.body.style.overflow = ''
    }, 300)
  }
  
  if (overlay) overlay.addEventListener('click', closeModal)
  if (closeBtn) closeBtn.addEventListener('click', closeModal)
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    closeModal()
    if (onCancel) onCancel()
  })
  
  // Set item click handlers
  setItems.forEach(item => {
    item.addEventListener('click', () => {
      const setIndex = parseInt(item.dataset.setIndex)
      closeModal()
      if (onLoad) onLoad(setIndex)
    })
  })
}
