/**
 * Login Page Logic
 * Handles login form interactions and authentication
 */

import { signIn, signUp, resetPassword } from './index.js'
import { initializeUserProfile } from './userProfile.js'

/**
 * Initialize login page functionality
 */
/**
 * Validate password in real-time and update visual indicators
 */
function validatePassword() {
  const passwordInput = document.getElementById('signupPassword')
  const confirmPasswordInput = document.getElementById('signupConfirmPassword')

  // Early return if input elements don't exist
  if (!passwordInput || !confirmPasswordInput) {
    return false
  }

  const password = passwordInput.value || ''
  const confirmPassword = confirmPasswordInput.value || ''

  // Get requirement elements
  const lengthEl = document.getElementById('login-password-length-requirement')
  const lowercaseEl = document.getElementById('login-password-lowercase-requirement')
  const uppercaseEl = document.getElementById('login-password-uppercase-requirement')
  const numberEl = document.getElementById('login-password-number-requirement')

  const signupFormContainer = document.getElementById('signupFormContainer')

  // Only proceed if all elements are found
  if (!lengthEl || !lowercaseEl || !uppercaseEl || !numberEl) {
    return false
  }

  // Check requirements
  const hasMinLength = password.length >= 6
  const hasLowercase = /[a-z]/.test(password)
  const hasUppercase = /[A-Z]/.test(password)
  const hasNumber = /[0-9]/.test(password)

  // Update visual indicators immediately
  updateRequirementIndicator(lengthEl, hasMinLength)
  updateRequirementIndicator(lowercaseEl, hasLowercase)
  updateRequirementIndicator(uppercaseEl, hasUppercase)
  updateRequirementIndicator(numberEl, hasNumber)

  // Check if password is valid
  const isValid = hasMinLength && hasLowercase && hasUppercase && hasNumber
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0

  // Update password match indicator
  const passwordMatchEl = document.getElementById('login-password-match-requirement')
  if (passwordMatchEl) {
    if (confirmPassword.length > 0) {
      updateRequirementIndicator(passwordMatchEl, passwordsMatch)
      passwordMatchEl.classList.remove('hidden')
    } else {
      passwordMatchEl.classList.add('hidden')
    }
  }

  // Update submit button state
  const signupSubmitBtn = document.getElementById('signupSubmitBtn')
  if (signupSubmitBtn) {
    signupSubmitBtn.disabled = !isValid || !passwordsMatch
  }

  return isValid && passwordsMatch
}

/**
 * Update visual indicator for password requirement
 */
function updateRequirementIndicator(element, isValid) {
  if (!element) {
    console.warn('updateRequirementIndicator: element not found')
    return
  }


  // Find the icon element - Lucide converts i elements to svg elements
  let icon = element.querySelector('svg[data-lucide]')
  if (!icon) {
    // Try finding any svg element as fallback
    icon = element.querySelector('svg')
  }
  if (!icon) {
    // Try finding i element as fallback (in case Lucide hasn't converted yet)
    icon = element.querySelector('i[data-lucide]')
  }
  if (!icon) {
    // Last resort - any i element
    icon = element.querySelector('i')
  }

  if (!icon) {
    return
  }

  // Update the element's visual state
  if (isValid) {
    // Valid - green checkmark
    element.className = 'flex items-center text-xs text-green-400'
    icon.setAttribute('data-lucide', 'check')
    icon.setAttribute('class', 'lucide lucide-check w-3 h-3 mr-2')
  } else {
    // Invalid - red X
    element.className = 'flex items-center text-xs text-red-400'
    icon.setAttribute('data-lucide', 'x')
    icon.setAttribute('class', 'lucide lucide-x w-3 h-3 mr-2')
  }

  // Update Lucide icons safely using global safe function
  if (window.safeCreateIcons) {
    const success = window.safeCreateIcons()
    if (!success) {
      // Fallback: manually set the icon classes if Lucide fails
      const icon = element.querySelector('i[data-lucide]')
      if (icon) {
        icon.className = isValid ? 'lucide lucide-check w-3 h-3 mr-2' : 'lucide lucide-x w-3 h-3 mr-2'
      }
    }
  } else {
    // Fallback: manually set the icon classes if Lucide is not available
    const icon = element.querySelector('i[data-lucide]')
    if (icon) {
      icon.className = isValid ? 'lucide lucide-check w-3 h-3 mr-2' : 'lucide lucide-x w-3 h-3 mr-2'
    }
  }
}

