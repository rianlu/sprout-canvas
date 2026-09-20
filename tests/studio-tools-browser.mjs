import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { chromium } from 'playwright';
import { startHarness, until } from './server-harness.mjs';
import { png } from './fixtures.mjs';
import { imageInfo } from '../server/image-result.mjs';

const output = path.join(process.env.SPROUT_TEST_OUTPUT || path.join(tmpdir(), 'sprout-browser-check'), 'studio-tools');
await mkdir(output, { recursive: true });
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [], checks = [], submissions = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/jobs/batch') submissions.push(...request.postDataJSON().jobs);
});
const photo = await readFile(new URL('../public/assets/stitch/studio-01.jpg', import.meta.url));
let holdImage, releaseImage;
app.controls.respond = async (_call, res) => {
  if (holdImage) await holdImage;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [{ b64_json: photo.toString('base64') }] }));
  return true;
};
const input = () => page.getByLabel('画面提示词', { exact: true });
const references = () => page.getByLabel('已载入参考图', { exact: true });
async function stored(store, key) {
  return page.evaluate(async ({ store, key }) => {
    const db = await new Promise((resolve, reject) => { const op = indexedDB.open('img-gen-gallery'); op.onsuccess = () => resolve(op.result); op.onerror = () => reject(op.error); });
    const value = await new Promise((resolve, reject) => { const object = db.transaction(store).objectStore(store); const op = key === undefined ? object.getAll() : object.get(key); op.onsuccess = () => resolve(op.result); op.onerror = () => reject(op.error); });
    db.close();
    if (value instanceof Blob) return Array.from(new Uint8Array(await value.arrayBuffer()));
    return value;
  }, { store, key });
}
const draft = async () => (await stored('drafts', 'studio'))?.data;
const auth = () => page.evaluate(async () => (await (await fetch('/api/auth/status')).json()));
async function closeQueue() { const close = page.getByLabel('关闭队列抽屉'); if (await close.isVisible()) await close.click(); }
async function upload(files, label = '上传参考图') {
  await page.getByLabel(label, { exact: true }).setInputFiles(files);
  await until(async () => await page.getByLabel('上传参考图', { exact: true }).isEnabled(), 'reference decoding');
}
async function replace(referenceNumber, file) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: `更换参考图 ${referenceNumber}`, exact: true }).click();
  await (await chooser).setFiles(file);
  await until(async () => (await draft())?.config.refImages[referenceNumber - 1]?.name === file.name, 'single reference replacement');
}
async function screenshot(name) {
  await page.evaluate(async () => document.fonts.ready);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  const sizes = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(sizes[0] <= sizes[1] + 1, `${name}: horizontal page overflow`);
  const missingIcons = await page.locator('.studio-rail .material-symbols-outlined').evaluateAll((icons) => icons.filter((icon) => icon.getClientRects().length && icon.getBoundingClientRect().width > parseFloat(getComputedStyle(icon).fontSize) * 1.6).map((icon) => icon.textContent));
  assert.deepEqual(missingIcons, [], `${name}: local icon glyphs`);
}
function unzip(bytes) {
  const entries = []; let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0, 'stored ZIP entry');
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const content = bytes.subarray(start, start + length);
    assert.equal(crc32(content), bytes.readUInt32LE(offset + 14), 'ZIP CRC matches image contents');
    assert.doesNotMatch(name, /[\\/\u0000-\u001f]/, 'entry is a filename, not a path');
    entries.push({ name, content }); offset = start + length;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length - 12), entries.length);
  assert.equal(new Set(entries.map((entry) => entry.name)).size, entries.length);
  return entries;
}

