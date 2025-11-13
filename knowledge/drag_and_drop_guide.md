# Web → DAW Drag & Drop: Definitive Implementation Guide (Ableton Live, Logic Pro, FL Studio)
> Focus: **drag-and-drop only** (no download-button workflows). Based on DAW + OS drag APIs. Includes Ableton-specific fixes and a ready-to-test plan.

---

## 0) Why Ableton/Logic/FL sometimes ignore your drag
- **DAWs accept OS-native file drops** (real file paths or **file promises**). Browser drags don’t carry a file path; they carry strings/Blobs.
- **Chromium’s `DownloadURL`** enables drag from a web page **to folders/desktop** (browser persists the file), but most DAWs won’t treat this as a drop of an audio file.
- **Therefore:** “Web page → DAW track” needs a **native helper** that starts an **OS-level drag** with paths or file promises.

---

## 1) DAW drop expectations (quick facts)
- **Ableton Live:** Accepts mono/stereo **WAV/AIFF/FLAC/OGG** and common compressed types when dropped **as local files** onto Session/Arrangement or the Live Browser.
- **Logic Pro:** Creating tracks by **dragging audio files** into the Tracks area is a first-class path.
- **FL Studio:** Drag from the **Browser** (OS-backed folders) to **Playlist/Channel**. It consumes OS file paths.

**Takeaway:** A working drop must expose a **real file** to the OS drop target (or promise one).

---

## 2) What to implement (the reliable path)
### 2A) macOS (AppKit) — **File Promise** drag
- Use **`NSFilePromiseProvider`** for each stem to advertise a promised file.
- Provide the correct **UTType** (e.g., WAV `com.microsoft.waveform-audio` or AIFF `public.aiff-audio`).
- Fulfill the promise in the delegate method by **writing the file** to the destination URL after the drop completes.

**Sketch (Swift-like):**
```swift
func beginDrag(stems: [Stem]) {
  let draggingItems: [NSDraggingItem] = stems.map { stem in
    let prov = NSFilePromiseProvider(fileType: "com.microsoft.waveform-audio", delegate: self)
    prov.userInfo = stem // carry metadata to writer
    let item = NSDraggingItem(pasteboardWriter: prov)
    item.setDraggingFrame(CGRect(x:0,y:0,width:1,height:1), contents: nil)
    return item
  }
  view.beginDraggingSession(with: draggingItems, event: currentEvent, source: self)
}

// Promise fulfillment after drop
func filePromiseProvider(_ provider: NSFilePromiseProvider,
                         writePromiseTo url: URL,
                         completionHandler: @escaping (Error?) -> Void) {
  let stem = provider.userInfo as! Stem
  try writePCMtoWAV(stem, to: url) // write valid WAV/AIFF bytes
  completionHandler(nil)
}
```

**Gotchas (macOS):**
- Use the **correct UTI/UTType** so the DAW recognizes the extension (`.wav`/`.aif`).
- Promise **one file per stem**; fulfill fast to avoid target timeouts.
- If using prewritten temp files, you may expose **file URLs** instead of promises.

---

### 2B) Windows — **Paths or Virtual Files**
- **Prewritten files:** expose **`CF_HDROP`** (absolute paths) in the data object.
- **Virtual files (stream-on-drop):** expose **`CFSTR_FILEDESCRIPTORW` + `CFSTR_FILECONTENTS`**. Provide one `IStream` per file index; the DAW reads bytes after the drop.

**Sketch (conceptual C++):**
```cpp
// IDataObject: include CFSTR_FILEDESCRIPTORW (names, sizes) and CFSTR_FILECONTENTS (per-file stream)
FORMATETC fetDesc = { RegisterClipboardFormat(CFSTR_FILEDESCRIPTORW), nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL };
FORMATETC fetCont = { RegisterClipboardFormat(CFSTR_FILECONTENTS),   nullptr, DVASPECT_CONTENT, -1, TYMED_ISTREAM };

// On request for CFSTR_FILECONTENTS with lindex = i:
STGMEDIUM med = { TYMED_ISTREAM };
med.pstm = CreateStreamForStem(i); // stream WAV/AIFF bytes on demand
// Return S_OK
```

**Gotchas (Windows):**
- **Integrity level must match** the DAW (don’t run one as Administrator and the other not).
- Provide **accurate filenames/extensions** (`.wav`/`.aiff`) and sizes when known.
- For multiple stems: one descriptor + one contents stream **per file**.

---

### 2C) Electron/Tauri helper (if you embed a web UI)
- **Electron:** use `webContents.startDrag({ files, icon })` for **prewritten** files. For **virtual** files, call into native modules that implement the Windows/macOS behaviors above (file promises on macOS or virtual-file streams on Windows).
- **Tauri/Native:** start the drag from native code and advertise OS formats as above.

**Renderer→native IPC sketch:**
```js
// renderer (on draggable tile mousedown)
window.api.startNativeDrag({ stemIds: ['kick','bass'] });

// main/native
onStartNativeDrag(({ stemIds }) => {
  const files = materializeToCache(stemIds); // or set up file promises/streams
  win.webContents.startDrag({ files, icon: iconPath });
});
```

