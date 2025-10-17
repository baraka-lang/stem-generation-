/**
 * Environment Variables Injection Script for HTML
 * This script injects environment variables directly into the HTML file
 * Run this script to update the reset-password.html with actual environment variables
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

// Generate the config injection script
function generateConfigScript(envVars) {
    const supabaseUrl = envVars.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
    const supabaseKey = envVars.VITE_SUPABASE_ANON_KEY || 'your-anon-key';
    const appUrl = envVars.VITE_APP_URL || '/';
    
    const showDemoMode = !supabaseUrl || !supabaseKey || 
                        supabaseUrl === 'https://your-project.supabase.co' ||
                        supabaseKey === 'your-anon-key';
    
    return `        // Environment variables injected on ${new Date().toISOString()}
        window.RESET_PASSWORD_CONFIG = {
            supabaseUrl: '${supabaseUrl}',
            supabaseKey: '${supabaseKey}',
            redirectUrl: '${appUrl}',
            showDemoMode: ${showDemoMode}
        };
        
        console.log('Reset Password Config:', {
            supabaseUrl: window.RESET_PASSWORD_CONFIG.supabaseUrl,
            hasAnonKey: !!window.RESET_PASSWORD_CONFIG.supabaseKey && window.RESET_PASSWORD_CONFIG.supabaseKey !== 'your-anon-key',
            showDemoMode: window.RESET_PASSWORD_CONFIG.showDemoMode
        });`;
}

// Main function
function main() {
    try {
        console.log('Loading environment variables...');
        const envVars = loadEnvFile();
        
        console.log('Reading reset-password.html...');
        const htmlPath = path.join(process.cwd(), 'reset-password.html');
        let htmlContent = fs.readFileSync(htmlPath, 'utf8');
        
        console.log('Injecting environment variables...');
        const configScript = generateConfigScript(envVars);
        
        // Replace the existing config script with the injected one
        const configScriptRegex = /\/\* Environment variables injected on .*?\n\s*console\.log\('Reset Password Config:'.*?\);\s*\n\s*}/s;
        
        if (configScriptRegex.test(htmlContent)) {
            // Replace existing injected config
            htmlContent = htmlContent.replace(configScriptRegex, configScript);
        } else {
            // Find the script tag and inject before it
            const scriptTagRegex = /(\s*<script src="\.\/reset-password-config\.js"><\/script>\s*<script>)/;
            if (scriptTagRegex.test(htmlContent)) {
                htmlContent = htmlContent.replace(scriptTagRegex, `$1\n${configScript}\n`);
            } else {
                console.error('Could not find insertion point in HTML file');
                return;
            }
        }
        
        console.log('Writing updated reset-password.html...');
        fs.writeFileSync(htmlPath, htmlContent);
        
        console.log('✅ reset-password.html updated successfully');
        console.log('Supabase URL:', envVars.VITE_SUPABASE_URL || 'Not set');
        console.log('Has Anon Key:', !!envVars.VITE_SUPABASE_ANON_KEY);
        console.log('Demo Mode:', !envVars.VITE_SUPABASE_URL || !envVars.VITE_SUPABASE_ANON_KEY);
        
    } catch (error) {
        console.error('❌ Error updating HTML file:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { loadEnvFile, generateConfigScript };
