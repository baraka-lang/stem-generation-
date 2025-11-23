# DAW Drag-and-Drop — Master Implementation Document

**Last updated:** 2025-11-23  
**Applies to:** 343 Labs AI Music Studio (web + Electron wrapper)  
**Goal:** Restore and harden **drag from app → drop into DAWs** (Ableton Live, Logic Pro, FL Studio) while keeping browser mode as **folder-only drag**.

---

## 0) TL;DR (what must be true)

- **Browser mode (Chromium)** can drag to **folders/desktop only** using `DownloadURL`/blob techniques; DAWs will ignore these payloads. This is by design. Use it only as a helper to save files, then drag from Explorer/Finder/DAW browsers. citeturn0search13turn0search3turn0search8  
- **Desktop app (Electron)** must initiate an **OS-native file drag** from the **main process** via `webContents.startDrag(...)` as a **direct response to the renderer’s `ondragstart`**. Do all preparation **synchronously** (or pre‑warm), then call `startDrag`. citeturn0search5  
- **Windows:** Drag & drop fails if the DAW and our app run at **different UAC/elevation levels** due to **UIPI**. Run both **without Administrator**. citeturn1search6turn1search1turn1search5  
- **Files must be fully flushed and valid WAV** before `startDrag`: write to `*.part`, `fsync`, validate RIFF/WAVE header, atomic rename.  
- **ElevenLabs formats:** keep **PCM S16LE** and the **sample rate provided by your plan**; do not resample in the client. Prefer `pcm_44100` when available; otherwise fall back to `pcm_24000`, `pcm_22050`, `pcm_16000` (and optionally `mp3_44100_128` for compatibility). citeturn3search1turn3search0turn3search8

> **Why this doc?** It consolidates every iteration from prior guides plus the current `app.js` behavior into one exact, testable implementation. fileciteturn1file4turn1file8

---

## 1) Current baseline (what we already have)

- **Generation & audio pipeline**: ElevenLabs → PCM (commonly 24 kHz) → WAV wrapper → playback + saving. fileciteturn1file1  
- **Renderer (`app.js`)**: When not in Electron, it wraps PCM→WAV, sets **DataTransferItem** and **`DownloadURL`** for browser drags (works to folders, not DAWs). It also shows the “Folder-only” banner. fileciteturn1file8  
- **Earlier fixes**: Dynamic Electron detection, atomic write patterns, log lines, UAC guidance, smoke tests, and UI copy already drafted in the previous implementation docs. fileciteturn1file0turn1file6turn1file7turn1file9

**Gap:** Ableton/Logic/FL require a **real file path** via the OS drag system. Browser drags (blob URLs, `DownloadURL`) don’t meet that requirement, hence rejection by DAWs. Electron’s `startDrag` does. citeturn0search5turn0search13

---

## 2) Architecture (final shape)

### A) Browser (Chromium) — **Folder-only**
```
Renderer: dragstart → DataTransferItem + DownloadURL → Explorer/Finder (OK) → DAW (ignored)
```
- Keep this path but **label it clearly** as “Folder/Desktop only; not for DAWs.” citeturn0search3turn0search8

### B) Electron — **Native OS drag → DAW (required)**
```
Renderer dragstart → sync IPC → Main:
  1) Ensure file exists, is flushed, and RIFF/WAVE-valid
  2) Call webContents.startDrag({ file: /absolute/path.wav })
→ OS drag cursor → Drop into DAW → DAW imports
```
- Must be **in response to `ondragstart`** to avoid timing issues. citeturn0search5

### C) Optional “virtual file” / streaming
- **macOS:** `NSFilePromiseProvider` (UTType **com.microsoft.waveform-audio**). citeturn0search1turn4search3  
- **Windows:** `FILEGROUPDESCRIPTOR` + `CFSTR_FILECONTENTS` if you need to stream on drop. citeturn0search2turn0search12

---

## 3) Implementation steps (do these exactly)

### 3.1 Renderer (`src/app.js`)

1) **Detect Electron dynamically** every time (no cached flags).  
   Use `typeof window !== 'undefined' && !!window.electronAPI`. Ensure all checks call a function like `isElectronMode()` (no module‑time eval). fileciteturn1file14

2) **Pre‑warm on pointerdown**: if a stem has PCM in memory but no file on disk, kick off **save‑to‑disk** immediately so the file is ready by `dragstart`. (Show “Preparing… → Ready to Drag”.) fileciteturn1file6

