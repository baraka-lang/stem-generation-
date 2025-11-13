# Web → DAW Drag & Drop with ElevenLabs Music API
Focus: **drag-and-drop only** (no download-button workflows), optimized for **ElevenLabs Music API** formats. Ensures you use the **best WAV format the API actually supports**—not a “better” one the API can’t produce.

---

## 0) What matters for Drag & Drop into DAWs
- **DAWs accept OS-native file drops** (real file paths or **file promises**), not browser-only payloads.
- To drag **directly into Ableton/Logic/FL**, originate the drag from a **native context**:
  - **macOS:** `NSFilePromiseProvider` (file promises) or file URLs.
  - **Windows:** `CF_HDROP` (existing files) or `CFSTR_FILEDESCRIPTOR` + `CFSTR_FILECONTENTS` (virtual files).
- Browser-only drags (`text/uri-list`, custom MIME, Chromium `DownloadURL`) are **not** interpreted by DAWs as audio file drops.

---

## 1) ElevenLabs Music API formats you should target
- **Default from Music API is typically MP3** (44.1 kHz, various bitrates). For drag into DAWs, prefer uncompressed WAV if your plan & endpoint support PCM.
- **PCM (S16LE) sample-rate options known across endpoints:** `16k`, `22.05k`, `24k`, `44.1k`.
- **Best WAV target that the Music API can actually output today:** **WAV (PCM S16LE, 44.1 kHz)** — when your plan & endpoint allow PCM 44.1 kHz.
- **Fallbacks (still supported by the API):** **WAV (PCM S16LE, 24 kHz)** → **22.05 kHz** → **16 kHz**.
- **Do *not* up-spec** to 48 kHz, 24‑bit, or float WAV if the API didn’t output those; wrap what you got into a WAV container without changing sample rate or bit depth.

> **Decision rule** (formats-safe): Try `pcm_44100` first; if rejected due to plan/endpoint limits, fall back to `pcm_24000`, then `pcm_22050`, then `pcm_16000`.

---

## 2) Requesting the correct ElevenLabs output (Music API)
- Use the Music API’s output format parameter (commonly named `output_format`) with one of:
  - `pcm_44100`  → WAV (S16LE, 44.1 kHz) once wrapped.
  - `pcm_24000`  → WAV (S16LE, 24 kHz) once wrapped.
  - `pcm_22050`  → WAV (S16LE, 22.05 kHz) once wrapped.
  - `pcm_16000`  → WAV (S16LE, 16 kHz) once wrapped.
- If your current plan doesn’t permit `pcm_44100`, the API will return an error. Catch it and **retry with the next fallback**.
- If you must use MP3 from the API, you can still drag into DAWs, but WAV reduces misreads and decoding delays during import.

**Pseudocode (Node/TS):**
```ts
const preferred = ["pcm_44100", "pcm_24000", "pcm_22050", "pcm_16000"]; // formats the API supports
async function requestMusicPCM(api, payload) {
  for (const fmt of preferred) {
    try {
      const res = await api.music.compose({ ...payload, output_format: fmt });
      if (res.ok) return { fmt, pcm: await res.arrayBuffer() };
    } catch (e) {
      if (!isFormatError(e)) throw e; // only fall back on known format/tier errors
    }
  }
  throw new Error("No supported PCM format available for this account/endpoint.");
}
```

---

## 3) Wrap ElevenLabs PCM (S16LE) into a WAV container (no re-encode)
> The API’s PCM is **already 16-bit little-endian**. Just **add a correct WAV header**; do not change sample rate or bit depth.

**Browser/Node (TypeScript):**
```ts
function pcm16leToWav(pcm: ArrayBuffer, sampleRate: number, numChannels = 2): ArrayBuffer {
  const pcmBytes = new Uint8Array(pcm);
  const blockAlign = numChannels * 2; // 16-bit
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBytes.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");

  // fmt  chunk (PCM)
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);        // chunk size
  view.setUint16(20, 1, true);         // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);        // 16-bit

  // data chunk
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcmBytes);
  return buffer;

  function writeStr(dv: DataView, offset: number, s: string) {
    for (let i = 0; i < s.length; i++) dv.setUint8(offset + i, s.charCodeAt(i));
  }
}
```

**Channel count:** If the API returns stereo (most music use-cases), pass `numChannels = 2`. If you *know* it’s mono, pass `1`.

---

## 4) Native drag that DAWs accept
### macOS (AppKit)
- Use **`NSFilePromiseProvider`**. For each stem, advertise a promised file with UTI/UTType for WAV (e.g., `com.microsoft.waveform-audio`).
- On fulfillment, **write the WAV bytes** you wrapped from PCM to the provided destination URL.
- Provide one promise **per stem**; fulfill quickly to avoid DAW timeouts.

