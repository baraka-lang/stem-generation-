# 343 Labs AI Music Studio

AI-powered music generation platform with native DAW integration.

## 🎯 Quick Start

### Web Version
```bash
npm install
npm run dev
```

### Desktop App (Recommended for DAW Integration)
```bash
npm install
npm run build
npm run electron
```

**Desktop app enables drag and drop directly into Ableton Live, Logic Pro, FL Studio, and other DAWs!**

## 📚 Documentation

- **[Quick Start Guide](QUICK_START.md)** - Get drag and drop working in 5 minutes
- **[How It Works](HOW_IT_WORKS.md)** - Visual guide to the architecture
- **[Electron App Guide](README_ELECTRON.md)** - Complete desktop app documentation
- **[DAW Integration](ELECTRON_DAW_INTEGRATION.md)** - Technical details on drag and drop
- **[Implementation Summary](IMPLEMENTATION_SUMMARY.md)** - What was built and why
- **[Drag & Drop Guide](knowledge/drag_and_drop_guide.md)** - Cross-platform implementation reference

## ✨ Features

- AI-powered techno music generation
- Multi-stem audio workstation interface
- Real-time waveform visualization
- Native drag and drop to DAWs (Electron app)
- Volume, EQ, and filter controls
- Take management and history
- Session saving and loading

## 🚀 Why Desktop App?

Web browsers can't provide real file paths to other applications due to security restrictions. The Electron desktop app solves this by creating actual files that DAWs can import.

**Web Version**: Limited drag support (Chromium drag-to-desktop only)
**Desktop App**: Full DAW drag and drop support ✅

## 📖 See Also

- [Implementation Summary](IMPLEMENTATION_SUMMARY.md) - Technical overview of what was built
- [Product Requirements](PRD.md) - Complete feature specification

## 🛠️ Development

```bash
# Web dev server
npm run dev

# Electron dev mode
npm run electron:dev

# Build for production
npm run build
npm run electron:build
```

---

**Made by 343 Labs**
