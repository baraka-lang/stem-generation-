# Testing Checklist - Ableton Live Drag and Drop

## Pre-Testing Setup

- [ ] Run `npm install` (if not already done)
- [ ] Run `npm run build` to build web app
- [ ] Run `npm run test:electron` to verify setup
- [ ] Ensure `.env` file has required API keys
- [ ] Have Ableton Live (or other DAW) installed

## Automated Tests

### 1. Build Test
```bash
npm run build
```
**Expected**: Build completes successfully, `dist/` directory created

### 2. Setup Validation
```bash
npm run test:electron
```
**Expected**: All checks pass (✅)

## Manual Tests - Electron App

### 3. Electron Launch Test
```bash
npm run electron
```
**Expected**:
- [ ] Electron window opens
- [ ] Web app loads correctly
- [ ] No errors in console (View → Toggle Developer Tools)
- [ ] Can navigate to techno generator

### 4. Development Mode Test
```bash
# Terminal 1
npm run dev

# Terminal 2
npm run electron:dev
```
**Expected**:
- [ ] Electron connects to dev server
- [ ] DevTools open automatically
- [ ] Hot reload works when editing files

### 5. Electron Detection Test
```bash
npm run electron
```
Then open DevTools (View → Toggle Developer Tools) and run:
```javascript
console.log('Electron API:', window.electronAPI)
```
**Expected**:
- [ ] `window.electronAPI` is defined
- [ ] Has methods: `startNativeDrag`, `isElectron`, `getPlatform`

## Manual Tests - Audio Generation

### 6. Audio Generation Test
1. Launch Electron app
2. Navigate to techno generator
3. Set tempo, key, bars
4. Click "Create" on a stem (e.g., Kick)
5. Wait for generation

**Expected**:
- [ ] Audio generates successfully
- [ ] Waveform displays
- [ ] Audio plays when clicked
- [ ] Drag button appears and becomes enabled

### 7. Pre-computation Test
After generating audio, check console for:
```
Preparing kick for drag...
✓ kick ready for drag: 245.3KB
```
**Expected**:
- [ ] "Preparing..." message appears
- [ ] "ready for drag" message appears within 1-2 seconds
- [ ] Drag button fully enabled (not faded)

## Manual Tests - Drag and Drop

