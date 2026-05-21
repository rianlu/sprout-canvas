const apiKey = process.env.OPENAI_API_KEY || process.env.ANYROUTER_API_KEY;
const baseUrl = (process.env.OPENAI_BASE_URL || process.env.ANYROUTER_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '').replace(/\/v1$/, '');
const imageModel = process.env.IMAGE_MODEL || 'gpt-image-2';

if (!apiKey) {
  console.log('SKIP real API smoke test: set OPENAI_API_KEY or ANYROUTER_API_KEY to run.');
  process.exit(0);
}

const payload = {
  model: imageModel,
  prompt: 'A tiny simple red circle icon on transparent background, minimal vector style',
  n: 1,
  size: '1024x1024',
  quality: 'low',
  output_format: 'png',
  background: 'transparent',
};

const response = await fetch(`${baseUrl}/v1/images/generations`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  const text = await response.text().catch(() => '');
  throw new Error(`Real API smoke failed: HTTP ${response.status} ${text.slice(0, 800)}`);
}

const data = await response.json();
if (!Array.isArray(data.data) || data.data.length !== 1) {
  throw new Error(`Real API smoke failed: expected one image, got ${JSON.stringify(data).slice(0, 800)}`);
}
const item = data.data[0];
if (!item.b64_json && !item.url) {
  throw new Error(`Real API smoke failed: no b64_json or url in first item: ${JSON.stringify(item).slice(0, 800)}`);
}
console.log(`real API smoke passed: ${item.b64_json ? 'b64_json' : 'url'} returned from ${baseUrl}`);
