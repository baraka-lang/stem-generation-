# DAW_DRAG_DROP_IMPLEMENTATION.md

## Summary

You’re using an **auto‑save to a user‑chosen folder** and then letting users **drag from your UI**. Dragging into **Explorer/Finder works**, but **Ableton/other DAWs reject the drop**. This document replaces the previous guide with fixes that restore reliability for Ableton, Logic Pro, and FL Studio while keeping the auto‑save workflow.

**Key outcome:** DAWs only accept **OS‑level file drops** (real file paths or file promises). A browser‑origin drag, even if the file is already saved to disk, still doesn’t carry an OS file path. To make “drag from our UI → into DAW” dependable, you must originate the drag from a **native context** (Electron/Tauri/native) *or* ensure the user’s drag originates from **Explorer/Finder/DAW Browser**. The sections below make the auto‑save path robust, add native drag where possible, and document Ableton‑specific pitfalls that commonly break mid‑project.

---

## 1) Root‑cause recap (why it worked briefly, then failed)

1. **Browser drags don’t include OS file paths.** DAWs (Live/Logic/FL) expect drops that resolve to a **local file path** or a **file promise**. Browser data payloads (including Chromium’s `DownloadURL`) are generally ignored by DAWs. citeturn0search12  
2. **If the file wasn’t fully materialized/closed before the drop, DAWs reject it.** Switching from a synchronous to an async write (or starting the drag before the write completes) produces intermittent “works once, then fails” behavior. Use **atomic writes** (temp file → rename) and close descriptors before exposing the path. citeturn2search3turn2search5turn2search16  
3. **Windows “Run as Administrator” breaks drag‑in.** If Live runs elevated and your app/browser doesn’t (or vice‑versa), Windows blocks the drop. citeturn0search16turn0search0

---

## 2) ElevenLabs format policy (formats we actually use)

Your PRD indicates a **24 kHz PCM → WAV** pipeline today. Keep using **exactly what the API returns**; do **not** up‑spec (e.g., to 48 kHz or float). Preferred ladder based on availability/tier:

- **`pcm_44100`** (WAV PCM S16LE 44.1 kHz) — if your account/endpoint permits.  
- **Fallbacks:** `pcm_24000` → `pcm_22050` → `pcm_16000` (all S16LE).  

This matches ElevenLabs’ published PCM options and gating. If 44.1 kHz isn’t allowed on your plan, fall back automatically; **don’t resample** just for drag‑and‑drop. citeturn1search0turn1search6turn1search3  fileciteturn0file0

> **Action:** keep sample rate and bit depth **unchanged** from the API; only **wrap PCM → WAV** at delivery time.

---

## 3) Auto‑save folder flow (browser) — make it robust

This retains your auto‑download to a user‑chosen folder and ensures the file is ready for DAWs **before** users try to drop it.

