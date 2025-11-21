# DAW Drag-and-Drop Testing Guide

## Implementation Summary

The drag-and-drop system has been completely rebuilt to work reliably with DAWs (Ableton Live, Logic Pro, FL Studio). The key changes:

### What Was Fixed

1. **Electron Native File Management**
   - Created dedicated Electron file manager (`src/electronFileManager.js`)
   - Uses Node.js fs APIs with full absolute file paths
   - Tracks all saved files with complete path information
   - No browser security restrictions

2. **Native OS-Level Drag**
   - Re-enabled `webContents.startDrag()` with pre-saved files
   - Files are written to disk BEFORE drag starts (atomic write)
   - Uses synchronous IPC during dragstart event
   - Creates true OS-level drags that DAWs accept

3. **Atomic File Writes**
   - Write to `.part-{random}.wav` temp file first
   - Verify file size and WAV header structure
   - Rename to final filename atomically
   - 50ms + 10ms delays ensure filesystem flush

4. **Show in Folder**
   - Uses absolute file paths from Electron manager
   - Calls `shell.showItemInFolder()` with real paths
   - Highlights specific file in Explorer/Finder

5. **Pre-warming**
   - On pointerdown (before drag), initiates file save if needed
   - Eliminates async timing issues during dragstart
   - Files are closed and ready before drag gesture

6. **Clear Separation**
   - Electron: Native drag with full paths (DAW-compatible)
   - Browser: FileSystemHandle drag for folders only (not DAWs)
   - Disabled FileSystemHandle in Electron mode

---

## Testing Checklist

### Prerequisites

1. **Electron App Built**
   ```bash
   npm run build
   npm run electron:build
   ```

2. **Environment**
   - Windows 10/11 OR macOS 13+
   - DAW installed (Ableton Live 11/12, Logic Pro 11, or FL Studio 21)
   - Electron app NOT running as Administrator
   - DAW NOT running as Administrator

3. **Configuration**
   - Valid ElevenLabs API key in `.env`
   - Supabase credentials configured

---

## Test 1: Electron File Save System

**Goal**: Verify files save with full paths and atomic writes

**Steps**:
1. Launch Electron app
2. Click menu button → Enable auto-save
3. Select a save folder
4. Generate a stem (any instrument)
5. Watch console logs

**Expected Results**:
- ✅ Console shows: `[SaveWav] Writing {filename}`
- ✅ Console shows: `[SaveWav] Temp: .../.part-{random}.wav`
- ✅ Console shows: `[SaveWav] Temp file verified, renaming to: {final path}`
- ✅ Console shows: `[SaveWav] ✓ File saved: {absolute path}`
- ✅ UI shows: "Auto-save ready → {folder name}"
- ✅ UI shows: "{n} file(s) saved"
- ✅ Drag button tooltip: "Drag directly to your DAW!"
- ✅ 📁 button appears next to drag button

**Failure Signs**:
- ❌ `.part-` files remain in folder
- ❌ File size doesn't match expected
- ❌ "WAV header validation failed"
- ❌ No absolute path in console

---

## Test 2: Show in Folder

**Goal**: Verify file reveal works correctly

**Steps**:
1. After Test 1, click the 📁 button
2. Observe what happens

**Expected Results**:
- ✅ Console shows: `[ShowInFolder] Revealing: {absolute path}`
- ✅ Console shows: `[ShowInFolder] ✓ Revealed: {path}`
- ✅ Explorer (Windows) or Finder (macOS) opens
- ✅ The specific WAV file is highlighted/selected
- ✅ File is in the chosen save folder
- ✅ Filename matches pattern: `{stem}_{bpm}bpm_{key}_{rate}.wav`

**Failure Signs**:
- ❌ Folder opens but file not highlighted
- ❌ Wrong folder opens
- ❌ "File not found" error
- ❌ Nothing happens

---

## Test 3: Direct Drag to Ableton Live (CRITICAL)

**Goal**: Verify drag from app to Ableton creates playable clips

**Steps**:
1. Open Ableton Live (NOT as Administrator)
2. Create a new project or open existing
3. In Electron app, generate a kick stem
4. Wait for "Auto-save ready" status
5. Click and hold drag button on kick
6. Drag cursor over Ableton's timeline
7. Drop into an audio track or empty space

