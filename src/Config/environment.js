/**
 * Environment Configuration
 * Dynamically configures URLs and settings based on the deployment environment
 */

// Environment detection
const getEnvironment = () => {
  // Check for Vercel environment variables
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname;
    
    // Production environment
    if (hostname === 'stemflow.app' || hostname === 'www.stemflow.app') {
      return 'production';
    }
    
    // Staging environment (your staging domain)
    if (hostname.includes('vercel.app') && hostname.includes('staging')) {
      return 'staging';
    }
    
    // Preview environment (Vercel preview deployments)
    if (hostname.includes('vercel.app') && !hostname.includes('staging')) {
      return 'preview';
    }
    
    // Development environment
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'development';
    }
  }
  
  // Fallback to environment variables
  return import.meta.env.VITE_ENVIRONMENT || 'development';
};

// Environment-specific configurations
const environmentConfigs = {
  development: {
    baseUrl: 'http://localhost:5173',
    apiUrl: 'http://localhost:5173',
    domain: 'localhost:5173',
    protocol: 'http'
  },
  
  preview: {
    baseUrl: import.meta.env.VITE_VERCEL_URL ? `https://${import.meta.env.VITE_VERCEL_URL}` : 'https://your-preview-url.vercel.app',
    apiUrl: import.meta.env.VITE_VERCEL_URL ? `https://${import.meta.env.VITE_VERCEL_URL}` : 'https://your-preview-url.vercel.app',
    domain: import.meta.env.VITE_VERCEL_URL || 'your-preview-url.vercel.app',
    protocol: 'https'
  },
  
  staging: {
    baseUrl: 'https://staging.stemflow.app',
    apiUrl: 'https://staging.stemflow.app',
    domain: 'staging.stemflow.app',
    protocol: 'https'
  },
  
  production: {
    baseUrl: 'https://www.stemflow.app',
    apiUrl: 'https://www.stemflow.app',
    domain: 'www.stemflow.app',
    protocol: 'https'
  }
};

// Get current environment configuration
const currentEnv = getEnvironment();
const config = environmentConfigs[currentEnv];

// URL generators
export const urlGenerators = {
  /**
   * Generate password reset URL with JWT token
   * @param {string} token - JWT token from Supabase
   * @param {string} type - Token type (default: 'recovery')
   * @returns {string} Complete reset password URL
   */
  generateResetPasswordUrl: (token, type = 'recovery') => {
    const baseUrl = config.baseUrl;
    return `${baseUrl}/reset-password#?token=${token}&type=${type}`;
  },
  
  /**
   * Generate email confirmation URL with JWT token
   * @param {string} accessToken - Access token from Supabase
   * @param {string} refreshToken - Refresh token from Supabase
   * @returns {string} Complete confirmation URL
   */
  generateConfirmationUrl: (accessToken, refreshToken) => {
    const baseUrl = config.baseUrl;
    return `${baseUrl}/confirm-email.html?access_token=${accessToken}&refresh_token=${refreshToken}&type=signup`;
  },
  
  /**
   * Generate welcome redirect URL
   * @param {string} path - Optional path to redirect to
   * @returns {string} Welcome redirect URL
   */
  generateWelcomeUrl: (path = '/') => {
    const baseUrl = config.baseUrl;
    return path.startsWith('http') ? path : `${baseUrl}${path}`;
  }
};

// Environment info
export const environmentInfo = {
  current: currentEnv,
  config: config,
  isProduction: currentEnv === 'production',
  isStaging: currentEnv === 'staging',
  isPreview: currentEnv === 'preview',
  isDevelopment: currentEnv === 'development'
};

// Supabase configuration with environment awareness
export const supabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key',
  serviceRoleKey: import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '',
  
  // Environment-specific settings
  auth: {
    redirectTo: `${config.baseUrl}/profile.html`,
    passwordResetUrl: `${config.baseUrl}/#reset-password`,
    confirmationUrl: `${config.baseUrl}/confirm-email.html`
  }
};

// Email service configuration
export const emailConfig = {
  serviceUrl: import.meta.env.VITE_EMAIL_SERVICE_URL || '',
  apiKey: import.meta.env.VITE_EMAIL_SERVICE_KEY || '',
  useCustomService: !!import.meta.env.VITE_EMAIL_SERVICE_URL,

  // Environment-specific email settings
  fromEmail: {
    development: 'noreply@localhost',
    preview: 'noreply@stemflow.app',
    staging: 'noreply@stemflow.app',
    production: 'noreply@stemflow.app'
  },

  // Get appropriate from email for current environment
  getFromEmail: () => emailConfig.fromEmail[currentEnv] || emailConfig.fromEmail.production
};

// AI Loop Fix configuration
export const loopFixConfig = {
  useGemini: import.meta.env.VITE_USE_GEMINI_LOOP_FIX === 'true' || import.meta.env.VITE_USE_GEMINI_LOOP_FIX === true,
  geminiApiKey: import.meta.env.GEMINI_API_KEY || '',

  // Feature flag for A/B testing
  isGeminiEnabled: () => {
    return loopFixConfig.useGemini && !!loopFixConfig.geminiApiKey;
  }
};

// Log configuration in development
if (import.meta.env.DEV) {
  console.log('🌍 Environment Configuration:', {
    environment: currentEnv,
    baseUrl: config.baseUrl,
    domain: config.domain,
    isProduction: environmentInfo.isProduction,
    isStaging: environmentInfo.isStaging,
    isPreview: environmentInfo.isPreview,
    isDevelopment: environmentInfo.isDevelopment
  });
}

// Export everything
export default {
  environmentInfo,
  urlGenerators,
  supabaseConfig,
  emailConfig,
  loopFixConfig,
  config
};

