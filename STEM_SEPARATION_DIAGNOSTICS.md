# Stem Separation Diagnostics Guide

## What Was Fixed

### 1. ZIP Compression Support (CRITICAL FIX)
**Problem**: The original ZIP parser only handled uncompressed (STORED) files. ElevenLabs likely returns DEFLATE-compressed ZIPs, causing parsing failures.

**Solution**:
- Added full DEFLATE decompression support using Deno's native `DecompressionStream`
- Implemented proper bounds checking to prevent reading beyond ZIP file boundaries
- Added comprehensive validation for compression methods (0=STORED, 8=DEFLATE)
- Validates decompressed size matches expected uncompressed size

### 2. Enhanced Edge Function Validation
**Added**:
- JSON body parsing validation with error handling
- Stem type validation against allowed types
- Base64 format validation
- Binary audio decoding with error recovery
- WAV header detection for format verification
- Chunked base64 encoding for large files (>1MB) to prevent stack overflow
- Detailed logging at every processing stage

### 3. Comprehensive Frontend Error Handling
**Improved**:
- Categorized errors into 10+ specific types (auth, format, size, timeout, etc.)
- Better user messages for each error category
- Enhanced logging with error context, stack traces, and diagnostics
- Input validation before sending to API (sample rate, duration, buffer validity)
- Response validation at every step (data presence, success flag, audio data format)

### 4. Input Validation & Safety Checks
**Added client-side validation**:
- Audio buffer existence and validity
- Sample rate range checking (8000-96000 Hz)
- Maximum duration limit (5 minutes)
- WAV conversion error handling
- Empty buffer detection
- Payload size validation (25MB limit)
- Base64 encoding validation
- Final encoded size check (35MB limit)

**Added server-side validation**:
- Request body JSON parsing
- Required field presence
- Stem type whitelist validation
- Base64 string format validation
- Binary decoding error handling
- Audio header validation
- ZIP file size validation
- Decompressed audio size validation

## Testing the Fixes

### Prerequisites
1. Ensure `ELEVENLABS_API_KEY` is configured in Supabase secrets
2. Deploy the updated edge function: `supabase functions deploy separate-stems`
3. Verify the function is accessible: `curl https://your-project.supabase.co/functions/v1/separate-stems`

### Test Cases

#### Test 1: Normal Separation (Happy Path)
1. Generate a multi-instrument stem (e.g., kick with 4 bars)
2. Click on the waveform to open edit modal
3. Click "Separate Stem" button
4. Expected: Success message "Successfully extracted drums stem!"
5. Verify: New take is created and selected

#### Test 2: Large File Handling
1. Generate a stem with 16 bars at high BPM
2. Try separation
3. Expected: Either succeeds or shows "Audio too large" error
4. Verify: Error message is clear and actionable

#### Test 3: Network Error Recovery
1. Temporarily disconnect internet
2. Try separation
3. Expected: Retry messages appear "Connection issue, retrying (1/3)..."
4. Reconnect internet
5. Expected: Separation completes successfully

#### Test 4: Invalid Stem Type
1. Open browser console
2. Manually call separation with invalid stem type
3. Expected: "Invalid stem type" error from edge function
4. Verify: Error is caught and displayed properly

#### Test 5: Compressed ZIP Handling
1. Generate a stem and separate it
2. Monitor edge function logs in Supabase dashboard
3. Expected: Logs show "Found file: [filename]", compression method, and successful decompression
4. Verify: Audio is extracted and plays correctly

### Diagnostic Logging

#### Client-Side Logs (Browser Console)
Look for `[stem-separation]` prefixed logs:
```
[stem-separation] Starting separation for: kick
[stem-separation] Converting audio to WAV - channels: 2, length: 264600, sampleRate: 44100, duration: 3 s
[stem-separation] WAV buffer size: 1058400 bytes (1.01 MB)
[stem-separation] Base64 audio length: 1411200 characters (1.35 MB)
[stem-separation] Calling edge function with stemType: kick
[stem-separation] Edge function response - data: true, error: false, retries: 0
[stem-separation] Response data keys: ["success", "audioData", "stemType", "requestedInstrument", "format", "processingTimeMs"]
[stem-separation] Received separated audio - stemType: drums, audioData length: 234567
[stem-separation] Decoded array buffer size: 175925 bytes
[stem-separation] Audio decoded successfully - duration: 3.2 seconds, channels: 2, sampleRate: 44100
```

