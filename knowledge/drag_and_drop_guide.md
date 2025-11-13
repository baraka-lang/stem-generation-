# Web → DAW Drag & Drop: Implementation Guide (Ableton Live, Logic Pro, FL Studio)
Focused strictly on **drag-and-drop** behavior and making it work with DAWs. No links or download-button recommendations included.

---

## 1) Reality of Drag & Drop into DAWs
- DAWs generally accept **OS-native file drops**—that is, drops that resolve to **real file paths** on disk (Windows: CF_HDROP or virtual-file formats; macOS: file URLs or **file promises**).
- Browsers **cannot** expose real filesystem paths to other apps for security reasons. So, to enable “drag directly into DAWs,” you need either:
  - A **native bridge** (desktop helper app) that performs an OS-native drag with file paths or file promises.
  - Or a **two-step drag**: drag from the web page **to an OS folder** (Chromium-only feature), then drag from that folder into the DAW. (Still drag-based; no buttons required.)

**Implication:** For one-step “web → DAW” drops, plan to use a **native helper** (Electron/Tauri/native) or a **DAW plug‑in**. For two-step “drag only,” rely on **drag-to-OS** followed by **drag into DAW**.

---

## 2) Browser-side Drag Payloads (what the DAW will see)
- **Standard drag types** (`text/plain`, `text/uri-list`, custom MIME) are **not** recognized by DAWs as audio content drops.
- Chromium supports a non-standard drag type **`DownloadURL`** with payload format:  
  `"<MIME type>:<filename>:<file-url>"`  
  This enables **dragging from the page to a desktop/folder**; the browser handles persistence. **Most DAWs won’t accept this payload directly**, but it’s useful for a *drag-only* path to disk before dragging into the DAW.
- **Firefox/Safari** do not support `DownloadURL` for drag-out. Plan fallbacks.

**Takeaway:** Browser-only drags rarely land in DAWs. Use **`DownloadURL`** for drag-to-OS (Chromium), or use a **native bridge** for DAW‑target drops.

---

## 3) Native Bridge Patterns (to make DAW drops work)
### 3A) Windows (Explorer/DAW targets)
- **Existing files:** Provide **`CF_HDROP`** (a list of absolute paths). DAWs read the paths and import.
- **Virtual/streamed files:** Provide **`CFSTR_FILEDESCRIPTOR` + `CFSTR_FILECONTENTS`** to present files that don’t exist yet. Each descriptor names a file; the contents stream via `IStream` on demand. This avoids temp files while still presenting as files to the drop target.
- **Drop effects:** Prefer `DROPEFFECT_COPY`. Avoid `MOVE` semantics for media import UX.

**Minimal flow (pseudo-code):**
```
onDragStart() {
  if (haveRealFiles) {
    dataObject.addFormat(CF_HDROP, arrayOfAbsolutePaths);  // e.g., C:\Users\...\stem.wav
  } else {
    for (each virtualItem i) {
      dataObject.addFormat(CFSTR_FILEDESCRIPTOR, descriptorFor(i)); // name, size if known
      dataObject.addFormat(CFSTR_FILECONTENTS, streamProviderFor(i)); // IStream, lazy
    }
  }
  DoDragDrop(dataObject, DROPEFFECT_COPY);
}
```

**Quality tips (Win):**
- Populate correct filenames and extensions (`.wav`, `.aiff`).
- If using virtual files, support multiple items (one `FILECONTENTS` per file, indexed by the descriptor).
- Ensure thread apartments and COM initialization are correct; render contents **only** after drop for performance.

### 3B) macOS (Finder/DAW targets)
- **Existing files:** Expose **file URLs** on the pasteboard (NSPasteboardTypeFileURL).
- **Virtual/streamed files:** Use **`NSFilePromiseProvider`** (a “file promise”) so the drop target can request the file; your app writes it to the provided destination on demand.
- **Drop operations:** Prefer `.copy`. Ensure your promise provider writes valid files *quickly* on fulfillment.

