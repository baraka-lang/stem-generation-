# TunePal AI Music Studio - System Prompt & Product Guide

## Product Identity

**Product Name**: 343 Labs AI Music Studio (TunePal)
**Tagline**: AI-powered music generation with native DAW integration
**Version**: 1.0.0
**Category**: Music Production Software
**Platform**: Web + Desktop (Electron)

## What TunePal Does

TunePal is an AI-powered music generation platform that creates professional-quality music stems instantly. Musicians, producers, and creators can generate individual instrument tracks (kick, bass, melody, percussion, pads, FX) using AI, then drag them directly into professional music software like Ableton Live, Logic Pro, and FL Studio.

## Core Value Propositions

1. **Instant Music Creation**: Generate professional stems in seconds, not hours
2. **Native DAW Integration**: Drag-and-drop directly into production software (desktop app)
3. **Full Creative Control**: Adjust tempo, key, volume, EQ, and filters for each stem
4. **Multiple Takes System**: Generate variations until you find the perfect sound
5. **Session Management**: Save complete projects with favorites and custom set names
6. **Professional Quality**: 24kHz PCM audio with WAV export capability

## Key Features Summary

### Music Generation
- **AI Engine**: Powered by ElevenLabs Music API
- **Stem Types**: Kick, Bassline, Melody, Pad, Percussion, FX
- **Parameters**: 110-140 BPM, 4 or 8 bar loops, all musical keys (Major/Minor)
- **Custom Prompts**: User-defined generation instructions per stem
- **Take Management**: Generate unlimited variations, browse history

### Audio Workstation
- **Synchronized Playback**: All stems play in perfect sync
- **Individual Controls**: Volume, mute, solo for each stem
- **Audio Processing**: 3-band EQ (low/mid/high), resonant filter, per-stem controls
- **Waveform Visualization**: Real-time audio display for all tracks
- **Loop Mode**: Seamless looping with advanced crossfade technology

### DAW Integration (Desktop App)
- **Direct Drag**: Click and drag stems into Ableton, Logic, FL Studio, etc.
- **Real File Paths**: Native OS file handling for instant DAW recognition
- **Background Pre-computation**: WAV files ready before you drag
- **Universal Compatibility**: Works with all major DAWs on Windows, macOS, Linux

### Session & Data Management
- **Save Sets**: Store complete sessions with all stems, settings, and parameters
- **Favorites System**: Like individual stems and browse liked collection
- **Rename Sets**: Custom naming for organized project management
- **Filtering**: Sort by BPM, key, and star rating
- **Session Persistence**: Maintains state across app restarts

### User Interface
- **Modern Design**: Dark theme with glass morphism and gradient accents
- **Responsive Layout**: Works on desktop and mobile browsers
- **Real-time Feedback**: Loading states, progress indicators, toast notifications
- **Intuitive Controls**: Slider-based parameters, dropdown selectors
- **Aurora Canvas**: Animated background for visual appeal

## Technical Architecture

### Frontend
- **Framework**: Vanilla JavaScript (no dependencies)
- **Audio Engine**: Web Audio API for native browser processing
- **Visualization**: Canvas API for waveforms and effects
- **Styling**: Tailwind CSS with custom design system
- **Icons**: Lucide icon library

### Backend
- **BaaS**: Supabase for database, auth, and storage
- **Edge Functions**: Serverless API proxying for security
- **Authentication**: Email/password with session management
- **Database**: PostgreSQL with Row Level Security
- **Storage**: Audio file persistence in cloud buckets

### Desktop App
- **Platform**: Electron (cross-platform)
- **Build Tool**: Vite for bundling and optimization
- **Drag System**: Native OS file drag protocols (CF_HDROP on Windows, file URLs on macOS)
- **File Management**: Temporary file system for drag operations

## User Journey

### First-Time User
1. Lands on login/welcome page with animated aurora background
2. Clicks "Enter Studio" to access platform
3. Views genre selection (Techno active, Hip-Hop/House coming soon)
4. Launches Techno Generator Studio
5. Sets master parameters: 130 BPM, A Minor, 4 bars
6. Generates first kick drum stem
7. Plays back generated audio
8. Generates additional stems (bass, melody)
9. Adjusts individual volumes
10. Saves session as "First Track"
11. Downloads stems or drags to DAW (desktop app)

### Returning User
1. Opens saved sets from favorites page
2. Loads previous session with one click
3. Generates new takes for existing stems
4. Browses take history with waveform clicks
5. Fine-tunes EQ and filters
6. Exports individual stems or full mix
7. Renames set for better organization

