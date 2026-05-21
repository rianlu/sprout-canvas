const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...items) { items.forEach((item) => this.values.add(item)); }
  remove(...items) { items.forEach((item) => this.values.delete(item)); }
  toggle(item, force) {
    if (force === undefined) {
      if (this.values.has(item)) this.values.delete(item);
      else this.values.add(item);
      return this.values.has(item);
    }
    if (force) this.values.add(item);
    else this.values.delete(item);
    return force;
  }
  contains(item) { return this.values.has(item); }
}

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = false;
    this.hidden = false;
    this.files = [];
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.classList = new FakeClassList();
    this.children = [];
  }
  addEventListener() {}
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.children.push(item); return item; }
  insertBefore(item) { this.children.push(item); return item; }
  remove() {}
  querySelectorAll() { return []; }
  querySelector() { return new FakeElement(); }
}

const ids = [...fs.readFileSync('index.html', 'utf8').matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
for (const [id, element] of elements) element.id = id;

const tabDraw = elements.get('tabDrawBtn');
tabDraw.dataset.page = 'draw';
const tabGallery = elements.get('tabGalleryBtn');
tabGallery.dataset.page = 'gallery';
const tabSplit = elements.get('tabSplitBtn');
tabSplit.dataset.page = 'split';

const documentStub = {
  body: new FakeElement('body'),
  querySelector(selector) {
    if (selector.startsWith('#')) return elements.get(selector.slice(1)) || new FakeElement(selector.slice(1));
    return new FakeElement(selector);
  },
  querySelectorAll(selector) {
    if (selector === '.tab-button') return [tabDraw, tabSplit, tabGallery];
    return [];
  },
  createElement(tag) {
    const element = new FakeElement();
    element.tagName = tag.toUpperCase();
    return element;
  },
  addEventListener() {},
};

const localStorageStub = {
  getItem() { return null; },
  setItem() {},
};

const indexedDBStub = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        objectStoreNames: { contains: () => true },
        transaction: () => ({
          objectStore: () => ({
            getAll: () => {
              const getRequest = {};
              queueMicrotask(() => {
                getRequest.result = [];
                if (getRequest.onsuccess) getRequest.onsuccess();
              });
              return getRequest;
            },
          }),
        }),
        close() {},
      };
      if (request.onsuccess) request.onsuccess();
    });
    return request;
  },
};

const context = {
  console,
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  Blob,
  FormData,
  TextDecoder,
  Uint8Array,
  atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  alert(message) { throw new Error(`alert: ${message}`); },
  confirm() { return true; },
  navigator: { clipboard: { writeText() { return Promise.resolve(); }, write() { return Promise.resolve(); } } },
  URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
  FileReader: class {},
  localStorage: localStorageStub,
  indexedDB: indexedDBStub,
  document: documentStub,
  window: { addEventListener() {} },
};
context.globalThis = context;
context.window = Object.assign(context.window, context);

vm.createContext(context);
vm.runInContext(fs.readFileSync('js/app.js', 'utf8'), context, { filename: 'js/app.js' });

function setBaseValues() {
  elements.get('baseUrl').value = '/api';
  elements.get('apiKey').value = '__server__';
  elements.get('textModel').value = 'gpt-5.3-codex';
  elements.get('generationMode').value = 'images';
  elements.get('imageModel').value = 'gpt-image-2';
  elements.get('prompt').value = '测试图片';
  elements.get('imageCount').value = '3';
  elements.get('aspectRatio').value = '16:9';
  elements.get('imageQuality').value = 'high';
  elements.get('outputFormat').value = 'webp';
  elements.get('background').value = 'opaque';
  elements.get('outputCompression').value = '85';
}

function assertConfig(expectedRequestSize) {
  const config = context.getConfig();
  assert.equal(config.size, expectedRequestSize);
  assert.equal(config.requestSize, expectedRequestSize);
  assert.equal(config.quality, 'high');
  assert.equal(config.outputFormat, 'webp');
  assert.equal(config.outputCompression, 85);
  const payload = context.buildImagesPayload(config, 1);
  assert.equal(payload.n, 1);
  if (expectedRequestSize === 'auto') {
    assert.equal(Object.hasOwn(payload, 'size'), false);
  } else {
    assert.equal(payload.size, expectedRequestSize);
  }
  assert.equal(payload.quality, 'high');
  assert.equal(payload.output_format, 'webp');
  assert.equal(payload.output_compression, 85);
}