3) **Electron dragstart path** (when auto‑save is enabled & file ready):
   - Call `window.electronAPI.startNativeDragWithPath({ stemId, filePath, filename })` **synchronously** (ipc `sendSync` style under the hood). Expect `{success, error, elapsed}`.  
   - If it returns an error, **prevent default**, show an actionable alert, and stop the drag.  
   - **Do not** call `preventDefault()` before the sync IPC; let the OS gesture proceed. fileciteturn1file9

4) **Browser dragstart path** (not Electron): keep the current code that sets `DataTransferItem`, `text/uri-list`, and `DownloadURL` for folder/desktop drags, but always show the **orange “Folder Drop Only”** banner. fileciteturn1file8

> **Note:** Your current `app.js` already sets `DataTransferItem` and `DownloadURL` correctly for browser drags; that’s fine for folders but **won’t** work for DAWs by design. fileciteturn1file8

---

### 3.2 Main process (`electron-main.cjs`)

**Add a robust synchronous handler** that validates and drags a **real path**:

```js
// electron-main.cjs
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs'), os = require('os'), path = require('path')
const { validateWavHeader, ensureFileReady, checkElevation } = require('./electron-utils.cjs')

let elevationStatus = null

app.whenReady().then(() => {
  elevationStatus = checkElevation()
  if (process.platform === 'win32') {
    if (elevationStatus.elevated) {
      console.warn('[UAC] App is elevated — DAW drops may fail if DAW is not elevated')
    } else {
      console.log('[UAC] Not elevated (recommended)')
    }
  }
  createWindow() // your existing factory
})

// Optional: expose diagnostics
ipcMain.handle('get-elevation-status', async () => elevationStatus || checkElevation())

// The synchronous drag — called during renderer's `ondragstart`
ipcMain.on('start-native-drag-with-path', (event, { stemId, filePath, filename }) => {
  const start = Date.now()
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      event.returnValue = { success: false, error: 'File not found' }
      return
    }
    const stats = fs.statSync(filePath)
    const ready = ensureFileReady(filePath, stats.size)
    if (!ready.ready) {
      event.returnValue = { success: false, error: `File not ready: ${ready.error}` }
      return
    }
    const hdr = validateWavHeader(filePath)
    if (!hdr.valid) {
      event.returnValue = { success: false, error: `Invalid WAV: ${hdr.error}` }
      return
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      event.returnValue = { success: false, error: 'No window for drag' }
      return
    }
    let dragIcon = path.join(app.getAppPath(), 'assets', 'drag-icon.png')
    if (!fs.existsSync(dragIcon)) dragIcon = undefined

    // MUST be called here, synchronously
    win.webContents.startDrag({ file: filePath, icon: dragIcon }) // ← native OS drag
    event.returnValue = { success: true, filePath, elapsed: Date.now() - start }
  } catch (err) {
    event.returnValue = { success: false, error: err.message }
  }
})
```

- **Why sync?** `startDrag` must directly correspond to the OS drag gesture (`ondragstart`) or the drop target may never receive a real file reference. citeturn0search5

---

### 3.3 Utilities (`electron-utils.cjs`)

Implement three critical checks (header, readiness, elevation): the following mirrors our prior drafts:

```js
// electron-utils.cjs
const fs = require('fs'), os = require('os')
function validateWavHeader(filePath) {
  try {
    const header = Buffer.alloc(44)
    const fd = fs.openSync(filePath, 'r')
    fs.readSync(fd, header, 0, 44, 0); fs.closeSync(fd)
    const riff = header.toString('ascii', 0, 4)
    const wave = header.toString('ascii', 8, 12)
    const fmt  = header.toString('ascii',12, 16)
    const data = header.toString('ascii',36, 40)
    const audioFormat = header.readUInt16LE(20)
    if (riff!=='RIFF' || wave!=='WAVE' || fmt!=='fmt ' || data!=='data') return { valid:false, error:'RIFF/WAVE/fmt/data missing' }
    if (audioFormat !== 1) return { valid:false, error:`Not PCM (audioFormat=${audioFormat})` }
    return { valid:true }
  } catch (e) { return { valid:false, error:e.message } }
}

function ensureFileReady(filePath, expectedSize) {
  try {
    if (!fs.existsSync(filePath)) return { ready:false, error:'Not found' }
    const st = fs.statSync(filePath)
    if (st.size <= 0) return { ready:false, error:'Empty file' }
    if (expectedSize && st.size !== expectedSize) return { ready:false, error:`Size mismatch (${st.size} != ${expectedSize})` }
    const fd = fs.openSync(filePath, 'r'); fs.closeSync(fd) // can open for read
    return { ready:true }
  } catch (e) { return { ready:false, error:e.message } }
}

function checkElevation() {
  if (process.platform !== 'win32') return { elevated:false, method:'n/a' }
  try {
    const probe = `${os.tmpdir()}\elev_probe.tmp`
    try { require('fs').writeFileSync(probe, 'x'); require('fs').unlinkSync(probe); return { elevated:true, method:'write-test' } }
    catch { return { elevated:false, method:'write-test' } }
  } catch { return { elevated:false, method:'fallback' } }
}

module.exports = { validateWavHeader, ensureFileReady, checkElevation }
```

