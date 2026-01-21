/**
 * Toast Notification Utility
 * Provides toast notifications with brand styling
 */

/**
 * Show a toast notification
 * @param {Object} options - Toast options
 * @param {string} options.message - Message to display
 * @param {string} options.type - Type of toast (success, error, info, warning)
 * @param {number} options.duration - Duration in milliseconds (default: 3000)
 * @returns {Function} Function to manually close the toast
 */
export function showToast({ message, type = 'info', duration = 3000 }) {
  // Create toast container if it doesn't exist
  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    container.className = 'fixed top-4 right-4 z-[100] flex flex-col gap-2'
    document.body.appendChild(container)
  }

  // Create toast element
  const toast = document.createElement('div')
  toast.className = 'toast-notification'
  
  // Set colors based on type
  const colors = {
    success: {
      bg: 'bg-green-500/90',
      border: 'border-green-400/30',
      text: 'text-green-100',
      icon: 'check-circle'
    },
    error: {
      bg: 'bg-red-500/90',
      border: 'border-red-400/30',
      text: 'text-red-100',
      icon: 'alert-circle'
    },
    info: {
      bg: 'bg-blue-500/90',
      border: 'border-blue-400/30',
      text: 'text-blue-100',
      icon: 'info'
    },
    warning: {
      bg: 'bg-yellow-500/90',
      border: 'border-yellow-400/30',
      text: 'text-yellow-100',
      icon: 'alert-triangle'
    }
  }

  const colorScheme = colors[type] || colors.info

  toast.innerHTML = `
    <div class="${colorScheme.bg} backdrop-blur-sm border ${colorScheme.border} rounded-lg p-4 shadow-lg animate-in">
      <div class="flex items-start space-x-3">
        <div class="flex-shrink-0">
          <i data-lucide="${colorScheme.icon}" class="w-5 h-5 ${colorScheme.text}"></i>
        </div>
        <div class="flex-1">
          <p class="${colorScheme.text} text-sm">
            ${message}
          </p>
        </div>
        <button onclick="this.closest('.toast-notification').remove()" class="flex-shrink-0 ${colorScheme.text} hover:opacity-70 transition-opacity">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
    </div>
  `

  // Add toast to container
  container.appendChild(toast)

  // Initialize Lucide icons
  if (window.safeCreateIcons) {
    window.safeCreateIcons()
  }

  // Auto-remove after duration
  let timeoutId
  if (duration > 0) {
    timeoutId = setTimeout(() => {
      toast.classList.add('animate-out')
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove()
        }
      }, 300)
    }, duration)
  }

  // Return function to manually close
  return () => {
    if (timeoutId) clearTimeout(timeoutId)
    toast.classList.add('animate-out')
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove()
      }
    }, 300)
  }
}

/**
 * Show a success toast
 */
export function showSuccessToast(message, duration = 3000) {
  return showToast({ message, type: 'success', duration })
}

/**
 * Show an error toast
 */
export function showErrorToast(message, duration = 4000) {
  return showToast({ message, type: 'error', duration })
}

/**
 * Show an info toast
 */
export function showInfoToast(message, duration = 3000) {
  return showToast({ message, type: 'info', duration })
}

/**
 * Show a warning toast
 */
export function showWarningToast(message, duration = 3000) {
  return showToast({ message, type: 'warning', duration })
}

