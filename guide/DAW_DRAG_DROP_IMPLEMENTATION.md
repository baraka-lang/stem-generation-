
# UPDATED DAW Drag‑and‑Drop Implementation Guide (Ableton Live · Logic Pro · FL Studio)

**Status:** Replacement implementation guide focused on restoring _reliable_ “drag from app → drop into DAW”.  
**Short answer on auto‑download:** Keep it, but **only** as quality‑of‑life for **browser → folder** and for pre‑materializing files that Electron will drag. It **won’t** make **browser → DAW** work by itself. Use **Electron/native** for DAW drops. citeturn0search8turn0search3turn0search18

---

## 0) Why your working build regressed

1) **Browser payloads are not OS file drops.** Chromium’s `DownloadURL` can drag to Desktop/folders, but DAWs expect **native file paths or file promises**, not web payloads. This is by design and unchanged. citeturn0search8turn0search3  
2) **Electron must start native drag during `ondragstart`.** If file creation/validation is not fully finished (or is async) before calling `startDrag`, the OS gesture can race ahead and the DAW ignores the drop. citeturn0search0  
3) **Windows elevation (UAC) mismatches block drag/drop.** If Live is run **as Administrator** and your app is not (or vice versa), drag from *any* app—including Electron—fails. citeturn0search19turn0search4  
4) **Electron requires real files or native virtualization.** `webContents.startDrag()` needs an **existing path**; otherwise you must supply native **file promises** (macOS) or **virtual files** (Windows). citeturn0search5turn0search1turn0search2

**Implication:** Auto‑download helps you **have the file on disk** (good), but **direct web→DAW** still won’t work. Your desktop runtime (Electron) must originate the native drag and guarantee the file is ready. citeturn0search0

---

## 1) What your codebase already has (and should keep)

- **Auto‑save/auto‑download panel & workflow** in the renderer, used for pre‑saving stems and reflecting status, including Electron save selection and File System Access. fileciteturn1file6turn1file9turn1file12turn1file13  
- **Native helper stubs** for macOS (file promises) and Windows (virtual files) to support DAW‑grade outputs without pre‑writing to disk. fileciteturn1file0turn1file14turn1file19  
- **Prior combined guide** with atomic writes, sync IPC, validation, and UAC advice—reuse those patterns verbatim. fileciteturn1file4turn1file8turn1file10turn1file16  
- **Diagnostic log format** (FMT/SAVE/DRAG/UAC) you can turn on to isolate failures. fileciteturn1file5turn1file15

---

## 2) The three supported flows (pick at least B; add C when ready)

### A) Browser (Chromium) — **Folder/Desktop only** (always limited)
- Keep **auto‑download** & **“Reveal in folder”**. Dragging from the **OS file manager** (Finder/Explorer) or the **DAW’s own browser** works.  
- If you expose web‑drag, set `DownloadURL` and label it **“Folder drop only — not DAWs.”** citeturn0search8

> **Not viable** for direct DAW drops due to web security & non‑standard payloads. Use Electron for native DAW drags. citeturn0search8turn0search3

### B) Electron Desktop — **Saved‑path drag (baseline, recommended)**
- Pre‑save the WAV to disk (atomic write + header check).  
- In **renderer `ondragstart`**, call a **sync IPC** that:
  1) verifies the destination file **exists** and is **ready**, then  
  2) calls `webContents.startDrag({ file, icon })` **immediately**. citeturn0search0

This is the quickest stable path that works on Windows & macOS today.

### C) Electron + Native Modules — **Virtual file/file‑promise (advanced)**
- **macOS:** `NSFilePromiseProvider` → write the WAV during **promise fulfillment**. citeturn0search1turn0search6  
- **Windows:** advertise `CFSTR_FILEDESCRIPTORW` + `CFSTR_FILECONTENTS` (one IStream per file). citeturn0search2turn0search12

Your repo already includes starter code for both; wire them up after B is green. fileciteturn1file0turn1file14turn1file19

---

