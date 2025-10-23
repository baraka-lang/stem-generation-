# Email Confirmation Setup Guide

## Overview

This project uses a custom Edge Function to send branded confirmation emails instead of Supabase's default emails. This prevents duplicate emails while maintaining email verification requirements.

## How It Works

1. **User signs up** → `signUp()` called with `emailRedirectTo: null`
2. **Supabase creates user** but doesn't send email (because `emailRedirectTo: null`)
3. **Client-side code** calls Edge Function to send custom branded email
4. **User receives ONE email** with confirmation link
5. **User clicks link** → email is confirmed in Supabase
6. **User can now log in** (Supabase checks `email_confirmed_at` field)
7. **Login blocked** if email not confirmed (enforced by Supabase Auth)

## Required Supabase Dashboard Configuration

### Authentication Settings
Navigate to: **Authentication > Providers > Email**

**Required Settings:**
- ✅ **Enable email confirmations**: ON (enforces verification)
- ✅ **Confirm email**: ON (users must verify)
- ✅ **Secure email change**: ON
- ❌ **Mailer autoconfirm**: OFF (prevents automatic confirmation)

### Email Template Configuration
Navigate to: **Authentication > Email Templates > Confirm signup**

**Options:**
1. **Minimal template**: Use a simple template that doesn't send emails
2. **Custom template**: Point to your Edge Function endpoint
3. **Blank template**: Leave empty (Edge Function handles everything)

## Code Implementation

### Client-Side Duplicate Prevention

The `signUp()` function in `src/Auth/index.js` includes:

```javascript
// Check if user was just created (within 10 seconds)
const isNewSignup = timeDiff < 10000 // Less than 10 seconds = fresh signup

// Only send email for truly fresh signups
if (isNewSignup) {
  console.log('Sending confirmation email for fresh signup:', email)
  const emailResult = await sendConfirmationEmail(email, confirmationUrl)
  // ... handle result
} else {
  console.log('Skipping email - not a fresh signup (may be existing unconfirmed user)')
}
```

### Server-Side Duplicate Prevention

The Edge Function (`supabase/functions/send-email/index.ts`) includes:

- **Time-based check**: Only sends emails for users created within last 5 minutes
- **Profile check**: Verifies user doesn't already have a profile
- **Confirmation status**: Only sends if `email_confirmed_at` is null

## Testing the Setup

### 1. Clear Test Data
Remove any existing test users from Supabase Dashboard

### 2. Test Fresh Signup
- Sign up with a new email
- Verify only ONE confirmation email is received
- Check browser console for "Sending confirmation email for fresh signup" log

### 3. Test Login Before Confirmation
- Attempt to log in before confirming email
- Should be blocked with clear error message: "Please verify your email address before logging in. Check your inbox for the confirmation link."

### 4. Test Email Confirmation
- Click confirmation link in email
- Verify user can now log in successfully

### 5. Test Duplicate Signup
- Try to sign up again with same email before confirming
- Should receive message about existing account
- Should NOT receive another confirmation email
- Check console for "Skipping email - not a fresh signup" log

## Troubleshooting

### Duplicate Emails Still Being Sent

1. **Check Supabase Settings**:
   - Ensure "Mailer autoconfirm" is OFF
   - Verify "Enable email confirmations" is ON

2. **Check Client Logs**:
   - Look for "Sending confirmation email for fresh signup" vs "Skipping email"
   - Verify time difference calculations

3. **Check Edge Function Logs**:
   - Review function execution logs
   - Look for duplicate prevention logic working

### Users Can Login Without Confirming

1. **Verify Supabase Settings**:
   - Ensure "Confirm email" is checked
   - Check that "Enable email confirmations" is ON

2. **Test with Fresh User**:
   - Create new test user
   - Try logging in immediately (should be blocked)

### No Confirmation Emails Being Sent

1. **Check Edge Function**:
   - Verify function is deployed
   - Check function logs for errors
   - Ensure RESEND_API_KEY is configured

2. **Check Client Code**:
   - Verify `sendConfirmationEmail()` is being called
   - Check for error messages in console

3. **Check Email Service**:
   - Verify Resend API key is valid
   - Check Resend dashboard for delivery status

## Configuration Files

### Environment Variables Required
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
RESEND_API_KEY=your_resend_api_key  # In Edge Function environment
```

### Key Code Files
- `src/Auth/index.js` - Client-side authentication logic
- `src/Auth/loginPage.js` - Login UI and error handling
- `supabase/functions/send-email/index.ts` - Email sending Edge Function
- `src/Config/emailService.js` - Email service configuration

## Monitoring

### Console Logs to Watch
- `"Sending confirmation email for fresh signup"` - Email being sent
- `"Skipping email - not a fresh signup"` - Duplicate prevented
- `"Login blocked: Email not confirmed"` - Verification working
- `"Custom confirmation email sent to:"` - Success

### Edge Function Logs
- Check Supabase Dashboard > Edge Functions > send-email
- Look for execution logs and any errors
- Monitor email delivery success/failure

## Security Notes

- Email verification is enforced at the Supabase Auth level
- Users cannot log in until `email_confirmed_at` is set
- The 10-second fresh signup check prevents race conditions
- Server-side duplicate prevention provides additional safety
