// Extracted header user menu setup from app.js
import { signOut } from '../Auth/index.js'
import { getCredits } from '../Auth/userProfile.js'
import { getAuthGuard } from '../Auth/authGuard.js'

export function setupUserMenu(){
  // Wait a bit to ensure DOM is fully ready
  setTimeout(() => {
    const btn = document.getElementById('userMenuBtn')
    const menu = document.getElementById('userMenu')
    
    if (!btn || !menu) {
      console.error('❌ User menu elements not found!', {
        userMenuBtn: document.getElementById('userMenuBtn'),
        userMenu: document.getElementById('userMenu')
      })
      return
    }

    // Check authentication state and set initial visibility
    const authGuard = getAuthGuard()
    const isAuthenticated = authGuard.getIsAuthenticated()
    
    // Set initial visibility based on auth state
    updateUserMenuVisibility()
    
    if (!isAuthenticated) {
      console.log('🔒 User not authenticated - showing login button instead of user menu')
      return
    }
  
    // Menu toggle functionality
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const isHidden = menu.classList.contains('hidden')
      if (isHidden) {
        menu.classList.remove('hidden')
        btn.setAttribute('aria-expanded', 'true')
      } else {
        menu.classList.add('hidden')
        btn.setAttribute('aria-expanded', 'false')
      }
    })
    
    document.addEventListener('click', (e) => {
      if (menu.classList.contains('hidden')) return
      const target = e.target
      if (menu.contains(target) || btn.contains(target)) return
      menu.classList.add('hidden')
      btn.setAttribute('aria-expanded', 'false')
    })

    // Set up menu item functionality
    setupMenuItems()
    
    // Set up login button functionality
    setupLoginButton()
    
  }, 100) // Wait 100ms for DOM to be ready
}

/**
 * Set up login button functionality
 */
function setupLoginButton() {
  const loginBtn = document.getElementById('loginBtn')
  
  if (!loginBtn) {
    console.warn('Login button not found')
    return
  }
  
  loginBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    console.log('🔑 Login button clicked')
    
    // Navigate to login page
    if (typeof window.showPage === 'function') {
      window.showPage('login-page')
    } else {
      // Fallback: navigate to login page URL
      window.location.href = '#login-page'
    }
  })
}

/**
 * Set up user menu item functionality
 */
function setupMenuItems() {
  // Library button
  const libraryBtn = document.getElementById('userMenuLibrary')
  if (libraryBtn) {
    libraryBtn.addEventListener('click', () => {
      handleLibraryClick()
    })
  }

  // Account button
  const accountBtn = document.getElementById('userMenuAccount')
  if (accountBtn) {
    accountBtn.addEventListener('click', () => {
      handleAccountClick()
    })
  }

  // Logout button
  const logoutBtn = document.getElementById('userMenuLogout')
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      handleLogoutClick()
    })
  }
}

/**
 * Handle library button click
 */
async function handleLibraryClick() {
  console.log('📚 Library clicked')
  // TODO: Navigate to user's saved sets/library
  // For now, show a placeholder message
  alert('Library feature coming soon!')
}

/**
 * Handle account button click
 */
async function handleAccountClick() {
  console.log('⚙️ Account clicked')
  // TODO: Show account settings modal
  // For now, show a placeholder message
  alert('Account settings coming soon!')
}

/**
 * Handle logout button click
 */
async function handleLogoutClick() {
  console.log('👋 Logout clicked')
  
  try {
    const { error } = await signOut()
    
    if (error) {
      console.error('Logout error:', error.message)
      alert('Error signing out. Please try again.')
      return
    }
    
    console.log('✅ Logout successful')
    // Auth state change will handle redirect to login page
  } catch (error) {
    console.error('Logout exception:', error)
    alert('An unexpected error occurred during logout.')
  }
}

/**
 * Update user menu visibility based on authentication state
 */
export function updateUserMenuVisibility() {
  const userMenuBtn = document.getElementById('userMenuBtn')
  const userMenu = document.getElementById('userMenu')
  const loginBtn = document.getElementById('loginBtn')
  
  if (!userMenuBtn || !userMenu || !loginBtn) {
    console.warn('User menu or login button elements not found')
    return
  }
  
  const authGuard = getAuthGuard()
  const isAuthenticated = authGuard.getIsAuthenticated()
  
  if (isAuthenticated) {
    console.log('🔓 User authenticated - showing user menu, hiding login button')
    // Show user menu button
    userMenuBtn.style.display = 'flex'
    userMenuBtn.classList.remove('hidden')
    // Hide login button
    loginBtn.style.display = 'none'
    loginBtn.classList.add('hidden')
  } else {
    console.log('🔒 User not authenticated - hiding user menu, showing login button')
    // Hide user menu button and close menu
    userMenuBtn.style.display = 'none'
    userMenuBtn.classList.add('hidden')
    userMenu.classList.add('hidden')
    userMenuBtn.setAttribute('aria-expanded', 'false')
    // Show login button
    loginBtn.style.display = 'flex'
    loginBtn.classList.remove('hidden')
  }
}

/**
 * Update user menu with current user info
 * Note: Email comes from auth user object, credits from profile
 */
export async function updateUserMenu() {
  try {
    const user = getAuthGuard().getCurrentUser()
    const creditsElement = document.getElementById('headerCreditsValue')
    const userEmailElement = document.getElementById('userEmail')
    
    if (user) {
      // Update credits
      if (creditsElement) {
        const { credits, error } = await getCredits(user.id)
        
        if (error) {
          console.error('Error fetching credits:', error)
          creditsElement.textContent = '--'
        } else {
          creditsElement.textContent = credits
        }
      }
      
      // Update email from auth user object
      if (userEmailElement) {
        userEmailElement.textContent = user.email || 'User'
      }
    } else {
      // User not logged in
      if (creditsElement) {
        creditsElement.textContent = '--'
      }
      if (userEmailElement) {
        userEmailElement.textContent = 'Guest'
      }
    }
  } catch (error) {
    console.error('Error updating user menu:', error)
  }
}


