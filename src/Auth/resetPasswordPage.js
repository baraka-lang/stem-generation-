/**
 * Password Reset Page Logic
 * Handles password reset form interactions and authentication
 */

import { supabase } from './index.js'
import { resetPasswordConfig } from '../Config/resetPasswordConfig.js'
import { createClient } from '@supabase/supabase-js'
import { urlGenerators } from '../Config/environment.js'

// Create a fallback Supabase client if the main one is not available
let fallbackSupabase = null
if (!supabase && resetPasswordConfig.supabaseUrl && resetPasswordConfig.supabaseKey) {
  console.log('[spa-reset] Creating fallback Supabase client')
  fallbackSupabase = createClient(resetPasswordConfig.supabaseUrl, resetPasswordConfig.supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  })
}

// Use the main supabase client or fallback
const activeSupabase = supabase || fallbackSupabase

// Debug: module load
if (typeof window !== 'undefined') {
  console.log('[spa-reset] module loaded')
}

/**
 * Get the appropriate redirect URL based on environment
 */
function getRedirectUrl() {
  // Use the environment configuration to get the proper base URL
  const redirectUrl = urlGenerators.generateWelcomeRedirectUrl('#selection')
  
  console.log('[spa-reset] Generated redirect URL:', redirectUrl)
  return redirectUrl
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
  console.log('[spa-reset] DOM ready state:', document.readyState)
  console.log('[spa-reset] window location:', window.location.href)
  
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
  console.log('[spa-reset] active supabase present:', !!activeSupabase)
    
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

  // Check if user has valid reset tokens when page loads
  checkResetTokens()

  // Reset password form submission
  console.log('[spa-reset] Adding submit event listener to form')
  resetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    console.log('[spa-reset] Form submitted')
    await handlePasswordReset()
  })
  
  // Also add click listener to button as backup
  console.log('[spa-reset] Adding click event listener to button')
  resetSubmitBtn.addEventListener('click', async (e) => {
    e.preventDefault()
    console.log('[spa-reset] Button clicked')
    await handlePasswordReset()
  })


  // Real-time password validation
  document.addEventListener('input', (e) => {
    if (e.target.id === 'newPassword' || e.target.id === 'confirmPassword') {
      hideMessages() // Clear any error/success messages when user starts typing
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
    console.log('[spa-reset] Password reset initiated at:', new Date().toISOString())
    
    const password = document.getElementById('newPassword')?.value
    const confirmPassword = document.getElementById('confirmPassword')?.value
    console.log('[spa-reset] Form validation:', { hasPassword: !!password, hasConfirm: !!confirmPassword })
    console.log('[spa-reset] Current URL:', window.location.href)

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
      console.log('[spa-reset] URL analysis:', { hash: rawHash, search: rawSearch })
      
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
        console.log('[spa-reset] Extracted reset part:', resetPart)
        hashParams = new URLSearchParams(resetPart)
      }
      
      // Also check query parameters (for Supabase generated links)
      const searchParams = new URLSearchParams(rawSearch)
      
      // Get tokens from either source - prioritize token_hash for PKCE flow
      // Also check for 'token' parameter (used by Supabase verification endpoint)
      const tokenHashFromHash = hashParams.get('token_hash') || searchParams.get('token_hash')
      const tokenFromHash = hashParams.get('token') || searchParams.get('token')
      const tokenHash = tokenHashFromHash || tokenFromHash
      const accessToken = hashParams.get('access_token') || searchParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token')
      const isFallback = hashParams.get('fallback') === 'true' || searchParams.get('fallback') === 'true'
      const email = hashParams.get('email') || searchParams.get('email')
      const isTokenHash = !!tokenHashFromHash
      
      console.log('[spa-reset] Token detection:', { 
        hasToken: !!tokenHash,
        hasAccessToken: !!accessToken, 
        hasRefreshToken: !!refreshToken, 
        isFallback, 
        email,
        tokenType: isTokenHash ? 'token_hash' : 'token'
      })
      
      // Debug: Show what tokens were actually extracted
      console.log('[spa-reset] Extracted tokens:', {
        tokenHash: tokenHash ? tokenHash.substring(0, 20) + '...' : null,
        accessToken: accessToken ? accessToken.substring(0, 20) + '...' : null,
        refreshToken: refreshToken ? refreshToken.substring(0, 20) + '...' : null,
        email: email
      })

      // Try PKCE flow first (using token_hash) - this is the recommended approach
      if (tokenHash) {
        console.log('[spa-reset] Using PKCE flow with token:', tokenHash.substring(0, 20) + '...')
        
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
        
        console.log('[spa-reset] Verifying token with params:', { type: verifyParams.type, hasToken: !!verifyParams.token || !!verifyParams.token_hash })
        const { data: verifyData, error: verifyError } = await activeSupabase.auth.verifyOtp(verifyParams)
        console.timeEnd('[spa-reset] verifyOtp')
        console.log('[spa-reset] Token verification result:', { 
          success: !verifyError,
          hasSession: !!verifyData?.session,
          hasUser: !!verifyData?.user,
          error: verifyError?.message
        })

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

        console.log('[spa-reset] Session established for user:', verifyData.session.user?.email)

        // Now update the password
        console.time('[spa-reset] updateUser')
        console.log('[spa-reset] Updating password for user')
        const { data: updateData, error: updateError } = await activeSupabase.auth.updateUser({ password })
        console.timeEnd('[spa-reset] updateUser')
        console.log('[spa-reset] Password update result:', { 
          success: !updateError,
          error: updateError?.message
        })

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
          console.log('[spa-reset] redirecting to', redirectUrl)
          window.location.href = redirectUrl
        }, 3000)
        console.groupEnd()
        return
      }

      // Handle case where we have only refreshToken (try to refresh session)
      if (refreshToken && !accessToken) {
        console.log('[spa-reset] Has refresh token but no access token, attempting to refresh session')
        
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
        console.log('[spa-reset] Session refresh result:', { 
          success: !refreshError,
          hasSession: !!refreshData?.session,
          hasUser: !!refreshData?.user,
          error: refreshError?.message
        })

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

        console.log('[spa-reset] Session refreshed for user:', refreshData.session.user?.email)

        console.time('[spa-reset] updateUser')
        console.log('[spa-reset] Updating password for user')
        const { data: updateData, error: updateError } = await activeSupabase.auth.updateUser({ password })
        console.timeEnd('[spa-reset] updateUser')
        console.log('[spa-reset] Password update result:', { 
          success: !updateError,
          error: updateError?.message
        })

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
          console.log('[spa-reset] redirecting to', redirectUrl)
          window.location.href = redirectUrl
        }, 3000)
        console.groupEnd()
        return
      }

      // Fallback to implicit flow (using access_token and refresh_token)
      if (accessToken && refreshToken) {
        console.log('[spa-reset] Using implicit flow with access_token and refresh_token')
        
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
        console.log('[spa-reset] Session establishment result:', { 
          success: !sessionError,
          hasSession: !!sessionData?.session,
          error: sessionError?.message
        })

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

        console.log('[spa-reset] Session established for user:', sessionData.session.user?.email)

        console.time('[spa-reset] updateUser')
        console.log('[spa-reset] Updating password for user')
        const { data: updateData, error: updateError } = await activeSupabase.auth.updateUser({ password })
        console.timeEnd('[spa-reset] updateUser')
        console.log('[spa-reset] Password update result:', { 
          success: !updateError,
          error: updateError?.message
        })

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
          console.log('[spa-reset] redirecting to', redirectUrl)
          window.location.href = redirectUrl
        }, 3000)
        console.groupEnd()
        return
      }

      // No valid tokens found - check if user is already authenticated
      console.log('[spa-reset] No tokens found, checking if user is already authenticated')
      
      // Check if user is already authenticated (for testing or direct access)
      const { data: { session }, error: sessionError } = await activeSupabase.auth.getSession()
      console.log('[spa-reset] Current session check:', { 
        hasSession: !!session, 
        hasUser: !!session?.user,
        error: sessionError?.message 
      })
      
      if (session && session.user) {
        console.log('[spa-reset] User already authenticated, proceeding with password update')
        console.log('[spa-reset] Authenticated user:', session.user.email)
        
        // User is already authenticated, proceed with password update
        console.time('[spa-reset] updateUser')
        console.log('[spa-reset] Updating password for authenticated user')
        const { data: updateData, error: updateError } = await activeSupabase.auth.updateUser({ password })
        console.timeEnd('[spa-reset] updateUser')
        console.log('[spa-reset] Password update result:', { 
          success: !updateError,
          error: updateError?.message
        })

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
          console.log('[spa-reset] redirecting to', redirectUrl)
          window.location.href = redirectUrl
        }, 3000)
        console.groupEnd()
        return
      }
      
      // No session and no tokens - show error
      if (isFallback && email) {
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
    console.log('[spa-reset] Showing error:', message)
    
    const errorText = document.getElementById('passwordResetErrorText')
    const errorMessage = document.getElementById('passwordResetErrorAlert')
    const successMessage = document.getElementById('passwordResetSuccessAlert')
    
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
    console.log('[spa-reset] Showing success:', message)
    
    const successText = document.getElementById('passwordResetSuccessText')
    const successMessage = document.getElementById('passwordResetSuccessAlert')
    const errorMessage = document.getElementById('passwordResetErrorAlert')
    
    if (successText) successText.textContent = message
    if (successMessage) successMessage.classList.remove('hidden')
    if (errorMessage) errorMessage.classList.add('hidden')
  }

  /**
   * Hide all messages
   */
  function hideMessages() {
    const errorMessage = document.getElementById('passwordResetErrorAlert')
    const successMessage = document.getElementById('passwordResetSuccessAlert')
    
    if (errorMessage) errorMessage.classList.add('hidden')
    if (successMessage) successMessage.classList.add('hidden')
  }

  /**
   * Clear the password form
   */
  function clearForm() {
    const passwordInput = document.getElementById('newPassword')
    const confirmPasswordInput = document.getElementById('confirmPassword')
    
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
    console.log('[spa-reset] Checking reset tokens on page load:', { rawHash, rawSearch })
    
    // Check if we're on the reset password page
    const isOnResetPage = rawHash.includes('reset-password') || rawSearch.includes('reset-password')
    if (!isOnResetPage) {
      console.log('[spa-reset] Not on reset password page')
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
      console.log('[spa-reset] Extracted reset part from hash:', resetPart)
      hashParams = new URLSearchParams(resetPart)
    }
    
    // Also check query parameters
    const searchParams = new URLSearchParams(rawSearch)
    
    // Get tokens from either source
    const accessToken = hashParams.get('access_token') || searchParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token')
    const isFallback = hashParams.get('fallback') === 'true' || searchParams.get('fallback') === 'true'
    const email = hashParams.get('email') || searchParams.get('email')
    
    console.log('[spa-reset] Token check:', { 
      hasAccess: !!accessToken, 
      hasRefresh: !!refreshToken, 
      isFallback, 
      email,
      hashTokens: { 
        access: hashParams.get('access_token'), 
        refresh: hashParams.get('refresh_token') 
      },
      searchTokens: { 
        access: searchParams.get('access_token'), 
        refresh: searchParams.get('refresh_token') 
      }
    })
    
    // Only show error if we have NO tokens at all
    if (!accessToken && !refreshToken) {
      if (isFallback && email) {
        showError('This is a fallback reset link. Please request a new password reset email.')
      } else {
        showError('Invalid or expired reset link. Please request a new password reset.')
      }
      return
    }
    
    // Tokens are present (either access_token, refresh_token, or both), user can proceed
    console.log('[spa-reset] Valid reset tokens found, user can proceed with password reset')
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
