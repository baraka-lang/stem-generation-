# Vercel Environment Configuration for Dynamic URLs

This guide explains how to configure your Vercel environments to use dynamic URLs for password reset and email confirmation links.

## Environment Variables Setup

### 1. Production Environment

In your Vercel dashboard, set these environment variables for **Production**:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# App Configuration
VITE_APP_URL=https://www.stemflow.app
APP_URL=https://www.stemflow.app

# Email Service Configuration
VITE_EMAIL_SERVICE_URL=https://your-project-id.supabase.co/functions/v1/send-email
VITE_EMAIL_SERVICE_KEY=your-email-service-key
RESEND_API_KEY=your-resend-api-key

# Environment Detection
VERCEL_ENV=production
```

### 2. Staging Environment

For your **Staging** environment:

```bash
# Supabase Configuration (same as production)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# App Configuration (staging domain)
VITE_APP_URL=https://staging.stemflow.app
APP_URL=https://staging.stemflow.app

# Email Service Configuration (same as production)
VITE_EMAIL_SERVICE_URL=https://your-project-id.supabase.co/functions/v1/send-email
VITE_EMAIL_SERVICE_KEY=your-email-service-key
RESEND_API_KEY=your-resend-api-key

# Environment Detection
VERCEL_ENV=preview
```

### 3. Preview/Development Environment

For **Preview** deployments (feature branches):

```bash
# Supabase Configuration (same as production)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# App Configuration (Vercel will auto-generate this)
VITE_APP_URL=https://your-branch-name.vercel.app
APP_URL=https://your-branch-name.vercel.app

# Email Service Configuration (same as production)
VITE_EMAIL_SERVICE_URL=https://your-project-id.supabase.co/functions/v1/send-email
VITE_EMAIL_SERVICE_KEY=your-email-service-key
RESEND_API_KEY=your-resend-api-key

# Environment Detection (Vercel auto-sets this)
VERCEL_ENV=preview
VERCEL_URL=your-branch-name.vercel.app
```

### 4. Local Development

Create a `.env.local` file in your project root:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# App Configuration
VITE_APP_URL=http://localhost:5173
APP_URL=http://localhost:5173

# Email Service Configuration
VITE_EMAIL_SERVICE_URL=https://your-project-id.supabase.co/functions/v1/send-email
VITE_EMAIL_SERVICE_KEY=your-email-service-key
RESEND_API_KEY=your-resend-api-key

# Environment Detection
VERCEL_ENV=development
```

## How It Works

### Environment Detection

The system automatically detects the environment based on:

1. **Vercel Environment Variables**: `VERCEL_ENV` (production, preview)
2. **URL Patterns**: Checks if the URL contains "staging" for staging environment
3. **Fallback**: Defaults to development for localhost

### Dynamic URL Generation

Based on the detected environment, the system generates URLs:

- **Production**: `https://www.stemflow.app/reset-password.html?token=...`
- **Staging**: `https://staging.stemflow.app/reset-password.html?token=...`
- **Preview**: `https://your-branch-name.vercel.app/reset-password.html?token=...`
- **Development**: `http://localhost:5173/reset-password.html?token=...`

### JWT Token Integration

The system automatically appends JWT tokens to URLs:

1. **Password Reset**: `?token={JWT}&type=recovery`
2. **Email Confirmation**: `?access_token={JWT}&refresh_token={JWT}&type=signup`

## Setting Up in Vercel Dashboard

### 1. Go to Project Settings
1. Navigate to your project in Vercel dashboard
2. Click on "Settings" tab
3. Go to "Environment Variables" section

### 2. Add Environment Variables
1. Click "Add New" for each environment variable
2. Set the variable name and value
3. Choose which environments to apply it to:
   - **Production**: For production deployments
   - **Preview**: For branch deployments and staging
   - **Development**: For local development

### 3. Environment-Specific Settings

For each environment variable, you can:
- Apply to **Production** only
- Apply to **Preview** only  
- Apply to **Development** only
- Apply to **All** environments

### Example Configuration

```bash
# Production Only
APP_URL=https://www.stemflow.app

# Preview Only  
APP_URL=https://staging.stemflow.app

# Development Only
APP_URL=http://localhost:5173
```

## Testing the Configuration

### 1. Test Environment Detection

Add this to your browser console to verify environment detection:

```javascript
// This will show the current environment
console.log('Current Environment:', window.location.hostname);

// Test URL generation
import { environmentInfo, urlGenerators } from './src/Config/environment.js';
console.log('Environment Info:', environmentInfo);
```

### 2. Test Email URLs

1. Trigger a password reset in each environment
2. Check the email links point to the correct domain
3. Verify the JWT tokens are properly attached

### 3. Verify Edge Function Logs

Check your Supabase Edge Function logs to see:
- Environment detection working correctly
- URLs being generated with the right domain
- JWT tokens being properly formatted

## Troubleshooting

### Common Issues

1. **Wrong URLs in emails**: Check that `APP_URL` and `VERCEL_URL` are set correctly
2. **Environment not detected**: Verify `VERCEL_ENV` is set in Vercel
3. **Tokens not working**: Ensure JWT tokens are being passed correctly from Supabase

### Debug Mode

Enable debug logging by adding this to your Edge Function:

```typescript
console.log('Environment Detection:', {
  vercelEnv: Deno.env.get('VERCEL_ENV'),
  appUrl: Deno.env.get('APP_URL'),
  vercelUrl: Deno.env.get('VERCEL_URL'),
  detectedEnv: currentEnvironment,
  urls: environmentUrls
});
```

## Security Considerations

1. **Never commit `.env.local`** to version control
2. **Use different Supabase projects** for staging/production if needed
3. **Rotate API keys** regularly
4. **Monitor email sending** to prevent abuse

## Next Steps

1. Set up the environment variables in Vercel
2. Deploy to staging to test
3. Verify email URLs work correctly
4. Deploy to production
5. Monitor logs for any issues

