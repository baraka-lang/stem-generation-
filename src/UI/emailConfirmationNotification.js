/**
 * Email Confirmation Notification
 * Shows a notification banner when user needs to confirm their email
 */

/**
 * Show email confirmation notification
 * @param {string} email - User's email address
 */
export function showEmailConfirmationNotification(email) {
    const container = document.getElementById('checkEmailNotification')
    if (!container) {
        console.warn('checkEmailNotification not found')
        return
    }

    // Remove any existing notification
    const existingNotification = container.querySelector('.email-confirmation-notification')
    if (existingNotification) {
        existingNotification.remove()
    }

    // Create notification element
    const notification = document.createElement('div')
    notification.className = 'email-confirmation-notification'
    notification.innerHTML = `
    <div class="mx-2 mt-2 mb-2 p-2 bg-blue-500/20 border border-blue-500/30 rounded-lg text-blue-400 text-sm animate-in">
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0 mt-0.5">
          <i data-lucide="mail" class="w-5 h-5"></i>
        </div>
        <div class="flex-1">
          <p class="font-medium mb-1">Confirm your email address @ <strong>${email}</strong></p>
          <div class="flex items-center justify-center space-x-2">
            <button id="resendConfirmationEmailBtn" class="px-2 py-1 text-xs rounded-md border border-white/15 hover:bg-white/10 flex items-center justify-center" title="Resend Confirmation Email">
              <i data-lucide="mail" class="w-4 h-4"></i>
              Resend Confirmation Email
            </button>
            <button id="checkEmailNotVerifiedBtn" class="px-2 py-1 text-xs rounded-md border border-white/15 hover:bg-white/10 flex items-center justify-center hidden" title="Check Email Not Verified">
              <i data-lucide="alert-circle" class="w-4 h-4"></i>
              Check Email Not Verified
            </button>
          </div>
        </div>
        <button onclick="this.closest('.email-confirmation-notification').remove()" 
                class="flex-shrink-0 text-blue-400/60 hover:text-blue-400 transition-colors">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
    </div>
  `

    container.appendChild(notification)

    // Initialize Lucide icons
    if (window.safeCreateIcons) {
        window.safeCreateIcons()
    }

    // Set up resend confirmation email button
    const resendBtn = notification.querySelector('#resendConfirmationEmailBtn')
    if (resendBtn) {
        resendBtn.addEventListener('click', async () => {
            await handleResendConfirmationEmail(email, resendBtn)
        })
    } else {
        console.warn('resendConfirmationEmailBtn not found')
    }

    // Set up check email not verified button
    const checkBtn = notification.querySelector('#checkEmailNotVerifiedBtn')
    if (checkBtn) {
        checkBtn.addEventListener('click', async () => {
            await handleCheckEmailNotVerified(email, checkBtn, notification)
        })
    } else {
        console.warn('checkEmailNotVerifiedBtn not found')
    }
}

/**
 * Handle check email not verified button click
 * @param {string} email - User's email address
 * @param {HTMLElement} button - The check button element
 * @param {HTMLElement} notification - The notification container
 */