> These utility responsibilities are already described and used across earlier drafts. Keep them small and sync. fileciteturn1file4

---

### 3.4 Atomic save (before any drag)

When saving a generated WAV to disk (auto‑save or pre‑warm), write atomically and **flush**:

```js
// pseudo in main (or Node sidecar called by preload)
fs.writeFileSync(tempPath, wavBytes)      // write *.part
const fd = fs.openSync(tempPath, 'r+')
fs.fsyncSync(fd); fs.closeSync(fd)        // flush to disk
fs.renameSync(tempPath, finalPath)        // atomic rename (same volume)
```
- Only **enable** drag when `finalPath` exists, size > 0, header valid.  
- Keep cleanup timeouts **≥ 5 minutes** to avoid deleting a file while DAW is still reading it. fileciteturn1file9

---

## 4) ElevenLabs format policy (no resampling)

- Use the **best PCM rate** your plan allows (Pro+ can use `pcm_44100`; lower tiers use `pcm_24000` / `pcm_22050` / `pcm_16000`). Build a **fallback ladder** and log the chosen format. citeturn3search1turn3search8  
- The client wrapper should **only** add a WAV header (RIFF/WAVE **PCM S16LE**), never resample. Your wrapper already does this. fileciteturn1file4  
- DAWs accept WAV/AIFF natively; MP3/M4A will be decoded on import (Ableton). Prefer WAV for drag. citeturn2search0

> The project’s PRD already specifies a **24 kHz PCM → WAV** pipeline; keep it unless your subscription allows 44.1 kHz. fileciteturn1file2

---

## 5) DAW expectations & platform gotchas

- **Ableton Live**: Imports WAV/AIFF/FLAC/OGG; MP3/M4A decoded on import. If **running as Administrator**, **drag & drop is disabled**; don’t run elevated. citeturn2search0turn1search6  
- **Logic Pro (macOS)**: Dragging audio into the **Tracks area** creates tracks or sampler content; native OS drag works when you provide a real file path. citeturn2search4  
- **FL Studio**: Add your auto‑save folder to the **Browser → Extra search folders**; users can then drag from the FL Browser into Playlist/Channel Rack. citeturn2search13  
- **Windows path length**: Keep paths < **260 chars** (unless your app declares long-path aware and the OS is configured). Use short filenames. citeturn4search0  
- **macOS UTType**: Prefer `com.microsoft.waveform-audio` as the promised type for WAV when using file promises. citeturn4search3

---

## 6) Diagnostics & logs (what to print)

Keep these lines; they are already drafted across prior docs and help support debug:

```
[FMT] ElevenLabs -> pcm_44100 (or pcm_24000, ...) chosen
[SAVE] writeWavAtomic OK path=... size=... fsync=ok hdr=ok
[DRAG] sender=electron event=dragstart stemId=...
[DRAG] main startDrag path=... elapsedMs=...
[UAC] windows appElevated=false status=ok   // or mismatch warning
```

> The combined guide includes concrete examples and troubleshooting banners; reuse them verbatim. fileciteturn1file9turn1file13

---

## 7) QA matrix (run every release)

- **Environments**: Win10/11 + Live 11/12, FL 21; macOS 13–15 + Live 11/12, Logic 11.x.  
- **Senders**: Browser (folder‑only), Electron (native drag).  
- **Payloads**: Small/large WAV, mono/stereo, different sample rates (per ElevenLabs tier).  
- **Pass if**: DAW creates a clip on drop; audio plays; no UAC block; no “partial file” errors; cleanup happens after reading. fileciteturn1file12

> Use the **smoke test** (`test-drag-smoke.cjs`) to verify atomic writes & headers without a DAW. fileciteturn1file15

---

## 8) Troubleshooting (fast path)

