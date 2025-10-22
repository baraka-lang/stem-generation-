/**
 * Supabase Authentication Module
 * Centralized authentication functions using Supabase Auth
 */

import { createClient } from '@supabase/supabase-js'
import { sendPasswordResetEmail, sendConfirmationEmail, sendWelcomeEmail } from '../Config/emailService.js'

// Check if Supabase environment variables are loaded
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Initialize Supabase client only if environment variables are available
let supabase = null

if (supabaseUrl && supabaseAnonKey) {
  console.log('🔗 Supabase environment variables loaded, initializing client...')
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // Disable automatic token refresh to prevent frequent auth state changes
      autoRefreshToken: false,
      // Disable automatic session persistence to reduce auth checks
      persistSession: true,
      // Reduce the frequency of auth state checks
      detectSessionInUrl: false
    }
  })
} else {
  console.warn('⚠️ Supabase environment variables not found in .env file')
  console.log('Available env vars:', {
    VITE_SUPABASE_URL: !!supabaseUrl,
    VITE_SUPABASE_ANON_KEY: !!supabaseAnonKey
  })
}

/**
 * Sign up a new user with email and password
 * @param {string} email - User's email address
 * @param {string} password - User's password
 * @param {string} fullName - User's full name
 * @returns {Promise<{user: User | null, error: AuthError | null}>}
 */
export async function signUp(email, password, fullName) {
  if (!supabase) {
    const error = { message: 'Supabase not configured. Please check your .env file.' }
    console.error('Sign up error:', error.message)
    return { user: null, error }
  }

  try {
    // Create user WITHOUT triggering Supabase's default email confirmation
    // We'll handle all email confirmation via our custom Edge Function
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName
        },
        emailRedirectTo: null, // Disable default email redirect
        captchaToken: null
      }
    })
    
    if (error) {
      console.error('Sign up error:', error.message)
      return { user: null, error }
    }
    
    // Check if this is an existing user or new user
    const userCreatedAt = new Date(data.user.created_at)
    const now = new Date()
    const timeDiff = now.getTime() - userCreatedAt.getTime()
    const isRecentUser = timeDiff < 5 * 60 * 1000 // 5 minutes in milliseconds
    
    // Send confirmation email ONLY via our custom Edge Function
    if (data.user && !data.user.email_confirmed_at) {
      const confirmationUrl = `${window.location.origin}#confirm-email`
      const emailResult = await sendConfirmationEmail(email, confirmationUrl)
      
      if (!emailResult.success) {
        console.error('Custom confirmation email failed:', emailResult.error)
        return { user: null, error: { message: 'Failed to send confirmation email' } }
      } else {
        console.log('Custom confirmation email sent to:', email)
      }
      
      // Return different response based on whether user is new or existing
      if (isRecentUser) {
        console.log('New user signup successful:', data.user?.email)
        return { user: data.user, error: null, isNewUser: true }
      } else {
        console.log('Existing user - confirmation email sent:', data.user?.email)
        return { user: data.user, error: null, isNewUser: false }
      }
    }
    
    console.log('Sign up successful:', data.user?.email)
    return { user: data.user, error: null, isNewUser: true }
  } catch (error) {
    console.error('Sign up exception:', error)
    return { user: null, error: { message: 'An unexpected error occurred' } }
  }
}

/**
 * Sign in with email and password
 * @param {string} email - User's email address
 * @param {string} password - User's password
 * @returns {Promise<{user: User | null, error: AuthError | null}>}
 */
export async function signIn(email, password) {
  if (!supabase) {
    const error = { message: 'Supabase not configured. Please check your .env file.' }
    console.error('Sign in error:', error.message)
    return { user: null, error }
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    
    if (error) {
      console.error('Sign in error:', error.message)
      return { user: null, error }
    }
    
    console.log('Sign in successful:', data.user?.email)
    return { user: data.user, error: null }
  } catch (error) {
    console.error('Sign in exception:', error)
    return { user: null, error: { message: 'An unexpected error occurred' } }
  }
}

