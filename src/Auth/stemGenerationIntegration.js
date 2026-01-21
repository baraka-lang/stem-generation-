/**
 * Stem Generation Integration
 * Integrates stem persistence with the existing generation process
 */

import { persistStem } from './stemPersistenceService.js'

/**
 * Enhanced stem generation function that includes persistence
 * This function should be called after the existing generateStem function
 * @param {string} st - Stem type
 * @param {Object} generationData - Data from the generation process
 * @param {string} generationData.prompt - Generation prompt
 * @param {number} generationData.tempo - Tempo in BPM
 * @param {number} generationData.bars - Number of bars
 * @param {string} generationData.keySignature - Key signature
 * @param {number} generationData.tier - Generation tier
 * @param {boolean} generationData.validated - Whether validation passed
 * @param {ArrayBuffer} generationData.audioData - Audio data
 * @param {number} generationData.durationSeconds - Duration in seconds
 * @returns {Promise<{success: boolean, stemId?: string, error?: string}>}
 */
export async function persistGeneratedStem(st, generationData) {
  try {
    // Get the master settings for key signature
    const master = getMasterForPrompt()
    const keySignature = `${master.root} ${master.mode}`
    
    // Fetch session setting ID from localStorage
    let sessionSettingId = null
    try {
      const stored = localStorage.getItem('currentSessionSetting')
      if (stored) {
        const parsed = JSON.parse(stored)
        // Handle both possible field names (session_setting_id is standard, but check fallback)
        sessionSettingId = parsed.session_setting_id || parsed.id || null
      }
    } catch (e) {
      console.warn('Failed to parse currentSessionSetting for stem persistence', e)
    }

    // Prepare stem data for persistence
    const stemData = {
      stemType: st,
      prompt: generationData.prompt,
      tempo: generationData.tempo,
      bars: generationData.bars,
      keySignature: keySignature,
      generationTier: generationData.tier || 0,
      validated: generationData.validated || false,
      audioData: generationData.audioData,
      durationSeconds: generationData.durationSeconds,
      sessionSettingId: sessionSettingId
    }
    
    // Persist the stem
    const result = await persistStem(stemData)
    
    if (result.success) {
      console.log(`Stem persisted successfully: ${st} (ID: ${result.stemId})`)
    } else {
      console.warn(`Failed to persist stem: ${st}`, result.error)
    }
    
    return result
  } catch (error) {
    console.error(`Error persisting stem ${st}:`, error)
    return { success: false, error: error.message }
  }
}

/**
 * Get master settings for prompt generation
 * This function should be imported from the main app
 * @returns {Object} Master settings
 */
function getMasterForPrompt() {
  // This should be imported from the main app
  // For now, return default values
  return {
    root: 'A',
    mode: 'Minor',
    tempo: 130,
    bars: 4
  }
}

/**
 * Hook into the existing stem generation process
 * This function should be called after pushStemVersion in the generateStem function
 * @param {string} st - Stem type
 * @param {Object} stemVersionData - Data from pushStemVersion
 * @param {Function} onSuccess - Callback when persistence is successful (receives audioKey)
 */
export async function hookIntoStemGeneration(st, stemVersionData, onSuccess) {
  try {
    // Extract data from the stem version entry
    const generationData = {
      prompt: stemVersionData.prompt,
      tempo: stemVersionData.tempo,
      bars: stemVersionData.bars,
      tier: stemVersionData.meta?.tier || 0,
      validated: stemVersionData.meta?.validated || false,
      audioData: stemVersionData.raw, // This is the raw audio buffer
      durationSeconds: stemVersionData.raw?.duration || 0
    }
    
    // Persist the stem asynchronously (don't block the UI)
    persistGeneratedStem(st, generationData).then(result => {
      if (result.success && result.stemId) {
        // Update the history entry with the database ID (used as audioKey)
        stemVersionData.audioKey = result.stemId
        // Also store the ID for future reference
        stemVersionData.dbId = result.stemId
        console.log(`[Persistence] Linked stem ${st} to DB ID: ${result.stemId}`)
        
        if (typeof onSuccess === 'function') {
          onSuccess(result.stemId)
        }
      }
    }).catch(error => {
      console.error(`Background stem persistence failed for ${st}:`, error)
    })
    
  } catch (error) {
    console.error(`Error in stem generation hook for ${st}:`, error)
  }
}

/**
 * Track a download with persistence
 * @param {Object} downloadData - Download data
 * @returns {Promise<{success: boolean, downloadId?: string, error?: string}>}
 */
export async function trackDownloadWithPersistence(downloadData) {
  try {
    const { persistDownload } = await import('./stemPersistenceService.js')
    return await persistDownload(downloadData)
  } catch (error) {
    console.error('Error tracking download:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Get stems with persistence (database or session storage)
 * @param {string} stemType - Optional stem type filter
 * @returns {Promise<{success: boolean, stems?: Array, error?: string}>}
 */
export async function getStemsWithPersistence(stemType = null) {
  try {
    const { getStems } = await import('./stemPersistenceService.js')
    return await getStems(stemType)
  } catch (error) {
    console.error('Error getting stems:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Create a stem set with persistence
 * @param {Object} setData - Set data
 * @returns {Promise<{success: boolean, setId?: string, error?: string}>}
 */
export async function createStemSetWithPersistence(setData) {
  try {
    const { createStemSetFromSession } = await import('./stemPersistenceService.js')
    return await createStemSetFromSession(setData)
  } catch (error) {
    console.error('Error creating stem set:', error)
    return { success: false, error: error.message }
  }
}
