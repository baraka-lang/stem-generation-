/**
 * File System Access API helper for saving audio files to disk
 * Provides a better workflow for DAW integration (Ableton Live, Logic Pro, FL Studio)
 */

const LAST_FOLDER_KEY = 'lastSaveFolder'

/**
 * Check if File System Access API is available
 * @returns {boolean}
 */
export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' &&
         'showSaveFilePicker' in window &&
         'showDirectoryPicker' in window
}

/**
 * Save a single WAV file using File System Access API
 * @param {Blob} blob - WAV audio blob
 * @param {string} suggestedName - Suggested filename
 * @returns {Promise<boolean>} true if saved successfully
 */
export async function saveWavFile(blob, suggestedName = 'stem.wav') {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API not supported in this browser')
  }

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{
        description: 'WAV Audio File',
        accept: { 'audio/wav': ['.wav'] }
      }],
      excludeAcceptAllOption: true
    })

    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()

    console.log(`✓ Saved: ${suggestedName} (${(blob.size / 1024).toFixed(1)}KB)`)
    return true
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Save cancelled by user')
      return false
    }
    throw err
  }
}

/**
 * Save multiple WAV files to a user-selected folder
 * @param {Array<{blob: Blob, filename: string}>} files - Array of file objects
 * @param {Function} onProgress - Optional progress callback (current, total)
 * @returns {Promise<{saved: number, failed: number, folderPath: string}>}
 */
export async function saveMultipleWavFiles(files, onProgress = null) {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API not supported in this browser')
  }

  if (!files || files.length === 0) {
    throw new Error('No files provided')
  }

  try {
    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'music'
    })

    let saved = 0
    let failed = 0

    for (let i = 0; i < files.length; i++) {
      const { blob, filename } = files[i]

      try {
        const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()

        saved++
        console.log(`✓ Saved ${i + 1}/${files.length}: ${filename}`)

        if (onProgress) {
          onProgress(i + 1, files.length)
        }
      } catch (err) {
        failed++
        console.error(`Failed to save ${filename}:`, err)
      }
    }

    // Store the folder name in localStorage for future reference
    try {
      localStorage.setItem(LAST_FOLDER_KEY, dirHandle.name)
    } catch (e) {
      console.warn('Could not store folder preference:', e)
    }

    return {
      saved,
      failed,
      folderPath: dirHandle.name
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Folder selection cancelled by user')
      return { saved: 0, failed: files.length, folderPath: null }
    }
    throw err
  }
}

/**
 * Get the last used folder name from localStorage
 * @returns {string|null}
 */
export function getLastSavedFolder() {
  try {
    return localStorage.getItem(LAST_FOLDER_KEY)
  } catch (e) {
    return null
  }
}

/**
 * Legacy download fallback using anchor element
 * @param {Blob} blob
 * @param {string} filename
 */
export function legacyDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()

  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)

  console.log(`Downloaded via anchor: ${filename}`)
}

/**
 * Smart save that uses File System Access API if available, falls back to legacy
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<boolean>}
 */
export async function smartSaveWav(blob, filename) {
  if (isFileSystemAccessSupported()) {
    try {
      return await saveWavFile(blob, filename)
    } catch (err) {
      console.warn('File System Access failed, falling back to legacy download:', err)
      legacyDownload(blob, filename)
      return true
    }
  } else {
    legacyDownload(blob, filename)
    return true
  }
}