## 3) Audio format policy (align with your PRD & ElevenLabs)

- Preserve **source PCM S16LE**; don’t resample—just wrap to WAV. Your PRD baseline is **PCM 24 kHz → WAV**; if your tier allows, use **44.1 kHz → fallback to 24k/22.05k/16k**. fileciteturn1file7turn1file3  
- Use filename hints (BPM/key/bars/rate) to help DAWs avoid stretch assumptions. *(UI only; don’t modify audio data.)*

---

## 4) Implementation: step‑by‑step

### 4.1 Browser: keep auto‑download, constrain expectations
1) **Continue** writing stems to a chosen folder via File System Access (Chromium). Show clear state: _disabled → pending → saved_. fileciteturn1file6turn1file12  
2) **Expose** “Reveal in Finder/Explorer” and a **DAW browser setup** hint (Ableton **Places**, FL **extra search folders**).  
3) **If** you keep web‑drag, set `DownloadURL` and label it **“folders only”**. citeturn0search8

> **No change** will make pure‑browser **→ DAW** reliable; this is a platform constraint. citeturn0search8

### 4.2 Electron (baseline): saved‑path native drag
**Renderer (`app.js`)**  
- On `dragstart` (or `pointerdown` pre‑warm), call a **sync IPC** (not `invoke`) so the main process can finish file validation **before** the OS drag proceeds. fileciteturn1file4turn1file10  
- If the file isn’t saved yet, the IPC handler should create it **synchronously** (pre‑warm makes this fast).

**Main (`electron-main.*`)**  
- Implement a handler like `ipcMain.on('drag:do', (ev, { stemId }) => { … })` that:
  1. Resolves `filePath` from your Electron file manager.  
  2. **Ensures readiness**: exists, non‑zero size, **valid WAV header**, and recent timestamp.  
  3. Calls `win.webContents.startDrag({ file: filePath, icon })` immediately.  
  4. Returns `{success:true}` via **`event.returnValue`**.

**Utilities** (Node side)  
- `validateWavHeader(path)` — read first 44 bytes; verify `RIFF/WAVE/fmt /data`, PCM=1, bits=16.  
- `ensureFileReady(path, expectedSize?)` — `stat>0`, not locked, matches size if known.  
- Add `fsync` after writing `.part` file; then `rename` to final for **atomic** visibility.  
- Keep a **5‑minute** cleanup delay for temp files.

> **Why:** Electron requires a real path at drag time. Doing the prep in `ondragstart` avoids races. citeturn0search0turn0search5

### 4.3 Electron (advanced): native virtualization
- **macOS**: implement `NSFilePromiseProvider` (`UTType` = `com.microsoft.waveform-audio`) and fulfill by wrapping the exact ElevenLabs PCM to WAV at drop time. citeturn0search1  (Your `draghelper.swift` already sketches this.) fileciteturn1file0turn1file14  
- **Windows**: use `CFSTR_FILEDESCRIPTORW` to describe each file and `CFSTR_FILECONTENTS` with an `IStream` that emits the WAV bytes on demand. citeturn0search2turn0search12  (Your `draghelper.cpp` shows an `IStream` wrapper.) fileciteturn1file19

> This path removes pre‑writes for large files and is the closest to DAW‑native UX.

---

## 5) Pseudocode & snippets (drop‑in ready)

### 5.1 WAV wrapper (no resample, S16LE only)
```ts
export function pcm16leToWav(pcm: ArrayBuffer, sampleRate: number, channels = 2): ArrayBuffer {
  const src = new Uint8Array(pcm);
  const blockAlign = channels * 2, byteRate = sampleRate * blockAlign, dataSize = src.byteLength;
  const buf = new ArrayBuffer(44 + dataSize), v = new DataView(buf);
  write(v,0,'RIFF'); v.setUint32(4, 36 + dataSize, true);
  write(v,8,'WAVE'); write(v,12,'fmt '); v.setUint32(16,16,true);
  v.setUint16(20,1,true); v.setUint16(22,channels,true);
  v.setUint32(24,sampleRate,true); v.setUint32(28,byteRate,true);
  v.setUint16(32,blockAlign,true); v.setUint16(34,16,true);
  write(v,36,'data'); v.setUint32(40,dataSize,true);
  new Uint8Array(buf,44).set(src); return buf;
  function write(d:DataView,o:number,s:string){for(let i=0;i<s.length;i++) d.setUint8(o+i, s.charCodeAt(i));}
}
```

