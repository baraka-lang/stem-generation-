/**
 * Profile Page Logic
 * Handles user profile management, account settings, and data management
 */

import { getAuthGuard } from './authGuard.js'
import { signOut } from './index.js'

/**
 * Initialize profile page functionality
 */
export function setupProfilePage() {
  // Use setTimeout to ensure DOM is fully ready
  setTimeout(() => {
    setupEventListeners()
    loadUserProfile()
  }, 100)
}

/**
 * Setup all event listeners for the profile page
 */
function setupEventListeners() {
  // Back to selection button
  const backBtn = document.getElementById('backToSelectionBtn')
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.hash = '/'
      // Fallback: directly show selection page if hash change doesn't work
      setTimeout(() => {
        if (window.showPage) {
          window.showPage('/')
        }
      }, 50)
    })
  }

  // Profile form submission
  const profileForm = document.getElementById('profileForm')
  if (profileForm) {
    profileForm.addEventListener('submit', handleProfileUpdate)
  }

  // Change password button
  const changePasswordBtn = document.getElementById('changePasswordBtn')
  if (changePasswordBtn) {
    changePasswordBtn.addEventListener('click', showChangePasswordModal)
  }

  // Change password modal
  setupChangePasswordModal()

  // Account action buttons
  setupAccountActionButtons()

  // Delete account modal
  setupDeleteAccountModal()
}

/**
 * Load user profile data and populate the form
 */
async function loadUserProfile() {
  try {
    const authGuard = getAuthGuard()
    const currentUser = authGuard.getCurrentUser()
    
    if (!currentUser) {
      showErrorMessage('User not authenticated')
      return
    }

    // Show loading state
    showLoadingState()

    // Load profile data from Supabase
    const profileData = await loadProfileData(currentUser.id)
    
    // Populate form fields
    populateProfileForm(currentUser, profileData)
    
    // Load subscription data
    await loadSubscriptionData(currentUser.id)

  } catch (error) {
    console.error('Error loading profile:', error)
    showErrorMessage('Failed to load profile data')
  } finally {
    hideLoadingState()
  }
}

/**
 * Load profile data from Supabase
 */
async function loadProfileData(userId) {
  try {
    const { supabase } = await import('./index.js')
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Error fetching profile:', error)
      throw error
    }

    return data
  } catch (error) {
    console.error('Error loading profile data:', error)
    return null
  }
}

/**
 * Load subscription data from Supabase
 */
async function loadSubscriptionData(userId) {
  try {
    const { supabase } = await import('./index.js')
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching subscription:', error)
      return
    }

    if (data) {
      updateSubscriptionUI(data)
    }
  } catch (error) {
    console.error('Error loading subscription data:', error)
  }
}

/**
 * Populate the profile form with user data
 */
function populateProfileForm(user, profileData) {
  // Full name
  const fullNameInput = document.getElementById('profileFullName')
  if (fullNameInput && profileData?.full_name) {
    fullNameInput.value = profileData.full_name
  }

  // Email (read-only)
  const emailInput = document.getElementById('profileEmail')
  if (emailInput) {
    emailInput.value = user.email
  }

  // Profile avatar
  updateProfileAvatar(profileData)

  // Member since
  const memberSinceElement = document.getElementById('memberSince')
  if (memberSinceElement) {
    const createdAt = profileData?.created_at || user.created_at
    if (createdAt) {
      const date = new Date(createdAt)
      memberSinceElement.textContent = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    } else {
      memberSinceElement.textContent = 'Unknown'
    }
  }

  // Available credits
  const creditsElement = document.getElementById('availableCredits')
  if (creditsElement) {
    creditsElement.textContent = profileData?.credits || 100
  }
}

/**
 * Update subscription UI elements
 */
function updateSubscriptionUI(subscriptionData) {
  // Subscription tier
  const subscriptionTierElement = document.getElementById('subscriptionTier')
  if (subscriptionTierElement) {
    subscriptionTierElement.textContent = subscriptionData.subscription_tier || 'free'
  }

  // Credit balance
  const creditBalanceElement = document.getElementById('creditBalance')
  if (creditBalanceElement) {
    creditBalanceElement.textContent = subscriptionData.credit_balance || 0
  }
}

