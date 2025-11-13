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

ipcMain.handle('start-native-drag', async (event, { stemId, pcmData, sampleRate, numChannels, filename }) => {
  try {
    const pcmBuffer = Buffer.from(pcmData)

    console.log(`[Drag] Starting native drag for ${stemId}: ${filename}`)
    console.log(`[Drag] Format: ${sampleRate}Hz, ${numChannels}ch, ${pcmBuffer.length} bytes`)

    if (nativeDragHelper && nativeDragHelper.startNativeDrag) {
      try {
        const result = await nativeDragHelper.startNativeDrag([
          {
            stemId,
            pcmData: Array.from(pcmBuffer),
            sampleRate,
            numChannels,
            filename
          }
        ])

        if (result.success) {
          console.log(`✓ Native drag started successfully via native module`)
          return { success: true, method: 'native' }
        } else {
          console.warn('Native drag module returned failure, using fallback')
        }
      } catch (nativeErr) {
        console.warn('Native drag module error, using fallback:', nativeErr.message)
      }
    }

    console.log('[Drag] Using fallback: temp file + webContents.startDrag')
    const tempDir = path.join(os.tmpdir(), '343labs-stems')

    try {
      await fsPromises.mkdir(tempDir, { recursive: true })
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }

    const tempFilePath = path.join(tempDir, filename)

    const wavBuffer = wrapPCMToWAV(pcmBuffer, sampleRate, numChannels)
    await fsPromises.writeFile(tempFilePath, wavBuffer)

    console.log(`[Drag] Wrote temp file: ${tempFilePath} (${wavBuffer.length} bytes)`)

    const win = BrowserWindow.fromWebContents(event.sender)

    if (process.platform === 'darwin' || process.platform === 'win32') {
      win.webContents.startDrag({
        file: tempFilePath,
        icon: path.join(__dirname, 'public/vite.svg')
      })
    }

    setTimeout(async () => {
      try {
        await fsPromises.unlink(tempFilePath)
        console.log(`[Drag] Cleaned up temp file: ${tempFilePath}`)
      } catch (err) {
        console.error('Failed to cleanup temp file:', err)
      }
    }, 10000)

    return { success: true, filePath: tempFilePath, method: 'fallback' }
  } catch (error) {
    console.error('[Drag] Native drag failed:', error)
    return { success: false, error: error.message }
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