async function handleCheckEmailNotVerified(email, button, notification) {
    // Show loading state
    const originalHTML = button.innerHTML
    button.innerHTML = `
        <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>
        <span class="ml-1">Checking...</span>
    `
    button.disabled = true
    
    // Reinitialize icons for the spinner
    if (window.safeCreateIcons) {
        window.safeCreateIcons()
    }

    try {
        // Import Supabase client and auth guard
        const { supabase } = await import('../Auth/index.js')
        const { getAuthGuard } = await import('../Auth/authGuard.js')
        
        if (!supabase) {
            throw new Error('Supabase not configured')
        }

        // First, try to refresh the session to get latest user data
        // This is important because email confirmation might have just happened
        let refreshedSession = null
        let refreshedUser = null
        
        try {
            // Get current session
            const sessionResult = await supabase.auth.getSession()
            refreshedSession = sessionResult.data?.session || null
            
            // If we have a session, try to refresh it to get latest user data
            if (refreshedSession && refreshedSession.access_token) {
                // Force refresh by calling getUser() which fetches from server
                // This should return the most up-to-date user data including email_confirmed_at
                const userResult = await supabase.auth.getUser()
                refreshedUser = userResult.data?.user || null
                
                // If getUser() returned user data, use it (it's fresher than session)
                if (refreshedUser) {
                    console.log('Got fresh user data from getUser()')
                    
                    // If the session user is different from refreshed user, update session
                    if (refreshedSession.user && refreshedUser.id === refreshedSession.user.id) {
                        // Update session with fresh user data
                        refreshedSession.user = refreshedUser
                    }
                }
            } else {
                console.log('No active session found - user might not be logged in')
            }
        } catch (userError) {
            // getUser() might fail if user is not authenticated - that's OK
            console.log('Error refreshing user data (user might not be logged in):', userError)
        }
        
        // Use refreshed user data if available, otherwise fall back to session user
        const currentUser = refreshedUser || refreshedSession?.user || null

        console.log('Email verification check - raw data:', {
            refreshedUser: refreshedUser ? {
                email: refreshedUser.email,
                email_confirmed_at: refreshedUser.email_confirmed_at,
                id: refreshedUser.id
            } : null,
            sessionUser: refreshedSession?.user ? {
                email: refreshedSession.user.email,
                email_confirmed_at: refreshedSession.user.email_confirmed_at,
                id: refreshedSession.user.id
            } : null,
            currentUser: currentUser ? {
                email: currentUser.email,
                email_confirmed_at: currentUser.email_confirmed_at,
                id: currentUser.id
            } : null,
            targetEmail: email
        })

        // Check if we have a user matching the email
        if (currentUser && currentUser.email === email) {
            // Check if email is confirmed
            // email_confirmed_at is a timestamp - if it exists (not null/undefined), email is confirmed
            const emailConfirmedAt = currentUser.email_confirmed_at
            
            // More robust check: any truthy value means confirmed
            // Check for null, undefined, empty string, or invalid timestamp
            const isEmailConfirmed = emailConfirmedAt !== null && 
                                    emailConfirmedAt !== undefined && 
                                    emailConfirmedAt !== '' &&
                                    (typeof emailConfirmedAt === 'string' ? emailConfirmedAt.trim().length > 0 : true) &&
                                    (typeof emailConfirmedAt === 'string' ? !isNaN(Date.parse(emailConfirmedAt)) : true)
            
            console.log('Email verification check:', {
                email: currentUser.email,
                email_confirmed_at: emailConfirmedAt,
                type: typeof emailConfirmedAt,
                isEmailConfirmed,
                truthy: !!emailConfirmedAt,
                isNull: emailConfirmedAt === null,
                isUndefined: emailConfirmedAt === undefined,
                isEmpty: emailConfirmedAt === '',
                isValidTimestamp: typeof emailConfirmedAt === 'string' ? !isNaN(Date.parse(emailConfirmedAt)) : 'N/A'
            })
            
            if (isEmailConfirmed) {
                // Email is confirmed - update notification to success
                button.innerHTML = `
                    <i data-lucide="check-circle" class="w-4 h-4"></i>
                    <span class="ml-1">Verified!</span>
                `
                button.classList.remove('border-white/15', 'hover:bg-white/10')
                button.classList.add('bg-green-500/20', 'border-green-500/30', 'text-green-400')
                
                // Reinitialize icons
                if (window.safeCreateIcons) {
                    window.safeCreateIcons()
                }

                // Update notification to show success
                setTimeout(async () => {
                    const { showEmailConfirmedNotification } = await import('./emailConfirmationNotification.js')
                    showEmailConfirmedNotification(email)
                    localStorage.removeItem('pendingEmail')
                }, 1000)
            } else {
                // Email still not confirmed
                button.innerHTML = `
                    <i data-lucide="alert-circle" class="w-4 h-4"></i>
                    <span class="ml-1">Not Verified</span>
                `
                button.classList.remove('border-white/15', 'hover:bg-white/10')
                button.classList.add('bg-yellow-500/20', 'border-yellow-500/30', 'text-yellow-400')
                
                // Reinitialize icons
                if (window.safeCreateIcons) {
                    window.safeCreateIcons()
                }

                // Reset button after 3 seconds
                setTimeout(() => {
                    button.innerHTML = originalHTML
                    button.classList.remove('bg-yellow-500/20', 'border-yellow-500/30', 'text-yellow-400')
                    button.classList.add('border-white/15', 'hover:bg-white/10')
                    button.disabled = false
                    
                    // Reinitialize icons
                    if (window.safeCreateIcons) {
                        window.safeCreateIcons()
                    }
                }, 3000)
            }
        } else {
            // No user found matching the email - they might not be logged in
            // Check if there's a pending email in localStorage
            const pendingEmail = localStorage.getItem('pendingEmail')
            
            if (pendingEmail === email) {
                // User has pending email but not logged in - email likely not verified yet
                button.innerHTML = `
                    <i data-lucide="alert-circle" class="w-4 h-4"></i>
                    <span class="ml-1">Not Verified</span>
                `
                button.classList.remove('border-white/15', 'hover:bg-white/10')
                button.classList.add('bg-yellow-500/20', 'border-yellow-500/30', 'text-yellow-400')
                
                // Reinitialize icons
                if (window.safeCreateIcons) {
                    window.safeCreateIcons()
                }

                // Reset button after 3 seconds
                setTimeout(() => {
                    button.innerHTML = originalHTML
                    button.classList.remove('bg-yellow-500/20', 'border-yellow-500/30', 'text-yellow-400')
                    button.classList.add('border-white/15', 'hover:bg-white/10')
                    button.disabled = false
                    
                    // Reinitialize icons
                    if (window.safeCreateIcons) {
                        window.safeCreateIcons()
                    }
                }, 3000)
            } else {
                // No user found and no pending email - might be verified but not logged in
                button.innerHTML = `
                    <i data-lucide="info" class="w-4 h-4"></i>
                    <span class="ml-1">Please log in</span>
                `
                button.classList.remove('border-white/15', 'hover:bg-white/10')
                button.classList.add('bg-blue-500/20', 'border-blue-500/30', 'text-blue-400')
                
                // Reinitialize icons
                if (window.safeCreateIcons) {
                    window.safeCreateIcons()
                }

                // Reset button after 3 seconds
                setTimeout(() => {
                    button.innerHTML = originalHTML
                    button.classList.remove('bg-blue-500/20', 'border-blue-500/30', 'text-blue-400')
                    button.classList.add('border-white/15', 'hover:bg-white/10')
                    button.disabled = false
                    
                    // Reinitialize icons
                    if (window.safeCreateIcons) {
                        window.safeCreateIcons()
                    }
                }, 3000)
            }
        }
    } catch (error) {
        console.error('Check email verification error:', error)
        
        // Show error state
        button.innerHTML = `
            <i data-lucide="alert-circle" class="w-4 h-4"></i>
            <span class="ml-1">Error</span>
        `
        button.classList.remove('border-white/15', 'hover:bg-white/10')
        button.classList.add('bg-red-500/20', 'border-red-500/30', 'text-red-400')
        
        // Reinitialize icons
        if (window.safeCreateIcons) {
            window.safeCreateIcons()
        }

        // Reset button after 3 seconds
        setTimeout(() => {
            button.innerHTML = originalHTML
            button.classList.remove('bg-red-500/20', 'border-red-500/30', 'text-red-400')
            button.classList.add('border-white/15', 'hover:bg-white/10')
            button.disabled = false
            
            // Reinitialize icons
            if (window.safeCreateIcons) {
                window.safeCreateIcons()
            }
        }, 3000)
    }
}

