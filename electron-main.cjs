const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const fsPromises = require('fs').promises
const os = require('os')

let nativeDragHelper = null

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

    const elapsed = Date.now() - startTime
    console.log(`[Drag] Wrote temp file synchronously in ${elapsed}ms: ${tempFilePath} (${(wavBuffer.length / 1024).toFixed(1)}KB)`)

    // Get the window and start the native drag immediately
    const win = BrowserWindow.fromWebContents(event.sender)

    if (!win) {
      console.error('[Drag] Could not find window for drag operation')
      event.returnValue = { success: false, error: 'Window not found' }
      return
    }

    try {
      // Start the native OS drag operation
      // This must be called synchronously during the dragstart event
      win.webContents.startDrag({
        file: tempFilePath,
        icon: path.join(__dirname, 'public/vite.svg')
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
      }, 10000)

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

ipcMain.handle('get-platform', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    version: process.version
  }
})
