import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startHarness, until } from './server-harness.mjs';

const output = path.join(process.env.SPROUT_TEST_OUTPUT || tmpdir(), 'credits-recovery');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'sprout-browser-recovery-'));
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const photo = await readFile(new URL('../public/assets/stitch/studio-01.jpg', import.meta.url));
const checks = [], errors = [], batches = [], textRequests = [];
let context, page, cookie, release, expectedRecords = 0, expectedSpent = 0;
function normalResponse(call, response) {
  if (!call.path.includes('/images/')) return false;
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ data: [{ b64_json: photo.toString('base64') }] })); return true;
}
app.controls.respond = normalResponse;
async function launch() {
  context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  context.on('page', (tab) => { tab.setDefaultTimeout(10000); tab.on('pageerror', (error) => errors.push(error.message)); });
  context.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (request.url().endsWith('/api/jobs/batch')) batches.push(request.postDataJSON().jobs);
    if (request.url().endsWith('/api/jobs')) batches.push([request.postDataJSON()]);
    if (request.url().endsWith('/api/text')) textRequests.push(request.postDataJSON());
  });
  page = await context.newPage();
  for (const blank of context.pages()) if (blank !== page && blank.url() === 'about:blank') await blank.close();
  await page.goto(app.base);
}
async function ready() {
  await page.locator('.studio-rail textarea').waitFor();
  if (await page.getByLabel('关闭队列抽屉').isVisible()) await page.getByLabel('关闭队列抽屉').click();
}
const api = (url, options = {}) => app.api(url, { cookie, ...options });
const job = async (id) => (await api('/api/jobs/' + id)).data;
const finished = (id) => until(async () => {
  const value = await job(id); return !['pending', 'running'].includes(value.status) && value;
}, 'server task complete');
async function records() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('img-gen-gallery');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('records').objectStore('records').getAll();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
  }));
}
async function accounting(reserved = 0) {
  const { credits } = (await api('/api/credits')).data;
  assert.deepEqual([credits.available, credits.reserved, credits.spent], [1000000 - expectedSpent - reserved, reserved, expectedSpent]);
}
function hold() {
  const gate = new Promise((resolve) => { release = resolve; });
  app.controls.respond = async (call, response) => { await gate; return normalResponse(call, response); };
}
async function createImage(prompt) {
  await ready();
  const count = batches.length;
  await page.locator('.studio-rail textarea').fill(prompt);
  await page.getByRole('button', { name: /开始绘制/ }).click();
  await until(() => batches.length === count + 1, 'one submitted image batch');
  const input = batches.at(-1)[0];
  return await until(async () => (await api('/api/jobs/me')).data.jobs.find((value) => value.requestId === input.requestId), 'accepted image');
}
async function saved() {
  await until(async () => (await records()).length === expectedRecords, 'local records restored', 15000);
  const values = await records();
  assert.equal(new Set(values.map((value) => value.id)).size, expectedRecords);
  assert.equal(new Set(values.map((value) => value.jobId)).size, expectedRecords);
}
async function reopenPage() {
  page = await context.newPage(); await page.goto(app.base); await ready();
}
const retryButton = () => page.getByRole('button', { name: /^一键重试/ });