### 3.1 Save with atomic write semantics
**Node/Electron main (recommended where available):**
```ts
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export async function writeWavAtomic(destPath: string, bytes: Uint8Array) {
  const dir = dirname(destPath);
  const tmp = join(dir, `.part-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  await fs.writeFile(tmp, bytes);
  // Optionally: on some setups you may fsync the temp file and parent dir for extra safety.
  await fs.rename(tmp, destPath); // Atomic on same volume
}
```
Use **temp → rename** so DAWs never see a partially written file. citeturn2search3turn2search5

### 3.2 “Ready to drop” gate in the UI
Only show a “Ready” badge when:
- `stat(size)` > 0 and **no `.part`** file remains,
- last write finished <N> ms ago,
- optional: re‑open/read first bytes (`RIFF`/`WAVE`) as a sanity check.

### 3.3 Drag UX in browser (Chromium)
Keep **drag‑to‑Explorer/Finder** via `DownloadURL` for convenience, but label it clearly as **“Folder only (not DAWs)”**:
```js
tile.draggable = true;
tile.addEventListener('dragstart', (e) => {
  e.dataTransfer.setData('DownloadURL', `audio/wav:${fileName}:${httpsUrl}`);
  e.dataTransfer.effectAllowed = 'copy';
});
```
This is intentionally **not** used for DAW targets. citeturn0search12

### 3.4 One‑click “Open folder” (Electron recommended)
From the browser alone you can’t reliably “reveal in Finder/Explorer.” In Electron, use:
```ts
import { shell } from 'electron';
shell.showItemInFolder(destPath);
```
This gets the user into Explorer/Finder so the drag **originates from the OS**, which DAWs accept.

### 3.5 DAW browser workflows users should prefer
- **Ableton Live:** “Add Folder in Places,” then drag from Live’s Browser. citeturn0search1  
- **Logic Pro:** Drag audio files from Finder into the **Tracks area** (works reliably from OS). citeturn0search6  
- **FL Studio:** Add your folder under **Browser → Extra search folders**; drag from FL’s Browser. citeturn0search7turn0search15

---

## 4) Native drag (for direct UI → DAW)

If you require “drag from our tile straight into DAW,” use a native context to originate the drag with OS‑level file types.

### 4.1 macOS (file promises)
- Use **`NSFilePromiseProvider`** with UTType for WAV (`com.microsoft.waveform-audio`).  
- Fulfill the promise by **wrapping ElevenLabs PCM → WAV** and writing to the destination **after** the drop. citeturn0search2turn0search10

**Sketch:**
```swift
let prov = NSFilePromiseProvider(fileType: "com.microsoft.waveform-audio", delegate: self)
// prov.userInfo carries { bytes, sampleRate, channels, filename }
func filePromiseProvider(_ provider: NSFilePromiseProvider,
                         writePromiseTo dst: URL,
                         completionHandler: @escaping (Error?) -> Void) {
  // Wrap PCM→WAV with the API’s exact sample rate/bit depth; write to dst
  completionHandler(nil)
}
```

### 4.2 Windows (paths or virtual files)
- **Existing files:** advertise **`CF_HDROP`** (absolute paths).  
- **Virtual files:** advertise **`CFSTR_FILEDESCRIPTORW` + `CFSTR_FILECONTENTS`**; stream WAV bytes on demand (one stream per item). citeturn0search3

### 4.3 Electron bridge
- Prewritten files: `webContents.startDrag({ file, icon })` from **main** in response to renderer’s dragstart. citeturn0search5  
- Virtual files/file promises: bridge to native (macOS/Windows) as in 4.1/4.2.

---

## 5) Ableton‑specific fixes (these often cause regressions)

1) **Windows elevation mismatch** → Disable “Run as administrator” for Live, or run both at the same level. citeturn0search16turn0search0  
2) **File not fully written** → Use atomic write (temp → rename). Don’t start drag until the rename has completed. citeturn2search3  
3) **Wrong/odd headers** → Ensure WAV header is valid (`RIFF/WAVE/fmt /data`), PCM S16LE, channel count matches source. Live supports WAV/AIFF/FLAC/OGG, plus MP3/M4A imports. citeturn0search1  
4) **Massive paths or exotic characters** → Keep filenames ASCII‑safe and paths short (Win long‑path quirks still exist in some setups).  
5) **Cloud‑sync lag** → If saving into a sync folder, wait for the local file to materialize before the user drags.  
6) **Security prompts/locks** → Ensure antivirus or indexing isn’t locking the file during the drop; write then rename to minimize lock time.

---

## 6) ElevenLabs → WAV wrapping (no resample, no re‑encode)

Wrap **exact PCM** bytes into a WAV container at the **moment of fulfillment** (native drag) or when saving to disk (auto‑save).

```ts
export function pcm16leToWav(pcm: ArrayBuffer, sampleRate: number, channels = 2): ArrayBuffer {
  const pcmBytes = new Uint8Array(pcm);
  const blockAlign = channels * 2;
  const byteRate  = sampleRate * blockAlign;
  const dataSize  = pcmBytes.byteLength;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  w(v,0,'RIFF'); v.setUint32(4, 36 + dataSize, true);
  w(v,8,'WAVE'); w(v,12,'fmt '); v.setUint32(16,16,true);
  v.setUint16(20,1,true); v.setUint16(22,channels,true);
  v.setUint32(24,sampleRate,true); v.setUint32(28,byteRate,true);
  v.setUint16(32,blockAlign,true); v.setUint16(34,16,true);
  w(v,36,'data'); v.setUint32(40,dataSize,true);
  new Uint8Array(buf,44).set(pcmBytes);
  return buf; function w(dv: DataView, o: number, s: string){for(let i=0;i<s.length;i++) dv.setUint8(o+i,s.charCodeAt(i));}
}
```

**Format ladder used:** `pcm_44100` → `pcm_24000` → `pcm_22050` → `pcm_16000` (PCM S16LE), matching official docs/tier gating. citeturn1search6turn1search3

---

## 7) Tests to keep it working

### Functional
- **Browser auto‑save → Explorer/Finder drag** works on Chromium; label clearly as “Folders only.” citeturn0search12
- **Explorer/Finder → DAW**: Ableton/Logic/FL accept drop; clip appears and plays. citeturn0search1turn0search6turn0search7
- **Electron native drag (if enabled)**: drag tile → DAW track works on both macOS and Windows. citeturn0search5turn0search2turn0search3

### Reliability
- **Atomic write** verified (no `.part` files; rename completed before drag). citeturn2search3
- **Elevation parity** on Windows verified. citeturn0search16
- **WAV header check** passes for each saved file (quick validator).

---

## 8) Quick WAV header validator (optional guardrail)
```ts
export function isLikelyWav(buf: ArrayBuffer) {
  const v = new DataView(buf);
  const sig = (o: number, s: number) => String.fromCharCode(...Array.from({length:s},(_,i)=>v.getUint8(o+i)));
  try {
    return sig(0,4)==='RIFF' && sig(8,4)==='WAVE' && sig(12,4)==='fmt ' && sig(36,4)==='data';
  } catch { return false; }
}
```

---

## 9) Rollout checklist

- [ ] **ElevenLabs format ladder** in place; no resampling; PCM → WAV wrap only. citeturn1search0  
- [ ] **Atomic writes** (temp → rename); “Ready” badge only after rename. citeturn2search3  
- [ ] **Ableton elevation** parity documented and enforced in troubleshooting. citeturn0search16  
- [ ] **Browser labels** clarify: “Drag to folders only.”  
- [ ] **Explorer/Finder and DAW browser** paths documented (Ableton Places / FL extra folders). citeturn0search1turn0search7  
- [ ] **Electron/native drag** path implemented or feature‑flagged.
- [ ] **WAV validator** on save; channel count matches source; filenames ASCII‑safe.

---

## References

- Ableton Live: **Running as Administrator** blocks drag‑and‑drop; **Supported audio file formats** list. citeturn0search16turn0search0turn0search1  
- Logic Pro: **Create tracks using drag and drop** (Tracks area). citeturn0search6  
- FL Studio: **File/Browser settings** and **adding folders**. citeturn0search7turn0search15  
- Browser DnD: **Drag data store / DownloadURL** (Chromium‑only; folder drops). citeturn0search12  
- macOS native drag: **NSFilePromiseProvider** pattern. citeturn0search2turn0search10  
- Windows native drag: **Shell data scenarios** (CF_HDROP, FILEDESCRIPTOR/FILECONTENTS). citeturn0search3  
- Electron: **webContents.startDrag** (native file drags). citeturn0search5  
- ElevenLabs PCM options & gating; use **PCM S16LE** at **44.1/24/22.05/16 kHz** only. citeturn1search0turn1search6turn1search3  
- Product baseline: **Your PRD** (24 kHz PCM → WAV). fileciteturn0file0
