# Electron DAW Integration - Drag and Drop Guide

## Overview

This document explains how the 343 Labs Music Studio Electron application enables native drag and drop functionality for importing audio stems directly into DAWs like Ableton Live, Logic Pro, and FL Studio.

## The Problem

Web browsers cannot provide OS-native file paths to other applications for security reasons. This means:

- **Browser-based drag and drop** uses web MIME types (`DownloadURL`, `text/uri-list`, data URIs)
- **DAWs expect** OS-native file paths (Windows: `CF_HDROP` or `FILEDESCRIPTOR`/`FILECONTENTS`; macOS: file URLs or `NSFilePromiseProvider`)
- **Result**: Dragging from a web page directly into Ableton Live does not work

## The Solution

The Electron wrapper provides a native bridge that:

1. Takes the WAV blob from the web app
2. Writes it to a temporary file on disk
3. Initiates an OS-native drag operation with the actual file path
4. DAWs can now recognize and import the file
5. Cleans up temporary files after the drag completes

## Architecture

### Files Structure

```
electron-main.js      - Main Electron process with IPC handlers
electron-preload.js   - Preload script exposing safe APIs to renderer
src/app.js           - Updated dragstart handler with Electron detection
```

### Communication Flow

```
Web App (Renderer Process)
    ↓
    Check: window.electronAPI exists?
    ↓
    YES → Call window.electronAPI.startNativeDrag(stemId, wavBlob, filename)
    ↓
IPC Communication to Main Process
    ↓
Main Process:
    1. Convert blob to Buffer
    2. Write to temp file: /tmp/343labs-stems/{filename}
    3. Call webContents.startDrag({ file: tempFilePath })
    ↓
OS-Level Drag Started
    ↓
User drags to DAW
    ↓
DAW receives file path and imports audio
    ↓
Cleanup: Delete temp file after 5 seconds
```

## Usage

### Running the Electron App

#### Development Mode

```bash
# Start Vite dev server
npm run dev

# In another terminal, start Electron (points to localhost:5173)
npm run electron:dev
```

#### Production Build

```bash
# Build web app and package Electron app
npm run electron:build

# Platform-specific builds
npm run electron:build:mac    # macOS DMG
npm run electron:build:win    # Windows installer
npm run electron:build:linux  # Linux AppImage
```

### Testing Drag and Drop

1. Launch the Electron app
2. Generate audio stems in the techno generator
3. Wait for the drag button to become enabled
4. Open Ableton Live (or Logic Pro, FL Studio)
5. Drag from the app directly into a DAW track
6. The audio file should import successfully

## Platform-Specific Behavior

### macOS

- Uses `webContents.startDrag()` with file path
- Supports drag to Finder and DAWs
- Creates temporary files in `/tmp/343labs-stems/`
- File promises could be implemented for virtual files (future enhancement)

### Windows

- Uses `webContents.startDrag()` with file path
- Provides `CF_HDROP` format automatically via Electron
- Creates temporary files in `%TEMP%\343labs-stems\`
- For virtual file streaming, custom IDataObject with `FILEDESCRIPTOR`/`FILECONTENTS` could be added

### Linux

- Uses `webContents.startDrag()` with file path
- Compatibility depends on DAW Linux support
- Most professional DAWs (Bitwig, Reaper) should work

## Technical Details

### WAV Format Specifications

The encoder creates DAW-compatible WAV files with:

- **Format**: PCM 16-bit Little-Endian
- **Sample Rate**: Matches source (typically 24kHz, 44.1kHz, or 48kHz)
- **Channels**: Mono or Stereo
- **Structure**: Standard RIFF format
  - RIFF header
  - fmt chunk (16 bytes)
  - data chunk

### Filename Convention

Generated filenames include metadata for easy identification:

```
{stem-type}_{tempo}bpm_{key}_{mode}_{timestamp}.wav

