import './style.css'
import { initApp } from './app.js'
import { checkAudioContextSampleRate } from './debug-audio.js'
import { loadTemplates } from './loadTemplates.js'

// Enharmonic toggle functionality
function initEnharmonicToggle() {
  const enharmonicToggle = document.getElementById('enharmonicToggle');
  const rootSelector = document.getElementById('rootSelector');
  
  if (!enharmonicToggle || !rootSelector) return;

  // Key options for sharp and flat notation
  const keyOptionsSharp = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const keyOptionsFlat = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  
  // Mapping between sharp and flat equivalents
  const sharpToFlat = {
    'C♯': 'D♭', 'D♯': 'E♭', 'F♯': 'G♭', 'G♯': 'A♭', 'A♯': 'B♭'
  };
  const flatToSharp = {
    'D♭': 'C♯', 'E♭': 'D♯', 'G♭': 'F♯', 'A♭': 'G♯', 'B♭': 'A♯'
  };
  
  let useSharps = true;
  
  function updateRootSelectorOptions() {
    const currentValue = rootSelector.value;
    const keyOptions = useSharps ? keyOptionsSharp : keyOptionsFlat;
    
    // Clear existing options
    rootSelector.innerHTML = '';
    
    // Add new options
    keyOptions.forEach(key => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = key;
      rootSelector.appendChild(option);
    });
    
    // Try to preserve the current selection or find equivalent
    let newValue = currentValue;
    if (useSharps && flatToSharp[currentValue]) {
      newValue = flatToSharp[currentValue];
    } else if (!useSharps && sharpToFlat[currentValue]) {
      newValue = sharpToFlat[currentValue];
    }
    
    // Set the value if it exists in the new options
    if (keyOptions.includes(newValue)) {
      rootSelector.value = newValue;
    } else {
      rootSelector.value = 'A'; // Default fallback
    }
  }
  
  function updateEnharmonicToggleButton() {
    enharmonicToggle.textContent = useSharps ? '♯' : '♭';
    enharmonicToggle.dataset.preference = useSharps ? '♯' : '♭';
    
    if (useSharps) {
      enharmonicToggle.classList.remove('is-active');
    } else {
      enharmonicToggle.classList.add('is-active');
    }
  }
  
  // Event listener for the toggle button
  enharmonicToggle.addEventListener('click', (e) => {
    e.preventDefault();
    useSharps = !useSharps;
    updateRootSelectorOptions();
    updateEnharmonicToggleButton();
    
    // Dispatch a custom event to notify other parts of the app
    const event = new CustomEvent('enharmonicToggle', { 
      detail: { useSharps, currentKey: rootSelector.value } 
    });
    document.dispatchEvent(event);
  });
  
  // Initialize the toggle state
  updateRootSelectorOptions();
  updateEnharmonicToggleButton();
}

// Wait for all CDN libraries to load before initializing
function waitForLibraries() {
  return new Promise((resolve) => {
    const checkLibraries = () => {
      // Check if Supabase is loaded
      const supabaseLoaded = window.supabase && typeof window.supabase.createClient === 'function';
      
      // Check if Lucide is loaded and has the required methods
      const lucideLoaded = window.lucide && 
                          typeof window.lucide.createIcons === 'function';
      
      if (supabaseLoaded && lucideLoaded) {
        console.log('✅ All libraries loaded successfully');
        console.log('Lucide version:', window.lucide.version || 'unknown');
        resolve();
      } else {
        console.log('⏳ Waiting for libraries...', {
          supabase: supabaseLoaded,
          lucide: lucideLoaded,
          lucideHasCreateIcons: window.lucide && typeof window.lucide.createIcons === 'function',
          lucideVersion: window.lucide?.version || 'not loaded'
        });
        setTimeout(checkLibraries, 100);
      }
    };
    checkLibraries();
  });
}

// Safe Lucide icon initialization helper - now uses the new icon manager
function safeCreateIcons() {
  // Use the new icon manager system
  if (window.initializeIcons) {
    return window.initializeIcons();
  } else {
    console.warn('⚠️ Icon manager not available, using basic fallback');
    return initializeFallbackIcons();
  }
}

// Fallback function to manually initialize icons
function initializeFallbackIcons() {
  console.log('🔧 Initializing fallback icons');
  // Find all elements with data-lucide attributes and ensure they have proper classes
  const iconElements = document.querySelectorAll('[data-lucide]');
  console.log(`Found ${iconElements.length} icon elements to initialize`);
  
  iconElements.forEach(element => {
    const iconName = element.getAttribute('data-lucide');
    if (iconName) {
      // Remove any existing lucide classes
      element.className = element.className.replace(/lucide[-\w]*/g, '').trim();
      // Add the correct lucide classes
      element.classList.add('lucide', `lucide-${iconName}`);
      console.log(`Initialized icon: ${iconName}`);
    }
  });
}

// Make functions available globally
window.safeCreateIcons = safeCreateIcons;
window.initializeFallbackIcons = initializeFallbackIcons;

// Initialize when both DOM and libraries are ready
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Starting app initialization...');
  
  try {
    const templatesLoaded = await loadTemplates();
    if (!templatesLoaded) {
      console.error('❌ Failed to load templates, stopping initialization');
      return;
    }
    
    console.log('⏳ Waiting for external libraries...');
    await waitForLibraries();
    
    // Import and initialize icon manager FIRST
    const { initializeIcons, reinitializeIcons } = await import('./iconManager.js');
    
    // Make icon manager functions available globally immediately
    window.initializeIcons = initializeIcons;
    window.reinitializeIcons = reinitializeIcons;
    
    // Initialize enharmonic toggle functionality
    initEnharmonicToggle();
    
    // Initialize icons
    initializeIcons();
    
    console.log('🎯 Initializing main app...');
    initApp();
    
    // Run icon initialization again after a delay to catch any dynamically loaded icons
    setTimeout(() => {
      console.log('🔄 Running delayed icon initialization...');
      reinitializeIcons();
    }, 1000);
    
    console.log('✅ App initialization completed successfully');
  } catch (error) {
    console.error('❌ App initialization failed:', error);
    console.error('Error details:', error.stack);
    
    // Show error in UI
    const appRoot = document.getElementById('app-root');
    if (appRoot) {
      appRoot.innerHTML = `
        <div class="min-h-screen bg-zinc-900 text-white flex items-center justify-center p-4">
          <div class="text-center max-w-md">
            <h1 class="text-2xl font-bold mb-4 text-red-500">App Initialization Error</h1>
            <p class="text-white/60 mb-4">There was an error loading the application</p>
            <div class="bg-red-900/20 border border-red-500/30 rounded-lg p-3 mb-4 text-left">
              <p class="text-xs text-red-400 font-mono break-all">${error.message}</p>
            </div>
            <button onclick="location.reload()" class="px-4 py-2 bg-purple-500/80 hover:bg-purple-500 border border-purple-500 rounded-lg transition text-sm font-medium">
              Reload Page
            </button>
          </div>
        </div>
      `;
    }
    
    // Fallback: try to init without external libraries
    setTimeout(async () => {
      console.log('🔄 Attempting fallback initialization...');
      try {
        const templatesLoaded = await loadTemplates();
        if (templatesLoaded) {
          initEnharmonicToggle();
          safeCreateIcons();
          initApp();
        }
      } catch (fallbackError) {
        console.error('❌ Fallback initialization also failed:', fallbackError);
      }
    }, 2000);
  }
});