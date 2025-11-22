# DAW Drag-and-Drop Troubleshooting Runbook

**Operator Guide for Supporting Drag-to-DAW Issues**

---

## Quick Diagnosis

| Symptom | Likely Cause | Jump to Step |
|---------|--------------|--------------|
| Drag does nothing in Ableton (Windows) | UAC mismatch | Step 1 |
| "File not found" or "Invalid WAV" | File validation failure | Step 2 |
| Works once, then stops | Timing/elevation issue | Step 1, 3 |
| Works in Explorer but not DAW | Expected in browser mode | Step 4 |
| Button disabled or grayed out | PCM not ready or browser limitation | Step 5 |

---

## Step 1: Check UAC Elevation Parity (Windows Only)

**Problem:** Drag-and-drop fails silently in Ableton Live on Windows

**Root Cause:** Windows blocks drag-and-drop between processes with different elevation levels (Administrator vs normal user)

### Solution:

1. Close both the app and Ableton Live completely
2. Check Task Manager (Ctrl+Shift+Esc) and end any lingering processes
3. Right-click Ableton Live icon → **Properties** → **Compatibility** tab
4. **UNCHECK** "Run this program as an administrator"
5. Click OK
6. Start both apps normally (do not use "Run as Administrator")
7. Try drag-and-drop again

### Validation:

Check the Electron console for UAC status:
```
[UAC] windows appElevated=false status=ok
```

If you see:
```
[UAC] windows appElevated=true status=mismatch
```

The app is running as Administrator and needs to be restarted normally.

### Customer Message:

> "Windows blocks drag-and-drop when one app runs as Administrator and the other doesn't. Please close both this app and Ableton, then restart them both WITHOUT using 'Run as Administrator'. This ensures they have matching privileges."

---

## Step 2: Verify File Exists and Is Valid

**Problem:** Error messages like "File not found", "Invalid WAV", or "Corrupted file"

**Root Cause:** File wasn't fully written, header is invalid, or file was deleted prematurely

### Solution:

1. Open Electron DevTools:
   - Windows: `Ctrl+Shift+I`
   - macOS: `Cmd+Option+I`

2. Switch to **Console** tab

3. Look for these log patterns:
   ```
   [FMT] stemId=kick fmt=pcm_44100 sr=44100 ch=2 bytes=352800
   [SAVE] path=C:\Users\...\file.wav size=352844 wavHeader=ok fsync=ok
   [DRAG] prepared path=C:\Users\...\file.wav size=344.4KB
   ```

4. Check for error codes:
   ```
   [ERROR] code=NO_PATH stemId=kick path=...
   [ERROR] code=PARTIAL_WRITE stemId=kick error=...
   [ERROR] code=HEADER_INVALID stemId=kick error=...
   ```

5. If you see errors:
   - `NO_PATH`: File was deleted or auto-save is not enabled
   - `PARTIAL_WRITE`: File is still being written or locked
   - `HEADER_INVALID`: WAV header is corrupted

### Solution per Error:

**NO_PATH:**
- Enable auto-save (menu button → Choose save folder)
- Generate a new stem
- Wait for "✓ Saved" indicator

**PARTIAL_WRITE:**
- Wait 2-3 seconds after generation completes
- Check if antivirus is scanning the file
- Try a different folder (not cloud-synced)

**HEADER_INVALID:**
- Regenerate the stem
- Check disk space (need at least 10MB free)
- Try saving to a different drive

### Customer Message:

> "The audio file may not have been fully saved before you tried to drag it. Please wait a moment after generation completes, then try dragging again. If it still fails, try regenerating the stem."

---

## Step 3: Check Timing (pointerdown → dragstart)

**Problem:** Drag gesture starts but drag fails, or works sporadically

**Root Cause:** File preparation wasn't complete before drag started

### Solution:

1. Check console for timing logs:
   ```
   [DRAG] sender=electron event=dragstart stemId=kick
   [DRAG] prepared path=... write_ms=0 rename_ms=0 startDrag_ms=2 total_ms=15
   ```

2. If `total_ms` > 100ms, file preparation is too slow

3. Possible causes:
   - **Cloud-synced folder** (OneDrive, iCloud): Files may be "on-demand" placeholders
   - **Network drive**: Network latency adds delay
   - **Slow disk**: HDD instead of SSD
   - **Antivirus**: Real-time scanning blocks file access

### Solution:

1. **Preferred:** Use a local folder on an SSD:
   - Windows: `C:\Users\[username]\Music\Stems`
   - macOS: `~/Music/Stems`

2. **Avoid:**
   - OneDrive, iCloud Drive, Dropbox sync folders
   - Network/mapped drives
   - External USB 2.0 drives

3. **Verify cloud placeholder status:**
   - Windows: Check file icon for cloud overlay
   - macOS: Right-click → "Download Now" if showing cloud icon

### Console Log to Look For:
```
[WARN] cloudPlaceholder=true path=...
```

### Customer Message:

> "For best performance, save audio files to a local folder on your main drive (not in cloud-synced folders like OneDrive or iCloud). Cloud storage can cause delays that interfere with drag-and-drop."

---

## Step 4: Browser vs Electron Mode

**Problem:** "Drag works to desktop but not to Ableton"

**Root Cause:** This is expected behavior in browser mode - browsers cannot perform OS-level drag to DAWs

