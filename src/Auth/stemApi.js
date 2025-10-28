/**
 * Stem Database API
 * Functions for interacting with the stems, stem_sets, and downloads tables
 */

import { createClient } from '@supabase/supabase-js'

// Check if Supabase is configured
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let supabase = null
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey)
}

/**
 * Save a generated stem to the database
 * @param {Object} stemData - Stem data to save
 * @param {string} stemData.stemType - Type of stem (kick, snare, etc.)
 * @param {string} stemData.prompt - Generation prompt used
 * @param {number} stemData.tempo - Tempo in BPM
 * @param {number} stemData.bars - Number of bars
 * @param {string} stemData.keySignature - Key signature
 * @param {number} stemData.generationTier - Generation tier (0-2)
 * @param {boolean} stemData.validated - Whether validation passed
 * @param {ArrayBuffer|AudioBuffer} stemData.audioData - Audio data as ArrayBuffer or AudioBuffer
 * @param {number} stemData.fileSize - File size in bytes (optional)
 * @param {number} stemData.durationSeconds - Duration in seconds (optional if audioData is AudioBuffer)
 * @returns {Promise<{success: boolean, stemId?: string, error?: string}>}
 */
export async function saveStem(stemData) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    let audioArrayBuffer = stemData.audioData
    let fileSize = stemData.fileSize
    let durationSeconds = stemData.durationSeconds

    // Convert AudioBuffer to ArrayBuffer if needed
    if (audioArrayBuffer instanceof AudioBuffer) {
      const { audioBufferToArrayBuffer, getAudioDuration } = await import('./audioBufferHelper.js')
      audioArrayBuffer = await audioBufferToArrayBuffer(audioArrayBuffer)
      durationSeconds = durationSeconds || getAudioDuration(stemData.audioData)
    }

    // Calculate file size if not provided
    if (!fileSize && audioArrayBuffer.byteLength) {
      fileSize = audioArrayBuffer.byteLength
    }

    // Convert ArrayBuffer to base64 for storage
    const audioBytes = new Uint8Array(audioArrayBuffer)
    
    // For large files, chunk the conversion to avoid call stack overflow
    let audioBase64
    if (audioBytes.length > 65536) {
      // For large files, use chunked approach
      const chunks = []
      for (let i = 0; i < audioBytes.length; i += 65536) {
        const chunk = audioBytes.slice(i, i + 65536)
        chunks.push(String.fromCharCode.apply(null, chunk))
      }
      audioBase64 = btoa(chunks.join(''))
    } else {
      audioBase64 = btoa(String.fromCharCode(...audioBytes))
    }

    const { data, error } = await supabase
      .from('stems')
      .insert({
        stem_type: stemData.stemType,
        prompt: stemData.prompt,
        tempo: stemData.tempo,
        bars: stemData.bars,
        key_signature: stemData.keySignature,
        generation_tier: stemData.generationTier || 0,
        validated: stemData.validated || false,
        audio_data: audioBase64,
        file_size: fileSize,
        duration_seconds: durationSeconds
      })
      .select('id')
      .single()

    if (error) {
      console.error('Error saving stem:', error)
      return { success: false, error: error.message }
    }

    return { success: true, stemId: data.id }
  } catch (error) {
    console.error('Exception saving stem:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Get all stems for the current user
 * @returns {Promise<{success: boolean, stems?: Array, error?: string}>}
 */
export async function getUserStems() {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const { data, error } = await supabase
      .from('stems')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching stems:', error)
      return { success: false, error: error.message }
    }

    return { success: true, stems: data || [] }
  } catch (error) {
    console.error('Exception fetching stems:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Create a new stem set
 * @param {Object} setData - Set data
 * @param {string} setData.name - Name of the set
 * @param {string} setData.description - Optional description
 * @param {number} setData.tempo - Tempo in BPM
 * @param {number} setData.bars - Number of bars
 * @param {string} setData.keySignature - Key signature
 * @param {boolean} setData.isPublic - Whether set is public
 * @returns {Promise<{success: boolean, setId?: string, error?: string}>}
 */
export async function createStemSet(setData) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const { data, error } = await supabase
      .from('stem_sets')
      .insert({
        name: setData.name,
        description: setData.description,
        tempo: setData.tempo,
        bars: setData.bars,
        key_signature: setData.keySignature,
        is_public: setData.isPublic || false
      })
      .select('id')
      .single()

    if (error) {
      console.error('Error creating stem set:', error)
      return { success: false, error: error.message }
    }

    return { success: true, setId: data.id }
  } catch (error) {
    console.error('Exception creating stem set:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Get all stem sets for the current user
 * @returns {Promise<{success: boolean, sets?: Array, error?: string}>}
 */
export async function getUserStemSets() {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const { data, error } = await supabase
      .from('stem_sets')
      .select(`
        *,
        stem_set_items(
          id,
          position,
          volume,
          muted,
          stems(
            id,
            stem_type,
            prompt,
            tempo,
            bars,
            key_signature,
            created_at
          )
        )
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching stem sets:', error)
      return { success: false, error: error.message }
    }

    return { success: true, sets: data || [] }
  } catch (error) {
    console.error('Exception fetching stem sets:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Add a stem to a set
 * @param {string} setId - ID of the set
 * @param {string} stemId - ID of the stem
 * @param {number} position - Position in the set
 * @param {number} volume - Volume level (0-1)
 * @param {boolean} muted - Whether stem is muted
 * @returns {Promise<{success: boolean, itemId?: string, error?: string}>}
 */
export async function addStemToSet(setId, stemId, position = 0, volume = 1.0, muted = false) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const { data, error } = await supabase
      .from('stem_set_items')
      .insert({
        set_id: setId,
        stem_id: stemId,
        position,
        volume,
        muted
      })
      .select('id')
      .single()

    if (error) {
      console.error('Error adding stem to set:', error)
      return { success: false, error: error.message }
    }

    return { success: true, itemId: data.id }
  } catch (error) {
    console.error('Exception adding stem to set:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Remove a stem from a set
 * @param {string} setId - ID of the set
 * @param {string} stemId - ID of the stem
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function removeStemFromSet(setId, stemId) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const { error } = await supabase
      .from('stem_set_items')
      .delete()
      .eq('set_id', setId)
      .eq('stem_id', stemId)

    if (error) {
      console.error('Error removing stem from set:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error('Exception removing stem from set:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Track a download
 * @param {Object} downloadData - Download data
 * @param {string} downloadData.downloadType - Type of download (single_stem, stem_set, all_stems)
 * @param {string} downloadData.stemId - ID of stem (for single stem downloads)
 * @param {string} downloadData.setId - ID of set (for set downloads)
 * @param {string} downloadData.fileFormat - File format (wav, mp3, zip)
 * @param {number} downloadData.fileSize - File size in bytes
 * @param {string} downloadData.downloadUrl - Download URL used
 * @returns {Promise<{success: boolean, downloadId?: string, error?: string}>}
 */
export async function trackDownload(downloadData) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const { data, error } = await supabase
      .from('downloads')
      .insert({
        download_type: downloadData.downloadType,
        stem_id: downloadData.stemId,
        set_id: downloadData.setId,
        file_format: downloadData.fileFormat,
        file_size: downloadData.fileSize,
        download_url: downloadData.downloadUrl
      })
      .select('id')
      .single()

    if (error) {
      console.error('Error tracking download:', error)
      return { success: false, error: error.message }
    }

    return { success: true, downloadId: data.id }
  } catch (error) {
    console.error('Exception tracking download:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Get download history for the current user
 * @returns {Promise<{success: boolean, downloads?: Array, error?: string}>}
 */
export async function getUserDownloads() {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const { data, error } = await supabase
      .from('downloads')
      .select(`
        *,
        stems(stem_type, prompt),
        stem_sets(name)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching downloads:', error)
      return { success: false, error: error.message }
    }

    return { success: true, downloads: data || [] }
  } catch (error) {
    console.error('Exception fetching downloads:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Get a stem by ID with audio data
 * @param {string} stemId - ID of the stem
 * @returns {Promise<{success: boolean, stem?: Object, error?: string}>}
 */
export async function getStemById(stemId) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const { data, error } = await supabase
      .from('stems')
      .select('*')
      .eq('id', stemId)
      .single()

    if (error) {
      console.error('Error fetching stem:', error)
      return { success: false, error: error.message }
    }

    // Convert base64 audio data back to ArrayBuffer
    if (data.audio_data) {
      const binaryString = atob(data.audio_data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      data.audioData = bytes.buffer
    }

    return { success: true, stem: data }
  } catch (error) {
    console.error('Exception fetching stem:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Delete a stem
 * @param {string} stemId - ID of the stem to delete
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteStem(stemId) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const { error } = await supabase
      .from('stems')
      .delete()
      .eq('id', stemId)

    if (error) {
      console.error('Error deleting stem:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error('Exception deleting stem:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Delete a stem set
 * @param {string} setId - ID of the set to delete
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteStemSet(setId) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const { error } = await supabase
      .from('stem_sets')
      .delete()
      .eq('id', setId)

    if (error) {
      console.error('Error deleting stem set:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error('Exception deleting stem set:', error)
    return { success: false, error: error.message }
  }
}
