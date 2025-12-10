/**
 * Email Confirmation Logic
 * Handles email confirmation on the confirm-email.html page
 */

import { supabase } from './index.js'
import { sendConfirmationEmail } from '../Config/emailService.js'

// Get email from URL parameters or localStorage
function getEmailFromParams() {
  const search = new URLSearchParams(window.location.search)
  const hash = window.location.hash || ''
  const hashQuery = hash.includes('?') ? hash.split('?')[1] : ''
  const hashParams = new URLSearchParams(hashQuery)
  const email = search.get('email') || hashParams.get('email') || localStorage.getItem('pendingEmail')
  return email || 'user@example.com'
}

// Get confirmation token from URL parameters
function getTokenFromParams() {
  const search = new URLSearchParams(window.location.search)
  const hash = window.location.hash || ''
  const hashQuery = hash.includes('?') ? hash.split('?')[1] : ''
  const hashParams = new URLSearchParams(hashQuery)
  let token = search.get('token') || search.get('token_hash') || search.get('access_token') || search.get('refresh_token')
  if (!token) {
    token = hashParams.get('token') || hashParams.get('token_hash') || hashParams.get('access_token') || hashParams.get('refresh_token')
  }
  return token
}

function getTypeFromParams() {
  const search = new URLSearchParams(window.location.search)
  const hash = window.location.hash || ''
  const hashQuery = hash.includes('?') ? hash.split('?')[1] : ''
  const hashParams = new URLSearchParams(hashQuery)
  return search.get('type') || hashParams.get('type') || 'signup'
}

// Update email display
function updateEmailDisplay() {
  const emailDisplay = document.getElementById('emailDisplay')
  const email = getEmailFromParams()
  if (emailDisplay) {
    emailDisplay.textContent = email
  }
}

// Handle confirm email button click
async function handleConfirmEmail() {
  const confirmEmailBtn = document.getElementById('confirmEmailBtn')
  const email = getEmailFromParams()
  const token = getTokenFromParams()
  const type = getTypeFromParams()
  
  // Show loading state
  confirmEmailBtn.innerHTML = `
    <i data-lucide="loader-2" class="w-5 h-5 animate-spin mr-2"></i>
    Confirming...
  `
  confirmEmailBtn.disabled = true

  try {
    if (!supabase) {
      throw new Error('Supabase not configured')
    }

    if (!token) {
      throw new Error('No confirmation token found. Please check your email and click the confirmation link.')
    }

    // Verify the email using Supabase's verifyOtp function
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type })

    if (error) {
      const search = new URLSearchParams(window.location.search)
      const hash = window.location.hash || ''
      const hashQuery = hash.includes('?') ? hash.split('?')[1] : ''
      const hashParams = new URLSearchParams(hashQuery)
      const accessToken = search.get('access_token') || hashParams.get('access_token')
      const refreshToken = search.get('refresh_token') || hashParams.get('refresh_token')
      if (accessToken && refreshToken) {
        const setRes = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        if (setRes?.error) throw new Error(setRes.error.message)
      } else {
        throw new Error(error.message)
      }
    }

    // Show success state
    confirmEmailBtn.innerHTML = `
      <i data-lucide="check" class="w-5 h-5 mr-2"></i>
      Email Confirmed!
    `
    confirmEmailBtn.classList.remove('from-purple-500', 'to-pink-600', 'hover:from-purple-600', 'hover:to-pink-700')
    confirmEmailBtn.classList.add('from-green-500', 'to-emerald-600', 'hover:from-green-600', 'hover:to-emerald-700')
    
    localStorage.removeItem('pendingEmail')
    try {
      localStorage.setItem('emailVerified', 'true')
      localStorage.setItem('verifiedEmail', email)
    } catch {}
    
    // Redirect to login after 2 seconds
    setTimeout(() => {
      window.location.href = '#login'
    }, 2000)

  } catch (error) {
    console.error('Email confirmation error:', error)
    
    // Show error state
    confirmEmailBtn.innerHTML = `
      <i data-lucide="x" class="w-5 h-5 mr-2"></i>
      Confirmation Failed
    `
    confirmEmailBtn.classList.remove('from-purple-500', 'to-pink-600', 'hover:from-purple-600', 'hover:to-pink-700')
    confirmEmailBtn.classList.add('from-red-500', 'to-red-600', 'hover:from-red-600', 'hover:to-red-700')
    
    // Show error message
    const errorMessage = document.createElement('div')
    errorMessage.className = 'mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm'
    errorMessage.textContent = error.message || 'Failed to confirm email. Please try again.'
    
    // Insert error message after the button
    confirmEmailBtn.parentNode.insertBefore(errorMessage, confirmEmailBtn.nextSibling)
    
    // Reset button after 5 seconds
    setTimeout(() => {
      confirmEmailBtn.innerHTML = 'Confirm Email'
      confirmEmailBtn.classList.remove('from-red-500', 'to-red-600', 'hover:from-red-600', 'hover:to-red-700')
      confirmEmailBtn.classList.add('from-purple-500', 'to-pink-600', 'hover:from-purple-600', 'hover:to-pink-700')
      confirmEmailBtn.disabled = false
      
      // Remove error message
      if (errorMessage.parentNode) {
        errorMessage.parentNode.removeChild(errorMessage)
      }
    }, 5000)
  }
}

