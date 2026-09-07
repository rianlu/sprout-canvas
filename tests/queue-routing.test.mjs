import assert from 'node:assert/strict';
import * as queue from '../server/queue.mjs';
import { PNG_BASE64, PNG_URL, MASK_URL } from './fixtures.mjs';

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
  assert.equal(provider.id, 'anyrouter');
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
  ref_images: [{ name: 'ref.png', image_url: PNG_URL, mask_url: MASK_URL }],
}));

{
  assert.equal(queue.providerSupportsRequest(providers[0], '/v1/images/generations', 'application/json', Buffer.from(JSON.stringify({ prompt: 'text only' }))), true);
  assert.equal(queue.providerSupportsRequest(providers[1], '/v1/images/generations', 'application/json', Buffer.from(JSON.stringify({ prompt: 'text only' }))), true);
  assert.equal(queue.providerSupportsRequest(providers[0], '/v1/images/generations', 'application/json', semanticEditBody), true);
  assert.equal(queue.providerSupportsRequest(providers[1], '/v1/images/generations', 'application/json', semanticEditBody), true);
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
      ? `data: ${JSON.stringify({ type: 'response.completed', response: { output: [{ type: 'image_generation_call', id: 'image-result', result: PNG_BASE64 }] } })}\n\n`
      : JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] });
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
  assert.match(body, /name="mask"; filename="mask-ref.png"/);
});

await runProviderConversionJob(providers[0], 'https://anyrouter.test/v1/responses', (call) => {
  const payload = JSON.parse(Buffer.from(call.options.body).toString('utf8'));
  assert.equal(payload.model, 'gpt-5.3-codex');
  assert.equal(payload.tools[0].type, 'image_generation');
  assert.equal(payload.tools[0].action, 'edit');
  assert.equal(payload.tools[0].input_image_mask.image_url, MASK_URL);
  assert.equal(payload.input[1].content[0].type, 'input_text');
  assert.match(payload.input[1].content[0].text, /蒙版透明区域/);
  assert.equal(payload.input[1].content[1].type, 'input_image');
});

console.log('queue provider conversion tests passed');


{
  const rawBody = Buffer.from(JSON.stringify({ model: 'client-model', prompt: 'assistant text 400 should fallback' }));
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (fetchCalls.length === 1) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: { get: () => 'text/plain; charset=utf-8' },
        arrayBuffer: async () => Buffer.from('画面呈现一位角色在电脑前思考。如果你想尝试其他方向，我可以帮你调整构图。'),
      };
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      arrayBuffer: async () => Buffer.from(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] })),
    };
  };
  queue.init({
    readLocalConfig: async (providerId = '') => {
      const selected = providers.find((item) => item.id === providerId) || providers[0];
      return { ...selected, providers };
    },
    upstreamHeaders: (cfg, headerContentType) => ({ Authorization: `Bearer test-${cfg.id}`, 'Content-Type': headerContentType }),
    timeoutSignal: () => undefined,
    stripHtml: (value) => String(value),
    logLine: () => {},
  });
  const job = {
    id: queue.nextJobId(),
    userId: 'user-1',
    status: 'pending',
    method: 'POST',
    upstreamPath: '/v1/images/generations',
    contentType: 'application/json',
    body: queue.rewriteImageJobBody(providers[0], rawBody, 'application/json'),
    originalBody: rawBody,
    autoProviderRouting: true,
    excludeProviderId: '',
    clientContext: { kind: 'single', placeholderId: 'placeholder-auto', prompt: 'test', mode: 'text' },
    queuedAt: Date.now(),
    startedAt: 0,
    finishedAt: 0,
    error: '',
    result: null,
    providerId: '',
    providerName: '自动调度',
  };
  queue.enqueue(job);
  const outcome = await waitForJob(job.id);
  assert.equal(outcome.status, 200);
  assert.equal(fetchCalls.length, 2);
}

console.log('queue assistant-text fallback tests passed');


async function runForcedJob(provider, rawBody, fetchImpl) {
  globalThis.fetch = fetchImpl;
  queue.init({
    readLocalConfig: async (providerId = '') => {
      const selected = providers.find((item) => item.id === providerId) || provider;
      return { ...selected, providers };
    },
    upstreamHeaders: (cfg, contentType) => ({ Authorization: `Bearer test-${cfg.id}`, 'Content-Type': contentType }),
    timeoutSignal: () => undefined,
    stripHtml: (value) => String(value),
    logLine: () => {},
  });
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
    clientContext: { kind: 'single', placeholderId: 'placeholder-original', prompt: 'test', mode: 'text' },
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
  return { job, outcome };
}

{
  const rawBody = Buffer.from(JSON.stringify({ model: 'client-model', prompt: 'circuit breaker test' }));
  for (let index = 0; index < 3; index += 1) {
    const { outcome } = await runForcedJob(providers[0], rawBody, async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: () => 'application/json' },
      arrayBuffer: async () => Buffer.from(JSON.stringify({ error: { message: 'rate limit' } })),
    }));
    assert.equal(outcome.status, 429);
  }
  const selected = queue.chooseImageProvider(config, '/v1/images/generations', 'application/json', '', rawBody);
  assert.equal(selected.id, 'default');
}

{
  const rawBody = Buffer.from(JSON.stringify({ model: 'client-model', prompt: 'retry switches provider' }));
  const { job, outcome } = await runForcedJob(providers[0], rawBody, async () => ({
    ok: false,
    status: 500,
    statusText: 'Server Error',
    headers: { get: () => 'application/json' },
    arrayBuffer: async () => Buffer.from(JSON.stringify({ error: { message: 'server failed' } })),
  }));
  assert.equal(outcome.status, 500);

  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      arrayBuffer: async () => Buffer.from(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] })),
    };
  };
  const retry = queue.retryFailedJob(job.id, 'user-1');
  assert.equal(retry.ok, true);
  assert.equal(retry.job.retryOf, job.id);
  assert.notEqual(retry.job.clientContext.placeholderId, job.clientContext.placeholderId);
  const retryOutcome = await waitForJob(retry.job.id);
  assert.equal(retryOutcome.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://miaomiao.test/v1/images/generations');
}

{
  const rawBody = Buffer.from(JSON.stringify({ model: 'client-model', prompt: 'policy rejection does not trip circuit' }));
  for (let index = 0; index < 3; index += 1) {
    const { outcome } = await runForcedJob(providers[1], rawBody, async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => 'application/json' },
      arrayBuffer: async () => Buffer.from(JSON.stringify({ error: { message: 'content_policy_violation' } })),
    }));
    assert.equal(outcome.status, 400);
  }
  const selected = queue.chooseImageProvider(config, '/v1/images/generations', 'application/json', '', rawBody);
  assert.equal(selected.id, 'default');
}

console.log('queue circuit breaker and retry tests passed');
