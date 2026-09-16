import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startHarness, until } from './server-harness.mjs';

const output = path.join(process.env.SPROUT_TEST_OUTPUT || path.join(tmpdir(), 'sprout-browser-check'), 'queue-visibility');
await mkdir(output, { recursive: true });
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const releases = [], contexts = [], errors = [], checks = [];
let holdImages = true, holdPrompt = '', currentPage;
app.controls.respond = async (call) => {
  if (call.path.includes('/images/') && (holdImages || call.json?.prompt?.includes(holdPrompt) && holdPrompt)) await new Promise((resolve) => releases.push(resolve));
  return false;
};
async function creator(skew = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  contexts.push(context);
  const page = currentPage = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(error.message));
  if (skew) await page.clock.setFixedTime(new Date(Date.now() + 6 * 3600000));
  await page.goto(app.base);
  await page.getByLabel('访问码', { exact: true }).fill(app.accessCode);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  await page.getByLabel('画面提示词', { exact: true }).waitFor();
  return page;
}
const canvas = (page) => page.locator('.studio-canvas');
const queueDrawer = (page) => page.locator('#queue-drawer');
const summary = (page) => queueDrawer(page).getByLabel('全站生图状态');
const pendingTimer = (page) => canvas(page).locator('[data-timer-stage="pending"]').first();
const activeTimer = (page) => canvas(page).locator('[data-timer-stage="running"]').first();
async function openQueue(page) {
  if (!(await queueDrawer(page).isVisible())) await page.getByRole('button', { name: /^任务队列,/ }).click();
  await queueDrawer(page).waitFor({ state: 'visible' });
}
async function closeQueue(page) { const close = page.getByLabel('关闭队列抽屉'); if (await close.isVisible()) await close.click(); }
async function submit(page, prompt, count = 1) {
  await closeQueue(page);
  await page.getByLabel('画面提示词', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: `${count} 张`, exact: true }).click();
  await page.getByRole('button', { name: /^开始绘制/ }).click();
}
async function jobs(page) { return (await (await page.context().request.get(app.base + '/api/jobs/me')).json()).jobs; }
async function screenshot(page, name) {
  currentPage = page;
  if (!name.includes('mobile') && !name.startsWith('series')) await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: path.join(output, name + '.png') });
}
function seconds(text) {
  return Number(text.match(/(\d+)\s*时/)?.[1] || 0) * 3600 + Number(text.match(/(\d+)\s*分/)?.[1] || 0) * 60 + Number(text.match(/(\d+)\s*秒/)?.[1] || 0);
}
async function everySecond(timer, label) {
  let previous = seconds(await timer.innerText());
  for (let index = 0; index < 3; index++) {
    await until(async () => seconds(await timer.innerText()) > previous, label + ' advances without polling', 1800);
    const next = seconds(await timer.innerText());
    assert.equal(next, previous + 1, label + ' advances one second at a time');
    previous = next;
  }
}

