# Stem Separation Button Visibility

## Issue
The "Separate Stem" button was added to the waveform edit modal but wasn't immediately visible.

## Root Cause
The project has templates in TWO locations:
1. `/src/templates.html` - Development source
2. `/public/src/templates.html` - Runtime copy served by dev server

The button was only added to the first location initially.

## Solution Applied
Added the "Separate Stem" button to BOTH template files:
- ✅ `/src/templates.html` (line 179-187)
- ✅ `/public/src/templates.html` (line 194-202)

## To See the Button

### Option 1: Hard Refresh Browser
Press `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac) to clear the cached templates and reload.

### Option 2: Clear Browser Cache
Clear your browser's cache completely and reload the page.

### Option 3: Restart Dev Server
If running `npm run dev`, stop and restart the dev server.

### Option 4: Use Incognito/Private Window
Open the app in an incognito/private browsing window.

## Verification Steps

1. Generate or load a stem (e.g., kick drum)
2. Click on the waveform to open the edit modal
3. You should now see:
   - Waveform preview at the top
   - Endpoint dial with +/- buttons
   - **NEW: "Separate Stem" button with scissors icon**
   - Default/Discard/Save buttons at the bottom

## Button Location in Modal

```
┌─────────────────────────────────┐
│ Edit Take                     × │
├─────────────────────────────────┤
│ [Waveform Canvas]               │
│ [Grid Overlay]                  │
├─────────────────────────────────┤
│ -  [====|====]  +               │  ← Endpoint Dial
├─────────────────────────────────┤
│ ✂️  Separate Stem   ⟳          │  ← NEW BUTTON
│ Automatically extract...        │  ← Help Text
├─────────────────────────────────┤
│ [Default] [Discard] [Save]      │
└─────────────────────────────────┘
```

## Testing the Button

Once visible, the button will:
1. Show "Separating..." with a spinner when clicked
2. Take 10-30 seconds to process
3. Extract the matching instrument (drums for kick, bass for bass, etc.)
4. Load the separated audio as a new take
5. Show success message: "Successfully extracted [type] stem!"

## Environment Requirements

Ensure `ELEVENLABS_API_KEY` is set in your `.env` file for the feature to work.
