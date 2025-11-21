/**
 * Electron-specific file management for DAW drag-and-drop
 *
 * This module handles file operations in Electron using native Node.js APIs
 * instead of the browser's File System Access API. This approach provides:
 * - Full absolute file paths (required for shell.showItemInFolder and DAW drops)
 * - Synchronous operations during drag gestures
 * - No browser security restrictions
 *
 * Key differences from browser auto-download:
 * - Uses Electron dialog API for folder selection
 * - Tracks full absolute paths, not FileSystemHandle objects
 * - Can use Node.js fs operations via IPC to main process
 */

const electronState = {
  isElectron: typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined',
  saveDirectory: null,
  savedFiles: new Map(),
  listeners: new Set()
}

function emit(event, payload) {
  electronState.listeners.forEach(cb => {
    try {
      cb(event, payload)
    } catch (err) {
      console.error('[ElectronFileManager] Listener error:', err)
    }
  })
}

export function isElectronMode() {
  return electronState.isElectron
}

export function isElectronSaveEnabled() {
  return electronState.isElectron && electronState.saveDirectory !== null
}

export function getElectronSaveDirectory() {
  return electronState.saveDirectory
}

export async function chooseElectronSaveDirectory() {
  if (!electronState.isElectron) {
    throw new Error('Not running in Electron')
  }

  if (!window.electronAPI.showSaveDirectoryDialog) {
    throw new Error('Electron save directory dialog not available')
  }

  try {
    const result = await window.electronAPI.showSaveDirectoryDialog()

    if (result.canceled) {
      return { canceled: true }
    }

    electronState.saveDirectory = result.path
    console.log(`[ElectronFileManager] Save directory selected: ${result.path}`)

    emit('directory-selected', { path: result.path })

    return { path: result.path, canceled: false }
  } catch (err) {
    console.error('[ElectronFileManager] Failed to choose directory:', err)
    throw err
  }
}

export function disableElectronSave() {
  electronState.saveDirectory = null
  electronState.savedFiles.clear()
  emit('disabled', {})
  console.log('[ElectronFileManager] Electron save disabled')
}

export async function saveWavFileElectron(stemId, pcmData, sampleRate, numChannels, filename) {
  if (!electronState.isElectron) {
    throw new Error('Not running in Electron')
  }

  if (!electronState.saveDirectory) {
    throw new Error('No save directory selected')
  }

  if (!window.electronAPI.saveWavFile) {
    throw new Error('Electron save API not available')
  }

  try {
    const pcmArray = pcmData instanceof ArrayBuffer
      ? Array.from(new Uint8Array(pcmData))
      : Array.from(pcmData)

    console.log(`[ElectronFileManager] Saving ${stemId}: ${filename} (${(pcmArray.length / 1024).toFixed(1)}KB PCM)`)

    electronState.savedFiles.set(stemId, {
      filename,
      status: 'pending',
      path: null,
      savedAt: null
    })
    emit('save-started', { stemId, filename })

    const result = await window.electronAPI.saveWavFile({
      directory: electronState.saveDirectory,
      filename,
      pcmData: pcmArray,
      sampleRate,
      numChannels
    })

    if (!result.success) {
      throw new Error(result.error || 'Save failed')
    }

    electronState.savedFiles.set(stemId, {
      filename,
      status: 'saved',
      path: result.path,
      size: result.size,
      savedAt: Date.now()
    })

    console.log(`[ElectronFileManager] ✓ Saved ${stemId} to ${result.path} (${(result.size / 1024).toFixed(1)}KB)`)
    emit('save-completed', { stemId, filename, path: result.path, size: result.size })

    return {
      success: true,
      path: result.path,
      size: result.size
    }
  } catch (err) {
    console.error(`[ElectronFileManager] Failed to save ${stemId}:`, err)

    electronState.savedFiles.set(stemId, {
      filename,
      status: 'error',
      path: null,
      error: err.message,
      savedAt: null
    })

    emit('save-error', { stemId, filename, error: err.message })
    throw err
  }
}

export function getSavedFilePath(stemId) {
  const record = electronState.savedFiles.get(stemId)
  return record?.status === 'saved' ? record.path : null
}

export function getSavedFileRecord(stemId) {
  return electronState.savedFiles.get(stemId) || null
}

export function getAllSavedFiles() {
  return Array.from(electronState.savedFiles.entries()).map(([stemId, record]) => ({
    stemId,
    ...record
  }))
}

export function clearSavedFile(stemId) {
  electronState.savedFiles.delete(stemId)
  emit('file-cleared', { stemId })
}

export function subscribeElectronFileEvents(callback) {
  electronState.listeners.add(callback)
  return () => electronState.listeners.delete(callback)
}

export function getElectronFileStatus() {
  return {
    isElectron: electronState.isElectron,
    enabled: electronState.saveDirectory !== null,
    directory: electronState.saveDirectory,
    savedCount: electronState.savedFiles.size,
    files: getAllSavedFiles()
  }
}
