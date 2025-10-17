/**
 * Environment Variables Injection Script
 * This script can be used to inject environment variables into the reset password page
 * Run this script to update the reset-password-config.js with actual environment variables
 */

const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
function loadEnvFile() {
    const envPath = path.join(process.cwd(), '.env');
    
    if (!fs.existsSync(envPath)) {
        console.warn('No .env file found, using process.env');
        return process.env;
    }
    
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = {};
    
    envContent.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            const [key, ...valueParts] = trimmedLine.split('=');
            if (key && valueParts.length > 0) {
                const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Remove quotes
                envVars[key] = value;
            }
        }
    });
    
    return { ...process.env, ...envVars };
}

// Generate the config file content
function generateConfigFile(envVars) {
    const supabaseUrl = envVars.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
    const supabaseKey = envVars.VITE_SUPABASE_ANON_KEY || 'your-anon-key';
    const appUrl = envVars.VITE_APP_URL || '/';
    
    const showDemoMode = !supabaseUrl || !supabaseKey || 
                        supabaseUrl === 'https://your-project.supabase.co' ||
                        supabaseKey === 'your-anon-key';
    
    return `// Configuration for the password reset page
// This file is auto-generated from environment variables
// Last updated: ${new Date().toISOString()}

window.RESET_PASSWORD_CONFIG = {
    // Loaded from VITE_SUPABASE_URL environment variable
    supabaseUrl: '${supabaseUrl}',
    
    // Loaded from VITE_SUPABASE_ANON_KEY environment variable
    supabaseKey: '${supabaseKey}',
    
    // The URL to redirect to after successful password reset
    redirectUrl: '${appUrl}',
    
    // Whether to show demo mode notice
    showDemoMode: ${showDemoMode}
};

// Log configuration status for debugging
console.log('Reset Password Config:', {
    supabaseUrl: window.RESET_PASSWORD_CONFIG.supabaseUrl,
    hasAnonKey: !!window.RESET_PASSWORD_CONFIG.supabaseKey && window.RESET_PASSWORD_CONFIG.supabaseKey !== 'your-anon-key',
    showDemoMode: window.RESET_PASSWORD_CONFIG.showDemoMode
});
`;
}

// Main function
function main() {
    try {
        console.log('Loading environment variables...');
        const envVars = loadEnvFile();
        
        console.log('Generating reset-password-config.js...');
        const configContent = generateConfigFile(envVars);
        
        const configPath = path.join(process.cwd(), 'reset-password-config.js');
        fs.writeFileSync(configPath, configContent);
        
        console.log('✅ reset-password-config.js updated successfully');
        console.log('Supabase URL:', envVars.VITE_SUPABASE_URL || 'Not set');
        console.log('Has Anon Key:', !!envVars.VITE_SUPABASE_ANON_KEY);
        console.log('Demo Mode:', !envVars.VITE_SUPABASE_URL || !envVars.VITE_SUPABASE_ANON_KEY);
        
    } catch (error) {
        console.error('❌ Error updating config file:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { loadEnvFile, generateConfigFile };
