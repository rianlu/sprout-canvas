import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { png, PNG_BASE64, submission } from './fixtures.mjs';

const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, { maxBuffer: 1024 * 1024 })).stdout.trim();
const image = process.env.SPROUT_TEST_IMAGE || 'sprout-canvas:verify';
const directory = await mkdtemp(path.join(tmpdir(), 'sprout-docker-check-'));
const output = process.env.SPROUT_TEST_OUTPUT || directory;
for (const name of ['config', 'logs']) await mkdir(path.join(directory, name));
await mkdir(output, { recursive: true });
const adminPassword = 'isolated-container-admin-password';
await writeFile(path.join(directory, 'config/local.config.json'), JSON.stringify({
  defaultImageProvider: 'fixture', adminPassword, dataDir: 'data', imageConcurrency: 1,
  imageProviders: [{ id: 'fixture', name: '容器验证通道', baseUrl: 'http://127.0.0.1:19876', apiKey: 'fixture-container-image-key', imageModel: 'gpt-image-2', generationMode: 'images', capabilities: { outputFormats: ['png'], exactSize: false } }],
  textProviders: [{ id: 'fixture-text', name: '容器验证文本通道', baseUrl: 'http://127.0.0.1:19876', apiKey: 'fixture-container-text-key', model: 'fixture-text-model' }],
}), { mode: 0o600 });
const name = `sprout-canvas-verify-${process.pid}-${randomUUID().slice(0, 8)}`;
const dataVolume = `${name}-data`;
const restoredVolume = `${name}-restored`;
let started = false;
let volumeCreated = false;
let restoredCreated = false;
let browser;
async function waitFor(check, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out: ${message}`);
}
async function stopContainer() {
  if (!started) return;
  await docker('stop', '--time', '10', name);
  // Docker may return from stop before --rm has released the name and volumes.
  await waitFor(async () => !(await docker('ps', '--all', '--quiet', '--filter', `name=^/${name}$`)), 'stopped container removed');
  started = false;
}
try {
  await docker('volume', 'create', dataVolume);
  volumeCreated = true;
  await docker('run', '-d', '--rm', '--name', name, '--health-interval=2s', '--health-start-period=1s', '-p', '127.0.0.1::8787',
    '-v', `${path.join(directory, 'config')}:/app/config:ro`, '-v', `${dataVolume}:/app/data`, '-v', `${path.join(directory, 'logs')}:/app/logs`, image);
  started = true;
  const containerUrl = async () => `http://127.0.0.1:${JSON.parse(await docker('inspect', name))[0].NetworkSettings.Ports['8787/tcp'][0].HostPort}`;
  let base = await containerUrl();
  const healthy = async () => { try { return (await fetch(`${base}/ready`)).ok; } catch { return false; } };
  await waitFor(healthy, 'container ready');
  let adminCookie = '';
  const request = async (url, { method = 'GET', body, cookie: authCookie = adminCookie } = {}) => {
    const response = await fetch(base + url, { method, headers: { Cookie: authCookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const adminLogin = await request('/api/admin/auth/login', { method: 'POST', cookie: '', body: { password: adminPassword } });
  assert.equal(adminLogin.status, 200);
  adminCookie = adminLogin.headers.getSetCookie()[0].split(';')[0];
  const initialCodes = await request('/api/admin/access-codes');
  assert.equal(initialCodes.data.total, 0, 'a new deployment does not grant any access code or balance');
  const createdCode = await request('/api/admin/access-codes', { method: 'POST', body: { requestId: randomUUID(), initialPoints: 50, note: '容器额度验收' } });
  assert.equal(createdCode.status, 201);
  const accessCode = createdCode.data.codes[0];
  assert.equal((await fetch(`${base}/api/config`)).status, 401);
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: accessCode.code }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const identity = await login.json();
  assert.equal(identity.accessName, '容器额度验收');
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
  await page.getByLabel('访问码', { exact: true }).fill(accessCode.code);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  await page.locator('.studio-rail textarea').waitFor();
  assert.equal(await page.locator('.studio-rail').evaluate((element) => Math.round(element.getBoundingClientRect().width)), 440);
  await page.getByText('上游暂不支持修改, 将使用默认值', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('当前生成格式', { exact: true }).innerText(), 'PNG');
  assert.equal(await page.getByRole('group', { name: '生成格式', exact: true }).getByRole('button').count(), 0);
  assert.ok(await page.getByRole('button', { name: '新建创作', exact: true }).isVisible());
  await page.evaluate(async () => document.fonts.ready);
  await page.screenshot({ path: path.join(output, 'container-studio.png') });
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '风格库', exact: true }).click();
  await page.getByRole('button', { name: /全部 36/ }).waitFor();
  assert.equal(await page.locator('main article').count(), 36);
  await page.waitForFunction(() => [...document.querySelectorAll('main article img')].slice(0, 3).every((image) => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: path.join(output, 'container-styles.png') });
  await page.goto(base + '/#admin');
  await page.getByLabel('管理员密码', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: '登录管理后台', exact: true }).click();
  await page.getByRole('region', { name: '后台概览统计' }).waitFor();
  const overview = await request('/api/admin/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.data.styles.total, 36);
  assert.equal(overview.data.accessCodes.total, 1);
  assert.equal(overview.data.usage.points, 0);
  assert.equal(overview.data.usagePeriods.today.points, 0);
  assert.equal(overview.data.usagePeriods.month.points, 0);
  assert.equal(overview.data.activity.timeZone, 'Asia/Shanghai');
  assert.equal(overview.data.activity.days.length, 365);
  await page.getByRole('region', { name: '创作活跃度', exact: true }).waitFor();
  assert.equal((await request('/api/admin/overview', { cookie })).status, 401);
  await page.screenshot({ path: path.join(output, 'container-admin-dashboard.png') });
  await page.getByRole('navigation', { name: '后台导航' }).getByRole('button', { name: '访问码管理', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '管理访问码 容器额度验收', exact: true }).waitFor();
  await page.getByRole('button', { name: '用量明细 容器额度验收', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '用量明细', exact: true });
  await dialog.getByText(`管理操作 · 初始额度 +${accessCode.available} 点`, { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: '管理访问码', exact: true }).count(), 0);
  await dialog.getByLabel('关闭访问码弹窗').click();
  await page.getByRole('button', { name: '管理访问码 容器额度验收', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '管理访问码', exact: true });
  await dialog.getByRole('switch', { name: '无限额度', exact: true }).check();
  assert.equal(await dialog.getByLabel('调整点数 (正数追加, 负数扣减)', { exact: true }).isDisabled(), true);
  await dialog.getByLabel('关闭访问码弹窗').click();
  assert.deepEqual(errors, []);
  await browser.close(); browser = undefined;
  assert.equal((await request('/api/admin/styles', { cookie })).status, 401);
  assert.equal((await request('/api/jobs/me')).status, 401);
  await docker('exec', '--detach', name, 'node', '--input-type=module', '-e', `
    import { createServer } from 'node:http';
    const image = process.argv[1];
    createServer(async (req,res) => {
      for await (const _ of req) {}
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(JSON.stringify(req.url.includes('chat/completions') ? { choices:[{message:{content:'隔离文字结果'}}] } : { data:[{b64_json:image}] }));
    }).listen(19876,'127.0.0.1');
  `, PNG_BASE64);
  await waitFor(async () => { try { await docker('exec', name, 'node', '-e', "fetch('http://127.0.0.1:19876/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"); return true; } catch { return false; } }, 'container virtual upstream');
  const creditQuote = { accessCodeId: identity.accessCodeId, userId: identity.userId, version: 1 };
  const inputs = [submission(randomUUID()), submission(randomUUID())].map((input) => ({ ...input, creditQuote }));
  const accepted = await request('/api/jobs/batch', { cookie, method: 'POST', body: { jobs: inputs } });
  assert.equal(accepted.status, 202);
  await waitFor(async () => (await request('/api/jobs/me', { cookie })).data.jobs.every((job) => job.status === 'succeeded'), 'container batch generation');
  assert.equal((await request('/api/text', { cookie, method: 'POST', body: { requestId: randomUUID(), kind: 'prompt', creditQuote, input: [{ role: 'user', content: [{ type: 'input_text', text: '容器文字测试' }] }] } })).data.credit.state, 'charged');
  assert.equal((await request('/api/admin/credit-prices', { method: 'PUT', body: { requestId: randomUUID(), image: 12, text: 2, version: 1 } })).status, 200);
  const disabled = (await request('/api/admin/access-codes', { method: 'POST', body: { requestId: randomUUID(), initialPoints: 0, note: '持久停用验证' } })).data.codes[0];
  assert.equal((await request(`/api/admin/access-codes/${disabled.id}`, { method: 'PATCH', body: { requestId: randomUUID(), version: 1, enabled: false } })).status, 200);
  const unlimited = (await request('/api/admin/access-codes', { method: 'POST', body: { requestId: randomUUID(), initialPoints: 0, unlimited: true, note: '无限额度持久化' } })).data.codes[0];
  const freeLogin = await request('/api/auth/login', { cookie: '', method: 'POST', body: { code: unlimited.code } });
  assert.equal(freeLogin.status, 200);
  const freeCookie = freeLogin.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const freeQuote = { accessCodeId: unlimited.id, userId: freeLogin.data.userId, version: 2, unlimited: true };
  const freeJob = await request('/api/jobs', { cookie: freeCookie, method: 'POST', body: { ...submission(randomUUID()), creditQuote: freeQuote } });
  assert.equal(freeJob.status, 202);
  await waitFor(async () => (await request(`/api/jobs/${freeJob.data.id}`, { cookie: freeCookie })).data.status === 'succeeded', 'unlimited container generation');
  assert.equal((await request('/api/text', { cookie: freeCookie, method: 'POST', body: { requestId: randomUUID(), kind: 'prompt', creditQuote: freeQuote, input: [{ role: 'user', content: [{ type: 'input_text', text: '无限额度文字验证' }] }] } })).data.credit.unlimited, true);
  const expectedUnlimited = (await request('/api/credits', { cookie: freeCookie })).data;
  assert.deepEqual([expectedUnlimited.credits.available, expectedUnlimited.credits.reserved, expectedUnlimited.credits.spent], [0, 0, 14]);
  const deleted = (await request('/api/admin/access-codes', { method: 'POST', body: { requestId: randomUUID(), initialPoints: 3, note: '删除状态持久化' } })).data.codes[0];
  assert.equal((await request(`/api/admin/access-codes/${deleted.id}`, { method: 'DELETE', body: { requestId: randomUUID(), version: 1 } })).status, 200);
  const expectedCredits = (await request('/api/credits', { cookie })).data;
  assert.deepEqual([expectedCredits.credits.available, expectedCredits.credits.reserved, expectedCredits.credits.spent], [29, 0, 21]);
  const expectedLedger = (await request(`/api/admin/access-codes/${accessCode.id}/ledger`)).data;
  const assertCredits = async () => {
    assert.deepEqual((await request('/api/credits', { cookie })).data, expectedCredits);
    assert.deepEqual((await request(`/api/admin/access-codes/${accessCode.id}/ledger`)).data, expectedLedger);
    assert.equal((await request(`/api/admin/access-codes/${disabled.id}`)).data.accessCode.enabled, false);
    assert.equal((await request('/api/admin/access-codes')).data.total, 3);
    assert.equal((await request(`/api/admin/access-codes/${unlimited.id}`)).data.accessCode.unlimited, true);
    assert.deepEqual((await request('/api/credits', { cookie: freeCookie })).data, expectedUnlimited);
    assert.equal((await request(`/api/admin/access-codes/${deleted.id}`)).status, 404);
    assert.equal((await request('/api/auth/login', { cookie: '', method: 'POST', body: { code: deleted.code } })).status, 401);
    assert.equal((await request('/api/auth/login', { cookie: '', method: 'POST', body: { code: accessCode.code } })).status, 200, 'a valid login resets the failed-login counter before the separate rate-limit check');
  };
  const initialStyles = (await request('/api/admin/styles')).data.styles;
  const editable = (record, patch = {}) => ({ ...Object.fromEntries(['name', 'prompt', 'author', 'category', 'sourceUrl', 'published', 'sortOrder', 'version'].map((key) => [key, record[key]])), ...patch });
  const editedSeed = await request('/api/admin/styles/' + initialStyles[0].id, { method: 'PUT', body: editable(initialStyles[0], { name: '容器编辑后保留' }) });
  assert.equal(editedSeed.status, 200);
  const deletedSeed = initialStyles[1];
  assert.equal((await request('/api/admin/styles/' + deletedSeed.id, { method: 'DELETE', body: { version: deletedSeed.version } })).status, 200);
  const example = png(64, 48);
  const created = await request('/api/admin/styles', { method: 'POST', body: { name: '容器录入示例', prompt: 'Container style.\n保留原文与示例图.', author: '容器测试作者', imageDataUrl: 'data:image/png;base64,' + example.toString('base64') } });
  assert.equal(created.status, 201);
  const style = created.data.style;
  const archive = (await request('/api/admin/styles/export')).data;
  const expectedCatalog = (await request('/api/admin/styles')).data;
  const assertStyles = async () => {
    assert.deepEqual((await request('/api/admin/styles')).data, expectedCatalog);
    const publicStyles = (await request('/api/styles', { cookie })).data.styles;
    assert.ok(publicStyles.some((item) => item.name === '容器编辑后保留'));
    assert.ok(!publicStyles.some((item) => item.id === deletedSeed.id), 'deleted seeds must not be resurrected');
    const image = await fetch(base + style.image, { headers: { Cookie: adminCookie } });
    assert.equal(image.status, 200);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), example, 'the persisted example must retain its exact bytes');
  };
  const nodeVersion = await docker('exec', name, 'node', '--version');
  assert.match(nodeVersion, /^v22\./);
  await docker('restart', '--time', '10', name);
  base = await containerUrl();
  await waitFor(healthy, 'container ready after restart');
  const status = await (await fetch(`${base}/api/auth/status`, { headers: { Cookie: cookie } })).json();
  assert.equal(status.authenticated, true, 'session must survive container restart');
  assert.equal((await request('/api/admin/auth/status')).data.authenticated, true);
  await assertStyles();
  await assertCredits();
  await stopContainer();
  await docker('run', '-d', '--rm', '--name', name, '--health-interval=2s', '--health-start-period=1s', '-p', '127.0.0.1::8787',
    '-v', path.join(directory, 'config') + ':/app/config:ro', '-v', dataVolume + ':/app/data', '-v', path.join(directory, 'logs') + ':/app/logs', image);
  started = true;
  base = await containerUrl();
  await waitFor(healthy, 'container ready after recreation with the same data volume');
  await assertStyles();
  await assertCredits();
  assert.equal((await request('/api/admin/styles/' + style.id, { method: 'DELETE', body: { version: style.version } })).status, 200);
  const importPreview = await request('/api/admin/styles/import?preview=1', { method: 'POST', body: { archive } });
  assert.equal(importPreview.data.added, 1);
  const imported = await request('/api/admin/styles/import', { method: 'POST', body: { archive, revision: importPreview.data.revision } });
  assert.equal(imported.status, 200);
  assert.deepEqual(Buffer.from(await (await fetch(base + style.image, { headers: { Cookie: adminCookie } })).arrayBuffer()), example);
  await waitFor(async () => (await docker('inspect', '--format', '{{.State.Health.Status}}', name)) === 'healthy', 'Docker healthcheck');
  // Inspect private files as the service user, not the owner of the host checkout.
  await docker('exec', name, 'node', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFile, stat } from 'node:fs/promises';
    for (const [file, ...tokens] of JSON.parse(process.argv[1])) {
      assert.equal((await stat(file)).mode & 0o777, 0o600, 'session databases must remain private');
      for (const token of tokens) assert.equal((await readFile(file)).includes(Buffer.from(token)), false, 'tokens and access codes must not be stored in plaintext');
    }
  `, JSON.stringify([
    ['/app/data/runtime.sqlite', cookie.split('=')[1], accessCode.code],
    ['/app/data/styles/library.sqlite', adminCookie.split('=')[1]],
  ]));
  await docker('run', '--rm', '--user', '65534:65534',
    '-v', dataVolume + ':/app/data:ro', image,
    'node', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { readFile } from 'node:fs/promises';
      for (const file of ['/app/data/runtime.sqlite', '/app/data/styles/library.sqlite']) {
        await assert.rejects(readFile(file), { code: 'EACCES' });
      }
    `);
  await stopContainer();
  await docker('volume', 'create', restoredVolume); restoredCreated = true;
  await docker('run', '--rm', '-v', `${dataVolume}:/source:ro`, '-v', `${restoredVolume}:/restore`, image, 'node', '--input-type=module', '-e', "import { cpSync } from 'node:fs'; cpSync('/source', '/restore', { recursive: true });");
  await docker('run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::8787', '-v', `${path.join(directory, 'config')}:/app/config:ro`, '-v', `${restoredVolume}:/app/data`, '-v', `${path.join(directory, 'logs')}:/app/logs`, image);
  started = true; base = await containerUrl(); await waitFor(healthy, 'restored container');
  await assertCredits();
  assert.equal((await request('/api/admin/styles')).data.styles.length, 36);
  for (let index = 0; index < 8; index++) assert.equal((await request('/api/auth/login', { cookie: '', method: 'POST', body: { code: 'invalid-code' } })).status, 401);
  assert.equal((await request('/api/auth/login', { cookie: '', method: 'POST', body: { code: accessCode.code } })).status, 429);
  assert.equal((await request('/api/auth/status', { cookie })).data.authenticated, true, 'container login throttling leaves existing sessions intact');
  const checks = ['生产环境启动与访问码鉴权, 首次启动不发码', '单 worker 与通道格式约束', '容器/本地 JS 与 CSS 哈希一致', '桌面页面与动态初始风格图片', 'SQLite 会话跨重启恢复与私有文件权限', 'Docker 健康检查', '管理权限隔离与增删改', '重建容器保留风格文本/图片且不恢复已删除种子', '风格备份预览与图片恢复', '图片与文字虚拟调用结算, 重启与重建保留账本/点值/停用状态', '停机复制完整数据卷后恢复访问码与账本', 'Docker 入口登录限流且保留已登录会话'];
  checks.push('无限额度零余额图片/文字使用, 无限状态与删除标记跨重启/重建/整卷恢复保留');
  await writeFile(path.join(output, 'docker-report.json'), JSON.stringify({ image, nodeVersion, passed: checks, assetHashes: hashes, directory, dataVolume }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, nodeVersion, artifacts: output }));
} finally {
  if (browser) await browser.close();
  await stopContainer();
  if (volumeCreated) await docker('volume', 'rm', dataVolume);
  if (restoredCreated) await docker('volume', 'rm', restoredVolume);
}