/**
 * Setup password toggle functionality for all password fields
 * Note: This function is kept for compatibility but actual toggles are handled by event delegation
 */
function setupPasswordToggles() {
  console.log('Password toggles are handled by event delegation - no direct setup needed')
}

export function setupLoginPage() {

  // Get form elements
  const loginForm = document.getElementById('loginForm')
  const loginBtn = document.getElementById('loginBtn')
  const loginBtnText = document.getElementById('loginBtnText')
  const loginBtnSpinner = document.getElementById('loginBtnSpinner')

  const signUpBtn = document.getElementById('signUpBtn')
  const forgotPasswordBtn = document.getElementById('forgotPasswordBtn')

  const errorMessage = document.getElementById('loginErrorMessage')
  const errorText = document.getElementById('loginErrorText')
  const successMessage = document.getElementById('loginSuccessMessage')
  const successText = document.getElementById('loginSuccessText')

  // Form containers
  const loginFormContainer = document.getElementById('loginFormContainer')
  const signupFormContainer = document.getElementById('signupFormContainer')

  // Signup form elements
  const signupForm = document.getElementById('signupForm')
  const signupSubmitBtn = document.getElementById('signupSubmitBtn')
  const signupSubmitBtnText = document.getElementById('signupSubmitBtnText')
  const signupSubmitBtnSpinner = document.getElementById('signupSubmitBtnSpinner')
  const backToLoginBtn = document.getElementById('backToLoginBtn')

  const signupErrorMessage = document.getElementById('signupErrorMessage')
  const signupErrorText = document.getElementById('signupErrorText')
  const signupSuccessMessage = document.getElementById('signupSuccessMessage')
  const signupSuccessText = document.getElementById('signupSuccessText')

  // Reset password modal elements
  const forgotPasswordModal = document.getElementById('forgotPasswordModal')
  const resetPasswordForm = document.getElementById('forgotPasswordForm')
  const resetCancelBtn = document.getElementById('resetCancelBtn')
  const resetSubmitBtn = document.getElementById('forgotPasswordSubmitBtn')
  const resetBtnText = document.getElementById('resetBtnText')
  const resetBtnSpinner = document.getElementById('resetBtnSpinner')

  const resetErrorMessage = document.getElementById('resetErrorMessage')
  const resetErrorText = document.getElementById('resetErrorText')
  const resetSuccessMessage = document.getElementById('resetSuccessMessage')
  const resetSuccessText = document.getElementById('resetSuccessText')

  if (!loginForm || !loginBtn) {
    console.warn('Login form elements not found')
    return
  }

  // Hide all messages initially
  hideMessages()

  // Initialize reset password button as disabled
  if (resetSubmitBtn) {
    resetSubmitBtn.disabled = true
  }

  // Check if Supabase is configured and show demo mode notice
  checkSupabaseConfiguration()

  // Login form submission
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    await handleLogin()
  })

  // Sign up button - show signup form
  if (signUpBtn) {
    signUpBtn.addEventListener('click', () => {
      showSignupForm()
    })
  }

  // Back to login button
  if (backToLoginBtn) {
    backToLoginBtn.addEventListener('click', () => {
      showLoginForm()
    })
  }

  // Signup form submission
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      await handleSignUp()
    })
  }

  // Real-time password validation - use event delegation
  document.addEventListener('input', (e) => {
    if (e.target.id === 'signupPassword' || e.target.id === 'signupConfirmPassword') {
      validatePassword()
    }
  })

  // Password toggle functionality - use event delegation for reliability
  setupPasswordToggles()

  // Set up event delegation for all password toggles
  document.addEventListener('click', (e) => {
    // Login password toggle
    const loginToggleBtn = e.target.closest('#toggleLoginPasswordss')
    if (loginToggleBtn) {
      e.preventDefault()
      e.stopPropagation()


      const loginPasswordInput = document.getElementsByClassName('loginPasswordss')[0]
      const isPassword = loginPasswordInput.type === 'password'
      loginPasswordInput.type = isPassword ? 'text' : 'password'
      loginToggleBtn.style.color = 'cyan'
      
      return
    }

    // Signup password toggle
    const signupToggleBtn = e.target.closest('#toggleSignupPasswordSignupPage')
    if (signupToggleBtn) {
      e.preventDefault()
      e.stopPropagation()
      console.log('Signup password toggle clicked')

      const signupPasswordInput = document.getElementById('signupPassword')
      const signupEyeIcon = document.getElementById('signupEyeIcon')
      const signupEyeOffIcon = document.getElementById('signupEyeOffIcon')

      if (signupPasswordInput && signupEyeIcon && signupEyeOffIcon) {
        const isPassword = signupPasswordInput.type === 'password'
        signupPasswordInput.type = isPassword ? 'text' : 'password'
        signupEyeIcon.classList.toggle('hidden', !isPassword)
        signupEyeOffIcon.classList.toggle('hidden', isPassword)
        console.log('Signup password toggled, new type:', signupPasswordInput.type)

        // Refresh Lucide icons after toggling
          if (window.safeCreateIcons) {
            window.safeCreateIcons()
          }
      } else {
        console.error('Signup password toggle elements not found')
      }
      return
    }

    // Signup confirm password toggle
    const confirmToggleBtn = e.target.closest('#toggleSignupConfirmPasswordSignupPage')
    if (confirmToggleBtn) {
      e.preventDefault()
      e.stopPropagation()
      console.log('Signup confirm password toggle clicked')

      const confirmPasswordInput = document.getElementById('signupConfirmPassword')
      const confirmEyeIcon = document.getElementById('confirmEyeIcon')
      const confirmEyeOffIcon = document.getElementById('confirmEyeOffIcon')

      if (confirmPasswordInput && confirmEyeIcon && confirmEyeOffIcon) {
        const isPassword = confirmPasswordInput.type === 'password'
        confirmPasswordInput.type = isPassword ? 'text' : 'password'
        confirmEyeIcon.classList.toggle('hidden', !isPassword)
        confirmEyeOffIcon.classList.toggle('hidden', isPassword)
        console.log('Signup confirm password toggled, new type:', confirmPasswordInput.type)

        // Refresh Lucide icons after toggling
          if (window.safeCreateIcons) {
            window.safeCreateIcons()
          }
      } else {
        console.error('Signup confirm password toggle elements not found')
      }
      return
    }
  })

  // Forgot password button
  if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener('click', () => {
      showForgotPasswordModal()
    })
  }

  // Reset password form submission
  if (resetPasswordForm) {
    resetPasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      await handleResetPassword()
    })
  }

  // Real-time validation for reset password email field
  const resetEmailInput = document.getElementById('resetEmail')
  if (resetEmailInput) {
    resetEmailInput.addEventListener('input', () => {
      const email = resetEmailInput.value.trim()
      const isValidEmail = email.length > 0 && email.includes('@')

      if (resetSubmitBtn) {
        resetSubmitBtn.disabled = !isValidEmail
      }
    })
  }

  // Reset password modal close
  if (resetCancelBtn) {
    resetCancelBtn.addEventListener('click', () => {
      hideForgotPasswordModal()
    })
  }

  // Close modal on overlay click
  const overlay = document.getElementById('forgotPasswordOverlay')
  if (overlay) {
    overlay.addEventListener('click', () => {
      hideForgotPasswordModal()
    })
  }

  /**
   * Handle login form submission
   */
  async function handleLogin() {
    const email = document.getElementById('loginEmail')?.value?.trim()
    const password = document.getElementById('loginPassword')?.value

    if (!email || !password) {
      showError('Please fill in all fields')
      return
    }

    setLoading(true)
    hideMessages()

    try {
      const { user, error } = await signIn(email, password)

      if (error) {
        showError(getErrorMessage(error))
        return
      }

      if (user) {
        // Initialize user profile
        await initializeUserProfile(user)

        showSuccess('Login successful! Redirecting...')


        document.location.href = '/'
      }
    } catch (error) {
      console.error('Login error:', error)
      showError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Handle sign up
   */
  async function handleSignUp() {
    const email = document.getElementById('signupEmail')?.value?.trim()
    const password = document.getElementById('signupPassword')?.value
    const fullName = document.getElementById('fullName')?.value
    const confirmPassword = document.getElementById('signupConfirmPassword')?.value

    if (!email || !password || !confirmPassword || !fullName) {
      showSignupError('Please fill in all fields')
      return
    }

    if (password !== confirmPassword) {
      showSignupError('Passwords do not match')
      return
    }

    // Check password requirements using our validation function
    if (!validatePassword()) {
      showSignupError('Password does not meet all requirements')
      return
    }

    setSignupLoading(true)
    hideSignupMessages()

    try {
      const { user, error, isNewUser } = await signUp(email, password, fullName)

      if (error) {
        showSignupError(getErrorMessage(error))
        return
      }

      if (user) {
        if (isNewUser) {
          showSignupSuccess('Account created! Please check your email to verify your account.')
          
          // Clear form only on successful new user creation
          document.getElementById('signupEmail').value = ''
          document.getElementById('fullName').value = ''
          document.getElementById('signupPassword').value = ''
          document.getElementById('signupConfirmPassword').value = ''
        } else {
          // This case should actually be handled as an error, not success
          showSignupError('An account with this email already exists. Please try logging in instead.')
        }
      }
    } catch (error) {
      console.error('Sign up error:', error)
      showSignupError('An unexpected error occurred')
    } finally {
      setSignupLoading(false)
    }
  }

  /**
   * Handle password reset
   */
  async function handleResetPassword() {
    const email = document.getElementById('resetEmail')?.value?.trim()

    if (!email) {
      showResetError('Please enter your email address')
      return
    }

    setResetLoading(true)
    hideResetMessages()

    try {
      const { error } = await resetPassword(email)

      if (error) {
        showResetError(getErrorMessage(error))
        return
      }

      showResetSuccess('Password reset email sent! Check your inbox.')

      // Close modal after success
      setTimeout(() => {
        hideForgotPasswordModal()
      }, 2000)
    } catch (error) {
      console.error('Reset password error:', error)
      showResetError('An unexpected error occurred')
    } finally {
      setResetLoading(false)
    }
  }

  /**
   * Show forgot password modal
   */
  function showForgotPasswordModal() {
    if (forgotPasswordModal) {
      forgotPasswordModal.classList.remove('hidden')
      setTimeout(() => {
        forgotPasswordModal.classList.remove('opacity-0')
        forgotPasswordModal.querySelector('.transform').classList.remove('scale-95')
      }, 10)
    }
  }

  /**
   * Hide forgot password modal
   */
  function hideForgotPasswordModal() {
    if (forgotPasswordModal) {
      forgotPasswordModal.classList.add('opacity-0')
      forgotPasswordModal.querySelector('.transform').classList.add('scale-95')
      setTimeout(() => {
        forgotPasswordModal.classList.add('hidden')
      }, 300)
    }
  }

  /**
   * Show login form and hide signup form
   */
  function showLoginForm() {
    if (loginFormContainer) loginFormContainer.classList.remove('hidden')
    if (signupFormContainer) signupFormContainer.classList.add('hidden')
    hideMessages()
  }

  /**
   * Show signup form and hide login form
   */
  function showSignupForm() {
    if (signupFormContainer) signupFormContainer.classList.remove('hidden')
    if (loginFormContainer) loginFormContainer.classList.add('hidden')
    hideSignupMessages()

    // Initialize password validation when signup form is shown
    setTimeout(() => {
      validatePassword()
    }, 50)

    // Password toggles are now handled by event delegation - no setup needed
  }

  /**
   * Set loading state for login form
   */
  function setLoading(isLoading) {
    if (loginBtn) {
      loginBtn.disabled = isLoading
      if (loginBtnText) loginBtnText.textContent = isLoading ? 'Signing in...' : 'Enter Studio'
      if (loginBtnSpinner) {
        loginBtnSpinner.classList.toggle('hidden', !isLoading)
      }
    }
  }

  /**
   * Set loading state for signup form
   */
  function setSignupLoading(isLoading) {
    if (signupSubmitBtn) {
      signupSubmitBtn.disabled = isLoading
      if (signupSubmitBtnText) signupSubmitBtnText.textContent = isLoading ? 'Creating Account...' : 'Create Account'
      if (signupSubmitBtnSpinner) {
        signupSubmitBtnSpinner.classList.toggle('hidden', !isLoading)
      }
    }
  }

  /**
   * Set loading state for reset form
   */
  function setResetLoading(isLoading) {
    if (resetSubmitBtn) {
      resetSubmitBtn.disabled = isLoading
      if (resetBtnText) resetBtnText.textContent = isLoading ? 'Sending...' : 'Send Reset Link'
      if (resetBtnSpinner) {
        resetBtnSpinner.classList.toggle('hidden', !isLoading)
      }
    }
  }

  /**
   * Show error message
   */
  function showError(message) {
    if (errorText) errorText.textContent = message
    if (errorMessage) errorMessage.classList.remove('hidden')
    if (successMessage) successMessage.classList.add('hidden')
  }

  /**
   * Show success message
   */
  function showSuccess(message) {
    if (successText) successText.textContent = message
    if (successMessage) successMessage.classList.remove('hidden')
    if (errorMessage) errorMessage.classList.add('hidden')
  }

  /**
   * Show reset error message
   */
  function showResetError(message) {
    if (resetErrorText) resetErrorText.textContent = message
    if (resetErrorMessage) resetErrorMessage.classList.remove('hidden')
    if (resetSuccessMessage) resetSuccessMessage.classList.add('hidden')
  }

  /**
   * Show reset success message
   */
  function showResetSuccess(message) {
    if (resetSuccessText) resetSuccessText.textContent = message
    if (resetSuccessMessage) resetSuccessMessage.classList.remove('hidden')
    if (resetErrorMessage) resetErrorMessage.classList.add('hidden')
  }

  /**
   * Hide all messages
   */
  function hideMessages() {
    if (errorMessage) errorMessage.classList.add('hidden')
    if (successMessage) successMessage.classList.add('hidden')
  }

  /**
   * Show signup error message
   */
  function showSignupError(message) {
    if (signupErrorText) signupErrorText.textContent = message
    if (signupErrorMessage) signupErrorMessage.classList.remove('hidden')
    if (signupSuccessMessage) signupSuccessMessage.classList.add('hidden')
  }

  /**
   * Show signup success message
   */
  function showSignupSuccess(message) {
    if (signupSuccessText) signupSuccessText.textContent = message
    if (signupSuccessMessage) signupSuccessMessage.classList.remove('hidden')
    if (signupErrorMessage) signupErrorMessage.classList.add('hidden')
  }

  /**
   * Hide signup messages
   */
  function hideSignupMessages() {
    if (signupErrorMessage) signupErrorMessage.classList.add('hidden')
    if (signupSuccessMessage) signupSuccessMessage.classList.add('hidden')
  }

  /**
   * Hide reset messages
   */
  function hideResetMessages() {
    if (resetErrorMessage) resetErrorMessage.classList.add('hidden')
    if (resetSuccessMessage) resetSuccessMessage.classList.add('hidden')
  }


  /**
   * Check if Supabase is configured and show demo mode notice
   */
  function checkSupabaseConfiguration() {
    const demoModeNotice = document.getElementById('demoModeNotice')

    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      if (demoModeNotice) {
        demoModeNotice.classList.remove('hidden')
      }

      // Disable login/signup/reset buttons in demo mode
      if (loginBtn) loginBtn.disabled = true
      if (signupSubmitBtn) signupSubmitBtn.disabled = true
      if (resetSubmitBtn) resetSubmitBtn.disabled = true

      console.warn('⚠️ Supabase not configured - authentication disabled')
    }
  }

  /**
   * Check for email verification notification and show success message
   */
  function checkEmailVerificationNotification() {
    const emailVerified = localStorage.getItem('emailVerified')
    const verifiedEmail = localStorage.getItem('verifiedEmail')
    
    if (emailVerified === 'true' && verifiedEmail) {
      console.log('[login-page] Email verification detected for:', verifiedEmail)
      
      // Show success notification
      showEmailVerificationSuccess(verifiedEmail)
      
      // Clear the stored verification data
      localStorage.removeItem('emailVerified')
      localStorage.removeItem('verifiedEmail')
    }
  }

  /**
   * Show email verification success notification on login page
   */
  function showEmailVerificationSuccess(email) {
    // Create notification element
    const notification = document.createElement('div')
    notification.id = 'emailVerificationNotification'
    notification.className = 'fixed top-4 right-4 z-50 max-w-md'
    notification.innerHTML = `
      <div class="bg-green-500/90 backdrop-blur-sm border border-green-400/30 rounded-lg p-4 shadow-lg">
        <div class="flex items-start space-x-3">
          <div class="flex-shrink-0">
            <i data-lucide="check-circle" class="w-5 h-5 text-green-100"></i>
          </div>
          <div class="flex-1">
            <h3 class="text-sm font-medium text-green-100">Email Verified!</h3>
            <p class="text-sm text-green-200 mt-1">
              Your email <strong>${email}</strong> has been successfully verified. You can now log in.
            </p>
          </div>
          <button onclick="this.closest('.fixed').remove()" class="flex-shrink-0 text-green-200 hover:text-green-100">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `
    
    // Add to page
    document.body.appendChild(notification)
    
    // Initialize Lucide icons
    if (window.safeCreateIcons) {
      window.safeCreateIcons()
    }
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove()
      }
    }, 5000)
  }

  /**
   * Get user-friendly error message
   */
  function getErrorMessage(error) {
    const message = error.message.toLowerCase()

    if (message.includes('invalid login credentials')) {
      return 'Invalid email or password'
    }
    if (message.includes('email not confirmed')) {
      return 'Please verify your email address before logging in. Check your inbox for the confirmation link.'
    }
    if (message.includes('too many requests')) {
      return 'Too many attempts. Please try again later'
    }
    // Handle various forms of "user already registered" messages
    if (message.includes('user already registered') || 
        message.includes('already registered') ||
        message.includes('email address is already registered') ||
        message.includes('user with this email already exists') ||
        message.includes('email already in use') ||
        message.includes('duplicate key value') ||
        message.includes('already been registered')) {
      return 'An account with this email already exists. Please try logging in instead.'
    }
    if (message.includes('password should be at least')) {
      return 'Password must be at least 6 characters long'
    }
    if (message.includes('password should contain at least one character of each')) {
      return 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
    }

    return error.message || 'An error occurred'
  }

  // Check for email verification notification
  checkEmailVerificationNotification()

  // Initialize password validation when Lucide is ready
  const waitForLucide = () => {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      validatePassword()
    } else {
      setTimeout(waitForLucide, 200)
    }
  }

  // Start waiting for Lucide
  setTimeout(waitForLucide, 500)

  // Set up MutationObserver to re-initialize password toggles when login page becomes visible
  const loginPage = document.getElementById('login-page')
  if (loginPage) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isVisible = !loginPage.classList.contains('hidden')
          if (isVisible) {
            console.log('Login page became visible, re-initializing password toggles')
            // Re-initialize password toggles when page becomes visible
            setTimeout(() => {
              setupPasswordToggles()
            }, 100)
          }
        }
      })
    })

    observer.observe(loginPage, {
      attributes: true,
      attributeFilter: ['class']
    })
  }

}
