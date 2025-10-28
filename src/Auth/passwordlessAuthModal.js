/**
 * Passwordless Authentication Modal
 * Handles email input and user existence checking
 */

import { createClient } from '@supabase/supabase-js'

// Check if Supabase is configured
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let supabase = null
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey)
}

/**
 * Show the passwordless authentication modal
 * @param {string} actionType - Type of action requiring auth (e.g., 'download', 'save')
 * @param {Function} onSuccess - Callback when authentication succeeds
 * @param {Function} onCancel - Callback when modal is cancelled
 */
export function showPasswordlessAuthModal(actionType, onSuccess, onCancel) {
  // Create modal HTML if it doesn't exist
  let modal = document.getElementById('passwordlessAuthModal')
  if (!modal) {
    modal = createPasswordlessAuthModalHTML()
    document.body.appendChild(modal)
  }
  
  // Reset modal state
  resetModalState(modal)
  
  // Show modal
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.style.opacity = '1'
  })
  document.body.style.overflow = 'hidden'
  
  // Set up event listeners
  setupPasswordlessAuthModalListeners(modal, actionType, onSuccess, onCancel)
}

/**
 * Create the passwordless authentication modal HTML
 * @returns {HTMLElement} Modal element
 */
function createPasswordlessAuthModalHTML() {
  const modal = document.createElement('div')
  modal.id = 'passwordlessAuthModal'
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 hidden opacity-0 transition-all duration-300 ease-out'
  
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" id="passwordlessAuthOverlay"></div>
    <div class="relative w-full max-w-md player-surface card-border rounded-2xl p-6 transform scale-95 transition-all duration-300 ease-out">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-medium text-white">Sign In to Continue</h2>
        <button id="passwordlessAuthCloseBtn" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
      </div>
      
      <!-- Email Input State -->
      <div id="emailInputState" class="space-y-4">
        <div class="text-center">
          <p class="text-sm text-white/80 mb-4">
            Enter your email to continue with this action
          </p>
        </div>
        
        <div>
          <label class="block text-sm text-white/80 mb-2">Email Address</label>
          <input 
            type="email" 
            id="passwordlessEmailInput" 
            class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/50 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
            placeholder="your@email.com"
            autocomplete="email"
          />
          <div id="emailError" class="text-red-400 text-xs mt-1 hidden"></div>
        </div>
        
        <div class="flex gap-3 justify-end">
          <button 
            id="passwordlessAuthCancelBtn" 
            class="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button 
            id="passwordlessAuthContinueBtn" 
            class="px-4 py-2 bg-purple-500/80 hover:bg-purple-500 border border-purple-500 rounded-lg transition text-sm font-medium"
          >
            Continue
          </button>
        </div>
      </div>
      
      <!-- Loading State -->
      <div id="loadingState" class="space-y-4 hidden">
        <div class="text-center">
          <div class="w-8 h-8 mx-auto mb-4">
            <i data-lucide="loader-2" class="w-8 h-8 loading-spin text-purple-500"></i>
          </div>
          <p class="text-sm text-white/80">Checking your account...</p>
        </div>
      </div>
      
      <!-- Check Email State (Existing User) -->
      <div id="checkEmailState" class="space-y-4 hidden">
        <div class="text-center">
          <div class="w-16 h-16 mx-auto mb-4 bg-purple-500/20 rounded-full flex items-center justify-center">
            <i data-lucide="mail" class="w-8 h-8 text-purple-500"></i>
          </div>
          <h3 class="text-lg font-medium text-white mb-2">Check Your Email</h3>
          <p class="text-sm text-white/80 mb-4">
            We've sent a confirmation link to <span id="userEmail" class="font-medium text-white"></span>
          </p>
          <p class="text-xs text-white/60">
            Click the link in your email to complete the sign-in process.
          </p>
        </div>
        
        <div class="flex gap-3 justify-center">
          <button 
            id="resendEmailBtn" 
            class="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition text-sm"
          >
            Resend Email
          </button>
          <button 
            id="changeEmailBtn" 
            class="px-4 py-2 bg-purple-500/80 hover:bg-purple-500 border border-purple-500 rounded-lg transition text-sm font-medium"
          >
            Change Email
          </button>
        </div>
      </div>
      
      <!-- Success State (New User) -->
      <div id="successState" class="space-y-4 hidden">
        <div class="text-center">
          <div class="w-16 h-16 mx-auto mb-4 bg-green-500/20 rounded-full flex items-center justify-center">
            <i data-lucide="check" class="w-8 h-8 text-green-500"></i>
          </div>
          <h3 class="text-lg font-medium text-white mb-2">Welcome!</h3>
          <p class="text-sm text-white/80 mb-4">
            Your account has been created and you're now signed in.
          </p>
        </div>
        
        <div class="flex gap-3 justify-center">
          <button 
            id="continueActionBtn" 
            class="px-4 py-2 bg-purple-500/80 hover:bg-purple-500 border border-purple-500 rounded-lg transition text-sm font-medium"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  `
  
  return modal
}

/**
 * Reset modal to initial state
 * @param {HTMLElement} modal - Modal element
 */
function resetModalState(modal) {
  // Hide all states
  const states = ['emailInputState', 'loadingState', 'checkEmailState', 'successState']
  states.forEach(stateId => {
    const state = modal.querySelector(`#${stateId}`)
    if (state) state.classList.add('hidden')
  })
  
  // Show email input state
  const emailState = modal.querySelector('#emailInputState')
  if (emailState) emailState.classList.remove('hidden')
  
  // Clear form
  const emailInput = modal.querySelector('#passwordlessEmailInput')
  if (emailInput) {
    emailInput.value = ''
    emailInput.disabled = false
  }
  
  // Clear errors
  const errorEl = modal.querySelector('#emailError')
  if (errorEl) {
    errorEl.classList.add('hidden')
    errorEl.textContent = ''
  }
  
  // Reset buttons
  const continueBtn = modal.querySelector('#passwordlessAuthContinueBtn')
  if (continueBtn) {
    continueBtn.disabled = false
    continueBtn.textContent = 'Continue'
  }
}

