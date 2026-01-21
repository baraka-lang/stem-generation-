# Gemini AI-Enhanced Loop Fix Guide

## Overview

The Gemini Loop Fix feature integrates Google's Gemini 3 Pro API to provide AI-assisted beat grid analysis and WSOLA (Waveform Similarity Overlap-Add) time-stretching for perfect loop alignment. This dramatically improves the quality of techno stems by ensuring precise BPM detection, intelligent downbeat identification, and bar-perfect looping without pitch artifacts.

## Key Features

### 1. AI-Assisted Beat Analysis
- Uses Gemini 3 Pro Preview model for accurate BPM detection (40-300 BPM range)
- Identifies downbeats, transients, and optimal loop points
- Provides confidence scores and frame-accurate timing information
- Handles complex rhythmic patterns better than heuristic methods

### 2. WSOLA Time-Stretching
- Warp loops to perfect bar alignment without changing pitch
- Grain-based processing with Hanning window (32ms grain, 12ms overlap)
- Cross-correlation for phase continuity
- Safe stretch ratio range: 0.85-1.15 (prevents artifacts)

### 3. Graceful Fallback
- Automatically falls back to heuristic loop fix if Gemini fails
- Maintains backward compatibility with existing functionality
- Comprehensive error handling and diagnostics

## Setup Instructions

### 1. Get Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Create a new API key
4. Copy the API key

### 2. Configure Environment Variables

Add to your `.env` file:

```bash
# Gemini API Configuration
GEMINI_API_KEY=your-gemini-api-key-here
VITE_USE_GEMINI_LOOP_FIX=true
```

For production deployment, add the `GEMINI_API_KEY` as a Bolt Database project secret.

### 3. Deploy Edge Functions

Deploy the new loop-fix-gemini edge function:

```bash
# Deploy the Gemini-enhanced loop fix function
supabase functions deploy loop-fix-gemini

# Update the generate-techno-stem function
supabase functions deploy generate-techno-stem
```

## How It Works

### Processing Pipeline

1. **Audio Generation**
   - ElevenLabs API generates raw audio based on user prompt
   - Returns PCM audio data at 44.1kHz

2. **Gemini Analysis** (if enabled)
   - Converts PCM to WAV format
   - Sends audio to Gemini 3 Pro API with structured JSON schema
   - Receives beat grid analysis:
     - `detected_bpm`: Actual BPM of the audio
     - `confidence`: Analysis confidence (0-1 scale)
     - `downbeat_frames`: Frame indices of downbeats
     - `suggested_start_frame`: Optimal loop start point
     - `seam_frame`: Best crossfade location

3. **WSOLA Time-Stretching**
   - Calculates stretch ratio: `detected_bpm / target_bpm`
   - Only applies if ratio is between 0.85-1.15
   - Warps audio to match target BPM without pitch change
   - Uses grain-based processing for smooth results

4. **Loop Trimming & Crossfade**
   - Trims to exact bar length
   - Applies equal-power crossfade at seam point
   - Adds edge ramps to prevent clicks
   - Returns bar-perfect loop

### Fallback Strategy

If Gemini analysis fails (timeout, API error, invalid response):
1. Logs the error reason
2. Falls back to heuristic methods:
   - Energy-based head detection
   - Error minimization seam search
   - Standard crossfade application
3. Sets `gemini_used: false` in diagnostics
4. Returns valid loop (same quality as original implementation)

## API Reference

### Edge Function: `loop-fix-gemini`

**Endpoint:** `${SUPABASE_URL}/functions/v1/loop-fix-gemini`

**Request:**
```json
{
  "audio_base64": "base64-encoded WAV file",
  "target_bpm": 130,
  "bars": 4,
  "use_gemini": true
}
```

**Response:**
```json
{
  "fixed_audio_base64": "base64-encoded fixed WAV"
}
```

**Response Headers:**
```
X-LoopFix-Diagnostics: {
  "detected_bpm": 128.5,
  "confidence": 0.92,
  "stretch_ratio": 0.988,
  "gemini_used": true,
  "suggested_start_frame": 4410,
  "seam_frame": 215040,
  "gemini_call_ms": 2847,
  "wsola_process_ms": 156,
  "total_process_ms": 3124
}
```

### Edge Function: `generate-techno-stem`

Now accepts optional `use_gemini` parameter:

```json
{
  "stem": "kick",
  "controls": {},
  "master": {
    "tempo": 130,
    "bars": 4,
    "rootBase": "A",
    "accidental": "natural",
    "mode": "Minor"
  },
  "use_gemini": true
}
```

**Response includes:**
```json
{
  "audio_b64": "data:audio/wav;base64,...",
  "loopMethod": "gemini",
  "tier": 0,
  "validated": true
}
```

Where `loopMethod` is either:
- `"gemini"` - AI-enhanced loop fix was used
- `"heuristic"` - Classic loop fix was used (fallback)

## Configuration

### Feature Flag

Toggle Gemini loop fix globally:

```javascript
// In src/Config/environment.js
export const loopFixConfig = {
  useGemini: import.meta.env.VITE_USE_GEMINI_LOOP_FIX === 'true',
  isGeminiEnabled: () => loopFixConfig.useGemini && !!import.meta.env.GEMINI_API_KEY
};
```

### Per-Request Control

Override the global setting per request:

```javascript
const response = await fetch(functionUrl, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    stem: 'kick',
    master: { tempo: 130, bars: 4 },
    use_gemini: false  // Disable for this request
  })
});
```

## Diagnostics & Debugging

### Console Logs

The edge function logs detailed diagnostics:

```
✓ Using Gemini-enhanced loop fix
Loop-fix diagnostics: {"detected_bpm":128.5,"confidence":0.92,...}
```