/**
 * Update profile avatar display
 */
function updateProfileAvatar(profileData) {
  const avatarElement = document.getElementById('profileAvatar')
  if (!avatarElement) return

  if (profileData?.avatar_url) {
    avatarElement.innerHTML = `<img src="${profileData.avatar_url}" alt="Profile" class="w-full h-full rounded-full object-cover">`
  } else {
    // Show initials or default icon
    const fullName = profileData?.full_name || ''
    if (fullName) {
      const initials = fullName.split(' ').map(name => name[0]).join('').toUpperCase()
      avatarElement.textContent = initials
    } else {
      avatarElement.innerHTML = '<i data-lucide="user" class="w-8 h-8"></i>'
    }
  }
}

/**
 * Handle profile form submission
 */
async function handleProfileUpdate(event) {
  event.preventDefault()
  
  const updateBtn = document.getElementById('updateProfileBtn')
  const updateBtnText = document.getElementById('updateProfileBtnText')
  const updateBtnSpinner = document.getElementById('updateProfileBtnSpinner')
  
  try {
    // Show loading state
    updateBtn.disabled = true
    updateBtnText.textContent = 'Updating...'
    updateBtnSpinner.classList.remove('hidden')

    const authGuard = getAuthGuard()
    const currentUser = authGuard.getCurrentUser()
    
    if (!currentUser) {
      throw new Error('User not authenticated')
    }

    const fullName = document.getElementById('profileFullName').value.trim()
    
    if (!fullName) {
      throw new Error('Full name is required')
    }

    // Update profile in Supabase
    const { supabase } = await import('./index.js')
    const { error } = await supabase
      .from('profiles')
      .update({ 
        full_name: fullName,
        updated_at: new Date().toISOString()
      })
      .eq('id', currentUser.id)

    if (error) {
      throw error
    }

    showSuccessMessage('Profile updated successfully!')

  } catch (error) {
    console.error('Error updating profile:', error)
    showErrorMessage(error.message || 'Failed to update profile')
  } finally {
    // Hide loading state
    updateBtn.disabled = false
    updateBtnText.textContent = 'Update Profile'
    updateBtnSpinner.classList.add('hidden')
  }
}

/**
 * Setup change password modal functionality
 */
function setupChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal')
  const overlay = document.getElementById('changePasswordOverlay')
  const cancelBtn = document.getElementById('changePasswordCancelBtn')
  const form = document.getElementById('changePasswordForm')

  if (!modal || !overlay || !cancelBtn || !form) return

  // Close modal handlers
  const closeModal = () => {
    modal.classList.add('opacity-0')
    modal.querySelector('.relative').classList.remove('scale-100')
    modal.querySelector('.relative').classList.add('scale-95')
    
    setTimeout(() => {
      modal.classList.add('hidden')
      // Clear form
      form.reset()
      hideChangePasswordMessages()
    }, 300)
  }

  overlay.addEventListener('click', closeModal)
  cancelBtn.addEventListener('click', closeModal)

  // Form submission
  form.addEventListener('submit', handleChangePassword)
}

/**
 * Show change password modal
 */
function showChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal')
  if (!modal) return

  modal.classList.remove('hidden')
  
  setTimeout(() => {
    modal.classList.remove('opacity-0')
    modal.querySelector('.relative').classList.remove('scale-95')
    modal.querySelector('.relative').classList.add('scale-100')
  }, 10)
}

/**
 * Handle change password form submission
 */
