/**
 * Session Data Manager
 * Handles temporary storage of user data during passwordless authentication flow
 */

const SESSION_STORAGE_PREFIX = 'stemflow_session_'
const SESSION_DATA_KEYS = {
  FAVORITES: 'favorites',
  DOWNLOADS: 'downloads',
  PREFERENCES: 'preferences',
  CART_ITEMS: 'cart_items',
  CURRENT_STEM_SET: 'current_stem_set',
  STEM_HISTORY: 'stem_history'
}

/**
 * Save data to session storage
 * @param {string} key - Storage key
 * @param {any} data - Data to store
 */
export function saveSessionData(key, data) {
  try {
    const storageKey = `${SESSION_STORAGE_PREFIX}${key}`
    sessionStorage.setItem(storageKey, JSON.stringify(data))
    console.log(`Session data saved: ${key}`)
  } catch (error) {
    console.error(`Error saving session data for ${key}:`, error)
  }
}

/**
 * Get data from session storage
 * @param {string} key - Storage key
 * @returns {any} Stored data or null
 */
export function getSessionData(key) {
  try {
    const storageKey = `${SESSION_STORAGE_PREFIX}${key}`
    const data = sessionStorage.getItem(storageKey)
    return data ? JSON.parse(data) : null
  } catch (error) {
    console.error(`Error getting session data for ${key}:`, error)
    return null
  }
}

/**
 * Clear specific session data
 * @param {string} key - Storage key
 */
export function clearSessionData(key) {
  try {
    const storageKey = `${SESSION_STORAGE_PREFIX}${key}`
    sessionStorage.removeItem(storageKey)
    console.log(`Session data cleared: ${key}`)
  } catch (error) {
    console.error(`Error clearing session data for ${key}:`, error)
  }
}

/**
 * Clear all session data
 */
export function clearAllSessionData() {
  try {
    const keys = Object.keys(sessionStorage)
    keys.forEach(key => {
      if (key.startsWith(SESSION_STORAGE_PREFIX)) {
        sessionStorage.removeItem(key)
      }
    })
    console.log('All session data cleared')
  } catch (error) {
    console.error('Error clearing all session data:', error)
  }
}

/**
 * Get all session data
 * @returns {Object} All session data
 */
export function getAllSessionData() {
  const sessionData = {}
  
  Object.values(SESSION_DATA_KEYS).forEach(key => {
    const data = getSessionData(key)
    if (data !== null) {
      sessionData[key] = data
    }
  })
  
  return sessionData
}

/**
 * Save favorites to session storage
 * @param {Array} favorites - Array of favorite stem IDs
 */
export function saveFavorites(favorites) {
  saveSessionData(SESSION_DATA_KEYS.FAVORITES, favorites)
}

/**
 * Get favorites from session storage
 * @returns {Array} Array of favorite stem IDs
 */
export function getFavorites() {
  return getSessionData(SESSION_DATA_KEYS.FAVORITES) || []
}

/**
 * Add a stem to favorites
 * @param {string} stemId - ID of the stem to favorite
 */
export function addToFavorites(stemId) {
  const favorites = getFavorites()
  if (!favorites.includes(stemId)) {
    favorites.push(stemId)
    saveFavorites(favorites)
  }
}

/**
 * Remove a stem from favorites
 * @param {string} stemId - ID of the stem to unfavorite
 */
export function removeFromFavorites(stemId) {
  const favorites = getFavorites()
  const index = favorites.indexOf(stemId)
  if (index > -1) {
    favorites.splice(index, 1)
    saveFavorites(favorites)
  }
}

/**
 * Save download history to session storage
 * @param {Array} downloads - Array of download records
 */
export function saveDownloads(downloads) {
  saveSessionData(SESSION_DATA_KEYS.DOWNLOADS, downloads)
}

/**
 * Get download history from session storage
 * @returns {Array} Array of download records
 */
export function getDownloads() {
  return getSessionData(SESSION_DATA_KEYS.DOWNLOADS) || []
}

