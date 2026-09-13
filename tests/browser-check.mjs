import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { crc32 } from 'node:zlib';
import { chromium } from 'playwright';
import { startHarness, until } from './server-harness.mjs';
import { png } from './fixtures.mjs';

const target = process.env.SPROUT_TEST_OUTPUT || path.join(tmpdir(), 'sprout-browser-check');
await mkdir(target, { recursive: true });
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
const checks = [];
const { styles } = JSON.parse(await readFile(new URL('../server/style-seed/catalog.json', import.meta.url), 'utf8'));
const images = await Promise.all(['studio-01.jpg', 'studio-02.jpg', 'studio-03.jpg', 'series-01.jpg'].map((name) => readFile(new URL(`../public/assets/stitch/${name}`, import.meta.url))));
let imageCount = 0;
let imagesPerResult = 1;
let delayImage = 0;
let imageOverride;
let holdImage;
let releaseImage;
let releasePlan;
let releaseCapabilities;
let rejectImage = false;
let releaseRetrySubmission;
app.controls.respond = async (call, res) => {
  if (call.path.endsWith('/chat/completions')) {
    const system = call.json.messages[0].content;
    const count = Number(system.match(/恰好 (\d+) 项/)?.[1] || 4);
    const plan = Array.from({ length: count }, (_, index) => ({ title: `森林旅程 ${index + 1}`, prompt: `戴红围巾的小棕熊在森林第 ${index + 1} 处场景中散步, 温暖自然的纸本插画, 主体明确.` }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
    return true;
  }
  imageCount++;
  if (holdImage) await holdImage;
  if (delayImage) await new Promise((resolve) => setTimeout(resolve, delayImage));
  if (rejectImage) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_request_error: 模拟生成失败, 请重试' }));
    return true;
  }
  const bytes = imageOverride || images[(imageCount - 1) % images.length];
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: Array.from({ length: imagesPerResult }, () => ({ b64_json: bytes.toString('base64') })) }));
  return true;
};

