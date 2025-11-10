/**
 * Selection Page Logic
 * Handles guest mode and authentication for genre selection
 */

import { signIn, signUp, signOut, getCurrentSession } from './index.js'
import { getAuthGuard } from './authGuard.js'

/**
 * Initialize selection page functionality
 */
export function setupSelectionPage() {
  // Use setTimeout to ensure DOM is fully ready
  setTimeout(() => {
    // Check authentication status on page load (with small delay to ensure auth guard is ready)
    setTimeout(() => {
      checkAuthenticationStatus()
    }, 200)

    // Listen for auth state changes
    window.addEventListener('authStateChanged', (event) => {
      checkAuthenticationStatus()
    })
  }, 100) // Small delay to ensure DOM is ready
}

/**
 * Check if user is authenticated and update UI
 */
async function checkAuthenticationStatus() {
  const authGuard = getAuthGuard()
  const isAuthenticated = authGuard.getIsAuthenticated()
  const currentUser = authGuard.getCurrentUser()
  
  const userStatusContainer = document.getElementById('userStatusContainer')
  const loggedInUserMenu = document.getElementById('logedInUserMenu')
  const guestModeNotice = document.getElementById('guestModeNotice')


  if (isAuthenticated && currentUser) {
    // User is authenticated - show logged-in user menu, hide guest status
    renderAuthenticatedUI(currentUser)
    if (loggedInUserMenu) loggedInUserMenu.classList.remove('hidden')
    if (guestModeNotice) guestModeNotice.classList.add('hidden')
    
  } else {
    // User is not authenticated (guest mode) - show guest status, hide logged-in menu
    renderGuestUI()
    if (loggedInUserMenu) loggedInUserMenu.classList.add('hidden')
    if (guestModeNotice) guestModeNotice.classList.remove('hidden')
    
  }
}

/**
 * Render authenticated user UI
 */
