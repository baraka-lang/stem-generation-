/**
 * Techno Generator Page Logic
 * Handles guest mode and authentication for techno generator
 */

import { signIn, signUp, signOut, getCurrentSession } from './index.js'
import { getAuthGuard } from './authGuard.js'

/**
 * Initialize techno generator page functionality
 */
export function setupTechnoGeneratorPage() {
  // Use setTimeout to ensure DOM is fully ready
  setTimeout(() => {
    // Listen for auth state changes
    window.addEventListener('authStateChanged', (event) => {
      // Only check auth status if techno generator page is visible
      const technoPage = document.getElementById('techno-generator-page')
      if (technoPage && !technoPage.classList.contains('hidden')) {
        checkAuthenticationStatus()
      }
    })

    // Also listen for page changes to check auth when techno page becomes visible
    window.addEventListener('hashchange', () => {
      const technoPage = document.getElementById('techno-generator-page')
      if (technoPage && !technoPage.classList.contains('hidden')) {
        setTimeout(() => {
          checkAuthenticationStatus()
        }, 100)
      }
    })
  }, 100) // Small delay to ensure DOM is ready
}

/**
 * Check if user is authenticated and update UI
 */
export async function checkAuthenticationStatus() {
  const authGuard = getAuthGuard()
  const isAuthenticated = authGuard.getIsAuthenticated()
  const currentUser = authGuard.getCurrentUser()
  
  const userStatusContainer = document.getElementById('userStatusContainer')
  const loggedInUserMenu = document.getElementById('logedInUserMenu')
  const guestModeNotice = document.getElementById('guestModeNotice')

  // Debug logging
  console.log('🔍 Techno Generator Auth Check:', {
    isAuthenticated,
    currentUser: currentUser?.email,
    userStatusContainer: !!userStatusContainer,
    loggedInUserMenu: !!loggedInUserMenu,
    guestModeNotice: !!guestModeNotice,
    technoPageVisible: !document.getElementById('techno-generator-page')?.classList.contains('hidden')
  })

  if (!userStatusContainer) {
    console.error('❌ userStatusContainer not found in techno generator page')
    return
  }
  if (!loggedInUserMenu) {
    console.error('❌ loggedInUserMenu not found in techno generator page')
    return
  }

  if (isAuthenticated && currentUser) {
    // User is authenticated - show logged-in user menu, hide guest status
    renderAuthenticatedUI(currentUser)
    if (guestModeNotice) guestModeNotice.classList.add('hidden')
    
  } else {
    // User is not authenticated (guest mode) - show guest status, hide logged-in menu
    renderGuestUI()
    if (guestModeNotice) guestModeNotice.classList.remove('hidden')
    
  }
}

/**
 * Render authenticated user UI
 */
function renderAuthenticatedUI(user) {
  const userMenuBtn = document.getElementById('userMenuBtn')
  const loginBtn = document.getElementById('loginBtn')
  
  // Show user menu button, hide login button
  if (userMenuBtn) {
    userMenuBtn.classList.remove('hidden')
  }
  if (loginBtn) {
    loginBtn.classList.add('hidden')
  }

  // Setup dropdown functionality (with a small delay to ensure DOM is ready)
  setTimeout(() => {
    setupUserMenuDropdown()
  }, 50)
  
  // Setup help button functionality
  setupHelpButton()
  
  // Update user menu with current user info
  updateUserMenuInfo(user)
}

/**
 * Render guest user UI
 */
function renderGuestUI() {
  const userMenuBtn = document.getElementById('userMenuBtn')
  const loginBtn = document.getElementById('loginBtn')
  
  // Hide user menu button, show login button
  if (userMenuBtn) {
    userMenuBtn.classList.add('hidden')
  }
  if (loginBtn) {
    loginBtn.classList.remove('hidden')
  }

  // Add event listener for the login button
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      window.location.hash = '#login'
      // Fallback: directly show login page if hash change doesn't work
      setTimeout(() => {
        if (window.showPage) {
          window.showPage('login-page')
        }
      }, 50)
    })
  }
}

/**
 * Setup help button functionality
 */
function setupHelpButton() {
  const helpBtn = document.getElementById('helpBtn')
  if (helpBtn) {
    helpBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      showHelpModal()
    })
  }
}

/**
 * Show the help modal
 */
