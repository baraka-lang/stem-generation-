/**
 * Authentication Guard Module
 * Protects routes and ensures user authentication
 */

import { getCurrentUser, isAuthenticated, onAuthStateChange } from './index.js'

/**
 * Auth state management
 */
class AuthGuard {
  constructor() {
    this.currentUser = null
    this.isAuthenticated = false
    this.authListeners = []
    this.isInitialized = false
  }

  /**
   * Initialize the auth guard
   */
  async initialize() {
    if (this.isInitialized) return

    // console.log('🛡️ Initializing auth guard...')

    try {
      // Check if Supabase is configured
      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
        console.warn('⚠️ Supabase environment variables not configured - running in demo mode')
        this.currentUser = null
        this.isAuthenticated = false
        this.isInitialized = true
        return
      }

      // Get current user (this may return null if no session, which is normal)
      this.currentUser = await getCurrentUser()
      this.isAuthenticated = this.currentUser !== null

      // Listen for auth state changes
      this.unsubscribe = onAuthStateChange((event, session) => {
        this.handleAuthStateChange(event, session)
      })

      this.isInitialized = true
    } catch (error) {
      // Fallback to unauthenticated state
      this.currentUser = null
      this.isAuthenticated = false
      this.isInitialized = true
    }
  }

  /**
   * Handle authentication state changes
   */
  handleAuthStateChange(event, session) {

    const wasAuthenticated = this.isAuthenticated
    const newUser = session?.user || null
    const newIsAuthenticated = newUser !== null

    // Only process significant auth state changes to prevent unnecessary reloads
    const isSignificantChange = 
      event === 'SIGNED_IN' || 
      event === 'SIGNED_OUT' || 
      (wasAuthenticated !== newIsAuthenticated) ||
      (this.currentUser?.id !== newUser?.id)

    if (!isSignificantChange) {
      return
    }

    this.currentUser = newUser
    this.isAuthenticated = newIsAuthenticated

    // Notify listeners only for significant changes
    this.authListeners.forEach(callback => {
      try {
        callback(event, session, this.currentUser)
      } catch (error) {
      }
    })

    // Handle sign out
    if (event === 'SIGNED_OUT' && wasAuthenticated) {
      this.handleSignOut()
    }

    // Handle sign in
    if (event === 'SIGNED_IN' && !wasAuthenticated) {
      this.handleSignIn()
    }
  }

  /**
   * Handle user sign in
   */
  handleSignIn() {
    // Don't redirect automatically - let the app handle navigation
    // The app's handleAuthStateChange will handle the navigation
  }

  /**
   * Handle user sign out
   */
  handleSignOut() {
    // Don't redirect automatically - let the app handle navigation
    // The app's handleAuthStateChange will handle the navigation
  }

  /**
   * Add auth state change listener
   */
  addAuthListener(callback) {
    this.authListeners.push(callback)
    
    // Return unsubscribe function
    return () => {
      const index = this.authListeners.indexOf(callback)
      if (index > -1) {
        this.authListeners.splice(index, 1)
      }
    }
  }

  /**
   * Check if user is authenticated
   */
  async checkAuth() {
    const authenticated = await isAuthenticated()
    this.isAuthenticated = authenticated
    this.currentUser = authenticated ? await getCurrentUser() : null
    return authenticated
  }

  /**
   * Require authentication before executing a function
   */
  async requireAuth(callback) {
    const authenticated = await this.checkAuth()
    


    try {
      await callback(this.currentUser)
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Get current user
   */
  getCurrentUser() {
    return this.currentUser
  }

  /**
   * Check if authenticated
   */
  getIsAuthenticated() {
    return this.isAuthenticated
  }

  /**
   * Redirect to a specific page
   */
  redirectToPage(pageId) {
    // Use the existing showPage function if available
    if (typeof window.showPage === 'function') {
      window.showPage(pageId)
    } else {
    }
  }

  /**
   * Cleanup auth guard
   */
  cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    this.authListeners = []
    this.isInitialized = false
  }
}

// Create singleton instance
const authGuard = new AuthGuard()

/**
 * Initialize authentication guard
 */
export async function initializeAuthGuard() {
  await authGuard.initialize()
  return authGuard.isAuthenticated
}

/**
 * Get the auth guard instance
 */
export function getAuthGuard() {
  return authGuard
}

/**
 * Require authentication before executing a function
 */
export async function requireAuth(callback) {
  return await authGuard.requireAuth(callback)
}

/**
 * Check if user is authenticated
 */
export async function checkAuth() {
  return await authGuard.checkAuth()
}

/**
 * Get current user from auth guard
 */
export function getCurrentUserFromAuthGuard() {
  return authGuard.getCurrentUser()
}

/**
 * Add auth state change listener
 */
export function addAuthListener(callback) {
  return authGuard.addAuthListener(callback)
}

/**
 * Redirect to login page if not authenticated
 */
// export async function redirectIfNotAuthenticated() {
//   const authenticated = await checkAuth()
//   if (!authenticated) {
//     authGuard.redirectToPage('login-page')
//     return false
//   }
//   return true
// }

/**
 * Redirect to selection page if authenticated
 */
// export async function redirectIfAuthenticated() {
//   const authenticated = await checkAuth()
//   if (authenticated) {
//     authGuard.redirectToPage('selection-page')
//     return true
//   }
//   return false
// }

// Export default
export default authGuard
