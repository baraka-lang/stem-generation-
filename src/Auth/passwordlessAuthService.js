/**
 * Passwordless Authentication Service
 * Handles the complete passwordless authentication flow
 */

import { showPasswordlessAuthModal, closePasswordlessAuthModal } from './passwordlessAuthModal.js'
import { mergeSessionDataWithAccount } from './sessionDataManager.js'
import { getCurrentUser } from './index.js'

/**
 * Check if user is authenticated
 * @returns {Promise<boolean>} True if user is authenticated
 */
export async function isUserAuthenticated() {
  try {
    const user = await getCurrentUser()
    return !!user
  } catch (error) {
    console.error('Error checking authentication status:', error)
    return false
  }
}

/**
 * Require authentication for an action
 * @param {string} actionType - Type of action requiring auth
 * @param {Function} actionCallback - Function to execute after authentication
 * @returns {Promise<void>}
 */
export async function requireAuthentication(actionType, actionCallback) {
  const isAuthenticated = await isUserAuthenticated()
  
  if (isAuthenticated) {
    // User is already authenticated, execute action immediately
    if (actionCallback) {
      await actionCallback()
    }
  } else {
    // User not authenticated, show passwordless auth modal
    showPasswordlessAuthModal(actionType, async () => {
      // After successful authentication, execute the action
      if (actionCallback) {
        await actionCallback()
      }
    }, () => {
      console.log('Authentication cancelled')
    })
  }
}

/**
 * Handle authentication success
 * @param {Object} user - Authenticated user object
 * @returns {Promise<void>}
 */
export async function handleAuthenticationSuccess(user) {
  try {
    console.log('Authentication successful for user:', user.email)
    
    // Merge session data with user account
    const mergeResult = await mergeSessionDataWithAccount(user.id)
    
    if (mergeResult.success) {
      console.log('Session data merged successfully')
    } else {
      console.warn('Failed to merge session data:', mergeResult.error)
    }
    
    // Close the auth modal
    closePasswordlessAuthModal()
    
    // Update UI to reflect authenticated state
    updateUIForAuthenticatedUser(user)
    
  } catch (error) {
    console.error('Error handling authentication success:', error)
  }
}

/**
 * Handle authentication failure
 * @param {string} error - Error message
 */
export function handleAuthenticationFailure(error) {
  console.error('Authentication failed:', error)
  // You could show an error message to the user here
}

/**
 * Update UI for authenticated user
 * @param {Object} user - User object
 */
function updateUIForAuthenticatedUser(user) {
  // Update user menu or other UI elements
  const userMenu = document.querySelector('[data-user-menu]')
  if (userMenu) {
    // Show authenticated user menu
    userMenu.classList.remove('hidden')
  }
  
  // Update any other UI elements that should change when user is authenticated
  console.log('UI updated for authenticated user:', user.email)
}

/**
 * Handle logout
 * @returns {Promise<void>}
 */
export async function handleLogout() {
  try {
    const { signOut } = await import('./index.js')
    const result = await signOut()
    
    if (result.error) {
      console.error('Logout error:', result.error)
    } else {
      console.log('User logged out successfully')
      
      // Update UI to reflect logged out state
      updateUIForLoggedOutUser()
    }
  } catch (error) {
    console.error('Error during logout:', error)
  }
}

/**
 * Update UI for logged out user
 */
function updateUIForLoggedOutUser() {
  // Hide authenticated user menu
  const userMenu = document.querySelector('[data-user-menu]')
  if (userMenu) {
    userMenu.classList.add('hidden')
  }
  
  // Show login button or other logged out UI
  const loginBtn = document.querySelector('[data-login-btn]')
  if (loginBtn) {
    loginBtn.classList.remove('hidden')
  }
  
  console.log('UI updated for logged out user')
}

/**
 * Initialize passwordless authentication
 * This should be called when the app starts
 */
export function initializePasswordlessAuth() {
  console.log('Initializing passwordless authentication...')
  
  // Set up authentication state change listener
  setupAuthStateListener()
  
  // Set up protected action handlers
  setupProtectedActionHandlers()
  
  console.log('Passwordless authentication initialized')
}

/**
 * Set up authentication state change listener
 */
function setupAuthStateListener() {
  // Listen for authentication state changes
  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', handleHashChange)
    
    // Check for auth callback on page load
    if (window.location.hash.includes('auth-callback')) {
      handleAuthCallback()
    }
  }
}

/**
 * Handle hash change for auth callbacks
 */
function handleHashChange() {
  if (window.location.hash.includes('auth-callback')) {
    handleAuthCallback()
  }
}

/**
 * Handle authentication callback
 */
async function handleAuthCallback() {
  try {
    const { getCurrentUser } = await import('./index.js')
    const user = await getCurrentUser()
    
    if (user) {
      await handleAuthenticationSuccess(user)
      
      // Clear the hash
      window.history.replaceState({}, document.title, window.location.pathname)
    } else {
      console.error('No user found after auth callback')
    }
  } catch (error) {
    console.error('Error handling auth callback:', error)
  }
}

/**
 * Set up protected action handlers
 */
function setupProtectedActionHandlers() {
  // Example: Set up download button handler
  const downloadBtn = document.getElementById('downloadAllBtn')
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      
      await requireAuthentication('download', async () => {
        // Execute download action
        console.log('Executing download action...')
        // Call your existing download function here
      })
    })
  }
  
  // Example: Set up save button handler
  const saveBtn = document.getElementById('saveStateBtn')
  if (saveBtn) {
    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      
      await requireAuthentication('save', async () => {
        // Execute save action
        console.log('Executing save action...')
        // Call your existing save function here
      })
    })
  }
}

/**
 * Get current session data for merging
 * This should be implemented based on your app's state management
 * @returns {Object} Current session data
 */
export function getCurrentSessionData() {
  // This is a placeholder - implement based on your app's state
  return {
    stems: {}, // Current generated stems
    preferences: {}, // User preferences
    favorites: [], // Favorite stems
    downloads: [] // Download history
  }
}
