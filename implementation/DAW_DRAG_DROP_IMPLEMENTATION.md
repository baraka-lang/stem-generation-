# DAW_DRAG_DROP_IMPLEMENTATION.md

> **Scope:** Complete, production‑ready replacement for your drag‑and‑drop implementation doc.  
> **Workflow kept:** *Auto‑save to a user‑chosen folder*, then enable drag‑and‑drop.  
> **Goal:** Make drag from your **app UI** reliable for **Ableton Live, Logic Pro, FL Studio** (and “still OK” for File Explorer/Finder).  
> **Approach:** Treat DAWs as **OS‑native** drop targets (file paths / file promises), **not** as web drops.

---

## 0) Quick diagnosis (why it worked briefly, then failed)

1) **Browser → DAW is not a real file drop.** Browsers set text/URI payloads (or Chrome’s `DownloadURL`) during drag. DAWs expect **OS‑level file paths or file promises**, so they reject these payloads even if a real file exists on disk. Explorer/Finder accept `DownloadURL`, DAWs usually don’t. citeturn1search0turn1search11  
2) **Async timing or half‑written files.** If your drag calls are async (e.g., `ipcRenderer.invoke`) or the file isn’t fully **closed** before the drag starts, DAWs can ignore the drop or report corruption. Use **atomic write** (temp → rename) and **sync** drag prep.  
3) **Windows UAC mismatch.** If Ableton runs **as Administrator** and your app/browser does not (or vice versa), **drag‑and‑drop is blocked** by Windows. citeturn0search0turn0search16

**Bottom line:** Keep auto‑save, but originate the DAW drop from an **OS‑native** context (Electron/Tauri/native). In pure browser mode, support **drag‑to‑folder** only (Chromium), and guide users to drag **from Finder/Explorer or the DAW’s own browser**.

---

## 1) Audio format policy (ElevenLabs‑aligned)

Your PRD indicates a **PCM 24 kHz → WAV** path now; keep the **exact** PCM rate/bit‑depth returned by ElevenLabs—**don’t up‑spec** (e.g., 48 kHz or float) just for DAWs. ElevenLabs currently provides **PCM (S16LE) at 16 k / 22.05 k / 24 k / 44.1 k**, with **44.1 k gated to Pro+** on many endpoints. Use this **fallback ladder** when requesting PCM:  
`pcm_44100 → pcm_24000 → pcm_22050 → pcm_16000`. citeturn3search0turn3search1turn3search4turn3search5turn3search9  Also: PRD confirms the 24 kHz baseline. fileciteturn0file0

**Wrap only, don’t resample:** Wrap the **S16LE PCM** bytes into a WAV container **unchanged**; many “random pitch/tempo” reports stem from silent resampling. (DAWs import WAV/AIFF/FLAC/OGG and also MP3/M4A.) citeturn0search1

---

## 2) Supported flows (what we ship)

### A) Pure‑browser (Chromium): **auto‑save + drag‑to‑folder** (not DAW)
- Use your existing **auto‑save** to a chosen folder (File System Access). citeturn0search3  
- Enable **drag‑to‑folder** from the web UI via **`DownloadURL`**; label it “Folder/Desktop only—DAWs won’t accept.” citeturn1search0turn1search11  
- Provide **“Open Folder”** affordance so users drag from Explorer/Finder/DAW Browser (Ableton **Places**, FL **Browser**). citeturn2search17turn2search18

### B) Electron/Tauri desktop app: **auto‑save + native drag into DAW** ✅
- On **macOS**: use **`NSFilePromiseProvider`** (file promise). Fulfill by writing the exact WAV bytes on drop. citeturn0search4turn0search12  
- On **Windows**: for **existing** files, advertise **`CF_HDROP`**; for **virtual** files, use **`CFSTR_FILEDESCRIPTORW` + `CFSTR_FILECONTENTS`** and stream the WAV bytes. citeturn0search5  
- With **Electron**, call **`webContents.startDrag`** from the **main** process **in direct response to `ondragstart`**. If you need virtual files, bridge to native per OS. citeturn0search6

---

## 3) Implementation details

### 3.1 PCM → WAV wrapper (no re‑encode, no resample)
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