Example: kick_130bpm_Dmin_1699123456.wav
```

### Temporary File Management

- **Location**: OS temp directory + `343labs-stems` subfolder
- **Lifetime**: 5 seconds after drag completes
- **Cleanup**: Automatic deletion via setTimeout
- **Error Handling**: Silent failure if cleanup fails (temp files persist)

## Fallback Behavior

If the app runs in a regular browser (not Electron):

1. Detects `window.electronAPI` is undefined
2. Falls back to browser-based drag with `DownloadURL`
3. Works for drag-to-desktop in Chromium browsers
4. Shows appropriate UI messaging about limited DAW support

## Security Considerations

### Context Isolation

The preload script uses `contextBridge` to safely expose only necessary APIs:

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  startNativeDrag: async (stemId, wavBlob, filename) => { ... },
  isElectron: () => { ... },
  getPlatform: () => { ... }
})
```

This prevents the renderer from accessing Node.js APIs directly.

### Temporary File Access

- Files are written to the OS temp directory
- Only the current user has access
- Files are deleted after drag operation
- No sensitive data is stored in filenames

## Troubleshooting

### Drag Does Not Work in DAW

**Symptoms**: Cursor shows "not allowed" or drop does nothing

**Solutions**:
1. Verify you're running the Electron app (not browser version)
2. Check console for error messages
3. Ensure DAW is not running with elevated privileges (Windows)
4. Confirm WAV file was generated successfully
5. Try dragging to desktop first to verify file creation

### Files Not Cleaning Up

**Symptoms**: `/tmp/343labs-stems/` fills with old files

**Solutions**:
1. Files should auto-delete after 5 seconds
2. Manually delete old files: `rm -rf /tmp/343labs-stems/*` (macOS/Linux)
3. On Windows: Delete `%TEMP%\343labs-stems\` contents
4. Check console for cleanup errors

### Electron App Won't Start

**Symptoms**: App crashes or won't launch

**Solutions**:
1. Rebuild the app: `npm run build && npm run electron`
2. Check for missing dependencies: `npm install`
3. Verify environment variables in `.env` file
4. Check Electron version compatibility: `npm list electron`

### Audio Quality Issues

**Symptoms**: Imported audio sounds wrong or corrupted

**Solutions**:
1. Verify sample rate matches between generation and export
2. Check WAV encoder output in console logs
3. Ensure audio buffer is valid before encoding
4. Try regenerating the stem

## Advanced: Custom Native Drag Implementation

For more control, you could implement platform-specific native drag:

### Windows (Future Enhancement)

```cpp
// Create IDataObject with FILEDESCRIPTOR/FILECONTENTS
// Stream file data on-demand when DAW requests it
// Avoids materializing temp files
```

### macOS (Future Enhancement)

```swift
// Use NSFilePromiseProvider
// Fulfill file promise when DAW drops
// Write to destination provided by OS
```

This would eliminate temporary file creation and provide better performance for large files.

## Performance Considerations

### Memory Usage

- WAV blobs are cached in memory (max 50MB total)
- Temporary files are small (typically 1-5MB per stem)
- Cleanup prevents accumulation

### Encoding Speed

- Web Worker encodes WAV asynchronously (non-blocking)
- Fallback to main thread if workers unavailable
- Pre-computation happens after generation (not during drag)

### Drag Responsiveness

- Electron drag starts immediately (file already written)
- No blocking operations during dragstart
- Visual feedback shows drag in progress

## Future Enhancements

1. **File Promise Implementation**: Stream files on-demand (macOS)
2. **Virtual File Support**: No temp files (Windows IDataObject)
3. **Batch Drag**: Drag multiple stems at once
4. **Progress Indicators**: Show materialization progress
5. **Custom Icons**: Per-stem drag preview images
6. **Format Options**: Export as AIFF, FLAC, etc.
7. **Metadata Embedding**: BPM, key info in WAV metadata

## References

- [Electron IPC Documentation](https://www.electronjs.org/docs/latest/api/ipc-main)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [WAV File Format Specification](http://soundfile.sapp.org/doc/WaveFormat/)
- [Drag and Drop Guide](./knowledge/drag_and_drop_guide.md)

## Support

For issues or questions:
1. Check console logs in both renderer and main process
2. Review this documentation
3. Test with simplified audio files
4. Verify DAW compatibility (Ableton Live 11+, Logic Pro X+, FL Studio 20+)

## License

This implementation is part of 343 Labs Music Studio.
