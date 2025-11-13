const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  startNativeDrag: (stemId, pcmData, sampleRate, numChannels, filename) => {
    const pcmArray = pcmData instanceof ArrayBuffer
      ? Array.from(new Uint8Array(pcmData))
      : Array.from(pcmData)

    return ipcRenderer.invoke('start-native-drag', {
      stemId,
      pcmData: pcmArray,
      sampleRate,
      numChannels,
      filename
    })
  },

  isElectron: () => ipcRenderer.invoke('is-electron'),

  getPlatform: () => ipcRenderer.invoke('get-platform')
})
