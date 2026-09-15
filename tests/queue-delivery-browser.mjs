import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startHarness, until } from './server-harness.mjs';
import { PNG_BASE64 } from './fixtures.mjs';

const output = path.join(process.env.SPROUT_TEST_OUTPUT || path.join(tmpdir(), 'sprout-browser-check'), 'queue-delivery');
await mkdir(output, { recursive: true });
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const checks = [], errors = [], gates = [];
let currentPage;
const calls = () => app.calls.filter((call) => call.path.includes('/images/')).length;
function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  gates.push(release);
  return { promise, release };
}
const submitRoute = /\/api\/jobs(?:\/batch)?$/;
const resultRoute = /\/api\/jobs\/[^/]+\/result$/;
const ackRoute = /\/api\/jobs\/[^/]+\/ack$/;
const cards = (page) => page.locator('.studio-feed > article');
const failures = (page) => page.getByRole('article', { name: /^未完成画稿:/ });
async function rows(page, store = 'records') {
  return page.evaluate((store) => new Promise((resolve, reject) => {
    const open = indexedDB.open('img-gen-gallery');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const query = db.transaction(store).objectStore(store).getAll();
      query.onerror = () => { db.close(); reject(query.error); };
      query.onsuccess = () => { db.close(); resolve(query.result); };
    };
  }), store);
}
async function serverJobs(page) { return (await (await page.context().request.get(app.base + '/api/jobs/me')).json()).jobs; }
async function credits() { return (await app.api('/api/admin/access-codes/' + app.accessCodeRecord.id, { cookie: app.adminCookie })).data.accessCode; }
const waitRows = (page, count) => until(async () => (await rows(page)).length === count, `${count} saved images`, 22000);
async function settled(page, count) {
  await waitRows(page, count);
  await until(async () => !(await rows(page, 'outbox')).length && (await serverJobs(page)).every((job) => job.acknowledgedAt), 'receipt and outbox cleanup', 22000);
}
async function closeQueue(page) {
  const close = page.getByLabel('关闭队列抽屉');
  if (await close.isVisible()) await close.click();
}
async function signIn(page, code = app.accessCode) {
  await page.getByLabel('访问码', { exact: true }).fill(code);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  await page.getByLabel('画面提示词', { exact: true }).waitFor();
}
async function signOut(page) {
  await closeQueue(page);
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByLabel('访问码', { exact: true }).waitFor();
}
async function submit(page, prompt, count = 1) {
  await closeQueue(page);
  await page.getByLabel('画面提示词', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: `${count} 张`, exact: true }).click();
  await page.getByRole('button', { name: /^开始绘制/ }).click();
}
async function screenshot(page, name) {
  await closeQueue(page);
  await page.evaluate(async () => { window.scrollTo(0, 0); await document.fonts.ready; });
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
}
async function scenario(name, body, init) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  if (init) await context.addInitScript(init);
  const page = currentPage = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  const network = { polls: 0, acks: [] };
  page.on('request', (request) => {
    if (request.url().includes('/api/jobs/me?')) network.polls++;
    if (ackRoute.test(request.url())) network.acks.push({ url: request.url(), cookie: request.headers().cookie });
  });
  const before = await credits(), beforeCalls = calls();
  await page.goto(app.base);
  await signIn(page);
  await body(page, network);
  const after = await credits(), generated = calls() - beforeCalls;
  assert.equal(after.reserved, 0, `${name}: no stranded reservation`);
  assert.equal(after.spent - before.spent, generated * 10, `${name}: charge once per upstream generation`);
  assert.equal(before.available - after.available, generated * 10);
  assert.equal(errors.length, 0, 'no uncaught browser rejection');
  checks.push({ name, modelRequests: generated, chargedPoints: generated * 10 });
  console.log(`通过: ${name}`);
  await context.close();
}