try {
  await launch();
  await page.getByLabel('访问码', { exact: true }).fill(app.accessCode);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click(); await ready();
  cookie = (await context.cookies(app.base)).map((item) => item.name + '=' + item.value).join('; ');

  hold();
  const first = await createImage('刷新和关闭标签页后继续领取原图');
  await until(() => app.calls.length === 1, 'image running'); await accounting(10);
  await page.reload(); await ready();
  assert.equal(batches.length, 1); assert.equal((await job(first.id)).id, first.id);
  await accounting(10); assert.equal((await records()).length, 0);
  await page.close(); release(); release = undefined;
  assert.equal((await finished(first.id)).status, 'succeeded');
  expectedSpent += 10; expectedRecords++; await accounting();
  assert.equal((await job(first.id)).acknowledgedAt, 0);
  await reopenPage(); await saved();
  await until(async () => (await job(first.id)).acknowledgedAt > 0, 'acknowledged after reopening tab');
  assert.equal(app.calls.length, 1); assert.equal(batches.length, 1);
  checks.push('生成中刷新与关闭标签页不取消或重复提交, 完成后重新打开自动领取, 只扣一次');

  hold();
  const second = await createImage('退出整个浏览器后恢复原会话与图片');
  await until(() => app.calls.length === 2, 'second image running'); await accounting(10);
  await context.close(); context = null; release(); release = undefined;
  assert.equal((await finished(second.id)).status, 'succeeded');
  expectedSpent += 10; expectedRecords++; await accounting();
  await launch(); await ready(); await saved();
  assert.equal(batches.length, 2); assert.equal(app.calls.length, 2);
  checks.push('关闭整个 Chrome/Chromium 进程后保留 Cookie 与 IndexedDB, 重开直接领取, 不重复扣点');

  for (const loss of ['before', 'after']) {
    app.controls.respond = normalResponse;
    let interceptStarted = false, intercepted = false;
    await page.route('**/api/jobs/*/ack', async (route) => {
      if (!interceptStarted) {
        interceptStarted = true;
        if (loss === 'after') await route.fetch();
        await route.abort('failed');
        intercepted = true;
        return;
      }
      return route.continue();
    });
    const accepted = await createImage('领取确认丢失 ' + loss);
    await finished(accepted.id); expectedSpent += 10; expectedRecords++;
    await saved(); await until(() => intercepted, 'lost ack'); await accounting();
    const calls = app.calls.length, submitted = batches.length;
    await page.unroute('**/api/jobs/*/ack');
    await page.reload(); await ready(); await saved();
    await until(async () => (await job(accepted.id)).acknowledgedAt > 0, 'recovered ack');
    assert.equal(app.calls.length, calls); assert.equal(batches.length, submitted); await accounting();
  }
  checks.push('领取确认在发送前或返回后丢失, 刷新只补确认, 作品不重复且不再扣点');

  app.controls.respond = (_call, response) => {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'content_policy_violation', message: 'fixture rejected' } })); return true;
  };
  const failed = await createImage('失败后连续点击重试');
  assert.equal((await finished(failed.id)).credit.state, 'refunded'); await accounting();
  await ready(); await retryButton().waitFor();
  hold();
  const beforeRetry = batches.length;
  await retryButton().evaluate((button) => { button.click(); button.click(); });
  await until(() => batches.length === beforeRetry + 1, 'single retry accepted');
  const retried = await until(async () => (await api('/api/jobs/me')).data.jobs.find((value) => value.retryOf === failed.id), 'retry successor');
  assert.notEqual(retried.requestId, failed.requestId);
  await accounting(10); release(); release = undefined; await finished(retried.id);
  expectedSpent += 10; expectedRecords++; await saved(); await accounting();
  await page.reload(); await ready(); await saved();
  assert.equal(batches.length, beforeRetry + 1);
  assert.equal((await job(failed.id)).credit.state, 'refunded');
  checks.push('明确失败返还, 连续点击重试只生成一个新任务, 原失败占位被接替, 刷新不重复扣点');

  app.controls.respond = (_call, response) => {
    response.writeHead(504, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'upstream timeout' } })); return true;
  };
  const uncertain = await createImage('结果未知时由用户确认后重新生成');
  assert.equal((await finished(uncertain.id)).credit.state, 'unknown'); await accounting(10);
  await ready(); await retryButton().waitFor();
  const beforeUnknown = app.calls.length, submittedUnknown = batches.length;
  page.once('dialog', (dialog) => { assert.match(dialog.message(), /结果未知/); return dialog.dismiss(); });
  await retryButton().click();
  await page.getByRole('alert').filter({ hasText: '已取消重新生成' }).waitFor();
  assert.equal(app.calls.length, beforeUnknown); assert.equal(batches.length, submittedUnknown); await accounting(10);
  app.controls.respond = normalResponse;
  page.once('dialog', (dialog) => dialog.accept());
  await retryButton().click();
  const replacement = await until(async () => (await api('/api/jobs/me')).data.jobs.find((value) => value.retryOf === uncertain.id), 'confirmed new generation');
  await finished(replacement.id); expectedSpent += 10; expectedRecords++; await saved(); await accounting(10);
  assert.equal(app.calls.length, beforeUnknown + 1);
  const resolution = await app.api('/api/admin/credit-operations/' + uncertain.credit.id + '/resolve', {
    cookie: app.adminCookie, method: 'POST', body: { requestId: randomUUID(), decision: 'refund', reason: '隔离上游确认原请求未产出' },
  });
  assert.equal(resolution.status, 200);
  await page.reload(); await ready(); await saved(); await accounting();
  checks.push('结果未知保留原预占, 取消重试不调用模型, 确认后才建立新请求, 管理员返还不影响新任务结算');

  hold();
  const beforeText = app.calls.length;
  await page.locator('.studio-rail textarea').fill('关闭浏览器后按原请求领取润色文字');
  await page.getByRole('button', { name: /^润色扩写/ }).click();
  await until(() => app.calls.length === beforeText + 1, 'text in flight');
  const originalTextId = textRequests.at(-1).requestId; await accounting(1);
  await context.close(); context = null; release(); release = undefined;
  await until(async () => (await api('/api/text/' + originalTextId)).data.credit?.state === 'charged', 'detached text completion');
  expectedSpent++; await accounting();
  await launch(); await ready();
  assert.equal(await page.locator('.studio-rail textarea').inputValue(), '关闭浏览器后按原请求领取润色文字');
  await page.getByRole('button', { name: /^润色扩写/ }).click();
  await until(async () => (await page.locator('.studio-rail textarea').inputValue()) === '一片绿色的叶子', 'original text result');
  assert.equal(textRequests.at(-1).requestId, originalTextId);
  assert.equal(textRequests.filter((input) => input.requestId === originalTextId).length, 1, 'reopening reads the saved text request instead of posting again');
  assert.equal(app.calls.length, beforeText + 1); await accounting(); await saved();
  checks.push('文字处理时退出浏览器, 重开后复用原请求领取结果, 上游仅调用一次并只扣一次');

  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '系列策划', exact: true }).click();
  await page.locator('#series-story-prompt').fill('小狐狸在森林里寻找春天, 分成四幕');
  const imagesBeforePlanning = (await api('/api/jobs/me')).data.jobs.length;
  app.controls.respond = (_call, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: '上游返回了无法使用的分镜格式' } }] })); return true;
  };
  await page.getByRole('button', { name: /^智能拆解分镜/ }).click();
  await page.getByRole('alert').filter({ hasText: '分镜拆解未完成, 已释放占用灵感点' }).waitFor();
  assert.equal(textRequests.at(-1).sceneCount, 4);
  assert.equal(await page.locator('#scene-prompt-0').inputValue(), '');
  await accounting();
  const planned = Array.from({ length: 4 }, (_, index) => ({ title: '第 ' + (index + 1) + ' 幕', prompt: '小狐狸在森林的第 ' + (index + 1) + ' 个场景中寻找春天' }));
  app.controls.respond = (_call, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(planned) } }] })); return true;
  };
  await page.getByRole('button', { name: /^智能拆解分镜/ }).click();
  await until(async () => (await page.locator('#scene-prompt-0').inputValue()) === planned[0].prompt, 'validated series draft');
  expectedSpent++; await accounting();
  assert.equal((await api('/api/jobs/me')).data.jobs.length, imagesBeforePlanning);
  checks.push('系列拆解格式无效或分镜不完整时不扣文字点数, 有效草稿才扣一次, 确认之前不生成图片');

  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '单图创作', exact: true }).click(); await ready();
  await page.locator('.studio-rail textarea').fill('文字超时后先确认旧请求再决定重新处理');
  app.controls.respond = (_call, response) => {
    response.writeHead(504, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'upstream timeout' } })); return true;
  };
  await page.getByRole('button', { name: /^润色扩写/ }).click();
  await page.getByRole('alert').filter({ hasText: '文字处理结果未知' }).waitFor(); await accounting(1);
  const uncertainTextId = textRequests.at(-1).requestId, textCount = textRequests.length, modelCount = app.calls.length;
  page.once('dialog', (dialog) => { assert.match(dialog.message(), /重新处理预计消耗/); return dialog.dismiss(); });
  await page.getByRole('button', { name: /^润色扩写/ }).click();
  await page.getByRole('alert').filter({ hasText: '已取消重新处理' }).waitFor();
  assert.equal(textRequests.length, textCount); assert.equal(app.calls.length, modelCount); await accounting(1);
  app.controls.respond = normalResponse;
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /^润色扩写/ }).click();
  await until(async () => (await page.locator('.studio-rail textarea').inputValue()) === '一片绿色的叶子', 'confirmed text retry');
  expectedSpent++; await accounting(1);
  assert.equal(textRequests.length, textCount + 1); assert.notEqual(textRequests.at(-1).requestId, uncertainTextId);
  const unknownText = await api('/api/text/' + uncertainTextId);
  await app.api('/api/admin/credit-operations/' + unknownText.data.credit.id + '/resolve', {
    cookie: app.adminCookie, method: 'POST', body: { requestId: randomUUID(), decision: 'refund', reason: '隔离文字上游确认未产出' },
  });
  await accounting();
  checks.push('文字结果未知时保留预占, 再次处理先核实原请求, 取消不再调用, 确认新请求后仅新增一次扣点');

  const { entries } = (await app.api('/api/admin/access-codes/' + app.accessCodeRecord.id + '/ledger', { cookie: app.adminCookie })).data;
  assert.equal(entries.filter((entry) => entry.event === 'charge').length, expectedRecords + 3);
  const { jobs } = (await api('/api/jobs/me')).data;
  assert.equal(jobs.filter((value) => value.credit?.state === 'charged').length, expectedRecords);
  assert.equal(jobs.filter((value) => value.credit?.state === 'refunded').length, 2);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'restored-workspace.png') });
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: checks, pageErrors: errors, modelRequests: app.calls.length, savedImages: expectedRecords, spent: expectedSpent, requestIds: batches.flatMap((items) => items.map((item) => item.requestId)) }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, artifacts: output, modelRequests: app.calls.length, savedImages: expectedRecords, spent: expectedSpent }));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  console.error(JSON.stringify({ checks, pageErrors: errors, error: error.message })); throw error;
} finally { release?.(); await context?.close(); await app.close(); }
