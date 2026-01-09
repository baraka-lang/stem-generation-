/**
 * Techno Generator Page Logic
 * Handles guest mode and authentication for techno generator
 */

import { signIn, signUp, signOut, getCurrentSession } from './index.js'
import { getAuthGuard } from './authGuard.js'
import { showLoginModal } from './loginPage.js'

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
  const studioMenu = document.querySelector('[data-anchor-id="studio-menu"]')
  const userMenu = document.getElementById('userMenu')

  // Show user menu button, hide login button
  if (userMenuBtn) {
    userMenuBtn.classList.remove('hidden')
    userMenuBtn.setAttribute('title', `User menu (${user.email})`)
  }
  if (loginBtn) {
    loginBtn.classList.add('hidden')
  }

  if (studioMenu) {
    studioMenu.setAttribute('title', `Likes & Sets (${user.email})`)
  }

  if (userMenu) {
    const existingEmail = userMenu.querySelector('#userEmail')
    if (existingEmail) {
      existingEmail.textContent = user.email
    } else {
      const emailRow = document.createElement('div')
      emailRow.className = 'px-4 py-2 text-xs text-white/70 whitespace-nowrap flex justify-between items-center'
      emailRow.innerHTML = '<span>Email</span><span id="userEmail" class="font-medium"></span>'
      userMenu.insertBefore(emailRow, userMenu.firstChild)
      const emailSpan = userMenu.querySelector('#userEmail')
      if (emailSpan) emailSpan.textContent = user.email
    }
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
      ; (async () => {
        try {
          const { showLoginModal } = await import('./loginPage.js')
          if (typeof showLoginModal === 'function') {
            showLoginModal()
            return
          }
        } catch { }
      })()
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
    showLoginModal()
  })

  document.getElementById('saveModalSignupBtn').addEventListener('click', () => {
    document.body.removeChild(modal)
    showLoginModal()
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

export function setupSelectionPage() {
  try {
    selectionCheckAuthenticationStatus()
  } catch { }
  window.addEventListener('authStateChanged', () => { selectionCheckAuthenticationStatus() })
}

export async function selectionCheckAuthenticationStatus() {
  try {
    const authGuard = getAuthGuard()
    const isAuthenticated = authGuard.getIsAuthenticated()
    const currentUser = authGuard.getCurrentUser()
    const userStatusContainer = document.getElementById('userStatusContainer')
    const loggedInUserMenu = document.getElementById('logedInUserMenu')
    const guestModeNotice = document.getElementById('guestModeNotice')
    if (isAuthenticated && currentUser) {
      renderSelectionAuthenticatedUI(currentUser)
      if (loggedInUserMenu) loggedInUserMenu.classList.remove('hidden')
      if (guestModeNotice) guestModeNotice.classList.add('hidden')
    } else {
      renderSelectionGuestUI()
      if (loggedInUserMenu) loggedInUserMenu.classList.add('hidden')
      if (guestModeNotice) guestModeNotice.classList.remove('hidden')
    }
  } catch { }
}

function renderSelectionAuthenticatedUI(user) {
  const userStatusContainer = document.getElementById('userStatusContainer')
  const loggedInUserMenu = document.getElementById('logedInUserMenu')
  if (!userStatusContainer || !loggedInUserMenu) return

  // Responsive user greeting: only initials or simple welcome on mobile if needed, or hidden
  userStatusContainer.innerHTML = `<div class="flex items-center justify-end me-2 md:me-3"><span class="text-xs md:text-sm text-white/60 hidden md:inline">Welcome, ${user.email}</span></div>`

  loggedInUserMenu.innerHTML = `
    <div class="flex items-center space-x-2 md:space-x-4">
      <button data-likes-menu-toggle data-anchor-id="selection-menu"
        class="w-8 h-8 md:w-9 md:h-9 rounded-full border border-white/10 md:border-white/20 flex items-center justify-center hover:bg-white/10 transition"
        title="Likes &amp; Sets">
        <i data-lucide="memory-stick" class="w-4 h-4 text-white/80"></i>
      </button>
      <button id="helpBtnSel" class="hidden sm:flex w-8 h-8 md:w-auto md:px-2 md:py-1 text-xs rounded-full md:rounded-md border border-white/10 md:border-white/15 hover:bg-white/10 items-center justify-center" title="Help">
        <i data-lucide="help-circle" class="w-4 h-4 text-white/80 sm:mr-1 md:mr-0"></i>
        
      </button>
      <div class="relative">
        <button id="userMenuBtnSel" class="w-8 h-8 md:w-9 md:h-9 rounded-full border border-white/20 bg-white/5 flex items-center justify-center hover:bg-white/10 ring-2 ring-transparent hover:ring-white/10 transition-all" aria-haspopup="true" aria-expanded="false" title="User menu">
          <i data-lucide="user" class="w-4 h-4 md:w-5 md:h-5 text-white"></i>
        </button>
        <div id="userMenuSel" class="absolute right-0 top-full mt-2 w-48 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl hidden z-40 overflow-hidden ring-1 ring-black/50">
          
          <div class="px-4 py-3 text-xs border-b border-white/5 bg-white/5">
            <p class="text-white/50 mb-1">Signed in as</p>
            <p class="text-white font-medium truncate">${user.email}</p>
          </div>

          <div class="px-4 py-2 text-xs text-white/70 whitespace-nowrap flex justify-between items-center bg-purple-500/10 border-b border-white/5">
            <span class="text-purple-300">Credits</span>
            <span id="headerCreditsValue" class="font-bold text-purple-400">100</span>
          </div>
          
          <div class="p-1">
            <button id="userMenuAccountSel" class="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/10 rounded-lg flex items-center gap-2 transition-colors">
              <i data-lucide="settings" class="w-4 h-4 text-white/50"></i>
              Account
            </button>
            <button id="userMenuLogoutSel" class="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg flex items-center gap-2 transition-colors">
              <i data-lucide="log-out" class="w-4 h-4"></i>
              Log out
            </button>
          </div>
        </div>
      </div>
    </div>
  `
  setTimeout(() => { setupSelectionUserMenuDropdown() }, 50)
  setupSelectionHelpButton()
  updateSelectionUserMenuInfo(user)
  try { window.lucide?.createIcons() } catch { }
  ; (async () => {
    try {
      const { initLikesSetsMenu } = await import('../UI/likesSetsMenu.js')
      if (typeof initLikesSetsMenu === 'function') initLikesSetsMenu()
    } catch { }
  })()
}

function renderSelectionGuestUI() {
  const userStatusContainer = document.getElementById('userStatusContainer')
  if (!userStatusContainer) return
  userStatusContainer.innerHTML = `
    <div class="flex items-center space-x-3 md:space-x-4">
      <span class="text-xs md:text-sm text-white/60 hidden sm:block">Guest Mode</span>
      <button id="loginBtnSel" class="px-3 py-1.5 md:px-4 md:py-2 text-xs md:text-sm bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 rounded-lg text-white font-medium transition-all duration-300 hover:scale-105 shadow-md shadow-purple-500/20">
        Login
      </button>
    </div>
  `
  const loginBtn = document.getElementById('loginBtnSel')
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      ; (async () => {
        try {
          const { showLoginModal } = await import('./loginPage.js')
          if (typeof showLoginModal === 'function') {
            showLoginModal()
            return
          }
        } catch { }
      })()
    })
  }
}