/**
 * Add a download to history
 * @param {Object} download - Download record
 */
export function addDownload(download) {
  const downloads = getDownloads()
  downloads.push({
    ...download,
    timestamp: new Date().toISOString()
  })
  saveDownloads(downloads)
}

/**
 * Save user preferences to session storage
 * @param {Object} preferences - User preferences
 */
export function savePreferences(preferences) {
  saveSessionData(SESSION_DATA_KEYS.PREFERENCES, preferences)
}

/**
 * Get user preferences from session storage
 * @returns {Object} User preferences
 */
export function getPreferences() {
  return getSessionData(SESSION_DATA_KEYS.PREFERENCES) || {}
}

/**
 * Save cart items to session storage
 * @param {Array} cartItems - Array of cart items
 */
export function saveCartItems(cartItems) {
  saveSessionData(SESSION_DATA_KEYS.CART_ITEMS, cartItems)
}

/**
 * Get cart items from session storage
 * @returns {Array} Array of cart items
 */
export function getCartItems() {
  return getSessionData(SESSION_DATA_KEYS.CART_ITEMS) || []
}

/**
 * Add item to cart
 * @param {Object} item - Item to add to cart
 */
export function addToCart(item) {
  const cartItems = getCartItems()
  cartItems.push(item)
  saveCartItems(cartItems)
}

/**
 * Remove item from cart
 * @param {string} itemId - ID of item to remove
 */
export function removeFromCart(itemId) {
  const cartItems = getCartItems()
  const filteredItems = cartItems.filter(item => item.id !== itemId)
  saveCartItems(filteredItems)
}

/**
 * Save current stem set to session storage
 * @param {Object} stemSet - Current stem set data
 */
export function saveCurrentStemSet(stemSet) {
  saveSessionData(SESSION_DATA_KEYS.CURRENT_STEM_SET, stemSet)
}

/**
 * Get current stem set from session storage
 * @returns {Object} Current stem set data
 */
export function getCurrentStemSet() {
  return getSessionData(SESSION_DATA_KEYS.CURRENT_STEM_SET) || null
}

/**
 * Save stem history to session storage
 * @param {Object} stemHistory - Stem history data
 */
export function saveStemHistory(stemHistory) {
  saveSessionData(SESSION_DATA_KEYS.STEM_HISTORY, stemHistory)
}

/**
 * Get stem history from session storage
 * @returns {Object} Stem history data
 */
export function getStemHistory() {
  return getSessionData(SESSION_DATA_KEYS.STEM_HISTORY) || {}
}

/**
 * Merge session data with user account data
 * This function would be called after successful authentication
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function mergeSessionDataWithAccount(userId) {
  try {
    const sessionData = getAllSessionData()
    
    // Import stem API functions
    const { 
      addToFavorites: addStemToFavorites,
      addDownload: addStemDownload,
      savePreferences: saveStemPreferences,
      createStemSet: saveStemSet
    } = await import('./stemApi.js')
    
    // Merge favorites
    if (sessionData.favorites && sessionData.favorites.length > 0) {
      for (const stemId of sessionData.favorites) {
        await addStemToFavorites(userId, stemId)
      }
    }
    
    // Merge downloads
    if (sessionData.downloads && sessionData.downloads.length > 0) {
      for (const download of sessionData.downloads) {
        await addStemDownload({
          ...download,
          userId
        })
      }
    }
    
    // Merge preferences
    if (sessionData.preferences && Object.keys(sessionData.preferences).length > 0) {
      await saveStemPreferences(userId, sessionData.preferences)
    }
    
    // Merge current stem set
    if (sessionData.current_stem_set) {
      await saveStemSet({
        ...sessionData.current_stem_set,
        userId
      })
    }
    
    // Clear session data after successful merge
    clearAllSessionData()
    
    return { success: true }
  } catch (error) {
    console.error('Error merging session data:', error)
    return { success: false, error: error.message }
  }
}

// Export the session data keys for use in other modules
export { SESSION_DATA_KEYS }