// Handle resend email button click
async function handleResendEmail() {
  const resendEmailBtn = document.getElementById('resendEmailBtn')
  const email = getEmailFromParams()
  
  // Show loading state
  resendEmailBtn.innerHTML = `
    <i data-lucide="loader-2" class="w-5 h-5 animate-spin mr-2"></i>
    Sending...
  `
  resendEmailBtn.disabled = true

  try {
    // Call the Edge Function to resend confirmation email
    const confirmationUrl = `${window.location.origin}/#confirm-email`
    const emailResult = await sendConfirmationEmail(email, confirmationUrl)
    
    if (!emailResult.success) {
      throw new Error(emailResult.error || 'Failed to send confirmation email')
    }
    
    // Show success state
    resendEmailBtn.innerHTML = `
      <i data-lucide="check" class="w-5 h-5 mr-2"></i>
      Email Sent!
    `
    resendEmailBtn.classList.remove('bg-white/5', 'hover:bg-white/10', 'border-white/10')
    resendEmailBtn.classList.add('bg-green-500/20', 'border-green-500/30', 'text-green-400')
    
    // Reset button after 3 seconds
    setTimeout(() => {
      resendEmailBtn.innerHTML = 'Resend Confirmation Email'
      resendEmailBtn.classList.remove('bg-green-500/20', 'border-green-500/30', 'text-green-400')
      resendEmailBtn.classList.add('bg-white/5', 'hover:bg-white/10', 'border-white/10', 'text-white/70')
      resendEmailBtn.disabled = false
    }, 3000)

  } catch (error) {
    console.error('Resend email error:', error)
    
    // Show error state
    resendEmailBtn.innerHTML = `
      <i data-lucide="x" class="w-5 h-5 mr-2"></i>
      Failed to Send
    `
    resendEmailBtn.classList.remove('bg-white/5', 'hover:bg-white/10', 'border-white/10')
    resendEmailBtn.classList.add('bg-red-500/20', 'border-red-500/30', 'text-red-400')
    
    // Reset button after 3 seconds
    setTimeout(() => {
      resendEmailBtn.innerHTML = 'Resend Confirmation Email'
      resendEmailBtn.classList.remove('bg-red-500/20', 'border-red-500/30', 'text-red-400')
      resendEmailBtn.classList.add('bg-white/5', 'hover:bg-white/10', 'border-white/10', 'text-white/70')
      resendEmailBtn.disabled = false
    }, 3000)
  }
}

// Initialize the confirm email page
export function initConfirmEmailPage() {
  const confirmEmailBtn = document.getElementById('confirmEmailBtn')
  const resendEmailBtn = document.getElementById('resendEmailBtn')
  const landingLoginBtn = document.getElementById('landingLoginBtn')

  console.log('Initializing confirm email page...')
  console.log('Confirm button found:', !!confirmEmailBtn)
  console.log('Resend button found:', !!resendEmailBtn)
  console.log('Login button found:', !!landingLoginBtn)

  // Update email display
  updateEmailDisplay()

  // Event listeners
  if (confirmEmailBtn) {
    console.log('Adding click listener to confirm button')
    confirmEmailBtn.addEventListener('click', handleConfirmEmail)
  } else {
    console.error('Confirm email button not found!')
  }

  if (resendEmailBtn) {
    console.log('Adding click listener to resend button')
    resendEmailBtn.addEventListener('click', handleResendEmail)
  } else {
    console.log('Resend email button not found (this is OK if removed)')
  }

  if (landingLoginBtn) {
    console.log('Adding click listener to login button')
    landingLoginBtn.addEventListener('click', () => {
      window.location.href = '#login'
    })
  } else {
    console.error('Login button not found!')
  }

  // Initialize Lucide icons
  if (window.safeCreateIcons) {
    window.safeCreateIcons()
  }

  // Check if we have a token in the URL (for display purposes only)
  const token = getTokenFromParams()
  if (token && confirmEmailBtn) {
    setTimeout(() => { handleConfirmEmail() }, 500)
  }
}

// Auto-initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initConfirmEmailPage)