setBaseValues();
assertConfig('1536x1024');

setBaseValues();
elements.get('outputFormat').value = 'auto';
elements.get('outputCompression').value = '';
{
  const config = context.getConfig();
  const payload = context.buildImagesPayload(config, 1);
  const tool = context.buildImageTool(config);
  assert.equal(config.outputFormat, 'auto');
  assert.equal(config.outputCompression, 90);
  assert.equal(Object.hasOwn(payload, 'output_format'), false);
  assert.equal(Object.hasOwn(payload, 'output_compression'), false);
  assert.equal(Object.hasOwn(tool, 'output_format'), false);
  assert.equal(Object.hasOwn(tool, 'output_compression'), false);
}

const cases = [
  ['1:1', '1024x1024'],
  ['16:9', '1536x1024'],
  ['9:16', '1024x1536'],
  ['4:3', '1536x1024'],
  ['3:4', '1024x1536'],
  ['3:2', '1536x1024'],
  ['2:3', '1024x1536'],
  ['auto', 'auto'],
];
for (const [ratio, expectedRequest] of cases) {
  setBaseValues();
  elements.get('aspectRatio').value = ratio;
  assertConfig(expectedRequest);
}

setBaseValues();
elements.get('aspectRatio').value = 'custom';
assert.throws(() => context.getConfig(), /有效的画面比例/);

setBaseValues();
elements.get('outputFormat').value = 'jpeg';
elements.get('background').value = 'transparent';
assert.throws(() => context.getConfig(), /JPEG 不支持透明背景/);


setBaseValues();
elements.get('splitRows').value = '3';
elements.get('splitCols').value = '4';
elements.get('splitMarginX').value = '8';
elements.get('splitMarginY').value = '10';
elements.get('splitGapX').value = '2';
elements.get('splitGapY').value = '4';
elements.get('splitFormat').value = 'webp';
elements.get('splitQuality').value = '88';
{
  const splitConfig = context.getSplitConfig();
  assert.equal(splitConfig.rows, 3);
  assert.equal(splitConfig.cols, 4);
  assert.equal(splitConfig.marginX, 8);
  assert.equal(splitConfig.marginY, 10);
  assert.equal(splitConfig.gapX, 2);
  assert.equal(splitConfig.gapY, 4);
  assert.equal(splitConfig.format, 'webp');
  assert.equal(splitConfig.quality, 88);
}
console.log('split config tests passed');


setBaseValues();
elements.get('generationMode').value = 'responses';
elements.get('textModel').value = 'gpt-5-mini';
elements.get('imageModel').value = 'gpt-5.3-codex';
{
  const config = context.getConfig();
  const imagePayload = context.buildImagePayload(config, 0);
  const optimizePayload = context.buildOptimizePayload(config);
  assert.equal(imagePayload.model, 'gpt-5.3-codex');
  assert.equal(optimizePayload.model, 'gpt-5-mini');
  assert.equal(optimizePayload.input[1].content, '测试图片');
  assert.match(optimizePayload.input[0].content, /prompt editor/);
  assert.match(optimizePayload.input[0].content, /文字:/);
  assert.equal(config.textModel, 'gpt-5-mini');
}
assert.equal(
  context.cleanOptimizedPrompt('优化后的提示词: 海报主视觉, 画面文字: 疯狂星期四\n如果你想, 我可以再帮你写三条版本'),
  '海报主视觉, 画面文字: 疯狂星期四'
);
assert.throws(
  () => context.validateOptimizedPrompt('如果你想, 我可以再帮你写三条带梗版本'),
  /不是图片提示词/
);

console.log('parameter smoke tests passed');


