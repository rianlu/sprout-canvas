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
  crypto: globalThis.crypto,
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
  elements.get('background').value = 'opaque';
  elements.get('outputFormat').value = 'auto';
  elements.get('outputCompression').value = '90';
}

function assertConfig(expectedRequestSize) {
  const config = context.getConfig();
  assert.equal(config.size, expectedRequestSize);
  assert.equal(config.requestSize, expectedRequestSize);
  assert.equal(config.quality, 'high');
  assert.equal(config.outputFormat, 'auto');
  assert.equal(config.outputCompression, 90);
  const payload = context.buildImagesPayload(config, 1);
  assert.equal(payload.n, 1);
  if (expectedRequestSize === 'auto') {
    assert.equal(Object.hasOwn(payload, 'size'), false);
  } else {
    assert.equal(payload.size, expectedRequestSize);
  }
  assert.equal(payload.quality, 'high');
  assert.equal(Object.hasOwn(payload, 'output_format'), false);
  assert.equal(Object.hasOwn(payload, 'output_compression'), false);
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




console.log('parameter smoke tests passed');

