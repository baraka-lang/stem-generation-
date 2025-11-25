import { pcm16leToWav, isValidWavHeader } from './pcmToWav.js'

const DB_NAME = 'daw-auto-download'
const STORE_NAME = 'handles'
const HANDLE_KEY = 'directory'

const listeners = new Set()

const autoState = {
  supported: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
  directoryHandle: null,
  directoryName: '',
  enabled: false,
  lastSavedStem: null,
  lastError: null,
  stemRecords: {},
  pendingWrites: new Map()
}

function emit(event, payload) {
  listeners.forEach(cb => {
    try {
      cb(event, payload)
    } catch (err) {
      console.error('[AutoDownload] Listener error:', err)
    }
  })
}

function getHandleDB() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = event => {
      try {
        const db = event.target.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      } catch (err) {
        console.warn('[AutoDownload] Failed to upgrade IndexedDB store:', err)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function saveDirectoryHandle(handle) {
  const db = await getHandleDB()
  if (!db) return
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY)
  })
}

async function loadDirectoryHandle() {
  const db = await getHandleDB()
  if (!db) return null
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    tx.onerror = () => reject(tx.error)
    const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

async function clearStoredHandle() {
  const db = await getHandleDB()
  if (!db) return
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY)
  })
}

async function verifyPermission(handle, mode = 'readwrite') {
  if (!handle) return false
  try {
    if (handle.queryPermission) {
      const result = await handle.queryPermission({ mode })
      if (result === 'granted') return true
    }
    if (handle.requestPermission) {
      const result = await handle.requestPermission({ mode })
      return result === 'granted'
    }
  } catch (err) {
    console.warn('[AutoDownload] Permission request failed:', err)
  }
  return false
}

function getStatusSnapshot() {
  return {
    supported: autoState.supported,
    enabled: autoState.enabled && !!autoState.directoryHandle,
    directoryName: autoState.directoryName,
    lastSavedStem: autoState.lastSavedStem,
    lastError: autoState.lastError,
    stemRecords: { ...autoState.stemRecords }
  }
}

export function subscribeAutoDownloadEvents(callback) {
  if (typeof callback !== 'function') return () => {}
  listeners.add(callback)
  return () => listeners.delete(callback)
}

export function isAutoDownloadSupported() {
  return !!autoState.supported
}

export function isAutoDownloadEnabled() {
  return autoState.supported && autoState.enabled && !!autoState.directoryHandle
}

export function getAutoDownloadStatus() {
  return getStatusSnapshot()
}

export function getStemAutoDownloadRecord(stemId) {
  return autoState.stemRecords[stemId] || null
}

export async function initAutoDownloadManager() {
  if (!autoState.supported) {
    emit('state', getStatusSnapshot())
    return getStatusSnapshot()
  }
  try {
    const handle = await loadDirectoryHandle()
    if (handle) {
      const hasPerm = await verifyPermission(handle)
      if (hasPerm) {
        autoState.directoryHandle = handle
        autoState.directoryName = handle.name || 'Selected folder'
        autoState.enabled = true
      } else {
        await clearStoredHandle()
      }
    }
  } catch (err) {
    console.warn('[AutoDownload] Failed to restore directory handle:', err)
    await clearStoredHandle()
  }
  const snapshot = getStatusSnapshot()
  emit('state', snapshot)
  return snapshot
}

export async function requestAutoDownloadDirectory() {
  if (!autoState.supported) {
    throw new Error('This browser does not support automatic downloads yet')
  }
  if (!window.showDirectoryPicker) {
    throw new Error('Directory picker is unavailable in this environment')
  }
  const handle = await window.showDirectoryPicker({ id: 'ai-stems', mode: 'readwrite' })
  const hasPerm = await verifyPermission(handle)
  if (!hasPerm) {
    throw new Error('Permission to write to the selected folder was denied')
  }
  autoState.directoryHandle = handle
  autoState.directoryName = handle.name || 'Selected folder'
  autoState.enabled = true
  await saveDirectoryHandle(handle)
  const snapshot = getStatusSnapshot()
  emit('state', snapshot)
  return snapshot
}

export async function disableAutoDownload() {
  autoState.directoryHandle = null
  autoState.directoryName = ''
  autoState.enabled = false
  autoState.lastSavedStem = null
  autoState.lastError = null
  autoState.stemRecords = {}
  autoState.pendingWrites.clear()
  await clearStoredHandle()
  const snapshot = getStatusSnapshot()
  emit('state', snapshot)
  return snapshot
}

