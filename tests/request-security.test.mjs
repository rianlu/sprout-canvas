import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStateStore } from '../server/state-store.mjs';
import { createWindowLimiter, createTextLimiter, requireSameOrigin } from '../server/request-guards.mjs';
import { startHarness, until } from './server-harness.mjs';
import { submission } from './fixtures.mjs';
import { secretHash } from '../server/credits-store.mjs';
import { randomUUID } from 'node:crypto';

test('request origins reject other sites and ports without trusting forwarding headers', () => {
  const req = (headers) => ({ headers: { host: 'canvas.example', ...headers } });
  for (const origin of ['https://canvas.example', 'http://canvas.example']) requireSameOrigin(req({ origin }));
  requireSameOrigin(req({}));
  requireSameOrigin(req({ 'sec-fetch-site': 'same-origin' }));
  for (const headers of [
    { origin: 'https://other.example', 'x-forwarded-host': 'other.example' },
    { origin: 'https://canvas.example:9000' },
    { origin: 'https://canvas.example/path' },
    { origin: 'null' },
    { origin: 'https://canvas.example', 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ]) assert.throws(() => requireSameOrigin(req(headers)), { statusCode: 403 });
});

test('rate limits expire, reset and remain bounded when new identities arrive', () => {
  let clock = 0;
  const limiter = createWindowLimiter({ limit: 2, windowMs: 1000, maxKeys: 2, now: () => clock });
  limiter.take('one', 'limited'); limiter.take('one', 'limited');
  assert.throws(() => limiter.take('one', 'limited'), { statusCode: 429, retryAfterSeconds: 1 });
  limiter.take('two', 'limited');
  assert.throws(() => limiter.take('three', 'limited'), { statusCode: 429 });
  limiter.reset('one'); limiter.take('three', 'limited');
  clock = 1001;
  limiter.take('four', 'limited');
  limiter.take('one', 'limited');
});

test('text admission bounds concurrent work and both per-user and global frequency', () => {
  let clock = 0;
  const limiter = createTextLimiter({ now: () => clock });
  const one = limiter.acquire('one');
  assert.throws(() => limiter.acquire('one'), { statusCode: 429 });
  const two = limiter.acquire('two');
  assert.throws(() => limiter.acquire('three'), { statusCode: 429 });
  one();
  const replacement = limiter.acquire('one');
  one(); // An old completion must not release a newer task for the same user.
  assert.throws(() => limiter.acquire('one'), { statusCode: 429 });
  replacement(); two();
  clock = 60001;
  for (let index = 0; index < 10; index++) limiter.acquire('one')();
  assert.throws(() => limiter.acquire('one'), { statusCode: 429 });
  for (let index = 0; index < 20; index++) limiter.acquire(`other-${index}`)();
  assert.throws(() => limiter.acquire('fresh'), { statusCode: 429 });
  clock += 60001;
  limiter.acquire('fresh')();
});

test('legacy sessions preserve trusted task ownership without retaining shared-password authorization', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sprout-auth-upgrade-'));
  const filename = path.join(directory, 'state.sqlite');
  const old = new DatabaseSync(filename);
  old.exec('CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
  old.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(secretHash('legacy-session'), 'owner', Date.now(), Date.now() + 100000);
  old.close();
  let store = createStateStore(filename);
  try {
    store.saveJob({ id: 'retained-job', userId: 'owner', status: 'succeeded' });
    assert.equal(store.identities.session('legacy-session'), null);
    const access = store.credits.create({ requestId: randomUUID(), initialPoints: 100 }).codes[0];
    const login = store.identities.login(access.code, { previousToken: 'legacy-session' });
    assert.equal(login.session.userId, 'owner');
    store.close(); store = createStateStore(filename);
    assert.equal(store.identities.session(login.token).canGenerate, true);
    const changed = store.credits.reset(access.id, { requestId: randomUUID(), version: 1, reason: 'rotation test' });
    assert.equal(store.identities.session(login.token).canGenerate, false);
    assert.throws(() => store.identities.login(access.code), /无效/);
    const restored = store.identities.login(changed.code, { browserToken: login.browserToken });
    assert.equal(restored.session.userId, 'owner');
    assert.equal(store.loadJobs()[0].id, 'retained-job');
  } finally { store.close(); }
});

test('access-code guessing is throttled without revoking existing sessions, and code reset survives restart', async () => {
  const app = await startHarness();
  try {
    const cookie = await app.login();
    for (let index = 0; index < 8; index++) {
      assert.equal((await app.api('/api/auth/login', { method: 'POST', body: { code: 'incorrect' } })).status, 401);
    }
    const blocked = await app.api('/api/auth/login', { method: 'POST', body: { code: app.accessCode }, headers: { 'X-Forwarded-For': '203.0.113.10' } });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal((await app.api('/api/config', { cookie })).status, 200);
    const reset = await app.api(`/api/admin/access-codes/${app.accessCodeRecord.id}/reset`, { method: 'POST', cookie: app.adminCookie, body: { requestId: randomUUID(), version: 1, reason: 'rotation test' } });
    assert.equal(reset.status, 200);
    assert.equal((await app.api('/api/auth/status', { cookie })).data.canGenerate, false);
    assert.equal((await app.api('/api/jobs', { method: 'POST', cookie, body: { ...submission('revoked'), creditQuote: app.quote(cookie) } })).status, 403);
    await app.stop(); await app.start();
    const replacement = await app.login('replacement', reset.data.code);
    assert.equal((await app.api('/api/auth/status', { cookie })).data.canGenerate, false);
    assert.equal((await app.api('/api/auth/status', { cookie: replacement })).data.canGenerate, true);
  } finally { await app.close(); }
});

test('browser write boundaries reject foreign origins and plain text before any upstream work', async () => {
  const app = await startHarness();
  try {
    const cookie = await app.login();
    const foreign = { Origin: 'https://other.example', 'Sec-Fetch-Site': 'same-site' };
    for (const [url, body] of [
      ['/api/auth/login', { code: app.accessCode }],
      ['/api/auth/logout', undefined], ['/api/jobs', submission('foreign')],
      ['/api/jobs/archive', undefined], ['/api/text', { input: 'isolated' }],
    ]) assert.equal((await app.api(url, { method: 'POST', cookie, body, headers: foreign })).status, 403);
    for (const contentType of ['text/plain', 'text/plain; application/json']) {
      for (const url of ['/api/auth/login', '/api/text']) {
        assert.equal((await app.api(url, { method: 'POST', cookie, rawBody: '{}', headers: { Origin: app.base, 'Content-Type': contentType } })).status, 415);
      }
    }
    assert.equal(app.calls.length, 0);
    assert.equal((await app.api('/api/config', { cookie })).status, 200);
    assert.equal((await app.api('/api/auth/logout', { method: 'POST', cookie, headers: { Origin: app.base } })).status, 200);
    assert.equal((await app.api('/api/config', { cookie })).status, 401);
  } finally { await app.close(); }
});

test('the development proxy preserves the browser origin for normal logins', async () => {
  const { createServer, loadConfigFromFile } = await import('vite');
  const app = await startHarness();
  let dev;
  try {
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, path.resolve('vite.config.mts'));
    const rule = loaded.config.server.proxy['/api'];
    dev = await createServer({
      configFile: false, root: app.directory, envDir: app.directory, cacheDir: path.join(app.directory, 'vite-cache'),
      logLevel: 'silent', server: { host: '127.0.0.1', port: 0, proxy: { '/api': typeof rule === 'string' ? app.base : { ...rule, target: app.base } } },
    });
    await dev.listen();
    const base = `http://127.0.0.1:${dev.httpServer.address().port}`;
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: app.accessCode }),
    });
    assert.equal(login.status, 200);
    await login.arrayBuffer();
    const foreign = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Origin: 'https://other.example' } });
    assert.equal(foreign.status, 403);
    await foreign.arrayBuffer();
  } finally { await dev?.close(); await app.close(); }
});

