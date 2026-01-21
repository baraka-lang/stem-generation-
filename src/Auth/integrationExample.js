/**
 * Integration Example
 * Shows how to integrate the new stem persistence features with the existing app
 */

import { hookIntoStemGeneration } from './stemGenerationIntegration.js'
import { showSaveStemSetModal, showLoadStemSetModal } from '../UI/stemSetModal.js'
import { downloadStemWithTracking, downloadAllStemsWithTracking } from './enhancedDownloadService.js'
import { getStemsWithPersistence, createStemSetWithPersistence } from './stemGenerationIntegration.js'

/**
 * Example: Integrate stem persistence with existing generateStem function
 * Add this to the generateStem function after pushStemVersion
 */
export function integrateStemPersistence() {
  // In the generateStem function, after pushStemVersion, add:
  /*
  // ... existing code ...
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
  
  // NEW: Add stem persistence
  hookIntoStemGeneration(st, {
    id: `${st}_${Date.now()}`,
    createdAt: new Date().toISOString(),
    prompt: usedPrompt,
    tempo, bars,
    sessionTag: SESSION_TAG,
    headIndex: referenceHeadIndex,
    raw: stemRaw[st],
    meta: { tier, validated: !failedValidation }
  })
  // ... rest of existing code ...
  */
}

/**
 * Example: Add save stem set button to the UI
 * This would be added to the player bar or user menu
 */
export function addSaveStemSetButton() {
  // Add this button to your HTML:
  /*
  <button id="saveStemSetBtn" class="px-3 py-2 bg-purple-500/80 hover:bg-purple-500 border border-purple-500 rounded-lg transition text-sm">
    Save Set
  </button>
  */
  
  // Add this event listener:
  /*
  const saveStemSetBtn = document.getElementById('saveStemSetBtn')
  if (saveStemSetBtn) {
    saveStemSetBtn.addEventListener('click', async () => {
      // Get current session data
      const currentSessionData = getCurrentSessionData()
      
      showSaveStemSetModal(currentSessionData, async (setData) => {
        // Save the stem set
        const result = await createStemSetWithPersistence(setData)
        if (result.success) {
          console.log('Stem set saved:', result.setId)
          // Show success message
        } else {
          console.error('Failed to save stem set:', result.error)
          // Show error message
        }
      }, () => {
        console.log('Save cancelled')
      })
    })
  }
  */
}

/**
 * Example: Add load stem set button to the UI
 */
export function addLoadStemSetButton() {
  // Add this button to your HTML:
  /*
  <button id="loadStemSetBtn" class="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition text-sm">
    Load Set
  </button>
  */
  
  // Add this event listener:
  /*
  const loadStemSetBtn = document.getElementById('loadStemSetBtn')
  if (loadStemSetBtn) {
    loadStemSetBtn.addEventListener('click', async () => {
      // Get available stem sets
      const result = await getStemsWithPersistence()
      if (result.success) {
        showLoadStemSetModal(result.sets || [], (setIndex) => {
          // Load the selected stem set
          loadStemSet(setIndex)
        }, () => {
          console.log('Load cancelled')
        })
      } else {
        console.error('Failed to load stem sets:', result.error)
      }
    })
  }
  */
}

/**
 * Example: Enhanced download functionality
 * Replace existing download functions with tracking
 */
export function enhanceDownloadFunctionality() {
  // Replace existing download functions with these:
  
  // For single stem downloads:
  /*
  async function downloadStem(stemType) {
    const stemData = stemRaw[stemType]
    if (!stemData) return
    
    const result = await downloadStemWithTracking({
      stemType,
      audioData: stemData,
      filename: `${stemType}_${Date.now()}.wav`,
      stemId: `session_${stemType}_${Date.now()}` // or get from database
    })
    
    if (!result.success) {
      console.error('Download failed:', result.error)
    }
  }
  */
  
  // For all stems download:
  /*
  async function downloadAllStems() {
    const sessionData = getCurrentSessionData()
    const result = await downloadAllStemsWithTracking(sessionData)
    
    if (!result.success) {
      console.error('Download failed:', result.error)
    }
  }
  */
}

/**
 * Example: Get current session data
 * This function should be implemented to gather current session state
 */
export function getCurrentSessionData() {
  // This is a placeholder - implement based on your app's state management
  return {
    tempo: 130, // Get from your app's state
    bars: 4,   // Get from your app's state
    keySignature: 'A Minor', // Get from your app's state
    stems: {
      // Get from your app's stemRaw or stemHistory
      kick: { audioData: null }, // ArrayBuffer
      snare: { audioData: null },
      // ... other stems
    }
  }
}

/**
 * Example: Load a stem set
 * This function should be implemented to restore a stem set
 */
export async function loadStemSet(setIndex) {
  try {
    // Get the stem set data
    const result = await getStemsWithPersistence()
    if (!result.success) {
      console.error('Failed to get stem sets:', result.error)
      return
    }
    
    const stemSet = result.sets[setIndex]
    if (!stemSet) {
      console.error('Stem set not found')
      return
    }
    
    // Load each stem in the set
    for (const stemItem of stemSet.stem_set_items) {
      const stem = stemItem.stems
      if (stem && stem.audio_data) {
        // Convert base64 back to ArrayBuffer
        const binaryString = atob(stem.audio_data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        
        // Load the stem into your app's state
        // This would depend on your app's architecture
        console.log(`Loading stem: ${stem.stem_type}`)
        // stemRaw[stem.stem_type] = bytes.buffer
        // Update UI, etc.
      }
    }
    
    console.log('Stem set loaded successfully')
  } catch (error) {
    console.error('Error loading stem set:', error)
  }
}

/**
 * Example: Initialize the integration
 * Call this function when your app starts
 */
export function initializeStemPersistenceIntegration() {
  console.log('Initializing stem persistence integration...')
  
  // Add event listeners for new UI elements
  addSaveStemSetButton()
  addLoadStemSetButton()
  
  // Enhance existing download functionality
  enhanceDownloadFunctionality()
  
  console.log('Stem persistence integration initialized')
}

/**
 * Example: Passwordless authentication integration
 * This shows how to integrate with the passwordless auth flow
 */
export function integrateWithPasswordlessAuth() {
  // When user triggers authentication (e.g., clicks download button):
  /*
  async function handleDownloadWithAuth() {
    const user = await getCurrentUser()
    
    if (user) {
      // User is authenticated, proceed with download
      await downloadAllStems()
    } else {
      // User not authenticated, show passwordless auth modal
      showPasswordlessAuthModal('download', async () => {
        // After successful authentication, proceed with download
        await downloadAllStems()
      })
    }
  }
  */
  
  // When user successfully authenticates:
  /*
  async function onAuthenticationSuccess(user) {
    // Merge session data with user account
    const { mergeSessionDataWithAccount } = await import('./sessionDataManager.js')
    const result = await mergeSessionDataWithAccount(user.id)
    
    if (result.success) {
      console.log('Session data merged successfully')
    } else {
      console.error('Failed to merge session data:', result.error)
    }
  }
  */
}