1) **Windows: drag does nothing in Live** → Quit all; relaunch both **not** as Admin; verify in console `[UAC] ... status=ok`. citeturn1search6  
2) **Drop rejected** → Confirm file exists, is non‑zero, header valid, and rename finished before drag.  
3) **Works to folders but not DAW** → You’re in browser path (`DownloadURL`); switch to Electron or drag from Explorer/Finder/DAW browser. citeturn0search3  
4) **Large files** → Increase cleanup timeout (≥ 5 min) and avoid deleting temp files while DAW is reading. fileciteturn1file9

---

## 9) Appendix — code references you can copy/paste

### 9.1 WAV wrapper (no resample)
```ts
export function pcm16leToWav(pcm: ArrayBuffer, sampleRate: number, channels = 2): ArrayBuffer {
  const src = new Uint8Array(pcm)
  const blockAlign = channels * 2, byteRate = sampleRate * blockAlign, dataSize = src.byteLength
  const buf = new ArrayBuffer(44 + dataSize), v = new DataView(buf)
  write(v,0,'RIFF'); v.setUint32(4, 36 + dataSize, true)
  write(v,8,'WAVE'); write(v,12,'fmt '); v.setUint32(16,16,true)
  v.setUint16(20,1,true); v.setUint16(22,channels,true)
  v.setUint32(24,sampleRate,true); v.setUint32(28,byteRate,true)
  v.setUint16(32,blockAlign,true); v.setUint16(34,16,true)
  write(v,36,'data'); v.setUint32(40,dataSize,true)
  new Uint8Array(buf,44).set(src); return buf
  function write(d:DataView,o:number,s:string){for(let i=0;i<s.length;i++) d.setUint8(o+i, s.charCodeAt(i))}
}
```
fileciteturn1file4

### 9.2 Browser drag (folder‑only)
```js
e.dataTransfer.items.add(wavFile)              // best effort
e.dataTransfer.setData('DownloadURL', `audio/wav:${filename}:${blobUrl}`)
e.dataTransfer.setData('text/uri-list', blobUrl)
e.dataTransfer.setData('text/plain', filename)
```
fileciteturn1file8

### 9.3 Electron sync startDrag (main)
```js
win.webContents.startDrag({ file: filePath, icon })
```
> Must be called as a direct consequence of the renderer’s `ondragstart`. citeturn0search5

### 9.4 macOS / Windows virtual files (future)
- macOS promise: **NSFilePromiseProvider** (+ delegate to write the WAV). citeturn0search1turn0search6turn0search11turn0search21  
- Windows virtual: **FILEGROUPDESCRIPTOR + CFSTR_FILECONTENTS**. citeturn0search2turn0search12

---

## 10) Acceptance checklist

- [ ] Browser path labeled **Folder-only**; Electron path used for DAWs. fileciteturn1file5  
- [ ] Renderer uses **dynamic Electron detection** everywhere. fileciteturn1file7  
- [ ] Main handler validates file, **fsyncs**, atomic renames, and calls **`startDrag` synchronously**. citeturn0search5  
- [ ] Windows shows UAC warnings when elevated; doc instructs to run both processes at same level. citeturn1search6  
- [ ] ElevenLabs format ladder in place; no resampling in client; WAV header correct. citeturn3search1  
- [ ] QA matrix passes; smoke test green. fileciteturn1file15

---

## 11) Source notes (what this master merges)

- **Combined internal guidance**: atomic writes, utility checks, UI banners, logs, and test plan. fileciteturn1file4  
- **Product baseline**: PRD indicates 24 kHz PCM→WAV flow today; compatible with DAWs. fileciteturn1file2  
- **Live code**: `app.js` shows current browser drag (`DataTransferItem`, `DownloadURL`) and warning banners; this remains for folder-only drags. fileciteturn1file8

---

### Appendix: DAW references

- **Electron native drag** (must call in `ondragstart`). citeturn0search5  
- **MDN DataTransfer** (web drags). citeturn0search13  
- **Chrome `DownloadURL`** (Chrome‑specific, used for folder/desktop). citeturn0search3turn0search8  
- **macOS file promises** (`NSFilePromiseProvider` + UTType WAV). citeturn0search1turn4search3  
- **Windows virtual file drags** (`FILEDESCRIPTOR`/`FILECONTENTS`). citeturn0search2turn0search12  
- **Ableton formats & admin warning**. citeturn2search0turn1search6  
- **Logic Pro drag behavior**. citeturn2search4  
- **FL Studio extra folders**. citeturn2search13
