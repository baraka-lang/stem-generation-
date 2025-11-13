const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

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

ipcMain.handle('start-native-drag', async (event, { stemId, wavBlob, filename }) => {
  try {
    const tempDir = path.join(os.tmpdir(), '343labs-stems')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    const tempFilePath = path.join(tempDir, filename)

    const buffer = Buffer.from(wavBlob.data)
    fs.writeFileSync(tempFilePath, buffer)

    const win = BrowserWindow.fromWebContents(event.sender)

    if (process.platform === 'darwin') {
      win.webContents.startDrag({
        file: tempFilePath,
        icon: path.join(__dirname, 'public/vite.svg')
      })
    } else if (process.platform === 'win32') {
      win.webContents.startDrag({
        file: tempFilePath,
        icon: path.join(__dirname, 'public/vite.svg')
      })
    }

    setTimeout(() => {
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath)
        }
      } catch (err) {
        console.error('Failed to cleanup temp file:', err)
      }
    }, 5000)

    return { success: true, filePath: tempFilePath }
  } catch (error) {
    console.error('Native drag failed:', error)
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
