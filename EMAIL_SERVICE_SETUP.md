# Email Service Integration Setup

This guide explains how to configure the project to use your lead developer's email sending Edge Function.

## 🔧 Configuration Required

### 1. Environment Variables

Add these environment variables to your `.env` file:

```env
# Supabase Configuration (existing)
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Email Service Configuration (NEW - Lead Developer's Edge Function)
VITE_EMAIL_SERVICE_URL=https://your-project-ref.supabase.co/functions/v1/send-email
VITE_EMAIL_SERVICE_KEY=your_email_service_api_key

# Application URLs (NEW - for email templates)
VITE_APP_URL=https://your-app.com
VITE_SUPPORT_URL=https://your-app.com/support
VITE_PRIVACY_URL=https://your-app.com/privacy
VITE_TERMS_URL=https://your-app.com/terms
```

### 2. Get Email Service Endpoint

**Please provide the following from your lead developer:**

1. **Email Service URL** - The endpoint URL for the email sending function
2. **API Key** - Authentication key for the email service
3. **Expected Request Format** - How the email service expects data to be sent

## 📧 Email Service Integration

### Current Implementation

The project is now configured to use your lead developer's email service with these features:

- **Custom Email Templates** - Professional 343 Labs branded emails
- **Fallback Support** - Falls back to Supabase default emails if custom service fails
- **Error Handling** - Comprehensive error handling and logging
- **Template Variables** - Dynamic content replacement

### Email Types Supported

1. **Password Reset** - Sent when users request password reset
2. **Email Confirmation** - Sent when users sign up
3. **Welcome Email** - Sent after email confirmation
4. **Email Change** - Sent when users change email address

## 🔄 Integration Flow

### Password Reset Flow
1. User clicks "Forgot Password"
2. Supabase generates reset URL
3. Custom email sent via lead developer's service
4. User receives branded password reset email
5. User clicks link and resets password

### Sign Up Flow
1. User creates account
2. Supabase creates user account
3. Custom confirmation email sent via lead developer's service
4. User receives branded confirmation email
5. User clicks link to confirm email

## 🧪 Testing

### Test Email Service Connection

```javascript
import { testEmailService } from './src/Config/emailService.js'

// Test the connection
const result = await testEmailService()
console.log('Email service test:', result)
```

### Test Email Sending

```javascript
import { sendPasswordResetEmail } from './src/Config/emailService.js'

// Test password reset email
const result = await sendPasswordResetEmail('test@example.com', 'https://app.com/reset')
console.log('Email sent:', result)
```

## 📁 Files Modified

### New Files Created
- `src/Config/emailService.js` - Email service integration
- `EMAIL_SERVICE_SETUP.md` - This setup guide

### Files Updated
- `src/Auth/index.js` - Updated to use custom email service
- `src/Auth/resetPasswordPage.js` - Password reset page (already created)
- `src/pages/reset-password.html` - Password reset page (already created)

## 🔧 Customization

### Email Templates

The email templates are located in:
- `src/pages/EmailTemplates/confirmation.html`
- `src/pages/EmailTemplates/password-reset.html`
- `src/pages/EmailTemplates/welcome.html`

### Template Variables

All templates support these variables:
- `{{USER_EMAIL}}` - User's email address
- `{{CONFIRMATION_LINK}}` - Email confirmation link
- `{{RESET_LINK}}` - Password reset link
- `{{APP_URL}}` - Application URL
- `{{SUPPORT_URL}}` - Support page URL
- `{{PRIVACY_URL}}` - Privacy policy URL
- `{{TERMS_URL}}` - Terms of service URL

## 🚀 Next Steps

1. **Get Endpoint URL** - Please provide the email service endpoint URL
2. **Get API Key** - Please provide the authentication key
3. **Test Integration** - Test the email sending functionality
4. **Customize Templates** - Modify email templates as needed
5. **Deploy** - Deploy the updated application

## 🐛 Troubleshooting

### Common Issues

1. **Email Service Not Configured**
   - Check that `VITE_EMAIL_SERVICE_URL` is set
   - Verify the endpoint URL is correct

2. **Authentication Failed**
   - Check that `VITE_EMAIL_SERVICE_KEY` is set
   - Verify the API key is correct

3. **Email Not Sending**
   - Check browser console for errors
   - Verify the email service is running
   - Check network requests in browser dev tools

### Debug Commands

```javascript
// Check email service configuration
import { EMAIL_SERVICE_CONFIG } from './src/Config/emailService.js'
console.log('Email service config:', EMAIL_SERVICE_CONFIG)

// Test email service
import { testEmailService } from './src/Config/emailService.js'
testEmailService().then(console.log)
```

## 📞 Support

If you encounter any issues:
1. Check the browser console for error messages
2. Verify all environment variables are set correctly
3. Test the email service endpoint directly
4. Contact the lead developer for email service issues

---

**Ready for Integration**: The project is now prepared to use your lead developer's email service. Please provide the endpoint URL and API key to complete the setup.
