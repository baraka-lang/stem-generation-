/**
 * Password Reset Page Logic
 * Handles password reset form interactions and authentication
 */

import { supabase } from './index.js'
import { resetPasswordConfig } from '../Config/resetPasswordConfig.js'

// Debug: module load
if (typeof window !== 'undefined') {
  console.log('[spa-reset] module loaded')
}


/**
 * Validate password in real-time and update visual indicators
 */
function validatePassword() {
  const passwordInput = document.getElementById('newPassword')
  const confirmPasswordInput = document.getElementById('confirmPassword')
  
  // Early return if input elements don't exist
  if (!passwordInput || !confirmPasswordInput) {
    return false
  }
  
  const password = passwordInput.value || ''
  const confirmPassword = confirmPasswordInput.value || ''
  
  // Get requirement elements
  const lengthEl = document.getElementById('password-length-reset')
  const lowercaseEl = document.getElementById('password-lowercase-reset')
  const uppercaseEl = document.getElementById('password-uppercase-reset')
  const numberEl = document.getElementById('password-number-reset')
  
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
  const passwordMatchEl = document.getElementById('password-match-reset')
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
  
  // Update Lucide icons
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons()
  }
}

export function setupResetPasswordPage() {
  console.group('[spa-reset] setupResetPasswordPage')
  console.log('[spa-reset] setupResetPasswordPage called at:', new Date().toISOString())
  try {
    window.addEventListener('hashchange', () => {
      console.log('[spa-reset] hashchange ->', window.location.hash)
    })
    console.log('[spa-reset] config', {
      supabaseUrl: resetPasswordConfig.supabaseUrl,
      hasAnonKey: !!resetPasswordConfig.supabaseKey && resetPasswordConfig.supabaseKey !== 'your-anon-key',
      redirectUrl: resetPasswordConfig.redirectUrl,
      showDemoMode: resetPasswordConfig.showDemoMode
    })
    console.log('[spa-reset] supabase present:', !!supabase)
    
  // Get form elements
  const resetPasswordForm = document.getElementById('resetPasswordForm')
  const resetSubmitBtn = document.getElementById('resetSubmitBtn')
  const resetSubmitBtnText = document.getElementById('resetSubmitBtnText')
  const resetSubmitBtnSpinner = document.getElementById('resetSubmitBtnSpinner')
  
  const errorMessage = document.getElementById('resetErrorMessage')
  const errorText = document.getElementById('resetErrorText')
  const successMessage = document.getElementById('resetSuccessMessage')
  const successText = document.getElementById('resetSuccessText')

  if (!resetPasswordForm || !resetSubmitBtn) {
    console.warn('[spa-reset] Reset password form elements not found', {
      hasForm: !!resetPasswordForm,
      hasBtn: !!resetSubmitBtn
    })
    console.groupEnd()
    return
  }

  // Hide all messages initially
  hideMessages()

  // Check if Supabase is configured and show demo mode notice
  checkSupabaseConfiguration()

  // Reset password form submission
  console.log('[spa-reset] Adding submit event listener to form:', resetPasswordForm)
  resetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    console.log('[spa-reset] submit handler invoked')
    console.log('[spa-reset] current hash:', window.location.hash)
    console.log('[spa-reset] current search:', window.location.search)
    await handlePasswordReset()
  })
  
  // Also add click listener to button as backup
  console.log('[spa-reset] Adding click event listener to button:', resetSubmitBtn)
  resetSubmitBtn.addEventListener('click', async (e) => {
    e.preventDefault()
    console.log('[spa-reset] button click handler invoked')
    console.log('[spa-reset] current hash:', window.location.hash)
    console.log('[spa-reset] current search:', window.location.search)
    await handlePasswordReset()
  })

  // Real-time password validation
  document.addEventListener('input', (e) => {
    if (e.target.id === 'newPassword' || e.target.id === 'confirmPassword') {
      validatePassword()
    }
  })

  // Password visibility toggles
  document.addEventListener('click', (e) => {
    // New password toggle
    const newPasswordToggle = e.target.closest('#toggleNewPassword')
    if (newPasswordToggle) {
      e.preventDefault()
      e.stopPropagation()
      
      const newPasswordInput = document.getElementById('newPassword')
      if (newPasswordInput) {
        const isPassword = newPasswordInput.type === 'password'
        newPasswordInput.type = isPassword ? 'text' : 'password'
        
        // Update icon
        const icon = newPasswordToggle.querySelector('i[data-lucide]')
        if (icon) {
          icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye')
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons()
          }
        }
      }
      return
    }

    // Confirm password toggle
    const confirmPasswordToggle = e.target.closest('#toggleConfirmPassword')
    if (confirmPasswordToggle) {
      e.preventDefault()
      e.stopPropagation()
      
      const confirmPasswordInput = document.getElementById('confirmPassword')
      if (confirmPasswordInput) {
        const isPassword = confirmPasswordInput.type === 'password'
        confirmPasswordInput.type = isPassword ? 'text' : 'password'
        
        // Update icon
        const icon = confirmPasswordToggle.querySelector('i[data-lucide]')
        if (icon) {
          icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye')
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons()
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
    const password = document.getElementById('newPassword')?.value
    const confirmPassword = document.getElementById('confirmPassword')?.value
    console.log('[spa-reset] input presence', { hasPassword: !!password, hasConfirm: !!confirmPassword })
    console.log('[spa-reset] current hash:', window.location.hash)
    console.log('[spa-reset] current search:', window.location.search)

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
      // First, prefer Supabase recovery flow if tokens exist in hash
      const rawHash = window.location.hash
      console.log('[spa-reset] Raw hash:', rawHash)
      const hashParams = new URLSearchParams(rawHash.startsWith('#') ? rawHash.substring(1) : rawHash)
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      console.log('[spa-reset] hash tokens', { hasAccess: !!accessToken, hasRefresh: !!refreshToken })

      if (accessToken && refreshToken) {
        console.time('[spa-reset] setSession')
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        })
        console.timeEnd('[spa-reset] setSession')
        console.log('[spa-reset] setSession result', { sessionData, sessionError })

        if (sessionError) {
          showError('Invalid or expired reset link. Please request a new password reset.')
          console.groupEnd()
          return
        }

        console.time('[spa-reset] updateUser')
        const { data: updateData, error: updateError } = await supabase.auth.updateUser({ password })
        console.timeEnd('[spa-reset] updateUser')
        console.log('[spa-reset] updateUser result', { updateData, updateError })

        if (updateError) {
          showError(updateError.message || 'Failed to update password')
          console.groupEnd()
          return
        }

        showSuccess('Password updated successfully! Redirecting...')
        setTimeout(() => {
          const redirectUrl = resetPasswordConfig.redirectUrl || '/'
          console.log('[spa-reset] redirecting to', redirectUrl)
          window.location.href = redirectUrl
        }, 1500)
        console.groupEnd()
        return
      }

      // Fallback: custom token flow via Edge Function (legacy)
      // Parse parameters from hash - handle format: #reset-password?token=...&email=...
      console.log('[spa-reset] Trying custom token flow...')
      const hashParts = window.location.hash.split('?')
      console.log('[spa-reset] Hash parts:', hashParts)
      const hashPart = hashParts.length > 1 ? hashParts[1] : ''
      console.log('[spa-reset] Hash part after ?:', hashPart)
      const urlParams = new URLSearchParams(hashPart)
      const customToken = urlParams.get('token')
      const email = urlParams.get('email')
      console.log('[spa-reset] url params', { hasToken: !!customToken, email, fullHash: window.location.hash })

      if (!customToken || !email) {
        showError('Invalid reset link. Please request a new password reset.')
        return
      }

      // Decode and validate the custom token
      try {
        const tokenData = JSON.parse(atob(customToken))
        console.log('[spa-reset] tokenData', tokenData)
        
        // Check if token is expired (1 hour)
        const tokenAge = Date.now() - tokenData.timestamp
        const oneHour = 60 * 60 * 1000
        console.log('[spa-reset] Token age check:', { tokenAge, oneHour, isExpired: tokenAge > oneHour })
        
        if (tokenAge > oneHour) {
          console.log('[spa-reset] Token expired, showing error')
          showError('Reset link has expired. Please request a new password reset.')
          return
        }
        
        // Verify email matches
        console.log('[spa-reset] Email verification:', { tokenEmail: tokenData.email, urlEmail: email, match: tokenData.email === email })
        if (tokenData.email !== email) {
          console.log('[spa-reset] Email mismatch, showing error')
          showError('Invalid reset link. Please request a new password reset.')
          return
        }
        
        // Verify token type
        console.log('[spa-reset] Token type verification:', { tokenType: tokenData.type, expected: 'password_reset', match: tokenData.type === 'password_reset' })
        if (tokenData.type !== 'password_reset') {
          console.log('[spa-reset] Invalid token type, showing error')
          showError('Invalid reset link. Please request a new password reset.')
          return
        }
        
        console.log('[spa-reset] Token validation passed, proceeding to Edge Function call')
      } catch (error) {
        console.error('[spa-reset] token decode/validate error', error)
        showError('Invalid reset link. Please request a new password reset.')
        return
      }

      // Call our Edge Function to update the password using Supabase client
      console.log('[spa-reset] About to call Edge Function with:', {
        emailType: 'password_update',
        email: email,
        hasPassword: !!password,
        hasToken: !!customToken
      })
      console.time('[spa-reset] supabase.functions.invoke send-email')
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          emailType: 'password_update',
          email: email,
          data: {
            newPassword: password,
            token: customToken
          }
        }
      })
      console.timeEnd('[spa-reset] supabase.functions.invoke send-email')
      console.log('[spa-reset] function result', { data, error })

      if (error) {
        showError(error.message || 'Failed to update password')
        return
      }

      showSuccess('Password updated successfully! Redirecting to login...')
      
      // Redirect to login after a short delay
      setTimeout(() => {
        console.log('[spa-reset] redirecting to #login')
        window.location.hash = '#login'
      }, 2000)

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
   * Hide all messages
   */
  function hideMessages() {
    if (errorMessage) errorMessage.classList.add('hidden')
    if (successMessage) successMessage.classList.add('hidden')
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
      validatePassword()
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
