# Email Template Setup Guide

This guide explains how to set up custom email templates for 343 Labs AI Music Studio using Supabase Auth.

## 📧 Email Templates Overview

The application includes custom email templates for:
- **Email Confirmation** - Sent when users sign up
- **Password Reset** - Sent when users request password reset
- **Welcome Email** - Sent after successful email confirmation

## 🚀 Quick Setup

### 1. Deploy the Edge Function

```bash
# Deploy the email function to Supabase
supabase functions deploy send-email
```

### 2. Configure Supabase Auth

The `supabase/config.toml` file is already configured to use custom email templates:

```toml
[auth.email.template.confirmation]
subject = "Confirm Your Email - 343 Labs AI Music Studio"
content_path = "./supabase/functions/send-email/EmailTemplates/confirmation.html"

[auth.email.template.recovery]
subject = "Reset Your Password - 343 Labs AI Music Studio"
content_path = "./supabase/functions/send-email/EmailTemplates/password-reset.html"
```

### 3. Set Environment Variables

Add these to your Supabase project settings:

```env
APP_URL=https://your-app.com
SUPPORT_URL=https://your-app.com/support
PRIVACY_URL=https://your-app.com/privacy
TERMS_URL=https://your-app.com/terms
```

## 📁 File Structure

```
supabase/
├── functions/
│   └── send-email/
│       ├── index.ts
│       └── EmailTemplates/
│           ├── confirmation.html
│           ├── password-reset.html
│           └── welcome.html
└── config.toml
```

## 🎨 Email Template Features

### Design Consistency
- **343 Labs Branding** - Purple/pink gradient header
- **Professional Layout** - Clean, modern design
- **Mobile Responsive** - Optimized for all devices
- **Email Client Compatible** - Inline CSS for maximum compatibility

### Template Variables
All templates support these dynamic variables:
- `{{USER_EMAIL}}` - User's email address
- `{{CONFIRMATION_LINK}}` - Email confirmation link
- `{{RESET_LINK}}` - Password reset link
- `{{APP_URL}}` - Application URL
- `{{SUPPORT_URL}}` - Support page URL
- `{{PRIVACY_URL}}` - Privacy policy URL
- `{{TERMS_URL}}` - Terms of service URL

## 🔧 Customization

### Updating Email Templates

1. Edit the HTML files in `supabase/functions/send-email/EmailTemplates/`
2. Redeploy the function: `supabase functions deploy send-email`
3. Test with the email preview page at `#confirm-email`

### Adding New Templates

1. Create new HTML file in `EmailTemplates/` directory
2. Add template configuration to `index.ts`
3. Update `supabase/config.toml` if needed
4. Deploy the function

### Styling Guidelines

- Use inline CSS only (email clients strip `<style>` tags)
- Test with multiple email clients (Gmail, Outlook, Apple Mail)
- Keep max-width at 600px for mobile compatibility
- Use web-safe fonts: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

## 🧪 Testing

### Local Development

1. Start Supabase locally: `supabase start`
2. Use the email preview page: Navigate to `#confirm-email`
3. Check Inbucket for sent emails: http://localhost:54324

### Production Testing

1. Deploy to Supabase: `supabase functions deploy send-email`
2. Test password reset flow
3. Check email delivery in your email client

## 📋 Email Flow

### Password Reset Flow

1. User clicks "Forgot Password" on login page
2. User enters email address
3. Supabase sends password reset email using custom template
4. User clicks reset link in email
5. User is redirected to `reset-password.html` page
6. User enters new password with validation
7. Password is updated and user is redirected to login

### Email Confirmation Flow

1. User signs up with email
2. Supabase sends confirmation email using custom template
3. User clicks confirmation link in email
4. Email is confirmed and welcome email is sent
5. User can now log in

## 🔒 Security Features

- **Token Expiration** - Reset links expire in 1 hour
- **One-time Use** - Reset links can only be used once
- **Secure Headers** - CORS and security headers included
- **Input Validation** - All inputs are validated and sanitized

## 🐛 Troubleshooting

### Common Issues

1. **Emails not sending**
   - Check Supabase project settings
   - Verify environment variables
   - Check function logs: `supabase functions logs send-email`

2. **Templates not loading**
   - Ensure file paths are correct
   - Check file permissions
   - Redeploy the function

3. **Styling issues**
   - Use inline CSS only
   - Test with multiple email clients
   - Check for unsupported CSS properties

### Debug Commands

```bash
# View function logs
supabase functions logs send-email

# Test function locally
supabase functions serve send-email

# Deploy function
supabase functions deploy send-email
```

## 📞 Support

For issues with email templates or Supabase configuration:
1. Check the Supabase documentation
2. Review function logs
3. Test with email preview page
4. Contact support if needed

---

**Note**: This setup provides a complete email template system for 343 Labs AI Music Studio. The templates are professionally designed and fully integrated with Supabase Auth.