### Professional Producer
1. Sets specific BPM and key for project
2. Generates multiple takes per stem type
3. Compares variations using take browser
4. Applies detailed EQ and filter adjustments
5. Uses loop fix feature for seamless transitions
6. Drags stems directly into Ableton Live project
7. Continues production in professional DAW

## Competitive Advantages

1. **Desktop Integration**: Only AI music generator with native DAW drag-and-drop
2. **Multi-Stem System**: Generate and control 6+ stems simultaneously
3. **Take Management**: Unlimited variations without overwriting
4. **Professional Controls**: EQ, filters, and real-time audio processing
5. **Session Saving**: Complete project persistence with favorites
6. **No Learning Curve**: Intuitive interface, instant results
7. **Affordable AI**: Pay-per-use model, no expensive subscriptions

## Target Audience

### Primary Users
- **Electronic Music Producers**: Creating techno, house, EDM tracks
- **Content Creators**: Need music for videos, podcasts, streams
- **Hobbyist Musicians**: Want to create without traditional instruments
- **Music Students**: Learning composition and arrangement
- **Game Developers**: Need looping background music

### Use Cases
- **Rapid Prototyping**: Quick sketch ideas before full production
- **Reference Tracks**: Generate starting points for original compositions
- **Loop Libraries**: Build personal collections of stems
- **Live Performance**: Generate backing tracks for DJ sets
- **Sound Design**: Create atmospheric elements and textures

## Growth Potential

### Expansion Plans
- **Genre Addition**: Hip-hop (boom-bap, trap) and House (four-on-the-floor) generators
- **Collaboration Features**: Real-time multi-user sessions
- **Cloud Projects**: Cross-device sync and backup
- **Marketplace**: Share and sell generated stems
- **Advanced AI**: More control over generation parameters
- **Mobile Apps**: iOS and Android native applications

### Monetization
- **Freemium Model**: Limited free generations, paid tiers for power users
- **Credit System**: Purchase generation credits in bulk
- **Subscription Tiers**: Different levels of access and features
- **Commercial Licensing**: Rights management for generated content
- **Enterprise**: White-label solutions for studios and labels

## Marketing Angles

### Key Messages
- "From idea to DAW in seconds" - Speed and efficiency
- "AI meets professional audio" - Quality and credibility
- "Generate, customize, create" - Workflow simplicity
- "Your creative partner, not a replacement" - Augmentation, not automation
- "Studio-grade stems at your fingertips" - Professional quality

### Differentiators
- Native DAW integration (desktop app unique selling point)
- Multi-stem simultaneous generation and control
- Professional audio processing (not just generation)
- Session management with favorites and ratings
- Take history and variation browsing
- No subscription lock-in, transparent pricing

### Success Stories
- Producer creates full track foundation in 15 minutes
- Content creator generates 50 unique loops for video library
- Student learns arrangement by experimenting with AI stems
- DJ builds custom backing track for live set
- Game developer creates seamless looping soundtrack

## Technical Specifications for Marketing

- **Audio Quality**: 24kHz sample rate, 16-bit PCM, WAV format
- **Generation Speed**: 10-30 seconds per stem (AI dependent)
- **File Sizes**: ~1-3MB per 4-bar stem
- **Supported DAWs**: Ableton Live, Logic Pro, FL Studio, Pro Tools, Cubase, Studio One, Reaper, and more
- **Browser Support**: Chrome, Firefox, Safari, Edge (modern versions)
- **Desktop Platforms**: Windows 10+, macOS 10.13+, Linux (AppImage/deb)
- **System Requirements**: 4GB RAM minimum, modern GPU for canvas effects

## Privacy & Security

- User data encrypted at rest and in transit
- Audio files stored securely in Supabase cloud storage
- No third-party tracking or analytics (optional)
- Email-only authentication, no social media requirements
- Session data cleared on logout
- GDPR and CCPA compliant architecture

## Support & Documentation

- In-app help modal with keyboard shortcuts
- Quick start guide for new users
- Technical documentation for developers
- Video tutorials for common workflows
- Community Discord for user support
- Email support for technical issues

## Brand Voice & Tone

- **Professional yet approachable**: Not intimidating to beginners
- **Innovative and forward-thinking**: Emphasize AI and technology
- **Creative-first**: Focus on artistic possibilities
- **Transparent and honest**: Clear about AI limitations
- **Empowering**: Users remain in control, AI is a tool

## Legal & Licensing

- Generated music ownership belongs to user
- Commercial use permitted for paid tiers
- Attribution requirements clearly stated
- Copyright compliance with training data
- Terms of service protect both company and users
- ElevenLabs API terms compliance

---

**Last Updated**: November 2024
**Document Purpose**: Marketing strategy, positioning, and product understanding for AI assistants helping with business development, content creation, and growth initiatives.
