const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Synchronous drag operation - must return immediately for dragstart event
  startNativeDrag: (stemId, pcmData, sampleRate, numChannels, filename) => {
    const pcmArray = pcmData instanceof ArrayBuffer
      ? Array.from(new Uint8Array(pcmData))
      : Array.from(pcmData)

    // Use sendSync for synchronous IPC - returns immediately
    // This is critical for drag operations to work within the dragstart event timing
    return ipcRenderer.sendSync('start-native-drag', {
      stemId,
      pcmData: pcmArray,
      sampleRate,
      numChannels,
      filename
    })
  },

  isElectron: () => ipcRenderer.invoke('is-electron'),

  getPlatform: () => ipcRenderer.invoke('get-platform'),

  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath)
})
