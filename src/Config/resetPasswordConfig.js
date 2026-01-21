/**
 * Reset Password Configuration
 * This module loads environment variables securely using Vite's import.meta.env
 */

export const resetPasswordConfig = {
    // Load from VITE_SUPABASE_URL environment variable
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co',
    
    // Load from VITE_SUPABASE_ANON_KEY environment variable  
    supabaseKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key',
    
    // The URL to redirect to after successful password reset
    redirectUrl: import.meta.env.VITE_APP_URL || '/',
    
    // Whether to show demo mode notice (true if no valid config found)
    get showDemoMode() {
        return !this.supabaseUrl || !this.supabaseKey || 
               this.supabaseUrl === 'https://your-project.supabase.co' ||
               this.supabaseKey === 'your-anon-key';
    }
};

// Log configuration status for debugging (only in development)
if (import.meta.env.DEV) {
    console.log('Reset Password Config:', {
        supabaseUrl: resetPasswordConfig.supabaseUrl,
        hasAnonKey: !!resetPasswordConfig.supabaseKey && resetPasswordConfig.supabaseKey !== 'your-anon-key',
        showDemoMode: resetPasswordConfig.showDemoMode
    });
}

// Make it available globally for the standalone HTML page
if (typeof window !== 'undefined') {
    window.RESET_PASSWORD_CONFIG = resetPasswordConfig;
}
