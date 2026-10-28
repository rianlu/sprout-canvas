import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startHarness, until } from './server-harness.mjs';

// One GPT Image 2 channel takes transparency only at standard sizes, the other takes wide frames only,
// so a wide transparent request fits neither. GPT Image 2.5 offers standard sizes only.
const output = path.join(process.env.SPROUT_TEST_OUTPUT || path.join(tmpdir(), 'sprout-browser-check'), 'model-selector');
await mkdir(output, { recursive: true });
const app = await startHarness({ serveDist: true });
const [base] = app.config.imageProviders;
const channel = (id, imageModel, capabilities) => ({ ...base, id, name: id, baseUrl: base.baseUrl.replace('/primary', `/${id}`), imageModel, capabilities: { outputFormats: ['png'], exactSize: false, ...capabilities } });
app.config.imageProviders = [
  channel('primary', 'gpt-image-2', { transparent: true, customSizes: false }),
  channel('secondary', 'gpt-image-2', { transparent: false, customSizes: true }),
  channel('newer', 'gpt-image-2.5', { transparent: false, customSizes: false }),
];
const saveConfig = () => writeFile(path.join(app.directory, 'config/local.config.json'), JSON.stringify(app.config));
await saveConfig();
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const checks = [], errors = [];
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage(); page.setDefaultTimeout(10000);
page.on('pageerror', (error) => errors.push(error.message));
page.on('dialog', (dialog) => { errors.push(`dialog: ${dialog.message()}`); void dialog.dismiss(); });

