/**
 * Test if the Gemini API schema is valid
 */

import { readFileSync } from 'fs';

// Load environment
const envContent = readFileSync('.env', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    env[key.trim()] = valueParts.join('=').trim();
  }
});

const GEMINI_API_KEY = env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY not set in .env');
  process.exit(1);
}

async function testGeminiSchema() {
  console.log('🧪 Testing Gemini API Schema\n');

  // Create a minimal test audio (1 second sine wave)
  const sampleRate = 44100;
  const duration = 1;
  const numSamples = duration * sampleRate;
  const numChannels = 2;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const fileSize = 44 + dataSize;

  const buffer = Buffer.alloc(fileSize);

  // Write WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Generate simple sine wave
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.floor(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 16000);
    buffer.writeInt16LE(sample, offset);
    buffer.writeInt16LE(sample, offset + 2);
    offset += 4;
  }

  const base64Audio = buffer.toString('base64');

  console.log(`✓ Created test audio: ${buffer.length} bytes\n`);

  // Test the schema structure that matches our fixed code
  const requestBody = {
    contents: [{
      parts: [
        {
          text: `Analyze this audio and detect BPM. Return JSON with: detected_bpm (number), confidence (0-1), suggested_start_frame (integer), seam_frame (integer).`
        },
        {
          inline_data: {
            mime_type: "audio/wav",
            data: base64Audio
          }
        }
      ]
    }],
    generationConfig: {
      response_mime_type: "application/json",
      response_schema: {
        type: "object",
        properties: {
          detected_bpm: {
            type: "number",
            minimum: 40,
            maximum: 300,
            description: "Detected BPM with decimal precision (e.g., 128.5)"
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Analysis confidence score (0.0-1.0)"
          },
          downbeat_frames: {
            type: "array",
            items: { type: "integer" },
            description: "Frame indices of each bar's first beat"
          },
          beat_frames: {
            type: "array",
            items: { type: "integer" },
            description: "Frame indices of all beats (including downbeats)"
          },
          transient_frames: {
            type: "array",
            items: { type: "integer" },
            description: "Strong transient attack positions (e.g., kick hits)"
          },
          suggested_start_frame: {
            type: "integer",
            description: "Optimal loop start frame (required)"
          },
          seam_frame: {
            type: "integer",
            description: "Optimal crossfade location for loop seam"
          }
        },
        required: ["detected_bpm", "suggested_start_frame"]
      }
    }
  };

  console.log('Testing with model: gemini-3-pro-preview\n');

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Gemini API Error: ${response.status}`);
      console.error(errorText);
      process.exit(1);
    }

    const result = await response.json();
    console.log('✅ Gemini API Response Received!\n');

    if (result.candidates && result.candidates[0]) {
      const candidate = result.candidates[0];
      console.log('Response structure:');
      console.log(JSON.stringify(candidate, null, 2));

      if (candidate.content?.parts?.[0]?.text) {
        const analysis = JSON.parse(candidate.content.parts[0].text);
        console.log('\n✅ Parsed Analysis:');
        console.log(JSON.stringify(analysis, null, 2));
        console.log('\n✓ Schema is valid and working!');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testGeminiSchema();
