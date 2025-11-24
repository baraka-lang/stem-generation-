# Bar Selector Implementation

## Overview
Added a bar selector feature to the Edit Take popup that allows users to change the playback loop size between 2 and 4 bars after the project has started. This feature is completely non-destructive and only affects playback, not the underlying audio data.

## Features Implemented

### 1. UI Components
- Added two toggle buttons ("2" and "4") in the top right corner of the Edit Take modal
- Buttons are styled with active state (purple background) and inactive state (transparent with hover)
- Positioned above the waveform preview for easy access
- Responsive design works on both mobile and desktop

### 2. State Management
- Created `stemPlaybackBarsOverride` object to store per-stem bar overrides
- Added `prevPlaybackBars` to `waveformEditState` for discard functionality
- Bar overrides are persisted in `stemHistory` entries via `playbackBarsOverride` property

### 3. Core Functions

#### `getEffectivePlaybackBars(st)`
Returns the effective playback bar count for a stem, checking:
1. User override (`stemPlaybackBarsOverride`)
2. Take-specific override (`take.playbackBarsOverride`)
3. Original take bars (converted via `getPlaybackBars()`)
4. Master settings (fallback)

#### `changePlaybackBars(st, newBars, updateUICallback, updateGridCallback)`
Changes the playback loop size for a stem:
- Stores override in `stemPlaybackBarsOverride`
- Rebuilds loop buffer using `buildLoopBufferFromRawStrict()` with original tempo and head index
- Updates waveform preview in modal
- Updates session info card
- Restarts playback if currently playing
- Extracts new PCM for drag-and-drop
- Invalidates cached audio files

### 4. Modal Integration

#### Opening Modal
- Initializes bar selector buttons with current effective bars
- Updates waveform grid to show correct number of bar divisions
- Stores previous playback bars for potential revert

#### Closing Modal (Save)
- Saves `playbackBarsOverride` to take history entry
- Updates session info card
- Changes persist across take selections

#### Closing Modal (Discard)
- Reverts to previous playback bar count
- Rebuilds loop with original settings
- Clears any temporary overrides

#### Default Button
- Resets playback bars to original take value
- Clears both temporary and persisted overrides
- Updates UI to reflect reset state

### 5. Take Selection Integration
Modified `selectStemVersion()` to:
- Check for `playbackBarsOverride` in take entry
- Apply override before setting `stemLoop`
- Rebuild loop with override bars if present
- Display effective bars in status line

### 6. Status Display
- Status line now shows effective playback bars (e.g., "v1 (128 BPM • 2 bars)")
- Session info card continues to show master settings
- Individual stems can have different playback bar settings

## Technical Implementation Details

### Loop Rebuilding
When bars are changed, the loop is rebuilt using:
```javascript
buildLoopBufferFromRawStrict(take.raw, tempo, newBars, headIndex)
```

This ensures:
- Original audio data (`take.raw`) is preserved
- Original tempo from generation is maintained
- Original head index (attack detection) is used
- Only the playback duration changes

### Non-Destructive Design
- Original `take.bars` value never changes
- `take.raw` buffer is never modified
- Only `stemLoop` buffer (used for playback) is rebuilt
- All other effects (offset, stretch, volume) continue to work

### State Persistence Flow
1. User changes bars in modal → `stemPlaybackBarsOverride[st]`
2. User clicks Save → `take.playbackBarsOverride`
3. User switches takes → reads `take.playbackBarsOverride`
4. Session reload → restores from persisted take history

## Files Modified
- `src/templates.html` - Added bar selector UI to Edit Take modal
- `src/app.js` - Implemented all state management and logic

## Future Enhancements
- Could add more bar options (1, 8, 16)
- Could show different bars in session info if stems diverge
- Could add visual indicator on card when bar override is active
- Could add "sync all stems" button to match bars across all stems
