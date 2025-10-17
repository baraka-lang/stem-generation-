/**
 * Simplified User Profile Management Module
 * Handles only credits management - email/user data managed by Supabase auth
 */

import { supabase } from './index.js'

/**
 * Get user profile from database (credits only)
 * Note: Email comes from auth.users table
 * @param {string} userId - User's UUID
 * @returns {Promise<{profile: Object | null, error: Error | null}>}
 */
export async function getUserProfile(userId) {
  if (!supabase) {
    console.warn('Supabase not configured - cannot get user profile')
    return { profile: null, error: { message: 'Supabase not configured' } }
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, credits, created_at, updated_at')
      .eq('id', userId)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') {
        // Profile doesn't exist yet - should be created by trigger
        console.log('Profile not found for user:', userId)
        return { profile: null, error: null }
      }
      console.error('Get user profile error:', error.message)
      return { profile: null, error }
    }
    
    return { profile: data, error: null }
  } catch (error) {
    console.error('Get user profile exception:', error)
    return { profile: null, error: { message: 'An unexpected error occurred' } }
  }
}

/**
 * Create a new user profile (credits only)
 * Note: This should be handled automatically by database trigger
 * @param {string} userId - User's UUID
 * @param {number} initialCredits - Initial credit balance
 * @returns {Promise<{profile: Object | null, error: Error | null}>}
 */
export async function createUserProfile(userId, initialCredits = 100) {
  if (!supabase) {
    console.warn('Supabase not configured - cannot create user profile')
    return { profile: null, error: { message: 'Supabase not configured' } }
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .insert([
        {
          id: userId,
          credits: initialCredits
        }
      ])
      .select()
      .single()
    
    if (error) {
      console.error('Create user profile error:', error.message)
      return { profile: null, error }
    }
    
    console.log('User profile created:', data)
    return { profile: data, error: null }
  } catch (error) {
    console.error('Create user profile exception:', error)
    return { profile: null, error: { message: 'An unexpected error occurred' } }
  }
}

/**
 * Update user credits (add or subtract)
 * @param {string} userId - User's UUID
 * @param {number} amount - Amount to add (positive) or subtract (negative)
 * @returns {Promise<{profile: Object | null, error: Error | null}>}
 */
export async function updateCredits(userId, amount) {
  if (!supabase) {
    console.warn('Supabase not configured - cannot update credits')
    return { profile: null, error: { message: 'Supabase not configured' } }
  }

  try {
    // First get current profile to check current credits
    const { profile: currentProfile, error: fetchError } = await getUserProfile(userId)
    
    if (fetchError) {
      return { profile: null, error: fetchError }
    }
    
    if (!currentProfile) {
      return { profile: null, error: { message: 'User profile not found' } }
    }
    
    const newCredits = Math.max(0, currentProfile.credits + amount)
    
    // Update credits in database
    const { data, error } = await supabase
      .from('profiles')
      .update({ 
        credits: newCredits,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single()
    
    if (error) {
      console.error('Update credits error:', error.message)
      return { profile: null, error }
    }
    
    console.log('Credits updated:', { userId, amount, newCredits })
    return { profile: data, error: null }
  } catch (error) {
    console.error('Update credits exception:', error)
    return { profile: null, error: { message: 'An unexpected error occurred' } }
  }
}

/**
 * Get current credits for a user
 * @param {string} userId - User's UUID
 * @returns {Promise<{credits: number, error: Error | null}>}
 */
export async function getCredits(userId) {
  try {
    const { profile, error } = await getUserProfile(userId)
    
    if (error) {
      return { credits: 0, error }
    }
    
    if (!profile) {
      // Create profile with default credits if it doesn't exist
      const { profile: newProfile, error: createError } = await createUserProfile(userId, 100)
      
      if (createError) {
        return { credits: 0, error: createError }
      }
      
      return { credits: newProfile.credits, error: null }
    }
    
    return { credits: profile.credits, error: null }
  } catch (error) {
    console.error('Get credits exception:', error)
    return { credits: 0, error: { message: 'An unexpected error occurred' } }
  }
}

/**
 * Check if user has sufficient credits
 * @param {string} userId - User's UUID
 * @param {number} requiredCredits - Credits required for the operation
 * @returns {Promise<{hasCredits: boolean, currentCredits: number, error: Error | null}>}
 */
export async function checkCredits(userId, requiredCredits) {
  try {
    const { credits, error } = await getCredits(userId)
    
    if (error) {
      return { hasCredits: false, currentCredits: 0, error }
    }
    
    return { 
      hasCredits: credits >= requiredCredits, 
      currentCredits: credits, 
      error: null 
    }
  } catch (error) {
    console.error('Check credits exception:', error)
    return { hasCredits: false, currentCredits: 0, error: { message: 'An unexpected error occurred' } }
  }
}

/**
 * Update user profile data (credits only)
 * Note: Email updates are not supported - handled by Supabase auth
 * @param {string} userId - User's UUID
 * @param {Object} updates - Profile fields to update (credits only)
 * @returns {Promise<{profile: Object | null, error: Error | null}>}
 */
export async function updateUserProfile(userId, updates) {
  try {
    const updateData = {
      ...updates,
      updated_at: new Date().toISOString()
    }
    
    const { data, error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single()
    
    if (error) {
      console.error('Update user profile error:', error.message)
      return { profile: null, error }
    }
    
    console.log('User profile updated:', data)
    return { profile: data, error: null }
  } catch (error) {
    console.error('Update user profile exception:', error)
    return { profile: null, error: { message: 'An unexpected error occurred' } }
  }
}

/**
 * Initialize user profile on first login/signup
 * Note: Profile should be created automatically by database trigger
 * @param {Object} user - Supabase user object
 * @returns {Promise<{profile: Object | null, error: Error | null}>}
 */
export async function initializeUserProfile(user) {
  try {
    // Check if profile already exists
    const { profile: existingProfile, error: fetchError } = await getUserProfile(user.id)
    
    if (fetchError) {
      return { profile: null, error: fetchError }
    }
    
    if (existingProfile) {
      // Profile already exists
      return { profile: existingProfile, error: null }
    }
    
    // Create new profile if trigger didn't work
    console.log('Creating profile manually for user:', user.id)
    return await createUserProfile(user.id, 100)
  } catch (error) {
    console.error('Initialize user profile exception:', error)
    return { profile: null, error: { message: 'An unexpected error occurred' } }
  }
}