/**
 * Set up event listeners for the modal
 * @param {HTMLElement} modal - Modal element
 * @param {string} actionType - Type of action requiring auth
 * @param {Function} onSuccess - Success callback
 * @param {Function} onCancel - Cancel callback
 */
function setupPasswordlessAuthModalListeners(modal, actionType, onSuccess, onCancel) {
  const overlay = modal.querySelector('#passwordlessAuthOverlay')
  const closeBtn = modal.querySelector('#passwordlessAuthCloseBtn')
  const cancelBtn = modal.querySelector('#passwordlessAuthCancelBtn')
  const continueBtn = modal.querySelector('#passwordlessAuthContinueBtn')
  const resendBtn = modal.querySelector('#resendEmailBtn')
  const changeEmailBtn = modal.querySelector('#changeEmailBtn')
  const continueActionBtn = modal.querySelector('#continueActionBtn')
  const emailInput = modal.querySelector('#passwordlessEmailInput')
  
  // Close modal handlers
  const closeModal = () => {
    modal.style.opacity = '0'
    setTimeout(() => {
      modal.classList.add('hidden')
      document.body.style.overflow = ''
    }, 300)
  }
  
  if (overlay) overlay.addEventListener('click', closeModal)
  if (closeBtn) closeBtn.addEventListener('click', closeModal)
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    closeModal()
    if (onCancel) onCancel()
  })
  
  // Email input validation
  if (emailInput) {
    emailInput.addEventListener('input', () => {
      const errorEl = modal.querySelector('#emailError')
      if (errorEl) {
        errorEl.classList.add('hidden')
        errorEl.textContent = ''
      }
    })
    
    emailInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleEmailSubmit()
      }
    })
  }
  
  // Continue button handler
  if (continueBtn) {
    continueBtn.addEventListener('click', handleEmailSubmit)
  }
  
  // Resend email handler
  if (resendBtn) {
    resendBtn.addEventListener('click', handleResendEmail)
  }
  
  // Change email handler
  if (changeEmailBtn) {
    changeEmailBtn.addEventListener('click', () => {
      resetModalState(modal)
    })
  }
  
  // Continue action handler (for new users)
  if (continueActionBtn) {
    continueActionBtn.addEventListener('click', () => {
      closeModal()
      if (onSuccess) onSuccess()
    })
  }
  
  // Handle email submission
  async function handleEmailSubmit() {
    const email = emailInput?.value?.trim()
    if (!email) {
      showError('Please enter your email address')
      return
    }
    
    if (!isValidEmail(email)) {
      showError('Please enter a valid email address')
      return
    }
    
    // Show loading state
    showLoadingState()
    
    try {
      // Check if user exists
      const userExists = await checkUserExists(email)
      
      if (userExists) {
        // User exists, send confirmation email
        await sendConfirmationEmail(email)
        showCheckEmailState(email)
      } else {
        // New user, create account immediately
        await createNewUserAccount(email)
        showSuccessState()
      }
    } catch (error) {
      console.error('Authentication error:', error)
      showError('Something went wrong. Please try again.')
      showEmailInputState()
    }
  }
  
  // Handle resend email
  async function handleResendEmail() {
    const email = emailInput?.value?.trim()
    if (!email) return
    
    showLoadingState()
    
    try {
      await sendConfirmationEmail(email)
      showCheckEmailState(email)
    } catch (error) {
      console.error('Resend error:', error)
      showError('Failed to resend email. Please try again.')
      showEmailInputState()
    }
  }
  
  // Show error message
  function showError(message) {
    const errorEl = modal.querySelector('#emailError')
    if (errorEl) {
      errorEl.textContent = message
      errorEl.classList.remove('hidden')
    }
  }
  
  // Show loading state
  function showLoadingState() {
    const states = ['emailInputState', 'checkEmailState', 'successState']
    states.forEach(stateId => {
      const state = modal.querySelector(`#${stateId}`)
      if (state) state.classList.add('hidden')
    })
    
    const loadingState = modal.querySelector('#loadingState')
    if (loadingState) loadingState.classList.remove('hidden')
  }
  
  // Show email input state
  function showEmailInputState() {
    const states = ['loadingState', 'checkEmailState', 'successState']
    states.forEach(stateId => {
      const state = modal.querySelector(`#${stateId}`)
      if (state) state.classList.add('hidden')
    })
    
    const emailState = modal.querySelector('#emailInputState')
    if (emailState) emailState.classList.remove('hidden')
  }
  
  // Show check email state
  function showCheckEmailState(email) {
    const states = ['emailInputState', 'loadingState', 'successState']
    states.forEach(stateId => {
      const state = modal.querySelector(`#${stateId}`)
      if (state) state.classList.add('hidden')
    })
    
    const checkEmailState = modal.querySelector('#checkEmailState')
    if (checkEmailState) checkEmailState.classList.remove('hidden')
    
    const userEmailEl = modal.querySelector('#userEmail')
    if (userEmailEl) userEmailEl.textContent = email
  }
  
  // Show success state
  function showSuccessState() {
    const states = ['emailInputState', 'loadingState', 'checkEmailState']
    states.forEach(stateId => {
      const state = modal.querySelector(`#${stateId}`)
      if (state) state.classList.add('hidden')
    })
    
    const successState = modal.querySelector('#successState')
    if (successState) successState.classList.remove('hidden')
  }
}