---

## 3) Ableton‑specific failures you reported & precise fixes

1) **“Ableton is not receiving the drop at all”**  
   - *Likely cause:* The drag payload is **web-only** (e.g., `DownloadURL`, `text/uri-list`, Blob), not an OS file path/promise.  
   - *Fix:* Start a **native OS drag** (macOS file promise or Windows path/virtual-file formats).

2) **Windows only: drop works into folders, not into Live**  
   - *Likely cause:* Live is running as **Administrator** or helper elevation differs → OS blocks cross‑integrity drag.  
   - *Fix:* Run Live and your helper at the **same privilege level** (prefer **not** elevated).

3) **Drop is accepted but clip shows “file unreadable or corrupt”**  
   - *Likely cause:* WAV/AIFF header invalid (wrong sizes/order, wrong endian), or unsupported channel/layout.  
   - *Fix:* Emit **WAV/AIFF**, mono/stereo, PCM **16/24‑bit** or **32‑float**, with correct RIFF/AIFF chunking. Validate header bytes before you advertise the drag.

4) **Multiple stems: only one appears**  
   - *Likely cause:* Exposed only a single path/descriptor.  
   - *Fix:* Advertise **one item per stem** (one file promise per stem on macOS; one FILEDESCRIPTOR/FILECONTENTS pair per stem on Windows).

5) **Import plays at wrong speed/pitch**  
   - *Likely cause:* Uncommon sample rate (e.g., 24 kHz) triggers auto‑stretch or confusion.  
   - *Fix:* Prefer **44.1 kHz or 48 kHz** for drag targets; ensure headers declare the true sample rate.

6) **Electron helper: drag does nothing**  
   - *Likely cause:* Browser’s own DnD intercepted; or `startDrag` invoked without a valid file path/image.  
   - *Fix:* Call `startDrag` from the **main** process in response to renderer’s `ondragstart`, and provide a valid icon + absolute paths. For virtual files, bridge to native.

---

## 4) Minimal “Always‑Work” Audio Constraints (for drag targets)
- **Container:** WAV or AIFF.
- **Channels:** Mono or stereo (avoid multi‑channel interleaves).
- **Encoding:** PCM **24‑bit** preferred; PCM 16‑bit or 32‑bit float acceptable.
- **Sample rate:** **44.1 kHz or 48 kHz** are the safest defaults.
- **Headers:** Correct `RIFF/WAVE` or AIFF chunk order and sizes; little‑endian for WAV; write data after `fmt ` (WAV).

---

## 5) Tight test plan (to confirm Ableton receives it)
**Platforms:** macOS (latest), Windows (10/11).  
**DAWs:** Ableton Live 11/12, Logic Pro (macOS), FL Studio (Win/macOS).  
**Matrix:** {prewritten paths, macOS file promises, Windows virtual files} × {single, multi} × {short, long} × {44.1/48 kHz}.

**Pass if:**  
- Cursor shows “copy” over DAW target.  
- On drop, the DAW creates a clip/track and reads full audio.  
- No UAC prompt or integrity error (Windows).  
- No stalls/timeouts on virtual streams.  

**Failure triage:**  
- **No drop?** → Ensure OS formats (mac: promise; win: CF_HDROP or virtual).  
- **Rejected/Unreadable?** → Validate headers/bit depth/channels.  
- **Windows only?** → Verify elevation parity.  
- **Multi fails?** → Verify per‑file descriptor/stream or per‑promise item.  

---

## 6) Quick reference (what to Google in your codebase; no links here)
- **macOS:** NSFilePromiseProvider, NSFilePromiseProviderDelegate, UTTypeWAV (`com.microsoft.waveform-audio`), UTTypeAIFF (`public.aiff-audio`).  
- **Windows:** CF_HDROP, CFSTR_FILEDESCRIPTORW, CFSTR_FILECONTENTS, IDataObject, IStream.  
- **Electron:** webContents.startDrag (prewritten files only).  
- **DAW targets:** Ableton Live Session/Arrangement drop, Logic Pro Tracks area drop, FL Studio Playlist/Channel from Browser.

---

## 7) PRD note (format): 
Your current pipeline outputs **24 kHz PCM** before WAV packaging. DAWs can import unusual rates, but for drag‑in reliability and expected pitch/tempo, favor **44.1/48 kHz** at export or in the writer that fulfills file promises.

---

## 8) Final checklist (copy/paste)
- [ ] Ableton receives drag directly (macOS: file promises; Windows: CF_HDROP/virtual).  
- [ ] Windows UAC parity verified (no Admin mismatch).  
- [ ] WAV/AIFF headers validated; mono/stereo; PCM 24‑bit.  
- [ ] Multiple items handled (one promise/descriptor per stem).  
- [ ] Electron/Tauri helper bridges web UI → native drag.  
- [ ] Sample rate typical (44.1/48 kHz).  
- [ ] No download-button workflows used anywhere in this flow.