/**
 * Handle resend confirmation email button click
 * @param {string} email - User's email address
 * @param {HTMLElement} button - The resend button element
 */
async function handleResendConfirmationEmail(email, button) {
    // Show loading state
    const originalHTML = button.innerHTML
    button.innerHTML = `
        <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>
        <span class="ml-1">Sending...</span>
    `
    button.disabled = true
    
    // Reinitialize icons for the spinner
    if (window.safeCreateIcons) {
        window.safeCreateIcons()
    }

    try {
        // Import Supabase client
        const { supabase } = await import('../Auth/index.js')
        
        if (!supabase) {
            throw new Error('Supabase not configured')
        }

        // Get confirmation URL for redirect after email confirmation
        const confirmationUrl = `${window.location.origin}/#confirm-email`
        
        // Use Supabase's built-in resend confirmation email
        const { error } = await supabase.auth.resend({
            type: 'signup',
            email: email,
            options: {
                emailRedirectTo: confirmationUrl
            }
        })

        if (!error) {
            // Show success state
            button.innerHTML = `
                <i data-lucide="check" class="w-4 h-4"></i>
                <span class="ml-1">Email Sent!</span>
            `
            button.classList.remove('border-white/15', 'hover:bg-white/10')
            button.classList.add('bg-green-500/20', 'border-green-500/30', 'text-green-400')
            
            // Reinitialize icons
            if (window.safeCreateIcons) {
                window.safeCreateIcons()
            }

            // Reset button after 3 seconds
            setTimeout(() => {
                button.innerHTML = originalHTML
                button.classList.remove('bg-green-500/20', 'border-green-500/30', 'text-green-400')
                button.classList.add('border-white/15', 'hover:bg-white/10')
                button.disabled = false
                
                // Reinitialize icons
                if (window.safeCreateIcons) {
                    window.safeCreateIcons()
                }
            }, 3000)
        } else {
            throw new Error(result.error || 'Failed to send confirmation email')
        }
    } catch (error) {
        console.error('Resend confirmation email error:', error)
        
        // Show error state
        button.innerHTML = `
            <i data-lucide="alert-circle" class="w-4 h-4"></i>
            <span class="ml-1">Failed</span>
        `
        button.classList.remove('border-white/15', 'hover:bg-white/10')
        button.classList.add('bg-red-500/20', 'border-red-500/30', 'text-red-400')
        
        // Reinitialize icons
        if (window.safeCreateIcons) {
            window.safeCreateIcons()
        }

        // Reset button after 3 seconds
        setTimeout(() => {
            button.innerHTML = originalHTML
            button.classList.remove('bg-red-500/20', 'border-red-500/30', 'text-red-400')
            button.classList.add('border-white/15', 'hover:bg-white/10')
            button.disabled = false
            
            // Reinitialize icons
            if (window.safeCreateIcons) {
                window.safeCreateIcons()
            }
        }, 3000)
    }
}

