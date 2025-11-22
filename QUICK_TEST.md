# Quick Test - Is Electron Detection Fixed?

## 30-Second Test

### Step 1: Open Electron App
- Launch the **desktop application** (NOT browser)
- Make sure you're running the Electron version

### Step 2: Open DevTools Console
- **Windows:** Press `Ctrl + Shift + I`
- **macOS:** Press `Cmd + Option + I`

### Step 3: Test Detection
Type this in the console:
```javascript
typeof window.electronAPI !== 'undefined'
```

**Expected Result:** `true`

If you see `false`, you're in browser mode, not Electron!

---

## 1-Minute Test

### Test Tooltip Message

1. **Generate a stem** (without enabling auto-save)
2. **Hover** over the drag button (🔒 icon)
3. **Read the tooltip**

**✅ CORRECT (Fixed):**
```
Techno_Bass_130_Am_8bars.wav (~1384.7KB, 7.4s)

⚙️ Enable auto-save first
(Menu → Choose folder)
Then you can drag to your DAW!
```

**❌ WRONG (Bug still present):**
```
Techno_Bass_130_Am_8bars.wav (~1384.7KB, 7.4s)

📁 Folder/Desktop drop only
⚠️ Browser can't drag to DAWs directly

For Ableton/Logic: Download desktop app
OR drag from saved folder in Explorer/Finder
```

---

## 2-Minute Test

### Test Orange Banner

1. **Generate a stem** (without enabling auto-save)
2. **Try to drag** the button
3. **Check if orange banner appears**

**✅ CORRECT (Fixed):**
- Alert popup appears with instructions
- NO orange banner

**❌ WRONG (Bug still present):**
- Orange banner appears saying "Folder Drop Only"

---

## Full 5-Minute Test

### Test Complete Flow

1. **Enable Auto-Save:**
   - Click menu button (☰)
   - Click "Select Save Folder"
   - Choose a local folder (e.g., `C:\Users\YourName\Music\Stems`)

2. **Generate Stem:**
   - Choose genre, BPM, key
   - Click "Create Techno Stems"
   - Wait for generation to complete
   - Wait for "✓ Saved" indicator

3. **Check Tooltip:**
   - Hover over drag button
   - Should say: "🎯 Drag directly to Ableton/Logic/FL!"

4. **Test Drag to DAW:**
   - Open Ableton Live (or other DAW)
   - Drag from the app directly into Ableton timeline
   - Drop onto a track
   - Audio clip should be created

5. **Verify in Console:**
   ```
   [Drag] Electron mode detected
   [Drag] Debug state:
     - savedPath: C:\...\file.wav
     - savedRecord: {status: 'saved'}
     - saveDir: C:\...\Stems
     - auto-save enabled: true
   [Drag] Using saved file: C:\...\file.wav
   [DRAG] sender=electron event=dragstart
   ```

---

## If Test Fails

### Console Shows `false`
**Cause:** You're in browser mode, not Electron

**Solution:**
- Close the browser
- Launch the desktop application
- Test again

---

### Tooltip Still Shows Browser Warnings
**Cause:** Build didn't update or cache issue

**Solution:**
```bash
# Rebuild the project
npm run build

# Restart Electron app
# Or force refresh: Ctrl+Shift+R / Cmd+Shift+R
```

---

### Orange Banner Still Appears
**Cause:** Old code is still running

**Solution:**
1. Close Electron app completely
2. Rebuild: `npm run build`
3. Restart Electron app
4. Clear DevTools cache (DevTools → Settings → "Disable cache")

---

### Drag Still Doesn't Work (After Auto-Save Enabled)
**Cause:** Might be UAC elevation mismatch (Windows only)

**Solution:**
1. Close both app and DAW
2. Make sure neither runs as Administrator
3. Restart both normally
4. Try again

**Fallback:**
- Click 📁 button next to drag button
- Opens Explorer/Finder showing the file
- Drag from there to DAW (always works)

---

## Success Criteria

✅ **Pass:** Console shows `true` for Electron detection
✅ **Pass:** Tooltip says "Enable auto-save first" (not browser warnings)
✅ **Pass:** No orange banner in Electron mode
✅ **Pass:** After enabling auto-save, drag creates clip in DAW

❌ **Fail:** Any of the above doesn't work → See troubleshooting

---

## Quick Commands

### Open DevTools
```
Windows: Ctrl + Shift + I
macOS:   Cmd + Option + I
```

### Test Electron Detection
```javascript
console.log('Electron:', typeof window.electronAPI !== 'undefined')
console.log('API:', window.electronAPI)
```

### Rebuild Project
```bash
npm run build
```

### Start Electron (Dev Mode)
```bash
npm run electron:dev
```

---

**Updated:** 2025-01-22
**Status:** Ready for Testing