#### Server-Side Logs (Supabase Dashboard)
Look for `[separate-stems]` and `[zip-parser]` prefixed logs:
```
[separate-stems] Received request
[separate-stems] Request params: {stemType: "kick", outputFormat: "mp3_44100_128", audioDataLength: 1411200, audioDataSizeMB: "1.35"}
[separate-stems] Binary audio size: 1058400 bytes (1.01 MB)
[separate-stems] Detected WAV format
[separate-stems] Calling ElevenLabs API...
[separate-stems] ElevenLabs response status: 200
[separate-stems] ZIP file size: 3245678 bytes
[zip-parser] Starting ZIP extraction, size: 3245678 bytes
[zip-parser] Found file: {filename: "drums.mp3", compressionMethod: "DEFLATE", compressedSize: 123456, uncompressedSize: 234567}
[zip-parser] Decompressing DEFLATE data for: drums.mp3
[zip-parser] Decompressed size: 234567 bytes
[zip-parser] Mapped drums.mp3 to stem type: drums
[zip-parser] Extraction complete: {filesFound: 4, stemsExtracted: ["vocals", "drums", "bass", "instruments"], totalSize: 987654}
[separate-stems] Selected stem size: 234567 bytes
[separate-stems] Base64 audio length: 312756 characters
[separate-stems] Success! Total processing time: 15234 ms
```

### Common Error Patterns

#### 1. "API key not configured"
**Cause**: `ELEVENLABS_API_KEY` missing from Supabase secrets
**Solution**: Add key in Supabase Dashboard → Settings → Edge Functions → Secrets

#### 2. "Failed to parse ZIP file"
**Cause**: Corrupted response or unsupported compression
**Check**: Look for compression method in logs (should be 0 or 8)
**Solution**: If compression method is not 0 or 8, ElevenLabs changed their format

#### 3. "Target stem not found in ZIP"
**Cause**: Filename pattern doesn't match expected patterns
**Check**: Look for actual filenames in `[zip-parser] Found file:` logs
**Solution**: Update filename matching patterns in `extractStemsFromZip`

#### 4. "Failed to decode separated audio"
**Cause**: Audio format incompatibility or corruption
**Check**: Verify decompressed data size matches expected
**Solution**: Ensure ElevenLabs is returning valid MP3/audio format

#### 5. "Connection failed" with retries
**Cause**: Network issues or edge function deployment problems
**Check**: Test edge function health endpoint directly
**Solution**: Redeploy edge function or check Supabase status

## Performance Metrics

Expected processing times:
- 4 bars (3-5 seconds audio): 10-20 seconds
- 8 bars (6-10 seconds audio): 15-30 seconds
- 16 bars (12-20 seconds audio): 25-45 seconds

If processing takes longer:
- Check ElevenLabs API status
- Verify network connection quality
- Consider audio file size (larger = slower)

## Troubleshooting Checklist

- [ ] Edge function is deployed and accessible
- [ ] ELEVENLABS_API_KEY is configured in Supabase secrets
- [ ] Browser console shows no CORS errors
- [ ] Edge function logs show successful API calls to ElevenLabs
- [ ] ZIP extraction logs show all 4 stems (vocals, drums, bass, instruments)
- [ ] Decompression is successful (if compressed)
- [ ] Audio decoding succeeds with valid duration
- [ ] New take appears in stem history
- [ ] Separated audio plays correctly

## Next Steps for Further Debugging

If issues persist after these fixes:

1. **Capture Full Response**: Add logging to save raw ZIP data to a file for analysis
2. **Test Offline**: Save a sample ElevenLabs response and test parsing locally
3. **API Compatibility**: Verify ElevenLabs API hasn't changed format/compression
4. **Browser Compatibility**: Test in multiple browsers (Chrome, Firefox, Safari)
5. **Network Analysis**: Use browser DevTools Network tab to inspect request/response
6. **Edge Function Memory**: Check if function is hitting memory limits with large files

## Summary of Improvements

The stem separation feature now has:
- ✅ Full ZIP compression support (DEFLATE + STORED)
- ✅ Comprehensive validation at every step
- ✅ Detailed error messages for 10+ error categories
- ✅ Retry logic with exponential backoff
- ✅ Safe base64 encoding for large files
- ✅ Bounds checking to prevent crashes
- ✅ Input validation before API calls
- ✅ Response validation after API calls
- ✅ Audio format detection and verification
- ✅ Extensive diagnostic logging

These changes address the most common failure modes and make debugging much easier when issues do occur.