try {
  const a = await creator(), b = await creator(true), c = await creator();
  await submit(a, '创作者甲的幼苗', 2);
  await activeTimer(a).waitFor();
  await submit(b, '创作者乙的小树');
  await submit(c, '创作者丙的花朵');
  await closeQueue(a); await closeQueue(b); await closeQueue(c);
  for (const page of [a, b, c]) {
    await openQueue(page);
    await until(async () => /3\s*张等待/.test(await summary(page).innerText()), 'global waiting count includes all creators', 15000);
    assert.match(await summary(page).innerText(), /1\s*张生成中/);
    assert.match(await summary(page).innerText(), /等待数包含你的任务/);
    assert.equal(await page.getByLabel('全站生图状态').count(), 1);
    await closeQueue(page);
    assert.equal(await canvas(page).getByLabel('全站生图状态').count(), 0);
    assert.equal(await canvas(page).getByText('我的待生成第 1 张', { exact: true }).count(), 1);
  }
  assert.equal((await jobs(b)).length, 1);
  assert.ok((await jobs(b)).every((job) => job.clientContext.prompt.includes('乙')));
  assert.doesNotMatch(await canvas(b).innerText(), /创作者甲|创作者丙/);
  assert.ok(seconds(await pendingTimer(b).innerText()) < 60, 'a browser clock six hours ahead does not corrupt queue duration');
  checks.push('三位共用访问码的创作者分别看到个人第 1 张, 全站统计只在我的任务显示且数量一致, 任务内容隔离');

  const metadataReleases = []; let blockedPolls = 0, releasedPolls = 0, pauseMetadata = true;
  const blockMetadata = async (route) => {
    if (pauseMetadata) { blockedPolls++; await new Promise((resolve) => metadataReleases.push(resolve)); }
    await route.continue(); releasedPolls++;
  };
  await a.route('**/api/jobs/me?**', blockMetadata);
  await b.route('**/api/jobs/me?**', blockMetadata);
  await until(() => blockedPolls === 2, 'both status polls are paused', 10000);
  await Promise.all([everySecond(activeTimer(a), 'render clock'), everySecond(pendingTimer(b), 'queue clock')]);
  assert.equal(blockedPolls, 2, 'local clocks do not start extra API polls');
  pauseMetadata = false;
  for (const release of metadataReleases) release();
  await until(() => releasedPolls >= 2, 'paused queries resume');
  await a.unroute('**/api/jobs/me?**', blockMetadata); await b.unroute('**/api/jobs/me?**', blockMetadata);
  checks.push('暂停状态响应时排队与渲染秒数仍连续每秒 +1, 无新增轮询, 浏览器时间偏差不影响计时');
  await screenshot(a, 'studio-running-desktop');
  await openQueue(a);
  await screenshot(a, 'personal-queue-running-desktop');
  await closeQueue(a);
  await screenshot(b, 'studio-queued-desktop');
  await openQueue(b);
  const drawer = b.getByRole('dialog', { name: '任务队列', exact: true });
  assert.match(await drawer.innerText(), /我的任务/);
  assert.match(await drawer.innerText(), /1 项待完成/);
  assert.match(await drawer.innerText(), /我的待生成第 1 张/);
  assert.match(await drawer.innerText(), /置顶只调整自己的/);
  await screenshot(b, 'personal-queue-desktop');
  await closeQueue(b);

  await b.getByRole('button', { name: '用户菜单', exact: true }).click();
  await b.getByRole('button', { name: '深色', exact: true }).click();
  await b.keyboard.press('Escape');
  await screenshot(b, 'studio-queued-dark');
  await b.setViewportSize({ width: 390, height: 844 });
  await canvas(b).scrollIntoViewIfNeeded();
  assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const canvasBounds = await canvas(b).boundingBox();
  assert.ok(canvasBounds.x >= 0 && canvasBounds.x + canvasBounds.width <= 391);
  await screenshot(b, 'studio-queued-mobile');
  await openQueue(b);
  await summary(b).scrollIntoViewIfNeeded();
  const bounds = await summary(b).boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await screenshot(b, 'personal-queue-mobile');
  await closeQueue(b);
  await b.setViewportSize({ width: 1440, height: 1000 });
  await b.evaluate(() => window.scrollTo(0, 0));

  const failMetadata = (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '隔离测试连接中断' }) });
  await openQueue(b);
  await b.route('**/api/jobs/me?**', failMetadata);
  await until(async () => (await summary(b).innerText()).includes('上次状态'), 'stale queue explicitly labelled', 10000);
  assert.match(await summary(b).innerText(), /3\s*张等待/);
  assert.doesNotMatch(await summary(b).innerText(), /当前没有生图任务/);
  await screenshot(b, 'queue-disconnected');
  await b.unroute('**/api/jobs/me?**', failMetadata);
  await until(async () => !(await summary(b).innerText()).includes('上次状态'), 'queue reconnected', 10000);
  await closeQueue(b);
  checks.push('画卷与任务抽屉各自展示个人状态和全站统计, 深浅色和 390px 布局正常, 断连标记上次状态并可恢复');

  holdImages = false; holdPrompt = '创作者乙';
  for (const release of releases.splice(0)) release();
  await activeTimer(b).waitFor();
  assert.ok(seconds(await activeTimer(b).innerText()) < 10, 'pending to running resets to the actual render start');
  assert.equal(await pendingTimer(b).count(), 0);
  await everySecond(activeTimer(b), 'started render clock');
  holdPrompt = '';
  for (const release of releases.splice(0)) release();
  await until(async () => (await jobs(b)).every((job) => job.acknowledgedAt), 'single image received', 15000);
  checks.push('排队结束后切换独立渲染计时, 成功领取后移除活动计时');

  holdImages = true;
  await submit(a, '系列前的独立任务');
  await activeTimer(a).waitFor();
  await b.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '系列策划', exact: true }).click();
  await b.locator('#series-story-prompt').fill('森林旅途中的小狐狸');
  for (let index = 0; index < 4; index++) await b.locator(`#scene-prompt-${index}`).fill(`第 ${index + 1} 幕小狐狸沿着小路前进`);
  await b.getByRole('region', { name: '分镜确认与生成' }).getByRole('button', { name: /确认并生成/ }).click();
  await closeQueue(b);
  const board = b.getByRole('region', { name: '分镜检查与生成', exact: true });
  await until(async () => await board.locator('[data-timer-stage="pending"]').count() === 4, 'all four shots are visibly queued', 15000);
  assert.match(await board.innerText(), /我的待生成第 4 张/);
  assert.equal(await board.getByLabel('全站生图状态').count(), 0);
  await everySecond(board.locator('[data-timer-stage="pending"]').first(), 'series queue clock');
  await closeQueue(b);
  await board.getByRole('heading', { name: /分镜矩阵看板/ }).scrollIntoViewIfNeeded();
  await screenshot(b, 'series-queued-desktop');
  await openQueue(b);
  assert.match(await summary(b).innerText(), /等待数包含你的任务/);
  await screenshot(b, 'series-personal-queue-desktop');
  await closeQueue(b);
  checks.push('系列分镜保留个人顺序和每秒排队计时, 全站统计仅在我的任务显示, 等待状态不误写为生成中');
  holdImages = false;
  for (const release of releases.splice(0)) release();
  await until(async () => (await jobs(b)).every((job) => job.acknowledgedAt), 'all series images saved', 20000);
  const balance = (await app.api('/api/admin/access-codes/' + app.accessCodeRecord.id, { cookie: app.adminCookie })).data.accessCode;
  assert.equal(balance.reserved, 0);
  assert.equal(balance.spent, app.calls.filter((call) => call.path.includes('/images/')).length * 10);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, output }, null, 2));
} catch (error) {
  await currentPage?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, errors, server: app.logs() }, null, 2));
  throw error;
} finally {
  holdImages = false; holdPrompt = ''; app.controls.respond = null;
  for (const release of releases) release();
  for (const context of contexts) await context.close();
  await browser.close(); await app.close();
}