**Minimal flow (Swift-ish pseudo-code):**
```
func draggingSession(for items: [DragItem]) -> NSDraggingSession {
  let pb = NSPasteboard.general
  pb.clearContents()
  for item in items {
    if item.isRealFile {
      pb.write(FileURL(item.absolutePath))
    } else {
      let promise = NSFilePromiseProvider(fileType: "wav", delegate: self)
      promise.userInfo = item // to render later
      pb.writeObjects([promise])
    }
  }
  return beginDraggingSession(with: pb.readObjects(), event: event, source: self)
}

// Delegate: called after drop; write the file to requested URL
func filePromiseProvider(_ provider: NSFilePromiseProvider, writePromiseTo url: URL, completionHandler: @escaping (Error?) -> Void) {
  renderAndWrite(item: provider.userInfo, to: url) // write .wav contents
  completionHandler(nil)
}
```

**Quality tips (macOS):**
- Use the correct UTI/UTType (“wav”/“aiff”).  
- Make sure the promise is fulfilled **fast**; DAWs may time out on slow providers.
- If you materialize temp files, clean them up after import completes.

### 3C) Electron/Tauri helpers (cross‑platform shell)
- **Electron:** Use `webContents.startDrag({ file, icon })` for **existing** files. For **virtual** files, materialize into a cache first or implement OS‑native bridges (Windows: CF_HDROP or FILEDESCRIPTOR/FILECONTENTS; macOS: file promises).
- **Tauri/Native:** Expose OS‑level drags via a plugin/sidecar that creates paths or promises and starts the drag from native code.

**Note:** DAWs expect **file-like** drops. If your helper only sets web drag data (e.g., `text/uri-list`), drops will fail.

---

## 4) DAW Expectations (drag targets)
- **Ableton Live:** Accepts drops of **local audio files** (WAV, AIFF, FLAC, OGG; mono/stereo; common bit depths/rates) onto Session/Arrangement.
- **Logic Pro:** Supports creating tracks by **dragging audio files** into the Tracks area.
- **FL Studio:** Drag from its **Browser** (which reflects OS folders) into Playlist/Channel Rack. It consumes **file paths** from the OS.

**Practical read:** DAWs act like standard OS drag targets expecting **file paths or file promises**, not browser-only MIME payloads.

---

## 5) Cross‑Browser Drag‑Out Support (sender behavior)
- **Chromium (Chrome/Edge):** Supports non‑standard **`DownloadURL`** for **drag to OS folder/desktop**. Useful for a drag‑only path to disk; most DAWs won’t accept it directly.
- **Safari/Firefox:** Do not support `DownloadURL` for drag‑out. Browser‑only drag into DAWs is typically not viable.

**Payload hygiene (web):**
```
el.draggable = true;
el.addEventListener('dragstart', (e) => {
  // Use only if targeting a desktop/folder drop in Chromium:
  e.dataTransfer.setData('DownloadURL', `audio/wav:my_stem.wav:${makeHrefForThisStem()}`);
  e.dataTransfer.effectAllowed = 'copy';
});
```
(Use a stable href; avoid enormous data URIs. Do not expect DAWs to accept this payload.)

---

## 6) Failure Modes & Drag‑Specific Fixes
1) **Drop into DAW does nothing**  
   - Cause: DAW expects OS file paths/promises; browser sent web-only payload.  
   - Fix: Use a **native bridge** to emit file paths (Win: `CF_HDROP` or file promises; macOS: file promises or file URLs).

2) **Windows: drag works between some apps but not to DAW**  
   - Cause: App privilege mismatch (DAW “Run as administrator”) or wrong formats.  
   - Fix: Run at the same privilege level; provide `CF_HDROP` (existing) or FILEDESCRIPTOR/FILECONTENTS (virtual).

3) **macOS: drop cursor shows “not allowed” over DAW**  
   - Cause: Pasteboard items don’t include file URLs or file promises for supported types.  
   - Fix: Provide `NSFilePromiseProvider` with correct UTI (“wav”, “aiff”) or write temporary files and expose file URLs.

4) **Drop starts but import fails with “file unreadable/corrupt”**  
   - Cause: The payload delivered a file path, but the file contents are invalid or incomplete.  
   - Fix: Ensure your encoder writes valid **WAV/AIFF** (PCM 16/24‑bit or 32‑bit float; correct RIFF chunk order and sizes).

