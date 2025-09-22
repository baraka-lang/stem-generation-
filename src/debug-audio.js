// Debug utility to check AudioContext sample rate
export function checkAudioContextSampleRate() {
  try {
    // Create a temporary AudioContext to check sample rate
    const tempContext = new (window.AudioContext || window.webkitAudioContext)();
    const sampleRate = tempContext.sampleRate;
    
    console.log('🔊 AudioContext Sample Rate:', sampleRate + 'Hz');
    console.log('🔊 Common sample rates:');
    console.log('  - 44100Hz: CD quality');  
    console.log('  - 48000Hz: Professional audio');
    console.log('  - 24000Hz: ElevenLabs PCM output');
    
    // Close the temp context
    tempContext.close();
    
    return sampleRate;
  } catch (error) {
    console.error('❌ Failed to check AudioContext sample rate:', error);
    return null;
  }
}

// Add a console command for manual checking
window.checkAudioSampleRate = checkAudioContextSampleRate;