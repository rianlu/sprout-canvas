import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startHarness, TEST_ADMIN_PASSWORD, until } from './server-harness.mjs';

const output = path.join(process.env.SPROUT_TEST_OUTPUT || tmpdir(), 'credits-browser');
await mkdir(output, { recursive: true });
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const checks = [], errors = [], pages = [];
let releaseImage;
const photo = await readFile(new URL('../public/assets/stitch/studio-01.jpg', import.meta.url));
app.controls.respond = (call, res) => {
  if (!call.path.includes('/images/')) return false;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [{ b64_json: photo.toString('base64') }] })); return true;
};
async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message)); pages.push(page); return page;
}
async function api(page, url, method = 'GET', body) {
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }, { url, method, body });
}
async function rows(page, store = 'records') {
  return page.evaluate((store) => new Promise((resolve, reject) => {
    const open = indexedDB.open('img-gen-gallery'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result; const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => { resolve(request.result); db.close(); }; request.onerror = () => reject(request.error); };
  }), store);
}
const card = (page, name) => page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
const auth = async (page) => (await api(page, '/api/auth/status')).data;
async function signIn(page, code) {
  await page.goto(app.base); await page.getByLabel('访问码', { exact: true }).fill(` ${code} `);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  await page.locator('.studio-rail textarea').waitFor();
}
async function signInAdmin(page) {
  await page.getByLabel('管理员密码').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: '登录管理后台', exact: true }).click();
  await page.getByRole('navigation', { name: '后台导航' }).waitFor();
}
async function screenshot(page, name) {
  await page.evaluate(async () => document.fonts.ready);
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  const geometry = await page.evaluate(() => {
    const rect = (element) => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width }; };
    const header = document.querySelector('header > div:first-child');
    return { width: innerWidth, scroll: document.documentElement.scrollWidth, bounds: header && rect(header), header: [...document.querySelectorAll('header > div:first-child > *')].filter((item) => item.getClientRects().length).map(rect), brand: [...document.querySelectorAll('.stitch-header-brand, .stitch-header-tagline')].filter((item) => item.getClientRects().length).map(rect), dialog: document.querySelector('[role="dialog"][aria-modal="true"]') && rect(document.querySelector('[role="dialog"][aria-modal="true"]')) };
  });
  assert.ok(geometry.scroll <= geometry.width + 1, `${name}: no page overflow`);
  for (const part of geometry.header) assert.ok(part.x >= -1 && part.right <= geometry.width + 1, `${name}: header remains inside viewport`);
  for (let index = 1; index < geometry.header.length; index++) {
    const current = geometry.header[index], previous = geometry.header[index - 1];
    assert.ok(current.x >= previous.right - 1 || current.y >= previous.bottom - 1 || previous.y >= current.bottom - 1, `${name}: header controls do not overlap`);
  }
  for (const part of geometry.brand) assert.ok(part.width > 20 && part.y >= geometry.bounds.y - 1 && part.bottom <= geometry.bounds.bottom + 1, `${name}: brand text remains readable inside header`);
  if (geometry.dialog) assert.ok(geometry.dialog.x >= 0 && geometry.dialog.right <= geometry.width + 1);
}
const admin = await newPage();
try {
  await admin.goto(`${app.base}/#admin`); await signInAdmin(admin);
  let failPrice = true;
  await admin.route('**/api/admin/credit-prices', (route) => {
    if (failPrice && route.request().method() === 'GET') { failPrice = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '点值连接暂时中断' }) }); }
    return route.continue();
  });
  await admin.getByRole('button', { name: '访问码管理', exact: true }).click();
  await admin.getByRole('button', { name: '重新读取点值' }).click();
  await admin.getByLabel('图片灵感点').waitFor();
  await admin.getByRole('button', { name: '创建访问码', exact: true }).click();
  let dialog = admin.getByRole('dialog', { name: '创建访问码', exact: true });
  await dialog.getByLabel('访问名称(用户可见)', { exact: true }).fill('朋友共享');
  await dialog.getByLabel('创建数量', { exact: true }).fill('2');
  await dialog.getByLabel('每个码的初始灵感点', { exact: true }).fill('35');
  await dialog.getByRole('switch', { name: '无限额度', exact: true }).check();
  assert.equal(await dialog.getByLabel('每个码的初始灵感点', { exact: true }).isDisabled(), true);
  await dialog.getByRole('switch', { name: '无限额度', exact: true }).uncheck();
  assert.equal(await dialog.getByLabel('每个码的初始灵感点', { exact: true }).inputValue(), '35', '切换回有限额度保留输入');
  await dialog.getByRole('button', { name: '创建并显示访问码' }).click();
  dialog = admin.getByRole('dialog', { name: '保存访问码' });
  const secret = await dialog.getByRole('textbox', { name: /^完整访问码/ }).first().inputValue();
  assert.match(secret, /^sc_[A-Za-z0-9_-]{32}$/);
  await dialog.getByRole('button', { name: '复制全部', exact: true }).click();
  assert.ok((await admin.evaluate(() => navigator.clipboard.readText())).includes(secret));
  await screenshot(admin, 'created-codes');
  await dialog.getByLabel('关闭访问码弹窗').click();
  await card(admin, '朋友共享 1').waitFor();
  assert.equal((await admin.locator('main:visible').innerText()).includes(secret), false);
  await admin.getByLabel('搜索访问码').fill('朋友共享');
  await until(async () => await admin.locator('main:visible article').count() === 2, 'access code search');
  checks.push('统一后台, 点值读取失败可重试, 批量创建, 一次性复制与列表搜索');

  const a = await newPage(), b = await newPage();
  let logins = 0; a.on('request', (request) => { if (request.url().endsWith('/api/auth/login')) logins++; });
  await a.goto(app.base); await a.getByLabel('访问码', { exact: true }).fill(` ${secret} `);
  await a.locator('form').evaluate((form) => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await a.locator('.studio-rail textarea').waitFor(); assert.equal(logins, 1);
  await signIn(b, secret); assert.notEqual((await auth(a)).userId, (await auth(b)).userId);
  assert.equal(await a.getByRole('button', { name: /开始绘制/ }).locator('[data-credit-cost]').innerText(), '-10点');
  assert.equal(await a.getByRole('button', { name: /润色扩写/ }).locator('[data-credit-cost]').innerText(), '-1点');
  const owner = await auth(a);
  const sharedId = owner.accessCodeId;
  assert.equal((await api(a, '/api/admin/access-codes')).status, 401);
  assert.equal((await api(admin, '/api/jobs/me')).status, 401);
  const release = new Promise((resolve) => { releaseImage = resolve; });
  const respond = app.controls.respond;
  app.controls.respond = async (call, res) => { if (call.path.includes('/images/')) await release; return respond(call, res); };
  let lostResponse = true; const batches = [];
  await a.route('**/api/jobs/batch', async (route) => {
    batches.push(route.request().postDataJSON());
    if (lostResponse) { lostResponse = false; await route.fetch(); return route.abort('failed'); }
    return route.continue();
  });
  await a.locator('.studio-rail textarea').fill('朋友共用灵感点的插画');
  await a.getByRole('button', { name: '2 张', exact: true }).click();
  await a.getByRole('button', { name: /开始绘制/ }).click();
  await until(async () => (await api(a, '/api/jobs/me')).data.jobs.length === 2, 'accepted batch with lost response');
  await until(async () => await a.getByRole('button', { name: /开始绘制/ }).isEnabled(), 'first submission completed');
  await a.reload(); await a.locator('.studio-rail textarea').waitFor();
  await until(async () => { const pending = await rows(a, 'outbox'); return pending.length === 2 && pending.every((row) => row.jobId); }, 'polling finds the accepted batch before retrying its lost POST response');
  await a.getByRole('button', { name: /开始绘制/ }).click();
  await until(() => batches.length === 2, 'resubmitted stable batch');
  assert.deepEqual(batches[0].jobs.map((job) => job.requestId), batches[1].jobs.map((job) => job.requestId));
  await b.getByLabel('可用 15 灵感点, 占用 20 点', { exact: true }).waitFor();
  await b.locator('.studio-rail textarea').fill('额度不足时保留内容');
  await b.getByRole('button', { name: '2 张', exact: true }).click();
  await b.getByRole('button', { name: /开始绘制/ }).click();
  await b.getByRole('alert').filter({ hasText: /需要 20 点.*可用 15 点/ }).waitFor();
  assert.equal(await b.locator('.studio-rail textarea').inputValue(), '额度不足时保留内容');
  assert.equal((await api(b, '/api/jobs/me')).data.jobs.length, 0);
  releaseImage(); releaseImage = undefined;
  await until(async () => (await rows(a)).length === 2, 'two saved images', 12000);
  await until(async () => (await auth(a)).credits.reserved === 0, 'charged image points');
  assert.equal((await auth(a)).credits.spent, 20); assert.equal((await rows(b)).length, 0);
  await a.getByLabel('关闭队列抽屉').click();
  checks.push('访问码粘贴与双击登录, 两浏览器共享余额且任务独立, 丢响应刷新后原批次续交不重扣, 额度不足保留输入');

  assert.equal(await card(admin, '朋友共享 1').getByRole('button').count(), 2, '整卡设置与独立用量图标');
  await card(admin, '朋友共享 1').getByRole('button', { name: /^管理访问码 / }).click();
  dialog = admin.getByRole('dialog', { name: '管理访问码', exact: true });
  assert.equal(await dialog.getByRole('button', { name: '用量明细', exact: true }).count(), 0);
  assert.equal(await dialog.getByRole('button', { name: '刷新数据', exact: true }).count(), 0);
  assert.equal(await dialog.getByRole('button', { name: '载入最新版本', exact: true }).count(), 0);
  await dialog.getByLabel('调整点数 (正数追加, 负数扣减)', { exact: true }).fill('5');
  const adjustmentBodies = []; let loseAdjustmentResponse = true;
  await admin.route(`**/api/admin/access-codes/${sharedId}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    adjustmentBodies.push(route.request().postDataJSON());
    if (!loseAdjustmentResponse) return route.continue();
    const response = await route.fetch(); assert.equal(response.status(), 200);
    loseAdjustmentResponse = false; await route.abort('failed');
  });
  await dialog.getByRole('button', { name: '保存修改' }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByRole('button', { name: '刷新数据', exact: true }).count(), 0);
  const adjustedBalance = (await api(admin, `/api/admin/access-codes/${sharedId}`)).data.accessCode.available;
  await dialog.getByRole('button', { name: '保存修改' }).click(); await dialog.waitFor({ state: 'hidden' });
  await admin.unroute(`**/api/admin/access-codes/${sharedId}`);
  assert.deepEqual(adjustmentBodies[0], adjustmentBodies[1]);
  assert.equal((await api(admin, `/api/admin/access-codes/${sharedId}`)).data.accessCode.available, adjustedBalance);
  await admin.getByLabel('图片灵感点').fill('12'); await admin.getByLabel('文字灵感点').fill('2');
  await admin.getByRole('button', { name: '保存点值' }).click();
  await until(async () => (await auth(a)).prices.image === 12, 'new prices');
  await a.getByRole('button', { name: /开始绘制/ }).getByText('-24点', { exact: true }).waitFor();
  await a.getByRole('button', { name: /润色扩写/ }).getByText('-2点', { exact: true }).waitFor();
  assert.equal((await a.getByRole('button', { name: /开始绘制/ }).innerText()).includes('Enter'), false);
  await card(admin, '朋友共享 1').getByRole('button', { name: /^管理访问码 / }).click();
  dialog = admin.getByRole('dialog', { name: '管理访问码', exact: true });
  await dialog.getByLabel('访问名称(用户可见)', { exact: true }).fill('朋友长期共享');
  await api(admin, '/api/admin/auth/logout', 'POST');
  await dialog.getByRole('button', { name: '保存修改' }).click();
  await signInAdmin(admin);
  dialog = admin.getByRole('dialog', { name: '管理访问码', exact: true });
  assert.equal(await dialog.getByLabel('访问名称(用户可见)', { exact: true }).inputValue(), '朋友长期共享');
  await dialog.getByRole('button', { name: '保存修改' }).click(); await dialog.waitFor({ state: 'hidden' });
  await admin.getByLabel('搜索访问码').fill('朋友');
  await card(admin, '朋友长期共享').waitFor();
  checks.push('调整点数与全局点值更新, 丢响应不展示冲突刷新且原请求重试不重复加点, 管理会话过期保留输入');

  app.controls.respond = (_call, response) => { response.destroy(); return true; };
  const textId = randomUUID(); const current = await auth(a);
  const unknown = await api(a, '/api/text', 'POST', { requestId: textId, kind: 'prompt', creditQuote: { accessCodeId: current.accessCodeId, userId: current.userId, version: current.prices.version }, input: [{ role: 'user', content: [{ type: 'input_text', text: '测试结果待核实' }] }] });
  assert.equal(unknown.data.credit.state, 'unknown');
  await card(admin, '朋友长期共享').getByRole('button', { name: /^用量明细 / }).click();
  dialog = admin.getByRole('dialog', { name: '用量明细', exact: true });
  assert.equal(await admin.getByRole('dialog', { name: '管理访问码', exact: true }).count(), 0, '用量图标不触发卡片编辑');
  await screenshot(admin, 'usage-review');
  await dialog.getByRole('button', { name: '返还点数', exact: true }).click();
  await dialog.getByText('核实结果已保存', { exact: true }).waitFor();
  assert.equal((await api(a, `/api/text/${textId}`)).data.credit.state, 'refunded');
  await dialog.getByLabel('关闭访问码弹窗').click();
  const record = (await api(admin, `/api/admin/access-codes/${sharedId}`)).data.accessCode;
  await api(admin, `/api/admin/access-codes/${sharedId}/points`, 'POST', { requestId: randomUUID(), version: record.version, delta: -record.available, reason: '验证零余额免费操作' });
  await a.getByLabel('可用 0 灵感点, 占用 0 点', { exact: true }).waitFor();
  await a.locator('.studio-rail textarea').fill('零余额仍保留我的草稿');
  await a.getByRole('button', { name: /开始绘制/ }).click();
  await a.getByRole('alert').filter({ hasText: /需要 24 点.*可用 0 点/ }).waitFor();
  await a.getByRole('button', { name: /^润色扩写/ }).click();
  await a.getByRole('alert').filter({ hasText: /需要 2 点.*可用 0 点/ }).waitFor();
  await a.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '展馆', exact: true }).click();
  await a.locator('main article').first().hover();
  const [download] = await Promise.all([a.waitForEvent('download'), a.locator('main article').first().getByRole('button', { name: '下载', exact: true }).click()]);
  assert.ok(download.suggestedFilename());
  await a.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '风格库', exact: true }).click();
  await a.getByRole('button', { name: /全部 36/ }).waitFor();
  assert.equal(await a.getByRole('button', { name: '管理风格', exact: true }).count(), 0);
  checks.push('后台用量与未知结果返还, 零余额仍可浏览和下载, 图片及文字不足反馈均保留草稿');

  await admin.getByRole('button', { name: '刷新列表' }).click();
  await card(admin, '朋友长期共享').getByRole('button', { name: /^管理访问码 / }).click();
  dialog = admin.getByRole('dialog', { name: '管理访问码', exact: true });
  await dialog.getByLabel('允许使用此访问码').uncheck();
  await dialog.getByRole('button', { name: '保存修改' }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.equal((await auth(a)).canGenerate, false);
  await card(admin, '朋友长期共享').getByRole('button', { name: /^管理访问码 / }).click();
  dialog = admin.getByRole('dialog', { name: '管理访问码', exact: true });
  await dialog.getByLabel('允许使用此访问码').check();
  await dialog.getByRole('button', { name: '保存修改' }).click(); await dialog.waitFor({ state: 'hidden' });
  await card(admin, '朋友长期共享').getByRole('button', { name: /^管理访问码 / }).click();
  dialog = admin.getByRole('dialog', { name: '管理访问码', exact: true });
  await dialog.getByRole('button', { name: '重置访问码', exact: true }).click();
  assert.equal(await dialog.getByRole('region', { name: '访问码操作' }).locator('input').count(), 0);
  await screenshot(admin, 'reset-access-code-confirm');
  const beforeReset = (await api(admin, `/api/admin/access-codes/${sharedId}`)).data.accessCode;
  const changedBeforeReset = await api(admin, `/api/admin/access-codes/${sharedId}`, 'PATCH', { requestId: randomUUID(), version: beforeReset.version, note: beforeReset.note });
  assert.equal(changedBeforeReset.status, 200);
  await dialog.getByRole('button', { name: '确认重置并显示新码' }).click();
  await dialog.getByRole('alert').filter({ hasText: '访问码已被更新' }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: '确认重置并显示新码' }).isDisabled(), true);
  await dialog.getByRole('button', { name: '刷新数据', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: '数据已刷新' }).waitFor();
  assert.equal((await api(admin, `/api/admin/access-codes/${sharedId}`)).data.accessCode.version, changedBeforeReset.data.accessCode.version);
  assert.equal(await dialog.getByRole('button', { name: '刷新数据', exact: true }).count(), 0);
  await dialog.getByRole('button', { name: '确认重置并显示新码' }).click();
  dialog = admin.getByRole('dialog', { name: '保存访问码' });
  const reset = await dialog.getByRole('textbox', { name: /^完整访问码/ }).inputValue();
  assert.notEqual(reset, secret); await dialog.getByLabel('关闭访问码弹窗').click();
  assert.equal((await api(admin, `/api/admin/access-codes/${sharedId}/ledger`)).data.entries.find((entry) => entry.event === 'reset').reason, '管理员重置访问码');
  await a.getByRole('button', { name: '用户菜单', exact: true }).click(); await a.getByRole('button', { name: '退出登录', exact: true }).click(); await a.getByLabel('访问码', { exact: true }).fill(reset);
  await a.getByRole('button', { name: '进入工作台', exact: true }).click();
  await a.getByRole('button', { name: '用户菜单', exact: true }).waitFor(); assert.equal((await auth(a)).userId, owner.userId);
  assert.equal((await auth(a)).credits.spent, 20);
  await a.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '单图创作', exact: true }).click();
  for (const [width, height, device] of [[1600, 1000, 'desktop'], [1024, 900, 'tablet'], [768, 1024, 'small-tablet'], [390, 844, 'mobile']]) {
    for (const page of [a, admin]) await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      for (const [page, name] of [[a, 'studio'], [admin, 'access-admin']]) {
        await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
        await screenshot(page, `${name}-${device}-${theme}`);
      }
    }
  }
  checks.push('启停与无原因重置保留余额及浏览器作品, 冲突刷新后手动确认且自动记录操作, 桌面/平板/手机深浅主题');

  app.controls.respond = respond;
  const recovery = await newPage();
  await signIn(recovery, app.accessCode);
  const recoveredBatches = [];
  await recovery.route('**/api/jobs/batch', (route) => {
    recoveredBatches.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '隔离测试: 尚未受理' }) });
  });
  await recovery.locator('.studio-rail textarea').fill('旧版参考图草稿, 确认后再使用新额度');
  await recovery.locator('.studio-rail input[type=file]').setInputFiles({ name: '参考图.jpg', mimeType: 'image/jpeg', buffer: photo });
  await recovery.getByRole('button', { name: /开始绘制/ }).click();
  await recovery.getByRole('alert').filter({ hasText: '隔离测试: 尚未受理' }).waitFor();
  const legacyInput = recoveredBatches[0].jobs[0];
  await recovery.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('img-gen-gallery');
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('outbox', 'readwrite'), store = tx.objectStore('outbox');
      const cursor = store.openCursor();
      cursor.onsuccess = () => { const row = cursor.result; if (!row) return; const value = row.value; delete value.input.creditQuote; row.update(value); row.continue(); };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  }));
  await recovery.context().clearCookies();
  await signIn(recovery, app.accessCode);
  const recoveredOwner = await auth(recovery);
  assert.notEqual(recoveredOwner.userId, legacyInput.creditQuote.userId);
  const beforeRecovery = app.calls.length;
  recovery.once('dialog', (prompt) => { assert.match(prompt.message(), /旧版本.*预计 12 灵感点/); return prompt.dismiss(); });
  await recovery.getByRole('button', { name: /开始绘制/ }).click();
  await recovery.getByRole('alert').filter({ hasText: '已取消重新创建' }).waitFor();
  assert.equal(app.calls.length, beforeRecovery);
  assert.equal((await rows(recovery, 'outbox'))[0].requestId, legacyInput.requestId);
  assert.equal(await recovery.locator('.studio-rail textarea').inputValue(), '旧版参考图草稿, 确认后再使用新额度');
  assert.ok(await recovery.getByRole('img', { name: '参考图 1', exact: true }).isVisible());
  await recovery.unroute('**/api/jobs/batch');
  const recoveryHold = new Promise((resolve) => { releaseImage = resolve; });
  app.controls.respond = async (call, response) => { if (call.path.includes('/images/')) await recoveryHold; return respond(call, response); };
  let loseRecovery = true;
  await recovery.route('**/api/jobs/batch', async (route) => {
    recoveredBatches.push(route.request().postDataJSON());
    if (loseRecovery) { loseRecovery = false; await route.fetch(); return route.abort('failed'); }
    return route.continue();
  });
  recovery.once('dialog', (prompt) => prompt.accept());
  await recovery.getByRole('button', { name: /开始绘制/ }).click();
  await until(async () => (await api(recovery, '/api/jobs/me')).data.jobs.length === 1, 'confirmed legacy recreation');
  const recreated = recoveredBatches[1].jobs[0];
  assert.notEqual(recreated.requestId, legacyInput.requestId);
  assert.notEqual(recreated.clientContext.placeholderId, legacyInput.clientContext.placeholderId);
  assert.deepEqual(recreated.request, legacyInput.request, 'legacy recovery preserves every parameter and reference byte');
  assert.equal(recreated.creditQuote.userId, recoveredOwner.userId);
  await recovery.reload(); await recovery.locator('.studio-rail textarea').waitFor();
  await recovery.getByRole('button', { name: /开始绘制/ }).click();
  await until(() => recoveredBatches.length === 3, 'recreated intent retries after refresh');
  assert.equal(recoveredBatches[2].jobs[0].requestId, recreated.requestId);
  releaseImage(); releaseImage = undefined;
  await until(async () => (await rows(recovery)).length === 1, 'legacy reference result saved', 12000);
  assert.equal(app.calls.length, beforeRecovery + 1);
  assert.equal((await auth(recovery)).credits.spent, 12);
  if (await recovery.getByLabel('关闭队列抽屉').isVisible()) await recovery.getByLabel('关闭队列抽屉').click();
  checks.push('旧版无报价 outbox 与丢 Cookie 恢复需确认, 取消保留原材料, 确认后新请求原子保存并在丢响应刷新后复用');

  await recovery.unroute('**/api/jobs/batch');
  const seriesBatches = [];
  await recovery.route('**/api/jobs/batch', (route) => {
    seriesBatches.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '隔离测试: 系列尚未受理' }) });
  });
  await recovery.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '系列策划', exact: true }).click();
  await recovery.locator('#series-story-prompt').fill('四幕森林散步, 保持主角一致');
  assert.equal(await recovery.getByRole('button', { name: /^智能拆解分镜/ }).locator('[data-credit-cost]').innerText(), '-2点');
  for (let index = 0; index < 4; index++) await recovery.locator(`#scene-prompt-${index}`).fill(`第 ${index + 1} 幕: 小狐狸在森林散步`);
  assert.equal(await recovery.getByRole('button', { name: /^确认并生成 4 张图片/ }).locator('[data-credit-cost]').innerText(), '-48点');
  await recovery.getByRole('button', { name: /^确认并生成 4 张图片/ }).click();
  await recovery.getByRole('alert').filter({ hasText: '隔离测试: 系列尚未受理' }).waitFor();
  const newCode = (await api(admin, '/api/admin/access-codes', 'POST', { requestId: randomUUID(), initialPoints: 120, note: '换码恢复验收' })).data.codes[0];
  await recovery.getByRole('button', { name: '用户菜单', exact: true }).click(); await recovery.getByRole('button', { name: '退出登录', exact: true }).click();
  await signIn(recovery, newCode.code);
  await recovery.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '系列策划', exact: true }).click();
  await recovery.getByRole('button', { name: /继续提交剩余分镜/ }).waitFor();
  assert.equal((await api(recovery, '/api/jobs/me')).data.jobs.length, 0);
  assert.equal((await auth(recovery)).credits.available, 120);
  recovery.once('dialog', (prompt) => { assert.match(prompt.message(), /重新创建 4 张图片.*预计 48 灵感点/); return prompt.dismiss(); });
  await recovery.getByRole('button', { name: /继续提交剩余分镜/ }).click();
  await recovery.getByRole('alert').filter({ hasText: '已取消重新创建' }).waitFor();
  assert.equal(seriesBatches.length, 1);
  await recovery.unroute('**/api/jobs/batch');
  await recovery.route('**/api/jobs/batch', async (route) => { seriesBatches.push(route.request().postDataJSON()); await route.fetch(); return route.abort('failed'); });
  const seriesHold = new Promise((resolve) => { releaseImage = resolve; });
  app.controls.respond = async (call, response) => { if (call.path.includes('/images/')) await seriesHold; return respond(call, response); };
  recovery.once('dialog', (prompt) => prompt.accept());
  await recovery.getByRole('button', { name: /继续提交剩余分镜/ }).click();
  await until(async () => (await api(recovery, '/api/jobs/me')).data.jobs.length === 4, 'series accepted under new code');
  const previousSeries = seriesBatches[0].jobs, currentSeries = seriesBatches[1].jobs;
  assert.ok(currentSeries.every((input) => !previousSeries.some((old) => old.requestId === input.requestId) && input.creditQuote.accessCodeId === newCode.id));
  assert.ok(currentSeries.slice(1).every((input) => input.referenceJobId === currentSeries[0].requestId), 'every remaining scene follows the newly confirmed anchor');
  await recovery.reload(); await recovery.locator('#series-story-prompt').waitFor();
  assert.equal(seriesBatches.length, 2, 'restoring a changed-code series never resends automatically');
  releaseImage(); releaseImage = undefined;
  await until(async () => (await rows(recovery)).length === 5, 'new-code series saved with its local reference chain', 20000);
  assert.equal((await auth(recovery)).credits.spent, 48);
  assert.equal((await auth(recovery)).credits.reserved, 0);
  checks.push('换码保留系列草稿且不静默扣点, 经确认整批创建新请求并重连首镜, 响应丢失后刷新正常保存全系列');
  const maxBalance = (await api(admin, `/api/admin/access-codes/${newCode.id}`)).data.accessCode;
  await api(admin, `/api/admin/access-codes/${newCode.id}/points`, 'POST', { requestId: randomUUID(), version: maxBalance.version, delta: 1_000_000_000 - maxBalance.available, reason: '验证最大允许余额的窄屏显示' });
  await recovery.getByLabel('可用 1000000000 灵感点, 占用 0 点', { exact: true }).waitFor();
  for (const width of [768, 390]) {
    await recovery.setViewportSize({ width, height: 1000 });
    await screenshot(recovery, `maximum-balance-${width}`);
  }
  await admin.setViewportSize({ width: 1600, height: 1000 });
  await admin.getByLabel('搜索访问码').fill('');
  await admin.getByRole('button', { name: '创建访问码', exact: true }).click();
  dialog = admin.getByRole('dialog', { name: '创建访问码', exact: true });
  await dialog.getByLabel('访问名称(用户可见)', { exact: true }).fill('无限朋友');
  await dialog.getByRole('switch', { name: '无限额度', exact: true }).check();
  assert.equal(await dialog.getByLabel('每个码的初始灵感点', { exact: true }).isDisabled(), true);
  await dialog.getByRole('button', { name: '创建并显示访问码' }).click();
  dialog = admin.getByRole('dialog', { name: '保存访问码' });
  const unlimitedSecret = await dialog.getByRole('textbox', { name: /^完整访问码/ }).inputValue();
  await dialog.getByText('无限朋友 · 无限额度', { exact: true }).waitFor();
  await dialog.getByLabel('关闭访问码弹窗').click();
  const unlimitedPage = await newPage();
  await signIn(unlimitedPage, unlimitedSecret);
  await unlimitedPage.getByLabel('无限灵感点, 原额度占用 0 点', { exact: true }).waitFor();
  assert.equal(await unlimitedPage.getByRole('button', { name: /开始绘制/ }).locator('[data-credit-cost]').count(), 0);
  assert.equal(await unlimitedPage.getByRole('button', { name: /润色扩写/ }).locator('[data-credit-cost]').count(), 0);
  const unlimitedOwner = await auth(unlimitedPage);
  await unlimitedPage.locator('.studio-rail textarea').fill('无限额度仍按流程保存作品');
  await unlimitedPage.getByRole('button', { name: /开始绘制/ }).click();
  await until(async () => (await rows(unlimitedPage)).length === 1, 'unlimited image saved');
  assert.equal((await auth(unlimitedPage)).credits.available, 0);
  assert.equal((await auth(unlimitedPage)).credits.spent, 12);
  if (await unlimitedPage.getByLabel('关闭队列抽屉').isVisible()) await unlimitedPage.getByLabel('关闭队列抽屉').click();
  await card(admin, '无限朋友').getByRole('button', { name: /^管理访问码 / }).focus();
  await admin.keyboard.press('Enter');
  dialog = admin.getByRole('dialog', { name: '管理访问码', exact: true });
  await dialog.getByRole('switch', { name: '无限额度', exact: true }).waitFor();
  assert.equal(await dialog.getByLabel('调整点数 (正数追加, 负数扣减)', { exact: true }).isDisabled(), true);
  for (const width of [1600, 390]) {
    for (const theme of ['light', 'dark']) {
      for (const [page, name] of [[admin, 'access-code-dialog'], [unlimitedPage, 'unlimited-studio']]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page.evaluate((value) => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
        await screenshot(page, `${name}-${width}-${theme}`);
      }
    }
  }
  await admin.setViewportSize({ width: 1600, height: 1000 });
  await dialog.getByLabel('关闭访问码弹窗').click();
  await card(admin, '无限朋友').getByRole('button', { name: /^用量明细 / }).focus();
  await admin.keyboard.press('Enter');
  dialog = admin.getByRole('dialog', { name: '用量明细', exact: true });
  await dialog.getByText(/图片生成 · 已完成 · 无限额度/).waitFor();
  await screenshot(admin, 'usage-unlimited-desktop');
  await dialog.getByLabel('关闭访问码弹窗').click();
  await card(admin, '无限朋友').getByRole('button', { name: /^管理访问码 / }).click();
  dialog = admin.getByRole('dialog', { name: '管理访问码', exact: true });
  await dialog.getByRole('switch', { name: '无限额度', exact: true }).uncheck();
  await dialog.getByLabel('调整点数 (正数追加, 负数扣减)', { exact: true }).fill('30');
  await dialog.getByLabel('访问名称(用户可见)', { exact: true }).fill('限量朋友');
  const conflict = await api(admin, `/api/admin/access-codes/${unlimitedOwner.accessCodeId}`, 'PATCH', { requestId: randomUUID(), version: 1, note: '其他页面已修改' });
  assert.equal(conflict.status, 200);
  await dialog.getByRole('button', { name: '保存修改' }).click();
  await dialog.getByRole('alert').filter({ hasText: '访问码已被更新' }).waitFor();
  assert.equal(await dialog.getByLabel('访问名称(用户可见)', { exact: true }).inputValue(), '限量朋友');
  assert.equal(await dialog.getByRole('button', { name: '保存修改' }).isDisabled(), true);
  await admin.route(`**/api/admin/access-codes/${unlimitedOwner.accessCodeId}`, (route) => route.request().method() === 'GET'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '隔离测试: 刷新暂时失败' }) }) : route.continue());
  await dialog.getByRole('button', { name: '刷新数据', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '刷新暂时失败' }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: '刷新数据', exact: true }).isEnabled(), true);
  assert.equal(await dialog.getByRole('button', { name: '保存修改' }).isDisabled(), true);
  await admin.unroute(`**/api/admin/access-codes/${unlimitedOwner.accessCodeId}`);
  await dialog.getByRole('button', { name: '刷新数据', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: '数据已刷新' }).waitFor();
  assert.equal(await dialog.getByLabel('访问名称(用户可见)', { exact: true }).inputValue(), '限量朋友');
  assert.equal(await dialog.getByLabel('调整点数 (正数追加, 负数扣减)', { exact: true }).inputValue(), '30');
  assert.equal(await dialog.getByRole('button', { name: '刷新数据', exact: true }).count(), 0);
  await dialog.getByRole('button', { name: '保存修改' }).click(); await dialog.waitFor({ state: 'hidden' });
  await unlimitedPage.getByLabel('可用 30 灵感点, 占用 0 点', { exact: true }).waitFor();
  assert.equal(await unlimitedPage.getByRole('button', { name: /开始绘制/ }).locator('[data-credit-cost]').innerText(), '-12点');
  checks.push('无限额度创建/使用/用量, 卡片键盘打开弹窗, 手机深浅主题, 版本冲突保留输入, 切回有限额度同步按钮点数');
  await card(admin, '限量朋友').getByRole('button', { name: /^管理访问码 / }).click();
  dialog = admin.getByRole('dialog', { name: '管理访问码', exact: true });
  await dialog.getByRole('button', { name: '删除访问码', exact: true }).click();
  await dialog.getByRole('button', { name: '取消操作' }).click();
  assert.equal((await api(admin, `/api/admin/access-codes/${unlimitedOwner.accessCodeId}`)).status, 200);
  await dialog.getByRole('button', { name: '删除访问码', exact: true }).click();
  assert.equal(await dialog.getByRole('region', { name: '访问码操作' }).locator('input').count(), 0);
  await screenshot(admin, 'delete-access-code-confirm');
  const beforeDelete = (await api(admin, `/api/admin/access-codes/${unlimitedOwner.accessCodeId}`)).data.accessCode;
  assert.equal((await api(admin, `/api/admin/access-codes/${unlimitedOwner.accessCodeId}`, 'PATCH', { requestId: randomUUID(), version: beforeDelete.version, note: '删除前更新的名称' })).status, 200);
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '访问码已被更新' }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: '确认删除', exact: true }).isDisabled(), true);
  await dialog.getByRole('button', { name: '刷新数据', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: '数据已刷新' }).waitFor();
  assert.equal(await dialog.getByLabel('访问名称(用户可见)', { exact: true }).inputValue(), '删除前更新的名称');
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  await until(async () => await card(admin, '删除前更新的名称').count() === 0, 'deleted card removed');
  assert.equal((await api(admin, `/api/admin/access-codes/${unlimitedOwner.accessCodeId}/ledger`)).status, 404);
  assert.equal((await auth(unlimitedPage)).canGenerate, false);
  await unlimitedPage.getByText('访问码已失效', { exact: true }).waitFor();
  assert.equal((await rows(unlimitedPage)).length, 1);
  const loginDeleted = await api(admin, '/api/auth/login', 'POST', { code: unlimitedSecret });
  assert.equal(loginDeleted.status, 401);
  checks.push('无原因删除可取消, 冲突刷新同步未编辑字段且需重新确认, 删除后撤销权限并自动记录, 本地作品保留');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: checks, pageErrors: errors, modelRequests: app.calls.length }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, artifacts: output, modelRequests: app.calls.length }));
} catch (error) {
  for (const [index, page] of pages.entries()) await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
  console.error(JSON.stringify({ checks, errors, error: error.message })); throw error;
} finally { releaseImage?.(); await browser.close(); await app.close(); }