5) **Large/virtual files cause stalls**  
   - Cause: Rendering contents during the drag loop.  
   - Fix: Defer heavy work until **after drop** (Win: stream via `IStream` when `CFSTR_FILECONTENTS` is requested; macOS: fulfill file promise on callback).

6) **Multiple items dropped but only one appears**  
   - Cause: Not providing one `FILECONTENTS` per descriptor (Win) or not writing each promised file (macOS).  
   - Fix: Index descriptors and fulfill each file separately.

7) **DAW imports with wrong pitch/tempo after drop**  
   - Cause: Sample rate mismatch or DAW time‑stretching.  
   - Fix: Export stems at **44.1 kHz or 48 kHz**, set correct headers; remind users to check warp/time‑stretch settings.

8) **Path/filename edge cases**  
   - Cause: Unsupported characters or extreme path length (especially on Windows).  
   - Fix: Use ASCII‑friendly names, short paths, and proper extensions (`.wav`, `.aiff`).

---

## 7) Minimal Test Plan (drag-only)
- **Matrix:** {Windows, macOS} × {Chrome, Edge, Safari, Firefox} × {Ableton Live, Logic Pro, FL Studio}
- **Senders:** Web page (Chromium `DownloadURL`), Native helper (Electron/Tauri), Pure native (Win/macOS test host).
- **Targets:** DAW track views, DAW browsers, OS desktop/folder.
- **Cases:** Single file, multiple files, real files, virtual files (streamed), long filenames, large files (>500 MB), odd sample rates.
- **Pass if:** Drop accepted and clip appears; audio decodes and plays; no orphan temp files; no stalls/timeouts.

---

## 8) Reference Snippets (drag-focused)
**Electron (existing files):**
```ts
// In renderer
tile.addEventListener('dragstart', () => window.electron.startDrag('/absolute/path/stem.wav'));

// In main
ipcMain.handle('startDrag', (e, filePath) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win.webContents.startDrag({ file: filePath, icon: '/path/to/icon.png' });
});
```

**Windows (virtual files, conceptual):**
```cpp
// Build IDataObject with both formats for N files:
AddFormat(CFSTR_FILEDESCRIPTOR, descriptors[N]); // names, sizes, attributes
for (i in files) {
  AddFormatIndexed(CFSTR_FILECONTENTS, i, IStreamProvider(files[i])); // stream on request
}
DoDragDrop(dataObject, DROPEFFECT_COPY);
```

**macOS (file promises, conceptual):**
```swift
let promise = NSFilePromiseProvider(fileType: "wav", delegate: self)
promise.userInfo = model   // info to render on fulfillment
pasteboard.writeObjects([promise])

// On fulfillment after drop:
func filePromiseProvider(_ provider: NSFilePromiseProvider,
                         writePromiseTo dst: URL,
                         completionHandler: @escaping (Error?) -> Void) {
  try writeWav(model: provider.userInfo, to: dst)
  completionHandler(nil)
}
```

---

## 9) Final Checklist (drag-only readiness)
- [ ] Ableton/Logic/FL accept the drop of your stems from **OS-level paths or file promises**.
- [ ] **Windows:** CF_HDROP for existing files; FILEDESCRIPTOR/FILECONTENTS for virtual files; `DROPEFFECT_COPY` set.
- [ ] **macOS:** File URLs or `NSFilePromiseProvider` provided with correct UTTypes; fulfillment is fast and reliable.
- [ ] **Chromium drag-to-OS:** `DownloadURL` payload works to folders/desktop (for a drag-only path to disk).
- [ ] **Firefox/Safari:** Verified behavior and communicated limitations; alternative drag route available.
- [ ] **RIFF/AIFF correctness:** Headers valid; mono/stereo; PCM 16/24‑bit or 32‑bit float; typical rates 44.1/48 kHz.
- [ ] **Multiple files:** All items materialize/import; indices match; names/extensions correct.
- [ ] **No privilege mismatches:** Drag works when DAWs are not elevated differently than the sender.
- [ ] **Cleanup:** Temp/cache files cleaned after successful import.
