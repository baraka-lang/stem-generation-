# Password Reset Page Setup

This document explains how to set up the branded password reset page for the 343 Labs AI Music Studio.

## Files Created

1. **`reset-password.html`** - Standalone branded password reset page
2. **`reset-password-config.js`** - Configuration file for Supabase credentials
3. **Updated `src/Auth/index.js`** - Modified to use Supabase's built-in password reset

## Setup Instructions

### 1. Configure Supabase Credentials

Edit `reset-password-config.js` and replace the placeholder values with your actual Supabase project details:

```javascript
window.RESET_PASSWORD_CONFIG = {
    // Replace with your actual Supabase project URL
    supabaseUrl: 'https://your-project-id.supabase.co',
    
    // Replace with your actual Supabase anon key
    supabaseKey: 'your-actual-anon-key',
    
    // The URL to redirect to after successful password reset
    redirectUrl: '/',
    
    // Whether to show demo mode notice
    showDemoMode: false
};
```

### 2. Deploy the Reset Page

Make sure `reset-password.html` and `reset-password-config.js` are accessible at your domain root:
- `https://yourdomain.com/reset-password.html`
- `https://yourdomain.com/reset-password-config.js`

### 3. Configure Supabase Auth Settings

In your Supabase dashboard:

1. Go to **Authentication** > **URL Configuration**
2. Add your reset page URL to **Site URL**: `https://yourdomain.com`
3. Add your reset page URL to **Redirect URLs**: `https://yourdomain.com/reset-password.html`

### 4. Test the Flow

1. Go to your login page
2. Click "Forgot your password?"
3. Enter an email address
4. Check the email for the reset link
5. Click the reset link to go to the branded reset page
6. Enter a new password and confirm it
7. Submit the form

## Features

### Branded Design
- Matches the 343 Labs AI Music Studio branding
- Purple to pink gradient theme
- Glass morphism effects
- Responsive design

### Password Validation
- Real-time password strength validation
- Visual indicators for requirements:
  - At least 6 characters
  - At least one lowercase letter
  - At least one uppercase letter
  - At least one number
- Password confirmation matching

### Security
- Uses Supabase's secure password reset flow
- Validates reset tokens from email links
- Prevents unauthorized access
- Proper error handling

### User Experience
- Password visibility toggles
- Loading states during submission
- Clear success/error messages
- Automatic redirect after success

## Customization

### Styling
The page uses inline CSS for easy deployment. You can customize:
- Colors in the CSS variables
- Fonts and typography
- Spacing and layout
- Animation effects

### Configuration
Modify `reset-password-config.js` to:
- Change redirect URL after reset
- Toggle demo mode
- Add additional configuration options

### Functionality
The JavaScript is modular and can be extended to:
- Add additional password requirements
- Implement custom validation rules
- Add analytics tracking
- Integrate with other services

## Troubleshooting

### Common Issues

1. **"Supabase not configured" error**
   - Check that `reset-password-config.js` has correct credentials
   - Verify the file is accessible at the correct URL

2. **"Invalid reset link" error**
   - Ensure the redirect URL is configured in Supabase
   - Check that the reset link hasn't expired
   - Verify the URL format matches exactly

3. **Styling issues**
   - Check that all CSS classes are properly defined
   - Verify Lucide icons are loading correctly
   - Test on different browsers and devices

4. **Password validation not working**
   - Check browser console for JavaScript errors
   - Verify that Lucide icons are loaded
   - Test with different password combinations

### Debug Mode

To enable debug logging, add this to the browser console:
```javascript
localStorage.setItem('debug', 'true')
```

This will show additional console logs for troubleshooting.

## Security Considerations

1. **Never commit real credentials** to version control
2. **Use environment variables** in production
3. **Regularly rotate** Supabase keys
4. **Monitor** password reset attempts for abuse
5. **Implement rate limiting** if needed

## Support

For issues or questions:
1. Check the browser console for errors
2. Verify Supabase configuration
3. Test with a fresh reset link
4. Check network connectivity