Or if falling back:

```
⚠ Gemini loop fix failed, using heuristic fallback
```

### Response Headers

Parse the `X-LoopFix-Diagnostics` header to see:
- Whether Gemini was used
- Detected BPM and confidence
- Stretch ratio applied
- Processing times for each stage
- Any errors encountered

Example:
```javascript
const diagnostics = JSON.parse(response.headers.get('X-LoopFix-Diagnostics'));
console.log(`BPM: ${diagnostics.detected_bpm}, Confidence: ${diagnostics.confidence}`);
console.log(`Method: ${diagnostics.gemini_used ? 'Gemini' : 'Heuristic'}`);
```

## Cost & Performance

### Token Usage

Approximate costs per loop:
- **Audio tokens:** ~32 tokens/second of audio
  - 8-second loop = ~256 audio tokens
- **Prompt tokens:** ~100 tokens
- **Total per request:** ~350 tokens

For Gemini 3 Pro (as of Jan 2025):
- Cost: ~$0.0035 per loop (~350 tokens × $0.00001 per token)
- Very affordable for production use

### Processing Time

Typical timings:
- **Gemini API call:** 2-5 seconds
- **WSOLA processing:** 100-300ms
- **Total:** 3-6 seconds per stem
- **Timeout:** 60 seconds (configurable)

### Optimization Tips

1. **Caching:** Consider caching Gemini responses for identical audio inputs
2. **Rate Limiting:** Implement request throttling to respect API limits
3. **Circuit Breaker:** Automatically disable if error rate exceeds 20%
4. **Monitoring:** Track success rates and API costs in production

## Testing

### Manual Testing

Test the loop-fix-gemini function directly:

```bash
# Create test WAV file
curl https://your-domain.com/test-audio.wav -o test.wav

# Convert to base64
base64 test.wav > test.b64

# Call the function
curl -X POST \
  https://your-project.supabase.co/functions/v1/loop-fix-gemini \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"audio_base64\": \"$(cat test.b64)\",
    \"target_bpm\": 130,
    \"bars\": 4,
    \"use_gemini\": true
  }"
```

### A/B Testing

Compare Gemini vs heuristic methods:

```javascript
// Generate with Gemini
const geminiResponse = await generateStem({ use_gemini: true });

// Generate with heuristic
const heuristicResponse = await generateStem({ use_gemini: false });

// Compare quality metrics
console.log('Gemini BPM:', geminiResponse.diagnostics.detected_bpm);
console.log('Loop method:', geminiResponse.loopMethod);
```

### Quality Validation

Test with various scenarios:
- Different BPM ranges (80-180)
- Different bar counts (1-8)
- Various stem types (kick, bass, lead, etc.)
- Edge cases (very fast/slow tempos)

## Troubleshooting

### Common Issues

#### 1. Gemini API Key Not Working

**Error:** `"GEMINI_API_KEY not configured"`

**Solution:**
- Verify API key is correctly set in `.env`
- Check API key is valid at Google AI Studio
- Ensure environment variables are loaded

#### 2. Timeout Errors

**Error:** `"Gemini API timeout after 30 seconds"`

**Solution:**
- Check network connectivity
- Verify Gemini API service status
- Consider increasing timeout for longer audio files

#### 3. Invalid Response

**Error:** `"Invalid Gemini API response structure"`

**Solution:**
- Check Gemini API quota/limits
- Verify audio format is valid WAV
- Review Gemini API status page

#### 4. Stretch Ratio Out of Range

**Warning:** `"Stretch ratio X outside safe range (0.85-1.15), skipping WSOLA"`

**Explanation:** Detected BPM differs too much from target BPM. WSOLA skipped to prevent artifacts. Loop still created using heuristic method.

### Debug Mode

Enable detailed logging:

```bash
# In edge function environment
export DEBUG_LOOP_FIX=true
```

This will log:
- Full Gemini API request/response
- WSOLA processing details
- Frame-by-frame analysis
- Seam selection reasoning

## Best Practices

### 1. Production Deployment

- Store `GEMINI_API_KEY` as Bolt Database secret
- Set up monitoring for API calls and errors
- Implement rate limiting to stay within quotas
- Use circuit breaker pattern for reliability

### 2. Cost Management

- Set daily/monthly quota limits
- Cache responses for popular loop configurations
- Monitor token usage per user/session
- Consider graduated feature access (free vs paid)

### 3. User Experience

- Show "AI-Enhanced" badge when Gemini is used
- Display confidence scores in developer console
- Provide toggle in settings to enable/disable
- Fall back gracefully without user-visible errors

### 4. Quality Assurance

- Verify loops are exactly bar-perfect after warping
- Check phase coherence at seam with spectrogram
- Measure processing time and ensure under 10s
- Test fallback behavior when Gemini unavailable

## Future Enhancements

Potential improvements:
1. **Advanced prompts:** Fine-tune Gemini prompts for better accuracy
2. **Multi-model support:** Add fallback to Gemini 2.5 Flash for speed
3. **Batch processing:** Process multiple stems in parallel
4. **Custom models:** Train specialized audio analysis models
5. **Real-time preview:** Show waveform with detected beats in UI
6. **User feedback loop:** Learn from user corrections

## Support

For issues or questions:
- Check console logs and diagnostics headers
- Review Gemini API documentation
- Test with simple audio files first
- Verify all environment variables are set
- Check Supabase edge function logs

## Conclusion

The Gemini AI-Enhanced Loop Fix feature provides state-of-the-art loop alignment using cutting-edge AI models and advanced DSP techniques. It's production-ready, cost-effective, and designed to gracefully fall back to proven heuristic methods when needed. The result is perfectly looped stems that sync precisely at any BPM, dramatically improving techno track production quality.
