/**
 * Stem Database API
 * Functions for interacting with the stems, stem_sets, and downloads tables
 */

import { supabase as sharedClient, getCurrentUser } from './index.js'


// Use the shared Supabase client to ensure auth session consistency
let supabase = sharedClient


/**
 * Upload stem audio to Supabase Storage
 * @param {Blob|File} file - Audio file to upload
 * @param {string} userId - User ID
 * @param {string} stemType - Type of stem (for folder organization)
 * @returns {Promise<{success: boolean, publicUrl?: string, path?: string, error?: string}>}
 */
export async function uploadStemAudio(file, userId, stemType) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    if (!userId) {
      const user = await getCurrentUser()
      if (user) {
        userId = user.id
      } else {
        return { success: false, error: 'User not authenticated' }
      }
    }


    const timestamp = Date.now()
    const fileName = `${userId}/${stemType}_${timestamp}.wav`
    const bucketName = import.meta.env.VITE_SUPABASE_AUDIO_BUCKET || 'audio-files'

    const { data, error } = await supabase
      .storage
      .from(bucketName)
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'audio/wav'
      })

    if (error) {
      console.error('Error uploading audio:', error)
      return { success: false, error: error.message }
    }

    const { data: { publicUrl } } = supabase
      .storage
      .from(bucketName)
      .getPublicUrl(fileName)

    return { success: true, publicUrl, path: fileName }
  } catch (error) {
    console.error('Exception uploading audio:', error)
    return { success: false, error: error.message }
  }
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
 * @param {ArrayBuffer|AudioBuffer} stemData.audioData - Audio data as ArrayBuffer or AudioBuffer (optional if audioUrl provided)
 * @param {number} stemData.fileSize - File size in bytes (optional)
 * @param {number} stemData.durationSeconds - Duration in seconds (optional if audioData is AudioBuffer)
 * @param {string} stemData.stemSetId - ID of the stem set (optional)
 * @param {string} stemData.audioUrl - Path/URL to saved audio file (optional)
 * @returns {Promise<{success: boolean, stemId?: string, error?: string}>}
 */
