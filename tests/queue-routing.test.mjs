import assert from 'node:assert/strict';
import * as queue from '../server/queue.mjs';

const providers = [
  { id: 'anyrouter', name: 'AnyRouter', baseUrl: 'https://anyrouter.test', generationMode: 'responses', imageModel: 'gpt-5.3-codex' },
  { id: 'default', name: '喵喵', baseUrl: 'https://miaomiao.test', generationMode: 'images', imageModel: 'gpt-image-2' },
];
const config = { ...providers[0], providers };

const boundary = '----sprout-test-boundary';
const contentType = `multipart/form-data; boundary=${boundary}`;
const multipartBody = Buffer.from([
  `--${boundary}`,
  'Content-Disposition: form-data; name="model"',
  '',
  'wrong-model',
  `--${boundary}`,
  'Content-Disposition: form-data; name="prompt"',
  '',
  'test prompt',
  `--${boundary}`,
  'Content-Disposition: form-data; name="image"; filename="ref.png"',
  'Content-Type: image/png',
  '',
  'fake-image-bytes',
  `--${boundary}--`,
  '',
].join('\r\n'));

{
  const provider = queue.chooseImageProvider(config, '/v1/images/edits', contentType, '', multipartBody);
  assert.equal(provider.id, 'default');
  assert.equal(queue.providerSupportsRequest(providers[0], '/v1/images/edits', contentType), false);
  assert.equal(queue.providerSupportsRequest(providers[1], '/v1/images/edits', contentType), true);
  const rewritten = queue.rewriteImageJobBody(provider, multipartBody, contentType).toString('utf8');
  assert.match(rewritten, /name="model"\r\n\r\ngpt-image-2\r\n/);
  assert.doesNotMatch(rewritten, /wrong-model/);
}

{
  const body = Buffer.from(JSON.stringify({ model: 'client-model', prompt: 'test' }));
  const provider = queue.chooseImageProvider(config, '/v1/images/generations', 'application/json', '', body);
  assert.ok(['anyrouter', 'default'].includes(provider.id));
  const rewritten = JSON.parse(queue.rewriteImageJobBody(provider, body, 'application/json').toString('utf8'));
  assert.equal(rewritten.model, provider.imageModel);
}

{
  assert.equal(queue.providerSupportsRequest(providers[0], '/v1/responses', 'application/json'), true);
  assert.equal(queue.providerSupportsRequest(providers[1], '/v1/responses', 'application/json'), false);
}

console.log('queue routing tests passed');

const semanticEditBody = Buffer.from(JSON.stringify({
  model: 'client-model',
  prompt: 'turn reference into a blue icon',
  n: 1,
  size: '1024x1024',
  quality: 'low',
  background: 'opaque',
  ref_images: [{ name: 'ref.png', image_url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==' }],
}));

{
  assert.equal(queue.providerSupportsRequest(providers[0], '/v1/images/generations', 'application/json'), true);
  assert.equal(queue.providerSupportsRequest(providers[1], '/v1/images/generations', 'application/json'), true);
}

async function waitForJob(jobId) {
  for (let i = 0; i < 20; i += 1) {
    const outcome = queue.getJobResult(jobId, 'user-1');
    if (outcome.kind === 'result') return outcome;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`job ${jobId} did not finish`);
}

async function runProviderConversionJob(provider, expectedUrl, inspect) {
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    const body = expectedUrl.endsWith('/v1/responses')
      ? `data: ${JSON.stringify({ result: 'a'.repeat(1200) })}\n\n`
      : JSON.stringify({ data: [{ b64_json: 'b'.repeat(1200) }] });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (name) => name === 'content-type' ? 'application/json' : '' },
      arrayBuffer: async () => Buffer.from(body),
    };
  };
  queue.init({
    readLocalConfig: async () => ({ ...provider, providers }),
    upstreamHeaders: (cfg, contentType) => ({ Authorization: `Bearer test-${cfg.id}`, 'Content-Type': contentType }),
    timeoutSignal: () => undefined,
    stripHtml: (value) => String(value),
    logLine: () => {},
  });
  const rawBody = semanticEditBody;
  const job = {
    id: queue.nextJobId(),
    userId: 'user-1',
    status: 'pending',
    method: 'POST',
    upstreamPath: '/v1/images/generations',
    contentType: 'application/json',
    body: queue.rewriteImageJobBody(provider, rawBody, 'application/json'),
    originalBody: rawBody,
    autoProviderRouting: false,
    excludeProviderId: '',
    clientContext: null,
    queuedAt: Date.now(),
    startedAt: 0,
    finishedAt: 0,
    error: '',
    result: null,
    providerId: provider.id,
    providerName: provider.name,
  };
  queue.enqueue(job);
  const outcome = await waitForJob(job.id);
  assert.equal(outcome.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, expectedUrl);
  inspect(fetchCalls[0]);
}

await runProviderConversionJob(providers[1], 'https://miaomiao.test/v1/images/edits', (call) => {
  const contentType = call.options.headers['Content-Type'];
  assert.match(contentType, /^multipart\/form-data; boundary=/);
  const body = Buffer.from(call.options.body).toString('latin1');
  assert.match(body, /name="model"\r\n\r\ngpt-image-2\r\n/);
  assert.match(body, /name="image"; filename="ref.png"/);
});

await runProviderConversionJob(providers[0], 'https://anyrouter.test/v1/responses', (call) => {
  const payload = JSON.parse(Buffer.from(call.options.body).toString('utf8'));
  assert.equal(payload.model, 'gpt-5.3-codex');
  assert.equal(payload.input[1].content[0].type, 'input_image');
  assert.equal(payload.input[1].content[1].type, 'input_text');
});

console.log('queue provider conversion tests passed');
