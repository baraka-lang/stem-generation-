# Stem Persistence Implementation

## Overview
This document describes the implementation of stem persistence functionality that automatically saves generated stems to the database with proper UI feedback.

## Features Implemented

### 1. Toast Notification System (`src/UI/toast.js`)
- Created a reusable toast notification utility with brand-consistent styling
- Supports 4 types: success, error, info, warning
- Animations: slide in/out transitions matching the app's design system
- Auto-dismiss after specified duration with manual close option
- Uses Lucide icons for consistent visual language

### 2. Audio Buffer Conversion (`src/Auth/audioBufferHelper.js`)
- Utility to convert `AudioBuffer` to `ArrayBuffer` (WAV format)
- Handles audio encoding for database storage
- Calculates file size and duration automatically
- Converts audio samples to 16-bit PCM format

### 3. Updated Stem API (`src/Auth/stemApi.js`)
- Enhanced `saveStem` function to handle both `AudioBuffer` and `ArrayBuffer`
- Automatic conversion from `AudioBuffer` to `ArrayBuffer` when needed
- Chunked base64 encoding for large files to prevent stack overflow
- Proper error handling and logging

### 4. Main App Integration (`src/app.js`)
- Added imports for toast notifications and stem API
- Created `saveStemToDatabase()` function that:
  - Extracts stem data from generation context
  - Builds key signature from master settings
  - Saves to database asynchronously (non-blocking)
  - Shows success toast on completion
- Integrated into `generateStem()` after `pushStemVersion()`
- Runs in background without blocking UI

## Database Schema Mapping

The following data is extracted and saved to the database:

| Database Field | Source | Description |
|----------------|--------|-------------|
| `stem_type` | `st` (stem parameter) | Type of stem (kick, snare, hihat, etc.) |
| `prompt` | `usedPrompt` | The generation prompt used |
| `tempo` | `tempo` | Tempo in BPM |
| `bars` | `bars` | Number of bars |
| `key_signature` | `master.root + master.mode` | Derived from master settings (e.g., "A Minor") |
| `generation_tier` | `tier` | Generation tier (0-2) |
| `validated` | `!failedValidation` | Whether validation passed |
| `audio_data` | Converted from `AudioBuffer` | Audio data as base64 string |
| `file_size` | Calculated from buffer | File size in bytes |
| `duration_seconds` | `audioBuffer.duration` | Duration in seconds |
| `user_id` | From auth context | Current user ID (auto-set by Supabase) |

## User Experience

### For Authenticated Users
- Stems are automatically saved to cloud database
- Success toast appears: `"[stem] saved to cloud"`
- Non-blocking: does not slow down UI
- Silent on errors (won't annoy users with background failures)

### For Guest Users
- Database save is skipped (no errors shown)
- UI continues to work normally

## Implementation Details

### Background Processing
Stem persistence runs asynchronously after the UI update:
```javascript
saveStemToDatabase(st, usedPrompt, tempo, bars, stemRaw[st], tier, !failedValidation)
  .catch(err => console.error(`Background stem save failed:`, err))
```

### Audio Conversion Flow
1. `AudioBuffer` (from Web Audio API)
2. Convert to WAV format (`AudioBufferHelper`)
3. Convert to base64 string (chunked for large files)
4. Store in database as `bytea` column

### Toast Styling
Follows brand design system:
- Purple/pink gradient accents
- Glass morphism effects
- Smooth animations
- Lucide icons
- Responsive and accessible

## Error Handling

- Database errors are logged to console but don't interrupt user experience
- Large audio files are handled with chunked encoding
- Graceful fallback for non-authenticated users
- No user-facing errors for background operations

## Testing Recommendations

1. **Authenticated User Flow**
   - Generate a stem and verify database entry
   - Check toast notification appears
   - Verify no performance degradation

2. **Guest User Flow**
   - Generate stem and verify no errors
   - Check that UI remains responsive

3. **Large File Handling**
   - Test with long duration stems (8+ bars)
   - Verify encoding doesn't crash

4. **Network Failure**
   - Test with Supabase offline
   - Verify graceful degradation

## Files Modified/Created

### Created
- `src/UI/toast.js` - Toast notification utility
- `src/Auth/audioBufferHelper.js` - Audio conversion utilities
- `STEM_PERSISTENCE_IMPLEMENTATION.md` - This document

### Modified
- `src/app.js` - Added stem persistence integration
- `src/Auth/stemApi.js` - Enhanced to handle AudioBuffer
- `public/styles.css` - Added toast animations

## Next Steps (Optional Enhancements)

1. Add progress indicator during large file uploads
2. Batch save multiple stems together
3. Add retry logic for failed saves
4. Show stem storage count in user menu
5. Add ability to view/delete saved stems from profile page

