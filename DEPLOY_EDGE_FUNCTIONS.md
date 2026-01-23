# Edge Functions Deployment Guide

## Critical Issue
The CORS errors you're experiencing are because the edge functions on Supabase **still have the old code without proper CORS headers**. The local files have been updated, but Supabase is serving the old deployed versions.

## Required Actions

### Step 1: Install Supabase CLI (if not already installed)

```bash
# On macOS
brew install supabase/tap/supabase

# On Linux
curl -fsSL https://raw.githubusercontent.com/supabase/cli/main/install.sh | sh

# On Windows (PowerShell)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

### Step 2: Login to Supabase

```bash
supabase login
```

This will open a browser window to authenticate.

### Step 3: Link Your Project

```bash
# Link to your project (you'll need your project reference ID)
supabase link --project-ref wfloobttzjbfapzyclun
```

### Step 4: Deploy All Edge Functions

Deploy each function with the updated CORS headers:

```bash
# Deploy the separate-stems function
supabase functions deploy separate-stems

# Deploy the generate-techno-stem function
supabase functions deploy generate-techno-stem

# Deploy the loop-fix function
supabase functions deploy loop-fix

# Deploy the NEW eleven-music-compose function
supabase functions deploy eleven-music-compose
```

### Step 5: Verify Deployment

Check that the functions are deployed and accessible:

```bash
# List all deployed functions
supabase functions list

# Test each function health check
curl https://wfloobttzjbfapzyclun.supabase.co/functions/v1/separate-stems \
  -H "Authorization: Bearer YOUR_ANON_KEY"

curl https://wfloobttzjbfapzyclun.supabase.co/functions/v1/generate-techno-stem \
  -H "Authorization: Bearer YOUR_ANON_KEY"

curl https://wfloobttzjbfapzyclun.supabase.co/functions/v1/loop-fix \
  -H "Authorization: Bearer YOUR_ANON_KEY"

curl https://wfloobttzjbfapzyclun.supabase.co/functions/v1/eleven-music-compose \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Step 6: Verify CORS Headers

Test that CORS preflight requests work:

```bash
# Test OPTIONS request to verify CORS
curl -X OPTIONS https://wfloobttzjbfapzyclun.supabase.co/functions/v1/separate-stems \
  -H "Origin: https://your-app.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, content-type" \
  -v
```

You should see these headers in the response:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type, x-requested-with`
- `Access-Control-Max-Age: 86400`

## Alternative: Deploy via Supabase Dashboard

If you prefer using the web interface:

1. Go to https://supabase.com/dashboard/project/wfloobttzjbfapzyclun/functions
2. Click "Create a new function" or select an existing function
3. Copy the content from the local `index.ts` file
4. Paste it into the editor
5. Click "Deploy"
6. Repeat for all functions

## Functions Summary

### 1. separate-stems
- **Purpose**: Separates audio into individual stems (drums, bass, instruments, vocals)
- **Location**: `supabase/functions/separate-stems/index.ts`
- **Updated**: ✅ CORS headers added

### 2. generate-techno-stem
- **Purpose**: Generates techno music stems using AI
- **Location**: `supabase/functions/generate-techno-stem/index.ts`
- **Updated**: ✅ CORS headers added

### 3. loop-fix
- **Purpose**: Fixes loop boundaries in audio
- **Location**: `supabase/functions/loop-fix/index.ts`
- **Updated**: ✅ CORS headers added

### 4. eleven-music-compose (NEW)
- **Purpose**: Composes music using ElevenLabs Music API
- **Location**: `supabase/functions/eleven-music-compose/index.ts`
- **Status**: ✅ Created with proper CORS headers
- **Note**: This function was missing from your local codebase but is being called by the app

## Environment Secrets

Make sure these secrets are configured in your Supabase project:

```bash
# Set the ElevenLabs API key
supabase secrets set ELEVENLABS_API_KEY=your_api_key_here
```

Or via the dashboard:
1. Go to Settings > Edge Functions
2. Add secret: `ELEVENLABS_API_KEY`
3. Enter your ElevenLabs API key

## Troubleshooting

### Error: "Response to preflight request doesn't pass access control check"
- **Cause**: Functions not deployed or old version still deployed
- **Fix**: Deploy the functions using the steps above

### Error: "ELEVENLABS_API_KEY not configured"
- **Cause**: Environment secret not set
- **Fix**: Set the secret using `supabase secrets set` or the dashboard

### Error: "Failed to send a request to the Edge Function"
- **Cause**: Function doesn't exist or is not deployed
- **Fix**: Deploy the function and verify it appears in the functions list

### Functions returning 500 errors
- **Cause**: Missing API key or error in function code
- **Fix**: Check logs: `supabase functions logs <function-name>`

## Expected Behavior After Deployment

Once deployed, you should see:
- ✅ No more CORS errors in the browser console
- ✅ Edge functions return proper responses
- ✅ Stem generation works without "connection issue" messages
- ✅ Audio processing completes successfully

## Verification Checklist

- [ ] Supabase CLI installed and logged in
- [ ] Project linked to local codebase
- [ ] `separate-stems` deployed successfully
- [ ] `generate-techno-stem` deployed successfully
- [ ] `loop-fix` deployed successfully
- [ ] `eleven-music-compose` deployed successfully (NEW)
- [ ] `ELEVENLABS_API_KEY` secret configured
- [ ] CORS preflight requests return 200 OK
- [ ] All functions accessible from the app
- [ ] No CORS errors in browser console

## Next Steps After Deployment

1. Refresh your application in the browser
2. Try generating a stem
3. Check the browser console - CORS errors should be gone
4. Verify the "connection issue" message no longer appears
5. Test all stem types (kick, bass, lead, etc.)

## Need Help?

If you encounter issues:
1. Check function logs: `supabase functions logs <function-name> --tail`
2. Verify secrets are set: `supabase secrets list`
3. Test individual functions using curl commands above
4. Check Supabase dashboard for deployment status