### 8. Temp File Creation Test
1. Generate audio stem
2. Open terminal and run:
   - macOS/Linux: `ls -la /tmp/343labs-stems/`
   - Windows: `dir %TEMP%\343labs-stems\`

**Expected**:
- [ ] Directory exists
- [ ] Initially empty (files created during drag)

### 9. Drag Initiation Test
1. Generate audio stem
2. Wait for drag button to enable
3. Click and hold the "Drag & Drop" button
4. Move mouse while holding

**Expected**:
- [ ] Console shows: "Drag initiated for kick..."
- [ ] Console shows: "✓ Native drag started for kick: /tmp/..."
- [ ] Button opacity changes to 0.7
- [ ] Green feedback message appears briefly

### 10. Temp File Verification Test
During active drag:
```bash
# Run quickly while dragging
ls -la /tmp/343labs-stems/
```
**Expected**:
- [ ] WAV file exists in temp directory
- [ ] Filename matches pattern: `{stem}_{tempo}bpm_{key}_{timestamp}.wav`
- [ ] File size is reasonable (1-5MB typically)

### 11. File Validation Test
```bash
# Verify WAV file is valid
file /tmp/343labs-stems/*.wav
```
**Expected**:
- [ ] Output shows: "RIFF (little-endian) data, WAVE audio"
- [ ] No corruption errors

### 12. Manual File Test (Before DAW)
1. Generate stem and drag
2. Before dropping, release mouse over desktop
3. Navigate to temp file location
4. Double-click the WAV file

**Expected**:
- [ ] File opens in default audio player
- [ ] Audio plays correctly
- [ ] No distortion or corruption

## Manual Tests - DAW Integration

### 13. Ableton Live Import Test
**Prerequisites**: Ableton Live installed and running

1. Launch Electron app
2. Generate a kick drum stem
3. Wait for drag button to enable
4. Open Ableton Live
5. Create an audio track
6. Drag from app to Ableton track
7. Release mouse over track

**Expected**:
- [ ] Drag cursor shows "+" or "copy" icon over Ableton
- [ ] Drop creates audio clip in track
- [ ] Audio plays correctly in Ableton
- [ ] Waveform appears in clip view
- [ ] Tempo/key info visible in filename

### 14. Multiple Stem Test
Repeat drag test with different stems:
- [ ] Kick imports successfully
- [ ] Bass imports successfully
- [ ] Melody imports successfully
- [ ] Pad imports successfully
- [ ] Percussion imports successfully
- [ ] FX imports successfully

### 15. Multiple File Test
1. Generate multiple stems
2. Create multiple tracks in Ableton
3. Drag each stem to different tracks

**Expected**:
- [ ] All stems import without errors
- [ ] Each plays in its own track
- [ ] Can play all stems simultaneously
- [ ] Stems are synchronized (if from same session)

### 16. Logic Pro Test (if available)
Same as Ableton test but with Logic Pro X

**Expected**:
- [ ] Drag and drop works
- [ ] Audio imports correctly
- [ ] Playback is clean

### 17. FL Studio Test (if available)
Same as Ableton test but with FL Studio

**Expected**:
- [ ] Drag and drop works
- [ ] Audio imports correctly
- [ ] Playback is clean

## Cleanup Tests

### 18. Temp File Cleanup Test
1. Generate and drag a stem
2. Complete the drag (drop into DAW or cancel)
3. Wait 6 seconds
4. Check temp directory:
   ```bash
   ls -la /tmp/343labs-stems/
   ```

**Expected**:
- [ ] Temp file is deleted automatically
- [ ] Directory remains but is empty
- [ ] No error messages in console

### 19. Multiple Drag Cleanup Test
1. Drag 5 different stems in succession
2. Wait 6 seconds after each
3. Check temp directory

**Expected**:
- [ ] All temp files cleaned up
- [ ] No accumulation of old files
- [ ] Memory usage stays reasonable

## Browser Fallback Tests

### 20. Browser Detection Test
1. Open app in Chrome (not Electron)
2. Open browser DevTools console
3. Run: `console.log(window.electronAPI)`

**Expected**:
- [ ] Returns `undefined`
- [ ] Drag button still appears (if Chromium)
- [ ] Console shows "Browser drag prepared" (not "Native drag")

### 21. Browser Drag Test (Chromium)
1. Open app in Chrome/Edge
2. Generate audio stem
3. Drag to desktop (not DAW)

**Expected**:
- [ ] File downloads to desktop
- [ ] Can then manually drag from desktop to DAW
- [ ] Two-step process works as fallback

## Error Handling Tests

### 22. No Audio Test
1. Try to drag before generating audio

**Expected**:
- [ ] Drag button is disabled
- [ ] Tooltip shows helpful message
- [ ] Prevents drag attempt

### 23. Generation Failed Test
1. Disconnect internet
2. Try to generate audio (will fail)
3. Try to drag

**Expected**:
- [ ] Error message shown for generation failure
- [ ] Drag button remains disabled
- [ ] No crashes or undefined errors

### 24. Permission Error Test (macOS/Linux)
```bash
# Make temp directory read-only
sudo chmod 000 /tmp/343labs-stems/
```
Then try to drag.

**Expected**:
- [ ] Error caught gracefully
- [ ] User-friendly error message
- [ ] App continues working

(Don't forget to restore permissions: `sudo chmod 755 /tmp/343labs-stems/`)

## Platform-Specific Tests

### 25. macOS Specific
- [ ] Drag to Finder works
- [ ] Drag to Logic Pro works
- [ ] Drag to Ableton Live works
- [ ] Temp files in `/tmp/343labs-stems/`
- [ ] File cleanup works

### 26. Windows Specific
- [ ] Drag to Explorer works
- [ ] Drag to Ableton Live works
- [ ] Drag to FL Studio works
- [ ] Temp files in `%TEMP%\343labs-stems\`
- [ ] File cleanup works
- [ ] No admin privilege issues

### 27. Linux Specific
- [ ] Drag to file manager works
- [ ] Drag to Bitwig Studio works
- [ ] Drag to Reaper works
- [ ] Temp files in `/tmp/343labs-stems/`
- [ ] File cleanup works

## Performance Tests

### 28. Large File Test
1. Generate 8-bar stems (larger files)
2. Drag to DAW

**Expected**:
- [ ] Drag still responsive
- [ ] No UI freezing
- [ ] Import completes successfully
- [ ] File size under 10MB

### 29. Memory Test
1. Generate 20+ stems over time
2. Drag each one
3. Monitor memory usage

**Expected**:
- [ ] Memory stays under 500MB
- [ ] Cache evicts old entries at 50MB limit
- [ ] No memory leaks
- [ ] Performance remains good

### 30. Rapid Drag Test
1. Generate multiple stems
2. Drag them rapidly one after another

**Expected**:
- [ ] No crashes
- [ ] Each drag works correctly
- [ ] Temp files cleaned up properly
- [ ] No file conflicts

## Build Tests

### 31. Production Build Test
```bash
npm run electron:build
```
**Expected**:
- [ ] Build completes without errors
- [ ] Creates `electron-dist/` directory
- [ ] Packaged app is created
- [ ] App size is reasonable (<200MB)

### 32. Packaged App Test
1. Locate built app in `electron-dist/`
2. Install/run the packaged app
3. Test drag and drop

**Expected**:
- [ ] Packaged app launches
- [ ] All features work
- [ ] Drag and drop works in packaged version

## Documentation Tests

### 33. Quick Start Test
Follow `QUICK_START.md` exactly as written by a new user

**Expected**:
- [ ] Instructions are clear
- [ ] All steps work
- [ ] Achieves working drag and drop

### 34. Troubleshooting Test
Try solutions from troubleshooting sections

**Expected**:
- [ ] Solutions work for listed problems
- [ ] Instructions are accurate

## Summary

**Total Tests**: 34
**Completed**: _____ / 34
**Failed**: _____
**Blockers**: _____

## Test Environment

- **OS**: ________________
- **OS Version**: ________________
- **Node Version**: ________________ (run `node --version`)
- **Electron Version**: ________________ (check package.json)
- **DAW**: ________________
- **DAW Version**: ________________
- **Test Date**: ________________

## Notes

Add any observations, issues, or additional findings here:

```
[Your notes]
```

## Next Steps

If all tests pass:
- [ ] Ready for production use
- [ ] Can distribute to users
- [ ] Document any platform-specific quirks discovered

If tests fail:
- [ ] Document failures
- [ ] Check console logs
- [ ] Review implementation
- [ ] Consult troubleshooting guides
