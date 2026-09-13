import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startHarness, until } from './server-harness.mjs';

const output = path.join(process.env.SPROUT_TEST_OUTPUT || path.join(tmpdir(), 'sprout-browser-check'), 'workspace');
await mkdir(output, { recursive: true });
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const checks = [], errors = [];
let releaseImage, holdImage, releaseResult, rejectNext = false;
const photo = await readFile(new URL('../public/assets/stitch/studio-01.jpg', import.meta.url));
app.controls.respond = async (call, res) => {
  if (!call.path.includes('/images/')) return false;
  if (holdImage) await holdImage;
  if (rejectNext) {
    rejectNext = false;
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: '模拟当前批次失败' } }));
    return true;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [{ b64_json: photo.toString('base64') }] }));
  return true;
};

async function signedIn() {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(app.base);
  await page.getByLabel('访问码', { exact: true }).fill(app.accessCode);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  await page.locator('.studio-rail textarea').waitFor();
  return page;
}
const menu = (page) => page.getByRole('dialog', { name: '用户设置', exact: true });
const trigger = (page) => page.getByRole('button', { name: '用户菜单', exact: true });
const cards = (page) => page.locator('.studio-feed > article');
const cardKeys = (page) => cards(page).evaluateAll((items) => items.map((item) => item.dataset.studioEntry));
async function closeQueue(page) {
  const close = page.getByLabel('关闭队列抽屉');
  if (await close.isVisible()) await close.click();
}
async function records(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('img-gen-gallery');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result; const query = db.transaction('records').objectStore('records').getAll(); query.onsuccess = () => { resolve(query.result); db.close(); }; query.onerror = () => reject(query.error); };
  }));
}
const waitRecords = (page, count) => until(async () => (await records(page)).length === count, `${count} saved works`, 18000);
async function screenshot(page, name) {
  await page.evaluate(async () => document.fonts.ready);
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector('[aria-label="用户设置"]');
    const visible = (node) => node.getClientRects().length > 0;
    return {
      width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth, panel: panel?.getBoundingClientRect().toJSON(),
      buttons: [...document.querySelectorAll('header > div:first-child button')].filter(visible).map((node) => node.getBoundingClientRect().toJSON()),
      icons: panel ? [...panel.querySelectorAll('.material-symbols-outlined')].filter(visible).map((node) => ({ name: node.textContent, width: node.getBoundingClientRect().width, size: parseFloat(getComputedStyle(node).fontSize) })) : [],
    };
  });
  assert.ok(geometry.scroll <= geometry.width + 1, `${name}: no horizontal overflow`);
  for (const button of geometry.buttons) assert.ok(button.x >= 0 && button.right <= geometry.width + 1, `${name}: header and menu buttons remain visible`);
  for (const icon of geometry.icons) assert.ok(icon.width <= icon.size * 1.25, `${name}: ${icon.name} renders as a local icon`);
  if (geometry.panel) assert.ok(geometry.panel.x >= 0 && geometry.panel.right <= geometry.width + 1 && geometry.panel.top >= 0 && geometry.panel.bottom <= geometry.height, `${name}: menu fits viewport: ${JSON.stringify(geometry.panel)}`);
}
async function setName(note) {
  const route = `/api/admin/access-codes/${app.accessCodeRecord.id}`;
  const { data } = await app.api(route, { cookie: app.adminCookie });
  const changed = await app.api(route, { cookie: app.adminCookie, method: 'PATCH', body: { requestId: randomUUID(), version: data.accessCode.version, note } });
  assert.equal(changed.status, 200);
}
async function createBatch(page, prompt, count = 4) {
  await closeQueue(page);
  await page.getByLabel('画面提示词', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: `${count} 张`, exact: true }).click();
  await page.getByRole('button', { name: /^开始绘制/ }).click();
  await page.getByLabel('关闭队列抽屉').waitFor();
  await closeQueue(page);
}
function holdNextImage() { holdImage = new Promise((resolve) => { releaseImage = resolve; }); }