/**
 * Show email confirmed notification
 * @param {string} email - User's email address
 */
export function showEmailConfirmedNotification(email) {
    const container = document.getElementById('checkEmailNotification')
    if (!container) {
        console.warn('checkEmailNotification not found')
        return
    }

    // Remove any existing notification
    const existingNotification = container.querySelector('.email-confirmation-notification')
    if (existingNotification) {
        existingNotification.remove()
    }

    // Create success notification
    const notification = document.createElement('div')
    notification.className = 'email-confirmation-notification'
    notification.innerHTML = `
    <div class="mx-4 mb-4 p-4 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 text-sm animate-in hidden">
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0 mt-0.5">
          <i data-lucide="check-circle" class="w-5 h-5"></i>
        </div>
        <div class="flex-1">
          <p class="font-medium mb-1">Email confirmed successfully!</p>
          <p class="text-green-300/80 text-xs">
            Your email <strong>${email}</strong> has been verified. You can now use all features.
          </p>
        </div>
        <button onclick="this.closest('.email-confirmation-notification').remove()" 
                class="flex-shrink-0 text-green-400/60 hover:text-green-400 transition-colors">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
    </div>
  `

    container.appendChild(notification)

    // Initialize Lucide icons
    if (window.safeCreateIcons) {
        window.safeCreateIcons()
    }

    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.classList.add('animate-out')
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove()
            }
        }, 300)
    }, 5000)
}

/**
 * Hide email confirmation notification
 */
export function hideEmailConfirmationNotification() {
    const container = document.getElementById('checkEmailNotification')
    if (!container) return

    const notification = container.querySelector('.email-confirmation-notification')
    if (notification) {
        notification.classList.add('animate-out')
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove()
            }
        }, 300)
    }
}

/**
 * Check if user has pending email confirmation
 * @returns {Promise<boolean>} True if user needs to confirm email
 */
export async function hasPendingEmailConfirmation() {
    const pendingEmail = localStorage.getItem('pendingEmail')
    if (!pendingEmail) return false

    // Check if user is authenticated and email is confirmed
    try {
        const { getAuthGuard } = await import('../Auth/authGuard.js')
        const authGuard = getAuthGuard()
        const currentUser = authGuard.getCurrentUser()

        // If user is authenticated and email is confirmed, clear pending email
        if (currentUser && currentUser.email_confirmed_at) {
            localStorage.removeItem('pendingEmail')
            return false
        }

        // If user is authenticated but email not confirmed, show notification
        if (currentUser && !currentUser.email_confirmed_at) {
            return true
        }
    } catch (error) {
        console.error('Error checking email confirmation:', error)
    }

    return !!pendingEmail
}

/**
 * Update notification based on current auth state
 */
export async function updateEmailConfirmationNotification() {
    try {
        const { getAuthGuard } = await import('../Auth/authGuard.js')
        const authGuard = getAuthGuard()
        const currentUser = authGuard.getCurrentUser()
        const pendingEmail = localStorage.getItem('pendingEmail')

        if (currentUser && currentUser.email_confirmed_at) {
            showEmailConfirmedNotification(currentUser.email || pendingEmail || '')
            localStorage.removeItem('pendingEmail')
            return
        }

        if (currentUser && !currentUser.email_confirmed_at) {
            showEmailConfirmationNotification(currentUser.email || pendingEmail || '')
            return
        }

        if (pendingEmail) {
            showEmailConfirmationNotification(pendingEmail)
            return
        }

        hideEmailConfirmationNotification()
    } catch (error) {
        console.error('Error updating email confirmation notification:', error)
        const pendingEmail = localStorage.getItem('pendingEmail')
        if (pendingEmail) {
            showEmailConfirmationNotification(pendingEmail)
        } else {
            hideEmailConfirmationNotification()
        }
    }
}