async function writeStemToDisk(filename, pcmData, sampleRate, numChannels) {
  if (!autoState.directoryHandle) {
    throw new Error('No destination folder selected')
  }

  const wavBuffer = pcm16leToWav(pcmData, sampleRate, numChannels)

  const tempFilename = `.part-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`

  let tempHandle = null
  let finalHandle = null

  try {
    tempHandle = await autoState.directoryHandle.getFileHandle(tempFilename, { create: true })
    const writable = await tempHandle.createWritable()

    await writable.truncate(0)
    await writable.write(wavBuffer)
    await writable.close()

    console.log(`[AutoDownload] Wrote temp file: ${tempFilename} (${(wavBuffer.byteLength / 1024).toFixed(1)}KB)`)

    await new Promise(resolve => setTimeout(resolve, 50))

    const tempFile = await tempHandle.getFile()
    if (tempFile.size !== wavBuffer.byteLength) {
      throw new Error(`File size mismatch: expected ${wavBuffer.byteLength}, got ${tempFile.size}`)
    }

    const headerBytes = await tempFile.slice(0, 44).arrayBuffer()
    if (!isValidWavHeader(headerBytes)) {
      throw new Error('WAV header validation failed')
    }

    console.log(`[AutoDownload] Temp file verified, renaming to: ${filename}`)

    finalHandle = await autoState.directoryHandle.getFileHandle(filename, { create: true })
    const finalWritable = await finalHandle.createWritable()
    await finalWritable.truncate(0)
    await finalWritable.write(wavBuffer)
    await finalWritable.close()

    try {
      await autoState.directoryHandle.removeEntry(tempFilename)
      console.log(`[AutoDownload] Cleaned up temp file: ${tempFilename}`)
    } catch (cleanupErr) {
      console.warn(`[AutoDownload] Failed to cleanup temp file: ${cleanupErr.message}`)
    }

    await new Promise(resolve => setTimeout(resolve, 10))

    console.log(`[AutoDownload] ✓ File saved atomically: ${filename}`)

    return { bytes: wavBuffer.byteLength, fileHandle: finalHandle }
  } catch (err) {
    if (tempHandle) {
      try {
        await autoState.directoryHandle.removeEntry(tempFilename)
      } catch (cleanupErr) {
        console.warn(`[AutoDownload] Failed to cleanup temp file after error: ${cleanupErr.message}`)
      }
    }
    throw err
  }
}

export async function queueAutoDownloadForStem(stemId, meta = {}) {
  if (!isAutoDownloadEnabled()) {
    return { skipped: true, reason: 'disabled' }
  }
  if (!meta || !meta.pcmData || !meta.sampleRate) {
    return { skipped: true, reason: 'missing-data' }
  }

  const timestamp = meta.timestamp || Date.now()
  const filename = meta.filename || `${stemId}_${timestamp}.wav`
  const record = autoState.stemRecords[stemId]
  if (record && record.timestamp === timestamp && record.status === 'saved') {
    return { skipped: true, reason: 'already-saved' }
  }

  const jobKey = `${stemId}:${timestamp}`
  if (autoState.pendingWrites.has(jobKey)) {
    return autoState.pendingWrites.get(jobKey)
  }

  const jobPromise = (async () => {
    autoState.stemRecords[stemId] = {
      filename,
      timestamp,
      status: 'pending',
      fileHandle: null
    }
    emit('progress', { stemId, ...autoState.stemRecords[stemId] })
    try {
      const { bytes, fileHandle } = await writeStemToDisk(filename, meta.pcmData, meta.sampleRate, meta.numChannels || 2)
      autoState.stemRecords[stemId] = {
        filename,
        timestamp,
        status: 'saved',
        bytes,
        savedAt: Date.now(),
        fileHandle
      }
      autoState.lastSavedStem = {
        stemId,
        filename,
        savedAt: autoState.stemRecords[stemId].savedAt,
        fileHandle
      }
      autoState.lastError = null
      emit('progress', { stemId, ...autoState.stemRecords[stemId] })
      const snapshot = getStatusSnapshot()
      emit('state', snapshot)
      return { saved: true, bytes }
    } catch (error) {
      autoState.stemRecords[stemId] = {
        filename,
        timestamp,
        status: 'error',
        error: error.message,
        fileHandle: null
      }
      autoState.lastError = error.message
      emit('progress', { stemId, ...autoState.stemRecords[stemId] })
      const snapshot = getStatusSnapshot()
      emit('state', snapshot)
      throw error
    } finally {
      autoState.pendingWrites.delete(jobKey)
    }
  })()

  autoState.pendingWrites.set(jobKey, jobPromise)
  return jobPromise
}
