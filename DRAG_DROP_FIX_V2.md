# Drag & Drop Button Fix - Second Iteration

## Problem
After the initial fix, drag & drop buttons remained greyed out after stem generation. The buttons were unresponsive even though audio was successfully generated.

## Root Cause
The PCM cache was being cleared immediately after being populated:

1. **Generation Flow (Supabase path)**:
   - Line 2568: PCM extracted from WAV and stored via `storeStemPCM()`
   - Line 2591: `invalidateStemCache()` called
   - Inside `invalidateStemCache()`: `clearStemPCM()` was called (from first fix)
   - Result: PCM data deleted immediately after storage

2. **Button State Check**:
   - `updateDragButtonState()` checks `isPCMReadyForDrag(st)`
   - Returns `false` because PCM cache is empty
   - Button stays disabled

## Solution

### 1. Separated PCM Cache Management
- Removed `clearStemPCM()` call from `invalidateStemCache()`
- PCM cache is now managed independently from WAV cache
- Added explicit `clearStemPCM()` calls before storing new PCM data

### 2. Cache Clearing Strategy
Now PCM is only cleared when new PCM data is about to be stored:

```javascript
// Before storing new PCM
clearStemPCM(st)  // Remove old data
storeStemPCM(st, pcmData, ...)  // Store new data
```

Applied in all generation paths:
- Supabase generation (line 2567)
- Fallback generation (line 2638)
- Endpoint adjustments (line 1864)
- Version selection (line 4588)
- Stem separation (line 2208)

### 3. Enhanced Debugging
Added comprehensive logging to `updateDragButtonState()`:
```javascript
console.log(`[DragButton] ${st} - hasValidData: ${hasValidData}, isPCMReady: ${isPCMReady}, isChromium: ${isChromium}, pcmCache: ${pcmCache ? 'exists' : 'missing'}`)
```

## Changes Made

**File: src/app.js**

1. **Function: `invalidateStemCache()`** (line 798)
   - Removed `clearStemPCM()` call
   - Added documentation explaining PCM is managed separately

2. **Function: `generateStemOnce()` - Supabase path** (line 2567)
   - Added `clearStemPCM(st)` before `storeStemPCM()`

3. **Function: `generateStemOnce()` - Fallback path** (line 2638)
   - Added `clearStemPCM(st)` before `storeStemPCM()`

4. **Function: `adjustEndpoint()`** (line 1864)
   - Added `clearStemPCM(st)` before `storeStemPCM()`

5. **Function: `selectStemVersion()`** (line 4588)
   - Added `clearStemPCM(st)` before `storeStemPCM()`

6. **Stem Separation Handler** (line 2208)
   - Added `clearStemPCM(st)` before `storeStemPCM()`

7. **Function: `updateDragButtonState()`** (line 3544)
   - Enhanced logging for all button state checks
   - Added detailed PCM cache status logging

## Expected Behavior

After this fix:

1. **After Generation**:
   - PCM data extracted and stored
   - `updateDragButtonState()` called
   - Button should enable if PCM is ready

2. **Console Logs**:
   ```
   [Gen] Stored PCM for kick: 245.2KB
   [DragButton] kick - hasValidData: true, isPCMReady: true, isChromium: true, pcmCache: exists
   ```

3. **Button State**:
   - Enabled (not greyed out)
   - Draggable
   - Shows accurate file size in tooltip

## Testing

To verify the fix:

1. Open the application in Chrome/Edge
2. Generate a stem (any instrument)
3. Check console for PCM storage logs
4. Check drag button is enabled (not greyed out)
5. Hover over button to see file size tooltip
6. Try dragging to DAW or desktop

## Technical Notes

- PCM cache and WAV cache are now completely independent
- PCM cache persists until explicitly cleared before new storage
- WAV cache can be invalidated without affecting PCM
- This allows the new PCM-based drag system to work independently from the legacy WAV-based system
