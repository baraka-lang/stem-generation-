const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const fsPromises = require('fs').promises
const os = require('os')
const { validateWavHeader, ensureFileReady, isProcessElevated, getDiagnostics } = require('./electron-utils.cjs')

let nativeDragHelper = null
let elevationStatus = null

function loadNativeDragHelper() {
  try {
    if (process.platform === 'darwin') {
      nativeDragHelper = require('./native/macos/drag-helper.node')
      console.log('✓ Loaded macOS native drag helper')
    } else if (process.platform === 'win32') {
      nativeDragHelper = require('./native/windows/drag-helper.node')
      console.log('✓ Loaded Windows native drag helper')
    } else {
      console.warn('Native drag not supported on', process.platform)
    }
  } catch (err) {
    console.warn('Failed to load native drag helper, using fallback:', err.message)
  }
}

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    title: '343 Labs AI Music Studio',
    backgroundColor: '#0f0f1a'
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'))
  }
}

app.whenReady().then(() => {
  loadNativeDragHelper()

  // Check elevation status for UAC diagnostics
  elevationStatus = isProcessElevated()
  if (elevationStatus.elevated && process.platform === 'win32') {
    console.warn('[UAC] ⚠️  Running as Administrator - DAW drag may fail if DAW is not elevated!')
    console.warn('[UAC] Recommendation: Run both app and DAW without Administrator privileges')
  } else {
    console.log('[UAC] windows appElevated=false status=ok')
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function wrapPCMToWAV(pcmBuffer, sampleRate, numChannels) {
  const bitsPerSample = 16
  const blockAlign = numChannels * (bitsPerSample / 8)
  const byteRate = sampleRate * blockAlign
  const dataSize = pcmBuffer.length

  const header = Buffer.alloc(44)

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)

  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)

  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, pcmBuffer])
}

// Synchronous IPC handler for drag operations
// This must be synchronous to work within the dragstart event timing window
ipcMain.on('start-native-drag', (event, { stemId, pcmData, sampleRate, numChannels, filename }) => {
  try {
    const startTime = Date.now()
    const pcmBuffer = Buffer.from(pcmData)

    console.log(`[Drag] Starting synchronous drag for ${stemId}: ${filename}`)
    console.log(`[Drag] Format: ${sampleRate}Hz, ${numChannels}ch, ${(pcmBuffer.length / 1024).toFixed(1)}KB`)

    // Skip native module attempts - not compiled, go straight to reliable temp file approach
    const tempDir = path.join(os.tmpdir(), '343labs-stems')

    // Create directory synchronously
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    const tempFilePath = path.join(tempDir, filename)

    // Wrap PCM to WAV and write synchronously
    const wavBuffer = wrapPCMToWAV(pcmBuffer, sampleRate, numChannels)
    fs.writeFileSync(tempFilePath, wavBuffer)

    // Verify the file was written successfully
    if (!fs.existsSync(tempFilePath)) {
      console.error('[Drag] Temp file was not created:', tempFilePath)
      event.returnValue = { success: false, error: 'Failed to create temp file' }
      return
    }

    const fileStats = fs.statSync(tempFilePath)
    if (fileStats.size !== wavBuffer.length) {
      console.error(`[Drag] File size mismatch: expected ${wavBuffer.length}, got ${fileStats.size}`)
      event.returnValue = { success: false, error: 'File size mismatch' }
      return
    }

    const elapsed = Date.now() - startTime
    console.log(`[Drag] Wrote temp file synchronously in ${elapsed}ms: ${tempFilePath} (${(wavBuffer.length / 1024).toFixed(1)}KB)`)
    console.log(`[Drag] File verified: ${fileStats.size} bytes written successfully`)

    // Get the window and start the native drag immediately
    const win = BrowserWindow.fromWebContents(event.sender)

    if (!win) {
      console.error('[Drag] Could not find window for drag operation')
      event.returnValue = { success: false, error: 'Window not found' }
      return
    }

    try {
      // Resolve icon path - in development it's in public/, in production it's in dist/
      let iconPath = path.join(__dirname, 'public/vite.svg')
      if (!fs.existsSync(iconPath)) {
        iconPath = path.join(__dirname, 'dist/vite.svg')
      }
      if (!fs.existsSync(iconPath)) {
        console.warn('[Drag] Icon not found, using empty string (may cause issues on macOS)')
        iconPath = ''
      }

      // Start the native OS drag operation
      // This must be called synchronously during the dragstart event
      win.webContents.startDrag({
        file: tempFilePath,
        icon: iconPath
      })

      console.log(`[Drag] ✓ Native drag initiated successfully (total: ${Date.now() - startTime}ms)`)

      // Schedule cleanup of temp file after drag completes
      setTimeout(() => {
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath)
            console.log(`[Drag] Cleaned up temp file: ${tempFilePath}`)
          }
        } catch (err) {
          console.warn('[Drag] Failed to cleanup temp file:', err.message)
        }
      }, 300000) // 5 minutes - enough for slow DAW reads

      // Return success synchronously
      event.returnValue = { success: true, filePath: tempFilePath, method: 'temp-file-sync', elapsed }
    } catch (dragErr) {
      console.error('[Drag] webContents.startDrag failed:', dragErr)
      event.returnValue = { success: false, error: dragErr.message }
    }
  } catch (error) {
    console.error('[Drag] Synchronous drag failed:', error)
    event.returnValue = { success: false, error: error.message }
  }
})