### 5.2 Atomic write (Node)
```ts
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

export async function writeWavAtomic(destPath: string, bytes: Uint8Array) {
  const tmp = join(dirname(destPath), `.part-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  await fs.writeFile(tmp, bytes);
  const fd = await fs.open(tmp, 'r+'); await fd.sync(); await fd.close();
  await fs.rename(tmp, destPath); // atomic on same volume
}
```

### 5.3 Renderer → Main (sync) for native drag
```ts
// renderer.ts
tile.addEventListener('dragstart', (e) => {
  const ok = window.electron.ipc.sendSync('drag:do', { stemId }); // blocks until main returns
  if (!ok) e.preventDefault();
});

// main.ts
ipcMain.on('drag:do', (ev, { stemId }) => {
  const { filePath, icon } = ensureOnDisk(stemId); // atomic write & header validate if needed
  const win = BrowserWindow.fromWebContents(ev.sender);
  win.webContents.startDrag({ file: filePath, icon }); // must be called during ondragstart
  ev.returnValue = true;
});
```
*Electron requires calling `startDrag()` in response to `ondragstart`.* citeturn0search0

### 5.4 macOS file promise (later)
```swift
let provider = NSFilePromiseProvider(fileType: "com.microsoft.waveform-audio", delegate: self)
provider.userInfo = /* {pcmBytes, sampleRate, channels, filename} */

