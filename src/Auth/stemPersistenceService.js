/**
 * Stem Persistence Service
 * Integrates stem saving with the existing generation process
 */

import { saveStem, trackDownload } from './stemApi.js'
import { saveSessionData, getSessionData, SESSION_DATA_KEYS } from './sessionDataManager.js'
import { getCurrentUser } from './index.js'

/**
 * Save a generated stem to the database or session storage
 * @param {Object} stemData - Stem data from generation process
 * @param {string} stemData.stemType - Type of stem (kick, snare, etc.)
 * @param {string} stemData.prompt - Generation prompt used
 * @param {number} stemData.tempo - Tempo in BPM
 * @param {number} stemData.bars - Number of bars
 * @param {string} stemData.keySignature - Key signature
 * @param {number} stemData.generationTier - Generation tier (0-2)
 * @param {boolean} stemData.validated - Whether validation passed
 * @param {ArrayBuffer} stemData.audioData - Audio data as ArrayBuffer
 * @param {number} stemData.durationSeconds - Duration in seconds
 * @returns {Promise<{success: boolean, stemId?: string, error?: string}>}
 */
export async function persistStem(stemData) {
  try {
    // Check if user is authenticated
    const user = await getCurrentUser()
    
    if (user) {
      // User is authenticated, save to database
      const fileSize = stemData.audioData.byteLength
      const result = await saveStem({
        ...stemData,
        fileSize
      })
      
      if (result.success) {
        console.log(`Stem saved to database: ${stemData.stemType}`)
        return result
      } else {
        console.warn('Failed to save stem to database, falling back to session storage:', result.error)
      }
    }
    
    // User not authenticated or database save failed, save to session storage
    const sessionStemData = {
      ...stemData,
      id: `session_${stemData.stemType}_${Date.now()}`,
      createdAt: new Date().toISOString(),
      fileSize: stemData.audioData.byteLength
    }
    
    // Save to session storage
    const existingStems = getSessionData(SESSION_DATA_KEYS.STEM_HISTORY) || {}
    if (!existingStems[stemData.stemType]) {
      existingStems[stemData.stemType] = []
    }
    
    existingStems[stemData.stemType].push(sessionStemData)
    saveSessionData(SESSION_DATA_KEYS.STEM_HISTORY, existingStems)
    
    console.log(`Stem saved to session storage: ${stemData.stemType}`)
    return { success: true, stemId: sessionStemData.id }
    
  } catch (error) {
    console.error('Error persisting stem:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Track a download in the database or session storage
 * @param {Object} downloadData - Download data
 * @param {string} downloadData.downloadType - Type of download
 * @param {string} downloadData.stemId - ID of stem
 * @param {string} downloadData.setId - ID of set
 * @param {string} downloadData.fileFormat - File format
 * @param {number} downloadData.fileSize - File size in bytes
 * @param {string} downloadData.downloadUrl - Download URL
 * @returns {Promise<{success: boolean, downloadId?: string, error?: string}>}
 */
export async function persistDownload(downloadData) {
  try {
    // Check if user is authenticated
    const user = await getCurrentUser()
    
    if (user) {
      // User is authenticated, save to database
      const result = await trackDownload(downloadData)
      
      if (result.success) {
        console.log(`Download tracked in database: ${downloadData.downloadType}`)
        return result
      } else {
        console.warn('Failed to track download in database, falling back to session storage:', result.error)
      }
    }
    
    // User not authenticated or database save failed, save to session storage
    const sessionDownloadData = {
      ...downloadData,
      id: `session_download_${Date.now()}`,
      timestamp: new Date().toISOString()
    }
    
    const existingDownloads = getSessionData(SESSION_DATA_KEYS.DOWNLOADS) || []
    existingDownloads.push(sessionDownloadData)
    saveSessionData(SESSION_DATA_KEYS.DOWNLOADS, existingDownloads)
    
    console.log(`Download tracked in session storage: ${downloadData.downloadType}`)
    return { success: true, downloadId: sessionDownloadData.id }
    
  } catch (error) {
    console.error('Error persisting download:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Get stem data from database or session storage
 * @param {string} stemType - Type of stem
 * @returns {Promise<{success: boolean, stems?: Array, error?: string}>}
 */
export async function getStems(stemType = null) {
  try {
    // Check if user is authenticated
    const user = await getCurrentUser()
    
    if (user) {
      // User is authenticated, get from database
      const { getUserStems } = await import('./stemApi.js')
      const result = await getUserStems()
      
      if (result.success) {
        // Filter by stem type if specified
        const stems = stemType 
          ? result.stems.filter(stem => stem.stem_type === stemType)
          : result.stems
        
        return { success: true, stems }
      } else {
        console.warn('Failed to get stems from database, falling back to session storage:', result.error)
      }
    }
    
    // User not authenticated or database fetch failed, get from session storage
    const sessionStems = getSessionData(SESSION_DATA_KEYS.STEM_HISTORY) || {}
    
    if (stemType) {
      const stems = sessionStems[stemType] || []
      return { success: true, stems }
    } else {
      // Return all stems from all types
      const allStems = []
      Object.values(sessionStems).forEach(stemArray => {
        allStems.push(...stemArray)
      })
      return { success: true, stems: allStems }
    }
    
  } catch (error) {
    console.error('Error getting stems:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Convert ArrayBuffer to base64 for storage
 * @param {ArrayBuffer} buffer - ArrayBuffer to convert
 * @returns {string} Base64 string
 */
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  return btoa(String.fromCharCode(...bytes))
}

/**
 * Convert base64 to ArrayBuffer for playback
 * @param {string} base64 - Base64 string
 * @returns {ArrayBuffer} ArrayBuffer
 */
export function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Get audio data from stem (handles both database and session storage)
 * @param {Object} stem - Stem object
 * @returns {ArrayBuffer} Audio data as ArrayBuffer
 */
export function getStemAudioData(stem) {
  if (stem.audioData) {
    // Session storage stem
    return stem.audioData
  } else if (stem.audio_data) {
    // Database stem, convert from base64
    return base64ToArrayBuffer(stem.audio_data)
  } else {
    throw new Error('No audio data found in stem')
  }
}

/**
 * Create a stem set from current session data
 * @param {Object} setData - Set data
 * @param {string} setData.name - Name of the set
 * @param {string} setData.description - Description
 * @param {number} setData.tempo - Tempo
 * @param {number} setData.bars - Bars
 * @param {string} setData.keySignature - Key signature
 * @param {Array} setData.stemIds - Array of stem IDs to include
 * @returns {Promise<{success: boolean, setId?: string, error?: string}>}
 */
export async function createStemSetFromSession(setData) {
  try {
    // Check if user is authenticated
    const user = await getCurrentUser()
    
    if (user) {
      // User is authenticated, create in database
      const { createStemSet, addStemToSet } = await import('./stemApi.js')
      
      const setResult = await createStemSet({
        name: setData.name,
        description: setData.description,
        tempo: setData.tempo,
        bars: setData.bars,
        keySignature: setData.keySignature,
        isPublic: false
      })
      
      if (setResult.success) {
        // Add stems to the set
        for (let i = 0; i < setData.stemIds.length; i++) {
          const stemId = setData.stemIds[i]
          await addStemToSet(setResult.setId, stemId, i, 1.0, false)
        }
        
        return setResult
      } else {
        console.warn('Failed to create stem set in database, falling back to session storage:', setResult.error)
      }
    }
    
    // User not authenticated or database save failed, save to session storage
    const sessionSetData = {
      ...setData,
      id: `session_set_${Date.now()}`,
      createdAt: new Date().toISOString(),
      stemIds: setData.stemIds
    }
    
    const existingSets = getSessionData('stem_sets') || []
    existingSets.push(sessionSetData)
    saveSessionData('stem_sets', existingSets)
    
    console.log(`Stem set saved to session storage: ${setData.name}`)
    return { success: true, setId: sessionSetData.id }
    
  } catch (error) {
    console.error('Error creating stem set:', error)
    return { success: false, error: error.message }
  }
}
