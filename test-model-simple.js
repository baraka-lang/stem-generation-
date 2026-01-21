import { readFileSync } from 'fs';
const env = {};
readFileSync('.env', 'utf-8').split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) env[parts[0].trim()] = parts.slice(1).join('=').trim();
});

async function test(model) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
    headers: { "x-goog-api-key": env.GEMINI_API_KEY }
  });
  console.log(model, r.ok ? '✓' : '✗');
}

await test('gemini-3-pro-preview');
await test('gemini-2.0-flash-exp');
await test('gemini-1.5-pro');
