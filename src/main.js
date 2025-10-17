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
      if (window.supabase && window.lucide) {
        resolve();
      } else {
        setTimeout(checkLibraries, 100);
      }
    };
    checkLibraries();
  });
}

// Initialize when both DOM and libraries are ready
document.addEventListener('DOMContentLoaded', async () => {
  
  
  try {

    const templatesLoaded = await loadTemplates();
    if (!templatesLoaded) {
        console.error('❌ Failed to load templates, stopping initialization');
      return;
    }
    
    await waitForLibraries();
    
    // Initialize enharmonic toggle functionality
    initEnharmonicToggle();
    
    initApp();
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
      // Try to load templates again in fallback
      const templatesLoaded = await loadTemplates();
      if (templatesLoaded) {
        initEnharmonicToggle();
        initApp();
      }
    }, 2000);
  }
});