function showHelpModal() {
  const helpModal = document.getElementById('helpModal')
  const helpModalOverlay = document.getElementById('helpModalOverlay')
  const helpModalCloseBtn = document.getElementById('helpModalCloseBtn')
  
  if (!helpModal) {
    return
  }

  // Show the modal
  helpModal.classList.remove('hidden')
  
  // Trigger animation after a small delay
  setTimeout(() => {
    helpModal.classList.remove('opacity-0')
    helpModal.querySelector('.relative').classList.remove('scale-95')
    helpModal.querySelector('.relative').classList.add('scale-100')
  }, 10)

  // Setup close functionality
  const closeModal = () => {
    helpModal.classList.add('opacity-0')
    helpModal.querySelector('.relative').classList.remove('scale-100')
    helpModal.querySelector('.relative').classList.add('scale-95')
    
    setTimeout(() => {
      helpModal.classList.add('hidden')
    }, 300) // Match the transition duration
  }

  // Remove any existing event listeners by cloning elements
  if (helpModalCloseBtn) {
    const newCloseBtn = helpModalCloseBtn.cloneNode(true)
    helpModalCloseBtn.parentNode.replaceChild(newCloseBtn, helpModalCloseBtn)
    
    newCloseBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      closeModal()
    })
  }

  // Close on overlay click
  if (helpModalOverlay) {
    const newOverlay = helpModalOverlay.cloneNode(true)
    helpModalOverlay.parentNode.replaceChild(newOverlay, helpModalOverlay)
    
    newOverlay.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      closeModal()
    })
  }

  // Close on Escape key
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal()
      document.removeEventListener('keydown', handleEscape)
    }
  }
  document.addEventListener('keydown', handleEscape)
}

/**
 * Setup user menu dropdown functionality
 */
function setupUserMenuDropdown() {
  // Wait a bit more to ensure DOM is fully ready
  setTimeout(() => {
    const userMenuBtn = document.getElementById('userMenuBtn')
    const userMenu = document.getElementById('userMenu')
    
    if (!userMenuBtn || !userMenu) {
        console.error('❌ User menu elements not found!', {
        userMenuBtn: document.getElementById('userMenuBtn'),
        userMenu: document.getElementById('userMenu')
      })
      return
    }

    // Clear any existing event listeners
    const newUserMenuBtn = userMenuBtn.cloneNode(true)
    const newUserMenu = userMenu.cloneNode(true)
    userMenuBtn.parentNode.replaceChild(newUserMenuBtn, userMenuBtn)
    userMenu.parentNode.replaceChild(newUserMenu, userMenu)

    // Toggle dropdown on button click
    newUserMenuBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const isHidden = newUserMenu.classList.contains('hidden')
      
      if (isHidden) {
        newUserMenu.classList.remove('hidden')
        newUserMenuBtn.setAttribute('aria-expanded', 'true')
      } else {
        newUserMenu.classList.add('hidden')
        newUserMenuBtn.setAttribute('aria-expanded', 'false')
      }
    })

    // Close dropdown when clicking outside
    const clickOutsideHandler = (e) => {
      if (newUserMenu.classList.contains('hidden')) return
      
      const target = e.target
      if (newUserMenu.contains(target) || newUserMenuBtn.contains(target)) return
      
      newUserMenu.classList.add('hidden')
      newUserMenuBtn.setAttribute('aria-expanded', 'false')
    }
    
    document.addEventListener('click', clickOutsideHandler)

    // Setup menu item functionality
    setupUserMenuItems()
    
  }, 100)
}

/**
 * Setup user menu item functionality
 */
function setupUserMenuItems() {
  
  // Library button
  const libraryBtn = document.getElementById('userMenuLibrary')
  if (libraryBtn) {
    libraryBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      // TODO: Navigate to user's saved sets/library
      alert('Library feature coming soon!')
    })
  }

  // Account button
  const accountBtn = document.getElementById('userMenuAccount')
  if (accountBtn) {
    accountBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      // Navigate to profile page
      window.location.hash = '#profile'
      // Fallback: directly show profile page if hash change doesn't work
      setTimeout(() => {
        if (window.showPage) {
          window.showPage('profile-page')
        }
      }, 50)
    })
  }

  // Logout button
  const logoutBtn = document.getElementById('userMenuLogout')
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      await handleLogout()
    })
  }
}