### 3.2 Atomic writes for auto‑save (prevents partial reads)
```ts
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

export async function writeWavAtomic(destPath: string, bytes: Uint8Array) {
  const tmp = join(dirname(destPath), `.part-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, destPath); // atomic on same volume
}
```
**Show “Ready” only after**: no `.part` remains, `stat(size)>0`, and a quick header sanity check (`RIFF/WAVE/fmt /data`).

### 3.3 Browser drag‑to‑folder (Chromium only – clearly labeled)
```js
tile.draggable = true;
tile.addEventListener('dragstart', (e) => {
  e.dataTransfer.setData('DownloadURL', `audio/wav:${fileName}:${httpsUrl}`);
  e.dataTransfer.effectAllowed = 'copy';
});
```
This makes **Explorer/Finder** accept the drag as a **download/save** action. **DAWs generally ignore this type.** citeturn1search11

### 3.4 Electron synchronous native drag (reliable DAW drop)
**Renderer (`ondragstart`) → single sync IPC → Main prepares file *and* calls `startDrag` immediately.**  
This avoids async races where the OS gesture completes before your data exists. citeturn0search6
```ts
// renderer.ts
tile.addEventListener('dragstart', (e) => {
  const ok = window.electron.ipc.sendSync('drag:do', { stemId }); // blocks until main returns
  if (!ok) e.preventDefault();
});