/**
 * Sign out the current user
 * @returns {Promise<{error: AuthError | null}>}
 */
export async function signOut() {
  console.log('🚪 signOut() called')
  
  if (!supabase) {
    const error = { message: 'Supabase not configured. Please check your .env file.' }
    console.error('Sign out error:', error.message)
    return { error }
  }

  try {
    console.log('🚪 Calling supabase.auth.signOut()...')
    const { error } = await supabase.auth.signOut()
    
    if (error) {
      console.error('Sign out error:', error.message)
      return { error }
    }
    
    console.log('✅ Sign out successful')
    return { error: null }
  } catch (error) {
    console.error('Sign out exception:', error)
    return { error: { message: 'An unexpected error occurred' } }
  }
}

/**
 * Get the current authenticated user
 * @returns {Promise<User | null>}
 */
export async function getCurrentUser() {
  if (!supabase) {
    console.warn('Supabase not configured - cannot get current user')
    return null
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser()
    
    if (error) {
      // Don't log common "no session" errors as errors - they're normal when no user is logged in
      const noSessionErrors = [
        'Auth session missing!',
        'Invalid JWT',
        'JWT expired',
        'No session found'
      ]
      
      if (noSessionErrors.some(errMsg => error.message.includes(errMsg))) {
        console.log('No active session found (user not logged in)')
        return null
      }
      
      console.error('Get current user error:', error.message)
      return null
    }
    
    return user
  } catch (error) {
    console.error('Get current user exception:', error)
    return null
  }
}

/**
 * Listen for authentication state changes
 * @param {Function} callback - Function to call when auth state changes
 * @returns {Function} Unsubscribe function
 */
export function onAuthStateChange(callback) {
  if (!supabase) {
    console.warn('Supabase not configured - auth state change listener not available')
    // Return a no-op unsubscribe function
    return () => {}
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (event, session) => {
      // console.log('Auth state changed:', event, session?.user?.email)
      callback(event, session)
    }
  )
  
  return subscription.unsubscribe
}

/**
 * Check if user is currently authenticated
 * @returns {Promise<boolean>}
 */
export async function isAuthenticated() {
  const user = await getCurrentUser()
  return user !== null
}

/**
 * Get the current session
 * @returns {Promise<Session | null>}
 */
export async function getCurrentSession() {
  if (!supabase) {
    console.warn('Supabase not configured - cannot get current session')
    return null
  }

  try {
    const { data: { session }, error } = await supabase.auth.getSession()
    
    if (error) {
      // Don't log common "no session" errors as errors - they're normal when no user is logged in
      const noSessionErrors = [
        'Auth session missing!',
        'Invalid JWT',
        'JWT expired',
        'No session found'
      ]
      
      if (noSessionErrors.some(errMsg => error.message.includes(errMsg))) {
        console.log('No active session found (user not logged in)')
        return null
      }
      
      console.error('Get session error:', error.message)
      return null
    }
    
    return session
  } catch (error) {
    console.error('Get session exception:', error)
    return null
  }
}

/**
 * Reset password for a user
 * @param {string} email - User's email address
 * @returns {Promise<{error: AuthError | null}>}
 */
export async function resetPassword(email) {
  if (!supabase) {
    const error = { message: 'Supabase not configured. Please check your .env file.' }
    console.error('Reset password error:', error.message)
    return { error }
  }

  try {
    // Call the Edge Function - it will generate proper recovery URL internally
    const emailResult = await sendPasswordResetEmail(email)
    
    if (!emailResult.success) {
      console.error('Custom email sending failed:', emailResult.error)
      return { error: { message: 'Failed to send password reset email' } }
    } else {
      console.log('Password reset email sent to:', email)
    }
    
    return { error: null }
  } catch (error) {
    console.error('Reset password exception:', error)
    return { error: { message: 'An unexpected error occurred' } }
  }
}

// Export the supabase client for use in other modules
export { supabase }