**Sketch:**
```swift
let promise = NSFilePromiseProvider(fileType: "com.microsoft.waveform-audio", delegate: self)
promise.userInfo = StemMeta(fmt:"pcm_24000", sr:24000, ch:2, bytes: pcmData)
pasteboard.writeObjects([promise])

func filePromiseProvider(_ provider: NSFilePromiseProvider, writePromiseTo dst: URL, completionHandler: @escaping (Error?) -> Void) {
  let m = provider.userInfo as! StemMeta
  let wav = pcm16leToWav(m.bytes, sampleRate: m.sr, numChannels: m.ch)
  try Data(wav).write(to: dst) // e.g., name.wav
  completionHandler(nil)
}
```

### Windows
- **Existing files:** Expose **`CF_HDROP`** with absolute paths to your materialized WAVs.
- **Virtual files (no temp files):** Expose **`CFSTR_FILEDESCRIPTORW`** (names/sizes) + **`CFSTR_FILECONTENTS`** (one `IStream` per file index). Stream WAV bytes **after** the drop is accepted.
- Use `DROPEFFECT_COPY`. Provide **one descriptor + stream per stem**.

**Conceptual flow:**
```
IDataObject:
  - CFSTR_FILEDESCRIPTORW  -> [ { name:"kick.wav", size:N }, ... ]
  - CFSTR_FILECONTENTS[i]  -> IStream that writes the WAV for index i on demand
DoDragDrop(dataObject, DROPEFFECT_COPY)
```

### Electron/Tauri helpers
- **Electron:** For prewritten files, `webContents.startDrag({ file, icon })`. For virtual files, bridge to native code that implements the macOS/Windows behaviors above.
- **Tauri/Native:** Start the drag from native; advertise file promises (macOS) or virtual files (Windows), or materialize to a cache and use normal paths.

---

## 5) Ableton‑focused failure ladder (formats‑safe)
1) **Nothing happens on drop** → Your payload isn’t an OS file/path/promise. Use native drag (above).  
2) **Windows only, no drop** → Live elevated as Admin; your app not → OS blocks the drag. Run at the **same integrity level**.  
3) **Clip appears but unreadable/corrupt** → WAV header wrong or data not S16LE. Wrap PCM correctly; don’t convert to float/24‑bit.  
4) **Wrong speed/pitch** → You upsampled or mismatched rates. Keep the **API’s rate**; use PCM `44100` only if your plan/endpoint supports it; otherwise keep `24000/22050/16000` exactly.  
5) **Multi‑stem drop yields one file** → Provide **one promise/descriptor per stem**.  
6) **Laggy import** → You’re rendering audio during drag. Defer heavy work to **after drop** (fulfill streams/promises then).

---

## 6) QA checklist (ElevenLabs‑aligned)
- [ ] Output format requested from API is **PCM S16LE** at **44100** if permitted; else **24000 → 22050 → 16000**.
- [ ] WAV header wraps PCM with **no re-encode**; `fmt ` precedes `data`; sizes correct; little-endian.
- [ ] **Channel count** matches what the API produced (mono or stereo).
- [ ] **macOS:** `NSFilePromiseProvider` used; UTType for WAV set; fulfillment writes bytes fast.
- [ ] **Windows:** `CF_HDROP` or virtual-file pair (descriptor/contents) used; one stream per file.
- [ ] **Electron/Tauri:** Drag originates from native; prewritten cache or virtual delivery implemented.
- [ ] **Windows UAC parity** verified (no Admin mismatch).

---

## 7) Implementation hints (practical)
- Keep filenames short, ASCII-safe, with stem roles (`song_120bpm_kick.wav`).
- If you cache files, clean up after successful drops.
- If you must offer multiple rates for user choice, label them clearly by **source rate** (e.g., “WAV 24 kHz (source)”, “WAV 44.1 kHz (Pro)”). For drag reliability, **do not resample** on the fly unless required by your pipeline.
- **Browser bridge:** When you cannot access OS drag APIs (plain Chrome), ask the user for a destination folder via the File System Access API and pre-write every new stem there. When Chrome/Edge expose the File System Access drag-out API, attach the saved `FileSystemFileHandle` to the drag payload so Ableton/Logic treat it like a Finder/Explorer file.
- **Consent flow:** Cache the directory handle in IndexedDB after the first approval so the “DAW Drop Helper” toggle comes back automatically on reload.
- **Deduplicate writes:** Track the PCM timestamp per stem so you only write each stem once per version instead of hammering the disk while the user experiments with drag.

---

## 8) PRD alignment note
Your current pipeline outputs **PCM 24 kHz** → WAV. That’s valid for DAWs. If your plan allows `pcm_44100` on the Music API, prefer it; else keep **24 kHz** and document that it’s intentional.
