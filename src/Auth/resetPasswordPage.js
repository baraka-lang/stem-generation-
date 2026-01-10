/**
 * Password Reset Page Logic
 * Handles password reset form interactions and authentication
 */

import { resetPasswordConfig } from '../Config/resetPasswordConfig.js'
import { createClient } from '@supabase/supabase-js'
import { urlGenerators } from '../Config/environment.js'
import { supabase as globalSupabase } from './index.js'

// Initialize a dedicated Supabase client for password reset
// This ensures we don't interfere with the global session state and prevents auto-authentication
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let localSupabase = null

if (supabaseUrl && supabaseAnonKey) {
  localSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false, // Critical: Don't persist session to avoid auto-login
      detectSessionInUrl: false // We handle token parsing manually
    }
  })
}

// Use the local client exclusively
const activeSupabase = localSupabase

// Debug: module load
if (typeof window !== 'undefined') {
}

/**
 * Get the appropriate redirect URL based on environment
 */
function getRedirectUrl() {
  // Use the environment configuration to get the proper base URL
  const redirectUrl = urlGenerators.generateWelcomeRedirectUrl('#selection')

  return redirectUrl
}


/**
 * Validate password in real-time and update visual indicators
 */
function validatePassword() {
  const passwordInput = document.getElementById('newPasswordReset')
  const confirmPasswordInput = document.getElementById('confirmPasswordReset')

  // Early return if input elements don't exist
  if (!passwordInput || !confirmPasswordInput) {
    return false
  }

  const password = passwordInput.value || ''
  const confirmPassword = confirmPasswordInput.value || ''

  // Get requirement elements
  const lengthEl = document.getElementById('reset-password-length-requirement')
  const lowercaseEl = document.getElementById('reset-password-lowercase-requirement')
  const uppercaseEl = document.getElementById('reset-password-uppercase-requirement')
  const numberEl = document.getElementById('reset-password-number-requirement')

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
  const passwordMatchEl = document.getElementById('reset-password-match-requirement')
  if (passwordMatchEl) {
    if (confirmPassword.length > 0) {
      updateRequirementIndicator(passwordMatchEl, passwordsMatch)
      passwordMatchEl.classList.remove('hidden')
    } else {
      passwordMatchEl.classList.add('hidden')
    }
  }

  // Update submit button state
  const resetSubmitBtn = document.getElementById('resetSubmitBtn')
  if (resetSubmitBtn) {
    resetSubmitBtn.disabled = !isValid || !passwordsMatch
  }

  return isValid && passwordsMatch
}

/**
 * Update visual indicator for password requirement
 */