async function contextPage(init, initValue, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', acceptDownloads: true, ...options });
  if (init) await context.addInitScript(init, initValue);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(8000);
  await page.goto(app.base);
  await page.getByLabel('访问码', { exact: true }).fill(app.accessCode);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  await page.locator('.studio-rail textarea').waitFor();
  await page.waitForFunction(() => !document.querySelector('main')?.textContent?.includes('正在加载...'));
  return { context, page };
}
async function rows(page, store = 'records') {
  return page.evaluate(async (store) => {
    const db = await new Promise((resolve, reject) => { const open = indexedDB.open('img-gen-gallery'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    if (!db.objectStoreNames.contains(store)) { db.close(); return []; }
    const result = await new Promise((resolve, reject) => { const query = db.transaction(store).objectStore(store).getAll(); query.onsuccess = () => resolve(query.result); query.onerror = () => reject(query.error); });
    db.close(); return result;
  }, store);
}
async function waitRecords(page, count) { return until(async () => { const records = await rows(page); return records.length === count && records; }, `${count} local records`, 15000); }
async function workspaceDraft(page, key = 'studio') {
  return page.evaluate(async (key) => {
    const db = await new Promise((resolve, reject) => { const open = indexedDB.open('img-gen-gallery'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const result = await new Promise((resolve, reject) => { const query = db.transaction('drafts').objectStore('drafts').get(key); query.onsuccess = () => resolve(query.result?.data); query.onerror = () => reject(query.error); });
    db.close(); return result;
  }, key);
}
async function waitEmptyWorkspace(page, key = 'studio') {
  return until(async () => {
    const draft = await workspaceDraft(page, key);
    return draft && (key === 'studio'
      ? draft.config.prompt === '' && draft.config.mode === 'text' && !draft.refImage && !draft.mask && !draft.maskDataUrl && !draft.sourceRecord && !draft.config.refImages.length
      : draft.brief === '' && draft.taskText === '' && !draft.reference && !draft.seriesId && !draft.sceneIds.length && !draft.shotIds.length && !draft.stagedIds.length) && draft;
  }, `${key} completed content cleared, preferences retained`);
}
async function jobs(page) { return page.evaluate(async () => (await (await fetch('/api/jobs/me')).json()).jobs); }
async function closeQueue(page) {
  const close = page.getByLabel('关闭队列抽屉');
  if (await close.isVisible()) { await close.click(); await close.waitFor({ state: 'hidden' }); }
}
async function drawMask(page, dialog) {
  const canvas = dialog.locator('canvas').last();
  await canvas.waitFor();
  const bounds = await canvas.boundingBox();
  assert.ok(bounds?.width > 0 && bounds.height > 0);
  await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.5);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.5, { steps: 6 }); await page.mouse.up();
}
async function nav(page, label) { await closeQueue(page); const nav = await page.getByRole('navigation', { name: '主导航', exact: true }).isVisible() ? '主导航' : '移动导航'; await page.getByRole('navigation', { name: nav, exact: true }).getByRole('link', { name: label, exact: true }).click(); }
async function useTemplate(page, id) {
  const style = styles.find((item) => item.id === id);
  await nav(page, '风格库');
  await page.locator('main article').filter({ has: page.getByRole('heading', { name: style.name, exact: true }) }).getByRole('button', { name: '发送到单图', exact: true }).click();
  await page.getByRole('group', { name: '已选提示词模板' }).getByRole('heading', { name: style.name, exact: true }).waitFor();
}
async function screenshot(page, name, fullPage = false) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: path.join(target, `${name}.png`), fullPage });
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  assert.ok(overflow.scroll <= overflow.width + 1, `${name} horizontal overflow: ${JSON.stringify(overflow)}`);
  for (const label of ['任务队列', '用户菜单']) {
    const bounds = await page.getByRole('button', { name: new RegExp(label) }).first().boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= overflow.width + 1, `${name}: ${label} must stay inside viewport`);
  }
}
async function imageGeometry(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.gallery-image-viewport');
    const image = viewport?.querySelector('img');
    if (!image?.complete || !image.naturalWidth || !viewport.clientWidth) return null;
    return { viewport: viewport.getBoundingClientRect().toJSON(), image: image.getBoundingClientRect().toJSON(), natural: { width: image.naturalWidth, height: image.naturalHeight } };
  });
}
async function fittedImage(page) {
  return until(async () => {
    const info = await imageGeometry(page);
    if (!info) return false;
    const { viewport, image } = info;
    return Math.abs(image.x + image.width / 2 - viewport.x - viewport.width / 2) < 1
      && Math.abs(image.y + image.height / 2 - viewport.y - viewport.height / 2) < 1
      && image.width <= viewport.width - 23 && image.height <= viewport.height - 23
      && Math.max(image.width / (viewport.width - 24), image.height / (viewport.height - 24)) > 0.99 && info;
  }, 'image fills the available viewport without a frame');
}
async function typography(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight, spacing: style.letterSpacing };
  });
}
async function fixedViewerControls(page) {
  return page.getByRole('toolbar', { name: '图片查看工具', exact: true }).getByRole('button').evaluateAll((buttons) => buttons.map((button) => ({ label: button.getAttribute('aria-label'), rect: button.getBoundingClientRect().toJSON() })));
}
async function readableViewerIcons(page) {
  const icons = await page.locator('.viewer-image-toolbar button:not(:disabled) .material-symbols-outlined').evaluateAll((elements) => {
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map((value) => {
        const srgb = Number(value) / 255;
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    return elements.map((element) => {
      const style = getComputedStyle(element);
      const foreground = luminance(style.color);
      const background = luminance(getComputedStyle(element.closest('.viewer-image-toolbar')).backgroundColor);
      return { name: element.textContent, width: element.getBoundingClientRect().width, size: parseFloat(style.fontSize), contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
    });
  });
  assert.ok(icons.length >= 4, 'the viewer exposes its image controls');
  for (const icon of icons) {
    assert.ok(Math.abs(icon.width - icon.size) < 1, `${icon.name} renders as a complete icon, not text`);
    assert.ok(icon.contrast >= 3, `${icon.name} remains readable after switching theme: ${icon.contrast}`);
  }
}
const main = await contextPage();
const { page } = main;
try {
  await screenshot(page, 'studio-empty-desktop');
  assert.doesNotMatch(await page.locator('body').innerText(), /精选标记|已精选|回收站|CFG|Seed|参考权重/);
  await page.locator('.studio-rail textarea').fill('小狐狸走过秋日森林');
  await page.getByRole('button', { name: '2 张', exact: true }).click();
  await page.getByRole('button', { name: /开始绘制/ }).click();
  const first = await waitRecords(page, 2);
  assert.equal(imageCount, 2);
  assert.ok(first.every((record) => record.jobId && record.recipe?.quality === 'medium' && record.outputFormat === 'jpeg' && record.width > 2));
  assert.equal((await rows(page, 'consumed')).length, 2);
  const times = Object.fromEntries(first.map((record) => [record.id, record.createdAt]));
  await closeQueue(page);
  await screenshot(page, 'studio-results-desktop');
  await nav(page, '展馆');
  await page.getByRole('checkbox', { name: /选择作品/ }).first().check();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTitle('永久删除选中作品').click();
  const remaining = await waitRecords(page, 1);
  await page.reload();
  await page.locator('.gallery-card').waitFor();
  await page.waitForTimeout(2200);
  assert.equal((await rows(page)).length, 1);
  assert.equal((await rows(page))[0].createdAt, times[remaining[0].id]);
  await page.getByRole('button', { name: /检视作品:/ }).first().click();
  const viewer = page.getByRole('dialog', { name: '作品检视', exact: true });
  const initialView = await fittedImage(page);
  assert.ok(initialView.viewport.height > 750, 'the image gets most of the dialog height');
  await screenshot(page, 'viewer-single-desktop');
  const viewport = viewer.getByRole('region', { name: '图片查看区', exact: true });
  const zoomIn = viewer.getByRole('button', { name: '放大图片', exact: true });
  const fitImage = viewer.getByRole('button', { name: '适应窗口', exact: true });
  const controlsBeforeZoom = await fixedViewerControls(page);
  for (let index = 0; index < 40 && await zoomIn.isEnabled(); index++) await zoomIn.click();
  assert.ok(await zoomIn.isDisabled());
  assert.equal(await viewer.getByLabel('缩放比例', { exact: true }).innerText(), '800%');
  const enlargedView = await imageGeometry(page);
  assert.ok(enlargedView.image.width > initialView.image.width * 3);
  assert.ok(enlargedView.image.height > enlargedView.viewport.height, 'zoom is not capped by the old picture frame');
  assert.deepEqual(await fixedViewerControls(page), controlsBeforeZoom, 'zoom must not resize or move controls');
  const point = { x: enlargedView.viewport.x + enlargedView.viewport.width / 2, y: enlargedView.viewport.y + enlargedView.viewport.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 120, point.y + 80, { steps: 6 });
  await page.mouse.up();
  const pannedView = await imageGeometry(page);
  assert.ok(Math.abs(pannedView.image.x - enlargedView.image.x - 120) < 1, JSON.stringify({ enlargedView, pannedView, point }));
  assert.ok(Math.abs(pannedView.image.y - enlargedView.image.y - 80) < 1, JSON.stringify({ enlargedView, pannedView, point }));
  await viewport.press('Shift+ArrowRight');
  assert.ok(Math.abs((await imageGeometry(page)).image.x - pannedView.image.x + 48) < 1);
  await screenshot(page, 'viewer-zoomed-desktop');
  await fitImage.click();
  await fittedImage(page);
  for (let index = 0; index < 12; index++) {
    const info = await imageGeometry(page);
    if (info.image.width > info.viewport.width * 1.15 && info.image.height > info.viewport.height * 1.15) break;
    await zoomIn.click();
  }
  const beforeWheel = await imageGeometry(page);
  const anchor = { x: point.x + 70, y: point.y + 35 };
  const sourcePoint = { x: (anchor.x - beforeWheel.image.x) / beforeWheel.image.width, y: (anchor.y - beforeWheel.image.y) / beforeWheel.image.height };
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -100);
  const afterWheel = await until(async () => { const info = await imageGeometry(page); return info.image.width > beforeWheel.image.width * 1.1 && info; }, 'wheel zoom');
  assert.ok(Math.abs(afterWheel.image.x + sourcePoint.x * afterWheel.image.width - anchor.x) < 1, 'wheel zoom preserves the point under the cursor');
  assert.ok(Math.abs(afterWheel.image.y + sourcePoint.y * afterWheel.image.height - anchor.y) < 1);
  await viewer.getByRole('button', { name: '原始大小', exact: true }).click();
  const nativeView = await imageGeometry(page);
  assert.ok(Math.abs(nativeView.image.width - nativeView.natural.width) < 1);
  assert.ok(Math.abs(nativeView.image.height - nativeView.natural.height) < 1);
  await viewport.dblclick();
  await fittedImage(page);
  await viewport.dblclick();
  assert.ok((await imageGeometry(page)).image.width > initialView.image.width * 1.5);
  await fitImage.click();
  await fittedImage(page);
  await viewer.getByRole('button', { name: '收起详情', exact: true }).click();
  const expandedView = await fittedImage(page);
  assert.ok(expandedView.viewport.width > initialView.viewport.width + 300);
  await viewer.getByRole('button', { name: '进入全屏', exact: true }).click();
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('stitch-viewer-dialog'));
  await fittedImage(page);
  assert.ok(await viewer.getByRole('button', { name: '下载当前图片', exact: true }).isVisible());
  await readableViewerIcons(page);
  await page.screenshot({ path: path.join(target, 'viewer-fullscreen.png') });
  await viewer.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await fittedImage(page);
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    const mobileView = await fittedImage(page);
    assert.ok(mobileView.viewport.height > 650, 'mobile shows the picture before details');
    for (const { label, rect } of await fixedViewerControls(page)) assert.ok(rect.x >= 0 && rect.right <= 390, `${label} stays reachable on mobile`);
    await readableViewerIcons(page);
    await screenshot(page, `viewer-single-mobile-${theme}`);
    await viewer.getByRole('button', { name: '查看详情', exact: true }).click();
    await viewer.getByRole('complementary', { name: '作品详情', exact: true }).waitFor();
    assert.ok(await viewer.getByRole('button', { name: '复用完整配方', exact: true }).isVisible());
    await screenshot(page, `viewer-details-mobile-${theme}`);
    await viewer.getByRole('button', { name: '收起详情', exact: true }).click();
    await fittedImage(page);
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await viewer.getByRole('complementary', { name: '作品详情', exact: true }).waitFor();
  await fittedImage(page);
  await zoomIn.click();
  checks.push('大图适应窗口与原始大小, 连续放大到 800% 按钮位置尺寸不变, 拖动和鼠标锚点缩放, 双击, 全屏退出, 手机详情收起与深浅主题');
  const downloadEvent = page.waitForEvent('download');
  await viewer.getByRole('button', { name: '下载当前图片', exact: true }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.jpg$/);
  const downloadPath = path.join(target, download.suggestedFilename());
  await download.saveAs(downloadPath);
  assert.ok((await readFile(downloadPath)).length > 1000);
  const savedRecipe = remaining[0].recipe;
  await viewer.getByRole('button', { name: '复用完整配方' }).click();
  await page.locator('.studio-rail textarea').waitFor();
  assert.equal(await page.locator('.studio-rail textarea').inputValue(), savedRecipe.prompt);
  assert.equal(await page.getByRole('button', { name: /不额外调整/ }).getAttribute('aria-pressed'), 'true');
  checks.push('2 张生成, 实际格式下载, 原子领取, 删除后刷新不重现, 时间稳定, 完整配方复用');

  // Save a real brush mask, navigate away and reload without losing it.
  await page.locator('.studio-rail input[type=file]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png(640, 360) });
  await page.locator('.studio-rail').getByRole('button', { name: '局部重绘', exact: true }).click();
  const maskDialog = page.getByRole('dialog', { name: /局部重绘/ });
  await maskDialog.waitFor();
  await drawMask(page, maskDialog);
  await maskDialog.getByLabel('局部重绘提示词').fill('把涂抹区域改成秋日的金色');
  await screenshot(page, 'mask-editor');
  await maskDialog.getByRole('button', { name: /应用/ }).click();
  await maskDialog.waitFor({ state: 'hidden' });
  await page.reload();
  await page.getByText(/已圈定局部重绘蒙版区域/).waitFor();
  await page.getByRole('button', { name: /开始局部重绘/ }).click();
  await waitRecords(page, 2);
  const maskedCall = app.calls.filter((call) => call.path.includes('/images/')).at(-1);
  assert.match(maskedCall.path, /edits/);
  assert.match(maskedCall.body.toString('latin1'), /name="mask";/);
  const maskRecord = (await rows(page)).find((record) => record.recipe?.hasMask);
  const alpha = await page.evaluate(async (requestId) => {
    const db = await new Promise((resolve) => { const open = indexedDB.open('img-gen-gallery'); open.onsuccess = () => resolve(open.result); });
    const blob = await new Promise((resolve) => { const query = db.transaction('artifacts').objectStore('artifacts').get(`mask-${requestId}`); query.onsuccess = () => resolve(query.result); });
    const url = URL.createObjectURL(blob), image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const values = [context.getImageData(image.width / 2, image.height / 2, 1, 1).data[3], context.getImageData(0, 0, 1, 1).data[3]];
    URL.revokeObjectURL(url); db.close(); return values;
  }, maskRecord.requestId);
  assert.deepEqual(alpha, [0, 255], 'brush area must be transparent, outside must remain opaque');
  await closeQueue(page);
  await page.getByLabel('移除参考图', { exact: true }).click();
  checks.push('参考图, 蒙版绘制和刷新恢复, multipart 编辑, 移除参考图');

  // Restore an old draft without its removed subject field, then resume unaccepted scenes.
  await nav(page, '系列策划');
  const seriesBrief = '戴红围巾, 圆耳朵的小棕熊在秋日森林中展开四幕旅程';
  await page.locator('#series-story-prompt').fill(seriesBrief);
  await page.getByLabel('上传系列参考图').setInputFiles({ name: 'series-reference.png', mimeType: 'image/png', buffer: png(640, 360) });
  await page.getByRole('img', { name: '系列主体参考', exact: true }).waitFor();
  await page.waitForFunction((brief) => localStorage.getItem('sprout_canvas_draft_batch_brief') === brief, seriesBrief);
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const open = indexedDB.open('img-gen-gallery'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const tx = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    const query = store.get('series');
    query.onsuccess = () => store.put({ ...query.result, data: { ...query.result.data, characterBrief: '紫色机器人旧主体' } }, 'series');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    db.close();
  });
  await page.reload();
  await page.locator('#series-story-prompt').waitFor();
  assert.equal(await page.getByLabel('系列主体设定').count(), 0);
  assert.equal(await page.locator('#series-story-prompt').inputValue(), seriesBrief);
  await page.getByRole('img', { name: '系列主体参考', exact: true }).waitFor();
  await screenshot(page, 'series-reference-desktop');
  await page.getByLabel('移除系列参考图').click();
  await page.getByRole('img', { name: '系列主体参考', exact: true }).waitFor({ state: 'hidden' });
  let submissions = 0;
  await page.route('**/api/jobs/batch', async (route) => {
    if (route.request().method() === 'POST' && ++submissions === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试: 提交暂时不可用' }) });
    await route.continue();
  });
  const seriesStart = imageCount;
  const jobsBeforePlanning = (await jobs(page)).length;
  const outboxBeforePlanning = (await rows(page, 'outbox')).length;
  const confirmSeries = page.getByRole('button', { name: /^确认并生成 4 张图片/ });
  assert.ok(await confirmSeries.isDisabled());
  let splitRequests = 0;
  const planGate = new Promise((resolve) => { releasePlan = resolve; });
  await page.route('**/api/text', async (route) => { splitRequests++; await planGate; await route.continue(); });
  await page.getByRole('button', { name: /^智能拆解分镜/ }).dblclick();
  await page.getByRole('button', { name: /^正在拆解分镜/ }).waitFor();
  assert.ok(await confirmSeries.isDisabled());
  await page.keyboard.press('Control+Enter');
  releasePlan(); releasePlan = undefined;
  await until(() => confirmSeries.isEnabled(), 'series plan ready for review');
  await page.unroute('**/api/text');
  assert.equal(splitRequests, 1, 'double-clicking the planning action must not duplicate text requests');
  assert.equal(submissions, 0, 'planning must not enqueue images');
  assert.equal(imageCount, seriesStart);
  assert.equal((await jobs(page)).length, jobsBeforePlanning);
  assert.equal((await rows(page, 'outbox')).length, outboxBeforePlanning);

  const lastPrompt = await page.locator('#scene-prompt-3').inputValue();
  await page.locator('#scene-prompt-3').fill('');
  assert.ok(await confirmSeries.isDisabled());
  await page.locator('#scene-prompt-3').press('Control+Enter');
  assert.equal(submissions, 0, 'a shortcut inside a scene must not plan or generate images');
  await page.locator('#scene-prompt-3').fill(lastPrompt);
  const reviewedPrompt = '戴红围巾, 圆耳朵的小棕熊在金色林道上拾起一颗松果, 远处有晨雾';
  await page.getByTitle('设置本镜画幅, 质量和格式').first().click();
  const planEditor = page.getByRole('dialog', { name: '调整第 1 镜', exact: true });
  await planEditor.getByLabel('本镜画面提示词').fill(reviewedPrompt);
  await planEditor.getByLabel('本镜质量').selectOption('high');
  await planEditor.getByRole('button', { name: '保存本镜设置', exact: true }).click();
  await planEditor.waitFor({ state: 'hidden' });
  assert.equal(submissions, 0, 'saving a draft scene must not generate an image');
  assert.equal(await page.locator('#scene-prompt-0').inputValue(), reviewedPrompt);

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#series-story-prompt').press('Control+Enter');
  assert.equal(await page.locator('#scene-prompt-0').inputValue(), reviewedPrompt);
  await page.route('**/api/text', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试: 分镜拆解暂时不可用' }) }));
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /^重新拆解分镜/ }).click();
  await page.getByRole('alert').filter({ hasText: '测试: 分镜拆解暂时不可用' }).waitFor();
  await page.unroute('**/api/text');
  assert.equal(await page.locator('#scene-prompt-0').inputValue(), reviewedPrompt, 'failed replanning must keep the reviewed draft');
  await page.reload();
  await page.locator('#scene-prompt-0').waitFor();
  assert.equal(await page.locator('#scene-prompt-0').inputValue(), reviewedPrompt);
  assert.ok(await confirmSeries.isEnabled());
  assert.equal(submissions, 0, 'restoring the reviewed draft must not generate images');
  assert.equal((await jobs(page)).length, jobsBeforePlanning);
  for (const [device, width, height, theme] of [['desktop', 1600, 1000, 'light'], ['mobile', 390, 844, 'light'], ['mobile', 390, 844, 'dark']]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    await screenshot(page, `series-review-${device}-${theme}`, true);
    const bounds = await confirmSeries.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'series confirmation must fit inside the viewport');
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  assert.equal(imageCount, seriesStart);
  checks.push('分镜拆解只生成文字, 双击与快捷键不自动生图, 空提示词阻止提交, 逐镜编辑与刷新待确认稿, 取消或失败重拆保留原稿');
  await confirmSeries.click();
  await page.getByRole('alert').filter({ hasText: '测试: 提交暂时不可用' }).waitFor();
  assert.equal(imageCount, seriesStart, 'a rejected batch must not partially generate images');
  await waitRecords(page, 2);
  await closeQueue(page);
  await page.getByRole('button', { name: /继续提交剩余分镜/ }).waitFor();
  assert.equal((await workspaceDraft(page, 'series')).brief, seriesBrief, 'a rejected batch must retain the complete series draft');
  await page.reload();
  await page.getByRole('button', { name: /继续提交剩余分镜/ }).waitFor();
  assert.equal((await workspaceDraft(page, 'series')).stagedIds.length, 4, 'restoring remaining inputs must keep the complete batch identity');
  await page.getByRole('button', { name: /继续提交剩余分镜/ }).click();
  await waitRecords(page, 6);
  await waitEmptyWorkspace(page, 'series');
  assert.equal(await page.locator('#series-story-prompt').inputValue(), seriesBrief, 'leave the current completed storyboard open for review');
  assert.equal(imageCount - seriesStart, 4);
  await page.unroute('**/api/jobs/batch');
  const scenes = (await rows(page)).filter((record) => record.kind === 'series');
  assert.equal(new Set(scenes.map((record) => record.sceneId)).size, 4);
  assert.equal(new Set(scenes.map((record) => record.seriesId)).size, 1);
  assert.ok(scenes.filter((record) => record.sceneIndex > 0).every((record) => record.recipe.references.length));
  const splitCall = app.calls.filter((call) => call.path.endsWith('/chat/completions')).at(-1);
  assert.ok(splitCall.json.messages[1].content.includes(seriesBrief));
  assert.doesNotMatch(JSON.stringify(splitCall.json), /紫色机器人旧主体/);
  assert.ok(scenes.every((record) => record.recipe.prompt.includes(seriesBrief)));
  assert.ok(scenes.find((record) => record.sceneIndex === 0).recipe.prompt.includes(reviewedPrompt));
  assert.equal(scenes.find((record) => record.sceneIndex === 0).recipe.quality, 'high');
  assert.ok(scenes.every((record) => !record.recipe.prompt.includes('紫色机器人旧主体')));
  assert.ok((await rows(page, 'drafts')).every((draft) => !Object.hasOwn(draft.data, 'characterBrief')));
  await closeQueue(page);
  await screenshot(page, 'series-complete-desktop');
  await page.getByTitle(/^重新绘制本镜/).first().click();
  await waitRecords(page, 7); await closeQueue(page);
  await waitEmptyWorkspace(page, 'series');
  assert.ok((await rows(page)).some((record) => record.version === 2 && record.parentId));
  await page.getByRole('button', { name: /^调整并重绘/ }).first().click();
  const editor = page.getByRole('dialog', { name: '调整第 1 镜', exact: true });
  await editor.getByLabel('本镜画面提示词').fill('小棕熊在晴朗的河边散步');
  await editor.getByLabel('本镜质量').selectOption('high');
  await editor.getByRole('button', { name: /^保存并重绘本镜/ }).click();
  await waitRecords(page, 8); await closeQueue(page);
  await waitEmptyWorkspace(page, 'series');
  assert.ok((await rows(page)).some((record) => record.version === 3 && record.recipe.quality === 'high'));
  await page.getByTitle('全屏预览大图', { exact: true }).first().click();
  await page.getByLabel('本镜版本', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('本镜版本').locator('option').count(), 3);
  await fittedImage(page);
  await page.getByRole('button', { name: '放大图片', exact: true }).click();
  await page.getByLabel('本镜版本', { exact: true }).selectOption({ index: 2 });
  await fittedImage(page);
  assert.equal(await page.getByRole('button', { name: '适应窗口', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '查看第 2 幕', exact: true }).click();
  await fittedImage(page);
  assert.equal(await page.getByRole('button', { name: '查看第 2 幕', exact: true }).getAttribute('aria-current'), 'true');
  await page.getByRole('button', { name: '拼版', exact: true }).click();
  assert.equal(await page.getByLabel('连贯拼版', { exact: true }).locator('article').count(), 4);
  await page.getByTitle('检视第 3 幕', { exact: true }).click();
  await fittedImage(page);
  await page.keyboard.press('ArrowLeft');
  await fittedImage(page);
  assert.equal(await page.getByRole('button', { name: '查看第 2 幕', exact: true }).getAttribute('aria-current'), 'true');
  await page.getByRole('button', { name: '当前图片', exact: true }).click();
  await fittedImage(page);
  assert.equal(await page.getByRole('button', { name: '查看第 2 幕', exact: true }).count(), 0);
  await page.getByRole('button', { name: '系列预览', exact: true }).click();
  await fittedImage(page);
  await screenshot(page, 'viewer-series-desktop');
  await page.getByLabel('关闭查看器').click();
  checks.push('系列大图切换分镜和版本后重置缩放, 拼版回到单幕, 键盘切换, 当前图片与系列预览均可用');
  await page.reload();
  await page.locator('#series-story-prompt').waitFor();
  assert.equal(await page.locator('#series-story-prompt').inputValue(), '', 'a completed series opens as a new plan after refresh');
  assert.equal(await page.getByTitle(/^重新绘制本镜/).count(), 0);
  assert.equal((await rows(page)).length, 8, 'ending the series draft keeps every saved scene version');
  checks.push('待确认和部分完成的系列草稿继续恢复, 全镜及单镜重绘完成后结束草稿, 刷新开启新策划且保留所有作品版本');
  await nav(page, '展馆');
  await page.getByLabel('作品来源', { exact: true }).selectOption('picture-book');
  assert.equal(await page.locator('.gallery-card').count(), 1);
  const zipEvent = page.waitForEvent('download');
  await page.getByTitle('打包全套', { exact: true }).click();
  const zip = await zipEvent; await zip.saveAs(path.join(target, 'series.zip'));
  const zipBytes = await readFile(path.join(target, 'series.zip'));
  assert.equal(zipBytes.readUInt32LE(zipBytes.length - 22), 0x06054b50);
  assert.equal(zipBytes.readUInt16LE(zipBytes.length - 12), 4);
  let centralOffset = zipBytes.readUInt32LE(zipBytes.length - 6);
  for (let index = 0; index < 4; index++) {
    assert.equal(zipBytes.readUInt32LE(centralOffset), 0x02014b50);
    assert.equal(zipBytes.readUInt16LE(centralOffset + 10), 0);
    const localOffset = zipBytes.readUInt32LE(centralOffset + 42);
    const dataOffset = localOffset + 30 + zipBytes.readUInt16LE(localOffset + 26) + zipBytes.readUInt16LE(localOffset + 28);
    const bytes = zipBytes.subarray(dataOffset, dataOffset + zipBytes.readUInt32LE(centralOffset + 20));
    assert.equal(crc32(bytes), zipBytes.readUInt32LE(centralOffset + 16));
    centralOffset += 46 + zipBytes.readUInt16LE(centralOffset + 28) + zipBytes.readUInt16LE(centralOffset + 30) + zipBytes.readUInt16LE(centralOffset + 32);
  }
  checks.push('梗概统一输入, 清理旧主体字段, 可选参考图, 四幕拆解与首镜参考链, 失败刷新续交, 单镜三版本, 本镜参数, 模板过滤和四镜 ZIP');

  await nav(page, '风格库');
  await page.getByRole('button', { name: /全部 36/ }).waitFor();
  assert.equal(await page.locator('main article').count(), 36);
  await page.getByRole('button', { name: /摄影与光影 6/ }).click();
  assert.equal(await page.locator('main article').count(), 6);
  await page.getByRole('button', { name: /全部 36/ }).click();
  await page.getByLabel('搜索风格').fill('水彩');
  assert.ok(await page.locator('main article').count() > 0);
  await page.getByRole('button', { name: /^放大 / }).first().click();
  const styleDialog = page.getByRole('dialog', { name: /风格详情/ });
  assert.match(await styleDialog.innerText(), /CC BY 4.0/);
  assert.doesNotMatch(await styleDialog.innerText(), /CFG|Seed|步数/);
  await screenshot(page, 'style-detail');
  await page.getByLabel('关闭详情').click();
  await page.getByLabel('搜索风格').fill('');
  checks.push('风格 36 款和六类真实计数, 搜索, 署名, 移除不支持的参数');

  // Use the real clipboard and persisted drafts to cover both library actions.
  for (const style of styles) assert.match(style.prompt, /\p{Script=Han}/u, `${style.name} has a Chinese template`);
  const watercolor = styles.find((style) => style.id === 'open-15563');
  const longStyle = styles.find((style) => style.id === 'open-15567');
  assert.ok(longStyle.prompt.length > 1000);
  const styleFlow = await contextPage();
  const sp = styleFlow.page;
  await styleFlow.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base });
  const stylePrompt = sp.getByLabel('画面提示词', { exact: true });
  const imagesBeforeStyles = imageCount;
  const pasteShortcut = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';
  await stylePrompt.fill('这是尚未被替换的旧草稿');
  await sp.getByRole('button', { name: '4 张', exact: true }).click();
  await sp.getByRole('button', { name: /16:9 宽屏/ }).click();
  await until(async () => (await workspaceDraft(sp))?.config?.prompt === '这是尚未被替换的旧草稿', 'old studio draft saved');
  await nav(sp, '风格库');
  const watercolorCard = sp.locator('main article').filter({ has: sp.getByRole('heading', { name: watercolor.name, exact: true }) });
  assert.equal(await watercolorCard.locator('p.line-clamp-3').textContent(), watercolor.prompt);
  await watercolorCard.getByRole('button', { name: '复制模板', exact: true }).click();
  await watercolorCard.getByRole('button', { name: '已复制', exact: true }).waitFor();
  assert.equal(await sp.evaluate(() => navigator.clipboard.readText()), watercolor.prompt);
  await nav(sp, '单图创作');
  await stylePrompt.fill('');
  await stylePrompt.press(pasteShortcut);
  assert.equal(await stylePrompt.inputValue(), watercolor.prompt, 'pasting uses the displayed Chinese template');
  await stylePrompt.fill('这份旧草稿不能覆盖刚发送的模板');
  await until(async () => (await workspaceDraft(sp))?.config?.prompt === '这份旧草稿不能覆盖刚发送的模板', 'stale draft saved before sending');
  await nav(sp, '风格库');
  await watercolorCard.getByRole('button', { name: '发送到单图', exact: true }).click();
  await sp.getByText(`已载入 ${watercolor.name}, 可修改后开始绘制`, { exact: true }).waitFor();
  assert.equal(await stylePrompt.inputValue(), watercolor.prompt);
  await sp.getByRole('group', { name: '已选提示词模板' }).getByRole('heading', { name: watercolor.name, exact: true }).waitFor();
  const sentStyle = await workspaceDraft(sp);
  assert.equal(sentStyle.styleId, watercolor.id);
  assert.equal(sentStyle.config.mode, 'text');
  assert.equal(sentStyle.config.aspectRatio, '16:9');
  assert.equal(sentStyle.config.imageCount, 1);
  assert.equal(await workspaceDraft(sp, 'studio-transfer'), undefined, 'the transfer is consumed after saving');
  await sp.reload();
  await stylePrompt.waitFor();
  assert.equal(await stylePrompt.inputValue(), watercolor.prompt);
  await sp.getByRole('group', { name: '已选提示词模板' }).getByRole('heading', { name: watercolor.name, exact: true }).waitFor();
  assert.equal(await sp.getByText(/^已载入 .*, 可修改后开始绘制/).count(), 0, 'reload does not replay the transfer');
  assert.equal((await jobs(sp)).length, 0);
  assert.equal((await rows(sp, 'outbox')).length, 0);
  assert.equal(imageCount, imagesBeforeStyles);
  checks.push('卡片预览与真实剪贴板中文模板一致, 发送单图覆盖旧草稿并记录模板名称, 刷新保留且不自动生图');

  await nav(sp, '风格库');
  await sp.getByLabel('搜索风格').fill(longStyle.name);
  await sp.getByRole('button', { name: `放大 ${longStyle.name}`, exact: true }).click();
  const longStyleDialog = sp.getByRole('dialog', { name: `风格详情 ${longStyle.name}`, exact: true });
  assert.equal(await longStyleDialog.locator('p.whitespace-pre-wrap').textContent(), longStyle.prompt);
  await longStyleDialog.getByRole('button', { name: '复制模板', exact: true }).click();
  await longStyleDialog.getByRole('button', { name: '已复制', exact: true }).waitFor();
  assert.equal(await sp.evaluate(() => navigator.clipboard.readText()), longStyle.prompt);
  await screenshot(sp, 'style-long-template-desktop', true);
  await sp.getByLabel('关闭详情').click();
  await nav(sp, '单图创作');
  await stylePrompt.fill('');
  await stylePrompt.press(pasteShortcut);
  assert.equal(await stylePrompt.inputValue(), longStyle.prompt, 'pasting a template longer than 1000 characters must not truncate it');
  await nav(sp, '风格库');
  await sp.getByLabel('搜索风格').fill(longStyle.name);
  await sp.getByRole('button', { name: `放大 ${longStyle.name}`, exact: true }).click();
  await longStyleDialog.getByRole('button', { name: '发送到单图', exact: true }).click();
  await sp.getByText(`已载入 ${longStyle.name}, 可修改后开始绘制`, { exact: true }).waitFor();
  assert.equal(await stylePrompt.inputValue(), longStyle.prompt);
  await sp.getByRole('group', { name: '已选提示词模板' }).getByRole('heading', { name: longStyle.name, exact: true }).waitFor();
  const reviewedTemplate = `${longStyle.prompt}\n主题: 植物研究所, 使用薄荷绿与奶油黄色.`;
  await stylePrompt.fill(reviewedTemplate);
  await until(async () => (await workspaceDraft(sp))?.config?.prompt === reviewedTemplate, 'reviewed long template saved');
  await sp.reload();
  await stylePrompt.waitFor();
  assert.equal(await stylePrompt.inputValue(), reviewedTemplate);
  for (const [device, width, height] of [['desktop', 1600, 1000], ['mobile', 390, 844]]) {
    await sp.setViewportSize({ width, height });
    await screenshot(sp, `style-sent-${device}`, true);
  }
  assert.equal((await jobs(sp)).length, 0);
  assert.equal((await rows(sp, 'outbox')).length, 0);
  assert.equal(imageCount, imagesBeforeStyles, 'copying, sending, editing and reloading never generate automatically');
  await sp.getByRole('button', { name: /开始绘制/ }).click();
  const styleResult = (await waitRecords(sp, 1))[0];
  assert.equal(imageCount, imagesBeforeStyles + 1);
  assert.equal(styleResult.prompt, reviewedTemplate);
  assert.equal(styleResult.recipe.styleId, longStyle.id);
  assert.equal(styleResult.recipe.tone, 'none');
  const styleCall = app.calls.filter((call) => call.path.includes('/images/')).at(-1);
  assert.match(styleCall.path, /\/images\/generations$/);
  assert.equal(styleCall.json.prompt, reviewedTemplate, 'templates never append a hidden style description');
  await styleFlow.context.close();
  checks.push('详情复制与发送使用完整长模板, 超过 1000 字仍可粘贴和编辑, 桌面手机布局正常, 确认后请求使用修改内容');

  for (const [width, height, device] of [[1600, 1000, 'desktop'], [1024, 900, 'tablet'], [390, 844, 'mobile']]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
      let libraryTypography;
      for (const [label, key] of [['单图创作', 'studio'], ['系列策划', 'series'], ['风格库', 'styles'], ['展馆', 'gallery']]) {
        await nav(page, label);
        await page.waitForTimeout(100);
        if (key === 'styles') libraryTypography = { heading: await typography(page.locator('h1')), section: await typography(page.locator('article h3').first()), background: await page.locator('.stitch-page').evaluate((element) => getComputedStyle(element).backgroundColor) };
        if (key === 'gallery') {
          assert.deepEqual(await typography(page.locator('h1')), libraryTypography.heading, `${device} ${theme}: gallery title uses the shared typography`);
          assert.deepEqual(await typography(page.locator('main section h2').first()), libraryTypography.section, `${device} ${theme}: gallery section headings use the shared typography`);
          assert.equal(await page.locator('.stitch-page').evaluate((element) => getComputedStyle(element).backgroundColor), libraryTypography.background);
        }
        await screenshot(page, `${key}-${device}-${theme}`);
      }
    }
  }
  checks.push('桌面, 平板, 手机深浅主题下展馆与风格库的标题字体, 字号, 字重, 行高及背景颜色一致');
  await page.getByRole('button', { name: '用户菜单', exact: true }).click(); await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByLabel('访问码', { exact: true }).waitFor();
  await page.getByLabel('访问码', { exact: true }).fill(app.accessCode);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).waitFor();
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await page.getByLabel('访问码', { exact: true }).waitFor({ timeout: 10000 });
  checks.push('桌面, 平板, 手机, 深浅主题四页布局, 手机退出和会话过期');

  // Simulate a quota failure inside the image-saving transaction, then retry successfully.
  const quota = await contextPage(() => {
    window.__allowImageSave = false;
    let writes = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { if (this.name === 'records' && !window.__allowImageSave && ++writes % 2 === 0) throw new DOMException('测试存储空间已满', 'QuotaExceededError'); return put.apply(this, args); };
  });
  imagesPerResult = 2;
  await quota.page.locator('.studio-rail textarea').fill('测试本地存储失败');
  await quota.page.getByRole('button', { name: /开始绘制/ }).click();
  await quota.page.getByRole('alert').filter({ hasText: /作品尚未保存/ }).waitFor({ timeout: 12000 });
  assert.equal((await rows(quota.page)).length, 0);
  assert.equal((await workspaceDraft(quota.page)).config.prompt, '测试本地存储失败', 'an unsaved result must not end its draft');
  assert.ok((await jobs(quota.page)).some((job) => job.status === 'succeeded' && !job.acknowledgedAt));
  await quota.page.evaluate(() => { window.__allowImageSave = true; });
  await quota.page.getByRole('button', { name: '重试', exact: true }).click();
  await waitRecords(quota.page, 2);
  await waitEmptyWorkspace(quota.page);
  await until(async () => (await jobs(quota.page)).some((job) => job.acknowledgedAt), 'acknowledged after local save');
  checks.push('存储失败可见, 不误报保存, 不提前确认领取, 恢复后仅保存一次');
  await quota.context.close();

  imagesPerResult = 1;
  const operations = await contextPage();
  const op = operations.page;
  holdImage = new Promise((resolve) => { releaseImage = resolve; });
  await op.locator('.studio-rail textarea').fill('四张独立的森林插画');
  await op.getByRole('button', { name: '4 张', exact: true }).click();
  await op.getByRole('button', { name: /开始绘制/ }).click();
  await until(async () => (await jobs(op)).filter((job) => job.status === 'pending').length === 3, 'four-image queue');
  const pendingSingle = (await jobs(op)).filter((job) => job.status === 'pending').sort((a, b) => a.yourPosition - b.yourPosition).at(-1);
  await until(async () => await op.getByRole('button', { name: '置顶', exact: true }).count() === 3, 'three pending queue actions');
  await op.getByRole('button', { name: '置顶', exact: true }).last().click();
  await until(async () => (await jobs(op)).find((job) => job.id === pendingSingle.id)?.yourPosition === 1, 'priority via queue drawer');
  await screenshot(op, 'queue-pending-desktop');
  releaseImage(); holdImage = undefined;
  await waitRecords(op, 4);
  await closeQueue(op);
  await op.locator('summary').first().click();
  await op.getByRole('button', { name: '切图拆分', exact: true }).click();
  await op.getByRole('dialog', { name: /切图/ }).waitFor();
  await op.keyboard.press('Escape');
  checks.push('4 张独立任务, 用户内队列置顶, 二级切图工具入口');

  await nav(op, '系列策划');
  await op.getByRole('button', { name: '电商长图', exact: true }).click();
  const commerceBrief = '森林主题陶瓷杯, 展示商品外形, 材质和使用场景';
  await op.locator('#series-story-prompt').fill(commerceBrief);
  assert.equal(await op.getByTitle('在风格库选择基底风格').count(), 0);
  assert.equal(await op.locator('#series-story-prompt').inputValue(), commerceBrief, 'removing the library style selector keeps the story');
  await op.getByLabel('系列生成质量').selectOption('high');
  holdImage = new Promise((resolve) => { releaseImage = resolve; });
  await op.getByRole('button', { name: /^智能拆解分镜/ }).click();
  await until(() => op.getByRole('button', { name: /^确认并生成 4 张图片/ }).isEnabled(), 'commerce plan ready for review');
  const commerceScene = await op.locator('#scene-prompt-0').inputValue();
  const imagesBeforeSeriesStyle = imageCount;
  await nav(op, '风格库');
  assert.equal(await op.getByRole('button', { name: '发送到系列', exact: true }).count(), 0);
  await nav(op, '系列策划');
  await until(() => op.getByRole('button', { name: /^确认并生成 4 张图片/ }).isEnabled(), 'reviewed scenes restored after visiting the library');
  assert.equal(await op.locator('#series-story-prompt').inputValue(), commerceBrief);
  assert.equal(await op.locator('#scene-prompt-0').inputValue(), commerceScene);
  assert.equal(imageCount, imagesBeforeSeriesStyle);
  await op.getByRole('button', { name: /^确认并生成 4 张图片/ }).click();
  await op.getByRole('dialog', { name: '任务队列', exact: true }).waitFor();
  await until(async () => (await jobs(op)).filter((job) => job.status === 'pending').length === 3, 'series pending scenes');
  await closeQueue(op);
  await op.getByTitle('修改尚未执行的分镜').first().click();
  const pendingEditor = op.getByRole('dialog', { name: '调整第 2 镜', exact: true });
  await pendingEditor.getByLabel('本镜画面提示词').fill('陶瓷杯置于森林木桌上, 展示杯壁上的绿色叶纹');
  await pendingEditor.getByLabel('本镜质量').selectOption('low');
  await pendingEditor.getByRole('button', { name: '更新排队任务', exact: true }).click();
  await pendingEditor.waitFor({ state: 'hidden' });
  const lastSceneJob = (await jobs(op)).find((job) => job.status === 'pending' && job.clientContext.sceneIndex === 3);
  await op.getByTitle('置顶自己的待执行任务').last().click();
  await until(async () => (await jobs(op)).find((job) => job.id === lastSceneJob.id)?.yourPosition === 1, 'priority via scene card');
  await screenshot(op, 'series-pending-desktop');
  releaseImage(); holdImage = undefined;
  const opRecords = await waitRecords(op, 8);
  await waitEmptyWorkspace(op, 'series');
  assert.ok(opRecords.some((record) => record.sceneIndex === 1 && record.recipe.quality === 'low' && record.recipe.prompt.includes('绿色叶纹')));
  assert.ok(app.calls.some((call) => call.path.endsWith('/images/edits') && call.body.includes(Buffer.from('绿色叶纹')) && /name="quality"\r\n\r\nlow/.test(call.body.toString())));
  const originalSceneIds = opRecords.filter((record) => record.kind === 'series').map((record) => record.sceneId);
  const originalSeriesId = opRecords.find((record) => record.kind === 'series').seriesId;
  await op.getByLabel('系列生成质量').selectOption('low');
  await op.getByLabel('系列输出格式').selectOption('webp');
  await op.getByRole('button', { name: '品牌 IP 延展', exact: true }).click();
  await nav(op, '展馆');
  await op.getByLabel('作品来源').selectOption('ecommerce');
  await op.getByRole('button', { name: /检视系列:/ }).first().click();
  await op.getByRole('button', { name: '基于此系列继续衍生分镜', exact: true }).click();
  await op.locator('#series-story-prompt').waitFor();
  assert.equal(await op.getByLabel('系列生成质量').inputValue(), 'high');
  assert.equal(await op.getByLabel('系列输出格式').inputValue(), 'png');
  assert.equal(await op.getByTitle('在风格库选择基底风格').count(), 0);
  assert.equal(await op.locator('img[alt="系列主体参考"]').count(), 1);
  const derived = await op.evaluate(() => ({ id: localStorage.getItem('sprout_canvas_draft_batch_series_id'), scenes: JSON.parse(localStorage.getItem('sprout_canvas_draft_batch_scene_ids')), template: localStorage.getItem('sprout_canvas_draft_batch_template') }));
  assert.notEqual(derived.id, originalSeriesId);
  assert.ok(derived.scenes.every((id) => !originalSceneIds.includes(id)));
  assert.equal(derived.template, 'ecommerce');
  assert.equal(await op.getByTitle(/^重新绘制本镜/).count(), 0);
  checks.push('系列待执行编辑与置顶实际生效, 衍生系列复用模板/参数/原图并生成独立身份');

  await op.reload();
  await op.getByRole('button', { name: '使用帮助与创作守则', exact: true }).click();
  const help = op.getByRole('dialog', { name: '工作台帮助', exact: true });
  await help.getByRole('heading', { name: '灵感点与访问码', exact: true }).waitFor();
  assert.doesNotMatch(await help.innerText(), /通道状态/);
  await op.getByLabel('关闭帮助').click();
  await op.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: ({ files }) => files.every((file) => file instanceof File) });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => { window.__sharedFiles = files.map((file) => ({ name: file.name, size: file.size, type: file.type })); } });
  });
  await nav(op, '展馆');
  await op.getByLabel('作品来源').selectOption('ecommerce');
  await op.getByRole('button', { name: /检视系列:/ }).first().click();
  await op.getByRole('button', { name: '分享文件', exact: true }).click();
  await op.waitForFunction(() => window.__sharedFiles?.length === 4);
  assert.ok((await op.evaluate(() => window.__sharedFiles)).every((file) => file.size > 1000 && file.type === 'image/jpeg' && file.name.endsWith('.jpg')));
  checks.push('帮助展示灵感点规则并移除通道状态, 系列文件分享传入四张原图 (模拟系统分享接口)');

  // Editing a series output must retain the original scene and all generation settings.
  await op.getByRole('button', { name: '局部重绘当前分镜', exact: true }).click();
  const seriesMask = op.getByRole('dialog', { name: /局部重绘工作区/ });
  await seriesMask.waitFor();
  await seriesMask.getByLabel('局部重绘提示词').fill('将涂抹区域的叶纹改成橙色');
  await drawMask(op, seriesMask);
  await seriesMask.getByRole('button', { name: '保存并应用蒙版', exact: true }).click();
  const originalScene = opRecords.find((record) => record.kind === 'series' && record.sceneIndex === 0);
  const seriesSettings = op.getByRole('region', { name: '局部重绘参数', exact: true });
  assert.match(await seriesSettings.innerText(), /1280×720/);
  await op.getByRole('button', { name: /开始局部重绘/ }).click();
  const seriesEdited = (await waitRecords(op, 9)).find((record) => record.mode === 'edit');
  assert.equal(seriesEdited.seriesId, originalScene.seriesId);
  assert.equal(seriesEdited.sceneId, originalScene.sceneId);
  assert.equal(seriesEdited.parentId, originalScene.id);
  assert.equal(seriesEdited.version, 2);
  for (const key of ['size', 'quality', 'background', 'outputFormat', 'outputCompression', 'model', 'providerId']) assert.equal(seriesEdited.recipe[key], originalScene.recipe[key], `series edit keeps ${key}`);
  await closeQueue(op);
  await op.locator('article').filter({ hasText: '将涂抹区域的叶纹改成橙色' }).waitFor();
  checks.push('系列蒙版编辑继承原分镜参数, 保留系列/分镜身份并新增版本');
  await operations.context.close();

  // Reproduce editing a 16:9 output after the rail has been changed back to square.
  const editFlow = await contextPage();
  const ep = editFlow.page;
  imageOverride = png(1672, 940);
  await useTemplate(ep, 'open-15563');
  await ep.getByLabel('画面提示词', { exact: true }).fill('一只白色杯子放在森林木桌上');
  await ep.getByRole('button', { name: /16:9 宽屏/ }).click();
  await ep.getByRole('button', { name: '高清 HD', exact: true }).click();
  await ep.locator('.studio-rail label:has(input[type=checkbox])').click();
  assert.ok(await ep.getByLabel('透明背景', { exact: true }).isChecked());
  await ep.getByRole('button', { name: /开始绘制/ }).click();
  const originalWide = (await waitRecords(ep, 1))[0];
  assert.equal(originalWide.recipe.size, '1280x720');
  await closeQueue(ep);
  await ep.getByRole('button', { name: /1:1 方图/ }).click();
  await ep.getByRole('button', { name: '标准', exact: true }).click();
  await ep.getByRole('button', { name: 'JPEG', exact: true }).click();
  await ep.getByRole('button', { name: '4 张', exact: true }).click();
  await useTemplate(ep, 'open-13957');
  await ep.getByRole('button', { name: '4 张', exact: true }).click();
  await ep.getByRole('button', { name: /生动鲜明/ }).click();
  await ep.getByTitle('局部涂抹修改', { exact: true }).click();
  const wideMask = ep.getByRole('dialog', { name: /局部重绘工作区/ });
  await wideMask.waitFor();
  assert.equal(await wideMask.getByLabel('局部重绘提示词').inputValue(), '', 'a new edit asks for a local instruction');
  await wideMask.getByLabel('局部重绘提示词').fill('把杯子的把手改成红色');
  await drawMask(ep, wideMask);
  await wideMask.getByRole('button', { name: '保存并应用蒙版', exact: true }).click();
  await wideMask.waitFor({ state: 'hidden' });
  const editSettings = ep.getByRole('region', { name: '局部重绘参数', exact: true });
  const assertEditSettings = async () => {
    await editSettings.waitFor();
    const text = await editSettings.innerText();
    assert.match(text, /16:9/); assert.match(text, /1280×720/); assert.match(text, /1672×940/);
    assert.match(text, /精细/); assert.match(text, /PNG/); assert.match(text, /透明/); assert.match(text, /水彩/);
    assert.doesNotMatch(text, /1:1|JPEG/);
    assert.equal(await ep.getByRole('button', { name: /1:1 方图/ }).count(), 0);
    assert.equal(await ep.getByRole('button', { name: '从风格库挑选提示词模板', exact: true }).count(), 0);
  };
  await assertEditSettings();
  await ep.reload(); await assertEditSettings();
  for (const [device, width, height] of [['desktop', 1600, 1000], ['mobile', 390, 844]]) {
    await ep.setViewportSize({ width, height });
    await screenshot(ep, `edit-inherited-${device}`, true);
  }
  await ep.setViewportSize({ width: 1600, height: 1000 });
  const countBeforeEdit = imageCount;
  await ep.getByRole('button', { name: /开始局部重绘/ }).click();
  const editedWide = (await waitRecords(ep, 2)).find((record) => record.mode === 'edit');
  assert.equal(imageCount, countBeforeEdit + 1, 'an edit creates one output instead of reusing the four-image setting');
  assert.equal(editedWide.parentId, originalWide.id);
  assert.equal(editedWide.version, 2);
  for (const key of ['size', 'quality', 'background', 'outputFormat', 'outputCompression', 'model', 'providerId', 'styleId', 'styleName', 'tone']) assert.equal(editedWide.recipe[key], originalWide.recipe[key], `single edit keeps ${key}`);
  const editCall = app.calls.filter((call) => call.path.includes('/images/')).at(-1);
  const form = await new Response(editCall.body, { headers: { 'Content-Type': editCall.headers['content-type'] } }).formData();
  assert.equal(form.get('size'), '1280x720'); assert.equal(form.get('quality'), 'high');
  assert.equal(form.get('output_format'), 'png'); assert.equal(form.get('background'), 'transparent');
  assert.match(form.get('prompt'), /把杯子的把手改成红色/);
  assert.doesNotMatch(form.get('prompt'), /黏土|高对比富有张力|柔和自然的光影/);
  assert.deepEqual(Buffer.from(await form.get('image').arrayBuffer()), imageOverride, 'edit uploads original bytes without resizing');
  const sentMask = Buffer.from(await form.get('mask').arrayBuffer());
  assert.equal(sentMask.readUInt32BE(16), 1672); assert.equal(sentMask.readUInt32BE(20), 940);
  checks.push('16:9 蒙版编辑继承尺寸/质量/格式/背景/通道, 刷新不丢失, 原图不缩小且不混入其他风格');
  await closeQueue(ep);

  // Clearing a mask cannot silently turn an edit into whole-image generation.
  await ep.locator('.studio-rail').getByRole('button', { name: '编辑蒙版', exact: true }).click();
  await wideMask.getByRole('button', { name: '清空蒙版', exact: true }).click();
  await wideMask.getByRole('button', { name: '保存并应用蒙版', exact: true }).click();
  await wideMask.waitFor({ state: 'hidden' });
  assert.ok(await ep.getByRole('button', { name: /开始局部重绘/ }).isDisabled());
  await ep.reload(); await assertEditSettings();
  assert.ok(await ep.getByRole('button', { name: /开始局部重绘/ }).isDisabled());
  await ep.getByRole('button', { name: '参考图生成', exact: true }).click();
  await ep.getByRole('button', { name: /1:1 方图/ }).click();
  await ep.getByLabel('画面提示词', { exact: true }).fill('以杯子为参考重新设计一个方形画面');
  await ep.getByRole('button', { name: /开始绘制/ }).click();
  const referenced = (await waitRecords(ep, 3)).find((record) => record.mode === 'reference');
  assert.equal(referenced.recipe.size, '1024x1024');
  assert.equal(referenced.recipe.hasMask, false);
  assert.equal(referenced.recipe.styleId, '');
  await closeQueue(ep);
  await nav(ep, '展馆');
  await ep.getByRole('button', { name: /检视作品: 一只白色杯子/ }).click();
  await ep.getByRole('button', { name: '局部重绘此图', exact: true }).click();
  await wideMask.waitFor();
  await wideMask.getByRole('button', { name: '取消', exact: true }).click();
  await assertEditSettings();
  assert.ok(await ep.getByRole('button', { name: /开始局部重绘/ }).isDisabled());
  checks.push('清空蒙版保持编辑模式并阻止提交, 显式切换参考图后可修改参数, 展馆编辑入口一致');

  // An explicit template transfer starts text creation, even after editing an output.
  await ep.locator('.studio-rail').getByRole('button', { name: '绘制蒙版', exact: true }).click();
  await wideMask.waitFor();
  await drawMask(ep, wideMask);
  await wideMask.getByLabel('局部重绘提示词').fill('这份旧蒙版要求不能影响风格模板');
  await wideMask.getByRole('button', { name: '保存并应用蒙版', exact: true }).click();
  await wideMask.waitFor({ state: 'hidden' });
  await until(async () => Boolean((await workspaceDraft(ep))?.mask), 'old brush mask saved');
  const imagesBeforeMaskTransfer = imageCount;
  await nav(ep, '风格库');
  await ep.locator('main article').filter({ has: ep.getByRole('heading', { name: watercolor.name, exact: true }) }).getByRole('button', { name: '发送到单图', exact: true }).click();
  await ep.getByText(`已载入 ${watercolor.name}, 可修改后开始绘制`, { exact: true }).waitFor();
  const assertStyleReplacedEdit = async () => {
    const prompt = ep.getByLabel('画面提示词', { exact: true });
    await prompt.waitFor();
    assert.equal(await prompt.inputValue(), watercolor.prompt);
    await ep.getByRole('group', { name: '已选提示词模板' }).getByRole('heading', { name: watercolor.name, exact: true }).waitFor();
    assert.equal(await ep.getByRole('region', { name: '局部重绘参数', exact: true }).count(), 0);
    assert.equal(await wideMask.count(), 0);
    const draft = await workspaceDraft(ep);
    assert.equal(draft.config.mode, 'text');
    assert.deepEqual(draft.config.refImages, []);
    for (const key of ['refImage', 'sourceRecord', 'mask']) assert.equal(draft[key], null);
    assert.equal(draft.maskDataUrl, '');
  };
  await assertStyleReplacedEdit();
  await ep.reload();
  await assertStyleReplacedEdit();
  assert.equal(imageCount, imagesBeforeMaskTransfer);
  await ep.getByRole('button', { name: /开始绘制/ }).click();
  const afterMaskStyle = (await waitRecords(ep, 4)).find((record) => record.prompt === watercolor.prompt);
  assert.equal(imageCount, imagesBeforeMaskTransfer + 1);
  assert.equal(afterMaskStyle.mode, 'text');
  assert.equal(afterMaskStyle.kind, 'single');
  assert.equal(afterMaskStyle.parentId, undefined);
  assert.equal(afterMaskStyle.recipe.styleId, watercolor.id);
  assert.equal(afterMaskStyle.recipe.hasMask, false);
  assert.deepEqual(afterMaskStyle.recipe.references, []);
  assert.match(app.calls.filter((call) => call.path.includes('/images/')).at(-1).path, /\/images\/generations$/);
  checks.push('发送单图退出旧局部编辑, 清除参考图和蒙版身份, 刷新不恢复旧编辑, 用户确认后独立生成');
  imageOverride = undefined;
  await editFlow.context.close();

  const touchFlow = await contextPage(undefined, undefined, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const tp = touchFlow.page;
  await tp.getByLabel('画面提示词', { exact: true }).fill('检查触屏缩放的森林插画');
  await tp.getByRole('button', { name: /开始绘制/ }).click();
  await tp.getByLabel('关闭队列抽屉').waitFor();
  await waitRecords(tp, 1);
  await nav(tp, '展馆');
  await tp.getByRole('button', { name: /检视作品:/ }).click();
  const touchInitial = await fittedImage(tp);
  const touchControls = await fixedViewerControls(tp);
  const center = { x: touchInitial.viewport.x + touchInitial.viewport.width / 2, y: touchInitial.viewport.y + touchInitial.viewport.height / 2 };
  const cdp = await touchFlow.context.newCDPSession(tp);
  const touch = (id, x, y) => ({ id, x, y, radiusX: 5, radiusY: 5, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, center.x - 35, center.y), touch(2, center.x + 35, center.y)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, center.x - 75, center.y), touch(2, center.x + 75, center.y)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const pinched = await until(async () => { const info = await imageGeometry(tp); return info?.image.width > touchInitial.image.width * 1.8 && info; }, 'native two-finger pinch');
  assert.equal(await tp.evaluate(() => visualViewport.scale), 1, 'pinch zooms the image instead of the page');
  assert.deepEqual(await fixedViewerControls(tp), touchControls);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, center.x, center.y)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, center.x + 35, center.y + 30)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok((await imageGeometry(tp)).image.x > pinched.image.x + 15, 'one finger pans the zoomed image');
  await screenshot(tp, 'viewer-touch-zoomed');
  await tp.getByRole('button', { name: '适应窗口', exact: true }).tap();
  await fittedImage(tp);
  await cdp.detach();
  await touchFlow.context.close();
  checks.push('移动浏览器原生双指捏合只缩放图片, 单指拖动查看, 工具栏不缩放且可恢复完整画面');

  const controlsFlow = await contextPage();
  const cp = controlsFlow.page;
  const formatControls = cp.getByRole('group', { name: '生成格式', exact: true });
  const toneControls = cp.getByRole('group', { name: '渲染调性', exact: true });
  const controlsSubmit = cp.getByRole('button', { name: /开始绘制/ });
  const controlsStart = imageCount;
  assert.equal(await toneControls.getByRole('button').count(), 3);
  await cp.getByLabel('画面提示词', { exact: true }).fill('检查生成格式与渲染调性');
  await formatControls.getByRole('button', { name: 'JPEG', exact: true }).click();
  await until(async () => (await workspaceDraft(cp))?.config.outputFormat === 'jpeg', 'format choice saved');
  const capabilitiesGate = new Promise((resolve) => { releaseCapabilities = resolve; });
  await cp.route('**/api/config', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await capabilitiesGate;
    await route.fulfill({ response, json: { ...config, imageCapabilities: { ...config.imageCapabilities, formats: ['png'] } } });
  });
  await cp.reload();
  await formatControls.getByRole('status').filter({ hasText: '正在读取可用格式' }).waitFor();
  assert.equal(await formatControls.getByRole('button').count(), 0, 'do not expose unverified formats before capabilities arrive');
  assert.ok(await controlsSubmit.isDisabled());
  await cp.getByLabel('画面提示词', { exact: true }).press('Control+Enter');
  assert.equal(imageCount, controlsStart);
  assert.equal((await rows(cp, 'outbox')).length, 0, 'a shortcut cannot submit while capabilities are loading');
  releaseCapabilities(); releaseCapabilities = undefined;
  await cp.getByText('当前支持 PNG 格式', { exact: true }).waitFor();
  assert.equal(await cp.getByLabel('当前生成格式', { exact: true }).innerText(), 'PNG');
  assert.equal(await formatControls.getByRole('button').count(), 0, 'a single supported format is a read-only value');
  await until(async () => (await workspaceDraft(cp))?.config.outputFormat === 'png', 'unsupported saved format replaced by the supported format');
  assert.ok(await controlsSubmit.isEnabled());
  await screenshot(cp, 'studio-controls-png-only-desktop', true);
  await cp.setViewportSize({ width: 390, height: 844 });
  await cp.evaluate(() => document.documentElement.classList.add('dark'));
  await screenshot(cp, 'studio-controls-png-only-mobile-dark', true);
  await cp.unroute('**/api/config');
  await cp.reload();
  await formatControls.getByRole('button', { name: 'WEBP', exact: true }).waitFor();
  assert.equal(await formatControls.getByRole('button').count(), 3);
  checks.push('单格式通道明确显示只支持 PNG, 不提供无效切换; 能力读取期间不提前展示格式或通过快捷键提交, 不支持的旧草稿格式同步恢复');

  await cp.setViewportSize({ width: 1600, height: 1000 });
  await cp.evaluate(() => document.documentElement.classList.remove('dark'));
  const toneCases = [
    { format: 'png', tone: 'none', label: '不额外调整', suffix: '' },
    { format: 'jpeg', tone: 'soft', label: '柔和自然', suffix: '，柔和自然的光影，温润真实的摄影质感' },
    { format: 'webp', tone: 'vivid', label: '生动鲜明', suffix: '，色调鲜活明艳，高对比富有张力' },
  ];
  for (const [index, setting] of toneCases.entries()) {
    const prompt = `检查 ${setting.format.toUpperCase()} 生成与调性`;
    if (setting.format === 'jpeg') {
      await cp.getByLabel('透明背景', { exact: true }).locator('..').click();
      assert.ok(await cp.getByLabel('透明背景', { exact: true }).isChecked());
    }
    await formatControls.getByRole('button', { name: setting.format.toUpperCase(), exact: true }).click();
    await toneControls.getByRole('button', { name: new RegExp(`^${setting.label}`) }).click();
    await cp.getByLabel('画面提示词', { exact: true }).fill(prompt);
    if (setting.format === 'jpeg') assert.ok(!await cp.getByLabel('透明背景', { exact: true }).isChecked());
    if (setting.format === 'webp') {
      await cp.getByLabel('透明背景', { exact: true }).locator('..').click();
      assert.ok(await cp.getByLabel('透明背景', { exact: true }).isChecked());
      await cp.locator('.studio-rail input[type=file]').setInputFiles({ name: 'tone-reference.png', mimeType: 'image/png', buffer: png(640, 360) });
      await until(async () => Boolean((await workspaceDraft(cp))?.refImage), 'reference draft saved');
      assert.equal(await toneControls.getByRole('button').count(), 3, 'uploading an image must not add a hidden tone option');
      assert.equal(await toneControls.getByRole('button', { name: /^生动鲜明/ }).getAttribute('aria-pressed'), 'true', 'an uploaded reference preserves the chosen tone');
    }
    await until(async () => {
      const draft = await workspaceDraft(cp);
      return draft?.config.outputFormat === setting.format && draft?.config.prompt === prompt && draft?.tone === setting.tone;
    }, 'format, tone and prompt saved');
    await cp.reload();
    await formatControls.getByRole('button', { name: setting.format.toUpperCase(), exact: true }).waitFor();
    assert.equal(await formatControls.getByRole('button', { name: setting.format.toUpperCase(), exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await toneControls.getByRole('button', { name: new RegExp(`^${setting.label}`) }).getAttribute('aria-pressed'), 'true');
    assert.equal(await toneControls.getByRole('button').count(), 3);
    await controlsSubmit.click();
    const record = (await waitRecords(cp, index + 1)).find((item) => item.prompt === prompt);
    assert.equal(record.recipe.outputFormat, setting.format);
    assert.equal(record.recipe.tone, setting.tone);
    assert.equal(record.recipe.prompt, prompt + setting.suffix);
    const call = app.calls.filter((call) => call.path.includes('/images/')).at(-1);
    const form = call.json || Object.fromEntries(await new Request('http://fixture.local', { method: 'POST', headers: { 'Content-Type': call.headers['content-type'] }, body: call.body }).formData());
    assert.equal(form.output_format, setting.format, 'the selected format reaches the provider');
    assert.equal(form.prompt, prompt + setting.suffix, 'tone descriptions are applied only when selected');
    assert.equal(record.mode, setting.format === 'webp' ? 'reference' : 'text');
    assert.equal(record.outputFormat, 'jpeg', 'record the actual returned format even if the provider ignores the requested format');
    await closeQueue(cp);
  }
  assert.equal(imageCount, controlsStart + 3);
  await cp.getByTitle('设为新参考', { exact: true }).first().click();
  await until(async () => (await toneControls.getByRole('button', { name: /^不额外调整/ }).getAttribute('aria-pressed')) === 'true', 'reference image loaded and additional tone cleared');
  assert.equal(await toneControls.getByRole('button').count(), 3);
  assert.equal(await toneControls.getByRole('button', { name: /^不额外调整/ }).getAttribute('aria-pressed'), 'true');
  for (const label of ['柔和自然', '生动鲜明', '不额外调整']) await toneControls.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  assert.equal(await toneControls.getByRole('button').count(), 3, 'all tone choices remain available after switching');
  assert.equal(await cp.getByRole('button', { name: /原始配方/ }).count(), 0);
  await screenshot(cp, 'studio-controls-reference-desktop', true);
  await cp.setViewportSize({ width: 390, height: 844 });
  await screenshot(cp, 'studio-controls-reference-mobile', true);
  await controlsFlow.context.close();
  checks.push('PNG/JPEG/WebP 切换与刷新后选中状态一致, 三种格式和调性进入实际请求; 上传参考图保留选择, 使用已有作品关闭额外调性, 三个选项始终可切换');

  const retryFlow = await contextPage();
  const rp = retryFlow.page;
  const retryStart = imageCount;
  const untouchedPrompt = '保留未处理的失败画稿';
  const retryPrompt = '重试的小狐狸画稿';
  const failureCards = rp.getByRole('article', { name: /^未完成画稿:/ });
  const retryCard = rp.getByRole('article', { name: `未完成画稿: ${retryPrompt}`, exact: true });
  rejectImage = true;
  for (const prompt of [untouchedPrompt, retryPrompt]) {
    await rp.getByLabel('画面提示词', { exact: true }).fill(prompt);
    await rp.getByRole('button', { name: /开始绘制/ }).click();
    await rp.getByRole('article', { name: `未完成画稿: ${prompt}`, exact: true }).waitFor();
    await closeQueue(rp);
  }
  assert.equal(await failureCards.count(), 1);
  const originalFailure = (await jobs(rp)).find((job) => job.clientContext.prompt === retryPrompt);
  const untouchedFailure = (await jobs(rp)).find((job) => job.clientContext.prompt === untouchedPrompt);
  await rp.getByLabel('画面提示词', { exact: true }).fill('另一段尚未提交的提示词');
  await retryCard.getByRole('button', { name: '修改提示词', exact: true }).click();
  assert.equal(await rp.getByLabel('画面提示词', { exact: true }).inputValue(), retryPrompt);
  assert.equal(imageCount, retryStart + 2, 'editing the prompt alone must not generate an image');

  const retrySubmissions = [];
  const retryGate = new Promise((resolve) => { releaseRetrySubmission = resolve; });
  await rp.route('**/api/jobs', async (route) => {
    const input = route.request().postDataJSON();
    if (route.request().method() !== 'POST' || input.retryOf !== originalFailure.id) return route.continue();
    retrySubmissions.push(input);
    await retryGate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '模拟重试提交暂不可用' }) });
  });
  await retryCard.getByRole('button', { name: /^一键重试/ }).dblclick();
  await retryCard.getByRole('button', { name: /^正在提交/ }).waitFor();
  assert.ok(await retryCard.getByRole('button', { name: /^正在提交/ }).isDisabled());
  assert.ok(await retryCard.getByRole('button', { name: '修改提示词', exact: true }).isDisabled());
  await until(() => retrySubmissions.length === 1, 'only one retry submission for a double click');
  releaseRetrySubmission(); releaseRetrySubmission = undefined;
  await until(async () => await retryCard.getByRole('button', { name: /^一键重试/ }).isEnabled(), 'retry stays available after rejected submission');
  await rp.unroute('**/api/jobs');
  assert.equal(retrySubmissions.length, 1);
  assert.equal((await jobs(rp)).length, 2, 'a rejected retry did not create a server task');
  assert.equal((await jobs(rp)).find((job) => job.id === originalFailure.id).supersededBy, '');
  assert.equal(await failureCards.count(), 1, 'an unsubmitted retry must not add a second failure card');
  await rp.reload();
  await retryCard.waitFor();
  assert.equal(await failureCards.count(), 1);
  checks.push('重试提交失败保留原失败卡, 刷新后仍可继续; 未确认的重试不重复占位, 双击只提交一次, 修改提示词不自动生图');

  holdImage = new Promise((resolve) => { releaseImage = resolve; });
  await retryCard.getByRole('button', { name: /^一键重试/ }).click();
  const retryAttempt = await until(async () => (await jobs(rp)).find((job) => job.retryOf === originalFailure.id), 'retry accepted');
  assert.equal(retryAttempt.requestId, retrySubmissions[0].requestId, 'reuse the outbox request ID after an unconfirmed submission');
  await until(async () => await failureCards.count() === 0 && await rp.getByRole('heading', { name: '正在渲染', exact: true }).isVisible(), 'the accepted retry replaces the original failure card');
  assert.equal(await rp.locator('.studio-feed > article').count(), 1);
  await screenshot(rp, 'studio-retry-running-desktop', true);
  releaseImage(); releaseImage = undefined; holdImage = undefined;
  await until(async () => (await jobs(rp)).find((job) => job.id === retryAttempt.id)?.status === 'failed', 'retry fails once more');
  await retryCard.waitFor();
  assert.equal(await failureCards.count(), 1, 'a retry failure replaces its ancestor instead of accumulating another card');
  assert.equal((await jobs(rp)).find((job) => job.id === originalFailure.id).supersededBy, retryAttempt.id);

  rejectImage = false;
  await retryCard.getByRole('button', { name: /^一键重试/ }).click();
  await waitRecords(rp, 1);
  await until(async () => await failureCards.count() === 0 && (await rows(rp, 'outbox')).length === 1, 'older failure remains in the queue without occupying the recent batch');
  assert.equal((await rows(rp, 'outbox'))[0].requestId, untouchedFailure.requestId);
  const recoveredJobs = await jobs(rp);
  const recovered = recoveredJobs.find((job) => job.retryOf === retryAttempt.id);
  assert.equal(recovered.status, 'succeeded');
  assert.equal(recoveredJobs.find((job) => job.id === retryAttempt.id).supersededBy, recovered.id);
  assert.equal(recoveredJobs.find((job) => job.id === originalFailure.id).status, 'failed');
  assert.equal(imageCount, retryStart + 4, 'each user-confirmed attempt produces exactly one image request');
  await rp.reload();
  await until(async () => await rp.locator('.studio-feed > article').count() === 1, 'one recent creation');
  assert.equal(await failureCards.count(), 0);
  await rp.getByRole('button', { name: /任务队列/ }).click();
  const retryQueue = rp.getByRole('dialog', { name: '任务队列', exact: true });
  assert.equal(await retryQueue.getByText('已重新提交', { exact: true }).count(), 2, 'preserve earlier failures in history');
  assert.equal(await retryQueue.getByRole('button', { name: /^重新生成/ }).count(), 1, 'superseded failures cannot be retried again');
  await retryQueue.getByRole('button', { name: '清空已完成', exact: true }).click();
  await until(async () => !(await jobs(rp)).some((job) => job.id === recovered.id), 'successful retry archived');
  await closeQueue(rp);
  await rp.reload();
  await until(async () => await rp.locator('.studio-feed > article').count() === 1, 'one recent creation');
  assert.equal(await failureCards.count(), 0, 'archiving the successor must not bring back the old failure');
  await rp.setViewportSize({ width: 390, height: 844 });
  await screenshot(rp, 'studio-retry-completed-mobile', true);
  await nav(rp, '展馆');
  await rp.getByRole('checkbox', { name: /选择作品/ }).first().check();
  rp.once('dialog', (dialog) => dialog.accept());
  await rp.getByTitle('永久删除选中作品').click();
  await waitRecords(rp, 0);
  await nav(rp, '单图创作');
  await rp.reload();
  await until(async () => await rp.locator('.studio-feed > article').count() === 1, 'remaining unresolved creation');
  assert.equal(await failureCards.count(), 1, 'deleting the recovered image must not revive handled failures');
  assert.ok(await rp.getByRole('article', { name: `未完成画稿: ${untouchedPrompt}`, exact: true }).isVisible());
  await retryFlow.context.close();
  checks.push('重试入队接替旧失败占位, 再次失败只显示最新尝试; 成功后画卷仅保留近期作品, 旧失败仍在队列, 历史保留重试关系, 归档或删除作品后刷新不复现旧失败, 未处理失败不受影响');

  const draftFlow = await contextPage();
  const dp = draftFlow.page;
  const draftPrompt = '刷新后继续编辑的两张森林参考图';
  const referenceFile = { name: 'draft-reference.png', mimeType: 'image/png', buffer: png(640, 360) };
  await dp.getByLabel('画面提示词', { exact: true }).fill(draftPrompt);
  await dp.getByRole('button', { name: '2 张', exact: true }).click();
  await dp.getByRole('button', { name: /16:9 宽屏/ }).click();
  await dp.getByRole('button', { name: '高清 HD', exact: true }).click();
  await dp.getByRole('group', { name: '生成格式', exact: true }).getByRole('button', { name: 'WEBP', exact: true }).click();
  await dp.getByRole('button', { name: /^生动鲜明/ }).click();
  await dp.locator('.studio-rail input[type=file]').setInputFiles(referenceFile);
  await until(async () => (await workspaceDraft(dp))?.refImage?.name === referenceFile.name, 'unsubmitted reference saved');
  await dp.reload();
  await dp.locator('.studio-rail').getByRole('button', { name: '局部重绘', exact: true }).waitFor();
  assert.equal(await dp.getByLabel('画面提示词', { exact: true }).inputValue(), draftPrompt);
  assert.equal((await workspaceDraft(dp)).config.aspectRatio, '16:9');
  assert.equal((await workspaceDraft(dp)).refImage.name, referenceFile.name);
  checks.push('未提交单图文案, 参考图与画幅设置在刷新后完整恢复');

  imagesPerResult = 2;
  holdImage = new Promise((resolve) => { releaseImage = resolve; });
  await dp.getByRole('button', { name: /开始绘制/ }).click();
  await until(async () => (await jobs(dp)).filter((job) => ['pending', 'running'].includes(job.status)).length === 2, 'two logical requests are queued');
  await nav(dp, '风格库');
  const releaseFirstDraftImage = releaseImage;
  holdImage = new Promise((resolve) => { releaseImage = resolve; });
  releaseFirstDraftImage();
  await waitRecords(dp, 2);
  assert.equal((await workspaceDraft(dp)).config.prompt, draftPrompt, 'two images from the first request must not finish a two-request draft');
  assert.equal((await workspaceDraft(dp)).refImage.name, referenceFile.name);
  await dp.reload();
  await dp.getByLabel('搜索风格').waitFor();
  assert.equal((await workspaceDraft(dp)).config.prompt, draftPrompt, 'partially completed work survives refresh on another page');
  releaseImage(); releaseImage = undefined; holdImage = undefined;
  await waitRecords(dp, 4);
  const completedDraft = await waitEmptyWorkspace(dp);
  for (const [key, value] of Object.entries({ aspectRatio: '16:9', quality: 'high', outputFormat: 'webp', imageCount: 2 })) assert.equal(completedDraft.config[key], value);
  assert.equal(completedDraft.tone, 'vivid');
  await nav(dp, '单图创作');
  await dp.getByLabel('画面提示词', { exact: true }).waitFor();
  assert.equal(await dp.getByLabel('画面提示词', { exact: true }).inputValue(), '');
  assert.equal(await dp.getByLabel('移除参考图', { exact: true }).count(), 0);
  assert.equal(await dp.locator('.studio-feed > article').count(), 4);
  await screenshot(dp, 'studio-completed-draft-desktop', true);
  await dp.setViewportSize({ width: 390, height: 844 });
  await screenshot(dp, 'studio-completed-draft-mobile', true);
  await dp.getByRole('button', { name: '用户菜单', exact: true }).click(); await dp.getByRole('button', { name: '深色', exact: true }).click(); await dp.keyboard.press('Escape');
  await screenshot(dp, 'studio-completed-draft-mobile-dark', true);
  await dp.setViewportSize({ width: 1600, height: 1000 });
  checks.push('多图按请求全部保存后结束草稿, 单请求多结果不提前清空; 切换页面和刷新后不恢复旧内容, 常用参数与作品保留');

  imagesPerResult = 1;
  rejectImage = true;
  const failedDraftPrompt = '失败后刷新并沿用原稿重试';
  await dp.getByLabel('画面提示词', { exact: true }).fill(failedDraftPrompt);
  await dp.getByRole('button', { name: '1 张', exact: true }).click();
  await dp.locator('.studio-rail input[type=file]').setInputFiles(referenceFile);
  await dp.getByRole('button', { name: /开始绘制/ }).click();
  const failedDraftCard = dp.getByRole('article', { name: `未完成画稿: ${failedDraftPrompt}`, exact: true });
  await failedDraftCard.waitFor();
  await closeQueue(dp);
  await dp.reload();
  await failedDraftCard.waitFor();
  assert.equal(await dp.getByLabel('画面提示词', { exact: true }).inputValue(), failedDraftPrompt);
  assert.equal((await workspaceDraft(dp)).refImage.name, referenceFile.name);
  rejectImage = false;
  await failedDraftCard.getByRole('button', { name: /^一键重试/ }).click();
  await waitRecords(dp, 5);
  await waitEmptyWorkspace(dp);
  assert.equal(await dp.getByLabel('画面提示词', { exact: true }).inputValue(), failedDraftPrompt, 'completion does not interrupt the currently open editor');
  holdImage = new Promise((resolve) => { releaseImage = resolve; });
  await dp.getByRole('button', { name: /开始绘制/ }).click();
  await until(async () => (await jobs(dp)).some((job) => job.status === 'running'), 'unchanged completed draft submitted again');
  assert.equal((await workspaceDraft(dp)).config.prompt, failedDraftPrompt, 'explicitly resubmitting the open editor creates a recoverable draft again');
  await dp.reload();
  await dp.locator('.studio-rail').getByRole('button', { name: '局部重绘', exact: true }).waitFor();
  assert.equal(await dp.getByLabel('画面提示词', { exact: true }).inputValue(), failedDraftPrompt);
  releaseImage(); releaseImage = undefined; holdImage = undefined;
  await waitRecords(dp, 6);
  await waitEmptyWorkspace(dp);
  await dp.reload();
  await dp.getByLabel('画面提示词', { exact: true }).waitFor();
  assert.equal(await dp.getByLabel('画面提示词', { exact: true }).inputValue(), '');
  checks.push('失败草稿刷新保留文案和参考图, 重试成功后结束草稿; 当前画面保留供查看, 再次生成同一配方后刷新可继续');

  holdImage = new Promise((resolve) => { releaseImage = resolve; });
  await dp.getByLabel('画面提示词', { exact: true }).fill('正在生成的旧画面');
  await dp.locator('.studio-rail input[type=file]').setInputFiles(referenceFile);
  await dp.getByRole('button', { name: /开始绘制/ }).click();
  await until(async () => (await jobs(dp)).some((job) => job.status === 'running'), 'old draft generating');
  await closeQueue(dp);
  const nextDraftPrompt = '生成期间修改的新文案必须保留';
  await dp.getByLabel('画面提示词', { exact: true }).fill(nextDraftPrompt);
  const nextDraftFile = dp.waitForEvent('filechooser');
  await dp.getByRole('button', { name: '更换图片', exact: true }).click();
  await (await nextDraftFile).setFiles({ ...referenceFile, name: 'next-draft.png', buffer: png(360, 640) });
  await until(async () => (await workspaceDraft(dp))?.refImage?.name === 'next-draft.png', 'new draft saved while the previous one is running');
  releaseImage(); releaseImage = undefined; holdImage = undefined;
  await waitRecords(dp, 7);
  await until(async () => (await jobs(dp)).filter((job) => job.status === 'succeeded').every((job) => job.acknowledgedAt), 'all successful jobs acknowledged');
  await dp.reload();
  await dp.locator('.studio-rail').getByRole('button', { name: '局部重绘', exact: true }).waitFor();
  assert.equal(await dp.getByLabel('画面提示词', { exact: true }).inputValue(), nextDraftPrompt);
  assert.equal((await workspaceDraft(dp)).refImage.name, 'next-draft.png');
  await dp.locator('.studio-rail').getByRole('button', { name: '局部重绘', exact: true }).click();
  const newDraftMask = dp.getByRole('dialog', { name: /局部重绘工作区/ });
  await drawMask(dp, newDraftMask);
  await newDraftMask.getByLabel('局部重绘提示词').fill('保留尚未提交的局部修改');
  await newDraftMask.getByRole('button', { name: '保存并应用蒙版', exact: true }).click();
  await dp.getByText(/已圈定局部重绘蒙版区域/).waitFor();
  await dp.getByRole('button', { name: '新建创作', exact: true }).click();
  await waitEmptyWorkspace(dp);
  await dp.reload();
  await dp.getByLabel('画面提示词', { exact: true }).waitFor();
  assert.equal(await dp.getByLabel('画面提示词', { exact: true }).inputValue(), '');
  assert.equal(await dp.getByLabel('移除参考图', { exact: true }).count(), 0);
  assert.equal((await rows(dp)).length, 7);
  checks.push('生成期间的新文案和参考图不被完成通知清除, 新建创作清空文案/参考图/蒙版且不影响作品');

  await nav(dp, '系列策划');
  await dp.locator('#series-story-prompt').fill('旧系列正在生成时开始新的策划');
  await dp.getByRole('button', { name: /^智能拆解分镜/ }).click();
  await until(() => dp.getByRole('button', { name: /^确认并生成 4 张图片/ }).isEnabled(), 'series draft ready');
  holdImage = new Promise((resolve) => { releaseImage = resolve; });
  await dp.getByRole('button', { name: /^确认并生成 4 张图片/ }).click();
  await until(async () => (await jobs(dp)).filter((job) => ['running', 'pending'].includes(job.status)).length === 4, 'old series generating');
  await closeQueue(dp);
  await dp.getByRole('button', { name: '新建系列', exact: true }).click();
  await dp.locator('#series-story-prompt').fill('独立的新系列草稿');
  await dp.getByLabel('上传系列参考图').setInputFiles(referenceFile);
  await until(async () => (await workspaceDraft(dp, 'series'))?.reference?.name === referenceFile.name, 'new series reference saved');
  releaseImage(); releaseImage = undefined; holdImage = undefined;
  await waitRecords(dp, 11);
  await until(async () => (await jobs(dp)).filter((job) => job.status === 'succeeded').every((job) => job.acknowledgedAt), 'old series saved without ending the new draft');
  await dp.reload();
  await dp.getByRole('img', { name: '系列主体参考', exact: true }).waitFor();
  assert.equal(await dp.locator('#series-story-prompt').inputValue(), '独立的新系列草稿');
  assert.equal((await workspaceDraft(dp, 'series')).seriesId, '');
  await draftFlow.context.close();
  checks.push('生成期间新建系列可保存独立梗概与参考图, 旧系列完成后刷新仍保留新策划');

  const legacyRecord = { id: 'legacy-art', prompt: '旧作品', dataUrl: `data:image/png;base64,${png(12, 8).toString('base64')}`, providerId: 'legacy', providerName: '旧通道', createdAt: 1700000000000, mode: 'text', kind: 'single' };
  for (const source of ['indexeddb-v3', 'localstorage']) {
    const migrated = await contextPage(({ source, record }) => {
      if (localStorage.getItem('migration-fixture')) return;
      localStorage.setItem('migration-fixture', '1');
      if (source === 'localstorage') localStorage.setItem('sprout_canvas_gallery_v1', JSON.stringify([record]));
      else {
        const open = indexedDB.open('img-gen-gallery', 3);
        open.onupgradeneeded = () => open.result.createObjectStore('records', { keyPath: 'id' }).put(record);
        open.onsuccess = () => open.result.close();
      }
    }, { source, record: legacyRecord });
    const saved = await waitRecords(migrated.page, 1);
    assert.equal(saved[0].createdAt, legacyRecord.createdAt);
    assert.equal(saved[0].dataUrl, undefined);
    assert.equal((await rows(migrated.page, 'artifacts')).length, 1);
    await migrated.page.reload();
    await waitRecords(migrated.page, 1);
    assert.equal(await migrated.page.evaluate(() => localStorage.getItem('sprout_canvas_gallery_v1')), null);
    await migrated.context.close();
  }
  checks.push('IndexedDB v3 与 localStorage 旧作品迁移, Blob 分离, 时间稳定和刷新无重复');

  const blockedStorage = await browser.newContext();
  await blockedStorage.addInitScript(() => {
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) { if (key === 'sprout_canvas_user_id') throw new DOMException('Storage blocked', 'SecurityError'); return read.call(this, key); };
  });
  const blockedPage = await blockedStorage.newPage();
  blockedPage.on('pageerror', (error) => errors.push(error.message));
  await blockedPage.goto(app.base);
  await blockedPage.getByLabel('访问码', { exact: true }).fill(app.accessCode);
  await blockedPage.getByRole('button', { name: '进入工作台', exact: true }).click();
  await blockedPage.locator('.studio-rail textarea').waitFor();
  assert.equal(await blockedPage.evaluate(async () => (await (await fetch('/api/auth/status')).json()).authenticated), true);
  await blockedStorage.close();
  checks.push('匿名身份使用服务端 Cookie, 不依赖可伪造的旧 localStorage 用户编号');
  assert.deepEqual(errors, []);
  await writeFile(path.join(target, 'report.json'), JSON.stringify({ passed: checks, pageErrors: errors, imageRequests: imageCount, screenshots: target }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, imageRequests: imageCount, artifacts: target }));
} catch (error) {
  const failurePage = browser.contexts().flatMap((context) => context.pages()).at(-1) || page;
  await failurePage.screenshot({ path: path.join(target, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ checks, errors, url: failurePage.url(), message: error.message }));
  throw error;
} finally {
  releasePlan?.();
  releaseCapabilities?.();
  releaseRetrySubmission?.();
  releaseImage?.();
  holdImage = undefined;
  await browser.close();
  await app.close();
}