export async function saveStem(stemData) {
  // console.log(stemData)
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    let audioBase64 = null
    let fileSize = stemData.fileSize
    let durationSeconds = stemData.durationSeconds

    // Only process audioData if provided and we don't strictly rely on URL
    // (though we can store both if available)
    if (stemData.audioData) {
      let audioArrayBuffer = stemData.audioData

      // Convert AudioBuffer to ArrayBuffer if needed
      if (audioArrayBuffer instanceof AudioBuffer) {
        const { audioBufferToArrayBuffer, getAudioDuration } = await import('./audioBufferHelper.js')
        // Only convert if we intend to store it as base64 or need size/duration
        // If we have audioUrl, maybe we skip base64 storage to save DB space?
        // For now, let's keep existing behavior but make it optional if audioUrl is present.

        // If we have URL, we might skip full base64 conversion for DB storage unless requested
        // But for compatibility, let's calculate duration at least
        durationSeconds = durationSeconds || getAudioDuration(stemData.audioData)

        // If we are NOT storing to bucket (no audioUrl), we MUST store in DB
        // If we ARE storing to bucket (audioUrl present), we can skip DB storage of blob
        if (!stemData.audioUrl) {
          audioArrayBuffer = await audioBufferToArrayBuffer(audioArrayBuffer)
        }
      }

      // Calculate file size if not provided
      if (!fileSize && audioArrayBuffer.byteLength) {
        fileSize = audioArrayBuffer.byteLength
      }

      // Only convert to base64 if we don't have a URL or if we want to fallback
      // Ideally, if we have a URL, we don't bloat the DB
      if (!stemData.audioUrl && audioArrayBuffer instanceof ArrayBuffer) {
        const audioBytes = new Uint8Array(audioArrayBuffer)
        if (audioBytes.length > 65536) {
          const chunks = []
          for (let i = 0; i < audioBytes.length; i += 65536) {
            const chunk = audioBytes.slice(i, i + 65536)
            chunks.push(String.fromCharCode.apply(null, chunk))
          }
          audioBase64 = btoa(chunks.join(''))
        } else {
          audioBase64 = btoa(String.fromCharCode(...audioBytes))
        }
      }
    }

    // Get current user
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: 'User not authenticated' }
    }


    const insertData = {
      user_id: user.id,
      stem_type: stemData.stemType,
      prompt: stemData.prompt,
      tempo: stemData.tempo,
      bars: stemData.bars,
      key_signature: stemData.keySignature,
      generation_tier: stemData.generationTier || 0,
      validated: stemData.validated || false,
      audio_data: audioBase64, // Can be null if using URL
      audio_url: stemData.audioUrl || null,
      file_size: fileSize,
      duration_seconds: durationSeconds,
      session_setting_id: stemData.sessionSettingId || null
    }

    // Add stem_set_id if provided
    if (stemData.stemSetId) {
      insertData.stem_set_id = stemData.stemSetId
    }

    const { data, error } = await supabase
      .from('stems')
      .insert(insertData)
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
export async function getUserStems(sessionSettingId = null) {
  console.log('getUserStems: Start', { sessionSettingId })
  if (!supabase) {
    console.error('getUserStems: Supabase not configured')
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const user = await getCurrentUser()
    if (!user) {
      console.error('getUserStems: User not authenticated')
      return { success: false, error: 'User not authenticated' }
    }

    console.log('getUserStems: Authenticated user', user.id)

    let query = supabase
      .from('stems')
      .select('id,user_id,stem_type,prompt,tempo,bars,key_signature,generation_tier,validated,audio_data,audio_url,file_size,duration_seconds,created_at,updated_at,session_setting_id,is_deleted')
      .eq('user_id', user.id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })

    if (sessionSettingId) {
      const numericId = Number(sessionSettingId)
      console.log('getUserStems: Filtering by session_setting_id', numericId)
      query = query.eq('session_setting_id', numericId)
    } else {
      console.log('getUserStems: Fetching all stems (no session filter)')
    }

    console.time('getUserStems: query')
    const { data, error } = await query
    console.timeEnd('getUserStems: query')
    console.log('getUserStems: Query result', {
      dataCount: data?.length,
      firstItemSessionId: data?.[0]?.session_setting_id,
      error
    })

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
 * Delete a stem (soft delete)
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
      .update({ is_deleted: true })
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

export async function upsertUserLike(like) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: 'User not authenticated' }
    }

    const payload = {
      user_id: user.id,
      stem_id: like.stemId,
      take_index: like.takeIndex ?? -1,
      stem_name: like.stemName || like.stemId,
      stem_color: like.stemColor || 'purple',
      bpm: like.bpm || null,
      key_signature: like.key || null,
      bars: like.bars || null,
      rating: like.rating ?? 3,
      audio_key: like.audioKey || null,
      unsaved_stem_id: like.unsavedId || null
    }
    const { data, error } = await supabase
      .from('user_likes')
      .upsert(payload, { onConflict: 'user_id,audio_key' })
      .select('id,updated_at')
      .single()
    if (error) {
      // Fallback 1: Try legacy constraint if primary fails
      if (error.code === '42703' || error.message.includes('column') || error.message.includes('unique')) {
        const { data: retryData, error: retryError } = await supabase
          .from('user_likes')
          .upsert(payload, { onConflict: 'user_id,stem_id,take_index' })
          .select('id,updated_at')
          .single()
        
        if (!retryError) {
          return { success: true, id: retryData.id, updated_at: retryData.updated_at }
        }

        // Fallback 2: Manual Upsert (if constraints are missing entirely, e.g. 42P10)
        // This handles cases where migration state is inconsistent
        if (retryError.code === '42P10' || retryError.message.includes('constraint')) {
           console.warn('Upsert failed due to missing constraints. Attempting manual check-and-update.')
           
           // Try to find existing record
           let match = null
           if (payload.audio_key) {
              const { data: existing } = await supabase
                .from('user_likes')
                .select('id')
                .eq('user_id', user.id)
                .eq('audio_key', payload.audio_key)
                .maybeSingle()
              match = existing
           }
           
           if (!match) {
              const { data: existing } = await supabase
                .from('user_likes')
                .select('id')
                .eq('user_id', user.id)
                .eq('stem_id', payload.stem_id)
                .eq('take_index', payload.take_index)
                .maybeSingle()
              match = existing
           }

           if (match) {
              // Update existing
              const { data: updated, error: updateError } = await supabase
                .from('user_likes')
                .update(payload)
                .eq('id', match.id)
                .select('id,updated_at')
                .single()
              
              if (updateError) return { success: false, error: updateError.message }
              return { success: true, id: updated.id, updated_at: updated.updated_at }
           } else {
              // Insert new
              const { data: inserted, error: insertError } = await supabase
                .from('user_likes')
                .insert(payload)
                .select('id,updated_at')
                .single()
              
              if (insertError) return { success: false, error: insertError.message }
              return { success: true, id: inserted.id, updated_at: inserted.updated_at }
           }
        }
        
        return { success: false, error: retryError.message }
      }
      return { success: false, error: error.message }
    }
    return { success: true, id: data.id, updated_at: data.updated_at }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function getUserLikes() {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: 'User not authenticated' }
    }

    const { data, error } = await supabase
      .from('user_likes')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true, likes: data || [] }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function removeUserLike(stemId, takeIndex, audioKey = null) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: 'User not authenticated' }
    }

    const matchCriteria = { user_id: user.id }
    if (audioKey) {
      matchCriteria.audio_key = audioKey
    } else {
      matchCriteria.stem_id = stemId
      matchCriteria.take_index = takeIndex ?? -1
    }

    const { error } = await supabase
      .from('user_likes')
      .delete()
      .match(matchCriteria)
    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Save or update session settings
 * @param {Object} sessionData - Session settings data
 * @param {string} sessionData.genre - Genre (e.g., 'techno')
 * @param {string} sessionData.sessionName - Name of the session
 * @param {string} sessionData.temp - Tempo as string
 * @param {string} sessionData.bars - Bars as string
 * @param {string} sessionData.rootBase - Root base note (A-G)
 * @param {string} sessionData.selectedAccidental - Accidental (natural, sharp, flat)
 * @param {string} sessionData.mode - Mode (Major, Minor, etc.)
 * @returns {Promise<{success: boolean, sessionSettingId?: number, error?: string}>}
 */
