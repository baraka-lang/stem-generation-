# DAW Drag and Drop Implementation Guide

## Overview

This implementation enables direct drag-and-drop of audio stems from the application into DAWs like Ableton Live, Logic Pro, and FL Studio. The solution uses native OS-level drag protocols instead of browser-based drag APIs.

## Key Changes

### 1. ElevenLabs Format Optimization

**File**: `supabase/functions/generate-techno-stem/index.ts`

- Implemented format fallback cascade: `pcm_44100` → `pcm_24000` → `pcm_22050` → `pcm_16000`
- Automatically tries higher quality formats first
- Falls back gracefully if plan doesn't support higher formats
- Returns format metadata along with audio data

**Benefits**:
- Uses highest quality format available for your ElevenLabs plan
- Better DAW compatibility with 44.1kHz audio
- No unnecessary resampling or format conversion

### 2. PCM Data Flow

**New Files**:
- `src/pcmToWav.js` - Lightweight PCM to WAV wrapper without re-encoding
- `src/stemDataManager.js` - Manages raw PCM data alongside AudioBuffers

**Flow**:
```
ElevenLabs API (PCM)
  → Edge Function (wraps to WAV for transport)
  → Client (extracts PCM, stores separately)
  → Drag Event (passes raw PCM to Electron)
  → Native Module (wraps PCM to WAV during fulfillment)
  → DAW receives proper WAV file
```

**Key Principle**: Keep original PCM data without re-encoding until the moment DAW requests the file.

### 3. Native Drag Modules

**macOS**: `native/macos/DragHelper.swift`
- Implements `NSFilePromiseProvider` for file promise-based drag
- Uses UTType `com.microsoft.waveform-audio` for WAV recognition
- Fulfills promise by wrapping PCM to WAV when DAW drops

**Windows**: `native/windows/DragHelper.cpp`
- Implements `CFSTR_FILEDESCRIPTORW` + `CFSTR_FILECONTENTS` for virtual files
- Creates IStream for on-demand WAV delivery
- Handles multiple stems per drag operation

**Note**: Native modules need to be compiled as Node.js addons. See Build Instructions below.

### 4. Electron Bridge

**File**: `electron-main.cjs`

- Updated IPC handler to accept raw PCM data instead of WAV blobs
- Wraps PCM to WAV in main process using Node.js Buffer operations
- Attempts to load platform-specific native modules
- Falls back to temp file + `webContents.startDrag()` if native modules unavailable

**File**: `electron-preload.cjs`

- Updated to pass PCM data, sample rate, and channel count
- Simplified API: `startNativeDrag(stemId, pcmData, sampleRate, numChannels, filename)`

### 5. Client Updates

**File**: `src/app.js`

**Changes**:
- Imports PCM utilities and data manager
- Extracts raw PCM from WAV received from edge function
- Stores PCM separately for drag operations
- Updated drag handler to use PCM data instead of pre-generated WAV blobs
- Removed unnecessary pre-computation of WAV files

**Benefits**:
- Smaller memory footprint (stores compact PCM instead of large WAV)
- Instant drag preparation (no encoding needed)
- Preserves exact format from ElevenLabs

### 6. Browser Auto-Download Bridge

**Files**: `src/autoDownloadManager.js`, `src/app.js`

- Adds a “DAW Drop Helper” panel that appears in Chromium browsers. Users can opt in once, pick a destination folder via the File System Access API, and the handle is persisted in IndexedDB.
- Every time a new PCM payload is cached we queue an on-disk WAV write so the stem already exists locally before the user drags anything.
- Drag tooltips and the per-stem chips now surface whether the stem is saved, pending, or failed, so users know if it is safe to hop into Finder/Explorer/Live.
- The helper also warns non-Chromium users that the feature is unavailable and nudges them toward the Electron build for true native drag.
- On Chrome/Edge versions that expose the File System Access drag-out API we now attach the saved `FileSystemFileHandle` to the drag payload so the OS hands Ableton/Logic the actual on-disk file instead of a transient blob.

**Benefits**:
- Browser users get a deterministic workflow (file is already on disk) instead of trying to “drop” an in-memory blob straight into Ableton.
- Consent persists between sessions, so there is no need to reselect the folder on every load.
- Avoids redundant writes by tracking the PCM timestamp per stem; once a stem is saved it is not rewritten until a new version exists.

## Architecture

### Browser Mode (Limited DAW Support)
```
User Drags → PCM wrapped to WAV blob → Browser DataTransfer →
  → Desktop folder (works) OR DAW (usually rejected)
```

### Electron Mode with Fallback (Current)
```
User Drags → PCM sent to main process → Wrapped to WAV →
  → Temp file created → webContents.startDrag() → DAW
```

### Electron Mode with Native Modules (Ideal)
```
macOS:
  User Drags → Native module → NSFilePromiseProvider →
    → DAW drops → Promise fulfilled → PCM wrapped to WAV → Written to destination

Windows:
  User Drags → Native module → Virtual file drag (IDataObject) →
    → DAW drops → IStream provides WAV data → DAW reads bytes
```

## Testing

### Format Testing

1. Check console logs during generation to see which format was used
2. Look for: `Successfully using format: pcm_44100 (44100Hz)`
3. Verify fallback occurs if higher formats unavailable

