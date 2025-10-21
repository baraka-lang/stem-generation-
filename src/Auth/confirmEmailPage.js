/**
 * Email Confirmation Page Logic
 * Handles email confirmation form interactions and authentication
 */

import { supabase } from './index.js'
import { resetPasswordConfig } from '../Config/resetPasswordConfig.js'
import { createClient } from '@supabase/supabase-js'

// Create a fallback Supabase client if the main one is not available
let fallbackSupabase = null
if (!supabase && resetPasswordConfig.supabaseUrl && resetPasswordConfig.supabaseKey) {
  console.log('[spa-confirm] Creating fallback Supabase client')
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
  console.log('[spa-confirm] module loaded')
}

/**
 * Set up the email confirmation page
 */
export function setupConfirmEmailPage() {
  console.log('[spa-confirm] Setting up email confirmation page')
  
  // Get DOM elements
  const resendConfirmationBtn = document.getElementById('resendConfirmationBtn')
  const resendConfirmationBtnText = document.getElementById('resendConfirmationBtnText')
  const resendConfirmationBtnSpinner = document.getElementById('resendConfirmationBtnSpinner')
  const checkStatusBtn = document.getElementById('checkStatusBtn')
  const checkStatusBtnText = document.getElementById('checkStatusBtnText')
  const checkStatusBtnSpinner = document.getElementById('checkStatusBtnSpinner')
  const userInfo = document.getElementById('userInfo')
  const userEmail = document.getElementById('userEmail')
  const userStatus = document.getElementById('userStatus')
  const demoModeNotice = document.getElementById('demoModeNotice')

  if (!resendConfirmationBtn || !checkStatusBtn) {
    console.warn('[spa-confirm] Email confirmation page elements not found', {
      hasResendBtn: !!resendConfirmationBtn,
      hasCheckBtn: !!checkStatusBtn
    })
    return
  }

  // Check if Supabase is configured
  if (!activeSupabase) {
    console.warn('[spa-confirm] Supabase not configured, showing demo mode')
    if (demoModeNotice) {
      demoModeNotice.classList.remove('hidden')
    }
    return
  }

  // Check for confirmation tokens on page load
  checkConfirmationTokens()

  // Add event listeners
  resendConfirmationBtn.addEventListener('click', async (e) => {
    e.preventDefault()
    console.log('[spa-confirm] Resend confirmation button clicked')
    await handleResendConfirmation()
  })

  checkStatusBtn.addEventListener('click', async (e) => {
    e.preventDefault()
    console.log('[spa-confirm] Check status button clicked')
    await handleCheckStatus()
  })
}

/**
 * Handle resending confirmation email
 */
async function handleResendConfirmation() {
  console.log('[spa-confirm] Starting resend confirmation process')
  
  const resendBtn = document.getElementById('resendConfirmationBtn')
  const resendBtnText = document.getElementById('resendConfirmationBtnText')
  const resendBtnSpinner = document.getElementById('resendConfirmationBtnSpinner')
  
  if (!resendBtn || !resendBtnText || !resendBtnSpinner) {
    console.error('[spa-confirm] Resend button elements not found')
    return
  }

  try {
    // Show loading state
    setButtonLoading(resendBtn, resendBtnText, resendBtnSpinner, true)
    hideMessages()

    // Get current user
    const { data: { user }, error: userError } = await activeSupabase.auth.getUser()
    
    if (userError || !user) {
      console.error('[spa-confirm] No authenticated user found:', userError)
      showError('Please log in first to resend confirmation email.')
      return
    }

    if (user.email_confirmed_at) {
      console.log('[spa-confirm] User email already confirmed')
      showSuccess('Your email is already confirmed! You can now access all features.')
      return
    }

    // Resend confirmation email
    console.log('[spa-confirm] Resending confirmation email to:', user.email)
    const { error: resendError } = await activeSupabase.auth.resend({
      type: 'signup',
      email: user.email
    })

    if (resendError) {
      console.error('[spa-confirm] Failed to resend confirmation:', resendError)
      showError('Failed to resend confirmation email. Please try again later.')
      return
    }

    console.log('[spa-confirm] Confirmation email resent successfully')
    showSuccess('Confirmation email sent! Please check your inbox and click the link to verify your account.')
    
    // Update user info display
    updateUserInfo(user)

  } catch (error) {
    console.error('[spa-confirm] Resend confirmation error:', error)
    showError('An unexpected error occurred. Please try again later.')
  } finally {
    setButtonLoading(resendBtn, resendBtnText, resendBtnSpinner, false)
  }
}

/**
 * Handle checking confirmation status
 */
