/**
 * Icon Manager - Handles Lucide icon initialization and fallbacks
 */

let iconInitializationAttempts = 0;
const MAX_ATTEMPTS = 5;

export function initializeIcons() {
  console.log('🎨 Initializing icons...');
  
  // Try Lucide first
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    try {
      window.lucide.createIcons();
      console.log('✅ Lucide icons initialized successfully');
      return true;
    } catch (error) {
      console.warn('⚠️ Lucide createIcons failed:', error);
    }
  }
  
  // Fallback to manual initialization
  return initializeFallbackIcons();
}

export function initializeFallbackIcons() {
  console.log('🔧 Initializing fallback icons...');
  
  const iconElements = document.querySelectorAll('[data-lucide]');
  console.log(`Found ${iconElements.length} icon elements`);
  
  let initializedCount = 0;
  
  iconElements.forEach(element => {
    const iconName = element.getAttribute('data-lucide');
    if (iconName && !element.querySelector('svg')) {
      // Create a simple SVG icon as fallback
      const svg = createSimpleIcon(iconName);
      if (svg) {
        element.innerHTML = '';
        element.appendChild(svg);
        element.classList.add('lucide', `lucide-${iconName}`);
        initializedCount++;
      }
    }
  });
  
  console.log(`✅ Initialized ${initializedCount} icons`);
  return initializedCount > 0;
}

function createSimpleIcon(iconName) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  
  // Simple icon paths for common icons
  const iconPaths = {
    'wand-2': '<path d="M15 4V2m0 16v-2m8-8h2M3 12h2m13.5-6.5L20 7l-1.5-1.5M4.5 19.5L6 18l1.5 1.5M4.5 4.5L6 6l-1.5 1.5M19.5 19.5L18 18l1.5-1.5"/>',
    'sliders': '<path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 12h6m8 0h6"/>',
    'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    'play': '<polygon points="5,3 19,12 5,21"/>',
    'pause': '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    'loader-2': '<path d="M21 12a9 9 0 11-6.219-8.56"/>',
    'save': '<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/>',
    'download': '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'check': '<polyline points="20,6 9,17 4,12"/>',
    'eye': '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    'music': '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'
  };
  
  const path = iconPaths[iconName];
  if (path) {
    svg.innerHTML = path;
    return svg;
  }
  
  // Default fallback
  svg.innerHTML = '<circle cx="12" cy="12" r="3"/>';
  return svg;
}

export function reinitializeIcons() {
  iconInitializationAttempts++;
  
  if (iconInitializationAttempts > MAX_ATTEMPTS) {
    console.warn('⚠️ Max icon initialization attempts reached');
    return;
  }
  
  console.log(`🔄 Reinitializing icons (attempt ${iconInitializationAttempts})`);
  
  // Wait a bit for DOM to be ready
  setTimeout(() => {
    initializeIcons();
  }, 100 * iconInitializationAttempts);
}

// Make functions available globally
window.initializeIcons = initializeIcons;
window.initializeFallbackIcons = initializeFallbackIcons;
window.reinitializeIcons = reinitializeIcons;