### Drag Testing (Browser)

1. Open browser version (limited DAW support expected)
2. Generate a stem
3. Drag to desktop folder (should work in Chromium)
4. Drag to DAW (likely won't work - expected limitation)

### Drag Testing (Electron Fallback)

1. Run `npm run electron:dev`
2. Generate a stem
3. Drag to Ableton/Logic/FL Studio
4. Check console for: `[Drag] Using fallback: temp file + webContents.startDrag`
5. Verify temp file is created in OS temp directory
6. Check if DAW accepts the file

**Expected Result**: May work or may fail depending on:
- macOS: Should work in most cases
- Windows: May fail if elevation mismatch (see Troubleshooting)

### Drag Testing (Electron Native - Once Built)

1. Build native modules (see below)
2. Run Electron app
3. Drag to DAW
4. Check console for: `✓ Loaded macOS native drag helper` or `✓ Loaded Windows native drag helper`
5. Verify drag works reliably

## Build Instructions

### Building Native Modules

**Prerequisites**:
- Node.js with node-gyp
- macOS: Xcode Command Line Tools
- Windows: Visual Studio Build Tools

**macOS**:
```bash
cd native/macos
# Create binding.gyp configuration
# Compile Swift to node addon
node-gyp configure build
# Output: build/Release/drag-helper.node
```

**Windows**:
```bash
cd native/windows
# Create binding.gyp configuration
# Compile C++ to node addon
node-gyp configure build
# Output: build/Release/drag-helper.node
```

**Note**: Full native module build system not yet implemented. Manual compilation required.

### Building Electron App

```bash
# Development
npm run electron:dev

# Production build
npm run electron:build        # All platforms
npm run electron:build:mac    # macOS only
npm run electron:build:win    # Windows only
npm run electron:build:linux  # Linux only
```

## Troubleshooting

### Windows: Drag Works to Folders but Not DAWs

**Cause**: Elevation level mismatch. If Ableton runs as Administrator and your app doesn't (or vice versa), Windows blocks the drag for security.

**Fix**:
1. Check if Ableton is running as Administrator (Task Manager → Details → Elevated column)
2. Match elevation levels:
   - If Ableton elevated: Run app as Administrator
   - If Ableton normal: Ensure app runs normally (don't elevate)

### macOS: Drag Not Accepted by DAW

**Possible Causes**:
1. Native module not loaded (check console for load errors)
2. UTType not recognized (ensure `com.microsoft.waveform-audio` is used)
3. File promise delegate not fulfilling quickly enough

**Debug**:
- Check console logs for native module load status
- Verify temp file fallback is working first
- Test with different DAWs to isolate issue

### Audio Plays at Wrong Speed in DAW

**Cause**: Sample rate mismatch or DAW attempting to time-stretch.

**Fix**:
- Verify sample rate in filename matches actual PCM data
- Check edge function logs for format used
- Ensure no resampling happening in client code

### Format Fallback Not Working

**Debug**:
1. Check edge function logs: `Format pcm_44100 not available, trying fallback...`
2. Verify API key has access to higher tier formats
3. Test directly with ElevenLabs API to confirm format support

## Current Limitations

1. **Native Modules**: Swift and C++ code provided but not yet compiled to Node.js addons
2. **Browser Mode**: DAW drag limited by browser API constraints (expected)
3. **Multi-Stem Drag**: Single stem only in current implementation (architecture supports multiple)
4. **Linux**: Not tested, may require additional platform-specific implementation

## Next Steps

### To Enable Full Native Drag

1. Set up node-gyp build configuration (binding.gyp) for both platforms
2. Create bridge between Swift/C++ and Node.js (N-API or node-addon-api)
3. Compile native modules as part of Electron build process
4. Test drag operations with native modules loaded
5. Implement multi-stem drag support

### To Support Additional DAWs

1. Test with Bitwig, Cubase, Pro Tools, etc.
2. Verify UTType/MIME type compatibility
3. Add DAW-specific workarounds if needed

## Technical Reference

### WAV Format

All WAV files use:
- Format: PCM S16LE (16-bit signed little-endian)
- Channels: 2 (stereo) for music stems
- Sample Rate: 44100, 24000, 22050, or 16000 Hz (from ElevenLabs)
- Header: 44 bytes (standard RIFF/WAVE)
- Data: Interleaved channel samples

### File Naming

Format: `Techno_{StemName}_{BPM}_{Key}_{Bars}bars.wav`

Example: `Techno_Kick_130_Am_4bars.wav`

### Memory Management

- PCM cache auto-clears on new generation
- Blob URLs cleaned up after drag completes
- Temp files deleted 10 seconds after drag (Electron fallback)

## References

- [ElevenLabs Music API Docs](https://elevenlabs.io/docs)
- [NSFilePromiseProvider Apple Docs](https://developer.apple.com/documentation/appkit/nsfilepromiseprovider)
- [Windows Virtual File Dragging](https://docs.microsoft.com/en-us/windows/win32/shell/datascenarios)
- [Electron webContents.startDrag](https://www.electronjs.org/docs/latest/api/web-contents#contentsstartdragitem)