function renderAuthenticatedUI(user) {
  const userStatusContainer = document.getElementById('userStatusContainer')
  const loggedInUserMenu = document.getElementById('logedInUserMenu')
  
  if (!userStatusContainer || !loggedInUserMenu) return

  // Render user status (simplified for authenticated users)
  userStatusContainer.innerHTML = `
    <div class="flex items-center space-x-4">
      <span class="text-sm text-white/60">Welcome, ${user.email}</span>
    </div>
  `

  // Render user menu with dropdown functionality
  loggedInUserMenu.innerHTML = `
    <div class="flex items-center space-x-4">
      <!-- Help button to open usage info -->
      <button id="helpBtnSel" class="px-2 py-1 text-xs rounded-md border border-white/15 hover:bg-white/10 flex items-center justify-center" title="Help">
        <i data-lucide="help-circle" class="w-4 h-4"></i>
      </button>
      <!-- User menu button: circular avatar icon triggers dropdown -->
      <div class="relative">
        <button id="userMenuBtnSel" class="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center hover:bg-white/10" aria-haspopup="true" aria-expanded="false" title="User menu">
          <i data-lucide="user" class="w-4 h-4"></i>
        </button>
        <!-- Dropdown menu for user actions -->
        <div id="userMenuSel" class="absolute right-0 top-full mt-2 w-40 bg-zinc-800 border border-white/10 rounded-md shadow-lg hidden z-40">
          <div class="px-4 py-2 text-xs text-white/70 whitespace-nowrap flex justify-between items-center">
            <span>Credits</span>
            <span id="headerCreditsValue" class="font-medium">100</span>
          </div>
          <button id="userMenuLibrary" class="w-full text-left px-4 py-2 text-xs hover:bg-white/10">Library</button>
          <button id="userMenuAccountSel" class="w-full text-left px-4 py-2 text-xs hover:bg-white/10">Account</button>
          <button id="userMenuLogoutSel" class="w-full text-left px-4 py-2 text-xs hover:bg-white/10">Log out</button>
        </div>
      </div>
    </div>
  `

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
  const userStatusContainer = document.getElementById('userStatusContainer')
  if (!userStatusContainer) return

  userStatusContainer.innerHTML = `
    <div class="flex items-center space-x-4">
      <span class="text-sm text-white/60">Guest Mode</span>
      <button id="loginBtnSel" class="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 rounded-lg text-white font-medium transition-all duration-300 hover:scale-105">
        Login
      </button>
    </div>
  `

  // Add event listener for the login button
  const loginBtn = document.getElementById('loginBtnSel')
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
  const helpBtn = document.getElementById('helpBtnSel')
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
  const helpModalCloseBtn = document.getElementById('helpModalCloseBtnSel')
  
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
    const userMenuBtn = document.getElementById('userMenuBtnSel')
    const userMenu = document.getElementById('userMenuSel')
    
    
    if (!userMenuBtn || !userMenu) {
        console.error('❌ User menu elements not found!', {
        userMenuBtn: document.getElementById('userMenuBtnSel'),
        userMenu: document.getElementById('userMenuSel')
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
  const accountBtn = document.getElementById('userMenuAccountSel')
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
  const logoutBtn = document.getElementById('userMenuLogoutSel')
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
        <button id="saveModalCancelBtn" class="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition text-sm">
          Cancel
        </button>
      </div>
    </div>
  `
  
  document.body.appendChild(modal)
  
  // Add event listeners
  const goToLogin = () => {
    try { console.log('[saveLoginModal] goToLogin invoked') } catch {}
    if (document.body.contains(modal)) {
      try { console.log('[saveLoginModal] removing modal from DOM') } catch {}
      document.body.removeChild(modal)
    }
    if (window.location.hash === '#login') {
      try { console.log('[saveLoginModal] already at #login, calling showPage directly') } catch {}
      if (window.showPage) {
        window.showPage('login-page')
      }
    } else {
      try { console.log('[saveLoginModal] setting hash to #login (was:', window.location.hash, ')') } catch {}
      window.location.hash = '#login'
    }
    // Fallback to ensure navigation even if hash routing is delayed
    setTimeout(() => {
      try { console.log('[saveLoginModal] fallback showPage check running') } catch {}
      if (window.showPage) {
        try { console.log('[saveLoginModal] calling showPage(\"login-page\")') } catch {}
        window.showPage('login-page')
      }
    }, 50)
  }
  
  const loginBtnEl = modal.querySelector('#saveModalLoginBtn')
  if (loginBtnEl) {
    try { console.log('[saveLoginModal] wiring click for #saveModalLoginBtn') } catch {}
    loginBtnEl.addEventListener('click', (e) => {
      try { console.log('[saveLoginModal] login button clicked', { target: e?.target, time: Date.now(), hash: window.location.hash }) } catch (logErr) {
        try { console.warn('[saveLoginModal] failed to log click', logErr) } catch {}
      }
      document.body.removeChild(modal)
      goToLogin()
      // document.body.removeChild(modal)
      // Additional safety: ensure modal is gone shortly after click (covers routed re-render timing)
      setTimeout(() => {
        if (document.body.contains(modal)) {
          try { console.log('[saveLoginModal] post-click cleanup removing lingering modal') } catch {}
          document.body.removeChild(modal)
        }
      }, 150)
    })
  } else {
    try { console.warn('[saveLoginModal] #saveModalLoginBtn not found inside modal') } catch {}
  }
  
  const cancelBtnEl = modal.querySelector('#saveModalCancelBtn')
  if (cancelBtnEl) {
    cancelBtnEl.addEventListener('click', () => {
      try { console.log('[saveLoginModal] cancel button clicked, removing modal') } catch {}
    document.body.removeChild(modal)
    })
  } else {
    try { console.warn('[saveLoginModal] #saveModalCancelBtn not found inside modal') } catch {}
  }
  
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
        Please check your email and click the confirmation link to download your generated stems.
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
    console.log('Resending confirmation email...')
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
