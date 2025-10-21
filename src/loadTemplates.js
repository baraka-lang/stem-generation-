/**
 * Loads HTML templates from src/templates.html and src/pages/selection-page.html
 * and injects them into the DOM. This allows the HTML content to be modularized 
 * while preserving all functionality.
 */

export async function loadTemplates() {
  try {
    // Fetch all template files in parallel
    const [templatesResponse, selectionPageResponse, loginPageResponse, resetPasswordResponse, confirmEmailResponse, profilePageResponse] = await Promise.all([
      fetch('/src/templates.html'),
      fetch('/src/pages/selection-page.html'),
      fetch('/src/pages/login-page.html'),
      fetch('/src/pages/reset-password.html'),
      fetch('/src/pages/confirm-email.html'),
      fetch('/src/pages/profile.html')
    ]);
    
 
    
    if (!templatesResponse.ok) {
      throw new Error(`Failed to load templates: ${templatesResponse.status} ${templatesResponse.statusText}`);
    }
    
    if (!selectionPageResponse.ok) {
      throw new Error(`Failed to load selection page: ${selectionPageResponse.status} ${selectionPageResponse.statusText}`);
    }
    
    if (!loginPageResponse.ok) {
      throw new Error(`Failed to load login page: ${loginPageResponse.status} ${loginPageResponse.statusText}`);
    }
    
    if (!resetPasswordResponse.ok) {
      throw new Error(`Failed to load reset password page: ${resetPasswordResponse.status} ${resetPasswordResponse.statusText}`);
    }
    
    if (!confirmEmailResponse.ok) {
      throw new Error(`Failed to load confirm email page: ${confirmEmailResponse.status} ${confirmEmailResponse.statusText}`);
    }
    
    if (!profilePageResponse.ok) {
      throw new Error(`Failed to load profile page: ${profilePageResponse.status} ${profilePageResponse.statusText}`);
    }
    
    const [templatesContent, selectionPageContent, loginPageContent, resetPasswordContent, confirmEmailContent, profilePageContent] = await Promise.all([
      templatesResponse.text(),
      selectionPageResponse.text(),
      loginPageResponse.text(),
      resetPasswordResponse.text(),
      confirmEmailResponse.text(),
      profilePageResponse.text()
    ]);
    
    // Find the app root container
    const appRoot = document.getElementById('app-root');
    if (!appRoot) {
      throw new Error('App root container not found');
    }
    
    // Inject the main templates content first
    appRoot.innerHTML = templatesContent;
    
    // Replace the login page placeholder
    const loginPlaceholder = document.getElementById('login-page-placeholder');
    if (loginPlaceholder) {
      loginPlaceholder.outerHTML = loginPageContent;
    } else {
      console.warn('Login page placeholder not found, appending login page to end');
      appRoot.insertAdjacentHTML('beforeend', loginPageContent);
    }
    
    // Replace the selection page placeholder
    const selectionPlaceholder = document.getElementById('selection-page-placeholder');
    if (selectionPlaceholder) {
      selectionPlaceholder.outerHTML = selectionPageContent;
    } else {
      console.warn('Selection page placeholder not found, appending selection page to end');
      appRoot.insertAdjacentHTML('beforeend', selectionPageContent);
    }
    
    // Replace the reset password page placeholder
    const resetPasswordPlaceholder = document.getElementById('reset-password-page-placeholder');
    if (resetPasswordPlaceholder) {
      resetPasswordPlaceholder.outerHTML = resetPasswordContent;
    } else {
      console.warn('Reset password page placeholder not found, appending reset password page to end');
      appRoot.insertAdjacentHTML('beforeend', resetPasswordContent);
    }
    
    // Append confirm email page
    appRoot.insertAdjacentHTML('beforeend', confirmEmailContent);
    
    // Append profile page
    appRoot.insertAdjacentHTML('beforeend', profilePageContent);
    
    // console.log('Templates, login page, and selection page loaded successfully');
    return true;
    
  } catch (error) {
    console.error('Error loading templates:', error);
    
    // Fallback: show error message in the app root
    const appRoot = document.getElementById('app-root');
    if (appRoot) {
      appRoot.innerHTML = `
        <div class="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
          <div class="text-center">
            <h1 class="text-2xl font-bold mb-4 text-red-500">Error Loading Application</h1>
            <p class="text-white/60 mb-4">Failed to load application templates</p>
            <p class="text-xs text-white/40">${error.message}</p>
            <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-purple-500/80 hover:bg-purple-500 border border-purple-500 rounded-lg transition text-sm font-medium">
              Reload Page
            </button>
          </div>
        </div>
      `;
    }
    
    return false;
  }
}
