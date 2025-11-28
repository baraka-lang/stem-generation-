# TunePal AI Music Studio - Quick Reference

**Product**: 343 Labs AI Music Studio | **Version**: 1.0.0 | **Platform**: Web + Desktop (Electron)

## What It Does

AI-powered music generation platform that creates professional stems (kick, bass, melody, percussion, pads, FX) instantly. Desktop app enables direct drag-and-drop into DAWs like Ableton Live, Logic Pro, FL Studio.

## Core Features

**Music Generation**
- AI Engine: ElevenLabs Music API
- 6 Stem Types: Kick, Bassline, Melody, Pad, Percussion, FX
- Parameters: 110-140 BPM, 4/8 bar loops, all keys (Major/Minor)
- Custom prompts per stem, unlimited variations

**Audio Workstation**
- Synchronized multi-stem playback
- Per-stem volume, mute, solo controls
- 3-band EQ (low/mid/high) + resonant filter
- Real-time waveform visualization
- Seamless looping with crossfade

**DAW Integration (Desktop)**
- Native drag-and-drop to professional DAWs
- Pre-computed WAV files for instant import
- Works on Windows, macOS, Linux

**Session Management**
- Save complete sets with all stems/settings
- Favorites system with star ratings
- Rename sets for organization
- Filter by BPM, key, rating

**Tech Stack**
- Frontend: Vanilla JS, Web Audio API, Tailwind CSS
- Backend: Supabase (auth, database, storage)
- Desktop: Electron with native file drag
- Audio: 24kHz PCM, 16-bit WAV export

## User Journey

1. Login → Genre Selection (Techno active) → Studio
2. Set master params: BPM, key, bars
3. Generate stems with optional custom prompts
4. Browse multiple takes per stem
5. Adjust volumes, EQ, filters
6. Save session with custom name
7. Drag stems to DAW or download

## Value Props

1. **Speed**: Generate stems in 10-30 seconds
2. **DAW Integration**: Only AI generator with native drag-drop
3. **Quality**: Professional 24kHz audio
4. **Control**: Multi-take system, EQ, filters, volume
5. **Organization**: Session saving, favorites, ratings
6. **Flexibility**: No subscription lock-in

## Target Audience

- Electronic music producers (techno, house, EDM)
- Content creators (videos, podcasts, streams)
- Hobbyist musicians and music students
- Game developers needing loop-able music
- Live performers and DJs

## Use Cases

- Rapid prototyping track ideas
- Generate reference/starting points
- Build personal loop libraries
- Create backing tracks for live sets
- Sound design and atmospheric textures

## Competitive Edge

- **Unique**: Native DAW integration via desktop app
- **Multi-stem**: Control 6+ stems simultaneously
- **Professional**: Real EQ/filter processing, not just generation
- **Unlimited Takes**: Generate variations without overwriting
- **Session Persistence**: Complete project saving with metadata

## Marketing Messages

- "From idea to DAW in seconds"
- "AI meets professional audio"
- "Studio-grade stems at your fingertips"
- "Your creative partner, not a replacement"

## Growth Potential

- Add Hip-Hop and House generators
- Real-time collaboration features
- Cloud project sync
- Stem marketplace
- Mobile apps (iOS/Android)
- Enterprise/white-label solutions

## Monetization

- Freemium: Limited free generations
- Credit system: Buy generation credits
- Subscription tiers: Different access levels
- Commercial licensing for generated content

## Technical Specs

- Audio: 24kHz, 16-bit PCM, WAV
- Generation: 10-30s per stem
- File Size: ~1-3MB per 4-bar stem
- Browser: Chrome, Firefox, Safari, Edge
- Desktop: Windows 10+, macOS 10.13+, Linux
- Requirements: 4GB RAM, modern GPU

## Brand Voice

Professional yet approachable, innovative, creative-first, transparent about AI capabilities, user-empowering.

## Legal

- Users own generated music
- Commercial use permitted (paid tiers)
- ElevenLabs API compliance
- GDPR/CCPA compliant

---

**Purpose**: Quick reference for marketing strategy, positioning, and business development. Full version: tunepalPRD.md
