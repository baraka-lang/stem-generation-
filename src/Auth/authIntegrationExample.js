/**
 * Authentication Integration Example
 * Shows how to integrate passwordless authentication with the existing app
 */

import { requireAuthentication, initializePasswordlessAuth } from './passwordlessAuthService.js'

/**
 * Example: Integrate with existing download functionality
 * Replace existing download button handlers with this
 */
export function integrateDownloadWithAuth() {
  // Find the download button (adjust selector as needed)
  const downloadBtn = document.getElementById('downloadAllBtn')
  if (downloadBtn) {
    // Remove existing event listeners
    downloadBtn.replaceWith(downloadBtn.cloneNode(true))
    const newDownloadBtn = document.getElementById('downloadAllBtn')
    
    // Add new event listener with authentication
    newDownloadBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      
      await requireAuthentication('download', async () => {
        // Execute the original download functionality
        console.log('User authenticated, proceeding with download...')
        
        // Call your existing download function here
        // For example:
        // await downloadAllActiveStems()
      })
    })
  }
}

/**
 * Example: Integrate with existing save functionality
 */
export function integrateSaveWithAuth() {
  const saveBtn = document.getElementById('saveStateBtn')
  if (saveBtn) {
    saveBtn.replaceWith(saveBtn.cloneNode(true))
    const newSaveBtn = document.getElementById('saveStateBtn')
    
    newSaveBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      
      await requireAuthentication('save', async () => {
        console.log('User authenticated, proceeding with save...')
        
        // Call your existing save function here
        // For example:
        // await openSaveSetModal()
      })
    })
  }
}

/**
 * Example: Integrate with existing user menu
 */
export function integrateUserMenuWithAuth() {
  // Add authentication status to user menu
  const userMenu = document.querySelector('[data-user-menu]')
  if (userMenu) {
    // Add login/logout functionality
    const loginBtn = userMenu.querySelector('[data-login-btn]')
    const logoutBtn = userMenu.querySelector('[data-logout-btn]')
    
    if (loginBtn) {
      loginBtn.addEventListener('click', async () => {
        await requireAuthentication('login', () => {
          console.log('User logged in')
        })
      })
    }
    
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        const { handleLogout } = await import('./passwordlessAuthService.js')
        await handleLogout()
      })
    }
  }
}

/**
 * Example: Initialize authentication integration
 * Call this function when your app starts
 */
export function initializeAuthIntegration() {
  console.log('Initializing authentication integration...')
  
  // Initialize passwordless auth service
  initializePasswordlessAuth()
  
  // Integrate with existing functionality
  integrateDownloadWithAuth()
  integrateSaveWithAuth()
  integrateUserMenuWithAuth()
  
  console.log('Authentication integration initialized')
}

/**
 * Example: Add authentication to any action
 * Use this pattern for any action that requires authentication
 */
export function addAuthToAction(actionName, actionFunction) {
  return async function(...args) {
    await requireAuthentication(actionName, async () => {
      await actionFunction(...args)
    })
  }
}

// Example usage:
// const protectedDownload = addAuthToAction('download', downloadAllStems)
// const protectedSave = addAuthToAction('save', saveCurrentState)