func filePromiseProvider(_ p: NSFilePromiseProvider,
                         writePromiseTo url: URL,
                         completionHandler: @escaping (Error?) -> Void) {
  // Wrap ElevenLabs PCM → WAV (no resample), then write to `url`
  completionHandler(nil)
}
```
*Use promises to indicate intent and fulfill on drop.* citeturn0search1

### 5.5 Windows virtual file (later)
- Publish **one** `CFSTR_FILEDESCRIPTORW` per item + **one** `CFSTR_FILECONTENTS` stream per descriptor; set `TYMED_ISTREAM`. citeturn0search2turn0search12

---

## 6) Guardrails & platform quirks

- **Windows UAC:** Never run Live as Administrator unless unavoidable; if you must, run your app **with the same elevation** or DAW drops silently fail. citeturn0search19  
- **Path length (Windows):** keep paths <260 chars or enable long‑path support; warn users when save folder is very deep. (Reflected in your Attempt #2 logs.) fileciteturn1file11  
- **macOS drag‑end timing:** `startDrag` may trigger drag‑end handlers earlier than you expect; don’t rely on a drag‑end callback for cleanup. citeturn0search20  
- **Cloud‑sync folders:** delay “Ready” until the local write is complete to avoid partial reads. fileciteturn1file17

---

## 7) Logs to keep (copy/paste)

```
[FMT] ElevenLabs -> {pcm_44100|pcm_24000|...}
[SAVE] path=… size=… wavHeader=ok fsync=ok sr=… ch=… bits=16
[DRAG] renderer dragstart stem=…
[DRAG] main startDrag path=… elapsedMs=…
[UAC] windows appElevated=…
```

Your previous reports already standardize these. fileciteturn1file5turn1file15

---

## 8) Test matrix (must‑pass)

- **Envs:** Win 10/11 + Live 11/12, FL 21; macOS 13–15 + Live 11/12, Logic 11.x.  
- **Flows:** A: Browser → folder; B: Electron → DAW; C: Native (when implemented).  
- **Files:** short (<10 MB) and long (>200 MB); mono & stereo; formats: 44.1k → 24k → 22.05k → 16k fallback.  
- **Pass if:** DAW creates a clip/region and plays audio; no UAC block; no partials; no stalls. (Mirror your “Attempt” docs.) fileciteturn1file4turn1file8

---

## 9) Troubleshooting (symptom → fix)

- **Drop does nothing (Electron → Live on Windows).** Check UAC. Restart both non‑admin. citeturn0search19  
- **Works to Desktop, not to DAW (browser).** Expected—DAW ignores web payloads; use Electron or drag from Finder/Explorer. citeturn0search8  
- **“Unreadable/corrupt file”** after drop. Validate header and ensure **atomic write + fsync** before drag. fileciteturn1file10  
- **Slow drag/lag.** Move heavy work to **promise/stream fulfillment** (native) or pre‑warm file creation. citeturn0search1  
- **Only one file appears on multi‑drag.** Provide one descriptor/promise **per item**. citeturn0search2

---

## 10) Answering your question explicitly

> **Is “auto‑download” still viable for DAW drag & drop?**  
> **Yes, but only as an enabler—not the delivery mechanism.** It ensures the file exists on disk (so Electron can drag a **path**) and it supports **browser → folder** UX. It **will not** make **browser → DAW** work on its own. Use **Electron** (Track B) or **native virtualization** (Track C) for true DAW drops. citeturn0search0turn0search8

---

## 11) Where to plug this into your repo

- **Renderer:** keep the auto‑download panel and pre‑warm (`pointerdown`) logic; call the **sync** drag IPC from `dragstart`. fileciteturn1file6turn1file12  
- **Main:** add `startDrag` handler that validates/creates files synchronously; leave advanced native helpers behind a feature flag. fileciteturn1file4  
- **Native (later):** finish `draghelper.swift`/`draghelper.cpp` when you want file‑promise / virtual‑file support. fileciteturn1file0turn1file19

---

## 12) References (selected)

- **Electron native drag:** must call `webContents.startDrag` in response to `ondragstart`. citeturn0search0  
- **Electron needs a real path** (or native virtualization). citeturn0search5  
- **Chrome `DownloadURL` is non‑standard; browser→DAW isn’t supported.** citeturn0search8turn0search3turn0search18  
- **macOS file promises (NSFilePromiseProvider).** citeturn0search1turn0search6  
- **Windows virtual files (FILEDESCRIPTOR/FILECONTENTS).** citeturn0search2turn0search12  
- **Ableton Live + Admin blocks drag/drop.** citeturn0search19turn0search4

---

### Appendix A — Sample WAV header validator (Node)

```ts
import * as fs from 'node:fs';
export function validateWavHeader(p: string) {
  const fd = fs.openSync(p, 'r'); const h = Buffer.alloc(44); fs.readSync(fd, h, 0, 44, 0); fs.closeSync(fd);
  const riff=h.toString('ascii',0,4), wave=h.toString('ascii',8,12), fmt=h.toString('ascii',12,16), data=h.toString('ascii',36,40);
  const audioFmt=h.readUInt16LE(20), ch=h.readUInt16LE(22), sr=h.readUInt32LE(24), bps=h.readUInt16LE(34), size=h.readUInt32LE(40);
  if (riff!=='RIFF'||wave!=='WAVE'||fmt!=='fmt '||data!=='data') return {valid:false,error:'bad header'};
  if (audioFmt!==1) return {valid:false,error:`not PCM: ${audioFmt}`};
  return {valid:true,details:{ch,sr,bps,size}};
}
```

### Appendix B — “Attempt” docs & code you shared

- Attempt reports/log format & checklists. fileciteturn1file5turn1file11  
- Combined implementation and test guide (keep as companion). fileciteturn1file4turn1file8turn1file16  
- Current renderer code paths for auto‑download panel and Electron save. fileciteturn1file6turn1file12  
- Native helper stubs for macOS/Windows virtualization. fileciteturn1file0turn1file14turn1file19

---

**End of guide.**
