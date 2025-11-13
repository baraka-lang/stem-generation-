# 343 Labs Music Studio - Electron Edition

## Native DAW Integration for Drag and Drop

This is the Electron-powered desktop version of 343 Labs Music Studio, featuring **native drag and drop** support for professional DAWs like Ableton Live, Logic Pro, and FL Studio.

## Why Electron?

Web browsers cannot provide real file paths to other applications due to security restrictions. This means dragging audio from a web page into DAWs doesn't work properly.

The Electron desktop app solves this by:
- Creating actual files on your file system
- Providing OS-native drag operations
- Ensuring DAWs recognize and import your stems correctly

## Quick Start

### Installation

```bash
# Install dependencies
npm install

# Build the web app
npm run build

# Run the Electron app
npm run electron
```

### Development

```bash
# Terminal 1: Start Vite dev server
npm run dev

# Terminal 2: Start Electron (points to dev server)
npm run electron:dev
```

### Building for Distribution

```bash
# Build for current platform
npm run electron:build

# Build for specific platforms
npm run electron:build:mac     # macOS DMG + ZIP
npm run electron:build:win     # Windows NSIS + Portable
npm run electron:build:linux   # Linux AppImage + DEB
```

## Features

### Native Drag and Drop
- Drag stems directly into Ableton Live, Logic Pro, FL Studio
- Creates real WAV files that DAWs can read
- Automatic cleanup after drag completes
- Works on Windows, macOS, and Linux

### All Web Features Included
- AI-powered techno music generation
- Multi-stem audio workstation
- Real-time waveform visualization
- Volume, EQ, and filter controls
- Take management and history
- Session saving and loading

### Desktop Benefits
- Better performance than browser version
- No CORS or browser security restrictions
- Direct file system access
- Native OS integration

## How It Works

1. Generate audio stems in the app
2. Click and hold the "Drag & Drop" button
3. Drag directly into your DAW
4. The app creates a temporary WAV file
5. Your DAW imports the file automatically
6. Temp file is cleaned up after 5 seconds

## System Requirements

- **Windows**: Windows 10 or later
- **macOS**: macOS 10.13 (High Sierra) or later
- **Linux**: Ubuntu 18.04+ or equivalent

**Recommended**:
- 8GB RAM
- 2GB free disk space
- Audio interface or sound card

## Supported DAWs

Tested and confirmed working with:
- ✅ Ableton Live (11+)
- ✅ Logic Pro (X+)
- ✅ FL Studio (20+)
- ✅ Bitwig Studio
- ✅ Reaper
- ✅ Pro Tools (2020+)

Should work with any DAW that accepts file drag and drop.

## Project Structure

```
343labs-music-studio/
├── electron-main.js           # Electron main process
├── electron-preload.js        # Secure IPC bridge
├── src/                       # Web app source
│   ├── app.js                # Main application logic
│   ├── audioEncoder.js       # WAV encoding
│   └── ...
├── dist/                      # Built web app (after npm run build)
├── electron-dist/             # Packaged Electron apps
└── package.json              # Dependencies and scripts
```

## Configuration

### Environment Variables

Create a `.env` file with:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_ELEVEN_LABS_API_KEY=your_elevenlabs_key
```

These are automatically loaded by the app.

### Build Configuration

Edit `package.json` to customize Electron Builder settings:

```json
"build": {
  "appId": "com.343labs.musicstudio",
  "productName": "343 Labs Music Studio",
  "directories": {
    "output": "electron-dist"
  }
}
```

## Troubleshooting

### Drag and Drop Not Working

**Problem**: Can't drag into DAW

**Solutions**:
1. Make sure you're running the Electron app (not browser)
2. Check console for errors (View → Toggle Developer Tools)
3. Verify audio was generated successfully
4. Try dragging to desktop first to test file creation
5. Ensure DAW is not running as administrator (Windows)

### Audio Won't Generate

**Problem**: Generation fails or times out

**Solutions**:
1. Check your API keys in `.env` file
2. Verify internet connection
3. Look for error messages in console
4. Check ElevenLabs API quota/limits

### App Won't Start

**Problem**: Electron window doesn't open

**Solutions**:
1. Run `npm install` to ensure all dependencies installed
2. Run `npm run build` to build the web app first
3. Check for port conflicts (default: 5173 for dev)
4. Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`

### Build Fails

**Problem**: `npm run electron:build` errors

**Solutions**:
1. Ensure web app builds: `npm run build`
2. Check Electron Builder logs in terminal
3. Verify all files in `build.files` array exist
4. Try building for specific platform instead of all

## Development

### Hot Reload

The development mode supports hot reload:

```bash
npm run dev          # Web app with Vite HMR
npm run electron:dev # Electron loads from localhost:5173
```

Changes to `src/` files reload automatically. Changes to `electron-*.js` require restarting Electron.

### Debugging

Open DevTools in Electron:
- macOS: `Cmd + Option + I`
- Windows/Linux: `Ctrl + Shift + I`
- Or: View menu → Toggle Developer Tools

### Main Process Logs

Main process console output appears in the terminal where you ran `npm run electron`.

## Performance Tips

1. **Pre-generate stems**: Audio is prepared async in the background
2. **Cache management**: Old stems auto-cleanup at 50MB limit
3. **Web Workers**: WAV encoding runs off main thread
4. **Memory**: Close unused tabs and apps for best performance

## Security

- Context isolation enabled (no direct Node.js access from renderer)
- Preload script exposes only safe APIs
- Temporary files cleaned up automatically
- No sensitive data stored in filenames

## Distribution

### Code Signing (Optional but Recommended)

For production releases, code sign your app:

**macOS**:
```bash
export CSC_NAME="Developer ID Application: Your Name"
npm run electron:build:mac
```

**Windows**:
```bash
export CSC_LINK=/path/to/certificate.pfx
export CSC_KEY_PASSWORD=your_password
npm run electron:build:win
```

### Auto-Updates (Future Enhancement)

Electron Builder supports auto-updates. Configure in `package.json`:

```json
"publish": {
  "provider": "github",
  "owner": "343labs",
  "repo": "music-studio"
}
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test in both dev and production builds
5. Submit a pull request

## License

See LICENSE file for details.

## Support & Documentation

- Full documentation: `ELECTRON_DAW_INTEGRATION.md`
- Drag and drop guide: `knowledge/drag_and_drop_guide.md`
- Bug reports: Open an issue on GitHub
- Questions: Check documentation first, then open a discussion

## Roadmap

- [ ] File promise implementation (macOS native)
- [ ] Virtual file streaming (Windows IDataObject)
- [ ] Batch stem export
- [ ] Custom drag preview images
- [ ] More export formats (AIFF, FLAC)
- [ ] Auto-update mechanism
- [ ] Plugin system for extensions

---

**Made with ❤️ by 343 Labs**