test('text requests enforce shared-user and global concurrency and release failed calls', async () => {
  const app = await startHarness();
  let release;
  try {
    const first = await app.login();
    const sameUser = await app.login();
    const second = await app.login('00000000-0000-4000-8000-000000000002');
    const third = await app.login('00000000-0000-4000-8000-000000000003');
    const gate = new Promise((resolve) => { release = resolve; });
    app.controls.respond = async (_call, res) => {
      await gate;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'isolated response' } }] }));
      return true;
    };
    const text = (cookie) => app.api('/api/text', { method: 'POST', cookie, body: app.textInput(cookie) });
    const one = text(first);
    await until(() => app.calls.length === 1);
    assert.equal((await text(sameUser)).status, 429);
    const two = text(second);
    await until(() => app.calls.length === 2);
    assert.equal((await text(third)).status, 429);
    assert.equal(app.calls.length, 2);
    release();
    assert.equal((await one).status, 200); assert.equal((await two).status, 200);
    assert.equal((await text(third)).status, 200);
    app.controls.respond = async (_call, res) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'fixture failure' } })); return true; };
    const failure = await text(first);
    assert.equal(failure.status, 502); assert.equal(failure.data.credit.state, 'refunded');
    app.controls.respond = async (_call, res) => { res.writeHead(500); res.end('fixture gateway failure'); return true; };
    const unknown = await text(first);
    assert.equal(unknown.status, 409); assert.equal(unknown.data.credit.state, 'unknown');
    app.controls.respond = async (_call, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] })); return true; };
    assert.equal((await text(first)).status, 200);
  } finally { release?.(); await app.close(); }
});
