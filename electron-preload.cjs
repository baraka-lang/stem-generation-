const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  startNativeDrag: (stemId, arrayBuffer, filename) => {
    const uint8Array = new Uint8Array(arrayBuffer)

    return ipcRenderer.invoke('start-native-drag', {
      stemId,
      wavBlob: { data: Array.from(uint8Array) },
      filename
    })
  },

  isElectron: () => ipcRenderer.invoke('is-electron'),

  getPlatform: () => ipcRenderer.invoke('get-platform')
})
