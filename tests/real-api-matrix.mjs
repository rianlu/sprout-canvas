const apiKey = process.env.OPENAI_API_KEY || process.env.ANYROUTER_API_KEY;
const baseUrl = (process.env.OPENAI_BASE_URL || process.env.ANYROUTER_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '').replace(/\/v1$/, '');
const imageModel = process.env.IMAGE_MODEL || 'gpt-image-2';

if (!apiKey) {
  console.log('SKIP real API matrix test: set OPENAI_API_KEY or ANYROUTER_API_KEY to run.');
  process.exit(0);
}

const cases = [
  {
    name: 'png-transparent-1k-square',
    payload: {
      model: imageModel,
      prompt: 'Minimal red dot icon, transparent background',
      n: 1,
      size: '1024x1024',
      quality: 'low',
      output_format: 'png',
      background: 'transparent',
    },
  },
  {
    name: 'webp-opaque-16x9-compressed',
    payload: {
      model: imageModel,
      prompt: 'Minimal landscape with one blue line on plain background',
      n: 1,
      size: '1536x864',
      quality: 'low',
      output_format: 'webp',
      output_compression: 70,
      background: 'opaque',
    },
  },
  {
    name: 'jpeg-opaque-custom-1920x1088',
    payload: {
      model: imageModel,
      prompt: 'Minimal black square icon on white background',
      n: 1,
      size: '1920x1088',
      quality: 'low',
      output_format: 'jpeg',
      output_compression: 80,
      background: 'opaque',
    },
  },
];

for (const testCase of cases) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(testCase.payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${testCase.name} failed: HTTP ${response.status} ${text.slice(0, 800)}`);
  }
  const data = await response.json();
  const item = data?.data?.[0];
  if (!item?.b64_json && !item?.url) {
    throw new Error(`${testCase.name} failed: missing image payload`);
  }
  console.log(`${testCase.name} passed in ${((Date.now() - started) / 1000).toFixed(1)}s via ${item.b64_json ? 'b64_json' : 'url'}`);
}