function updateRequirementIndicator(element, isValid) {
  if (!element) {
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

export function setupResetPasswordPage() {
  console.group('[spa-reset] setupResetPasswordPage')

  try {
    window.addEventListener('hashchange', () => {
    })

    // Get form elements
    const resetPasswordForm = document.getElementById('resetPasswordForm')
    const resetSubmitBtn = document.getElementById('resetSubmitBtn')
    const resetSubmitBtnText = document.getElementById('resetSubmitBtnText')
    const resetSubmitBtnSpinner = document.getElementById('resetSubmitBtnSpinner')

    const errorMessage = document.getElementById('passwordResetErrorAlert')
    const errorText = document.getElementById('passwordResetErrorText')
    const successMessage = document.getElementById('passwordResetSuccessAlert')
    const successText = document.getElementById('passwordResetSuccessText')


    if (!resetPasswordForm || !resetSubmitBtn) {
      console.groupEnd()
      return
    }

    // Hide all messages initially
    hideMessages()

    // Check if Supabase is configured and show demo mode notice
    checkSupabaseConfiguration()

    // Check if user has valid reset tokens when page loads
    checkResetTokens()

    // Reset password form submission
    resetPasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      await handlePasswordReset()
    })

    // Also add click listener to button as backup
    resetSubmitBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      await handlePasswordReset()
    })


    // Real-time password validation
    document.addEventListener('input', (e) => {
      if (e.target.id === 'newPasswordReset' || e.target.id === 'confirmPasswordReset') {
        hideMessages() // Clear any error/success messages when user starts typing
        validatePassword()
      }
    })

    // Password visibility toggles
    document.addEventListener('click', (e) => {
      // New password toggle
      const newPasswordToggle = e.target.closest('#toggleNewPasswordReset')
      if (newPasswordToggle) {
        e.preventDefault()
        e.stopPropagation()

        const newPasswordInput = document.getElementById('newPasswordReset')
        if (newPasswordInput) {
          const isPassword = newPasswordInput.type === 'password'
          newPasswordInput.type = isPassword ? 'text' : 'password'

          // Update icon
          const icon = newPasswordToggle.querySelector('i[data-lucide]')
          if (icon) {
            icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye')
            if (window.safeCreateIcons) {
              window.safeCreateIcons()
            }
          }
        }
        return
      }

      // Confirm password toggle
      const confirmPasswordToggle = e.target.closest('#toggleConfirmPasswordReset')
      if (confirmPasswordToggle) {
        e.preventDefault()
        e.stopPropagation()

        const confirmPasswordInput = document.getElementById('confirmPasswordReset')
        if (confirmPasswordInput) {
          const isPassword = confirmPasswordInput.type === 'password'
          confirmPasswordInput.type = isPassword ? 'text' : 'password'

          // Update icon
          const icon = confirmPasswordToggle.querySelector('i[data-lucide]')
          if (icon) {
            icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye')
            if (window.safeCreateIcons) {
              window.safeCreateIcons()
            }
          }
        }
        return
      }
    })

    /**
     * Handle password reset
     */
    async function handlePasswordReset() {
      console.group('[spa-reset] handlePasswordReset')

      const password = document.getElementById('newPasswordReset')?.value
      const confirmPassword = document.getElementById('confirmPasswordReset')?.value

      if (!password || !confirmPassword) {
        showError('Please fill in all fields')
        return
      }

      if (password !== confirmPassword) {
        showError('Passwords do not match')
        return
      }

      // Check password requirements using our validation function
      if (!validatePassword()) {
        showError('Password does not meet all requirements')
        return
      }

      setLoading(true)
      hideMessages()

      try {
        // Check for tokens in both URL hash and query parameters
        const rawHash = window.location.hash
        const rawSearch = window.location.search

        // Try to get tokens from hash first (for direct links)
        let hashParams = new URLSearchParams()
        if (rawHash && rawHash.includes('reset-password')) {
          const hashPart = rawHash.startsWith('#') ? rawHash.substring(1) : rawHash
          // Extract the part after #reset-password
          let resetPart = ''
          if (hashPart.includes('#reset-password#')) {
            // Handle format: #reset-password#access_token=...
            resetPart = hashPart.split('#reset-password#')[1]
          } else if (hashPart.includes('#reset-password?')) {
            // Handle format: #reset-password?access_token=...
            resetPart = hashPart.split('#reset-password?')[1]
          } else if (hashPart.includes('#reset-password')) {
            // Handle format: #reset-password (no params)
            resetPart = hashPart.split('#reset-password')[1]
          } else {
            resetPart = hashPart
          }
          hashParams = new URLSearchParams(resetPart)
        }

        // Also check query parameters (for Supabase generated links)
        const searchParams = new URLSearchParams(rawSearch)

        // Get tokens from either source - prioritize token_hash for PKCE flow
        // Also check for 'token' parameter (used by Supabase verification endpoint)
        // Check for JWT token_hash from window object (set by checkResetTokens)
        const tokenHashFromHash = hashParams.get('token_hash') || searchParams.get('token_hash')
        const tokenFromHash = hashParams.get('token') || searchParams.get('token')
        const tokenHashFromWindow = window.resetTokenHash
        const tokenHash = tokenHashFromHash || tokenFromHash || tokenHashFromWindow
        const accessToken = hashParams.get('access_token') || searchParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token')
        const isFallback = hashParams.get('fallback') === 'true' || searchParams.get('fallback') === 'true'
        const email = hashParams.get('email') || searchParams.get('email')
        const isTokenHash = !!tokenHashFromHash || !!tokenHashFromWindow



        // 1. Check if we already have a session (preferred)
        // Sometimes the main Supabase client or a previous action already established a session

        // Check local client first
        let { data: { session: localSession } } = await activeSupabase.auth.getSession()

        // Check global client as fallback (since it might have "eaten" the token)
        let globalSession = null
        if (!localSession && globalSupabase) {
          const { data: { session } } = await globalSupabase.auth.getSession()
          globalSession = session
        }

        const session = localSession || globalSession
        const sessionClient = localSession ? activeSupabase : (globalSession ? globalSupabase : null)

        if (session && session.user) {

          console.time('[spa-reset] updateUser')
          const { data: updateData, error: updateError } = await sessionClient.auth.updateUser({ password })
          console.timeEnd('[spa-reset] updateUser')

          if (updateError) {
            console.error('[spa-reset] updateUser failed:', updateError)
            showError(getPasswordUpdateErrorMessage(updateError))
            console.groupEnd()
            return
          }

          clearForm()
          showSuccess('Password updated successfully! Redirecting to main app...')
          setTimeout(async () => {
            try {
              const { showLoginModal } = await import('./loginPage.js')
              if (typeof showLoginModal === 'function') {
                showLoginModal()
                return
              }
            } catch { }
          }, 3000)
          console.groupEnd()
          return
        }

        // 2. No session, try PKCE flow if tokenHash is present
        if (tokenHash) {

          if (!activeSupabase) {
            console.error('[spa-reset] No Supabase client available')
            showError('Authentication service not available. Please try again later.')
            console.groupEnd()
            return
          }

          console.time('[spa-reset] verifyOtp')
          // Use the correct parameter based on token source
          const verifyParams = isTokenHash ?
            { token_hash: tokenHash, type: 'recovery' } :
            { token: tokenHash, type: 'recovery' }

          const { data: verifyData, error: verifyError } = await activeSupabase.auth.verifyOtp(verifyParams)
          console.timeEnd('[spa-reset] verifyOtp')

          if (verifyError) {
            console.error('[spa-reset] verifyOtp failed:', verifyError)
            showError('Invalid or expired reset link. Please request a new password reset.')
            console.groupEnd()
            return
          }

          // Check if we have a valid session
          if (!verifyData?.session) {
            console.error('[spa-reset] No session after verifyOtp')
            showError('Failed to establish session. Please request a new password reset.')
            console.groupEnd()
            return
          }


          // Now update the password
          console.time('[spa-reset] updateUser')
          const { data: updateData, error: updateError } = await activeSupabase.auth.updateUser({ password })
          console.timeEnd('[spa-reset] updateUser')

          if (updateError) {
            console.error('[spa-reset] updateUser failed:', updateError)
            showError(getPasswordUpdateErrorMessage(updateError))
            console.groupEnd()
            return
          }

          clearForm()
          showSuccess('Password updated successfully! Redirecting to main app...')
          setTimeout(() => {
            const redirectUrl = getRedirectUrl()
            window.location.href = redirectUrl
          }, 3000)
          console.groupEnd()
          return
        }

        // Handle case where we have only refreshToken (try to refresh session)
        if (refreshToken && !accessToken) {

          if (!activeSupabase) {
            console.error('[spa-reset] No Supabase client available')
            showError('Authentication service not available. Please try again later.')
            console.groupEnd()
            return
          }

          console.time('[spa-reset] refreshSession')
          const { data: refreshData, error: refreshError } = await activeSupabase.auth.refreshSession({
            refresh_token: refreshToken
          })
          console.timeEnd('[spa-reset] refreshSession')

          if (refreshError) {
            console.error('[spa-reset] refreshSession failed:', refreshError)
            showError('Invalid or expired reset link. Please request a new password reset.')
            console.groupEnd()
            return
          }

          // Check if we have a valid session after refresh
          if (!refreshData?.session) {
            console.error('[spa-reset] No session after refresh')
            showError('Failed to establish session. Please request a new password reset.')
            console.groupEnd()
            return
          }


          console.time('[spa-reset] updateUser')
          const { data: updateData, error: updateError } = await activeSupabase.auth.updateUser({ password })
          console.timeEnd('[spa-reset] updateUser')

          if (updateError) {
            console.error('[spa-reset] updateUser failed:', updateError)
            showError(getPasswordUpdateErrorMessage(updateError))
            console.groupEnd()
            return
          }

          clearForm()
          showSuccess('Password updated successfully! Redirecting to main app...')
          setTimeout(() => {
            const redirectUrl = getRedirectUrl()
            window.location.href = redirectUrl
          }, 3000)
          console.groupEnd()
          return
        }

        // Fallback to implicit flow (using access_token and refresh_token)
        if (accessToken && refreshToken) {

          if (!activeSupabase) {
            console.error('[spa-reset] No Supabase client available')
            showError('Authentication service not available. Please try again later.')
            console.groupEnd()
            return
          }

          console.time('[spa-reset] setSession')
          const { data: sessionData, error: sessionError } = await activeSupabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          })
          console.timeEnd('[spa-reset] setSession')

          if (sessionError) {
            console.error('[spa-reset] setSession failed:', sessionError)
            showError('Invalid or expired reset link. Please request a new password reset.')
            console.groupEnd()
            return
          }

          // Check if we have a valid session
          if (!sessionData?.session) {
            console.error('[spa-reset] No session after setSession')
            showError('Failed to establish session. Please request a new password reset.')
            console.groupEnd()
            return
          }


          console.time('[spa-reset] updateUser')
          const { data: updateData, error: updateError } = await activeSupabase.auth.updateUser({ password })
          console.timeEnd('[spa-reset] updateUser')

          if (updateError) {
            console.error('[spa-reset] updateUser failed:', updateError)
            showError(getPasswordUpdateErrorMessage(updateError))
            console.groupEnd()
            return
          }

          clearForm()
          showSuccess('Password updated successfully! Redirecting to main app...')
          setTimeout(() => {
            const redirectUrl = getRedirectUrl()
            window.location.href = redirectUrl
          }, 3000)
          console.groupEnd()
          return
        }

        // Check for special URL parameters
        const checkEmail = hashParams.get('check_email') === 'true' || searchParams.get('check_email') === 'true'
        const requestReset = hashParams.get('request') === 'true' || searchParams.get('request') === 'true'


        if (checkEmail) {
          // User should check their email for the reset link
          showError('Please check your email for the password reset link. If you don\'t see it, check your spam folder.')
          console.groupEnd()
          return
        }

        if (requestReset) {
          // User needs to request a new password reset
          showError('Please request a new password reset from the login page.')
          console.groupEnd()
          return
        }

        // No session and no tokens - show error
        if (isFallback) {
          // Handle fallback mode - show error but allow user to request new reset
          showError('This is a fallback reset link. Please request a new password reset email.')
          console.groupEnd()
          return
        } else {
          showError('Invalid or expired reset link. Please request a new password reset.')
          console.groupEnd()
          return
        }

      } catch (error) {
        console.error('[spa-reset] Password reset error:', error)
        showError('An unexpected error occurred')
      } finally {
        setLoading(false)
        console.groupEnd()
      }
    }

    /**
     * Set loading state for reset form
     */
    function setLoading(isLoading) {
      if (resetSubmitBtn) {
        resetSubmitBtn.disabled = isLoading
        if (resetSubmitBtnText) resetSubmitBtnText.textContent = isLoading ? 'Updating Password...' : 'Update Password'
        if (resetSubmitBtnSpinner) {
          resetSubmitBtnSpinner.classList.toggle('hidden', !isLoading)
        }
      }
    }

    /**
     * Get user-friendly error message for password update errors
     */
    function getPasswordUpdateErrorMessage(updateError) {
      if (!updateError || !updateError.message) {
        return 'Failed to update password'
      }

      const message = updateError.message.toLowerCase()

      if (message.includes('same password') || message.includes('identical')) {
        return 'Please choose a different password. The new password must be different from your current password.'
      } else if (message.includes('weak')) {
        return 'Password is too weak. Please choose a stronger password.'
      } else if (message.includes('length')) {
        return 'Password must be at least 6 characters long.'
      } else if (message.includes('invalid')) {
        return 'Invalid password format. Please check your password and try again.'
      } else {
        return updateError.message
      }
    }

    /**
     * Show error message
     */
    function showError(message) {

      if (errorText) {
        errorText.textContent = message
      } else {
        console.error('[spa-reset] Error text element not found!')
      }

      if (errorMessage) {
        errorMessage.classList.remove('hidden')
      } else {
        console.error('[spa-reset] Error message element not found!')
      }

      if (successMessage) {
        successMessage.classList.add('hidden')
      }
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
     * Hide all messages
     */
    function hideMessages() {
      if (errorMessage) errorMessage.classList.add('hidden')
      if (successMessage) successMessage.classList.add('hidden')
    }

    /**
     * Clear the password form
     */
    function clearForm() {
      const passwordInput = document.getElementById('newPasswordReset')
      const confirmPasswordInput = document.getElementById('confirmPasswordReset')

      if (passwordInput) passwordInput.value = ''
      if (confirmPasswordInput) confirmPasswordInput.value = ''
      hideMessages()
    }

    /**
     * Check if user has valid reset tokens when page loads
     */
    function checkResetTokens() {
      const rawHash = window.location.hash
      const rawSearch = window.location.search

      // Check if we're on the reset password page
      const isOnResetPage = rawHash.includes('reset-password') || rawSearch.includes('reset-password')
      if (!isOnResetPage) {
        return
      }

      // Try to get tokens from hash first
      let hashParams = new URLSearchParams()
      if (rawHash && rawHash.includes('reset-password')) {
        const hashPart = rawHash.startsWith('#') ? rawHash.substring(1) : rawHash
        // Handle different URL formats
        let resetPart = ''
        if (hashPart.includes('#reset-password#')) {
          // Handle format: #reset-password#access_token=...
          resetPart = hashPart.split('#reset-password#')[1]
        } else if (hashPart.includes('#reset-password?')) {
          // Handle format: #reset-password?access_token=...
          resetPart = hashPart.split('#reset-password?')[1]
        } else if (hashPart.includes('#reset-password')) {
          // Handle format: #reset-password (no params)
          resetPart = hashPart.split('#reset-password')[1]
        } else {
          resetPart = hashPart
        }
        hashParams = new URLSearchParams(resetPart)
      }

      // Also check query parameters
      const searchParams = new URLSearchParams(rawSearch)

      // Get tokens from either source
      const accessToken = hashParams.get('access_token') || searchParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token')
      const tokenHash = hashParams.get('token') || searchParams.get('token')
      const tokenType = hashParams.get('type') || searchParams.get('type')
      const isFallback = hashParams.get('fallback') === 'true' || searchParams.get('fallback') === 'true'
      const email = hashParams.get('email') || searchParams.get('email')
      const checkEmail = hashParams.get('check_email') === 'true' || searchParams.get('check_email') === 'true'
      const requestReset = hashParams.get('request') === 'true' || searchParams.get('request') === 'true'


      // Handle special URL parameters
      if (checkEmail) {
        showError('Please check your email for the password reset link. If you don\'t see it, check your spam folder.')
        return
      }

      if (requestReset) {
        showError('Please request a new password reset from the login page.')
        return
      }

      // Handle JWT token_hash format (from /auth/v1/verify endpoint)
      if (tokenHash && tokenType === 'recovery') {
        // Store the token_hash for later verification
        window.resetTokenHash = tokenHash
        window.resetTokenType = tokenType
        return
      }

      // Only show error if we have NO tokens at all
      if (!accessToken && !refreshToken && !tokenHash) {
        if (isFallback && email) {
          showError('This is a fallback reset link. Please request a new password reset email.')
        } else {
          showError('Invalid or expired reset link. Please request a new password reset.')
        }
        return
      }

      // Tokens are present (either access_token, refresh_token, token_hash, or combination), user can proceed
      // Don't call setSession() here - only when user submits the form
    }

    /**
     * Check if Supabase is configured and show demo mode notice
     */
    function checkSupabaseConfiguration() {
      const demoModeNotice = document.getElementById('demoModeNotice')

      if (resetPasswordConfig.showDemoMode) {
        if (demoModeNotice) {
          demoModeNotice.classList.remove('hidden')
        }

        // Disable reset button in demo mode
        if (resetSubmitBtn) resetSubmitBtn.disabled = true
      }
    }

    /**
     * Get user-friendly error message
     */
    function getErrorMessage(error) {
      const message = error.message.toLowerCase()

      if (message.includes('invalid login credentials')) {
        return 'Invalid reset link. Please request a new password reset.'
      }
      if (message.includes('password should be at least')) {
        return 'Password must be at least 6 characters long'
      }
      if (message.includes('password should contain at least one character of each')) {
        return 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      }
      if (message.includes('session not found') || message.includes('invalid token')) {
        return 'Reset link has expired. Please request a new password reset.'
      }

      return error.message || 'An error occurred'
    }

    // Initialize password validation when Lucide is ready
    const waitForLucide = () => {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        try {
          validatePassword()
        } catch (error) {
          console.error('Error during initial password validation:', error)
          // Still try to validate even if there's an error
          validatePassword()
        }
      } else {
        setTimeout(waitForLucide, 200)
      }
    }

    // Start waiting for Lucide
    setTimeout(waitForLucide, 500)
  } catch (e) {
    console.error('[spa-reset] setup failure', e)
  } finally {
    console.groupEnd()
  }
}