function mockQueuedImageFetch({ body, failResult = false, onSubmit } = {}) {
  const responseBody = body || { data: [{ b64_json: Buffer.from('fake-image').toString('base64') }] };
  return async (url, options = {}) => {
    if (url === '/api/jobs/images/generations') {
      if (onSubmit) onSubmit(url, options);
      return {
        ok: true,
        status: 202,
        json: async () => ({ id: 'job-1', status: failResult ? 'failed' : 'succeeded', position: 0, activeCount: 0, queuedCount: 0, maxConcurrency: 2, averageMs: 90000, estimatedWaitMs: 0 }),
      };
    }
    if (url === '/api/jobs/job-1/result') {
      if (failResult) {
        return {
          ok: false,
          status: 524,
          statusText: 'A timeout occurred',
          headers: { get: () => 'text/html' },
          text: async () => '<html><body>ioll.pp.ua | 524: A timeout occurred</body></html>',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => responseBody,
        text: async () => JSON.stringify(responseBody),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

async function testImagesApiSingleRequestPayload() {
  setBaseValues();
  const config = context.getConfig();
  let captured;
  context.abortController = { signal: {} };
  context.fetch = mockQueuedImageFetch({
    body: { data: [{ b64_json: Buffer.from('fake-image').toString('base64') }] },
    onSubmit(url, options) { captured = { url, options, body: JSON.parse(options.body) }; },
  });
  const dataUrl = await context.generateWithImagesApi(config, 1);
  assert.equal(captured.url, '/api/jobs/images/generations');
  assert.equal(captured.options.headers['X-Provider-Id'], undefined);
  assert.equal(captured.body.n, 1);
  assert.equal(captured.body.size, '1536x1024');
  assert.match(captured.body.prompt, /画面比例 16:9/);
  assert.equal(dataUrl, `data:image/webp;base64,${Buffer.from('fake-image').toString('base64')}`);

  setBaseValues();
  elements.get('outputFormat').value = 'auto';
  const autoConfig = context.getConfig();
  const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64');
  context.fetch = mockQueuedImageFetch({
    body: { data: [{ b64_json: pngBase64 }] },
    onSubmit(url, options) { captured = { url, options, body: JSON.parse(options.body) }; },
  });
  const autoDataUrl = await context.generateWithImagesApi(autoConfig, 1);
  assert.equal(Object.hasOwn(captured.body, 'output_format'), false);
  assert.equal(Object.hasOwn(captured.body, 'output_compression'), false);
  assert.equal(autoDataUrl, `data:image/png;base64,${pngBase64}`);

  setBaseValues();
  elements.get('baseUrl').value = 'https://example.test';
  elements.get('apiKey').value = 'test-key';
  const retryConfig = context.getConfig();
  let retryCalls = 0;
  context.fetch = async () => {
    retryCalls += 1;
    if (retryCalls === 1) {
      return {
        ok: false,
        status: 524,
        statusText: 'A timeout occurred',
        headers: { get: () => 'text/html' },
        text: async () => '<html><body>524: A timeout occurred</body></html>',
      };
    }
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('retry-image').toString('base64') }] }),
    };
  };
  const retryDataUrl = await context.generateWithImagesApi(retryConfig, 0);
  assert.equal(retryCalls, 2);
  assert.equal(retryDataUrl, `data:image/webp;base64,${Buffer.from('retry-image').toString('base64')}`);

  context.fetch = async () => ({
    ok: false,
    status: 524,
    statusText: 'A timeout occurred',
    headers: { get: () => 'text/html' },
    text: async () => '<html><body>ioll.pp.ua | 524: A timeout occurred</body></html>',
  });
  await assert.rejects(
    () => context.generateWithImagesApi(retryConfig, 0),
    /上游服务超时 524/
  );
}

testImagesApiSingleRequestPayload()
  .then(async () => {
    console.log('images api single-request test passed');
    setBaseValues();
    elements.get('imageCount').value = '3';
    const config = context.getConfig();
    const calls = [];
    const added = [];
    context.fetch = async (url, options = {}) => {
      if (url === '/api/jobs/images/generations') {
        calls.push({ url, body: JSON.parse(options.body) });
        return {
          ok: true,
          status: 202,
          json: async () => ({ id: `job-${calls.length}`, status: 'succeeded', position: 0, activeCount: 0, queuedCount: 0, maxConcurrency: 2, averageMs: 90000, estimatedWaitMs: 0 }),
        };
      }
      const match = String(url).match(/^\/api\/jobs\/job-(\d+)\/result$/);
      if (match) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: [{ b64_json: Buffer.from(`fake-image-${match[1]}`).toString('base64') }] }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    context.addGeneratedResult = async (dataUrl, passedConfig, index) => {
      added.push({ dataUrl, index, imageCount: passedConfig.imageCount });
    };
    for (let index = 0; index < config.imageCount; index += 1) {
      const dataUrl = await context.generateWithImagesApi(config, index);
      await context.addGeneratedResult(dataUrl, config, index);
    }
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((call) => call.body.n), [1, 1, 1]);
    assert.deepEqual(added.map((item) => item.index), [0, 1, 2]);
    console.log('images api multi-request flow test passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
