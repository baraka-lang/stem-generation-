# Quick Start Guide - Ableton Live Drag and Drop Fix

## The Problem
Dragging audio stems from the web browser into Ableton Live doesn't work because browsers can't provide real file paths to other applications.

## The Solution
We've created an Electron desktop app that provides native drag and drop support.

## Setup (5 minutes)

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Build the Web App
```bash
npm run build
```

### Step 3: Launch Electron App
```bash
npm run electron
```

That's it! The app will open in a desktop window.

## Using Drag and Drop with Ableton Live

1. **Generate Audio**: Create stems in the app as usual
2. **Wait for Ready**: The drag button becomes enabled when audio is prepared
3. **Open Ableton**: Launch Ableton Live
4. **Drag**: Click and hold the "Drag & Drop" button, then drag into an Ableton track
5. **Drop**: Release the mouse over the track
6. **Success**: The audio file imports automatically!

## Development Mode

If you're developing the app:

```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Start Electron (hot reload enabled)
npm run electron:dev
```

## Testing

To verify it works:

1. Generate a kick drum stem
2. Open Ableton Live
3. Create an audio track
4. Drag the stem from the app
5. Drop it onto the track
6. You should hear the audio play in Ableton

## Troubleshooting

### "Drag data not ready" message
- Wait a moment after generation
- The button will become fully enabled when ready
- Pre-computation happens in the background

### Cursor shows "not allowed" over Ableton
- Verify you're running the Electron app (not browser)
- Check that audio generated successfully
- Ensure Ableton is not running as administrator

### Electron won't start
```bash
# Rebuild everything
rm -rf node_modules
npm install
npm run build
npm run electron
```

### Files not cleaning up
Temporary files are in:
- macOS/Linux: `/tmp/343labs-stems/`
- Windows: `%TEMP%\343labs-stems\`

Cleanup happens automatically after 5 seconds.

## Browser Fallback

If you run in a regular browser (not Electron):
- Drag to desktop works (Chromium only)
- Then drag from desktop into Ableton
- Not ideal, but it works as a backup

## What's Next?

Once this works, you can:
- Build distributable apps: `npm run electron:build`
- Customize the app in `electron-main.js`
- Add more features to the drag system

## Need More Help?

See full documentation:
- `README_ELECTRON.md` - Complete Electron guide
- `ELECTRON_DAW_INTEGRATION.md` - Technical details
- `knowledge/drag_and_drop_guide.md` - Deep dive

## Summary

**Before**: Web → Ableton = Doesn't work
**After**: Electron App → Ableton = Works perfectly!

The Electron wrapper creates real files that DAWs can recognize and import.
