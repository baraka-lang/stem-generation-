# 343 Labs AI Music Studio - Product Requirements Document

## Overview

343 Labs AI Music Studio is a web-based AI-powered music generation platform that allows users to create professional-quality music stems across different genres. The application currently focuses on techno music generation with plans for hip-hop and house genres.

## Core Features

### 1. Multi-Page Application Structure

#### Login/Welcome Page
- Hero section with gradient text branding
- "Enter Studio" button to access the platform
- Aurora canvas background animation

#### Genre Selection Page  
- Three genre cards: Techno, Hip-Hop, House
- Only Techno is currently active (others show "Coming Soon")
- Each card displays:
  - Genre-specific icon and branding
  - BPM range information
  - Key characteristics
  - Launch button

#### Techno Generator Studio
- Main workspace for stem creation and management
- Master controls header
- Individual stem cards layout
- Real-time audio playback system

### 2. Master Controls

#### Transport Controls
- **Play/Pause Button**: Global playback control for all stems
- **Tempo Slider**: 110-140 BPM range with real-time display
- **Bars Selector**: Choose between 4 or 8 bar loops
- **Key Selector**: 
  - Root note dropdown (C through B)
  - Enharmonic toggle (♯/♭) with dynamic key mapping
  - Mode selector (Major/Minor)
- **Output Format**: PCM 24kHz, MP3 options, WAV formats

### 3. Stem System

#### Available Stems
- **Kick**: Foundation drum element
- **Bassline**: Low-frequency melodic content  
- **Melody**: Lead melodic elements
- **Pad**: Atmospheric background textures
- **Percussion**: Additional rhythmic elements
- **FX**: Sound effects and transitions

#### Individual Stem Cards
Each stem features:
- **Title and Icon**: Visual identification
- **Generate Button**: AI music creation trigger
- **Volume Control**: Individual stem level adjustment
- **Waveform Visualization**: Real-time audio representation
- **Take Management**: Browse and select different generated versions
- **Playback Controls**: Play, download, edit individual stems
- **Custom Instructions**: User-defined generation prompts

### 4. AI Music Generation

#### ElevenLabs Integration
- **API Endpoint**: Custom Supabase Edge Function proxy
- **Model**: music_v1 (ElevenLabs Music API)
- **Output Format**: PCM 24kHz converted to WAV
- **Length**: Variable based on bar selection and tempo
- **Channel Detection**: Automatic mono/stereo detection

#### Generation Process
1. User inputs custom instructions (optional)
2. System combines global parameters (key, tempo, bars)
3. API request sent to ElevenLabs via proxy
4. Raw PCM audio returned and converted to WAV
5. Waveform visualization generated
6. Audio made available for playback

### 5. Audio System

#### Web Audio API Integration
- **AudioContext**: Browser-native audio processing
- **Sample Rate**: 24kHz (matches ElevenLabs output)
- **Format Support**: WAV, MP3 playback
- **Concurrent Playback**: Multiple stems simultaneously
- **Volume Control**: Individual and master level adjustment

#### Playback Features
- **Synchronized Playback**: All stems play in sync when master play is pressed
- **Individual Control**: Each stem can be played independently  
- **Loop Mode**: Seamless looping for composition work
- **Take Selection**: Click waveform to browse previous generations

### 6. User Interface

#### Design System
- **Theme**: Dark mode with glass morphism effects
- **Colors**: Purple/pink gradient accent system
- **Typography**: Clean, modern font hierarchy
- **Responsive**: Mobile-friendly layout
- **Animations**: Smooth transitions and micro-interactions

#### Visual Feedback
- **Generation Status**: Loading indicators and progress feedback
- **Waveform Visualization**: Real-time audio representation
- **Hover States**: Interactive element feedback
- **Glass Effects**: Backdrop blur and transparency layers

### 7. Data Management

#### Supabase Integration
- **Environment Variables**: Automatic configuration
- **Edge Functions**: Server-side API proxying
- **Real-time Features**: Ready for collaboration features
- **Authentication**: Prepared for user accounts

#### Local Storage
- **Take History**: Previous generations cached locally
- **User Preferences**: Settings persistence
- **Session State**: Maintain work across page refreshes

### 8. Technical Architecture

#### Frontend Stack
- **Vanilla JavaScript**: No framework dependencies
- **Web Audio API**: Native browser audio processing
- **Canvas API**: Waveform visualization and aurora effects
- **CSS3**: Modern styling with custom properties
- **HTML5**: Semantic structure

#### Backend Services
- **Supabase**: Backend-as-a-service platform
- **Edge Functions**: Serverless API endpoints
- **ElevenLabs API**: AI music generation service
- **CDN Libraries**: Tailwind CSS, Lucide icons

#### Build & Deployment
- **Vite**: Development server and build tool
- **Static Hosting**: Optimized for CDN deployment
- **Environment Configuration**: Secure API key management

## User Workflows

### Basic Music Creation Flow
1. User enters application via login page
2. Selects Techno generator from genre selection
3. Configures global parameters (tempo, key, bars)
4. Generates individual stems with custom prompts
5. Adjusts volumes and listens to combined result
6. Downloads individual stems or full mix

### Advanced Composition Flow
1. Generate multiple takes for each stem type
2. Browse take history via waveform clicking
3. Fine-tune individual stem volumes
4. Layer multiple stems for complex arrangements
5. Export individual elements for external DAW use

## Future Enhancements

### Planned Features
- **Hip-Hop Generator**: Boom-bap and trap style generation
- **House Generator**: Four-on-the-floor house music creation
- **User Accounts**: Save and share compositions
- **Collaboration**: Real-time multi-user sessions
- **Export Options**: Full song arrangement and mixing
- **Advanced Controls**: More granular generation parameters

### Technical Improvements
- **Audio Quality**: Higher sample rate options
- **Performance**: Optimized audio processing
- **Storage**: Cloud-based project persistence
- **Analytics**: Usage tracking and optimization

## Success Metrics

### User Engagement
- **Generation Rate**: Average stems generated per session
- **Session Duration**: Time spent in the application  
- **Return Rate**: Frequency of user returns
- **Export Activity**: Download and sharing behavior

### Technical Performance  
- **Generation Speed**: Time to create audio stems
- **Audio Quality**: User satisfaction with output
- **System Reliability**: Uptime and error rates
- **Mobile Experience**: Cross-device functionality

## Constraints & Limitations

### Technical Constraints
- **Browser Audio**: Limited to Web Audio API capabilities
- **Generation Time**: Dependent on ElevenLabs API performance
- **File Size**: Audio quality vs. bandwidth considerations
- **Browser Support**: Modern browser requirements

### Business Constraints
- **API Costs**: ElevenLabs usage-based pricing
- **Storage**: Audio file hosting and bandwidth
- **Scalability**: Concurrent user limitations
- **Legal**: Music generation rights and licensing