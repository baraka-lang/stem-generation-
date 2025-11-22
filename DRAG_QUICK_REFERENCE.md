# Drag-and-Drop Quick Reference

## How to Enable Drag-to-DAW

### Step 1: Use the Desktop App
- Download and install the Electron desktop application
- Do NOT use the browser version (http://localhost:5173)

### Step 2: Enable Auto-Save
1. Click the menu button (☰) in the top-right corner
2. Click "Select Save Folder"
3. Choose a **local folder** on your main drive
   - ✅ Good: `C:\Users\YourName\Music\Stems`
   - ✅ Good: `~/Music/Stems`
   - ❌ Avoid: OneDrive, iCloud Drive, Dropbox folders
   - ❌ Avoid: Network drives or external USB drives

### Step 3: Generate Audio
1. Choose your genre and settings
2. Generate stems
3. Wait for "✓ Saved" indicator to appear

### Step 4: Drag to DAW
1. Hover over the drag button to verify it says "🎯 Drag directly to Ableton/Logic/FL!"
2. Drag directly from the app into your DAW timeline
3. Drop onto a track or empty area
4. Audio clip should be created automatically

---

## Troubleshooting

### Problem: Tooltip says "Enable auto-save first"

**Cause:** Auto-save is not configured

**Solution:**
1. Click menu button (☰)
2. Choose "Select Save Folder"
3. Pick a local folder
4. Generate audio again

---

### Problem: Tooltip says "Browser can't drag to DAWs"

**Cause:** You're using the browser version, not the desktop app

**Solution:**
1. Close the browser
2. Download and install the desktop application
3. Open the desktop app
4. Enable auto-save
5. Try dragging again

**Alternative:**
- Enable auto-save in browser
- Click 📁 button to reveal file
- Drag from Explorer/Finder to DAW

---

### Problem: Alert says "File is still being saved"

**Cause:** File hasn't finished writing to disk yet

**Solution:**
- Wait 2-3 seconds after generation completes
- Look for "✓ Saved" indicator
- Try dragging again

---

### Problem: Drag works but Ableton doesn't accept drop (Windows)

**Cause:** UAC elevation mismatch

**Solution:**
1. Close both the app and Ableton Live
2. Right-click Ableton icon → Properties → Compatibility
3. **Uncheck** "Run as Administrator"
4. Start both apps normally (not as Administrator)

**Verification:**
- Open app's DevTools (Ctrl+Shift+I)
- Look for: `[UAC] windows appElevated=false status=ok`
- If you see `appElevated=true`, restart app without Admin

---

### Problem: Everything looks right but drag still fails

**Fallback Solution (Always Works):**
1. Generate your stem
2. Click the 📁 button next to the drag button
3. This opens Explorer (Windows) or Finder (macOS)
4. Drag the file directly from Explorer/Finder into your DAW
5. This uses native OS drag which always works

---

## Expected Messages

### ✅ Ready to Drag (Electron + Auto-save ON)
```
filename.wav (~123KB, 4.0s)

✓ Saved to C:\Users\user\Music\Stems

🎯 Drag directly to Ableton/Logic/FL!
Or click 📁 to reveal in Explorer/Finder
```
**Action:** Drag directly to DAW - should work!

---

### ⚙️ Need to Enable Auto-Save (Electron + Auto-save OFF)
```
filename.wav (~123KB, 4.0s)

⚙️ Enable auto-save first
(Menu → Choose folder)
Then you can drag to your DAW!
```
**Action:** Enable auto-save first, then regenerate audio

---

### 📁 Browser Mode (Can't Drag to DAWs)
```
filename.wav (~123KB, 4.0s)

📁 Folder/Desktop drop only
⚠️ Browser can't drag to DAWs directly

For Ableton/Logic: Download desktop app
OR drag from saved folder in Explorer/Finder
```
**Action:** Use desktop app OR click 📁 and drag from Explorer/Finder

---

## Console Logs (For Debugging)

### What to Look For in DevTools Console

**Good - Ready to Drag:**
```
[Drag] Electron mode detected
[Drag] Debug state:
  - savedPath: C:\Users\user\Music\Stems\file.wav
  - savedRecord: {status: 'saved', path: '...'}
  - saveDir: C:\Users\user\Music\Stems
  - auto-save enabled: true
[Drag] Using saved file: C:\Users\user\Music\Stems\file.wav
[DRAG] sender=electron event=dragstart stemId=kick
[DRAG] prepared path=... write_ms=0 rename_ms=0 startDrag_ms=2 total_ms=15
```

**Issue - Auto-save Not Enabled:**
```
[Drag] Electron mode detected
[Drag] Debug state:
  - savedPath: null
  - savedRecord: undefined
  - saveDir: null
  - auto-save enabled: false
```
→ Enable auto-save and try again

**Issue - UAC Mismatch (Windows):**
```
[UAC] ⚠️  Running as Administrator - DAW drag may fail!
[UAC] windows appElevated=true status=mismatch
[WARN] App is elevated - DAW drops may fail if DAW is not elevated
```
→ Restart app without "Run as Administrator"

---

## Supported DAWs

### ✅ Tested & Working
- Ableton Live 11, 12
- FL Studio 21
- Logic Pro 11 (macOS)

### ⏳ Should Work (Not Tested)
- Bitwig Studio
- Cubase / Nuendo
- Studio One
- Pro Tools
- Reaper

### ❌ Known Limitations
- Browser mode can't drag to any DAW (use desktop app)
- DAWs must be running with same elevation level (Windows)

---

## Quick Commands

### Open DevTools Console
- **Windows:** `Ctrl + Shift + I`
- **macOS:** `Cmd + Option + I`

### Run Smoke Test
```bash
node test-drag-smoke.cjs
```

### Build Project
```bash
npm run build
```

### Start Development
```bash
npm run dev          # Browser mode
npm run electron:dev # Desktop app mode
```

---

## Contact Support

If you've tried all troubleshooting steps and drag-and-drop still doesn't work:

1. Open DevTools console (Ctrl+Shift+I / Cmd+Option+I)
2. Try to drag
3. Copy all console logs
4. Note your OS, DAW name/version, and exact error message
5. Use the 📁 fallback method while waiting for support

---

**Last Updated:** 2025-01-22
**Version:** 1.1
