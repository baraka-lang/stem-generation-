// Placeholder for future audio saving/uploading integrations (e.g., Supabase storage)
// No functionality moved yet to avoid breaking existing features.

import { bufferToWavAndDownload } from '../DownloadAudio/index.js'

export function saveBufferToCloud(/* buffer, metadata */){
  console.warn('SaveAudio.saveBufferToCloud is not implemented yet.')
}

// Download helpers extracted from app.js to centralize audio saving logic.
// These functions are intentionally stateless and receive required
// state maps as parameters to avoid tight coupling with the app module.

export function downloadStem(st, stemLoop, stemConfigs){
  const buf = stemLoop[st]
  if (!buf) { alert(`No audio for ${stemConfigs[st]?.name || st}. Create first.`); return }
  bufferToWavAndDownload(buf, `techno_${st}_${Date.now()}.wav`)
}

export function downloadAllActiveStems(stemConfigs, stemActiveIndex, stemLoop){
  Object.keys(stemConfigs).forEach(st => {
    const hasActive = (stemActiveIndex[st] ?? -1) >= 0
    const buf = stemLoop[st]
    if (hasActive && buf) {
      downloadStem(st, stemLoop, stemConfigs)
    }
  })
}