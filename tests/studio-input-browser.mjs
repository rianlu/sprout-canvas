import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startHarness, until } from './server-harness.mjs';
import { png } from './fixtures.mjs';
import { PROMPT_POLISH_INSTRUCTIONS } from '../shared/prompt-polish.mjs';

const output = path.join(process.env.SPROUT_TEST_OUTPUT || path.join(tmpdir(), 'sprout-browser-check'), 'studio-input');
await mkdir(output, { recursive: true });
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const checks = [], errors = [], dialogs = [], contexts = [], requests = [];
const shortcut = process.platform === 'darwin' ? 'Meta' : 'Control';
const photo = await readFile(new URL('../public/assets/stitch/studio-01.jpg', import.meta.url));
let textOutput = '窗边的小熊正在阅读, 水彩笔触柔和, 保留原有画面文字与构图.';
let textGate, releaseText, rejectText = false;
app.controls.respond = async (call, response) => {
  if (call.path.includes('/chat/completions')) {
    const value = textOutput, reject = rejectText;
    if (textGate) await textGate;
    response.writeHead(reject ? 400 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(reject ? { error: { type: 'invalid_request_error', message: '隔离润色失败' } } : { choices: [{ message: { content: value } }] }));
  } else {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: [{ b64_json: photo.toString('base64') }] }));
  }
  return true;
};
function holdText() { textGate = new Promise((resolve) => { releaseText = () => { resolve(); textGate = undefined; releaseText = undefined; }; }); }
async function session(code = app.accessCode) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'no-preference' });
  contexts.push(context);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/text') requests.push(request.postDataJSON()); });
  await page.goto(app.base); await page.getByLabel('访问码', { exact: true }).fill(code);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click(); await ready(page);
  return page;
}
const input = (page) => page.locator('.studio-rail textarea');
const polish = (page) => page.getByRole('button', { name: /^润色扩写/ });
const undo = (page) => page.getByRole('button', { name: '撤销润色', exact: true });
const redo = (page) => page.getByRole('button', { name: '恢复润色', exact: true });
const ready = (page) => input(page).waitFor();
const nav = (page, name) => page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name, exact: true }).click();
async function api(page, url) { return page.evaluate(async (url) => (await fetch(url)).json(), url); }
async function stored(page, key = 'studio', store = 'drafts') {
  return page.evaluate(({ key, store }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('img-gen-gallery'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result; const read = db.transaction(store).objectStore(store).get(key); read.onsuccess = () => { resolve(read.result); db.close(); }; read.onerror = () => reject(read.error); };
  }), { key, store });
}
const savedPrompt = (page, prompt) => until(async () => (await stored(page))?.data?.config?.prompt === prompt, 'prompt saved');
async function fill(page, prompt) { await input(page).fill(prompt); await savedPrompt(page, prompt); }
async function newCreation(page) { await page.getByRole('button', { name: '新建创作', exact: true }).click(); await savedPrompt(page, ''); }
async function screenshot(page, name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations()
      .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map((animation) => animation.finished.catch(() => {})));
  });
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, icons: [...document.querySelectorAll('.studio-rail .material-symbols-outlined')].filter((node) => node.getClientRects().length).map((node) => ({ name: node.textContent, width: node.getBoundingClientRect().width, size: parseFloat(getComputedStyle(node).fontSize) })) }));
  assert.ok(geometry.scroll <= geometry.width + 1, `${name}: no horizontal overflow`);
  for (const icon of geometry.icons) assert.ok(icon.width <= icon.size * 1.25, `${name}: ${icon.name} is a local glyph`);
}
async function theme(page, value) {
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('dialog', { name: '用户设置', exact: true }).getByRole('button', { name: value, exact: true }).click();
  await page.keyboard.press('Escape');
}
async function clipboardImage(page, bytes) {
  await page.bringToFront();
  await page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([data], { type: 'image/png' }) })]);
  }, bytes.toString('base64'));
}
async function paste(page) { await input(page).focus(); await page.keyboard.press(shortcut + '+V'); }