### Identification:

**Browser Mode:**
- Running at `http://localhost:5173` or `https://domain.com`
- No desktop window frame
- Console shows: `[DRAG] sender=browser event=dragstart`

**Electron Mode:**
- Desktop application window
- Console shows: `[DRAG] sender=electron event=dragstart`

### Solution for Browser Mode:

Browser mode only supports drag-to-folder/desktop, **NOT** direct DAW drops.

#### Option 1: Use Desktop App (Recommended)
1. Download and install the Electron desktop app
2. Enable auto-save and choose a folder
3. Generate audio
4. Drag directly to DAW

#### Option 2: Drag from Folder
1. Enable auto-save in browser
2. Generate audio
3. Click the 📁 button to reveal file in Explorer/Finder
4. Drag from Explorer/Finder directly to DAW

#### Option 3: Add Folder to DAW Browser
- **Ableton Live:** Drag folder to "Places" panel (left sidebar)
- **FL Studio:** Options → File Settings → Browser extra search folders
- **Logic Pro:** Open browser, drag files from Finder

### Customer Message:

> "Browser mode can only drag to folders and desktop. For direct drag-to-DAW, please use our desktop application. Alternatively, you can click the 📁 button to reveal the saved file and drag it from Explorer/Finder directly into your DAW."

---

## Step 5: Use Folder Drag Fallback

**Problem:** All checks pass but drag still fails, or customer wants immediate workaround

**Root Cause:** Any remaining edge case or system-specific issue

### Universal Workaround:

This method always works because it uses OS-native drag from file manager:

1. Generate/load the stem you want
2. Click the **📁 button** next to the drag button
3. This opens Explorer (Windows) or Finder (macOS) showing the file
4. **Drag the file from Explorer/Finder directly into your DAW**
   - Ableton: Drag to track or session view
   - Logic: Drag to tracks area
   - FL Studio: Drag to playlist or channel rack

### Why This Works:

OS file managers always perform native file drags that DAWs accept. This bypasses:
- Electron IPC timing
- UAC restrictions
- Browser limitations
- Any app-specific quirks

### Customer Message:

> "As a reliable alternative, click the 📁 button next to any stem to reveal the saved file. Then drag the file directly from Explorer/Finder into your DAW. This method always works and bypasses any technical limitations."

---

## Diagnostic Commands

### Check Electron Console

**Windows:** `Ctrl+Shift+I`
**macOS:** `Cmd+Option+I`

### Run Smoke Test

```bash
node test-drag-smoke.cjs
```

Expected output:
```
✅ All 9 tests passed!

📋 Summary:
  - UAC detection working
  - PCM → WAV wrapping correct
  - Atomic write with fsync successful
  - File validation passing
  - WAV header structure valid
  - Files ready for Electron startDrag()

🎯 This pipeline is ready for DAW drops!
```

### Check File Manually

Navigate to the auto-save folder and verify:
- File exists and has size > 0
- File can be opened in any audio player
- File is not a cloud placeholder (no cloud icon overlay)
- File is in local storage (not network drive)

---

## Log Patterns Reference

### Success Pattern:
```
[FMT] stemId=kick fmt=pcm_44100 sr=44100 ch=2 bytes=352800
[SAVE] path=C:\path\file.wav size=352844 wavHeader=ok fsync=ok
[DRAG] sender=electron event=dragstart stemId=kick
[DRAG] prepared path=C:\path\file.wav size=344.4KB
[DRAG] prepared path=... write_ms=0 rename_ms=0 startDrag_ms=2 total_ms=15
```

### UAC Mismatch (Windows):
```
[UAC] windows appElevated=true status=mismatch
[WARN] App is elevated - DAW drops may fail if DAW is not elevated
```

### File Validation Failure:
```
[ERROR] code=PARTIAL_WRITE stemId=kick error=Size mismatch...
[ERROR] code=HEADER_INVALID stemId=kick error=Invalid header...
[ERROR] code=NO_PATH stemId=kick path=null
```

### Browser Mode (Expected):
```
[DRAG] sender=browser event=dragstart stemId=kick
[DRAG] ⚠️  BROWSER MODE: This drag works for FOLDERS/DESKTOP only
```

---

## Escalation Criteria

Escalate to engineering if:

1. **Smoke test fails** with all tests passing except final drag
2. **Logs show success** but DAW still rejects drop
3. **Issue persists** after all 5 steps completed
4. **New error codes** appear that aren't documented

### Information to Collect:

- Operating system and version
- DAW name and version
- Browser vs Electron mode
- Full console logs from generation through drag attempt
- Output of `node test-drag-smoke.cjs`
- Screenshot of error (if any visible error)
- Auto-save folder path

---

## Quick Reference

| Error Code | Meaning | Solution |
|------------|---------|----------|
| `NO_PATH` | File not found | Enable auto-save, regenerate |
| `PARTIAL_WRITE` | File incomplete | Wait, check antivirus |
| `HEADER_INVALID` | Corrupted WAV | Regenerate stem |
| `UAC_MISMATCH` | Elevation mismatch | Restart both apps without Admin |
| `STARTDRAG_ERR` | Drag API failed | Check console, use folder fallback |

---

**Last Updated:** 2025-01-22
**Version:** 1.0
**Maintainer:** Engineering Team