const page = await signedIn();
try {
  const header = page.locator('header');
  assert.doesNotMatch(await header.innerText(), /通道|待验证|已连接/);
  assert.equal(await header.getByRole('button', { name: /退出|切换主题/ }).count(), 0);
  const weight = await header.locator('[aria-label^="可用"] > span').first().evaluate((node) => Number(getComputedStyle(node).fontWeight));
  assert.ok(weight >= 600, 'balance label and amount are bold');
  await trigger(page).click();
  await menu(page).getByText('隔离验收', { exact: true }).waitFor();
  assert.ok((await menu(page).innerText()).includes(app.accessCodeRecord.tail));
  await screenshot(page, 'user-menu-light');
  await page.keyboard.press('Escape');
  assert.equal(await menu(page).count(), 0);
  assert.equal(await trigger(page).evaluate((node) => node === document.activeElement), true);
  await trigger(page).click();
  await page.getByRole('heading', { name: '创作画卷', exact: true }).click();
  assert.equal(await menu(page).count(), 0);
  await trigger(page).click();
  for (let index = 0; index < 5; index++) await page.keyboard.press('Tab');
  assert.equal(await menu(page).count(), 0, 'Tab can leave the non-modal menu');
  checks.push('顶栏余额加粗, 用户菜单收纳名称/尾号/外观/帮助/退出, 点击外部和 Esc/Tab 正常关闭');

  await trigger(page).click();
  await menu(page).getByRole('button', { name: '深色', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('class'), 'dark');
  assert.equal(await menu(page).getByRole('button', { name: '深色', exact: true }).getAttribute('aria-pressed'), 'true');
  await screenshot(page, 'user-menu-dark');
  await page.reload();
  await trigger(page).click();
  assert.equal(await menu(page).getByRole('button', { name: '深色', exact: true }).getAttribute('aria-pressed'), 'true');
  await menu(page).getByRole('button', { name: '浅色', exact: true }).click();
  await menu(page).getByRole('button', { name: '使用帮助', exact: true }).click();
  const help = page.getByRole('dialog', { name: '工作台帮助', exact: true });
  const helpText = await help.innerText();
  assert.match(helpText, /灵感点与访问码/);
  assert.match(helpText, /明确失败/);
  assert.match(helpText, /最近|近期/);
  assert.doesNotMatch(helpText, /通道状态|尚未验证|最近调用/);
  await page.keyboard.press('Escape');
  assert.equal(await trigger(page).evaluate((node) => node === document.activeElement), true, 'help closes back to the user button');
  checks.push('深浅色分段选择与刷新记忆, 帮助说明点数结算和近期作品, 帮助关闭后恢复焦点');

  const second = await signedIn();
  await trigger(page).click();
  const longName = '森林同行者的共享创作空间'.repeat(6);
  await setName(longName);
  await until(async () => await menu(page).getByText(longName, { exact: true }).count() === 1, 'live access name update', 12000);
  for (const viewport of [{ width: 900, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport);
    await screenshot(page, `user-menu-${viewport.width}`);
  }
  await setName('');
  await until(async () => await menu(page).getByText('创作者', { exact: true }).count() === 1, 'empty name uses creator', 12000);
  await menu(page).getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByLabel('访问码', { exact: true }).waitFor();
  const shared = await second.evaluate(async () => (await (await fetch('/api/auth/status')).json()));
  assert.equal(shared.authenticated, true);
  assert.equal(shared.accessName, '');
  assert.equal(shared.credits.available, 1000000);
  assert.equal(app.calls.length, 0);
  await second.context().close();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByLabel('访问码', { exact: true }).fill(app.accessCode);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  await page.locator('.studio-rail textarea').waitFor();
  checks.push('后台改名自动同步, 长名称与窄屏不溢出, 空名称使用创作者, 退出不影响共用码的其他浏览器');

  await page.route('**/api/config', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '模拟设置读取失败' }) }));
  await page.reload();
  const configError = page.getByRole('alert').filter({ hasText: '暂时无法读取创作设置' });
  await configError.waitFor();
  await page.getByLabel('画面提示词', { exact: true }).fill('设置恢复后保留的文案');
  assert.equal(await page.getByRole('button', { name: /^开始绘制/ }).isDisabled(), true);
  await page.unroute('**/api/config');
  await configError.getByRole('button', { name: '重试', exact: true }).click();
  await configError.waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel('画面提示词', { exact: true }).inputValue(), '设置恢复后保留的文案');
  assert.equal(await page.getByRole('button', { name: /^开始绘制/ }).isEnabled(), true);
  assert.equal(app.calls.length, 0);
  checks.push('隐藏通道状态后仍保留创作设置读取失败与重试, 恢复不丢输入也不自动生成');

  await createBatch(page, '上一批森林作品'); await waitRecords(page, 4);
  await createBatch(page, '最近一批海边作品'); await waitRecords(page, 8);
  assert.equal(await cards(page).count(), 4);
  assert.equal(await page.getByRole('button', { name: /全部画稿|今日作品/ }).count(), 0);
  assert.ok((await cards(page).allTextContents()).every((text) => text.includes('最近一批海边作品')));
  assert.ok((await records(page)).every((record) => record.batchId && record.submittedAt > 0));
  await screenshot(page, 'recent-four-desktop');
  checks.push('历史超过四张时仅展示最近批次, 去除旧筛选, 完整作品和批次信息仍保存在本地');

  holdNextImage();
  await createBatch(page, '当前四张花园创作');
  await until(async () => await cards(page).count() === 4 && (await cards(page).allTextContents()).every((text) => text.includes('当前四张花园创作')), 'current batch replaces old cards');
  const positions = await cardKeys(page);
  const gate = new Promise((resolve) => { releaseResult = resolve; });
  await page.route('**/api/jobs/*/result', async (route) => { await gate; await route.continue(); });
  const releaseFirst = releaseImage; holdNextImage(); releaseFirst();
  await page.getByRole('heading', { name: '正在保存作品', exact: true }).waitFor();
  assert.deepEqual(await cardKeys(page), positions, 'saving does not remove or reorder the slot');
  releaseResult(); releaseResult = undefined;
  await waitRecords(page, 9);
  await page.unroute('**/api/jobs/*/result');
  assert.deepEqual(await cardKeys(page), positions, 'saved result replaces the same slot');
  const releaseSecond = releaseImage; holdNextImage(); rejectNext = true; releaseSecond();
  await page.getByRole('article', { name: '未完成画稿: 当前四张花园创作', exact: true }).waitFor();
  assert.deepEqual(await cardKeys(page), positions, 'failure keeps its batch position');
  holdImage = undefined; releaseImage(); releaseImage = undefined;
  await waitRecords(page, 11);
  assert.deepEqual(await cardKeys(page), positions);
  await page.reload();
  await until(async () => await cards(page).count() === 4, 'reload current batch');
  assert.deepEqual(await cardKeys(page), positions);
  assert.equal(await page.getByRole('article', { name: '未完成画稿: 当前四张花园创作', exact: true }).count(), 1);
  checks.push('当前批次在排队/运行/本地保存/成功/失败/刷新后原位更新, 总量不超过四格');

  for (const side of ['.studio-rail', '.studio-canvas']) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await page.evaluate(() => ({ y: scrollY, left: document.querySelector('.studio-rail').getBoundingClientRect().top, right: document.querySelector('.studio-canvas').getBoundingClientRect().top }));
    const bounds = await page.locator(side).boundingBox();
    await page.mouse.move(bounds.x + 8, bounds.y + 100);
    await page.mouse.wheel(0, 320);
    await until(async () => await page.evaluate(() => scrollY > 100), `${side} scrolls the document`);
    const after = await page.evaluate(() => ({ y: scrollY, left: document.querySelector('.studio-rail').getBoundingClientRect().top, right: document.querySelector('.studio-canvas').getBoundingClientRect().top, header: document.querySelector('header').getBoundingClientRect().top }));
    assert.ok(Math.abs(before.left - after.left - (after.y - before.y)) < 1);
    assert.ok(Math.abs(before.right - after.right - (after.y - before.y)) < 1);
    assert.equal(after.header, 0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.studio-canvas').scrollIntoViewIfNeeded();
  await screenshot(page, 'recent-four-mobile');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('button', { name: '前往展馆', exact: true }).click();
  await until(async () => await page.locator('.gallery-card').count() === 11, 'all works remain in the gallery');
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.getByRole('button', { name: /任务队列/ }).click();
  const queue = page.getByRole('dialog', { name: '任务队列', exact: true });
  assert.match(await queue.innerText(), /上一批森林作品/);
  assert.match(await queue.innerText(), /模拟当前批次失败/);
  await closeQueue(page);
  checks.push('左右滚轮都带动整页且顶栏固定, 手机保持单列, 展馆保留全部十一张作品, 队列保留旧任务和失败详情');

  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: checks, pageErrors: errors, modelRequests: app.calls.length }, null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length, output }));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'failure.txt'), `${error.stack}\n${await page.locator('body').innerText().catch(() => '')}`);
  throw error;
} finally {
  holdImage = undefined; releaseImage?.(); releaseResult?.();
  await browser.close(); await app.close();
}