async function handleCheckStatus() {
  console.log('[spa-confirm] Starting status check process')
  
  const checkBtn = document.getElementById('checkStatusBtn')
  const checkBtnText = document.getElementById('checkStatusBtnText')
  const checkBtnSpinner = document.getElementById('checkStatusBtnSpinner')
  
  if (!checkBtn || !checkBtnText || !checkBtnSpinner) {
    console.error('[spa-confirm] Check status button elements not found')
    return
  }

  try {
    // Show loading state
    setButtonLoading(checkBtn, checkBtnText, checkBtnSpinner, true)
    hideMessages()

    // Get current user
    const { data: { user }, error: userError } = await activeSupabase.auth.getUser()
    
    if (userError || !user) {
      console.error('[spa-confirm] No authenticated user found:', userError)
      showError('Please log in first to check your confirmation status.')
      return
    }

    console.log('[spa-confirm] User status check:', {
      email: user.email,
      confirmed: !!user.email_confirmed_at,
      confirmedAt: user.email_confirmed_at
    })

    // Update user info display
    updateUserInfo(user)

    if (user.email_confirmed_at) {
      console.log('[spa-confirm] User email is confirmed')
      showSuccess('Your email is confirmed! You now have access to all features.')
      
      // Redirect to main app after a short delay
      setTimeout(() => {
        const redirectUrl = resetPasswordConfig.redirectUrl || '/#selection'
        console.log('[spa-confirm] Redirecting to:', redirectUrl)
        window.location.href = redirectUrl
      }, 2000)
    } else {
      console.log('[spa-confirm] User email is not confirmed')
      showError('Your email is not yet confirmed. Please check your inbox and click the confirmation link.')
    }

  } catch (error) {
    console.error('[spa-confirm] Status check error:', error)
    showError('An unexpected error occurred. Please try again later.')
  } finally {
    setButtonLoading(checkBtn, checkBtnText, checkBtnSpinner, false)
  }
}

/**
 * Check for confirmation tokens when page loads
 */
async function checkConfirmationTokens() {
  console.log('[spa-confirm] Checking for confirmation tokens on page load')
  
  const rawHash = window.location.hash
  const rawSearch = window.location.search
  console.log('[spa-confirm] URL analysis:', { hash: rawHash, search: rawSearch })
  
  // Check if we're on the confirm email page
  const isOnConfirmPage = rawHash.includes('confirm-email') || rawSearch.includes('confirm-email')
  if (!isOnConfirmPage) {
    console.log('[spa-confirm] Not on confirm email page')
    return
  }
  
  // Try to get tokens from hash first
  let hashParams = new URLSearchParams()
  if (rawHash && rawHash.includes('confirm-email')) {
    const hashPart = rawHash.startsWith('#') ? rawHash.substring(1) : rawHash
    // Handle different URL formats
    let confirmPart = ''
    if (hashPart.includes('#confirm-email#')) {
      // Handle format: #confirm-email#access_token=...
      confirmPart = hashPart.split('#confirm-email#')[1]
    } else if (hashPart.includes('#confirm-email?')) {
      // Handle format: #confirm-email?access_token=...
      confirmPart = hashPart.split('#confirm-email?')[1]
    } else if (hashPart.includes('#confirm-email')) {
      // Handle format: #confirm-email (no params)
      confirmPart = hashPart.split('#confirm-email')[1]
    } else {
      confirmPart = hashPart
    }
    console.log('[spa-confirm] Extracted confirm part from hash:', confirmPart)
    hashParams = new URLSearchParams(confirmPart)
  }
  
  // Also check query parameters
  const searchParams = new URLSearchParams(rawSearch)
  
  // Get tokens from either source
  const accessToken = hashParams.get('access_token') || searchParams.get('access_token')
  const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token')
  const tokenType = hashParams.get('type') || searchParams.get('type')
  
  console.log('[spa-confirm] Token check:', { 
    hasAccess: !!accessToken, 
    hasRefresh: !!refreshToken, 
    tokenType,
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
    console.log('[spa-confirm] No confirmation tokens found')
    // Don't show error immediately - let user check status manually
    return
  }
  
  // Tokens are present, try to confirm email
  console.log('[spa-confirm] Confirmation tokens found, attempting to confirm email')
  await handleEmailConfirmation(accessToken, refreshToken)
}

/**
 * Handle email confirmation with tokens
 */
async function handleEmailConfirmation(accessToken, refreshToken) {
  console.log('[spa-confirm] Starting email confirmation process')
  
  try {
    // Show loading state
    showLoading('Confirming your email...')
    hideMessages()

    if (!activeSupabase) {
      console.error('[spa-confirm] No Supabase client available')
      showError('Authentication service not available. Please try again later.')
      return
    }

    // Try to set session with the tokens
    console.log('[spa-confirm] Setting session with tokens')
    const { data: sessionData, error: sessionError } = await activeSupabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    })

    if (sessionError) {
      console.error('[spa-confirm] Session establishment failed:', sessionError)
      showError('Invalid or expired confirmation link. Please request a new confirmation email.')
      return
    }

    if (!sessionData?.session || !sessionData?.user) {
      console.error('[spa-confirm] No session or user after token confirmation')
      showError('Failed to confirm email. Please try again.')
      return
    }

    const user = sessionData.user
    console.log('[spa-confirm] Email confirmation successful for user:', user.email)

    // Check if email is confirmed
    if (user.email_confirmed_at) {
      console.log('[spa-confirm] Email is confirmed, showing success')
      showSuccess('Email confirmed successfully! Welcome to 343 Labs AI Music Studio!')
      
      // Update user info display
      updateUserInfo(user)
      
      // Redirect to main app after a short delay
      setTimeout(() => {
        const redirectUrl = resetPasswordConfig.redirectUrl || '/#selection'
        console.log('[spa-confirm] Redirecting to:', redirectUrl)
        window.location.href = redirectUrl
      }, 3000)
    } else {
      console.log('[spa-confirm] Email confirmation tokens worked but email not confirmed yet')
      showError('Email confirmation is still pending. Please check your email and click the confirmation link.')
    }

  } catch (error) {
    console.error('[spa-confirm] Email confirmation error:', error)
    showError('An unexpected error occurred during email confirmation. Please try again.')
  } finally {
    hideLoading()
  }
}

