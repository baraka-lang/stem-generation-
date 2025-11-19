# Stem Separation Error Fix

## Problem
The stem separation feature was throwing the error: "Failed to send a request to the Edge Function"

## Root Causes Identified

1. **Missing API Key**: ELEVENLABS_API_KEY was not configured in environment variables
2. **Network Reliability**: Supabase Edge Functions have known intermittent connectivity issues affecting ~1% of requests
3. **No Retry Logic**: Single request failures would immediately error out
4. **Poor Error Messages**: Generic error messages didn't help users diagnose issues
5. **No Payload Validation**: Large audio files could cause silent failures

## Solutions Implemented

### 1. Environment Configuration
- Added ELEVENLABS_API_KEY to `.env` file
- Updated `.env.example` with proper documentation
- Added hint messages pointing to Supabase project secrets configuration

### 2. Retry Logic with Exponential Backoff
Created new utility module: `src/Utilities/retryHelper.js`

Features:
- Automatic retry for network-related errors
- Exponential backoff (2s, 4s, 8s delays)
- Maximum 3 retry attempts
- User feedback during retry attempts
- Smart detection of retryable errors

### 3. Enhanced Error Handling
Improved error messages for specific scenarios:
- API key not configured
- Authentication failures
- Invalid audio format
- File too large
- Rate limiting
- Network timeouts
- Service unavailable
- Connection failures after retries

### 4. Payload Size Validation
- Validates audio file size before transmission
- Maximum 25MB limit (ElevenLabs constraint)
- Shows file size in MB for debugging
- Provides helpful error message if too large

### 5. Edge Function Improvements
Enhanced `supabase/functions/separate-stems/index.ts`:

- Added GET endpoint for health checks
- Improved logging with timestamps
- Better error context and stack traces
- Processing time metrics
- Environment variable debugging
- API key validation with masked logging

## Usage Instructions

### Step 1: Configure API Key
Add your ElevenLabs API key to the environment:

```bash
# In .env file
ELEVENLABS_API_KEY=your-actual-api-key-here
```

### Step 2: Deploy Edge Function Secret
In Supabase dashboard or CLI, set the secret:

```bash
supabase secrets set ELEVENLABS_API_KEY=your-actual-api-key-here
```

### Step 3: Verify Deployment
Check edge function health:

```bash
curl https://your-project.supabase.co/functions/v1/separate-stems
```

Should return:
```json
{
  "status": "healthy",
  "service": "separate-stems",
  "version": "1.0.0",
  "apiKeyConfigured": true,
  "timestamp": "2025-11-19T..."
}
```

## Testing Recommendations

1. **Test with valid audio**: Generate a stem and try separation
2. **Test error recovery**: Temporarily disable network to verify retry logic
3. **Test size limits**: Try separating a very long audio clip
4. **Check logs**: Monitor Supabase function logs for detailed diagnostics
5. **Verify UI feedback**: Ensure error messages are user-friendly

## Expected Behavior

### Success Flow
1. User clicks "Separate Stem" button
2. UI shows "Processing audio (this may take 10-30 seconds)..."
3. Audio is validated and sent to edge function
4. If connection fails, automatic retry with progress message
5. Separated stem is returned and loaded
6. Success message: "Successfully extracted [stem] stem!"

### Error Flow
1. If error occurs, user sees specific error message
2. Retry attempts shown: "Connection issue, retrying (1/3)..."
3. Final error after retries: "Connection issue after multiple retries..."
4. Error persists for 8 seconds before resetting

## Monitoring

### Client-Side Logs
Console logs include:
- Payload sizes in MB
- Retry attempt numbers
- Processing timestamps
- Detailed error context

### Server-Side Logs
Edge function logs include:
- Request timestamps
- Processing duration
- API key configuration status
- ElevenLabs API responses
- Error stack traces

## Known Limitations

1. **Intermittent Failures**: Due to known Supabase Edge Function issues, ~1% of requests may still fail even with retries
2. **File Size**: Maximum 25MB audio files
3. **Processing Time**: Can take 10-60 seconds depending on audio length
4. **Rate Limiting**: ElevenLabs API has rate limits per account

## Troubleshooting

### "API key not configured"
- Verify ELEVENLABS_API_KEY is in .env file
- Check Supabase project secrets in dashboard
- Ensure edge function has been redeployed after adding secret

### "Connection to server failed"
- Check edge function is deployed: `supabase functions list`
- Verify edge function health endpoint responds
- Check browser console for CORS errors
- Ensure Supabase project is not paused

### "Audio file too large"
- Reduce number of bars in generation
- Use shorter audio clips
- Check if sample rate can be reduced

### Multiple retry failures
- Check internet connection stability
- Verify ElevenLabs API status
- Check Supabase service status
- Try again in a few minutes

## Technical Details

### Retry Helper Module
Location: `src/Utilities/retryHelper.js`

Key Functions:
- `retryWithBackoff()`: Generic retry with exponential backoff
- `isRetryableError()`: Identifies network/temporary errors
- `retryEdgeFunctionCall()`: Specialized for Supabase edge functions

### Error Detection
Retryable error patterns:
- "Failed to send a request"
- "network error"
- "timeout"
- "FunctionsFetchError"
- ECONNREFUSED, ETIMEDOUT, etc.

### Integration Points
- `src/app.js`: Main separation logic in `separateCurrentStem()`
- `supabase/functions/separate-stems/index.ts`: Edge function handler
- `.env`: Environment configuration

## Future Improvements

1. Circuit breaker pattern for persistent failures
2. Caching of separated stems
3. Progress estimation based on audio length
4. Batch separation for multiple instruments
5. Client-side audio pre-processing to reduce payload size
6. WebSocket connection for real-time progress updates
