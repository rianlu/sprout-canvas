import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createImageDownloader, isPublicAddress } from '../server/image-download.mjs';
import { normalizeImageResult } from '../server/image-result.mjs';
import { PNG_BASE64 } from './fixtures.mjs';

function transport(routes) {
  const calls = [];
  const responses = [];
  return {
    calls, responses,
    request(url, options, callback) {
      const req = new EventEmitter();
      req.end = () => queueMicrotask(async () => {
        try {
          const addresses = await new Promise((resolve, reject) => options.lookup(url.hostname, { all: true }, (error, result) => error ? reject(error) : resolve(result)));
          calls.push({ url: url.href, options, addresses });
          const route = routes[url.href];
          if (!route) throw new Error('Unexpected mock destination');
          const response = Readable.from(route.chunks || [Buffer.from(PNG_BASE64, 'base64')]);
          response.statusCode = route.status || 200;
          response.headers = route.headers || {};
          responses.push(response);
          callback(response);
        } catch (error) { req.emit('error', error); }
      });
      return req;
    },
  };
}

test('download targets exclude private, reserved, metadata and IPv6 transition addresses', async () => {
  const blocked = [
    '0.0.0.0', '10.1.2.3', '100.100.100.200', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.168.1.1', '198.18.0.1',
    '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', 'fc00::1', 'fe80::1', 'ff02::1',
    '64:ff9b::7f00:1', '2001::1', '2001:db8::1', '2002:7f00:1::', '3fff::1',
  ];
  for (const address of blocked) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['8.8.8.8', '93.184.216.34', '2606:4700::1111']) assert.equal(isPublicAddress(address), true, address);
  const download = createImageDownloader({ lookup: () => assert.fail('Literal private IPs must not use DNS'), requestHttp: () => assert.fail('Private IPs must not connect') });
  for (const url of ['http://2130706433/a', 'http://0x7f000001/a', 'http://127.1/a', 'http://10.0.0.1/a', 'http://[::ffff:127.0.0.1]/a', 'file:///tmp/a', 'https://name:secret@example.test/a']) {
    await assert.rejects(download(url), /公开资源|HTTP\(S\)/);
  }
});

test('DNS answers are validated and pinned to the connection without forwarding credentials', async () => {
  const url = 'https://images.example/image.png?signature=fixture';
  const network = transport({ [url]: {} });
  let lookups = 0;
  const download = createImageDownloader({
    lookup: async () => { lookups++; return [{ address: lookups === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }]; },
    requestHttps: network.request,
  });
  assert.deepEqual(await download(url), Buffer.from(PNG_BASE64, 'base64'));
  assert.equal(lookups, 1);
  assert.equal(network.calls[0].addresses[0].address, '93.184.216.34');
  assert.equal(network.calls[0].options.agent, false);
  assert.equal(network.calls[0].options.headers.Authorization, undefined);
  assert.notEqual(network.calls[0].options.rejectUnauthorized, false);
  assert.equal(network.responses[0].destroyed, true);
});

test('a domain resolving to any private address never reaches the transport', async () => {
  const download = createImageDownloader({
    lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }],
    requestHttps: () => assert.fail('Mixed private DNS answers must not connect'),
  });
  await assert.rejects(download('https://images.example/a'), /公开资源/);
});

test('redirects are revalidated and private targets never receive a request', async () => {
  const source = 'https://images.example/a';
  const network = transport({ [source]: { status: 302, headers: { location: 'http://169.254.169.254/metadata' } } });
  const download = createImageDownloader({ lookup: async () => [{ address: '8.8.8.8', family: 4 }], requestHttps: network.request, requestHttp: network.request });
  await assert.rejects(download(source), /公开资源/);
  assert.equal(network.calls.length, 1);
  assert.equal(network.responses[0].destroyed, true);

  let lookups = 0;
  const rebound = transport({ [source]: { status: 302, headers: { location: '/b' } } });
  const downloadRebound = createImageDownloader({
    lookup: async () => [{ address: ++lookups === 1 ? '8.8.8.8' : '192.168.1.1', family: 4 }], requestHttps: rebound.request,
  });
  await assert.rejects(downloadRebound(source), /公开资源/);
  assert.equal(rebound.calls.length, 1);
});

test('public redirects work while loops and oversized streams stop within the budget', async () => {
  const network = transport({
    'https://images.example/a': { status: 302, headers: { location: '/b' } },
    'https://images.example/b': {},
    'https://images.example/loop': { status: 302, headers: { location: '/loop' } },
    'https://images.example/large': { chunks: [Buffer.alloc(8), Buffer.alloc(8)] },
    'https://images.example/declared': { headers: { 'content-length': '100' } },
  });
  const download = createImageDownloader({ lookup: async () => [{ address: '8.8.8.8', family: 4 }], requestHttps: network.request });
  assert.deepEqual(await download('https://images.example/a'), Buffer.from(PNG_BASE64, 'base64'));
  const before = network.calls.length;
  await assert.rejects(download('https://images.example/loop', { maxRedirects: 2 }), /重定向/);
  assert.equal(network.calls.length - before, 3);
  for (const name of ['large', 'declared']) await assert.rejects(download(`https://images.example/${name}`, { maxBytes: 10 }), /过大/);
  assert.ok(network.responses.every((response) => response.destroyed));
});

test('DNS resolution obeys the total timeout and blocked results are never retried as paid generation', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const download = createImageDownloader({ lookup: () => new Promise(() => {}), requestHttps: () => assert.fail('Timed-out DNS must not connect') });
    await assert.rejects(download('https://images.example/a', { timeoutMs: 15 }), /超时/);
  } finally { clearTimeout(keepAlive); }
  const result = await normalizeImageResult({ ok: true, body: Buffer.from(JSON.stringify({ data: [{ url: 'http://192.168.1.1/a' }] })) });
  assert.equal(result.status, 502);
  assert.equal(result.outcomeUnknown, true);
  assert.match(result.error, /未自动重复生成/);
});
