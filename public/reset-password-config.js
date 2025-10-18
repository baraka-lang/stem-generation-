// Configuration for the password reset page
// Loads configuration from environment variables or falls back to defaults

// Function to get environment variable with fallback
function getEnvVar(name, defaultValue = '') {
    // Try to get from window.env (if set by build process)
    if (window.env && window.env[name]) {
        return window.env[name];
    }
    
    // Try to get from a global config object
    if (window.CONFIG && window.CONFIG[name]) {
        return window.CONFIG[name];
    }
    
    // Try to get from URL parameters (for testing)
    const urlParams = new URLSearchParams(window.location.search);
    const urlValue = urlParams.get(name.toLowerCase());
    if (urlValue) {
        return urlValue;
    }
    
    // Try to get from localStorage (for persistence)
    const storedValue = localStorage.getItem(name);
    if (storedValue) {
        return storedValue;
    }
    
    return defaultValue;
}

// Load configuration from environment variables
window.RESET_PASSWORD_CONFIG = {
    // Load from VITE_SUPABASE_URL environment variable
    supabaseUrl: getEnvVar('VITE_SUPABASE_URL', 'https://your-project.supabase.co'),
    
    // Load from VITE_SUPABASE_ANON_KEY environment variable
    supabaseKey: getEnvVar('VITE_SUPABASE_ANON_KEY', 'your-anon-key'),
    
    // The URL to redirect to after successful password reset
    redirectUrl: getEnvVar('VITE_APP_URL', '/'),
    
    // Whether to show demo mode notice (true if no valid config found)
    showDemoMode: !getEnvVar('VITE_SUPABASE_URL') || !getEnvVar('VITE_SUPABASE_ANON_KEY') || 
                  getEnvVar('VITE_SUPABASE_URL') === 'https://your-project.supabase.co' ||
                  getEnvVar('VITE_SUPABASE_ANON_KEY') === 'your-anon-key'
};

// Log configuration status for debugging
console.log('Reset Password Config:', {
    supabaseUrl: window.RESET_PASSWORD_CONFIG.supabaseUrl,
    hasAnonKey: !!window.RESET_PASSWORD_CONFIG.supabaseKey && window.RESET_PASSWORD_CONFIG.supabaseKey !== 'your-anon-key',
    showDemoMode: window.RESET_PASSWORD_CONFIG.showDemoMode
});