async function handleChangePassword(event) {
  event.preventDefault()
  
  const submitBtn = document.getElementById('changePasswordSubmitBtn')
  const btnText = document.getElementById('changePasswordBtnText')
  const btnSpinner = document.getElementById('changePasswordBtnSpinner')
  
  try {
    // Show loading state
    submitBtn.disabled = true
    btnText.textContent = 'Changing...'
    btnSpinner.classList.remove('hidden')

    // Small delay to ensure form is fully rendered
    await new Promise(resolve => setTimeout(resolve, 100))

    const currentPasswordElement = document.getElementById('currentPassword')
    const newPasswordElement = document.getElementById('newPasswordProfile')
    const confirmPasswordElement = document.getElementById('confirmNewPasswordProfile')

    if (!currentPasswordElement || !newPasswordElement || !confirmPasswordElement) {
      throw new Error('Password form elements not found')
    }

    const currentPassword = currentPasswordElement.value.trim()
    const newPassword = newPasswordElement.value.trim()
    const confirmPassword = confirmPasswordElement.value.trim()

 

    // Validation
    if (newPassword !== confirmPassword) {
      throw new Error('New passwords do not match')
    }

    if (newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters long')
    }

    // Update password in Supabase
    const { supabase } = await import('./index.js')
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    })

    if (error) {
      throw error
    }

    showChangePasswordSuccessMessage('Password changed successfully!')
    
    // Close modal after success
    setTimeout(() => {
      const modal = document.getElementById('changePasswordModal')
      modal.classList.add('opacity-0')
      modal.querySelector('.relative').classList.remove('scale-100')
      modal.querySelector('.relative').classList.add('scale-95')
      
      setTimeout(() => {
        modal.classList.add('hidden')
        document.getElementById('changePasswordForm').reset()
        hideChangePasswordMessages()
      }, 300)
    }, 2000)

  } catch (error) {
    console.error('Error changing password:', error)
    showChangePasswordErrorMessage(error.message || 'Failed to change password')
  } finally {
    // Hide loading state
    submitBtn.disabled = false
    btnText.textContent = 'Change Password'
    btnSpinner.classList.add('hidden')
  }
}

/**
 * Setup account action buttons
 */
function setupAccountActionButtons() {
  // Download data button
  const downloadBtn = document.getElementById('downloadDataBtn')
  if (downloadBtn) {
    downloadBtn.addEventListener('click', handleDownloadData)
  }
}

/**
 * Handle download user data
 */
async function handleDownloadData() {
  try {
    const authGuard = getAuthGuard()
    const currentUser = authGuard.getCurrentUser()
    
    if (!currentUser) {
      showErrorMessage('User not authenticated')
      return
    }

    // TODO: Implement actual data export functionality
    // This would typically involve:
    // 1. Fetching all user's generated stems
    // 2. Fetching profile data
    // 3. Creating a ZIP file with all data
    // 4. Triggering download
    
    alert('Data download feature coming soon!')
    
  } catch (error) {
    console.error('Error downloading data:', error)
    showErrorMessage('Failed to download data')
  }
}

/**
 * Setup delete account modal functionality
 */
function setupDeleteAccountModal() {
  const deleteBtn = document.getElementById('deleteAccountBtn')
  if (deleteBtn) {
    deleteBtn.addEventListener('click', showDeleteAccountModal)
  }

  const modal = document.getElementById('deleteAccountModal')
  const overlay = document.getElementById('deleteAccountOverlay')
  const cancelBtn = document.getElementById('deleteAccountCancelBtn')
  const confirmBtn = document.getElementById('deleteAccountConfirmBtn')

  if (!modal || !overlay || !cancelBtn || !confirmBtn) return

  // Close modal handlers
  const closeModal = () => {
    modal.classList.add('opacity-0')
    modal.querySelector('.relative').classList.remove('scale-100')
    modal.querySelector('.relative').classList.add('scale-95')
    
    setTimeout(() => {
      modal.classList.add('hidden')
      // Clear form
      document.getElementById('deleteConfirmText').value = ''
      document.getElementById('deletePassword').value = ''
    }, 300)
  }

  overlay.addEventListener('click', closeModal)
  cancelBtn.addEventListener('click', closeModal)

  // Confirm deletion
  confirmBtn.addEventListener('click', handleDeleteAccount)
}

/**
 * Show delete account modal
 */
function showDeleteAccountModal() {
  const modal = document.getElementById('deleteAccountModal')
  if (!modal) return

  modal.classList.remove('hidden')
  
  setTimeout(() => {
    modal.classList.remove('opacity-0')
    modal.querySelector('.relative').classList.remove('scale-95')
    modal.querySelector('.relative').classList.add('scale-100')
  }, 10)
}

/**
 * Handle account deletion
 */
