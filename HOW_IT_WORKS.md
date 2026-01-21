# How Ableton Live Drag and Drop Works

## Visual Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     343 Labs Music Studio                        │
│                        (Electron App)                            │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────┐
        │                                          │
        │  USER GENERATES AUDIO STEM               │
        │  (Kick, Bass, Melody, etc.)              │
        │                                          │
        └──────────────────────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────┐
        │                                          │
        │  WAV ENCODER (Web Worker)                │
        │  • 16-bit PCM format                     │
        │  • Proper RIFF headers                   │
        │  • Non-blocking encoding                 │
        │                                          │
        └──────────────────────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────┐
        │                                          │
        │  PRE-COMPUTATION (Background)            │
        │  • Create WAV blob                       │
        │  • Generate data URI                     │
        │  • Cache in memory (50MB limit)          │
        │                                          │
        └──────────────────────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────┐
        │                                          │
        │  DRAG BUTTON ENABLED                     │
        │  User clicks and drags                   │
        │                                          │
        └──────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    ELECTRON DETECTION CHECK                          │
│                                                                      │
│  Is window.electronAPI defined?                                     │
│                                                                      │
│         YES (Electron)              NO (Browser)                     │
│              ↓                           ↓                           │
│    ┌─────────────────────┐    ┌─────────────────────┐              │
│    │  NATIVE DRAG        │    │  BROWSER DRAG       │              │
│    │  (Recommended)      │    │  (Fallback)         │              │
│    └─────────────────────┘    └─────────────────────┘              │
└──────────────────────────────────────────────────────────────────────┘
              │                            │
              ▼                            ▼
   ┌──────────────────────┐    ┌──────────────────────┐
   │  IPC TO MAIN         │    │  DownloadURL         │
   │  PROCESS             │    │  DataTransfer API    │
   │                      │    │  (Chromium only)     │
   │  Send blob + name    │    │                      │
   └──────────────────────┘    └──────────────────────┘
              │                            │
              ▼                            ▼
   ┌──────────────────────┐    ┌──────────────────────┐
   │  MATERIALIZE FILE    │    │  DRAG TO DESKTOP     │
   │                      │    │  (2-step process)    │
   │  1. Convert to       │    │                      │
   │     Buffer           │    │  Then drag from      │
   │  2. Write to temp:   │    │  desktop to DAW      │
   │     /tmp/343labs/    │    │                      │
   │     stem.wav         │    └──────────────────────┘
   └──────────────────────┘
              │
              ▼
   ┌──────────────────────┐
   │  START NATIVE DRAG   │
   │                      │
   │  Windows:            │
   │    CF_HDROP with     │
   │    file path         │
   │                      │
   │  macOS:              │
   │    File URL with     │
   │    real path         │
   └──────────────────────┘
              │
              ▼
   ┌──────────────────────┐
   │  USER DRAGS OVER     │
   │  ABLETON LIVE        │
   │                      │
   │  DAW recognizes      │
   │  real file path      │
   └──────────────────────┘
              │
              ▼
   ┌──────────────────────┐
   │  USER DROPS          │
   │                      │
   │  Ableton reads       │
   │  file from disk      │
   │  and imports audio   │
   └──────────────────────┘
              │
              ▼
   ┌──────────────────────┐
   │  ✓ AUDIO IMPORTED    │
   │                      │
   │  Plays in DAW track  │
   └──────────────────────┘
              │
              ▼
   ┌──────────────────────┐
   │  CLEANUP (5 sec)     │
   │                      │
   │  Delete temp file    │
   │  from /tmp/          │
   └──────────────────────┘
```

## Key Components

### 1. Web App (Renderer Process)
- Runs your web interface
- Detects Electron environment
- Handles user interactions
- Pre-computes audio data

### 2. Electron Main Process
- Manages OS-level operations
- Creates temporary files
- Initiates native drag
- Handles cleanup

### 3. IPC Bridge (Preload Script)
- Securely exposes APIs
- Transfers data between processes
- Maintains context isolation

### 4. Native Drag System
- **Windows**: Uses `CF_HDROP` (file path list)
- **macOS**: Uses file URLs
- **Linux**: Standard file drag protocol

## Why It Works

### Before (Browser Only)
```
Browser → DownloadURL/DataURI → Ableton ❌
                                   ↑
                         "I don't understand
                          this web format!"
```

### After (Electron)
```
Electron → Real File Path → Ableton ✅
                                ↑
                      "Great! I can read
                       this file from disk!"
```

## The Secret Sauce

The key insight from `knowledge/drag_and_drop_guide.md`:

> DAWs act like standard OS drag targets expecting **file paths or file promises**, not browser-only MIME payloads.

Electron bridges this gap by:
1. Creating an actual file on disk
2. Providing the OS-native file path
3. Making the DAW think it's a normal file drag

## Performance

### Pre-computation Strategy
```
Generation → Encoding → Caching → Drag
   (5s)        (200ms)    (100ms)   (instant)

Total user wait: ~5 seconds after generation
Drag initiation: <5ms (already cached)
```

### Memory Management
- WAV blobs cached up to 50MB
- Automatic eviction of oldest entries
- Temp files deleted after 5 seconds
- No permanent disk usage

## Security

### Context Isolation
```
Renderer Process          Main Process
    (Web App)      ←IPC→   (Electron)
                     ↑
              contextBridge
           (only safe APIs)
```

The renderer cannot:
- Access Node.js directly
- Read arbitrary files
- Execute system commands

The renderer can only:
- Call `startNativeDrag()`
- Check `isElectron()`
- Get platform info

## Platform Differences

### macOS
```
webContents.startDrag({
  file: '/tmp/343labs-stems/kick_130bpm_Dmin.wav'
})

→ OS provides file:// URL to Ableton
→ Ableton reads from path
→ Import succeeds ✓
```

### Windows
```
webContents.startDrag({
  file: 'C:\\Temp\\343labs-stems\\kick_130bpm_Dmin.wav'
})

→ OS provides CF_HDROP with path
→ Ableton reads from path
→ Import succeeds ✓
```

### Linux
```
webContents.startDrag({
  file: '/tmp/343labs-stems/kick_130bpm_Dmin.wav'
})

→ OS provides file URI
→ Compatible DAW (Bitwig, Reaper) imports
→ Import succeeds ✓
```

## Troubleshooting Flow

```
Drag doesn't work?
    ↓
Check: Running Electron app? (not browser)
    ↓ YES
Check: Audio generated successfully?
    ↓ YES
Check: Drag button enabled?
    ↓ YES
Check: Console shows "Native drag started"?
    ↓ YES
Check: Temp file created in /tmp/343labs-stems/?
    ↓ YES
Check: DAW is not elevated/admin?
    ↓ YES
→ Should work! Try dragging to desktop first to verify file.
```

## Future Enhancements

### macOS Native (File Promises)
```
Instead of:  Write file → Drag → DAW reads
Do:          Drag → DAW requests → Write on demand

Benefits:
- No temporary files
- Faster drag start
- Lower disk usage
```

### Windows Native (IDataObject)
```
Instead of:  Write file → Drag → DAW reads
Do:          Drag → DAW streams → Write via IStream

Benefits:
- Virtual file presentation
- On-demand rendering
- Better memory efficiency
```

## Learn More

- **Technical Deep Dive**: See `ELECTRON_DAW_INTEGRATION.md`
- **Implementation Guide**: See `knowledge/drag_and_drop_guide.md`
- **Quick Setup**: See `QUICK_START.md`

---

**The Bottom Line**: Electron creates real files that DAWs understand, solving the browser security limitation that prevents direct drag and drop.
