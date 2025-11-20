# Deploy Gemini Loop Fix Feature

## Prerequisites

1. ✅ Gemini API key added to `.env` file
2. ✅ Edge function code created at `supabase/functions/loop-fix-gemini/index.ts`
3. ✅ generate-techno-stem function updated to support Gemini
4. ⚠️ **Functions need to be deployed to Supabase**

## Deployment Steps

### Step 1: Log in to Supabase CLI

```bash
npx supabase login
```

This will open a browser window for authentication.

### Step 2: Link to Your Supabase Project

```bash
npx supabase link --project-ref fsdknzsgdzlexyjallmy
```

Where `fsdknzsgdzlexyjallmy` is your Supabase project reference ID.

###  Step 3: Set Gemini API Key as Secret

The edge functions need access to your Gemini API key. Set it as a secret:

```bash
npx supabase secrets set GEMINI_API_KEY=AIzaSyCiRaNn6NTWcuL-rGhlhWr7c24vZqXQP9g
```

### Step 4: Deploy the loop-fix-gemini Function

```bash
npx supabase functions deploy loop-fix-gemini
```

Expected output:
```
Deploying function loop-fix-gemini...
Function loop-fix-gemini deployed successfully!
```

### Step 5: Deploy the Updated generate-techno-stem Function

```bash
npx supabase functions deploy generate-techno-stem
```

Expected output:
```
Deploying function generate-techno-stem...
Function generate-techno-stem deployed successfully!
```

### Step 6: Verify Deployment

List all deployed functions:

```bash
npx supabase functions list
```

You should see both functions listed with a "Deployed" status.

### Step 7: Test the Functions

Run the test script:

```bash
node test-gemini-loop-fix.js
```

Expected output:
```
✅ SUCCESS: Gemini-assisted loop fix is working!
✅ SUCCESS: generate-techno-stem is using Gemini loop fix!
✅ ALL TESTS PASSED!
```

## Manual Testing

### Test loop-fix-gemini Directly

```bash
curl -X POST \
  https://fsdknzsgdzlexyjallmy.supabase.co/functions/v1/loop-fix-gemini \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "audio_base64": "UklGRiQAAABXQVZFZm10...",
    "target_bpm": 130,
    "bars": 4,
    "use_gemini": true
  }'
```

### Test generate-techno-stem with Gemini

```bash
curl -X POST \
  https://fsdknzsgdzlexyjallmy.supabase.co/functions/v1/generate-techno-stem \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "stem": "kick",
    "master": {"tempo": 130, "bars": 4},
    "use_gemini": true
  }'
```

Check the response for `"loopMethod": "gemini"`.

## Troubleshooting

### Error: "GEMINI_API_KEY not configured"

**Solution:** Make sure you set the secret in Step 3:
```bash
npx supabase secrets set GEMINI_API_KEY=your-key-here
```

Verify secrets are set:
```bash
npx supabase secrets list
```

### Error: "Invalid typed array length"

**Solution:** This usually means the old version of the function is still deployed. Redeploy:
```bash
npx supabase functions deploy loop-fix-gemini --no-verify-jwt
```

### Error: "Function not found"

**Solution:** Make sure you're linked to the correct project:
```bash
npx supabase projects list
npx supabase link --project-ref fsdknzsgdzlexyjallmy
```

### Gemini API Errors

Check if your Gemini API key is valid:
1. Visit https://aistudio.google.com/app/apikey
2. Verify the key hasn't expired
3. Check API quotas and limits

### Viewing Function Logs

To see what's happening inside the functions:

```bash
npx supabase functions logs loop-fix-gemini
```

Or view in the Supabase Dashboard:
1. Go to https://supabase.com/dashboard/project/fsdknzsgdzlexyjallmy
2. Navigate to Edge Functions
3. Click on the function name
4. View the Logs tab

## Quick Deployment Script

Create a file `deploy-gemini.sh`:

```bash
#!/bin/bash

echo "🚀 Deploying Gemini Loop Fix Feature..."

# Set secrets
echo "📝 Setting Gemini API key..."
npx supabase secrets set GEMINI_API_KEY=$GEMINI_API_KEY

# Deploy functions
echo "📤 Deploying loop-fix-gemini..."
npx supabase functions deploy loop-fix-gemini

echo "📤 Deploying generate-techno-stem..."
npx supabase functions deploy generate-techno-stem

echo "✅ Deployment complete!"

# Run tests
echo "🧪 Running tests..."
node test-gemini-loop-fix.js
```

Make it executable and run:
```bash
chmod +x deploy-gemini.sh
./deploy-gemini.sh
```

## Expected Results

After successful deployment, when generating stems:

1. **Console logs** will show:
   ```
   ✓ Using Gemini-enhanced loop fix
   WSOLA applied: BPM 128.5 → 130, ratio: 0.988
   ```

2. **Response will include:**
   ```json
   {
     "loopMethod": "gemini"
   }
   ```

3. **X-LoopFix-Diagnostics header** will contain:
   ```json
   {
     "gemini_used": true,
     "detected_bpm": 128.5,
     "confidence": 0.92,
     "stretch_ratio": 0.988,
     "gemini_call_ms": 2847,
     "wsola_process_ms": 156
   }
   ```

4. **Loops will be perfectly aligned** at the target BPM with no pitch artifacts

## Next Steps

After successful deployment:

1. Test stem generation in the UI
2. Monitor Gemini API usage and costs
3. Compare quality with heuristic method
4. Consider implementing caching for popular loops
5. Set up monitoring alerts for high error rates

## Support

If you encounter issues:

1. Check function logs: `npx supabase functions logs loop-fix-gemini`
2. Verify environment variables are set correctly
3. Test with the provided test script
4. Review the [GEMINI_LOOP_FIX_GUIDE.md](./GEMINI_LOOP_FIX_GUIDE.md) for detailed documentation

---

**Important:** Keep your Gemini API key secure and never commit it to version control!