try {
  await page.goto(app.base);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base });
  await page.getByLabel('访问码', { exact: true }).fill(app.accessCode);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click(); await input().waitFor();
  await page.getByRole('button', { name: '从风格库挑选提示词模板', exact: true }).click();
  const catalog = await page.evaluate(async () => (await (await fetch('/api/styles')).json()));
  const style = catalog.styles[0];
  await page.locator('article').filter({ has: page.getByRole('heading', { name: style.name, exact: true }) }).getByRole('button', { name: '发送到单图', exact: true }).click();
  const template = page.getByRole('group', { name: '已选提示词模板' });
  await template.getByRole('heading', { name: style.name, exact: true }).waitFor();
  assert.equal(await template.getByRole('img').getAttribute('src'), style.image);
  assert.equal(await template.getByText(/^作者:/).count(), 0);
  assert.equal(await template.getByText('提示词已填入上方, 可自由修改. 示例图仅供浏览.', { exact: true }).count(), 0);
  assert.equal(await input().inputValue(), style.prompt);
  const editedPrompt = '结合图 1 的主体和图 2 的背景, 使用图 3 与图 4 的配色.';
  await input().fill(editedPrompt);
  await until(async () => (await draft())?.config.prompt === editedPrompt, 'template edits saved');
  await page.reload(); await template.waitFor();
  assert.equal(await input().inputValue(), editedPrompt);
  assert.equal(await template.getByRole('img').getAttribute('src'), style.image);
  assert.deepEqual((await draft()).config.refImages, [], 'style example is not a generation reference');
  await screenshot('template-card-desktop');
  await page.getByRole('button', { name: '移除模板', exact: true }).click();
  assert.equal(await template.count(), 0);
  assert.equal(await input().inputValue(), editedPrompt);
  assert.equal(submissions.length, 0);
  checks.push('紧凑模板卡片展示示例图与名称, 隐藏作者和常驻说明, 草稿刷新保留, 移除关联保留文案, 不自动生图或添加参考');

  const files = [
    { name: '主体.png', mimeType: 'image/png', buffer: png(640, 360) },
    { name: '背景.png', mimeType: 'image/png', buffer: png(320, 480, [180, 145, 90, 255]) },
    { name: '配色.png', mimeType: 'image/png', buffer: png(500, 400, [165, 100, 130, 255]) },
    { name: '材质.png', mimeType: 'image/png', buffer: png(400, 400, [90, 130, 180, 255]) },
  ];
  await upload([...files, files[0]]);
  await page.getByRole('alert').filter({ hasText: '最多使用 4 张参考图' }).waitFor();
  assert.equal((await draft()).refImage, null);
  await upload(files.slice(0, 2));
  await until(async () => (await draft()).config.refImages.length === 2, 'two files selected');
  const originalIds = (await draft()).config.refImages.map((ref) => ref.id);
  await upload([files[2], { name: '损坏.png', mimeType: 'image/png', buffer: Buffer.from('invalid') }]);
  await page.getByRole('alert').filter({ hasText: '图片加载失败' }).waitFor();
  assert.deepEqual((await draft()).config.refImages.map((ref) => ref.id), originalIds, 'failed multi-file input does not partially append');
  await upload(files.slice(2));
  await until(async () => (await draft()).config.refImages.length === 4, 'four references saved');
  assert.equal(await references().getByRole('button', { name: /^添加参考图/ }).count(), 0);
  const beforeReplace = (await draft()).config.refImages;
  const replacement = { name: '新背景.png', mimeType: 'image/png', buffer: png(360, 640, [210, 170, 120, 255]) };
  await replace(2, replacement);
  assert.deepEqual((await draft()).config.refImages.filter((_, index) => index !== 1), beforeReplace.filter((_, index) => index !== 1));
  await page.getByRole('button', { name: '移除参考图 1', exact: true }).click();
  await until(async () => (await draft()).config.refImages.length === 3, 'remove only one image');
  assert.equal((await draft()).refImage.name, replacement.name);
  await upload([files[0]]);
  await until(async () => (await draft()).config.refImages.length === 4, 'append after removal');
  const expectedReferences = (await draft()).config.refImages;
  await page.reload(); await references().waitFor();
  assert.deepEqual((await draft()).config.refImages, expectedReferences);
  assert.equal(await references().getByRole('img').count(), 4);
  await screenshot('multi-reference-desktop');
  for (const dark of [false, true]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    await screenshot(dark ? 'multi-reference-mobile-dark' : 'multi-reference-mobile');
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  checks.push('最多四图, 多选/追加/单张替换/删除/刷新顺序一致, 非法批次保持原图, 桌面手机深浅主题无横向溢出');

  await page.getByRole('button', { name: '局部重绘', exact: true }).click();
  assert.ok(await page.getByRole('button', { name: /^开始局部重绘/ }).isDisabled());
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  assert.equal(submissions.length, 0, 'edit mode without a saved mask cannot submit a job');
  await page.getByRole('button', { name: '绘制蒙版', exact: true }).click();
  const maskDialog = page.getByRole('dialog', { name: '局部重绘工作区', exact: true });
  await maskDialog.waitFor();
  const canvas = maskDialog.getByLabel('蒙版画布, 按住拖动涂抹');
  await until(async () => (await canvas.boundingBox())?.width > 0, 'mask canvas ready');
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.5); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.5, { steps: 6 }); await page.mouse.up();
  await maskDialog.getByLabel('局部重绘提示词').fill('只修改选中的区域为绿色');
  await maskDialog.getByRole('button', { name: '保存并应用蒙版', exact: true }).click(); await maskDialog.waitFor({ state: 'hidden' });
  await page.reload(); await page.getByLabel('局部修改要求', { exact: true }).waitFor();
  await page.getByRole('button', { name: '编辑蒙版', exact: true }).waitFor();
  assert.equal((await draft()).refImage.id, expectedReferences[0].id);
  assert.deepEqual((await draft()).config.refImages, expectedReferences);
  assert.match(await page.locator('.studio-reference-area').innerText(), /其余 3 张图片已保留/);
  assert.equal(await page.locator('.studio-reference-area').getByRole('img').count(), 1);
  const spentBefore = (await auth()).credits.spent;
  await page.getByRole('button', { name: /^开始局部重绘/ }).click();
  await until(() => submissions.length === 1, 'edit request');
  assert.equal(submissions[0].request.references.length, 1);
  assert.equal(submissions[0].request.references[0].id, expectedReferences[0].id);
  assert.equal(submissions[0].request.references[0].dataUrl, expectedReferences[0].dataUrl);
  assert.ok(submissions[0].request.mask);
  await until(async () => (await stored('records')).length === 1, 'edited result saved', 15000);
  await until(async () => (await auth()).credits.reserved === 0, 'edit points settled');
  assert.equal((await auth()).credits.spent - spentBefore, 10);
  await closeQueue();
  const resultCard = page.locator('.studio-feed article').filter({ has: page.getByTitle('复制原图', { exact: true }) }).first();
  await resultCard.hover();
  await resultCard.getByTitle('复制原图', { exact: true }).click();
  await until(async () => await page.getByText('已复制原图', { exact: true }).count(), 'copied original toast');
  const copiedBytes = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const image = items.find((item) => item.types.includes('image/png'));
    return image ? (await image.getType('image/png')).size : 0;
  });
  assert.ok(copiedBytes > 1000, 'clipboard holds original image bytes, not an empty thumbnail');
  await resultCard.getByRole('button', { name: /^查看作品详情/ }).click();
  const viewer = page.getByRole('dialog', { name: '作品检视', exact: true });
  await viewer.waitFor();
  await viewer.getByRole('button', { name: '关闭查看器', exact: true }).click();
  await viewer.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '参考图生成', exact: true }).click();
  assert.deepEqual((await draft()).config.refImages, expectedReferences);
  assert.equal(await page.locator('.studio-reference-area').getByRole('button', { name: /^(局部涂抹修改|绘制蒙版|编辑蒙版)$/ }).count(), 0);
  await input().fill(editedPrompt);
  holdImage = new Promise((resolve) => { releaseImage = resolve; });
  await page.getByRole('button', { name: /^开始绘制/ }).click();
  await until(() => submissions.length === 2, 'four-reference request');
  const referenceRequest = submissions[1];
  assert.deepEqual(referenceRequest.request.references.map((ref) => ref.id), expectedReferences.map((ref) => ref.id));
  assert.equal(referenceRequest.request.mask, undefined);
  const outbox = await stored('outbox', referenceRequest.requestId);
  assert.deepEqual(outbox.input.request.references, referenceRequest.request.references.map((ref) => ({ ...ref, dataUrl: '' })));
  for (const reference of referenceRequest.request.references) {
    assert.deepEqual(Buffer.from(await stored('artifacts', `ref-${reference.id}`)), Buffer.from(reference.dataUrl.split(',')[1], 'base64'));
  }
  await page.reload(); await input().waitFor();
  releaseImage(); releaseImage = undefined; holdImage = undefined;
  await until(async () => (await stored('records')).length === 2, 'reference result saved after reload', 15000);
  const result = (await stored('records')).find((record) => record.requestId === referenceRequest.requestId);
  assert.deepEqual(result.recipe.references.map((ref) => ref.id), expectedReferences.map((ref) => ref.id));
  assert.equal((await auth()).credits.spent - spentBefore, 20, 'four input images still charge once per output');
  const multiCall = app.calls.at(-1);
  assert.equal([...multiCall.body.toString('latin1').matchAll(/name="image\[\]"; filename=/g)].length, 4);
  assert.doesNotMatch(multiCall.body.toString('latin1'), /name="mask"/);
  await closeQueue();
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '展馆', exact: true }).click();
  await page.getByRole('button', { name: /^检视作品:/ }).first().click();
  await page.getByRole('button', { name: '复用完整配方', exact: true }).click();
  await references().waitFor();
  assert.deepEqual((await draft()).config.refImages.map((ref) => ref.id), expectedReferences.map((ref) => ref.id));
  checks.push('切换局部重绘后仅提交第一张原图, 其余参考可恢复; 四图请求/outbox/配方完整, 刷新不重发, 按输出一张扣十点');

  await page.getByRole('button', { name: /^查看作品详情/ }).first().click();
  const inspect = page.getByRole('dialog', { name: '作品检视', exact: true });
  await inspect.waitFor();
  const details = inspect.getByRole('button', { name: '查看详情', exact: true });
  if (await details.count()) await details.click();
  await inspect.getByRole('button', { name: '切图拆分', exact: true }).click();
  const split = page.getByRole('dialog', { name: '切图工具', exact: true }); await split.waitFor();
  await split.locator('input[type=file]').setInputFiles({ name: '九宫格测试.png', mimeType: 'image/png', buffer: png(641, 359) });
  await split.getByRole('button', { name: '切分为 3×3', exact: true }).click();
  await split.getByRole('button', { name: '打包下载 (9 张)', exact: true }).waitFor();
  const originalSlices = await split.locator('figure img').evaluateAll((images) => images.map((image) => ({ name: image.alt, url: image.src })));
  await split.getByLabel('列', { exact: true }).fill('2');
  await split.getByRole('button', { name: 'JPEG', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await split.getByRole('button', { name: '打包下载 (9 张)', exact: true }).click();
  const archive = await downloading;
  assert.equal(archive.suggestedFilename(), '九宫格测试_3x3.zip', 'download describes the completed batch');
  const entries = unzip(await readFile(await archive.path()));
  assert.equal(entries.length, 9);
  for (const [index, entry] of entries.entries()) {
    assert.equal(entry.name, originalSlices[index].name);
    assert.deepEqual(entry.content, Buffer.from(originalSlices[index].url.split(',')[1], 'base64'));
    assert.equal(imageInfo(entry.content).mime_type, 'image/png');
  }
  const sizes = entries.map((entry) => imageInfo(entry.content));
  assert.equal(sizes.slice(0, 3).reduce((sum, size) => sum + size.width, 0), 641);
  assert.equal([0, 3, 6].reduce((sum, index) => sum + sizes[index].height, 0), 359);
  for (const format of ['JPEG', 'WEBP']) {
    await split.getByRole('button', { name: format, exact: true }).click();
    await split.getByRole('button', { name: '切分为 3×2', exact: true }).click();
    const batchDownload = page.waitForEvent('download');
    await split.getByRole('button', { name: '打包下载 (6 张)', exact: true }).click();
    const batch = await batchDownload;
    const files = unzip(await readFile(await batch.path()));
    assert.equal(files.length, 6);
    assert.ok(files.every((entry) => imageInfo(entry.content).mime_type === `image/${format.toLowerCase()}`));
  }
  await screenshot('split-zip-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await split.getByRole('button', { name: '打包下载 (6 张)', exact: true }).scrollIntoViewIfNeeded();
  await screenshot('split-zip-mobile');
  await page.setViewportSize({ width: 1600, height: 1000 });
  const singleDownload = page.waitForEvent('download'); await split.getByRole('button', { name: '下载', exact: true }).first().click();
  assert.match((await singleDownload).suggestedFilename(), /_r1c1\.webp$/);
  const callsBeforeSplit = app.calls.length;
  await split.locator('input[type=file]').setInputFiles({ name: '新图.png', mimeType: 'image/png', buffer: png(160, 160) });
  await until(async () => await split.locator('figure').count() === 0, 'new source clears old batch');
  assert.equal(await split.getByRole('button', { name: /打包下载/ }).count(), 0);
  assert.equal(app.calls.length, callsBeforeSplit);
  checks.push('ZIP 文件数量/名称/CRC/原始内容正确, 三种格式与单张下载可用, 参数修改不混用旧批次, 非整除尺寸不丢像素, 换图清理旧切片');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ output, passed: checks.length, checks }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, errors, checks }, null, 2));
  throw error;
} finally {
  releaseImage?.();
  await browser.close(); await app.close();
}
