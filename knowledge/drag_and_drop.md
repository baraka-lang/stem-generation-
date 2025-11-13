# Drag and Drop Implementation Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Data Flow](#data-flow)
4. [Core Components](#core-components)
5. [Implementation Details](#implementation-details)
6. [Integration Guide](#integration-guide)
7. [Browser vs Electron](#browser-vs-electron)
8. [Troubleshooting](#troubleshooting)
9. [API Reference](#api-reference)

---

## Overview

This drag-and-drop system enables users to drag audio stems directly from a web application into Digital Audio Workstations (DAWs) like Ableton Live, Logic Pro, and FL Studio. The implementation uses raw PCM data storage to avoid unnecessary audio encoding/decoding cycles while providing optimal DAW compatibility.

### Key Features
- **PCM-based storage**: Stores raw 16-bit signed PCM data for efficient memory usage
- **Format preservation**: Maintains original sample rate from ElevenLabs API (44.1kHz, 24kHz, 22.05kHz, or 16kHz)
- **Dual-mode support**: Works in both browser and Electron environments
- **Zero re-encoding**: WAV wrapping happens on-demand during drag operations
- **Browser detection**: Automatically enables/disables features based on browser capabilities

### Supported Platforms
- **Browser**: Chromium-based browsers (Chrome, Edge, Brave) - limited DAW support
- **Electron**: Full native drag support for macOS and Windows
- **DAWs**: Ableton Live, Logic Pro, FL Studio, and other professional audio software

---

## Architecture

### System Components

```