**Expected Results**:
- ✅ Console shows: `[Drag] Starting drag for kick`
- ✅ Console shows: `[Drag] File: {absolute path}`
- ✅ Console shows: `[Drag] ✓ Native drag initiated`
- ✅ Ableton accepts the drop (cursor changes to + or arrow)
- ✅ Audio clip appears in timeline
- ✅ Clip plays at correct pitch
- ✅ Clip plays at correct tempo (no time stretch artifacts)
- ✅ Waveform looks correct
- ✅ File info shows correct sample rate (24kHz, 44.1kHz, etc.)

**Failure Signs**:
- ❌ Ableton ignores drop (cursor doesn't change)
- ❌ "File not found" or "Unreadable file" error
- ❌ Clip is created but silent
- ❌ Wrong pitch or tempo
- ❌ Ableton shows "Administrator required" message

**Windows-Specific**:
If drag fails on Windows, check:
```powershell
# In PowerShell (as admin):
Get-Process -Name "Live" | Select-Object Name, Path, @{l="Elevated";e={$_.SessionId -eq 0}}
```
If Elevated = True, restart Ableton without admin rights

---

## Test 4: Drag to Logic Pro (macOS Only)

**Goal**: Verify macOS DAW compatibility

**Steps**:
1. Open Logic Pro
2. Create new project or open existing
3. In Electron app, generate a bass stem
4. Wait for save to complete
5. Drag bass button to Logic's tracks area
6. Drop into audio track

**Expected Results**:
- ✅ Logic accepts the drop
- ✅ Audio region appears
- ✅ Plays correctly at source tempo/pitch
- ✅ No "file missing" or "conversion failed" errors

---

## Test 5: Drag to FL Studio (Windows Only)

**Goal**: Verify FL Studio compatibility

**Steps**:
1. Open FL Studio
2. In Electron app, generate a hihat stem
3. Drag to FL Studio Playlist or Channel Rack
4. Drop

**Expected Results**:
- ✅ FL Studio accepts the drop
- ✅ Audio clip or sampler loads the file
- ✅ Plays at correct pitch and tempo

---

## Test 6: Multi-Stem Batch Save

**Goal**: Verify multiple files save correctly

**Steps**:
1. Enable auto-save in Electron app
2. Generate all 6 stems (kick, bass, hihat, clap, lead, pad)
3. Wait for all to save
4. Check save folder

**Expected Results**:
- ✅ 6 WAV files in folder
- ✅ All files have proper names: `{stem}_{bpm}bpm_{key}_{rate}.wav`
- ✅ All files are valid WAV (no `.part-` files)
- ✅ File sizes reasonable (typically 200KB - 2MB each)
- ✅ All play correctly in audio player
- ✅ Each file has correct sample rate in metadata

---

## Test 7: Pre-warming

**Goal**: Verify files prepare before drag starts

**Steps**:
1. Enable auto-save
2. Generate a clap stem
3. After generation completes, click (pointerdown) on drag button but DON'T drag yet
4. Watch console
5. Release and try drag

**Expected Results**:
- ✅ On pointerdown, console shows: `[PreWarm] File ready: {path}` (if not already saved)
- ✅ Drag starts immediately with no delay
- ✅ No async operations during dragstart

---

## Test 8: Browser Mode (Folders Only)

**Goal**: Verify browser mode works for folders but warns about DAWs

**Steps**:
1. Open app in Chrome browser (not Electron)
2. Enable auto-download
3. Choose a folder
4. Generate a stem
5. Try to drag

**Expected Results**:
- ✅ Drag button tooltip: "Drag to folders only (not DAWs)"
- ✅ Panel message: "Use Electron app for DAW drag"
- ✅ Can drag to Desktop or folder (in Chromium)
- ✅ 📁 button is hidden (no reveal function in browser)

---

## Test 9: Error Handling

**Goal**: Verify proper error messages

**Test 9a - No Save Folder**:
1. Launch Electron app
2. DON'T enable auto-save
3. Try to drag a stem

**Expected**:
- ✅ Alert: "File not saved yet. To enable drag-and-drop: 1. Enable auto-save..."

**Test 9b - File Save Fails**:
1. Enable auto-save to folder
2. Set folder to read-only
3. Generate stem

**Expected**:
- ✅ Console error: `[SaveWav] Failed to save file`
- ✅ Status shows error state

**Test 9c - Drag During Save**:
1. Enable auto-save
2. Generate large stem
3. Immediately try to drag before save completes

**Expected**:
- ✅ Alert: "File is still being saved. Please wait..."

---

## Test 10: Atomic Write Verification

**Goal**: Ensure no partial files visible to DAWs

**Steps**:
1. Enable auto-save to a folder
2. Open folder in Explorer/Finder
3. Generate a stem
4. Watch folder during save

**Expected Results**:
- ✅ `.part-{random}.wav` appears briefly
- ✅ `.part-` file disappears
- ✅ Final WAV file appears atomically
- ✅ No moment where partial file is visible with final name

---

## Test 11: WAV Header Validation

**Goal**: Verify saved files are valid WAV format

**Steps**:
1. Save several stems
2. Check files with hex editor or audio analysis tool

**Expected Results**:
- ✅ File starts with "RIFF" (bytes 0-3)
- ✅ "WAVE" at bytes 8-11
- ✅ "fmt " at bytes 12-15
- ✅ "data" at bytes 36-39
- ✅ File size matches: (PCM data size) + 44 bytes
- ✅ Files open in Audacity, VLC, Windows Media Player, etc.

---

## Troubleshooting

### Drag Works Once, Then Fails

**Cause**: Windows UAC mismatch
**Fix**:
1. Close both app and DAW
2. Restart both WITHOUT admin rights
3. Try again

### "File Not Found" Error

**Cause**: File path issue or premature drag
**Fix**:
1. Check console for full path
2. Verify file exists at that path
3. Wait for "saved" status before dragging

### Wrong Pitch/Tempo in DAW

**Cause**: DAW auto-stretch or sample rate mismatch
**Fix**:
1. Check file metadata (should be 24kHz or 44.1kHz)
2. Disable "auto warp" in Ableton
3. Set DAW project rate to match file rate

### Drag Cursor Shows "No Drop" Icon

**Cause**: Browser drag in Electron, or UAC issue
**Fix**:
1. Verify running Electron build, not browser
2. Check console for drag success message
3. Verify admin rights match

### 📁 Button Doesn't Work

**Cause**: File path not saved correctly
**Fix**:
1. Check console: `[ShowInFolder] Revealing: {path}`
2. Verify path is absolute (starts with C:\ or /)
3. Check file exists at that path

---

## Success Criteria

**PASS if ALL of the following are true**:
- ✅ Drag from Electron → Ableton creates playable clips
- ✅ Files are saved with full absolute paths
- ✅ Atomic writes (no `.part-` files remain)
- ✅ WAV header validation passes
- ✅ Show in Folder highlights correct file
- ✅ No timing issues (pre-warming works)
- ✅ Multiple stems save correctly
- ✅ Correct sample rate preserved (24kHz/44.1kHz)

**FAIL if ANY of the following are true**:
- ❌ Ableton ignores drops
- ❌ "File not found" errors
- ❌ Partial/corrupt files created
- ❌ Wrong pitch or tempo after import
- ❌ Drag works sporadically
- ❌ Show in Folder fails

---

## Performance Metrics

**File Save Time**: Should be < 100ms for typical stems (< 10MB)
**Drag Initiation**: Should be < 50ms from dragstart to startDrag()
**WAV Header Read**: Should complete in < 10ms
**Pre-warm Save**: Should complete before user drags (< 200ms)

---

## Platform-Specific Notes

### macOS
- `shell.showItemInFolder()` highlights the file
- File promises (future enhancement) would be ideal
- No UAC issues

### Windows
- **CRITICAL**: Admin privilege mismatch blocks drag
- Both app AND DAW must run at same privilege level
- `shell.showItemInFolder()` works but doesn't highlight file

---

## Next Steps After Testing

If all tests pass:
1. Test with real music production workflow
2. Try large files (> 10MB)
3. Test rapid drag operations
4. Verify cloud-sync folder compatibility (OneDrive, iCloud)
5. Test on different Windows/macOS versions

If tests fail:
1. Check console logs for specific errors
2. Verify file paths are absolute
3. Confirm atomic writes complete
4. Test WAV files in standalone audio app first
5. Check UAC/admin status on Windows