export async function saveSessionSetting(sessionData) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    let userId = sessionData?.user_id || null
    if (!userId) {
      try {
        const user = await getCurrentUser()
        userId = user?.id || null
      } catch { }

    }
    if (!userId) {
      try {
        const { getAuthGuard } = await import('./authGuard.js')
        const guardUser = getAuthGuard()?.getCurrentUser()
        userId = guardUser?.id || null
      } catch { }
    }
    if (!userId) {
      return { success: false, error: 'User not authenticated' }
    }

    // Create new session setting
    const { data, error } = await supabase
      .from('session_settings')
      .insert({
        user_id: userId,
        session_name: sessionData.session_name ?? sessionData.sessionName ?? `Session ${new Date().toLocaleDateString()}`,
        tempo: Number(sessionData.tempo ?? sessionData.temp),
        bars: Number(sessionData.bars),
        root_base: sessionData.root_base ?? sessionData.rootBase,
        selected_accidental: sessionData.selected_accidental ?? sessionData.selectedAccidental,
        mode: sessionData.mode
      })
      .select('session_setting_id')
      .single()

    if (error) {
      console.error('Error saving session setting:', error)
      return { success: false, error: error.message }
    }

    return { success: true, sessionSettingId: data.session_setting_id }
  } catch (error) {
    console.error('Exception saving session setting:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Create a new stem set
 * @param {Object} setData - Set data
 * @param {string} setData.name - Name of the set
 * @param {number} setData.sessionSettingId - ID of the session setting
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
        session_setting_id: setData.sessionSettingId
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
    // Get stem sets with their stems (linked via stems.stem_set_id)
    const { data, error } = await supabase
      .from('stem_sets')
      .select(`
        *,
        stems(
          id,
          stem_type,
          prompt,
          tempo,
          bars,
          key_signature,
          created_at
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

/**
 * Get a session setting by ID
 * @param {number} sessionSettingId - ID of the session setting
 * @returns {Promise<{success: boolean, sessionSetting?: Object, stem_set_id?: string, error?: string}>}
 */
export async function getSessionSettingById(sessionSettingId) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const { data, error } = await supabase
      .from('session_settings')
      .select('*')
      .eq('session_setting_id', sessionSettingId)
      .single()

    if (error) {
      console.error('Error fetching session setting:', error)
      return { success: false, error: error.message }
    }

    // Also get the associated stem_set if it exists
    const { data: stemSetData, error: stemSetError } = await supabase
      .from('stem_sets')
      .select('id')
      .eq('session_setting_id', sessionSettingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const result = { success: true, sessionSetting: data }
    if (stemSetData && !stemSetError) {
      result.stem_set_id = stemSetData.id
    }

    return result
  } catch (error) {
    console.error('Exception fetching session setting:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Get a stem set by session setting ID
 * @param {number} sessionSettingId - ID of the session setting
 * @returns {Promise<{success: boolean, set_id?: string, set?: Object, error?: string}>}
 */
export async function getSetById(sessionSettingId) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const { data, error } = await supabase
      .from('stem_sets')
      .select('*')
      .eq('session_setting_id', sessionSettingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('Error fetching stem set:', error)
      return { success: false, error: error.message }
    }

    if (!data) {
      return { success: false, error: 'No set found for this session setting' }
    }

    return { success: true, set_id: data.id, set: data }
  } catch (error) {
    console.error('Exception fetching stem set:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Update an existing stem set
 * @param {string} setId - ID of the set to update
 * @param {Object} setData - Updated set data
 * @param {string} setData.name - Name of the set
 * @param {string} setData.description - Description of the set
 * @param {Array} setData.stems_states - Array of stem states
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateSet(setId, setData) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    const updatePayload = {
      updated_at: new Date().toISOString()
    }

    if (setData.name !== undefined) {
      updatePayload.name = setData.name
    }

    if (setData.description !== undefined) {
      updatePayload.state_description = setData.description
    }

    if (setData.stems_states !== undefined) {
      // stems_states is now JSONB, so we can store the object directly
      updatePayload.stems_states = setData.stems_states
    }

    const { error } = await supabase
      .from('stem_sets')
      .update(updatePayload)
      .eq('id', setId)

    if (error) {
      console.error('Error updating stem set:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error('Exception updating stem set:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Save a new stem set to the database
 * @param {Object} setData - Set data
 * @param {string} setData.name - Name of the set
 * @param {string} setData.description - Description of the set
 * @param {Array} setData.stems_states - Array of stem states
 * @param {number} sessionSettingId - ID of the session setting
 * @returns {Promise<{success: boolean, set_id?: string, error?: string}>}
 */
export async function saveSetToDb(setData, sessionSettingId) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    // stems_states is now JSONB, so we can store the object directly
    // Supabase will automatically serialize JavaScript objects to JSONB
    const { data, error } = await supabase
      .from('stem_states')
      .insert({
        state_name: setData.name || 'Untitled Set',
        session_settings_id: Number(sessionSettingId),
        stems_snapshot: setData.stems_states || null
      })
      .select('stem_state_id')
      .single()

    if (error) {
      console.error('Error saving stem set:', error)
      return { success: false, error: error.message }
    }

    return { success: true, set_id: data.stem_state_id }
  } catch (error) {
    console.error('Exception saving stem set:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Save session setting to database (alias for saveSessionSetting with different return format)
 * @param {Object} sessionData - Session settings data
 * @param {string} sessionData.genre - Genre (e.g., 'techno')
 * @param {string} sessionData.sessionName - Name of the session
 * @param {string} sessionData.temp - Tempo as string
 * @param {string} sessionData.bars - Bars as string
 * @param {string} sessionData.rootBase - Root base note (A-G)
 * @param {string} sessionData.selectedAccidental - Accidental (natural, sharp, flat)
 * @param {string} sessionData.mode - Mode (Major, Minor, etc.)
 * @returns {Promise<{success: boolean, session_setting_id?: number, stem_set_id?: string, error?: string}>}
 */
export async function saveSessionSettingToDb(sessionData) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    let userId = sessionData?.user_id || null
    if (!userId) {
      try {
        const user = await getCurrentUser()
        userId = user?.id || null
      } catch { }

    }
    if (!userId) {
      try {
        const { getAuthGuard } = await import('./authGuard.js')
        userId = getAuthGuard()?.getCurrentUser()?.id || null
      } catch { }
    }
    if (!userId) {
      return { success: false, error: 'User not authenticated' }
    }

    // Create new session setting
    const { data, error } = await supabase
      .from('session_settings')
      .insert({
        user_id: userId,
        session_name: sessionData.session_name ?? sessionData.sessionName ?? `Session ${new Date().toLocaleDateString()}`,
        tempo: Number(sessionData.tempo ?? sessionData.temp),
        bars: Number(sessionData.bars),
        root_base: sessionData.root_base ?? sessionData.rootBase ?? '',
        selected_accidental: sessionData.selected_accidental ?? sessionData.selectedAccidental ?? 'natural',
        mode: sessionData.mode ?? 'Major'
      })
      .select('session_setting_id')
      .single()

    if (error) {
      console.error('Error saving session setting:', error)
      return { success: false, error: error.message }
    }

    return { success: true, session_setting_id: Number(data.session_setting_id) }
  } catch (error) {
    console.error('Exception saving session setting:', error)
    return { success: false, error: error.message }
  }
}

// Fetch stem sets (states) and loads them to UI
export async function getSetsById(sessionSettingId) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }
  try {
    const { data, error } = await supabase
      .from('stem_states')
      .select('stem_state_id, state_name, stems_snapshot')
      .eq('session_settings_id', sessionSettingId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching stem states by session_settings_id:', error)
      return { success: false, error: error.message }
    }

    // Map to the format expected by the UI ({id, name, ...stems_snapshot})
    const mappedSets = (data || []).map(item => {
      const snapshot = item.stems_snapshot || {}
      return {
        ...snapshot,
        id: item.stem_state_id,
        name: item.state_name || `Set ${item.stem_state_id}`
      }
    })

    return { success: true, sets: mappedSets }
  } catch (err) {
    console.error('Exception fetching stem states by session_settings_id:', err)
    return { success: false, error: err.message }
  }
}



export async function saveSessionSettingsToCloud(sessionValues) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }

  try {
    // Save session setting to database
    const sessionResult = await saveSessionSettingToDb(sessionValues)
    if (!sessionResult.success) {
      return { success: false, error: sessionResult.error }
    }
    return { success: true, session_setting_id: sessionResult.session_setting_id }
  } catch (error) {
    console.error('Exception saving session settings to cloud:', error)
    return { success: false, error: error.message }
  }
}

export async function saveStemStateToDb(sessionSettingId, stemState) {

  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }
  try {
    const name = stemState?.state_name || null
    const snapshot = stemState?.stems_snapshot || null
    if (!sessionSettingId || !snapshot) {
      return { success: false, error: 'Missing sessionSettingId or snapshot' }
    }
    const { data, error } = await supabase
      .from('stem_states')
      .insert({
        session_settings_id: Number(sessionSettingId),
        state_name: name,
        stems_snapshot: snapshot
      })
      .select('stem_state_id')
      .single()
    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true, stem_state_id: Number(data.stem_state_id) }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Get stem states for a session setting
 * @param {number} sessionSettingId - ID of the session setting
 * @returns {Promise<{success: boolean, states?: Array, error?: string}>}
 */
export async function getStemStates(sessionSettingId) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }
  try {
    const { data, error } = await supabase
      .from('stem_states')
      .select('*')
      .eq('session_settings_id', sessionSettingId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching stem states:', error)
      return { success: false, error: error.message }
    }

    return { success: true, states: data || [] }
  } catch (err) {
    console.error('Exception fetching stem states:', err)
    return { success: false, error: err.message }
  }
}

export async function getAllStemStates(sessionSettingId = null) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: 'User not authenticated' }
    }

    let ids = []
    if (sessionSettingId) {
      ids = [Number(sessionSettingId)]
    } else {
      const { data: sessions, error: sErr } = await supabase
        .from('session_settings')
        .select('session_setting_id')
        .eq('user_id', user.id)
      if (sErr) {
        return { success: false, error: sErr.message }
      }
      ids = Array.isArray(sessions) ? sessions.map(s => s.session_setting_id).filter(Boolean) : []
    }

    if (!ids.length) {
      return { success: true, states: [] }
    }
    const { data, error } = await supabase
      .from('stem_states')
      .select('*')
      .in('session_settings_id', ids)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true, states: data || [] }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Delete a stem state (soft delete)
 * @param {number} stemStateId - ID of the stem state
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteStemState(stemStateId) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }
  try {
    const { error } = await supabase
      .from('stem_states')
      .update({ is_deleted: true })
      .eq('stem_state_id', stemStateId)

    if (error) {
      console.error('Error deleting stem state:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    console.error('Exception deleting stem state:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Update a stem state in the database
 * @param {number} stemStateId - ID of the stem state to update
 * @param {Object} updateData - Data to update (state_name, stems_snapshot)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateStemState(stemStateId, updateData) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' }
  }
  try {
    const { error } = await supabase
      .from('stem_states')
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq('stem_state_id', stemStateId)

    if (error) {
      console.error('Error updating stem state:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    console.error('Exception updating stem state:', err)
    return { success: false, error: err.message }
  }
}