function setupSelectionHelpButton() {
  const helpBtn = document.getElementById('helpBtnSel')
  if (helpBtn) {
    helpBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const helpModal = document.getElementById('helpModal')
      if (helpModal) {
        helpModal.classList.remove('hidden')
        requestAnimationFrame(() => { helpModal.style.opacity = '1' })
        document.body.style.overflow = 'hidden'
      }
    })
  }
}

function setupSelectionUserMenuDropdown() {
  setTimeout(() => {
    const userMenuBtn = document.getElementById('userMenuBtnSel')
    const userMenu = document.getElementById('userMenuSel')
    if (!userMenuBtn || !userMenu) return
    const newUserMenuBtn = userMenuBtn.cloneNode(true)
    const newUserMenu = userMenu.cloneNode(true)
    userMenuBtn.parentNode.replaceChild(newUserMenuBtn, userMenuBtn)
    userMenu.parentNode.replaceChild(newUserMenu, userMenu)
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
    const clickOutsideHandler = (e) => {
      if (newUserMenu.classList.contains('hidden')) return
      const target = e.target
      if (newUserMenu.contains(target) || newUserMenuBtn.contains(target)) return
      newUserMenu.classList.add('hidden')
      newUserMenuBtn.setAttribute('aria-expanded', 'false')
    }
    document.addEventListener('click', clickOutsideHandler)
    setupSelectionUserMenuItems()
  }, 100)
}

function setupSelectionUserMenuItems() {
  const libraryBtn = document.getElementById('userMenuLibrary')
  if (libraryBtn) {
    libraryBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      alert('Library feature coming soon!')
    })
  }
  const accountBtn = document.getElementById('userMenuAccountSel')
  if (accountBtn) {
    accountBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      window.location.hash = '#profile'
      setTimeout(() => { if (window.showPage) window.showPage('profile-page') }, 50)
    })
  }
  const logoutBtn = document.getElementById('userMenuLogoutSel')
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      await handleSelectionLogout()
    })
  }
}

async function updateSelectionUserMenuInfo(user) {
  try {
    const creditsElement = document.getElementById('headerCreditsValue')
    if (creditsElement) creditsElement.textContent = '100'
  } catch { }
}

async function handleSelectionLogout() {
  try {
    const { error } = await signOut()
    if (error) return
    await selectionCheckAuthenticationStatus()
  } catch { }
}