// main.ts
ipcMain.on('drag:do', (ev, { stemId }) => {
  const { filePath, icon } = ensureOnDisk(stemId); // atomic write, close/finalize here
  const win = BrowserWindow.fromWebContents(ev.sender);
  win.webContents.startDrag({ file: filePath, icon });
  ev.returnValue = true;
});
```
**Pre‑warm on `pointerdown`** (optional): if writing time may exceed a few ms, start in advance and only rename during `dragstart`.

### 3.5 macOS native module (file promises)
```swift
let prov = NSFilePromiseProvider(fileType: "com.microsoft.waveform-audio", delegate: self)
// prov.userInfo carries { filename, sampleRate, channels, pcmBytes }
func filePromiseProvider(_ provider: NSFilePromiseProvider,
                         writePromiseTo dst: URL,
                         completionHandler: @escaping (Error?) -> Void) {
  // Wrap ElevenLabs PCM → WAV with the exact source rate (no resample) and write to dst
  completionHandler(nil)
}
```

### 3.6 Windows native module (virtual files)
- Advertise **`CFSTR_FILEDESCRIPTORW`** (one descriptor per file) plus **`CFSTR_FILECONTENTS`** streams (one stream per descriptor).  
- Use **`DROPEFFECT_COPY`**.  
- Stream bytes **after** the drop; do not generate during drag. citeturn0search5

---

## 4) Ableton/Logic/FL expectations (targets)

- **Ableton Live** accepts **local audio files** (WAV/AIFF/FLAC/OGG; MP3/M4A decode on import). Drag‑in fails if Live runs as **Administrator** on Windows. citeturn0search1turn0search0turn0search16  
- **Logic Pro**: Dragging audio files into the **Tracks area** creates tracks or fills samplers. citeturn0search15turn0search7  
- **FL Studio**: Drag from the **FL Browser** (add your auto‑save folder to **Extra search folders**) into Playlist/Channel. citeturn2search17turn2search18

---

## 5) Troubleshooting (field‑tested + community tips)

**Symptoms → Likely cause → Fix**

1) **“Drop does nothing” from app to Live** → Browser payload (`DownloadURL`) or async Electron drag → **Switch to native drag** (sync IPC + `startDrag`). citeturn0search6  
2) **Works in Explorer/Finder but not in Live** → DAW ignores `DownloadURL` → This is **expected**; use native drag or drag from OS/DAW browser. citeturn1search11  
3) **Windows: works once, then stops** → Live or app **elevation mismatch**, Windows policy, or timing → Match privileges (no Admin) and make drag prep **synchronous**. citeturn0search0turn0search16  
4) **“Unreadable/corrupt file”** → Partial write or invalid RIFF → Use **atomic write**, close handles, and validate header.  
5) **Slow/laggy drop** → Rendering during drag → Defer heavy work to **after drop** (file promise / FILECONTENTS stream). citeturn0search4  
6) **Multi‑item drag drops only one** → Only one descriptor/stream → Provide one **promise/descriptor per stem**. citeturn0search5  
7) **Wrong pitch/tempo after import** → Unintended resample or DAW stretch → **Do not resample**; keep ElevenLabs rate and disable/stretch‑aware in DAW.  
8) **Browser drag intermittently breaks** (Chromium) → Recent changes/bugs in `DownloadURL` behavior → Treat as **best‑effort**, never as DAW path. citeturn1search1turn1search5  
9) **Windows drag system glitch** → OS drag corruption (rare) → Some users report a temporary reset via **copy‑paste** or compatibility mode toggles; treat as user‑side workaround only. citeturn2search2turn2search0

---

## 6) QA matrix (run every release)

**Environments:**  
- Windows 10/11 + Live 11/12, FL 21; macOS 13–15 + Live 11/12, Logic 11.x.

**Senders:**  
- Browser (Chromium) → **drag‑to‑folder** only.  
- Electron desktop → **native drag** (paths/virtual/files promises).

**Cases:**  
- **Formats:** `pcm_44100` (if tier allows) → `pcm_24000` → `pcm_22050` → `pcm_16000`. citeturn3search0turn3search1  
- Mono vs stereo; short (<10 MB) vs long (>200 MB); multi‑item drag.  
- Cloud‑sync folders (OneDrive/iCloud) vs local disk.

**Pass if:**  
- Ableton/Logic/FL create clips on drop and play audio; no admin/UAC block; no partials; no stalls.

---

## 7) Developer checklists

### 7.1 Electron native drag (direct UI → DAW)
- [ ] **Sync IPC** in `dragstart` prepares file and calls `startDrag` immediately. citeturn0search6  
- [ ] File on disk is **fully written** (atomic rename) & closed before `startDrag`.  
- [ ] **Windows:** If virtual files, provide **one** descriptor + **one** contents stream per item. citeturn0search5  
- [ ] **macOS:** Use **NSFilePromiseProvider** with WAV UTType and fulfill fast. citeturn0search4  
- [ ] Provide a visible **drag icon** to avoid platform quirks.

### 7.2 Browser auto‑save (folder path UX)
- [ ] “Folder/Desktop only” label shown on drag affordances (Chromium). citeturn1search11  
- [ ] “Open folder” / “Reveal in Finder/Explorer” action available.  
- [ ] Ableton **Places** / FL **Extra folders** setup helper. citeturn2search17turn2search18

### 7.3 Ableton‑specific
- [ ] **Never run Live as Administrator** (and ensure our app isn’t either). citeturn0search0turn0search16  
- [ ] Keep filenames short / ASCII; avoid very long paths.  
- [ ] If using cloud‑sync folders, wait for local write to finish before enabling “Ready”.

---

## 8) Observability (log lines to keep)

- `[FMT] ElevenLabs PCM request -> using {pcm_44100|pcm_24000|...}` (server) citeturn3search1  
- `[SAVE] writeWavAtomic OK path=… size=…` (main)  
- `[DRAG] renderer dragstart (tile=…)` → `[DRAG] main startDrag path=… elapsedMs=…`  
- `[DROP] fulfill promise/stream index=N bytes=… elapsedMs=…` (native)  
- `[WARN] Windows elevation mismatch detected` (helper check) citeturn0search0

---

## 9) References (selected)

- **Ableton Live:** Drag blocked when **run as Administrator**; supported import formats. citeturn0search0turn0search16turn0search1  
- **Logic Pro:** Drag to create tracks / sampler drops. citeturn0search15turn0search7  
- **FL Studio:** Add folders to **Places/Browser** and drag to Playlist/Channel. citeturn2search17turn2search18  
- **Web drag specifics:** MDN **DataTransfer**; **DownloadURL** is Chrome‑specific and not a DAW drop. citeturn1search9turn1search0turn1search11  
- **File System Access (auto‑save):** Chrome developer docs. citeturn0search3  
- **Electron:** `webContents.startDrag` must be called **in `ondragstart`**. citeturn0search6  
- **macOS:** `NSFilePromiseProvider` (file promises). citeturn0search4  
- **Windows:** `CFSTR_FILEDESCRIPTOR(W)` + `CFSTR_FILECONTENTS` (virtual files). citeturn0search5  
- **ElevenLabs:** PCM output & tier gating; keep source rate; fallback ladder. citeturn3search0turn3search1turn3search4turn3search5turn3search9  
- **PRD baseline:** current **24 kHz PCM → WAV** pipeline. fileciteturn0file0