ipcMain.handle('is-electron', () => {
  return true
})

ipcMain.handle('get-diagnostics', async () => {
  return getDiagnostics()
})

ipcMain.handle('get-elevation-status', async () => {
  return elevationStatus || isProcessElevated()
})

ipcMain.handle('get-platform', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    version: process.version
  }
})

ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path')
    }

    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath)

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`)
    }

    shell.showItemInFolder(absolutePath)
    console.log(`[Shell] Revealed in folder: ${absolutePath}`)

    return { success: true, path: absolutePath }
  } catch (error) {
    console.error('[Shell] Failed to show item in folder:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('show-save-directory-dialog', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender)

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose folder to save audio files',
      buttonLabel: 'Select Folder'
    })

    if (result.canceled) {
      return { canceled: true }
    }

    const dirPath = result.filePaths[0]
    console.log(`[Dialog] Selected save directory: ${dirPath}`)

    return {
      canceled: false,
      path: dirPath
    }
  } catch (error) {
    console.error('[Dialog] Failed to show directory picker:', error)
    return {
      canceled: true,
      error: error.message
    }
  }
})

ipcMain.handle('save-wav-file', async (event, { directory, filename, pcmData, sampleRate, numChannels }) => {
  try {
    if (!directory || !filename || !pcmData || !sampleRate) {
      throw new Error('Missing required parameters')
    }

    const pcmBuffer = Buffer.from(pcmData)
    const wavBuffer = wrapPCMToWAV(pcmBuffer, sampleRate, numChannels || 2)

    const finalPath = path.join(directory, filename)
    const tempPath = path.join(directory, `.part-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`)

    console.log(`[SaveWav] Writing ${filename} (${(wavBuffer.length / 1024).toFixed(1)}KB)`)
    console.log(`[SaveWav] Temp: ${tempPath}`)

    fs.writeFileSync(tempPath, wavBuffer)

    // Flush data to disk to ensure file is fully written
    const tempFd = fs.openSync(tempPath, 'r+')
    fs.fsyncSync(tempFd)
    fs.closeSync(tempFd)
    console.log(`[SAVE] fsync=ok path=${tempPath}`)

    await new Promise(resolve => setTimeout(resolve, 50))

    const stats = fs.statSync(tempPath)
    if (stats.size !== wavBuffer.length) {
      fs.unlinkSync(tempPath)
      throw new Error(`File size mismatch: expected ${wavBuffer.length}, got ${stats.size}`)
    }

    const headerBuffer = Buffer.alloc(44)
    const fd = fs.openSync(tempPath, 'r')
    fs.readSync(fd, headerBuffer, 0, 44, 0)
    fs.closeSync(fd)

    const riff = headerBuffer.toString('ascii', 0, 4)
    const wave = headerBuffer.toString('ascii', 8, 12)
    const fmt = headerBuffer.toString('ascii', 12, 16)
    const data = headerBuffer.toString('ascii', 36, 40)

    if (riff !== 'RIFF' || wave !== 'WAVE' || fmt !== 'fmt ' || data !== 'data') {
      fs.unlinkSync(tempPath)
      throw new Error('WAV header validation failed')
    }

    console.log(`[SaveWav] Temp file verified, renaming to: ${finalPath}`)

    if (fs.existsSync(finalPath)) {
      fs.unlinkSync(finalPath)
    }

    fs.renameSync(tempPath, finalPath)

    await new Promise(resolve => setTimeout(resolve, 10))

    const finalStats = fs.statSync(finalPath)
    console.log(`[SaveWav] ✓ File saved: ${finalPath} (${(finalStats.size / 1024).toFixed(1)}KB)`)

    return {
      success: true,
      path: finalPath,
      size: finalStats.size
    }
  } catch (error) {
    console.error('[SaveWav] Failed to save file:', error)
    return {
      success: false,
      error: error.message
    }
  }
})

ipcMain.on('start-native-drag-with-path', (event, { stemId, filePath, filename }) => {
  const startTime = Date.now()
  console.log(`[DRAG] sender=electron event=dragstart stemId=${stemId}`)

  try {
    // 1. Validate file exists
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`[ERROR] code=NO_PATH stemId=${stemId} path=${filePath}`)
      event.returnValue = { success: false, error: 'File not found', code: 'NO_PATH' }
      return
    }

    // 2. Get file stats
    const stats = fs.statSync(filePath)
    console.log(`[DRAG] prepared path=${filePath} size=${(stats.size / 1024).toFixed(1)}KB`)

    // 3. Ensure file is fully written and ready
    const readyCheck = ensureFileReady(filePath, stats.size)
    if (!readyCheck.ready) {
      console.error(`[ERROR] code=PARTIAL_WRITE stemId=${stemId} error=${readyCheck.error}`)
      event.returnValue = { success: false, error: `File not ready: ${readyCheck.error}`, code: 'PARTIAL_WRITE' }
      return
    }

    // 4. Validate WAV header
    const headerCheck = validateWavHeader(filePath)
    if (!headerCheck.valid) {
      console.error(`[ERROR] code=HEADER_INVALID stemId=${stemId} error=${headerCheck.error}`)
      event.returnValue = { success: false, error: `Invalid WAV: ${headerCheck.error}`, code: 'HEADER_INVALID' }
      return
    }

    const { numChannels, sampleRate, bitsPerSample, dataSize } = headerCheck.details
    console.log(`[SAVE] path=${filePath} size=${stats.size} wavHeader=ok fsync=ok sr=${sampleRate} ch=${numChannels} bits=${bitsPerSample}`)

    // 5. Get window for drag operation
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      console.error(`[ERROR] code=NO_WINDOW stemId=${stemId}`)
      event.returnValue = { success: false, error: 'Window not found', code: 'NO_WINDOW' }
      return
    }

    // 6. Resolve drag icon
    let iconPath = path.join(__dirname, 'public/vite.svg')
    if (!fs.existsSync(iconPath)) {
      iconPath = path.join(__dirname, 'dist/vite.svg')
    }
    if (!fs.existsSync(iconPath)) {
      console.warn('[DRAG] Icon not found, proceeding without icon')
      iconPath = ''
    }

    // 7. Check UAC status and warn if mismatch likely
    if (elevationStatus?.elevated && process.platform === 'win32') {
      console.warn('[UAC] windows appElevated=true status=mismatch')
      console.warn('[WARN] App is elevated - DAW drops may fail if DAW is not elevated')
    }

    // 8. Start native drag - MUST be synchronous
    const dragStartTime = Date.now()
    win.webContents.startDrag({
      file: filePath,
      icon: iconPath
    })

    const elapsed = Date.now() - startTime
    const dragElapsed = Date.now() - dragStartTime
    console.log(`[DRAG] prepared path=${filePath} write_ms=0 rename_ms=0 startDrag_ms=${dragElapsed} total_ms=${elapsed}`)

    // 9. Return success synchronously
    event.returnValue = {
      success: true,
      filePath,
      method: 'saved-file-path',
      elapsed,
      format: `${sampleRate}Hz_${numChannels}ch_${bitsPerSample}bit`
    }
  } catch (error) {
    console.error(`[ERROR] code=STARTDRAG_ERR stemId=${stemId} error=${error.message}`)
    event.returnValue = {
      success: false,
      error: error.message,
      code: 'STARTDRAG_ERR'
    }
  }
})
