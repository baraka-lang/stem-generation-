// Test which Gemini models are available
import { readFileSync } from 'fs';

const envContent = readFileSync('.env', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    env[key.trim()] = valueParts.join('=').trim();
  }
});

const GEMINI_API_KEY = env.GEMINI_API_KEY;

async function testModel(modelName) {
  console.log(`\nTesting: ${modelName}`);
  
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}`,
      {
        method: "GET",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      console.log(`✓ Available: ${data.name}`);
      console.log(`  Display Name: ${data.displayName}`);
      console.log(`  Supported methods: ${data.supportedGenerationMethods?.join(', ')}`);
      return true;
    } else {
      console.log(`✗ Not available (${response.status})`);
      return false;
    }
  } catch (error) {
    console.log(`✗ Error: ${error.message}`);
    return false;
  }
}

async function testModels() {
  console.log('🔍 Testing Gemini Models...\n');
  
  const models = [
    'gemini-3-pro-preview',
    'gemini-2.0-flash-exp',
    'gemini-2.0-pro-exp',
    'gemini-1.5-pro',
    'gemini-1.5-flash'
  ];

  for (const model of models) {
    await testModel(model);
  }
}

testModels();