const page = await session();
try {
  const original = '画面: 两只小熊在窗边阅读.\n海报文字: "SPRING 2026", 品牌 {品牌名称}, 规格 250 ml.\nSoft watercolor, keep the original composition. ' + '保留主体数量和层次. '.repeat(12);
  textOutput = original + '\n整理画面层次, 让前后景自然衔接.';
  await fill(page, original); await input(page).focus();
  assert.equal(await input(page).evaluate((node) => getComputedStyle(node).outlineStyle), 'none');
  assert.equal(await page.locator('.studio-prompt-field').evaluate((node) => getComputedStyle(node).outlineWidth), '2px');
  const fieldSize = await page.locator('.studio-prompt-field').boundingBox();
  holdText(); await polish(page).click();
  await until(() => app.calls.length === 1, 'polish upstream');
  assert.equal(app.calls[0].json.messages[0].content, PROMPT_POLISH_INSTRUCTIONS);
  assert.equal(app.calls[0].json.messages[1].content, original);
  assert.equal(await input(page).evaluate((node) => node.readOnly), true);
  assert.equal(await page.getByRole('button', { name: '清空', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: /^开始绘制/ }).isDisabled(), true);
  assert.equal(await page.locator('.prompt-activity-border').count(), 1);
  assert.equal(await page.locator('.studio-prompt-field').evaluate((node) => getComputedStyle(node).outlineStyle), 'none');
  const glow = page.locator('.prompt-activity-glow');
  assert.equal(await glow.evaluate((node) => getComputedStyle(node).animationName), 'prompt-border-orbit');
  const matrix = await glow.evaluate((node) => getComputedStyle(node).transform);
  await page.waitForFunction((matrix) => getComputedStyle(document.querySelector('.prompt-activity-glow')).transform !== matrix, matrix);
  const busySize = await page.locator('.studio-prompt-field').boundingBox();
  assert.deepEqual([busySize.width, busySize.height], [fieldSize.width, fieldSize.height]);
  await screenshot(page, 'polish-light'); await theme(page, '深色'); await screenshot(page, 'polish-dark');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await glow.evaluate((node) => getComputedStyle(node).animationName), 'none');
  await screenshot(page, 'polish-reduced-motion'); await page.emulateMedia({ reducedMotion: 'no-preference' });
  await theme(page, '浅色'); releaseText();
  await until(async () => (await input(page).inputValue()) === textOutput, 'polished input'); await savedPrompt(page, textOutput);
  assert.equal(await input(page).evaluate((node) => node.readOnly), false);
  assert.equal(await page.locator('.prompt-activity-border').count(), 0);
  checks.push('长文按完整指令传递, 单层聚焦轮廓, 润色只读与防重复, 深浅主题流光和减少动态效果');

  const modified = textOutput + '\n手工调整: 标题靠上, 保留 250 ml.';
  await fill(page, modified); await undo(page).click(); await savedPrompt(page, original);
  await page.reload(); await ready(page); assert.equal(await input(page).inputValue(), original);
  await redo(page).click(); await savedPrompt(page, modified);
  await undo(page).click(); await savedPrompt(page, original);
  const editedOriginal = original + '\n原文手工补充.';
  await fill(page, editedOriginal); await redo(page).click(); await savedPrompt(page, modified);
  await undo(page).click(); await savedPrompt(page, editedOriginal);
  assert.equal(app.calls.length, 1); assert.equal((await api(page, '/api/credits')).credits.spent, 1);
  await page.setViewportSize({ width: 320, height: 850 }); await screenshot(page, 'undo-320');
  await page.setViewportSize({ width: 1600, height: 1000 });
  textOutput = '第二次润色的新结果, 保留当前原文作为撤销目标.';
  await polish(page).click(); await savedPrompt(page, textOutput);
  await undo(page).click(); await savedPrompt(page, editedOriginal);
  await newCreation(page); assert.equal(await undo(page).count(), 0); assert.equal(await redo(page).count(), 0);
  checks.push('撤销与恢复保留两边手工修改, 刷新后可恢复, 重复润色更新前后版本, 免费切换且新建清空');

  rejectText = true; await fill(page, '失败时保留这份原文'); await polish(page).click();
  await page.getByRole('alert').filter({ hasText: '文字处理失败' }).waitFor(); rejectText = false;
  assert.equal(await input(page).inputValue(), '失败时保留这份原文');
  assert.equal(await input(page).evaluate((node) => node.readOnly), false);
  assert.equal(await page.locator('.prompt-activity-border').count(), 0);
  assert.equal((await api(page, '/api/credits')).credits.spent, 2);
  const raw = '保存故障后仍可领取同一次润色';
  textOutput = '润色结果只允许成功保存一次, 重试保存不再调用模型.';
  await fill(page, raw);
  await page.evaluate((value) => {
    const put = IDBObjectStore.prototype.put;
    window.restoreDraftPut = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function(data, key) {
      if (this.name === 'drafts' && key === 'studio' && data?.data?.promptHistory?.after === value) throw new DOMException('模拟草稿保存失败', 'QuotaExceededError');
      return put.call(this, data, key);
    };
  }, textOutput);
  const callsBeforeSave = app.calls.length;
  await polish(page).click(); await page.getByRole('alert').filter({ hasText: '模拟草稿保存失败' }).waitFor();
  assert.equal(await input(page).inputValue(), raw); assert.equal(app.calls.length, callsBeforeSave + 1);
  const failedSaveId = requests.at(-1).requestId;
  await page.evaluate(() => window.restoreDraftPut()); await polish(page).click(); await savedPrompt(page, textOutput);
  assert.equal(app.calls.length, callsBeforeSave + 1);
  assert.equal(requests.filter((request) => request.requestId === failedSaveId).length, 1);
  await undo(page).click(); await savedPrompt(page, raw);
  checks.push('明确失败保留原文并退点, 本地保存失败保留原请求, 重新领取不重复调用或扣点');

  await newCreation(page); await fill(page, '刷新后领取原请求并支持撤销');
  textOutput = '刷新后领取到的完整润色结果.';
  const beforeRefresh = app.calls.length;
  holdText(); await polish(page).click(); await until(() => app.calls.length === beforeRefresh + 1, 'text before refresh');
  const detachedId = requests.at(-1).requestId;
  await page.reload(); await ready(page); releaseText();
  await until(async () => (await api(page, '/api/text/' + detachedId)).credit?.state === 'charged', 'detached polish settled');
  await polish(page).click(); await savedPrompt(page, textOutput);
  assert.equal(app.calls.length, beforeRefresh + 1);
  assert.equal(requests.filter((request) => request.requestId === detachedId).length, 1);
  await undo(page).click(); await savedPrompt(page, '刷新后领取原请求并支持撤销');
  const legacySystem = '旧版提示词润色规则, 用一句话描述画面.';
  const legacyQuote = requests.at(-1).creditQuote;
  for (const accepted of [true, false]) {
    await newCreation(page);
    const content = accepted ? '升级前已完成但未领取的原文' : '升级前已保存但未送达的原文';
    await fill(page, content);
    textOutput = content + ', 保留同一次润色的结果.';
    const legacyId = randomUUID();
    const beforeLegacy = app.calls.length;
    const spentBefore = (await api(page, '/api/credits')).credits.spent;
    await page.evaluate(async ({ system, content, requestId, creditQuote, accepted }) => {
      await new Promise((resolve, reject) => {
        const open = indexedDB.open('img-gen-gallery'); open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result, tx = db.transaction('drafts', 'readwrite');
          tx.objectStore('drafts').put({ version: 1, data: { requestId, signature: JSON.stringify({ system, content }), unknown: false } }, 'text-request-prompt-' + creditQuote.userId);
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
        };
      });
      if (accepted) {
        const result = await fetch('/api/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, kind: 'prompt', creditQuote, input: [
          { role: 'system', content: [{ type: 'input_text', text: system }] },
          { role: 'user', content: [{ type: 'input_text', text: content }] },
        ] }) });
        if (!result.ok) throw new Error('旧版请求未受理: ' + result.status);
      }
    }, { system: legacySystem, content, requestId: legacyId, creditQuote: legacyQuote, accepted });
    await page.reload(); await ready(page);
    await polish(page).click(); await savedPrompt(page, textOutput);
    assert.equal(app.calls.length, beforeLegacy + 1);
    assert.equal(app.calls.at(-1).json.messages[0].content, legacySystem);
    assert.equal(requests.filter((request) => request.requestId === legacyId).length, 1);
    assert.equal((await api(page, '/api/credits')).credits.spent, spentBefore + 1);
    await undo(page).click(); await savedPrompt(page, content);
  }
  checks.push('润色中刷新与旧版指令升级均复用原请求, 已受理结果只领取, 未送达请求沿用原编号和内容, 可撤销且只扣一次');

  await newCreation(page); await fill(page, '模板切换前的旧润色'); textOutput = '这个迟到结果不应覆盖新模板.';
  holdText(); const beforeTransfer = app.calls.length; await polish(page).click();
  await until(() => app.calls.length === beforeTransfer + 1, 'old polish in flight');
  await nav(page, '风格库'); await page.locator('main article').first().getByRole('button', { name: '发送到单图', exact: true }).click();
  await ready(page); const template = await input(page).inputValue(); releaseText();
  await until(async () => (await api(page, '/api/text/' + requests.at(-1).requestId)).credit?.state === 'charged', 'old polish settled');
  assert.equal(await input(page).inputValue(), template);
  assert.equal((await stored(page)).data.promptHistory, null);
  assert.equal(await undo(page).count(), 0);
  checks.push('载入完整模板清理旧润色记录, 迟到结果不覆盖新草稿, 不恢复基础画风快捷项');

  await newCreation(page); await fill(page, '其他标签页编辑前的原文'); textOutput = '不覆盖另一标签页的输入.';
  const other = await page.context().newPage(); other.on('pageerror', (error) => errors.push(error.message));
  await other.goto(app.base); await ready(other);
  holdText(); const beforeOther = app.calls.length; await polish(page).click(); await until(() => app.calls.length === beforeOther + 1, 'concurrent draft polish');
  await fill(other, '另一个标签页刚输入的内容'); releaseText();
  await page.getByRole('alert').filter({ hasText: '草稿已在其他页面变更' }).waitFor();
  assert.equal((await stored(page)).data.config.prompt, '另一个标签页刚输入的内容');
  await other.close(); await page.reload(); await ready(page);
  assert.equal(await input(page).inputValue(), '另一个标签页刚输入的内容');
  checks.push('润色保存使用草稿版本校验, 其他标签页的新输入不会被迟到结果覆盖');

  await newCreation(page);
  const imageA = png(640, 360), imageB = png(300, 450);
  const beforeImages = app.calls.length;
  await fill(page, '这段文字在粘贴图片后继续保留');
  await clipboardImage(page, imageA); await paste(page);
  const reference = page.getByRole('img', { name: '参考源图', exact: true }); await reference.waitFor();
  await until(async () => Boolean((await stored(page)).data.refImage), 'pasted reference saved');
  const firstImage = await reference.getAttribute('src');
  const size = await reference.evaluate((image) => [image.naturalWidth, image.naturalHeight]);
  assert.deepEqual(size, [640, 360]);
  assert.equal(await input(page).inputValue(), '这段文字在粘贴图片后继续保留');
  await clipboardImage(page, imageB); await paste(page);
  assert.equal(await reference.getAttribute('src'), firstImage);
  await input(page).fill('');
  const clipboardText = '普通文字粘贴仍然正常, 250 ml, {品牌名称}';
  await page.evaluate((text) => navigator.clipboard.writeText(text), clipboardText); await paste(page);
  assert.equal(await input(page).inputValue(), clipboardText);
  await screenshot(page, 'pasted-reference');
  await page.getByRole('button', { name: '局部涂抹修改', exact: true }).click();
  const mask = page.getByRole('dialog', { name: '局部重绘工作区', exact: true }); await mask.waitFor();
  const canvas = mask.getByLabel('蒙版画布, 按住拖动涂抹');
  await until(async () => (await canvas.boundingBox())?.width > 0, 'mask canvas ready');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 }); await page.mouse.up();
  await mask.getByLabel('局部重绘提示词').fill('只把涂抹区域改成绿色');
  await clipboardImage(page, imageB); await mask.getByLabel('局部重绘提示词').focus(); await page.keyboard.press(shortcut + '+V');
  await mask.getByRole('button', { name: '保存并应用蒙版', exact: true }).click(); await mask.waitFor({ state: 'hidden' });
  await until(async () => Boolean((await stored(page)).data.mask), 'mask saved');
  const masked = (await stored(page)).data;
  await paste(page);
  assert.equal(await reference.getAttribute('src'), firstImage);
  assert.deepEqual((await stored(page)).data.mask, masked.mask);
  assert.equal((await stored(page)).data.config.mode, 'edit');
  assert.equal(app.calls.length, beforeImages, 'paste and mask editing never generate images or text');
  assert.deepEqual(dialogs, []);
  await screenshot(page, 'masked-paste-protected');
  checks.push('真实剪贴板载入空参考区, 普通文字正常粘贴, 已有图片与编辑蒙版均不被覆盖且无弹窗或生成');

  await page.locator('.studio-rail input[type=file]').setInputFiles({ name: '手动替换.png', mimeType: 'image/png', buffer: imageB });
  await until(async () => (await reference.getAttribute('src')) !== firstImage, 'explicit image replacement');
  assert.equal((await stored(page)).data.mask, null);
  await newCreation(page);
  await page.locator('.studio-rail').evaluate((rail, images) => {
    for (const [index, base64] of images.entries()) {
      const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], `快速粘贴-${index}.png`, { type: 'image/png' }));
      rail.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    }
  }, [imageA.toString('base64'), imageB.toString('base64')]);
  await reference.waitFor();
  assert.deepEqual(await reference.evaluate((image) => [image.naturalWidth, image.naturalHeight]), [640, 360]);
  await newCreation(page);
  const dropImage = async (bytes) => page.locator('.studio-reference-area').evaluate((area, base64) => {
    const dataTransfer = new DataTransfer(); dataTransfer.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], '拖拽参考.png', { type: 'image/png' }));
    area.dispatchEvent(new DragEvent('dragover', { dataTransfer, bubbles: true, cancelable: true }));
    area.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
  }, bytes.toString('base64'));
  await dropImage(imageB); await reference.waitFor();
  await until(async () => (await stored(page)).data.refImage?.name === '拖拽参考.png', 'dropped image saved');
  const dropped = await reference.getAttribute('src'); await dropImage(imageA);
  assert.equal(await reference.getAttribute('src'), dropped);
  await newCreation(page);
  await page.locator('.studio-rail input[type=file]').setInputFiles({ name: '不支持.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await page.getByRole('alert').filter({ hasText: '请选择 PNG, JPEG 或 WebP 图片' }).waitFor();
  assert.equal(await reference.count(), 0);
  assert.equal(await page.getByRole('button', { name: /上传参考图/ }).isEnabled(), true);
  assert.equal(app.calls.length, beforeImages);
  checks.push('手动更换仍可用, 连续粘贴只载入第一张, 拖拽仅接收空区, 格式错误可恢复');

  await fill(page, '生成后清理这份润色历史'); textOutput = '绘制一只安静看书的小熊, 柔和自然的水彩风格.';
  await polish(page).click(); await savedPrompt(page, textOutput); await undo(page).waitFor();
  await page.getByRole('button', { name: /^开始绘制/ }).click();
  await until(async () => (await stored(page)).data.config.prompt === '', 'completed draft cleared', 18000);
  assert.equal((await stored(page)).data.promptHistory, null);
  await page.reload(); await ready(page); assert.equal(await input(page).inputValue(), '');
  assert.equal(await undo(page).count(), 0); assert.equal(await redo(page).count(), 0);
  checks.push('生成图片保存后同步结束润色历史, 刷新不恢复已完成文案');

  const unlimited = await app.api('/api/admin/access-codes', { cookie: app.adminCookie, method: 'POST', body: { requestId: randomUUID(), initialPoints: 0, unlimited: true, note: '无限额度交互验收' } });
  assert.equal(unlimited.status, 201);
  const free = await session(unlimited.data.codes[0].code);
  assert.equal(await free.getByRole('button', { name: /^开始绘制/ }).locator('[data-credit-cost]').count(), 0);
  assert.equal(await polish(free).locator('[data-credit-cost]').count(), 0);
  assert.equal(await free.locator('header').getByLabel(/^无限灵感点/).count(), 1);
  assert.doesNotMatch(await free.locator('.studio-rail').innerText(), /不限量|快捷笔触风格/);
  await screenshot(free, 'unlimited-studio');
  await nav(free, '系列策划'); assert.equal(await free.locator('main [data-credit-cost]').count(), 0);
  for (const name of ['单图创作', '系列策划', '风格库', '展馆']) {
    await nav(free, name);
    const glass = await free.locator('header').evaluate((header) => ({ color: getComputedStyle(header).backgroundColor, blur: getComputedStyle(header).backdropFilter }));
    assert.match(glass.color, /0\.8\)/); assert.match(glass.blur, /blur\(24px\)/);
  }
  await nav(free, '单图创作'); await free.setViewportSize({ width: 390, height: 844 });
  await theme(free, '深色'); await screenshot(free, 'unlimited-dark-mobile');
  assert.equal(await page.getByRole('button', { name: /^开始绘制/ }).locator('[data-credit-cost]').innerText(), '-10点');
  assert.equal(await polish(page).locator('[data-credit-cost]').innerText(), '-1点');
  checks.push('无限额度只在顶栏展示, 有限额度保留真实扣点, 四页毛玻璃统一且适配手机深浅主题');
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: checks, pageErrors: errors, dialogs, modelRequests: app.calls.length, realModelRequests: 0 }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, artifacts: output, modelRequests: app.calls.length }));
} finally {
  releaseText?.();
  for (const context of contexts) await context.close();
  await browser.close(); await app.close();
}
