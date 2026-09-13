import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startHarness, TEST_PASSWORD, TEST_ADMIN_PASSWORD, until } from './server-harness.mjs';

const output = process.env.SPROUT_TEST_OUTPUT ? path.join(process.env.SPROUT_TEST_OUTPUT, 'style-admin') : path.join(tmpdir(), 'sprout-style-admin-browser');
await mkdir(output, { recursive: true });
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const contexts = [];
const errors = [];
const checks = [];
const photo = await readFile(new URL('../public/assets/stitch/studio-01.jpg', import.meta.url));
const photoTwo = await readFile(new URL('../public/assets/stitch/studio-02.jpg', import.meta.url));
const originalPrompt = '  A quiet forest cottage, hand-painted watercolor.\n保留原文与换行, 不追加隐藏的画风描述.  ';
const shortcut = process.platform === 'darwin' ? 'Meta' : 'Control';
let releaseSave;
let isolated;
async function newPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', acceptDownloads: true, ...options });
  contexts.push(context);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
}
async function api(page, url, method = 'GET', body) {
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }, { url, method, body });
}
async function list(page, admin = true) { return (await api(page, admin ? '/api/admin/styles' : '/api/styles')).data; }
async function adminLogin(page) {
  await page.getByLabel('管理员密码', { exact: true }).fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: '登录管理后台', exact: true }).click();
  const navigation = page.getByRole('navigation', { name: '后台导航' });
  await navigation.waitFor();
  const stylesTab = navigation.getByRole('button', { name: '风格管理', exact: true });
  if (await stylesTab.getAttribute('aria-pressed') !== 'true') await stylesTab.click();
  await page.getByRole('button', { name: '添加风格', exact: true }).waitFor();
}
async function openEditor(page, name) {
  if (name) await card(page, name).getByRole('button', { name: `编辑 ${name}`, exact: true }).click();
  else await page.getByRole('button', { name: '添加风格', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: name ? '编辑风格' : '添加风格', exact: true });
  await dialog.waitFor();
  return dialog;
}
function card(page, name) { return page.locator('.admin-style-card').filter({ has: page.getByRole('heading', { name, exact: true }) }); }
async function save(dialog) {
  await dialog.getByRole('button', { name: '保存风格', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}
async function options(dialog, values) {
  for (const [name, value] of Object.entries(values)) await dialog.getByLabel(name, { exact: true }).fill(String(value));
}
async function screenshot(page, name) {
  await page.evaluate(async () => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].filter((image) => { const box = image.getBoundingClientRect(); return box.width > 0 && box.top < innerHeight && box.bottom > 0; }).every((image) => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: path.join(output, name + '.png') });
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth, scroll: document.documentElement.scrollWidth,
    dialog: document.querySelector('[role="dialog"]')?.getBoundingClientRect().toJSON(),
    icons: [...document.querySelectorAll('.material-symbols-outlined')].filter((element) => element.getClientRects().length).map((element) => ({ name: element.textContent, width: element.getBoundingClientRect().width, size: parseFloat(getComputedStyle(element).fontSize) })),
  }));
  assert.ok(geometry.scroll <= geometry.viewport + 1, name + ': no horizontal overflow');
  if (geometry.dialog) assert.ok(geometry.dialog.x >= 0 && geometry.dialog.right <= geometry.viewport + 1);
  for (const icon of geometry.icons) assert.ok(Math.abs(icon.width - icon.size) < 1, name + ': icon renders as a glyph: ' + icon.name);
}
async function titleStyle(page) {
  return page.getByRole('heading', { level: 1 }).evaluate((element) => {
    const css = getComputedStyle(element);
    return { family: css.fontFamily, size: css.fontSize, weight: css.fontWeight, lineHeight: css.lineHeight };
  });
}
const page = await newPage();
try {
  await page.goto(app.base + '/#admin');
  await page.getByLabel('管理员密码', { exact: true }).waitFor();
  await screenshot(page, 'admin-login-desktop');
  await page.getByLabel('管理员密码', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: '登录管理后台', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '管理员密码不正确' }).waitFor();
  await adminLogin(page);
  await until(async () => (await list(page)).styles.length === 36, 'seed library');
  assert.equal((await api(page, '/api/jobs/me')).status, 401);
  const user = await newPage();
  await user.goto(app.base);
  await user.getByLabel('访问码', { exact: true }).fill(app.accessCode);
  await user.getByRole('button', { name: '进入工作台', exact: true }).click();
  await user.locator('.studio-rail textarea').waitFor();
  assert.equal((await api(user, '/api/admin/styles')).status, 401);
  checks.push('管理员与工作台登录独立, 错误密码有明确反馈');

  let dialog = await openEditor(page);
  for (const label of ['名称', '分类', '作者', '来源链接', '排序 (越小越靠前)']) assert.equal(await dialog.getByLabel(label, { exact: true }).isVisible(), true);
  await page.evaluate(async (base64) => {
    const image = new Image(); image.src = 'data:image/jpeg;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1600;
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, photo.toString('base64'));
  await dialog.getByRole('group', { name: '示例图粘贴区' }).focus();
  await page.keyboard.press(shortcut + '+V');
  await dialog.getByRole('img', { name: '示例图预览' }).waitFor();
  await page.evaluate((text) => navigator.clipboard.writeText(text), originalPrompt);
  await dialog.getByLabel('风格提示词').focus();
  await page.keyboard.press(shortcut + '+V');
  assert.equal(await dialog.getByLabel('风格提示词').inputValue(), originalPrompt);
  await dialog.getByLabel('作者', { exact: true }).fill('手动收集作者');
  await screenshot(page, 'admin-paste-editor-desktop');
  await save(dialog);
  let pasted = (await list(page)).styles.find((style) => style.prompt === originalPrompt);
  assert.ok(pasted);
  assert.equal(pasted.imageWidth, 1600);
  assert.equal(pasted.imageHeight, 1067);
  assert.equal(pasted.name, Array.from(originalPrompt.trim().replace(/\s+/g, ' ')).slice(0, 24).join(''));
  assert.equal(pasted.category, '');
  assert.equal(pasted.published, true);
  await page.reload();
  await page.getByRole('button', { name: '添加风格', exact: true }).waitFor();
  assert.deepEqual((await list(page)).styles.find((style) => style.id === pasted.id), pasted);
  const pastedCard = card(page, pasted.name);
  await pastedCard.waitFor();
  const content = await pastedCard.getByRole('heading', { name: pasted.name }).boundingBox();
  const bounds = await pastedCard.boundingBox();
  await pastedCard.click({ position: { x: content.x - bounds.x + 10, y: content.y - bounds.y + 8 } });
  dialog = page.getByRole('dialog', { name: '编辑风格', exact: true });
  assert.equal(await dialog.getByLabel('风格提示词').inputValue(), originalPrompt, '点击卡片文字区域打开对应编辑表单');
  await dialog.getByLabel('关闭管理弹窗').click();
  await pastedCard.getByRole('button', { name: `编辑 ${pasted.name}`, exact: true }).focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  checks.push('真实剪贴板图片与文本粘贴, 自动名称, 示例图缩放和刷新持久化');

  dialog = await openEditor(page);
  await dialog.getByLabel('上传风格示例图').setInputFiles({ name: 'street.jpg', mimeType: 'image/jpeg', buffer: photoTwo });
  await dialog.getByRole('img', { name: '示例图预览' }).waitFor();
  await dialog.getByLabel('风格提示词').fill('街角胶片摄影, 午后的光线.');
  await options(dialog, { 名称: '胶片街景', 分类: '自建风格', 来源链接: 'https://example.org/style-source', '排序 (越小越靠前)': 1 });
  await dialog.getByLabel('在风格库上架').uncheck();
  await save(dialog);
  let uploaded = (await list(page)).styles.find((style) => style.name === '胶片街景');
  assert.equal(uploaded.author, '');
  assert.ok(!(await list(user, false)).styles.some((style) => style.id === uploaded.id));
  await page.getByLabel('上架状态').selectOption('hidden');
  assert.equal(await page.locator('.admin-style-card').count(), 1);
  await card(page, uploaded.name).getByRole('button', { name: '上架', exact: true }).click();
  await until(async () => (await list(user, false)).styles.some((style) => style.id === uploaded.id), 'published uploaded template');
  assert.equal(await page.getByRole('dialog').count(), 0, '上下架按钮不打开编辑弹窗');
  await page.getByLabel('上架状态').selectOption('all');
  checks.push('图片上传, 可选分类与来源, 上下架及状态筛选');

  dialog = await openEditor(page);
  await dialog.getByLabel('风格提示词').fill('拖拽图片测试, 保留已填写内容.');
  await dialog.getByLabel('上传风格示例图').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') });
  await dialog.getByRole('alert').filter({ hasText: '图片内容无法读取' }).waitFor();
  assert.equal(await dialog.getByLabel('风格提示词').inputValue(), '拖拽图片测试, 保留已填写内容.');
  const transfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'dropped.jpg', { type: 'image/jpeg' }));
    return transfer;
  }, photo.toString('base64'));
  await dialog.getByRole('group', { name: '示例图粘贴区' }).dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
  await dialog.getByRole('img', { name: '示例图预览' }).waitFor();
  await save(dialog);
  checks.push('拖拽图片录入与无效图片错误恢复');

  dialog = await openEditor(page, pasted.name);
  const editedPrompt = 'A hand-painted watercolor forest.\n保留作者原文, 展示与发送完全一致.';
  await dialog.getByLabel('风格提示词').fill(editedPrompt);
  await options(dialog, { 名称: '手工水彩模板', 分类: '自建风格', '排序 (越小越靠前)': 2 });
  let saveStarted;
  const started = new Promise((resolve) => { saveStarted = resolve; });
  const gate = new Promise((resolve) => { releaseSave = resolve; });
  await page.route('**/api/admin/styles/' + pasted.id, async (route) => {
    if (route.request().method() === 'PUT') { saveStarted(); await gate; }
    await route.continue();
  });
  await dialog.getByRole('button', { name: '保存风格', exact: true }).click();
  await started;
  assert.equal(await dialog.getByLabel('风格提示词').isDisabled(), true);
  assert.equal(await dialog.getByRole('button', { name: '保存中...', exact: true }).isDisabled(), true);
  releaseSave(); releaseSave = undefined;
  await dialog.waitFor({ state: 'hidden' });
  await page.unroute('**/api/admin/styles/' + pasted.id);
  pasted = (await list(page)).styles.find((style) => style.id === pasted.id);
  assert.equal(pasted.prompt, editedPrompt);
  checks.push('编辑保存与保存期间防重复提交, 表单不会被误改');

  await user.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '风格库', exact: true }).click();
  assert.deepEqual(await titleStyle(page), await titleStyle(user), 'admin and library use the same heading typography');
  await user.getByRole('button', { name: '自建风格 2', exact: true }).click();
  assert.deepEqual(await user.locator('main article h3').allTextContents(), ['胶片街景', '手工水彩模板']);
  await page.bringToFront();
  await card(page, uploaded.name).getByRole('button', { name: '下架', exact: true }).click();
  await card(page, uploaded.name).getByRole('button', { name: '上架', exact: true }).waitFor();
  await user.bringToFront();
  await user.getByRole('button', { name: '自建风格 1', exact: true }).waitFor({ timeout: 35000 });
  await page.bringToFront();
  await card(page, uploaded.name).getByRole('button', { name: '上架', exact: true }).click();
  await card(page, uploaded.name).getByRole('button', { name: '下架', exact: true }).waitFor();
  await user.bringToFront();
  await user.evaluate(() => window.dispatchEvent(new Event('focus')));
  await user.getByRole('button', { name: '自建风格 2', exact: true }).waitFor();
  const publicCard = user.locator('main article').filter({ has: user.getByRole('heading', { name: pasted.name, exact: true }) });
  await publicCard.getByRole('button', { name: '复制模板', exact: true }).click();
  assert.equal(await user.evaluate(() => navigator.clipboard.readText()), editedPrompt);
  await publicCard.getByRole('button', { name: '发送到单图', exact: true }).click();
  await user.getByRole('group', { name: '已选提示词模板' }).getByRole('heading', { name: pasted.name, exact: true }).waitFor();
  assert.equal(await user.locator('.studio-rail textarea').inputValue(), editedPrompt);
  assert.equal((await api(user, '/api/jobs/me')).data.jobs.length, 0);
  const draft = await user.evaluate(async () => {
    const db = await new Promise((resolve) => { const open = indexedDB.open('img-gen-gallery'); open.onsuccess = () => resolve(open.result); });
    const draft = await new Promise((resolve) => { const get = db.transaction('drafts').objectStore('drafts').get('studio'); get.onsuccess = () => resolve(get.result?.data); });
    db.close(); return draft;
  });
  assert.equal(draft.config.prompt, editedPrompt);
  assert.equal(draft.refImage, null);
  assert.equal(draft.tone, 'none');
  await user.reload();
  await user.locator('.studio-rail textarea').waitFor();
  assert.equal(await user.locator('.studio-rail textarea').inputValue(), editedPrompt);
  assert.equal(app.calls.length, 0, 'managing and applying templates must not call the generation upstream');
  checks.push('公开分类与排序, 原文复制和单图载入, 无隐藏画风或自动生图');

  dialog = await openEditor(page, pasted.name);
  await dialog.getByLabel('风格提示词').fill('保存错误时保留的内容');
  await page.route('**/api/admin/styles/' + pasted.id, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '模拟保存失败, 请重试' }) }));
  await dialog.getByRole('button', { name: '保存风格', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
  assert.equal(await dialog.getByLabel('风格提示词').inputValue(), '保存错误时保留的内容');
  await page.unroute('**/api/admin/styles/' + pasted.id);
  const changed = await api(page, '/api/admin/styles/' + pasted.id, 'PUT', { name: pasted.name, prompt: '另一页面已保存的版本', author: pasted.author, category: pasted.category, published: true, sortOrder: 2, version: pasted.version });
  assert.equal(changed.status, 200);
  await dialog.getByRole('button', { name: '保存风格', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '已在其他页面修改' }).waitFor();
  assert.equal(await dialog.getByLabel('风格提示词').inputValue(), '保存错误时保留的内容');
  assert.equal((await list(page)).styles.find((style) => style.id === pasted.id).prompt, '另一页面已保存的版本');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.reload();
  await card(page, pasted.name).waitFor();
  checks.push('保存失败保留表单, 版本冲突不覆盖另一页面的修改');

  dialog = await openEditor(page, pasted.name);
  await dialog.getByLabel('风格提示词').fill('会话恢复后继续保存的内容');
  await page.context().clearCookies({ name: 'sprout_admin' });
  await dialog.getByRole('button', { name: '保存风格', exact: true }).click();
  await page.getByLabel('管理员密码', { exact: true }).waitFor();
  await adminLogin(page);
  dialog = page.getByRole('dialog', { name: '编辑风格', exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('风格提示词').inputValue(), '会话恢复后继续保存的内容');
  await save(dialog);
  assert.equal((await api(user, '/api/auth/status')).data.authenticated, true);
  checks.push('管理员会话过期后重新登录保留未保存编辑, 普通会话不受影响');

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const download = await downloadEvent;
  const backupPath = path.join(output, download.suggestedFilename());
  await download.saveAs(backupPath);
  const archive = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(archive.styles.length, 39);
  assert.ok(archive.images.every((image) => image.dataUrl.startsWith('data:image/')));
  page.once('dialog', (confirm) => confirm.accept());
  await card(page, pasted.name).getByRole('button', { name: '删除', exact: true }).click();
  await card(page, pasted.name).waitFor({ state: 'hidden' });
  await page.getByLabel('导入风格备份').setInputFiles(backupPath);
  let preview = page.getByRole('dialog', { name: '确认导入备份', exact: true });
  await preview.getByText('新增 1 条, 更新 0 条, 相同 38 条.', { exact: true }).waitFor();
  await preview.getByLabel('关闭管理弹窗').click();
  assert.equal((await list(page)).styles.length, 38);
  await page.getByLabel('导入风格备份').setInputFiles(backupPath);
  preview = page.getByRole('dialog', { name: '确认导入备份', exact: true });
  await preview.getByRole('button', { name: '确认导入', exact: true }).click();
  await preview.waitFor({ state: 'hidden' });
  await card(page, pasted.name).waitFor();
  await page.getByLabel('导入风格备份').setInputFiles(backupPath);
  await page.getByRole('dialog').getByText('新增 0 条, 更新 0 条, 相同 39 条.', { exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: '确认导入', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await list(page)).styles.length, 39);
  checks.push('真实备份下载, 删除后导入恢复, 取消预览与重复导入不修改数据');

  // Cookies are shared across ports. Exercise both environments in one browser context.
  assert.equal((await api(page, '/api/auth/login', 'POST', { code: app.accessCode })).status, 200);
  isolated = await startHarness({ serveDist: true, cookieNamespace: 'local_browser_test' });
  const other = await page.context().newPage();
  other.on('pageerror', (error) => errors.push(error.message));
  await other.goto(isolated.base);
  await other.getByLabel('访问码', { exact: true }).fill(isolated.accessCode);
  await other.getByRole('button', { name: '进入工作台', exact: true }).click();
  await other.locator('.studio-rail textarea').waitFor();
  await other.goto(isolated.base + '/#admin');
  await adminLogin(other);
  assert.equal((await api(page, '/api/auth/status')).data.authenticated, true);
  assert.equal((await api(page, '/api/admin/auth/status')).data.authenticated, true);
  assert.equal((await api(other, '/api/auth/status')).data.authenticated, true);
  assert.equal((await api(other, '/api/admin/auth/status')).data.authenticated, true);
  assert.equal((await list(other)).styles.length, 36);
  assert.equal((await list(page)).styles.length, 39);
  await other.getByRole('button', { name: '退出管理', exact: true }).click();
  await other.getByLabel('管理员密码', { exact: true }).waitFor();
  assert.equal((await api(page, '/api/admin/auth/status')).data.authenticated, true);
  await other.close();
  checks.push('同一浏览器不同端口的独立环境, 工作台/管理登录与数据互不覆盖');

  await page.getByLabel('搜索管理风格').fill('');
  await page.locator('.admin-style-card').first().waitFor();
  const columns = await page.locator('.admin-style-card').first().evaluate((element) => getComputedStyle(element.parentElement).gridTemplateColumns.split(' ').length);
  assert.equal(columns, 4, '电脑端显示四列, 不再占用两列大卡片');
  await screenshot(page, 'admin-desktop-light');
  await page.getByLabel('切换主题').click();
  await screenshot(page, 'admin-desktop-dark');
  dialog = await openEditor(page, pasted.name);
  await screenshot(page, 'admin-editor-desktop-dark');
  await dialog.getByLabel('关闭管理弹窗').click();
  await page.getByLabel('切换主题').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, 'admin-mobile-light');
  dialog = await openEditor(page, pasted.name);
  await screenshot(page, 'admin-editor-mobile-light');
  await dialog.getByLabel('来源链接', { exact: true }).fill('https://example.org/mobile-form-check');
  assert.equal(await dialog.getByLabel('来源链接', { exact: true }).inputValue(), 'https://example.org/mobile-form-check');
  await dialog.getByRole('button', { name: '保存风格', exact: true }).scrollIntoViewIfNeeded();
  await screenshot(page, 'admin-editor-mobile-form-light');
  await dialog.getByLabel('关闭管理弹窗').click();
  await page.getByLabel('切换主题').click();
  await screenshot(page, 'admin-mobile-dark');
  assert.deepEqual(errors, []);
  checks.push('桌面与手机, 深浅主题, 弹窗滚动, 本地图标与横向溢出检查');
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: checks, errors, imageRequests: app.calls.length }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, artifacts: output, imageRequests: app.calls.length }));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await writeFile(path.join(output, 'failure.txt'), String(error.stack));
  throw error;
} finally {
  releaseSave?.();
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await isolated?.close();
  await app.close();
}
