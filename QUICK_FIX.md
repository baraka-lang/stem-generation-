# 🚨 QUICK FIX: CORS Errors

## The Problem
Your edge functions on Supabase have old code without proper CORS headers. The files are updated locally but **not deployed to Supabase**.

## The Solution (3 Steps)

### 1. Install Supabase CLI
```bash
# macOS
brew install supabase/tap/supabase

# Linux
curl -fsSL https://raw.githubusercontent.com/supabase/cli/main/install.sh | sh
```

### 2. Login & Link
```bash
supabase login
supabase link --project-ref wfloobttzjbfapzyclun
```

### 3. Deploy Functions
```bash
supabase functions deploy separate-stems
supabase functions deploy generate-techno-stem
supabase functions deploy loop-fix
supabase functions deploy eleven-music-compose
```

## What This Does
- Updates the deployed functions with proper CORS headers
- Fixes "Response to preflight request doesn't pass access control check" errors
- Stops the "retrying, connection issue" loops
- Deploys the missing `eleven-music-compose` function

## After Deployment
1. Refresh your browser
2. Try generating a stem
3. CORS errors should be gone ✅

## Can't Use CLI?
Use the Supabase Dashboard:
1. Go to https://supabase.com/dashboard/project/wfloobttzjbfapzyclun/functions
2. For each function, click it and paste the code from `supabase/functions/<name>/index.ts`
3. Click "Deploy"

## Verify It Worked
Check browser console - you should NOT see:
- ❌ "Access to fetch blocked by CORS policy"
- ❌ "Response to preflight request doesn't pass access control check"

You SHOULD see:
- ✅ Successful API calls
- ✅ Stems generating properly
- ✅ No connection errors
