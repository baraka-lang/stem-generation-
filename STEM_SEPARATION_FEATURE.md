# Stem Separation Feature

## Overview
Added an intelligent stem separation button inside the take editor modal that automatically isolates and extracts the specific instrument being edited using the ElevenLabs Stem Separation API.

## What Was Implemented

### 1. Supabase Edge Function (`supabase/functions/separate-stems/index.ts`)
- Proxies requests to ElevenLabs Stem Separation API
- Accepts base64 encoded audio, stem type, and output format
- Intelligently maps internal instrument types to ElevenLabs stem categories:
  - `kick`, `perc`, `perc2`, `hihat` → **drums** stem
  - `bass` → **bass** stem  
  - `lead`, `pad`, `arp`, `fx` → **instruments** stem
- Parses the returned ZIP file and extracts only the relevant stem
- Returns the selected stem as base64 encoded audio
- Includes comprehensive error handling and CORS support
- 3-minute timeout for long processing operations

### 2. UI Enhancement (`src/templates.html`)
- Added "Separate Stem" button in the waveform edit modal
- Positioned between the endpoint dial and action buttons
- Includes loading spinner for progress indication
- Status hint text shows helpful messages during processing

### 3. Frontend Integration (`src/app.js`)
- Button handler already existed in `openWaveformEditModal` function
- `separateCurrentStem` function handles the complete workflow:
  1. Converts current take's AudioBuffer to WAV format
  2. Encodes as base64 and sends to edge function
  3. Receives and decodes the separated stem
  4. Creates a new history entry marked with `isSeparated: true`
  5. Automatically selects the separated stem as the active take
  6. Updates waveforms, PCM data, and UI indicators
- Added `drawEditWaveform` helper function to update modal canvas
- Comprehensive error handling with user-friendly messages

## How It Works

1. User clicks waveform to open the edit modal for any instrument (e.g., kick drum)
2. User clicks the "Separate Stem" button
3. System displays "Separating..." with a spinner
4. Current audio is sent to the edge function with the instrument type
5. Edge function calls ElevenLabs API and extracts the matching stem from the ZIP
6. Separated audio is returned and loaded as a new take
7. Success message shows: "Successfully extracted drums stem!"
8. The separated version is now the active take and can be further edited

## User Experience Features

- **Automatic Instrument Detection**: The system knows which stem to extract based on what you're editing
- **Progress Indicators**: Button disables during processing with spinner and status messages
- **Success Feedback**: Green success message for 3 seconds
- **Error Handling**: Red error messages with helpful hints for 8 seconds
- **Seamless Integration**: Works with existing take history, waveforms, and download system
- **Metadata Tracking**: Separated stems are marked in history with special flags

## Testing Recommendations

1. Generate a full mix with multiple instruments
2. Edit the kick drum and click "Separate Stem"
3. Verify only the kick/drums portion is extracted
4. Test with bass, lead, and pad to verify correct stem mapping
5. Confirm separated stems can be downloaded and saved
6. Test error scenarios (network issues, invalid audio)

## API Requirements

- **ELEVENLABS_API_KEY** environment variable must be configured
- Separation typically takes 10-30 seconds depending on audio length
- Supports WAV, MP3, and other common audio formats
- Output format defaults to MP3 44.1kHz 128kbps

## Future Enhancements

- Visual indicator in history to distinguish separated takes
- Option to compare original vs separated versions side-by-side
- Batch separation for multiple instruments at once
- Support for more granular stem types (guitar, keys, etc.)
