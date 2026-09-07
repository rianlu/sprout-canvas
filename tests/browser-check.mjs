import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { crc32 } from 'node:zlib';
import { chromium } from 'playwright';
import { startHarness, TEST_PASSWORD, until } from './server-harness.mjs';
import { png } from './fixtures.mjs';

const target = process.env.SPROUT_TEST_OUTPUT || path.join(tmpdir(), 'sprout-browser-check');
await mkdir(target, { recursive: true });
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
const checks = [];
const images = await Promise.all(['studio-01.jpg', 'studio-02.jpg', 'studio-03.jpg', 'series-01.jpg'].map((name) => readFile(new URL(`../public/assets/stitch/${name}`, import.meta.url))));
let imageCount = 0;
let imagesPerResult = 1;
let delayImage = 0;
let imageOverride;
let holdImage;
let releaseImage;
let releasePlan;
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
  const bytes = imageOverride || images[(imageCount - 1) % images.length];
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: Array.from({ length: imagesPerResult }, () => ({ b64_json: bytes.toString('base64') })) }));
  return true;
};

async function contextPage(init, initValue) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', acceptDownloads: true });
  if (init) await context.addInitScript(init, initValue);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(8000);
  await page.goto(app.base);
  await page.getByLabel('访问密码').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: '登录', exact: true }).click();
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
async function screenshot(page, name, fullPage = false) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: path.join(target, `${name}.png`), fullPage });
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  assert.ok(overflow.scroll <= overflow.width + 1, `${name} horizontal overflow: ${JSON.stringify(overflow)}`);
  for (const label of ['任务队列', '切换主题', '退出工作台']) {
    const bounds = await page.getByRole('button', { name: new RegExp(label) }).first().boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= overflow.width + 1, `${name}: ${label} must stay inside viewport`);
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
  await viewer.locator('.stitch-paper-frame img').waitFor();
  await page.waitForFunction(() => { const img = document.querySelector('.stitch-paper-frame img'); return img?.complete && img.naturalWidth > 100; });
  await screenshot(page, 'viewer-single-desktop');
  const downloadEvent = page.waitForEvent('download');
  await viewer.getByRole('button', { name: '单张下载', exact: true }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.jpg$/);
  const downloadPath = path.join(target, download.suggestedFilename());
  await download.saveAs(downloadPath);
  assert.ok((await readFile(downloadPath)).length > 1000);
  const savedRecipe = remaining[0].recipe;
  await viewer.getByRole('button', { name: '复用完整配方' }).click();
  await page.locator('.studio-rail textarea').waitFor();
  assert.equal(await page.locator('.studio-rail textarea').inputValue(), savedRecipe.prompt);
  assert.ok(await page.getByRole('button', { name: /原始配方/ }).isVisible());
  checks.push('2 张生成, 实际格式下载, 原子领取, 删除后刷新不重现, 时间稳定, 完整配方复用');

  // Save a real brush mask, navigate away and reload without losing it.
  await page.locator('.studio-rail input[type=file]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png(640, 360) });
  await page.locator('.studio-rail').getByRole('button', { name: '局部涂抹修改', exact: true }).click();
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
  await page.route('**/api/jobs', async (route) => {
    if (route.request().method() === 'POST' && ++submissions === 3) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试: 提交暂时不可用' }) });
    await route.continue();
  });
  const seriesStart = imageCount;
  const jobsBeforePlanning = (await jobs(page)).length;
  const outboxBeforePlanning = (await rows(page, 'outbox')).length;
  const confirmSeries = page.getByRole('button', { name: '确认并生成 4 张图片', exact: true });
  assert.ok(await confirmSeries.isDisabled());
  let splitRequests = 0;
  const planGate = new Promise((resolve) => { releasePlan = resolve; });
  await page.route('**/api/text', async (route) => { splitRequests++; await planGate; await route.continue(); });
  await page.getByRole('button', { name: '智能拆解分镜', exact: true }).dblclick();
  await page.getByRole('button', { name: '正在拆解分镜...', exact: true }).waitFor();
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
  await page.getByRole('button', { name: '重新拆解分镜', exact: true }).click();
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
  await waitRecords(page, 4);
  await closeQueue(page);
  await page.getByRole('button', { name: /继续提交剩余分镜/ }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /继续提交剩余分镜/ }).waitFor();
  await page.getByRole('button', { name: /继续提交剩余分镜/ }).click();
  await waitRecords(page, 6);
  assert.equal(imageCount - seriesStart, 4);
  await page.unroute('**/api/jobs');
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
  await page.getByTitle('重新绘制本镜', { exact: true }).first().click();
  await waitRecords(page, 7); await closeQueue(page);
  assert.ok((await rows(page)).some((record) => record.version === 2 && record.parentId));
  await page.getByRole('button', { name: '调整并重绘', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: '调整第 1 镜', exact: true });
  await editor.getByLabel('本镜画面提示词').fill('小棕熊在晴朗的河边散步');
  await editor.getByLabel('本镜质量').selectOption('high');
  await editor.getByRole('button', { name: '保存并重绘本镜', exact: true }).click();
  await waitRecords(page, 8); await closeQueue(page);
  assert.ok((await rows(page)).some((record) => record.version === 3 && record.recipe.quality === 'high'));
  await page.getByTitle('全屏预览大图', { exact: true }).first().click();
  await page.getByLabel('本镜版本', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('本镜版本').locator('option').count(), 3);
  await screenshot(page, 'viewer-series-desktop');
  await page.getByLabel('关闭查看器').click();
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
  await page.getByRole('button', { name: /^查看 .* 详情$/ }).first().click();
  const styleDialog = page.getByRole('dialog', { name: /风格详情/ });
  assert.match(await styleDialog.innerText(), /CC BY 4.0/);
  assert.doesNotMatch(await styleDialog.innerText(), /CFG|Seed|步数/);
  await screenshot(page, 'style-detail');
  await page.getByLabel('关闭详情').click();
  await page.getByLabel('搜索风格').fill('');
  checks.push('风格 36 款和六类真实计数, 搜索, 署名, 移除不支持的参数');

  for (const [width, height, device] of [[1600, 1000, 'desktop'], [1024, 900, 'tablet'], [390, 844, 'mobile']]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
      for (const [label, key] of [['单图创作', 'studio'], ['系列策划', 'series'], ['风格库', 'styles'], ['展馆', 'gallery']]) {
        await nav(page, label);
        await page.waitForTimeout(100);
        await screenshot(page, `${key}-${device}-${theme}`);
      }
    }
  }
  await page.getByLabel('退出工作台').click();
  await page.getByLabel('访问密码').waitFor();
  await page.getByLabel('访问密码').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('header').waitFor();
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await page.waitForFunction(() => document.querySelector('input[aria-label="访问密码"]'), undefined, { timeout: 10000 });
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
  assert.ok((await jobs(quota.page)).some((job) => job.status === 'succeeded' && !job.acknowledgedAt));
  await quota.page.evaluate(() => { window.__allowImageSave = true; });
  await quota.page.getByRole('button', { name: '重试', exact: true }).click();
  await waitRecords(quota.page, 2);
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
  await op.getByTitle('在风格库选择基底风格').click();
  await op.getByRole('button', { name: '发送到系列', exact: true }).first().click();
  await op.getByTitle('在风格库选择基底风格').filter({ hasText: '轻柔水彩绘本' }).waitFor();
  await op.locator('#series-story-prompt').fill('森林主题陶瓷杯, 展示商品外形, 材质和使用场景');
  await op.getByLabel('系列生成质量').selectOption('high');
  holdImage = new Promise((resolve) => { releaseImage = resolve; });
  await op.getByRole('button', { name: '智能拆解分镜', exact: true }).click();
  await until(() => op.getByRole('button', { name: '确认并生成 4 张图片', exact: true }).isEnabled(), 'commerce plan ready for review');
  await op.getByRole('button', { name: '确认并生成 4 张图片', exact: true }).click();
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
  assert.match(await op.getByTitle('在风格库选择基底风格').innerText(), /轻柔水彩绘本/);
  assert.equal(await op.locator('img[alt="系列主体参考"]').count(), 1);
  const derived = await op.evaluate(() => ({ id: localStorage.getItem('sprout_canvas_draft_batch_series_id'), scenes: JSON.parse(localStorage.getItem('sprout_canvas_draft_batch_scene_ids')), template: localStorage.getItem('sprout_canvas_draft_batch_template') }));
  assert.notEqual(derived.id, originalSeriesId);
  assert.ok(derived.scenes.every((id) => !originalSceneIds.includes(id)));
  assert.equal(derived.template, 'ecommerce');
  assert.equal(await op.getByTitle('重新绘制本镜', { exact: true }).count(), 0);
  checks.push('系列待执行编辑与置顶实际生效, 衍生系列复用模板/风格/参数/原图并生成独立身份');

  await op.reload();
  await op.getByRole('button', { name: '使用帮助与创作守则', exact: true }).click();
  const help = op.getByRole('dialog', { name: '工作台帮助', exact: true });
  await help.getByRole('heading', { name: '通道状态', exact: true }).waitFor();
  assert.match(await help.innerText(), /可用/);
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
  checks.push('帮助与实际通道状态, 系列文件分享传入四张原图 (模拟系统分享接口)');

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
  await ep.getByLabel('画面提示词', { exact: true }).fill('一只白色杯子放在森林木桌上');
  await ep.getByRole('button', { name: /16:9 宽屏/ }).click();
  await ep.getByRole('button', { name: '高清 HD', exact: true }).click();
  await ep.getByRole('button', { name: '水彩绘本', exact: true }).click();
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
  await ep.getByRole('button', { name: '黏土玩具', exact: true }).click();
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
    assert.equal(await ep.getByRole('button', { name: '更多风格', exact: true }).count(), 0);
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
  await ep.locator('.studio-rail').getByRole('button', { name: '局部涂抹修改', exact: true }).click();
  await wideMask.getByRole('button', { name: '清空蒙版', exact: true }).click();
  await wideMask.getByRole('button', { name: '保存并应用蒙版', exact: true }).click();
  await wideMask.waitFor({ state: 'hidden' });
  assert.ok(await ep.getByRole('button', { name: /开始局部重绘/ }).isDisabled());
  await ep.reload(); await assertEditSettings();
  assert.ok(await ep.getByRole('button', { name: /开始局部重绘/ }).isDisabled());
  await ep.getByRole('button', { name: '参考图生成', exact: true }).click();
  await ep.getByRole('button', { name: /1:1 方图/ }).click();
  await ep.getByRole('button', { name: '黏土玩具', exact: true }).click();
  await ep.getByLabel('画面提示词', { exact: true }).fill('以杯子为参考重新设计一个方形画面');
  await ep.getByRole('button', { name: /开始绘制/ }).click();
  const referenced = (await waitRecords(ep, 3)).find((record) => record.mode === 'reference');
  assert.equal(referenced.recipe.size, '1024x1024');
  assert.equal(referenced.recipe.hasMask, false);
  assert.equal(referenced.recipe.styleId, 'open-13957');
  await closeQueue(ep);
  await nav(ep, '展馆');
  await ep.getByRole('button', { name: /检视作品: 一只白色杯子/ }).click();
  await ep.getByRole('button', { name: '局部重绘此图', exact: true }).click();
  await wideMask.waitFor();
  await wideMask.getByRole('button', { name: '取消', exact: true }).click();
  await assertEditSettings();
  assert.ok(await ep.getByRole('button', { name: /开始局部重绘/ }).isDisabled());
  checks.push('清空蒙版保持编辑模式并阻止提交, 显式切换参考图后可修改参数, 展馆编辑入口一致');
  imageOverride = undefined;
  await editFlow.context.close();

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
  await blockedPage.getByRole('alert').filter({ hasText: '浏览器存储不可用' }).waitFor();
  assert.ok(await blockedPage.getByRole('button', { name: '重新连接', exact: true }).isVisible());
  await blockedStorage.close();
  checks.push('浏览器身份存储被禁用时显示可恢复错误');
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
  releaseImage?.();
  holdImage = undefined;
  await browser.close();
  await app.close();
}