/**
 * Update user menu with current user info
 */
async function updateUserMenuInfo(user) {
  try {
    // Update credits (you can implement getCredits function)
    const creditsElement = document.getElementById('headerCreditsValue')
    if (creditsElement) {
      // For now, show a default value. You can integrate with your credits system
      creditsElement.textContent = '100'
    }
  } catch (error) {
    console.error('Error updating user menu info:', error)
  }
}

/**
 * Handle user logout
 */
async function handleLogout() {
  try {
    const { error } = await signOut()
    if (error) {
      console.error('Logout error:', error)
      return
    }
    
    console.log('👋 User logged out successfully')
    // Update UI to guest mode
    await checkAuthenticationStatus()
  } catch (error) {
    console.error('Logout exception:', error)
  }
}

/**
 * Check if user can save (requires authentication)
 * @returns {Promise<boolean>} True if user can save
 */
export async function canUserSave() {
  const authGuard = getAuthGuard()
  return authGuard.getIsAuthenticated()
}

/**
 * Check if user can download (requires email confirmation)
 * @returns {Promise<boolean>} True if user can download
 */
export async function canUserDownload() {
  const authGuard = getAuthGuard()
  const currentUser = authGuard.getCurrentUser()
  return !!(authGuard.getIsAuthenticated() && currentUser && currentUser.email_confirmed_at)
}

/**
 * Show login modal when user tries to save without authentication
 */
export function showSaveLoginModal() {
  // Create a modal for save-triggered login
  const modal = document.createElement('div')
  modal.id = 'saveLoginModal'
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm'
  
  modal.innerHTML = `
    <div class="relative w-full max-w-md player-surface card-border rounded-2xl p-6 transform scale-95 transition-all duration-300 ease-out">
      <h2 class="text-xl font-medium text-white mb-4">Save Your Work</h2>
      <p class="text-sm text-white/80 mb-6">
        Create an account or login to save your generated stems and access them later.
      </p>
      
      <div class="flex gap-3">
        <button id="saveModalLoginBtn" class="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition text-sm">
          Login
        </button>
        <button id="saveModalSignupBtn" class="flex-1 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 rounded-lg text-sm font-medium">
          Sign Up
        </button>
        <button id="saveModalCancelBtn" class="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition text-sm">
          Cancel
        </button>
      </div>
    </div>
  `
  
  document.body.appendChild(modal)
  
  // Add event listeners
  document.getElementById('saveModalLoginBtn').addEventListener('click', () => {
    document.body.removeChild(modal)
    window.location.hash = '#login'
  })
  
  document.getElementById('saveModalSignupBtn').addEventListener('click', () => {
    document.body.removeChild(modal)
    window.location.hash = '#login'
  })
  
  document.getElementById('saveModalCancelBtn').addEventListener('click', () => {
    document.body.removeChild(modal)
  })
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal)
    }
  })
}

/**
 * Show download restriction modal when user tries to download without email confirmation
 */
export function showDownloadRestrictionModal() {
  const modal = document.createElement('div')
  modal.id = 'downloadRestrictionModal'
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm'
  
  modal.innerHTML = `
    <div class="relative w-full max-w-md player-surface card-border rounded-2xl p-6 transform scale-95 transition-all duration-300 ease-out">
      <h2 class="text-xl font-medium text-white mb-4">Email Confirmation Required</h2>
      <p class="text-sm text-white/80 mb-6">
        Please confirm your email address to download stems. Check your inbox for a confirmation link.
      </p>
      
      <div class="flex gap-3">
        <button id="downloadModalResendBtn" class="flex-1 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 rounded-lg text-sm font-medium">
          Resend Email
        </button>
        <button id="downloadModalCancelBtn" class="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition text-sm">
          Cancel
        </button>
      </div>
    </div>
  `
  
  document.body.appendChild(modal)
  
  // Add event listeners
  document.getElementById('downloadModalResendBtn').addEventListener('click', async () => {
    // TODO: Implement resend confirmation email
    alert('Resend confirmation email feature coming soon!')
    document.body.removeChild(modal)
  })
  
  document.getElementById('downloadModalCancelBtn').addEventListener('click', () => {
    document.body.removeChild(modal)
  })
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal)
    }
  })
}