/**
 * Check if email is valid
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Check if user exists in database
 * @param {string} email - Email to check
 * @returns {Promise<boolean>} True if user exists
 */
async function checkUserExists(email) {
  if (!supabase) {
    throw new Error('Supabase not configured')
  }
  
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', email) // Assuming email is used as ID or we need to check auth.users
      .single()
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw error
    }
    
    return !!data
  } catch (error) {
    console.error('Error checking user existence:', error)
    throw error
  }
}

/**
 * Send confirmation email to existing user
 * @param {string} email - Email to send to
 * @returns {Promise<void>}
 */
async function sendConfirmationEmail(email) {
  if (!supabase) {
    throw new Error('Supabase not configured')
  }
  
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        emailRedirectTo: `${window.location.origin}/#auth-callback`
      }
    })
    
    if (error) {
      throw error
    }
  } catch (error) {
    console.error('Error sending confirmation email:', error)
    throw error
  }
}

/**
 * Create new user account immediately
 * @param {string} email - Email for new user
 * @returns {Promise<void>}
 */
async function createNewUserAccount(email) {
  if (!supabase) {
    throw new Error('Supabase not configured')
  }
  
  try {
    // Generate a random password for the user
    const randomPassword = Math.random().toString(36).slice(-12)
    
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: randomPassword,
      options: {
        emailRedirectTo: `${window.location.origin}/#auth-callback`
      }
    })
    
    if (error) {
      throw error
    }
    
    // The user will be automatically created in the profiles table via trigger
    console.log('New user account created:', data.user?.id)
  } catch (error) {
    console.error('Error creating new user account:', error)
    throw error
  }
}

/**
 * Close the passwordless auth modal
 */
export function closePasswordlessAuthModal() {
  const modal = document.getElementById('passwordlessAuthModal')
  if (modal) {
    modal.style.opacity = '0'
    setTimeout(() => {
      modal.classList.add('hidden')
      document.body.style.overflow = ''
    }, 300)
  }
}