try {
  await scenario('慢上传期间保持提交中, 多次轮询不误报失败或开放重试', async (page, network) => {
    const pending = gate(); let started = false;
    await page.route(submitRoute, async (route) => { started = true; await pending.promise; await route.continue(); });
    const before = calls();
    await submit(page, '慢上传的森林');
    await until(() => started, 'POST upload paused');
    await page.getByRole('heading', { name: '正在提交画稿', exact: true }).waitFor();
    const key = await cards(page).first().getAttribute('data-studio-entry');
    const polls = network.polls;
    await until(() => network.polls >= polls + 2, 'metadata polling continues during upload', 14000);
    assert.equal(calls(), before);
    assert.equal(await failures(page).count(), 0);
    assert.equal(await cards(page).getByRole('button', { name: /重试|继续提交|取消|中断/ }).count(), 0);
    await screenshot(page, 'upload-in-progress');
    pending.release();
    await settled(page, 1);
    assert.equal(await cards(page).first().getAttribute('data-studio-entry'), key);
    assert.equal(calls(), before + 1);
  });

  await scenario('迟到的提交响应不重建已领取的 outbox 或多扣点', async (page) => {
    const pending = gate(); let accepted;
    await page.route(submitRoute, async (route) => {
      const response = await route.fetch(); accepted = await response.json();
      await pending.promise; await route.fulfill({ response });
    });
    await submit(page, '先领取后收到提交确认');
    await until(() => accepted?.jobs?.length === 1, 'server accepted POST');
    await settled(page, 1);
    pending.release();
    await page.getByRole('button', { name: /^开始绘制/ }).waitFor();
    await until(async () => await page.getByRole('button', { name: /^开始绘制/ }).isEnabled(), 'late POST completed');
    assert.equal((await rows(page, 'outbox')).length, 0);
    assert.equal((await rows(page, 'consumed')).length, 1);
    assert.equal((await serverJobs(page)).length, 1);
    assert.equal(await failures(page).count(), 0);
  });

  await scenario('迟到的旧队列快照不覆盖刚受理的任务', async (page) => {
    const metadata = gate(), generation = gate(); let captured = false, first = true;
    app.controls.respond = async (call) => { if (call.json?.prompt?.includes('迟到快照')) await generation.promise; return false; };
    await page.route('**/api/jobs/me?**', async (route) => {
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch(); captured = true;
      await metadata.promise; await route.fulfill({ response });
    });
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await until(() => captured, 'old empty metadata snapshot captured');
    await submit(page, '迟到快照不覆盖新画稿');
    await page.getByLabel('关闭队列抽屉').waitFor();
    await closeQueue(page);
    const key = await cards(page).first().getAttribute('data-studio-entry');
    const response = page.waitForResponse((response) => response.url().includes('/api/jobs/me?'));
    metadata.release(); await response;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await cards(page).count(), 1);
    assert.equal(await cards(page).first().getAttribute('data-studio-entry'), key);
    assert.doesNotMatch(await cards(page).innerText(), /提交待确认|生成未完成/);
    generation.release();
    await settled(page, 1);
    app.controls.respond = null;
  });

  await scenario('慢原图下载不阻塞轮询或新任务, 同任务去重且同时最多领取两项', async (page, network) => {
    const held = gate(); const gets = new Map(); let active = 0, peak = 0, firstId, allowSecond = false;
    await page.route(resultRoute, async (route) => {
      const id = route.request().url().split('/').at(-2);
      firstId ||= id;
      gets.set(id, (gets.get(id) || 0) + 1);
      active++; peak = Math.max(peak, active);
      try {
        if (id === firstId || !allowSecond) await held.promise;
        await route.continue();
      } finally { active--; }
    });
    await submit(page, '原图下载缓慢的第一幅');
    await until(() => firstId, 'first result download started');
    const polls = network.polls;
    await closeQueue(page);
    await page.getByRole('heading', { name: '正在下载原图', exact: true }).waitFor();
    allowSecond = true;
    await submit(page, '下载期间提交的第二幅');
    await waitRows(page, 1);
    assert.equal((await rows(page))[0].prompt, '下载期间提交的第二幅');
    await until(() => network.polls >= polls + 2, 'polling remains active while original is paused', 10000);
    assert.equal(gets.get(firstId), 1, 'polling must not start duplicate GETs');
    allowSecond = false;
    await submit(page, '等待领取的四幅画', 4);
    await until(async () => (await serverJobs(page)).filter((job) => job.status === 'succeeded').length === 6, 'all generation jobs finish despite held downloads');
    await until(() => active === 2, 'two download slots occupied');
    assert.equal(gets.size, 3, 'three additional results wait for a download slot');
    assert.equal(peak, 2);
    assert.equal(gets.get(firstId), 1);
    await screenshot(page, 'independent-result-downloads');
    held.release();
    await settled(page, 6);
    assert.equal(peak, 2);
    assert.ok([...gets.values()].every((count) => count === 1));
  });

  await scenario('下载失败只重试领取, 不重新生图或计费', async (page, network) => {
    let attempts = 0;
    await page.route(resultRoute, (route) => ++attempts === 1 ? route.abort('failed') : route.continue());
    await submit(page, '原图领取网络中断');
    await page.getByRole('alert').filter({ hasText: '作品尚未保存' }).waitFor();
    await closeQueue(page);
    assert.equal(await failures(page).count(), 0);
    assert.equal((await rows(page)).length, 0);
    assert.equal(network.acks.length, 0);
    const retry = cards(page).getByRole('button', { name: '重试领取', exact: true });
    assert.doesNotMatch(await retry.innerText(), /点/);
    await screenshot(page, 'download-retry');
    await retry.click();
    await settled(page, 1);
    assert.equal(attempts, 2);
    assert.equal(network.acks.length, 1);
  });

  app.controls.respond = async (call, response) => {
    if (!call.json?.prompt?.includes('保存事务')) return false;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }, { b64_json: PNG_BASE64 }] }));
    return true;
  };
  await scenario('多图保存事务失败不提前确认领取, 恢复后图片与消费记录原子保存', async (page, network) => {
    await submit(page, '保存事务中途空间不足');
    await page.getByRole('alert').filter({ hasText: '作品尚未保存' }).waitFor();
    assert.equal((await rows(page)).length, 0);
    assert.equal((await rows(page, 'consumed')).length, 0);
    assert.equal(network.acks.length, 0);
    assert.equal((await serverJobs(page))[0].credit.state, 'charged');
    await page.evaluate(() => { window.__allowSave = true; });
    await page.getByRole('alert').filter({ hasText: '作品尚未保存' }).getByRole('button', { name: '重试', exact: true }).click();
    await settled(page, 2);
    assert.equal((await rows(page, 'consumed')).length, 1);
    assert.equal(network.acks.length, 1);
  }, () => {
    const put = IDBObjectStore.prototype.put; let writes = 0;
    window.__allowSave = false;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'records' && !window.__allowSave && ++writes % 2 === 0) throw new DOMException('模拟本地空间不足', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  app.controls.respond = null;

  await scenario('领取确认响应丢失不重复保存, 自动核对后清理 outbox', async (page) => {
    let attempts = 0;
    await page.route(ackRoute, async (route) => {
      attempts++;
      await route.fetch();
      await route.abort('failed');
    });
    await submit(page, '确认响应丢失的作品');
    await settled(page, 1);
    assert.equal(attempts, 1);
    assert.equal(await page.evaluate(() => window.__recordWrites), 1);
    assert.equal((await rows(page, 'consumed')).length, 1);
  }, () => {
    window.__recordWrites = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { if (this.name === 'records') window.__recordWrites++; return put.apply(this, args); };
  });

  await scenario('上传中刷新后显示待确认, 沿用原请求继续提交且只生成一次', async (page) => {
    const paused = gate(); const ids = [];
    await page.route(submitRoute, async (route) => {
      const body = route.request().postDataJSON(); ids.push((body.jobs || [body])[0].requestId);
      if (ids.length === 1) { await paused.promise; await route.abort('aborted').catch(() => {}); }
      else await route.continue();
    });
    const before = calls();
    await submit(page, '上传刷新后继续提交');
    await until(() => ids.length === 1, 'first upload paused');
    await page.reload();
    paused.release();
    await page.getByRole('heading', { name: '提交待确认', exact: true }).waitFor();
    assert.equal(calls(), before);
    assert.equal(await failures(page).count(), 0);
    await cards(page).getByRole('button', { name: /^继续提交/ }).click();
    await settled(page, 1);
    assert.equal(ids.length, 2);
    assert.equal(ids[0], ids[1]);
    assert.equal(calls(), before + 1);
  });

  await scenario('下载中刷新重新领取原任务, 不重复生成或保存', async (page) => {
    const paused = gate(); let attempts = 0;
    await page.route(resultRoute, async (route) => {
      if (++attempts === 1) { await paused.promise; await route.abort('aborted').catch(() => {}); }
      else await route.continue();
    });
    await submit(page, '下载期间刷新浏览器');
    await until(() => attempts === 1, 'result GET paused');
    await page.reload();
    paused.release();
    await settled(page, 1);
    assert.equal(attempts, 2);
    assert.equal((await rows(page, 'consumed')).length, 1);
  });

  await scenario('领取时退出换码, 旧响应不以新身份保存或确认, 原身份可再次领取', async (page, network) => {
    const created = await app.api('/api/admin/access-codes', { method: 'POST', cookie: app.adminCookie, body: { requestId: randomUUID(), initialPoints: 100, note: '另一个隔离身份', count: 1 } });
    assert.equal(created.status, 201);
    const paused = gate(); let first = true, started = false;
    await page.route(resultRoute, async (route) => {
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch(); started = true;
      await paused.promise; await route.fulfill({ response }).catch(() => {});
    });
    await submit(page, '旧身份的待领取作品');
    await until(() => started, 'old identity result ready but not delivered');
    await signOut(page);
    await signIn(page, created.data.codes[0].code);
    paused.release();
    const polls = network.polls;
    await until(() => network.polls > polls, 'new identity metadata poll', 10000);
    assert.equal(network.acks.length, 0);
    assert.equal((await rows(page)).length, 0);
    assert.equal((await serverJobs(page)).length, 0);
    await signOut(page); await signIn(page);
    await settled(page, 1);
    assert.equal(network.acks.length, 1);
  });

  await scenario('系列提交与领取状态正确, 原图未保存前禁止另起同镜生成', async (page) => {
    const upload = gate(), download = gate(); let firstId;
    await page.route(submitRoute, async (route) => { await upload.promise; await route.continue(); });
    await page.route(resultRoute, async (route) => {
      firstId ||= route.request().url().split('/').at(-2);
      await download.promise; await route.continue();
    });
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '系列策划', exact: true }).click();
    await page.locator('#series-story-prompt').fill('森林旅途, 保持同一只小狐狸');
    for (let index = 0; index < 4; index++) await page.locator(`#scene-prompt-${index}`).fill(`第 ${index + 1} 幕小狐狸沿着小路前进`);
    await page.getByRole('region', { name: '分镜确认与生成' }).getByRole('button', { name: /确认并生成/ }).click();
    const shots = page.locator('.stitch-shot-card');
    await until(async () => (await shots.allTextContents()).every((text) => text.includes('正在提交画稿')), 'series shows upload state');
    assert.equal(await shots.getByRole('button', { name: /重新尝试|调节本镜参数|移除此镜/ }).count(), 0);
    upload.release();
    await until(() => firstId, 'series download begun');
    await closeQueue(page);
    await until(async () => (await shots.allTextContents()).every((text) => /领取|下载原图/.test(text)), 'all shots waiting for receipt');
    assert.equal(await shots.getByRole('button', { name: /重新尝试|调节本镜参数|调整并重绘/ }).count(), 0);
    assert.equal(await page.locator('#scene-prompt-0').evaluate((node) => node.readOnly), true);
    await screenshot(page, 'series-result-delivery');
    download.release();
    await settled(page, 4);
    assert.equal(await shots.count(), 4);
    await until(async () => (await shots.allTextContents()).every((text) => text.includes('已就绪')), 'all four series cards show saved results');
  });

  await scenario('状态查询超时自动恢复, 多个重连触发不产生未处理异常', async (page, network) => {
    const paused = gate(); let first = true, started = false;
    await page.route('**/api/jobs/me?**', async (route) => {
      if (!first) return route.continue();
      first = false; started = true;
      await paused.promise; await route.abort('aborted').catch(() => {});
    });
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await until(() => started, 'metadata request paused');
    await page.evaluate(() => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
    const warning = page.getByRole('alert').filter({ hasText: '队列连接超时' });
    await warning.waitFor({ timeout: 20000 });
    const polls = network.polls;
    await warning.getByRole('button', { name: '重试', exact: true }).click();
    await until(() => network.polls > polls, 'metadata retry starts');
    await warning.waitFor({ state: 'hidden' });
    paused.release();
    assert.equal(await failures(page).count(), 0);
    assert.equal((await rows(page, 'outbox')).length, 0);
  });

  assert.equal(errors.length, 0);
  const ledger = []; let cursor;
  do {
    const page = (await app.api('/api/admin/access-codes/' + app.accessCodeRecord.id + '/ledger' + (cursor ? `?cursor=${cursor}` : ''), { cookie: app.adminCookie })).data;
    ledger.push(...page.entries); cursor = page.nextCursor;
  } while (cursor);
  const charges = ledger.filter((entry) => entry.event === 'charge');
  assert.equal(charges.length, calls());
  assert.equal(new Set(charges.map((entry) => entry.operationId)).size, calls());
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, modelRequests: calls(), credits: await credits() }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, modelRequests: calls(), artifacts: output }));
} catch (error) {
  await currentPage?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, errors, serverLogs: app.logs() }, null, 2));
  throw error;
} finally {
  gates.forEach((release) => release());
  await browser.close();
  await app.close();
}
