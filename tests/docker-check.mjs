import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, { maxBuffer: 1024 * 1024 })).stdout.trim();
const image = process.env.SPROUT_TEST_IMAGE || 'sprout-canvas:verify';
const directory = await mkdtemp(path.join(tmpdir(), 'sprout-docker-check-'));
const output = process.env.SPROUT_TEST_OUTPUT || directory;
for (const name of ['config', 'data', 'logs']) await mkdir(path.join(directory, name));
await mkdir(output, { recursive: true });
const password = 'isolated-container-password';
await writeFile(path.join(directory, 'config/local.config.json'), JSON.stringify({
  defaultImageProvider: 'fixture', accessPassword: password, imageConcurrency: 1,
  imageProviders: [{ id: 'fixture', name: '容器验证通道', baseUrl: 'http://127.0.0.1:9', apiKey: 'fixture-container-image-key', imageModel: 'gpt-image-2', generationMode: 'images', capabilities: { outputFormats: ['png'], exactSize: false } }],
  textProviders: [{ id: 'fixture-text', name: '容器验证文本通道', baseUrl: 'http://127.0.0.1:9', apiKey: 'fixture-container-text-key', model: 'fixture-text-model' }],
}), { mode: 0o600 });
const name = `sprout-canvas-verify-${process.pid}`;
let started = false;
let browser;
async function waitFor(check, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out: ${message}`);
}
try {
  await docker('run', '-d', '--rm', '--name', name, '--health-interval=2s', '--health-start-period=1s', '-p', '127.0.0.1::8787',
    '-v', `${path.join(directory, 'config')}:/app/config:ro`, '-v', `${path.join(directory, 'data')}:/app/data`, '-v', `${path.join(directory, 'logs')}:/app/logs`, image);
  started = true;
  const containerUrl = async () => `http://127.0.0.1:${JSON.parse(await docker('inspect', name))[0].NetworkSettings.Ports['8787/tcp'][0].HostPort}`;
  let base = await containerUrl();
  const healthy = async () => { try { return (await fetch(`${base}/ready`)).ok; } catch { return false; } };
  await waitFor(healthy, 'container ready');
  assert.equal((await fetch(`${base}/api/config`)).status, 401);
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, userId: randomUUID() }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const config = await (await fetch(`${base}/api/config`, { headers: { Cookie: cookie } })).json();
  assert.equal(config.imageConcurrency, 1);
  assert.deepEqual(config.imageCapabilities.formats, ['png']);
  assert.doesNotMatch(JSON.stringify(config), /fixture-container-.*key|apiKey/);
  const html = await (await fetch(base)).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:js|css))"/g)].map((match) => match[1]);
  assert.ok(assets.some((asset) => asset.endsWith('.css')) && assets.some((asset) => asset.endsWith('.js')));
  const hashes = {};
  for (const asset of assets) {
    const response = await fetch(`${base}${asset}`);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    const expected = await readFile(new URL(`../dist${asset}`, import.meta.url));
    hashes[asset] = createHash('sha256').update(bytes).digest('hex');
    assert.equal(hashes[asset], createHash('sha256').update(expected).digest('hex'), 'container and local build assets must match');
  }
  const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByLabel('访问密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.studio-rail textarea').waitFor();
  assert.equal(await page.locator('.studio-rail').evaluate((element) => Math.round(element.getBoundingClientRect().width)), 440);
  assert.equal(await page.getByRole('button', { name: 'PNG', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'WebP', exact: true }).count(), 0);
  await page.evaluate(async () => document.fonts.ready);
  await page.screenshot({ path: path.join(output, 'container-studio.png') });
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '风格库', exact: true }).click();
  await page.getByRole('button', { name: /全部 36/ }).waitFor();
  assert.equal(await page.locator('main article').count(), 36);
  await page.waitForFunction(() => [...document.querySelectorAll('main article img')].slice(0, 3).every((image) => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: path.join(output, 'container-styles.png') });
  assert.deepEqual(errors, []);
  await browser.close(); browser = undefined;
  const nodeVersion = await docker('exec', name, 'node', '--version');
  assert.match(nodeVersion, /^v22\./);
  await docker('restart', '--time', '10', name);
  base = await containerUrl();
  await waitFor(healthy, 'container ready after restart');
  const status = await (await fetch(`${base}/api/auth/status`, { headers: { Cookie: cookie } })).json();
  assert.equal(status.authenticated, true, 'session must survive container restart');
  await waitFor(async () => (await docker('inspect', '--format', '{{.State.Health.Status}}', name)) === 'healthy', 'Docker healthcheck');
  const database = await readFile(path.join(directory, 'data/runtime.sqlite'));
  assert.equal(database.includes(Buffer.from(cookie.split('=')[1])), false);
  await writeFile(path.join(output, 'docker-report.json'), JSON.stringify({ image, nodeVersion, passed: ['生产环境启动与鉴权', '单 worker 与通道格式约束', '容器/本地 JS 与 CSS 哈希一致', '桌面页面与 36 款风格图片', 'SQLite 会话跨重启恢复', 'Docker 健康检查'], assetHashes: hashes, directory }, null, 2));
  console.log(JSON.stringify({ passed: 6, nodeVersion, artifacts: output }));
} finally {
  if (browser) await browser.close();
  if (started) await docker('stop', '--time', '10', name);
}