async function handleDeleteAccount() {
  const confirmText = document.getElementById('deleteConfirmText').value
  const password = document.getElementById('deletePassword').value
  const confirmBtn = document.getElementById('deleteAccountConfirmBtn')
  const btnText = document.getElementById('deleteAccountBtnText')
  const btnSpinner = document.getElementById('deleteAccountBtnSpinner')

  try {
    // Validation
    if (confirmText !== 'DELETE') {
      showErrorMessage('Please type "DELETE" to confirm')
      return
    }

    if (!password) {
      showErrorMessage('Password is required')
      return
    }

    // Show loading state
    confirmBtn.disabled = true
    btnText.textContent = 'Deleting...'
    btnSpinner.classList.remove('hidden')

    // TODO: Implement actual account deletion
    // This would typically involve:
    // 1. Verifying the password
    // 2. Deleting all user data from database
    // 3. Deleting the auth user
    // 4. Redirecting to landing page
    
    alert('Account deletion feature coming soon!')
    
    // For now, just close the modal
    const modal = document.getElementById('deleteAccountModal')
    modal.classList.add('opacity-0')
    modal.querySelector('.relative').classList.remove('scale-100')
    modal.querySelector('.relative').classList.add('scale-95')
    
    setTimeout(() => {
      modal.classList.add('hidden')
      document.getElementById('deleteConfirmText').value = ''
      document.getElementById('deletePassword').value = ''
    }, 300)

  } catch (error) {
    console.error('Error deleting account:', error)
    showErrorMessage('Failed to delete account')
  } finally {
    // Hide loading state
    confirmBtn.disabled = false
    btnText.textContent = 'Delete Account'
    btnSpinner.classList.add('hidden')
  }
}

/**
 * Show loading state
 */
function showLoadingState() {
  // You can add loading indicators here if needed
}

/**
 * Hide loading state
 */
function hideLoadingState() {
  // You can remove loading indicators here if needed
}

/**
 * Show error message
 */
function showErrorMessage(message) {
  const errorElement = document.getElementById('profileErrorMessage')
  const errorTextElement = document.getElementById('profileErrorText')
  
  if (errorElement && errorTextElement) {
    errorTextElement.textContent = message
    errorElement.classList.remove('hidden')
    
    // Hide success message if visible
    const successElement = document.getElementById('profileSuccessMessage')
    if (successElement) {
      successElement.classList.add('hidden')
    }
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      errorElement.classList.add('hidden')
    }, 5000)
  }
}

/**
 * Show success message
 */
function showSuccessMessage(message) {
  const successElement = document.getElementById('profileSuccessMessage')
  const successTextElement = document.getElementById('profileSuccessText')
  
  if (successElement && successTextElement) {
    successTextElement.textContent = message
    successElement.classList.remove('hidden')
    
    // Hide error message if visible
    const errorElement = document.getElementById('profileErrorMessage')
    if (errorElement) {
      errorElement.classList.add('hidden')
    }
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      successElement.classList.add('hidden')
    }, 5000)
  }
}

/**
 * Show change password error message
 */
function showChangePasswordErrorMessage(message) {
  const errorElement = document.getElementById('changePasswordErrorMessage')
  const errorTextElement = document.getElementById('changePasswordErrorText')
  
  if (errorElement && errorTextElement) {
    errorTextElement.textContent = message
    errorElement.classList.remove('hidden')
    
    // Hide success message if visible
    const successElement = document.getElementById('changePasswordSuccessMessage')
    if (successElement) {
      successElement.classList.add('hidden')
    }
  }
}

/**
 * Show change password success message
 */
function showChangePasswordSuccessMessage(message) {
  const successElement = document.getElementById('changePasswordSuccessMessage')
  const successTextElement = document.getElementById('changePasswordSuccessText')
  
  if (successElement && successTextElement) {
    successTextElement.textContent = message
    successElement.classList.remove('hidden')
    
    // Hide error message if visible
    const errorElement = document.getElementById('changePasswordErrorMessage')
    if (errorElement) {
      errorElement.classList.add('hidden')
    }
  }
}

/**
 * Hide change password messages
 */
function hideChangePasswordMessages() {
  const errorElement = document.getElementById('changePasswordErrorMessage')
  const successElement = document.getElementById('changePasswordSuccessMessage')
  
  if (errorElement) errorElement.classList.add('hidden')
  if (successElement) successElement.classList.add('hidden')
}