const rail = () => page.locator('.studio-rail');
const models = () => page.getByRole('group', { name: '生成模型', exact: true });
const ratio = (name) => page.getByRole('button', { name, exact: true });
const transparent = () => page.getByLabel('透明背景', { exact: true });
const toast = (pattern) => until(async () => pattern.test(await page.locator('#toast-container').innerText()), `toast ${pattern}`);
const nav = (name) => page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name, exact: true }).click();
async function rows(store = 'records') {
  return page.evaluate(async (store) => {
    const db = await new Promise((resolve, reject) => { const open = indexedDB.open('img-gen-gallery'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const result = await new Promise((resolve, reject) => { const query = db.transaction(store).objectStore(store).getAll(); query.onsuccess = () => resolve(query.result); query.onerror = () => reject(query.error); });
    db.close(); return result;
  }, store);
}
async function draft(key) {
  return page.evaluate(async (key) => {
    const db = await new Promise((resolve, reject) => { const open = indexedDB.open('img-gen-gallery'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const result = await new Promise((resolve, reject) => { const query = db.transaction('drafts').objectStore('drafts').get(key); query.onsuccess = () => resolve(query.result?.data); query.onerror = () => reject(query.error); });
    db.close(); return result;
  }, key);
}
async function screenshot(name) {
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `${name}: no horizontal overflow`);
}

try {
  await page.goto(app.base);
  await page.getByLabel('访问码', { exact: true }).fill(app.accessCode);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  await rail().locator('textarea').waitFor();

  assert.deepEqual(await models().getByRole('button').allInnerTexts(), ['自动', 'GPT Image 2', 'GPT Image 2.5']);
  assert.equal(await models().getByRole('button', { name: '自动', exact: true }).getAttribute('aria-pressed'), 'true');
  const cells = page.getByRole('group', { name: '画面画幅比例', exact: true }).getByRole('button');
  const cellLabels = async () => (await cells.allInnerTexts()).map((label) => label.split('\n').at(-1).trim());
  assert.deepEqual(await cellLabels(), ['自动画幅', '1:1 方图', '21:9 超宽', '4:3 横图', '3:2 横图', '16:9 宽屏', '3:4 竖图', '2:3 竖图', '9:16 壁纸']);
  assert.equal(await cells.filter({ hasText: '自动画幅' }).getAttribute('aria-pressed'), 'true', 'automatic frame is the default');
  assert.doesNotMatch(await rail().innerText(), /\d{3,4}×\d{3,4}|自动尺寸/, 'ratio buttons show ratios only');
  checks.push('多模型时显示生成模型, 默认自动; 九格画幅自动在首位且为默认, 只标比例');

  // Transparency fits only the standard-size channel, so wide frames are disabled while it is on.
  await transparent().locator('..').click();
  assert.ok(await transparent().isChecked());
  assert.ok(await ratio('16:9 宽屏').isDisabled());
  assert.ok(await ratio('3:2 横图').isEnabled());
  assert.match(await ratio('16:9 宽屏').getAttribute('title'), /透明背景/);
  assert.match(await rail().innerText(), /开启透明背景时, 当前模型不支持 21:9, 4:3, 16:9, 3:4, 9:16/);
  await transparent().locator('..').click();
  await ratio('16:9 宽屏').click();
  assert.ok(await transparent().isDisabled());
  assert.match(await page.locator('#studio-transparent-hint').innerText(), /当前画幅不支持透明背景/);
  await screenshot('gated-desktop');
  checks.push('参数按单一通道组合判断: 透明背景禁用宽画幅, 宽画幅禁用透明背景并说明原因');

  // GPT Image 2.5 offers standard sizes only: the wide frame falls back to automatic with a notice.
  await models().getByRole('button', { name: 'GPT Image 2.5', exact: true }).click();
  await toast(/已按 GPT Image 2\.5 调整参数: 画幅改为 自动/);
  assert.deepEqual(await cellLabels(), ['自动画幅', '1:1 方图', '3:2 横图', '2:3 竖图']);
  assert.equal(await cells.filter({ hasText: '自动画幅' }).getAttribute('aria-pressed'), 'true');
  assert.ok(await transparent().isDisabled());
  assert.match(await page.locator('#studio-transparent-hint').innerText(), /当前模型不支持透明背景/);
  await models().getByRole('button', { name: 'GPT Image 2', exact: true }).click();
  await ratio('16:9 宽屏').click();
  await rail().locator('textarea').fill('窗边的绿植');
  await page.getByRole('button', { name: /^开始绘制/ }).click();
  const [record] = await until(async () => { const records = await rows(); return records.length === 1 && records; }, 'first record', 15000);
  assert.equal(record.providerId, 'secondary');
  assert.equal(record.recipe.modelName, 'GPT Image 2');
  assert.equal(record.recipe.size, '1280x720');
  assert.ok(app.calls.filter((call) => call.path.includes('/images/')).every((call) => call.path.startsWith('/secondary/')), 'only the wide GPT Image 2 channel was called');
  checks.push('切换模型时收窄参数并提示, 提交只走所选模型中能完成请求的通道, 配方记录模型');

  // Reusing the recipe restores the model choice instead of falling back to automatic routing.
  const closeQueue = page.getByLabel('关闭队列抽屉');
  if (await closeQueue.isVisible()) { await closeQueue.click(); await closeQueue.waitFor({ state: 'hidden' }); }
  await models().getByRole('button', { name: '自动', exact: true }).click();
  await nav('展馆');
  await page.getByRole('button', { name: /检视作品:/ }).first().click();
  await page.getByRole('dialog', { name: '作品检视', exact: true }).getByRole('button', { name: '复用配方', exact: true }).click();
  await rail().locator('textarea').waitFor();
  await until(async () => await models().getByRole('button', { name: 'GPT Image 2', exact: true }).getAttribute('aria-pressed') === 'true', 'model restored from the recipe');
  assert.equal(await ratio('16:9 宽屏').getAttribute('aria-pressed'), 'true');
  checks.push('复用配方恢复原模型和画幅');

  // A model removed from the configuration resets the draft to automatic routing.
  await models().getByRole('button', { name: 'GPT Image 2.5', exact: true }).click();
  await until(async () => (await draft('studio'))?.config?.modelName === 'GPT Image 2.5', 'model saved in the draft');
  const removed = app.config.imageProviders.pop(); await saveConfig();
  await page.reload();
  await rail().locator('textarea').waitFor();
  await toast(/GPT Image 2\.5 暂未提供, 已改为自动选择模型/);
  await until(async () => (await draft('studio'))?.config?.modelName === '', 'draft reset to automatic routing');
  assert.equal(await models().count(), 0, 'a single remaining model hides the selector');
  app.config.imageProviders.push(removed); await saveConfig();
  await page.reload();
  await rail().locator('textarea').waitFor();
  checks.push('配置移除模型后草稿回到自动');

  // Series: the model selector narrows the frames, quality stays read-only.
  await nav('系列策划');
  await page.locator('#series-story-prompt').waitFor();
  assert.equal(await page.getByLabel('系列生成质量', { exact: true }).innerText(), '自动');
  assert.equal(await page.locator('select[aria-label="系列生成质量"]').count(), 0);
  assert.equal(await ratio('16:9 宽景分镜').getAttribute('aria-pressed'), 'true');
  await page.getByLabel('系列生成模型', { exact: true }).selectOption('GPT Image 2.5');
  await toast(/已按 GPT Image 2\.5 调整系列参数: 画幅改为 1:1/);
  assert.equal(await ratio('16:9 宽景分镜').count(), 0);
  assert.equal(await ratio('1:1 方形插画').getAttribute('aria-pressed'), 'true');
  await page.getByLabel('系列生成模型', { exact: true }).selectOption('');
  assert.equal(await ratio('16:9 宽景分镜').count(), 1);
  checks.push('系列按模型收窄画幅, 质量固定为自动');

  await nav('单图创作');
  await rail().locator('textarea').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await models().scrollIntoViewIfNeeded();
  await screenshot('model-selector-mobile');
  for (const button of await models().getByRole('button').all()) {
    const box = await button.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'model options stay on screen');
  }
  checks.push('手机宽度下模型选项完整可见');

  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: checks, pageErrors: errors, modelRequests: app.calls.length, realModelRequests: 0 }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, artifacts: output, modelRequests: app.calls.length }));
} finally {
  await context.close();
  await browser.close(); await app.close();
}
