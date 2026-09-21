import { createServer } from 'node:http';
import { mkdtemp, mkdir, cp, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PNG_BASE64 } from './fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_PASSWORD = 'isolated-test-password';
export const TEST_ADMIN_PASSWORD = 'isolated-admin-password';
export async function until(check, message = 'condition', timeout = 8000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${message}`);
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
export async function startHarness({ serveDist = false, imageMode = 'images', cookieNamespace = '' } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sprout-server-test-'));
  const calls = [];
  const pendingResponses = new Set();
  const controls = { respond: null };
  const upstream = createServer((req, res) => {
    pendingResponses.add(res);
    res.on('close', () => pendingResponses.delete(res));
    void (async () => {
      const buffers = [];
      for await (const chunk of req) buffers.push(chunk);
      const body = Buffer.concat(buffers);
      const call = { path: req.url, headers: req.headers, body, json: (req.headers['content-type'] || '').includes('application/json') ? JSON.parse(body.toString()) : null };
      calls.push(call);
      if (controls.respond && await controls.respond(call, res)) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.endsWith('/responses')) res.end(JSON.stringify({ output: [{ type: 'image_generation_call', id: `image-${calls.length}`, result: PNG_BASE64 }] }));
      else if (req.url.endsWith('/chat/completions')) res.end(JSON.stringify({ choices: [{ message: { content: '一片绿色的叶子' } }] }));
      else res.end(JSON.stringify({ created: 1700000000, data: [{ b64_json: PNG_BASE64, revised_prompt: '一片绿色的叶子' }] }));
    })().catch((error) => { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  await cp(path.join(ROOT, 'server.mjs'), path.join(directory, 'server.mjs'));
  await cp(path.join(ROOT, 'server'), path.join(directory, 'server'), { recursive: true });
  await cp(path.join(ROOT, 'shared'), path.join(directory, 'shared'), { recursive: true });
  await mkdir(path.join(directory, 'config'));
  if (serveDist) await symlink(path.join(ROOT, 'dist'), path.join(directory, 'dist'), 'dir');
  const port = await freePort();
  const config = {
    host: '127.0.0.1', port, adminPassword: TEST_ADMIN_PASSWORD, cookieNamespace, dataDir: 'data', stateFile: 'data/runtime.sqlite', imageConcurrency: 1,
    defaultImageProvider: 'primary',
    imageProviders: ['primary', 'secondary'].map((id) => ({ id, name: id, baseUrl: `${upstreamUrl}/${id}`, apiKey: `fixture-${id}-key`, imageModel: imageMode === 'images' ? 'gpt-image-2' : 'gpt-5', generationMode: imageMode, capabilities: { outputFormats: ['png', 'jpeg', 'webp'], exactSize: false, transparent: true } })),
    textProviders: [{ id: 'text', name: 'text', baseUrl: upstreamUrl, apiKey: 'fixture-text-key', model: 'text-fixture' }],
  };
  await writeFile(path.join(directory, 'config/local.config.json'), JSON.stringify(config));
  let child, output = '';
  const base = `http://127.0.0.1:${port}`;
  async function start() {
    output = '';
    child = spawn(process.execPath, ['server.mjs'], { cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-16000); });
    child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-16000); });
    await until(async () => {
      if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
      try { return (await fetch(`${base}/health`)).ok; } catch { return false; }
    }, 'test server boot');
  }
  async function stop(signal = 'SIGTERM', timeout = 5000) {
    if (!child || child.exitCode !== null || child.signalCode) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill(signal);
    await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Test server did not stop')), timeout).unref())]);
  }
  async function api(url, { cookie, body, rawBody, headers = {}, method = 'GET' } = {}) {
    const response = await fetch(`${base}${url}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...((body !== undefined || rawBody !== undefined) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  }
  const browserKeys = new Map(); const sessions = new Map();
  const responseCookie = (response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  let accessCode;
  async function login(browser = 'browser-one', code = accessCode) {
    const result = await api('/api/auth/login', { method: 'POST', cookie: browserKeys.get(browser), body: { code } });
    if (result.status !== 200) throw new Error(`Test login failed: ${result.status}`);
    const cookie = responseCookie(result);
    browserKeys.set(browser, result.headers.getSetCookie().find((value) => value.startsWith('sprout_browser')).split(';')[0]);
    sessions.set(cookie, result.data);
    return cookie;
  }
  function quote(cookie, version) {
    const session = sessions.get(cookie);
    if (!session) throw new Error('Test fixture needs a logged-in browser');
    return { accessCodeId: session.accessCodeId, userId: session.userId, version: version || session.prices.version, unlimited: session.credits.unlimited };
  }
  function textInput(cookie, requestId = randomUUID()) {
    return { requestId, kind: 'prompt', creditQuote: quote(cookie), input: [{ role: 'user', content: [{ type: 'input_text', text: 'isolated' }] }] };
  }
  await start();
  const adminLogin = await api('/api/admin/auth/login', { method: 'POST', body: { password: TEST_ADMIN_PASSWORD } });
  if (adminLogin.status !== 200) throw new Error(`Test admin login failed: ${adminLogin.status}`);
  const adminCookie = responseCookie(adminLogin);
  const created = await api('/api/admin/access-codes', { method: 'POST', cookie: adminCookie, body: { requestId: randomUUID(), initialPoints: 1000000, note: '隔离验收', count: 1 } });
  if (created.status !== 201) throw new Error(`Test access code creation failed: ${created.status}`);
  const accessCodeRecord = created.data.codes[0]; accessCode = accessCodeRecord.code;
  return {
    directory, base, calls, controls, api, login, start, stop, config, accessCode, accessCodeRecord, adminCookie, quote, textInput, responseCookie,
    logs: () => output,
    close: async () => {
      for (const response of pendingResponses) response.destroy();
      try { await stop(); } catch { await stop('SIGKILL'); }
      upstream.closeAllConnections();
      await new Promise((resolve) => upstream.close(resolve));
    },
  };
}
