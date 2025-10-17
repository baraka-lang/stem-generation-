/**
 * Landing Page Logic
 * Handles interactions and navigation for the landing page
 */

/**
 * Initialize landing page functionality
 */
export function setupLandingPage() {
  const enterStudioBtn = document.getElementById('enterStudioBtn')
  const ctaEnterStudioBtn = document.getElementById('ctaEnterStudioBtn')
  const landingLoginBtn = document.getElementById('landingLoginBtn')
  const watchDemoBtn = document.getElementById('watchDemoBtn')

  // Enter Studio buttons - redirect to selection page
  if (enterStudioBtn) {
    enterStudioBtn.addEventListener('click', () => {
      navigateToSelection()
    })
  }

  if (ctaEnterStudioBtn) {
    ctaEnterStudioBtn.addEventListener('click', () => {
      navigateToSelection()
    })
  }

  // Login button - redirect to login page
  if (landingLoginBtn) {
    landingLoginBtn.addEventListener('click', () => {
      navigateToLogin()
    })
  }

  // Watch Demo button - could open a modal or redirect to demo
  if (watchDemoBtn) {
    watchDemoBtn.addEventListener('click', () => {
      handleWatchDemo()
    })
  }

  // Smooth scrolling for anchor links
  setupSmoothScrolling()

  // Add scroll effects
  setupScrollEffects()
}

/**
 * Navigate to selection page (guest mode allowed)
 */
function navigateToSelection() {
  // Allow guest access - go directly to selection page
  window.location.hash = '#selection'
}

/**
 * Navigate to login page
 */
function navigateToLogin() {
  window.location.hash = '#login'
}

/**
 * Handle watch demo functionality
 */
function handleWatchDemo() {
  // For now, just show an alert. In the future, this could:
  // - Open a video modal
  // - Redirect to a demo page
  // - Start an interactive demo
  alert('Demo coming soon! For now, try creating an account to explore the studio.')
}

/**
 * Check if user is currently authenticated
 * @returns {boolean} True if user is authenticated
 */
function checkAuthenticationStatus() {
  // This is a simple check - in a real app, you'd check with your auth service
  // For now, we'll check if there's a session in localStorage or similar
  const hasSession = localStorage.getItem('supabase.auth.token') || 
                    sessionStorage.getItem('supabase.auth.token')
  
  return !!hasSession
}

/**
 * Setup smooth scrolling for anchor links
 */
function setupSmoothScrolling() {
  // Handle clicks on anchor links
  document.addEventListener('click', (e) => {
    if (e.target.matches('a[href^="#"]')) {
      e.preventDefault()
      const targetId = e.target.getAttribute('href').substring(1)
      const targetElement = document.getElementById(targetId)
      
      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        })
      }
    }
  })
}

/**
 * Setup scroll effects for the landing page
 */
function setupScrollEffects() {
  // Add scroll-triggered animations
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-fade-in')
      }
    })
  }, observerOptions)

  // Observe feature cards and other elements
  const elementsToAnimate = document.querySelectorAll('.glass')
  elementsToAnimate.forEach(el => {
    observer.observe(el)
  })
}

/**
 * Initialize landing page when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
  setupLandingPage()
})