/**
 * Update user information display
 */
function updateUserInfo(user) {
  const userInfo = document.getElementById('userInfo')
  const userEmail = document.getElementById('userEmail')
  const userStatus = document.getElementById('userStatus')
  
  if (userInfo && userEmail && userStatus) {
    userEmail.textContent = user.email || 'Unknown'
    userStatus.textContent = user.email_confirmed_at ? 'Confirmed' : 'Pending'
    userInfo.classList.remove('hidden')
  }
}

/**
 * Set button loading state
 */
function setButtonLoading(button, textElement, spinnerElement, isLoading) {
  if (button) {
    button.disabled = isLoading
  }
  if (textElement) {
    textElement.classList.toggle('hidden', isLoading)
  }
  if (spinnerElement) {
    spinnerElement.classList.toggle('hidden', !isLoading)
  }
}

/**
 * Show error message
 */
function showError(message) {
  console.log('[spa-confirm] Showing error:', message)
  
  const errorText = document.getElementById('emailConfirmErrorText')
  const errorMessage = document.getElementById('emailConfirmErrorAlert')
  const successMessage = document.getElementById('emailConfirmSuccessAlert')
  
  if (errorText) {
    errorText.textContent = message
  } else {
    console.error('[spa-confirm] Error text element not found!')
  }
  
  if (errorMessage) {
    errorMessage.classList.remove('hidden')
  } else {
    console.error('[spa-confirm] Error message element not found!')
  }
  
  if (successMessage) {
    successMessage.classList.add('hidden')
  }
}

/**
 * Show success message
 */
function showSuccess(message) {
  console.log('[spa-confirm] Showing success:', message)
  
  const successText = document.getElementById('emailConfirmSuccessText')
  const successMessage = document.getElementById('emailConfirmSuccessAlert')
  const errorMessage = document.getElementById('emailConfirmErrorAlert')
  
  if (successText) successText.textContent = message
  if (successMessage) successMessage.classList.remove('hidden')
  if (errorMessage) errorMessage.classList.add('hidden')
}

/**
 * Show loading message
 */
function showLoading(message) {
  const loadingText = document.getElementById('emailConfirmLoadingText')
  const loadingMessage = document.getElementById('emailConfirmLoadingAlert')
  
  if (loadingText) loadingText.textContent = message
  if (loadingMessage) loadingMessage.classList.remove('hidden')
}

/**
 * Hide loading message
 */
function hideLoading() {
  const loadingMessage = document.getElementById('emailConfirmLoadingAlert')
  if (loadingMessage) loadingMessage.classList.add('hidden')
}

/**
 * Hide all messages
 */
function hideMessages() {
  const errorMessage = document.getElementById('emailConfirmErrorAlert')
  const successMessage = document.getElementById('emailConfirmSuccessAlert')
  const loadingMessage = document.getElementById('emailConfirmLoadingAlert')
  
  if (errorMessage) errorMessage.classList.add('hidden')
  if (successMessage) successMessage.classList.add('hidden')
  if (loadingMessage) loadingMessage.classList.add('hidden')
}
