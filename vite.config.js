import { defineConfig, loadEnv } from 'vite'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// Plugin to inject environment variables into HTML files
function injectEnvPlugin(env) {
  return {
    name: 'inject-env',
    writeBundle() {
      // Path to the reset password HTML file
      const htmlPath = resolve(__dirname, 'public/reset-password.html')
      
      try {
        if (!existsSync(htmlPath)) {
          console.log('ℹ️ reset-password.html not found, skipping env injection')
          return
        }
        let htmlContent = readFileSync(htmlPath, 'utf8')
        
        // Create the config injection script
        const configScript = `        // Environment variables injected by Vite on ${new Date().toISOString()}
        window.RESET_PASSWORD_CONFIG = {
            supabaseUrl: '${env.VITE_SUPABASE_URL || 'https://your-project.supabase.co'}',
            supabaseKey: '${env.VITE_SUPABASE_ANON_KEY || 'your-anon-key'}',
            redirectUrl: '${env.VITE_APP_URL || '/'}',
            showDemoMode: ${!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY || 
                           env.VITE_SUPABASE_URL === 'https://your-project.supabase.co' ||
                           env.VITE_SUPABASE_ANON_KEY === 'your-anon-key'}
        };
        
        console.log('Reset Password Config:', {
            supabaseUrl: window.RESET_PASSWORD_CONFIG.supabaseUrl,
            hasAnonKey: !!window.RESET_PASSWORD_CONFIG.supabaseKey && window.RESET_PASSWORD_CONFIG.supabaseKey !== 'your-anon-key',
            showDemoMode: window.RESET_PASSWORD_CONFIG.showDemoMode
        });`
        
        // Replace existing injected config or inject new one
        const configScriptRegex = /\/\* Environment variables injected by Vite on .*?\n\s*console\.log\('Reset Password Config:'.*?\);\s*\n\s*}/s
        
        if (configScriptRegex.test(htmlContent)) {
          // Replace existing injected config
          htmlContent = htmlContent.replace(configScriptRegex, configScript)
        } else {
          // Find the script tag and inject before it
          const scriptTagRegex = /(\s*<script src="\.\/reset-password-config\.js"><\/script>\s*<script>)/
          if (scriptTagRegex.test(htmlContent)) {
            htmlContent = htmlContent.replace(scriptTagRegex, `$1\n${configScript}\n`)
          }
        }
        
        writeFileSync(htmlPath, htmlContent)
        console.log('✅ Environment variables injected into reset-password.html')
      } catch (error) {
        console.error('❌ Error injecting environment variables:', error.message)
      }
    }
  }
}

export default defineConfig(({ mode }) => {
  // Load environment variables
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [injectEnvPlugin(env)],
    define: {
      // Make environment variables available to the application
      __VITE_SUPABASE_URL__: JSON.stringify(env.VITE_SUPABASE_URL),
      __VITE_SUPABASE_ANON_KEY__: JSON.stringify(env.VITE_SUPABASE_ANON_KEY),
      __VITE_APP_URL__: JSON.stringify(env.VITE_APP_URL)
    }
  }
})
