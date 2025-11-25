const usedIds = new Set()
const COLLISION_CHECK_SIZE = 10000

function cleanupOldIds() {
  if (usedIds.size > COLLISION_CHECK_SIZE) {
    const idsArray = Array.from(usedIds)
    usedIds.clear()
    idsArray.slice(-COLLISION_CHECK_SIZE / 2).forEach(id => usedIds.add(id))
  }
}

export function generateUniqueFileId() {
  let attempts = 0
  const maxAttempts = 100

  while (attempts < maxAttempts) {
    const timestamp = Date.now()
    const randomPart = Math.floor(Math.random() * 1000)
    const combined = timestamp.toString() + randomPart.toString().padStart(3, '0')
    const uniqueId = combined.slice(-13)

    if (!usedIds.has(uniqueId)) {
      usedIds.add(uniqueId)
      cleanupOldIds()
      return uniqueId
    }

    attempts++
  }

  const fallback = Date.now().toString().slice(-13)
  console.warn('[UniqueFileId] Collision detection failed, using fallback ID:', fallback)
  return fallback
}

export function addUniqueIdToFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    console.warn('[UniqueFileId] Invalid filename provided:', filename)
    return filename
  }

  const uniqueId = generateUniqueFileId()
  const lastDotIndex = filename.lastIndexOf('.')

  if (lastDotIndex === -1) {
    return `${filename}_${uniqueId}`
  }

  const nameWithoutExt = filename.substring(0, lastDotIndex)
  const extension = filename.substring(lastDotIndex)

  return `${nameWithoutExt}_${uniqueId}${extension}`
}

export function extractUniqueIdFromFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return null
  }

  const match = filename.match(/_(\d{13})(\.[^.]+)?$/)
  return match ? match[1] : null
}

export function validateUniqueId(id) {
  if (!id || typeof id !== 'string') {
    return false
  }

  return /^\d{13}$/.test(id)
}
