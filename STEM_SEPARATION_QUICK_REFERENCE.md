# Stem Separation - Quick Reference Card

## What Was Wrong
The ZIP parser couldn't handle compressed files from ElevenLabs API → causing most separation attempts to fail.

## What Was Fixed
✅ **DEFLATE compression support** - Can now parse compressed ZIP files
✅ **Comprehensive validation** - Catches errors before they cause problems
✅ **Better error messages** - Clear, actionable feedback for users
✅ **Detailed logging** - Makes debugging much easier

## How to Deploy

```bash
# 1. Deploy the edge function
supabase functions deploy separate-stems

# 2. Verify API key is set (in Supabase Dashboard)
# Settings → Edge Functions → Secrets → ELEVENLABS_API_KEY

# 3. Test the health endpoint
curl https://YOUR-PROJECT.supabase.co/functions/v1/separate-stems
```

## How to Test

1. Generate a stem (kick, bass, any type)
2. Click waveform → Opens edit modal
3. Click "Separate Stem" button
4. Wait 10-30 seconds
5. Should see: "Successfully extracted [type] stem!"

## Common Errors & Fixes

| Error | Fix |
|-------|-----|
| "API key not configured" | Add ELEVENLABS_API_KEY to Supabase secrets |
| "Invalid audio format" | Regenerate the stem |
| "Audio too large" | Use fewer bars (try 4 or 8 bars) |
| "Connection failed" | Check internet, redeploy edge function |
| "Processing timed out" | Try shorter audio clip |

## What to Check If It Fails

**Browser Console** (F12 → Console tab):
```
Look for: [stem-separation] logs
Should see: "Starting separation", "Edge function response", "Audio decoded successfully"
If error: Note the error category and message
```

**Supabase Logs** (Dashboard → Edge Functions → separate-stems → Logs):
```
Look for: [separate-stems] and [zip-parser] logs
Should see: "ElevenLabs response status: 200", "Found file:", "Decompressed size:"
If error: Note which step failed
```

## Quick Diagnostic Commands

```bash
# Check if edge function is deployed
supabase functions list

# View edge function logs
supabase functions logs separate-stems --limit 50

# Test health endpoint
curl https://YOUR-PROJECT.supabase.co/functions/v1/separate-stems
```

## Expected Processing Times

- **4 bars** (~3-5 seconds audio): 10-20 seconds
- **8 bars** (~6-10 seconds audio): 15-30 seconds
- **16 bars** (~12-20 seconds audio): 25-45 seconds

Longer than this? Check network connection and ElevenLabs API status.

## Limits

- **Max duration**: 5 minutes
- **Max file size**: 25MB (WAV)
- **Timeout**: 3 minutes
- **Supported stems**: kick, bass, lead, pad, hihat, perc, arp, fx

## Files Changed

1. `supabase/functions/separate-stems/index.ts` - Edge function (main fix)
2. `src/app.js` - Frontend validation and error handling

## Documentation

- **STEM_SEPARATION_DIAGNOSTICS.md** - Detailed troubleshooting guide
- **STEM_SEPARATION_FIXES_SUMMARY.md** - Complete technical summary
- **STEM_SEPARATION_QUICK_REFERENCE.md** - This document

## Support Checklist

When reporting issues, provide:
- [ ] Browser console logs (search for `[stem-separation]`)
- [ ] Edge function logs from Supabase dashboard
- [ ] Stem type attempted (kick, bass, etc.)
- [ ] Audio duration/bars used
- [ ] Error message shown to user
- [ ] Which step failed (encoding, API call, parsing, decoding)

## One-Line Summary

**Added ZIP compression support and comprehensive validation to fix stem separation failures.**
