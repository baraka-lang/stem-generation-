# Passwordless Authentication System

This system provides a seamless passwordless authentication experience for the AI Stem Generator app. Users can sign in using just their email address, with automatic account creation for new users and email confirmation for existing users.

## Features

- **Email-only authentication** - No passwords required
- **Automatic account creation** - New users get instant access
- **Email confirmation** - Existing users receive magic link
- **Session data preservation** - User data is preserved during auth flow
- **Seamless integration** - Works with existing app functionality

## How It Works

### For New Users
1. User clicks on action requiring authentication (e.g., Download, Save)
2. Modal appears asking for email address
3. User enters email and clicks "Continue"
4. System creates new account immediately
5. User is logged in and action proceeds automatically

### For Existing Users
1. User clicks on action requiring authentication
2. Modal appears asking for email address
3. User enters email and clicks "Continue"
4. System checks if email exists in database
5. If exists, sends confirmation email
6. User clicks magic link in email
7. User is logged in and action proceeds automatically

## Files Overview

### Core Components

- **`passwordlessAuthModal.js`** - Modal UI and user interaction
- **`passwordlessAuthService.js`** - Authentication logic and flow management
- **`sessionDataManager.js`** - Temporary data storage and merging
- **`stemApi.js`** - Database operations for stems and user data
- **`stemPersistenceService.js`** - Stem saving and retrieval

### Integration

- **`authIntegrationExample.js`** - Examples of how to integrate with existing app
- **`authModalTemplate.html`** - HTML template for the modal

## Quick Start

### 1. Initialize the System

Add this to your app initialization:

```javascript
import { initializeAuthIntegration } from './Auth/authIntegrationExample.js'

// Initialize when app starts
initializeAuthIntegration()
```

### 2. Protect Actions

Wrap any action that requires authentication:

```javascript
import { requireAuthentication } from './Auth/passwordlessAuthService.js'

// Example: Protect download functionality
downloadBtn.addEventListener('click', async () => {
  await requireAuthentication('download', async () => {
    // Your existing download code here
    await downloadAllStems()
  })
})
```

### 3. Add UI Elements

Add these buttons to your HTML:

```html
<!-- Download button (already exists) -->
<button id="downloadAllBtn">Download All</button>

<!-- Save button (already exists) -->
<button id="saveStateBtn">Save Set</button>

<!-- User menu (if you have one) -->
<div data-user-menu>
  <button data-login-btn>Sign In</button>
  <button data-logout-btn>Sign Out</button>
</div>
```

## Database Requirements

The system requires these database tables (already created):

- **`profiles`** - User profiles with credits
- **`stems`** - Generated stems with audio data
- **`stem_sets`** - Collections of stems
- **`stem_set_items`** - Many-to-many relationship
- **`downloads`** - Download tracking

## Configuration

### Environment Variables

Make sure these are set in your `.env` file:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Supabase Setup

1. Enable email authentication in Supabase dashboard
2. Configure email templates
3. Set up redirect URLs for email confirmations

## API Reference

### `requireAuthentication(actionType, callback)`

Requires authentication for an action.

**Parameters:**
- `actionType` (string) - Type of action (e.g., 'download', 'save')
- `callback` (function) - Function to execute after authentication

**Example:**
```javascript
await requireAuthentication('download', async () => {
  console.log('User is authenticated, proceeding with download')
})
```

### `showPasswordlessAuthModal(actionType, onSuccess, onCancel)`

Shows the authentication modal.

**Parameters:**
- `actionType` (string) - Type of action requiring auth
- `onSuccess` (function) - Callback when authentication succeeds
- `onCancel` (function) - Callback when modal is cancelled

### `isUserAuthenticated()`

Checks if user is currently authenticated.

**Returns:** Promise<boolean>

## Customization

### Styling

The modal uses Tailwind CSS classes that match your existing app design. You can customize the appearance by modifying the classes in `passwordlessAuthModal.js`.

### Email Templates

Customize the email confirmation template in your Supabase dashboard under Authentication > Email Templates.

### Session Data

Modify `sessionDataManager.js` to include additional data types you want to preserve during authentication.

## Error Handling

The system includes comprehensive error handling:

- **Network errors** - Graceful fallback to session storage
- **Invalid emails** - Client-side validation with user feedback
- **Database errors** - Error messages and retry options
- **Authentication failures** - Clear error messages

## Security

- **Row Level Security** - All database operations are protected
- **Email validation** - Client and server-side validation
- **Session isolation** - User data is properly isolated
- **Secure tokens** - JWT tokens with proper expiration

## Troubleshooting

### Common Issues

1. **Modal not appearing** - Check that the modal HTML is added to the page
2. **Email not sending** - Verify Supabase email configuration
3. **Database errors** - Check RLS policies and user permissions
4. **Session data not merging** - Verify user ID is correct

### Debug Mode

Enable debug logging by setting:

```javascript
localStorage.setItem('debug', 'auth')
```

## Support

For issues or questions:

1. Check the browser console for error messages
2. Verify Supabase configuration
3. Test with a simple email address
4. Check network requests in browser dev tools

## Future Enhancements

- **Social login** - Google, GitHub, etc.
- **Two-factor authentication** - SMS or authenticator app
- **Account recovery** - Password reset for existing users
- **Analytics** - Track authentication success rates
- **A/B testing** - Test different modal designs
