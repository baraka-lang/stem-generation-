import { trackDownloadWithPersistence } from './stemGenerationIntegration.js'
import { encodeWAV, triggerDownload } from '../DownloadAudio/index.js'
import { addUniqueIdToFilename } from '../Utilities/uniqueFileId.js'

/**
 * Download a single stem with tracking
 * @param {Object} stemData - Stem data
 * @param {string} stemData.stemType - Type of stem
 * @param {ArrayBuffer} stemData.audioData - Audio data
 * @param {string} stemData.filename - Filename for download
 * @param {string} stemData.stemId - Stem ID for tracking
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function downloadStemWithTracking(stemData) {
  try {
    // Create WAV blob from audio data
    const audioBuffer = new AudioBuffer({
      length: stemData.audioData.byteLength / 4, // Assuming 16-bit samples
      sampleRate: 44100,
      numberOfChannels: 1
    })
    
    // Convert ArrayBuffer to Float32Array for the audio buffer
    const dataView = new DataView(stemData.audioData)
    const channelData = audioBuffer.getChannelData(0)
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = dataView.getInt16(i * 2, true) / 32768.0
    }
    
    const wavBlob = encodeWAV(audioBuffer)
    
    // Trigger download
    triggerDownload(wavBlob, stemData.filename)
    
    // Track download
    const downloadResult = await trackDownloadWithPersistence({
      downloadType: 'single_stem',
      stemId: stemData.stemId,
      fileFormat: 'wav',
      fileSize: wavBlob.size,
      downloadUrl: URL.createObjectURL(wavBlob)
    })
    
    if (downloadResult.success) {
      console.log(`Download tracked: ${stemData.stemType}`)
    } else {
      console.warn('Failed to track download:', downloadResult.error)
    }
    
    return { success: true }
  } catch (error) {
    console.error('Error downloading stem:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Download all active stems with tracking
 * @param {Object} sessionData - Current session data
 * @param {Object} sessionData.stems - Active stems
 * @param {number} sessionData.tempo - Session tempo
 * @param {number} sessionData.bars - Session bars
 * @param {string} sessionData.keySignature - Session key signature
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function downloadAllStemsWithTracking(sessionData) {
  try {
    const stems = sessionData.stems || {}
    const stemTypes = Object.keys(stems)
    
    if (stemTypes.length === 0) {
      return { success: false, error: 'No stems to download' }
    }
    
    const zip = new JSZip()
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')

    for (const [stemType, stemData] of Object.entries(stems)) {
      if (stemData.audioData) {
        const baseFilename = `${stemType}.wav`
        const filename = addUniqueIdToFilename(baseFilename)
        
        // Create WAV blob
        const audioBuffer = new AudioBuffer({
          length: stemData.audioData.byteLength / 4,
          sampleRate: 44100,
          numberOfChannels: 1
        })
        
        const dataView = new DataView(stemData.audioData)
        const channelData = audioBuffer.getChannelData(0)
        for (let i = 0; i < channelData.length; i++) {
          channelData[i] = dataView.getInt16(i * 2, true) / 32768.0
        }
        
        const wavBlob = encodeWAV(audioBuffer)
        zip.file(filename, wavBlob)
      }
    }
    
    // Add session info file
    const sessionInfo = {
      tempo: sessionData.tempo,
      bars: sessionData.bars,
      keySignature: sessionData.keySignature,
      generatedAt: new Date().toISOString(),
      stemCount: stemTypes.length
    }
    zip.file('session_info.json', JSON.stringify(sessionInfo, null, 2))
    
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const baseZipFilename = `techno_stems_${timestamp}.zip`
    const zipFilename = addUniqueIdToFilename(baseZipFilename)
    triggerDownload(zipBlob, zipFilename)
    
    // Track download
    const downloadResult = await trackDownloadWithPersistence({
      downloadType: 'all_stems',
      fileFormat: 'zip',
      fileSize: zipBlob.size,
      downloadUrl: URL.createObjectURL(zipBlob)
    })
    
    if (downloadResult.success) {
      console.log('All stems download tracked')
    } else {
      console.warn('Failed to track all stems download:', downloadResult.error)
    }
    
    return { success: true }
  } catch (error) {
    console.error('Error downloading all stems:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Download a stem set with tracking
 * @param {Object} setData - Stem set data
 * @param {string} setData.setId - Set ID
 * @param {string} setData.name - Set name
 * @param {Array} setData.stems - Stems in the set
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function downloadStemSetWithTracking(setData) {
  try {
    if (!setData.stems || setData.stems.length === 0) {
      return { success: false, error: 'No stems in set' }
    }
    
    const zip = new JSZip()
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')

    for (const stem of setData.stems) {
      if (stem.audioData) {
        const baseFilename = `${stem.stem_type}.wav`
        const filename = addUniqueIdToFilename(baseFilename)
        
        // Create WAV blob
        const audioBuffer = new AudioBuffer({
          length: stem.audioData.byteLength / 4,
          sampleRate: 44100,
          numberOfChannels: 1
        })
        
        const dataView = new DataView(stem.audioData)
        const channelData = audioBuffer.getChannelData(0)
        for (let i = 0; i < channelData.length; i++) {
          channelData[i] = dataView.getInt16(i * 2, true) / 32768.0
        }
        
        const wavBlob = encodeWAV(audioBuffer)
        zip.file(filename, wavBlob)
      }
    }
    
    // Add set info file
    const setInfo = {
      name: setData.name,
      description: setData.description,
      tempo: setData.tempo,
      bars: setData.bars,
      keySignature: setData.keySignature,
      downloadedAt: new Date().toISOString(),
      stemCount: setData.stems.length
    }
    zip.file('set_info.json', JSON.stringify(setInfo, null, 2))
    
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const baseZipFilename = `${setData.name.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.zip`
    const zipFilename = addUniqueIdToFilename(baseZipFilename)
    triggerDownload(zipBlob, zipFilename)
    
    // Track download
    const downloadResult = await trackDownloadWithPersistence({
      downloadType: 'stem_set',
      setId: setData.setId,
      fileFormat: 'zip',
      fileSize: zipBlob.size,
      downloadUrl: URL.createObjectURL(zipBlob)
    })
    
    if (downloadResult.success) {
      console.log('Stem set download tracked')
    } else {
      console.warn('Failed to track stem set download:', downloadResult.error)
    }
    
    return { success: true }
  } catch (error) {
    console.error('Error downloading stem set:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Get download history
 * @returns {Promise<{success: boolean, downloads?: Array, error?: string}>}
 */
export async function getDownloadHistory() {
  try {
    const { getStemsWithPersistence } = await import('./stemGenerationIntegration.js')
    return await getStemsWithPersistence()
  } catch (error) {
    console.error('Error getting download history:', error)
    return { success: false, error: error.message }
  }
}
