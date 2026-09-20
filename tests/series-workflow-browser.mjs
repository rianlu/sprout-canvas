import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startHarness, until } from './server-harness.mjs';
import { png } from './fixtures.mjs';

const output = path.join(process.env.SPROUT_TEST_OUTPUT || path.join(tmpdir(), 'sprout-browser-check'), 'series-workflow');
await mkdir(output, { recursive: true });
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const checks = [], failures = [], errors = [], gates = [];
let textGate, imageGate, textPlan, rejectImage = false;
const textCalls = () => app.calls.filter((call) => call.path.endsWith('/chat/completions')).length;
const imageCalls = () => app.calls.filter((call) => call.path.includes('/images/')).length;
const cards = (page) => page.locator('.stitch-shot-card');
const confirmation = (page) => page.getByRole('region', { name: '分镜确认与生成' });
const referenceFiles = Array.from({ length: 4 }, (_, index) => ({ name: `reference-${index + 1}.png`, mimeType: 'image/png', buffer: png(640 + index, 360 + index, [40 + index * 35, 160, 90, 255]) }));
const referenceArea = (page) => page.getByRole('group', { name: '系列参考图', exact: true });
const referenceDraft = async (page) => (await rows(page, 'drafts')).find((row) => Array.isArray(row.data?.references))?.data;
async function uploadReferences(page, files, total = files.length) {
  await page.getByLabel('上传系列参考图', { exact: true }).setInputFiles(files);
  await until(async () => (await referenceDraft(page))?.references.length === total && await page.getByLabel('上传系列参考图', { exact: true }).isEnabled(), 'reference files saved');
}
async function pasteImage(page, file = referenceFiles[0]) {
  await page.bringToFront();
  await page.evaluate(async (base64) => {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' }) })]);
  }, file.buffer.toString('base64'));
  await page.locator('#series-story-prompt').focus();
  await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+V');
}
async function dropImages(page, files) {
  await referenceArea(page).evaluate((element, files) => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], file.name, { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, files.map((file) => ({ name: file.name, base64: file.buffer.toString('base64') })));
}
function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  gates.push(release);
  return { promise, release };
}
app.controls.respond = async (call, res) => {
  if (call.path.endsWith('/chat/completions')) {
    if (textGate) await textGate.promise;
    const count = Number(call.json.messages[0].content.match(/恰好 (\d+) 项/)?.[1] || 4);
    const plan = textPlan || Array.from({ length: count }, (_, index) => ({ title: `林间故事 ${index + 1}`, prompt: `戴红围巾的小熊在森林第 ${index + 1} 处停留, 柔和的绘本插画.` }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
    return true;
  }
  if (imageGate) await imageGate.promise;
  if (!rejectImage) return false;
  if (rejectImage === 'following' && call.body.toString('utf8').includes('当前第 1/')) return false;
  res.writeHead(rejectImage === 'unknown' ? 504 : 400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'invalid_request_error: 分镜绘制失败' }));
  return true;
};
async function rows(page, store = 'records') {
  return page.evaluate((store) => new Promise((resolve, reject) => {
    const open = indexedDB.open('img-gen-gallery');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, query = db.transaction(store).objectStore(store).getAll();
      query.onsuccess = () => { db.close(); resolve(query.result); };
      query.onerror = () => { db.close(); reject(query.error); };
    };
  }), store);
}
async function jobs(page) { return (await (await page.context().request.get(app.base + '/api/jobs/me')).json()).jobs; }
async function closeQueue(page) {
  const submit = confirmation(page).getByRole('button');
  if (await submit.count()) await until(async () => !(await submit.innerText()).includes('提交中'), 'submission callback reached the page', 15000);
  const close = page.getByLabel('关闭队列抽屉');
  if (await close.isVisible()) { await close.click(); await close.waitFor({ state: 'hidden' }); }
}
async function nav(page, label) {
  await closeQueue(page);
  const navigation = await page.getByRole('navigation', { name: '主导航', exact: true }).isVisible() ? '主导航' : '移动导航';
  await page.getByRole('navigation', { name: navigation, exact: true }).getByRole('link', { name: label, exact: true }).click();
}
async function fillPlan(page) {
  await page.locator('#series-story-prompt').fill('戴红围巾的小熊在森林中寻找朋友');
  for (let index = 0; index < 4; index++) await page.locator(`#scene-prompt-${index}`).fill(`小熊在森林第 ${index + 1} 处寻找朋友`);
}
async function settled(page, count) {
  await until(async () => (await rows(page)).length === count && (await jobs(page)).every((job) => !['pending', 'running'].includes(job.status) && (job.status !== 'succeeded' || job.acknowledgedAt)), 'all results saved and acknowledged', 25000);
  await closeQueue(page);
}
async function completePlan(page) {
  await fillPlan(page);
  await confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).click();
  await settled(page, 4);
}
async function screenshot(page, name) {
  if (!(await page.getByRole('dialog').count())) await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
}
async function scenario(name, body, init) {
  textGate = imageGate = textPlan = undefined; rejectImage = false;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(app.base);
    await page.getByLabel('访问码', { exact: true }).fill(app.accessCode);
    await page.getByRole('button', { name: '进入工作台', exact: true }).click();
    await page.getByLabel('画面提示词', { exact: true }).waitFor();
    await nav(page, '系列策划');
    await page.locator('#series-story-prompt').waitFor();
    await body(page);
    assert.deepEqual(pageErrors, [], 'no unhandled browser errors');
    checks.push(name); console.log(`通过: ${name}`);
  } catch (error) {
    failures.push({ name, error: error.stack });
    console.error(`失败: ${name}: ${error.message}`);
    await screenshot(page, `failure-${checks.length + failures.length}`).catch(() => {});
  } finally {
    errors.push(...pageErrors);
    for (const release of gates.splice(0)) release();
    await until(async () => (await jobs(page)).every((job) => !['pending', 'running'].includes(job.status)), 'test queue drained', 15000).catch(() => {});
    await context.close();
  }
}

try {
  await scenario('自由策划保留长剧本, 标题冒号与提示词换行, 拆解后等待确认', async (page) => {
    assert.equal(await page.getByText('应用场景模板', { exact: true }).count(), 0);
    const brief = '创作一组植物结构说明图, 保留英文品牌 SproutCanvas 和 {{name}}.\n' + '按原顺序展示叶片, 茎, 根和花, 不添加价格或人物.\n'.repeat(45);
    textPlan = Array.from({ length: 4 }, (_, index) => ({ title: `植物: ${index + 1}`, prompt: `图 ${index + 1} 的结构特征.\n保留文字 "SproutCanvas\n{{name}}", 不添加其他文字.` }));
    await page.locator('#series-story-prompt').fill(brief);
    const before = imageCalls();
    await page.getByRole('button', { name: /^智能拆解分镜/ }).click();
    await until(() => confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).isEnabled(), 'free plan ready');
    assert.equal(await page.locator('#scene-prompt-0').inputValue(), textPlan[0].prompt);
    const request = app.calls.filter((call) => call.path.endsWith('/chat/completions')).at(-1).json;
    assert.ok(request.messages[1].content.includes(brief), 'full input reaches text model');
    assert.equal(imageCalls(), before, 'splitting never submits images');
    const edited = textPlan[0].prompt + '\n保留最后一行的手动调整.';
    await page.locator('#scene-prompt-0').fill(edited);
    await until(async () => JSON.parse((await referenceDraft(page)).taskText)[0].prompt === edited, 'structured scene saved');
    await page.reload(); await page.locator('#series-story-prompt').waitFor();
    assert.equal(await page.locator('#series-story-prompt').inputValue(), brief);
    assert.equal(await page.locator('#scene-prompt-0').inputValue(), edited);
    assert.equal(imageCalls(), before);
    await screenshot(page, 'free-series-plan');
  });

  await scenario('多图添加, 单张更换和移除保持顺序, 超量不改变原图, 刷新完整恢复', async (page) => {
    await uploadReferences(page, referenceFiles);
    const original = (await referenceDraft(page)).references;
    assert.deepEqual(original.map((image) => image.name), referenceFiles.map((file) => file.name));
    await page.getByLabel('上传系列参考图').setInputFiles(referenceFiles[0]);
    await page.getByRole('alert').filter({ hasText: '最多使用 4 张' }).waitFor();
    assert.deepEqual((await referenceDraft(page)).references, original);
    const chooser = page.waitForEvent('filechooser');
    await page.getByLabel('更换系列参考图 2', { exact: true }).click();
    const replacement = { ...referenceFiles[1], name: 'replacement.png' };
    await (await chooser).setFiles(replacement);
    await until(async () => (await referenceDraft(page)).references[1].name === replacement.name, 'replacement persisted');
    const replaced = (await referenceDraft(page)).references;
    for (const index of [0, 2, 3]) assert.deepEqual(replaced[index], original[index]);
    await page.getByLabel('移除系列参考图 3', { exact: true }).click();
    await until(async () => (await referenceDraft(page)).references.length === 3, 'one reference removed');
    await uploadReferences(page, [referenceFiles[2]], 4);
    const final = (await referenceDraft(page)).references;
    assert.deepEqual(final.map((image) => image.name), [referenceFiles[0].name, replacement.name, referenceFiles[3].name, referenceFiles[2].name]);
    await page.reload(); await referenceArea(page).getByRole('img').last().waitFor();
    assert.deepEqual((await referenceDraft(page)).references, final);
    await screenshot(page, 'series-four-references-desktop');
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('button', { name: '深色', exact: true }).click();
    await page.keyboard.press('Escape');
    await screenshot(page, 'series-four-references-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await referenceArea(page).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await screenshot(page, 'series-four-references-mobile');
  });

  await scenario('原生粘贴和拖拽顺序追加参考图, 不覆盖已有图片或文本', async (page) => {
    await page.locator('#series-story-prompt').fill('保留这些文字');
    await pasteImage(page);
    await until(async () => (await referenceDraft(page))?.references.length === 1, 'native pasted image');
    const original = (await referenceDraft(page)).references;
    await pasteImage(page, referenceFiles[1]);
    await until(async () => (await referenceDraft(page)).references.length === 2, 'paste appends reference');
    await dropImages(page, referenceFiles.slice(2));
    await until(async () => (await referenceDraft(page)).references.length === 4, 'drop appends remaining references');
    assert.deepEqual((await referenceDraft(page)).references.slice(0, 1), original);
    assert.equal(await page.locator('#series-story-prompt').inputValue(), '保留这些文字');
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByLabel('清空系列参考图', { exact: true }).click();
    await until(async () => !(await referenceDraft(page)).references.length, 'empty reference area');
    await dropImages(page, referenceFiles.slice(1));
    await until(async () => (await referenceDraft(page)).references.length === 3, 'multiple dropped images');
    assert.equal((await referenceDraft(page)).references[0].name, referenceFiles[1].name);
    await page.evaluate(() => navigator.clipboard.writeText('普通文字粘贴'));
    await page.locator('#series-story-prompt').focus();
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+A');
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+V');
    await until(async () => await page.locator('#series-story-prompt').inputValue() === '普通文字粘贴', 'ordinary text paste');
    assert.equal((await referenceDraft(page)).references.length, 3);
  });

  await scenario('图片读取失败时整次添加不落入草稿, 超大原图给出明确提示', async (page) => {
    await uploadReferences(page, referenceFiles.slice(0, 2));
    const original = (await referenceDraft(page)).references;
    await page.getByLabel('上传系列参考图').setInputFiles([referenceFiles[2], { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') }]);
    await page.getByRole('alert').first().waitFor();
    assert.deepEqual((await referenceDraft(page)).references, original);
    await page.getByLabel('上传系列参考图').setInputFiles({ name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(12 * 1024 * 1024 + 1) });
    await page.getByRole('alert').filter({ hasText: '12 MiB' }).waitFor();
    assert.deepEqual((await referenceDraft(page)).references, original);
  });

  await scenario('四张参考图随整批与单镜重绘完整传递, 完成后刷新清空草稿', async (page) => {
    await uploadReferences(page, referenceFiles);
    const refs = (await referenceDraft(page)).references;
    const requests = [];
    page.on('request', (request) => { if (request.method() === 'POST' && /\/api\/jobs(?:\/batch)?$/.test(request.url())) { const body = request.postDataJSON(); requests.push(...(body.jobs || [body])); } });
    imageGate = gate();
    await fillPlan(page);
    await confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).click();
    await until(() => requests.length === 4, 'full series submitted');
    for (const request of requests) {
      assert.deepEqual(request.request.references.map((ref) => ref.id), refs.map((ref) => ref.id));
      assert.equal(request.clientContext.template, undefined);
    }
    assert.ok(requests.slice(1).every((request) => request.referenceJobId === requests[0].requestId));
    imageGate.release(); await settled(page, 4);
    assert.ok((await rows(page)).every((record) => record.recipe.references.length === 4));
    await cards(page).nth(1).getByTitle('重新绘制本镜', { exact: true }).click();
    await settled(page, 5);
    assert.equal(requests.length, 5);
    assert.deepEqual(requests[4].request.references.map((ref) => ref.id), refs.map((ref) => ref.id));
    assert.ok(requests[4].referenceImage?.dataUrl.startsWith('data:image/'));
    const latest = (await rows(page)).find((record) => record.version === 2);
    assert.ok(latest.recipe.referenceImage);
    const artifacts = await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('img-gen-gallery');
      open.onsuccess = () => { const db = open.result, query = db.transaction('artifacts').objectStore('artifacts').getAllKeys(); query.onsuccess = () => { db.close(); resolve(query.result); }; query.onerror = () => reject(query.error); };
    }));
    assert.ok(artifacts.includes(`ref-${latest.recipe.referenceImage.id}`), 'continuity snapshot survives cleanup');
    await cards(page).nth(1).getByTitle('全屏预览大图', { exact: true }).click();
    await page.getByRole('dialog', { name: '作品检视', exact: true }).getByRole('button', { name: '复用完整配方', exact: true }).click();
    const studioReferences = page.getByLabel('已载入参考图', { exact: true });
    await until(async () => await studioReferences.getByRole('img').count() === 5, 'full recipe keeps all four references and continuity image');
    assert.ok(await page.getByRole('button', { name: /^开始绘制/ }).isDisabled(), 'five imported images cannot be submitted from single-image studio');
    await page.getByRole('status').filter({ hasText: '配方已载入 5 张参考图' }).waitFor();
    await page.getByLabel('移除参考图 5', { exact: true }).click();
    await until(async () => await studioReferences.getByRole('img').count() === 4 && await page.getByRole('button', { name: /^开始绘制/ }).isEnabled(), 'user can select four references before submitting');
    assert.equal(requests.length, 5, 'recipe reuse does not submit images automatically');
    await nav(page, '系列策划');
    await page.reload(); await page.locator('#series-story-prompt').waitFor();
    assert.equal(await referenceArea(page).getByRole('img').count(), 0);
    assert.equal(await page.locator('#series-story-prompt').inputValue(), '');
    assert.equal((await rows(page)).length, 5);
  });

  await scenario('换码后确认重建分镜, 保留四张参考图与本地首镜, 只扣当前码一次', async (page) => {
    await uploadReferences(page, referenceFiles);
    const refs = (await referenceDraft(page)).references;
    await fillPlan(page); rejectImage = 'following';
    await confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).click();
    await until(async () => (await rows(page)).length === 1 && (await jobs(page)).filter((job) => job.status === 'failed').length === 3, 'only first frame succeeded');
    await closeQueue(page);
    const first = (await rows(page))[0];
    const created = await app.api('/api/admin/access-codes', { cookie: app.adminCookie, method: 'POST', body: { requestId: crypto.randomUUID(), initialPoints: 100, note: '换码验收' } });
    assert.equal(created.status, 201);
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByLabel('访问码', { exact: true }).fill(created.data.codes[0].code);
    await page.getByRole('button', { name: '进入工作台', exact: true }).click();
    await page.getByRole('button', { name: /^任务队列/ }).click();
    const queue = page.getByRole('dialog', { name: '任务队列', exact: true });
    await queue.getByRole('button', { name: /^重新生成/ }).first().waitFor();
    const submitted = [];
    page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/api/jobs')) submitted.push(request.postDataJSON()); });
    rejectImage = false;
    page.once('dialog', (dialog) => { assert.match(dialog.message(), /访问码|身份/); return dialog.accept(); });
    await queue.getByRole('button', { name: /^重新生成/ }).first().click();
    await until(async () => (await rows(page)).length === 2 && (await jobs(page)).every((job) => job.acknowledgedAt), 'new code received its one scene');
    assert.equal(submitted.length, 1);
    assert.deepEqual(submitted[0].request.references.map((ref) => ref.id), refs.map((ref) => ref.id));
    assert.equal(submitted[0].referenceImage.recordId, first.id);
    assert.equal(submitted[0].referenceJobId, undefined);
    const credits = (await (await page.context().request.get(app.base + '/api/credits')).json()).credits;
    assert.equal(credits.available, 90); assert.equal(credits.reserved, 0);
  });

  await scenario('离开页面后保留拆解结果, 返回领取不重复扣点', async (page) => {
    textGate = gate();
    await page.locator('#series-story-prompt').fill('小熊在森林中寻找朋友');
    const before = textCalls(), finished = page.waitForResponse((response) => response.url().endsWith('/api/text') && response.request().method() === 'POST');
    await page.getByRole('button', { name: /^智能拆解分镜/ }).click();
    await until(() => textCalls() === before + 1, 'text upstream started');
    await nav(page, '单图创作');
    textGate.release(); await finished;
    await nav(page, '系列策划');
    await page.locator('#series-story-prompt').waitFor();
    assert.ok((await rows(page, 'drafts')).some((row) => row.data?.requestId && row.data?.signature), 'unapplied text must remain recoverable');
    await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('img-gen-gallery');
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('drafts', 'readwrite'), cursor = tx.objectStore('drafts').openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          if (String(row.key).startsWith('text-request-series-')) {
            const value = row.value, signature = JSON.parse(value.data.signature);
            signature.system = '旧版绘本模板, 恰好 4 项';
            delete value.data.sceneCount;
            value.data.signature = JSON.stringify(signature);
            row.update(value);
          }
          row.continue();
        };
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
      };
    }));
    await page.getByRole('button', { name: /^智能拆解分镜/ }).click();
    await until(() => confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).isEnabled(), 'recovered plan');
    assert.equal(textCalls(), before + 1, 'recover without another paid text request');
  });

  await scenario('本地保存失败后保留原文字请求并免费重领', async (page) => {
    await page.locator('#series-story-prompt').fill('森林里的四幕故事');
    await page.evaluate(() => { window.failSeriesSave = true; });
    const before = textCalls();
    await page.getByRole('button', { name: /^智能拆解分镜/ }).click();
    await page.getByRole('alert').filter({ hasText: /保存|空间/ }).first().waitFor();
    assert.ok((await rows(page, 'drafts')).some((row) => row.data?.requestId && row.data?.signature), 'result must not be acknowledged before the draft is durable');
    assert.equal(await page.locator('#scene-prompt-0').inputValue(), '', 'failed persistence must keep the original draft');
    await page.evaluate(() => { window.failSeriesSave = false; });
    await page.getByRole('button', { name: /^智能拆解分镜/ }).click();
    await until(() => confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).isEnabled(), 'saved original text result');
    assert.equal(textCalls(), before + 1);
    await page.reload();
    await until(() => confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).isEnabled(), 'durable reviewed plan');
  }, () => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (window.failSeriesSave && this.name === 'drafts' && key === 'series' && value?.data?.taskText) throw new DOMException('系列草稿保存失败, 请检查本地空间', 'QuotaExceededError');
      return put.apply(this, arguments);
    };
  });

  await scenario('其他标签页修改草稿后, 迟到拆解不覆盖新内容', async (page) => {
    textGate = gate();
    await page.locator('#series-story-prompt').fill('原来的森林旅程');
    const before = textCalls();
    await page.getByRole('button', { name: /^智能拆解分镜/ }).click();
    await until(() => textCalls() === before + 1, 'original text request started');
    await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('img-gen-gallery');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts'), query = store.get('series');
        query.onsuccess = () => store.put({ ...query.result, data: { ...query.result.data, brief: '另一个标签页的新故事', taskText: '新的开头: 保留其他标签页的修改' } }, 'series');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }));
    textGate.release();
    await page.getByRole('alert').filter({ hasText: '其他页面变更' }).waitFor();
    assert.ok((await rows(page, 'drafts')).some((row) => row.data?.brief === '另一个标签页的新故事'));
    assert.ok((await rows(page, 'drafts')).some((row) => row.data?.requestId && row.data?.signature));
  });

  await scenario('已完成系列重新拆解使用新计划身份, 旧作品仍在展馆', async (page) => {
    await completePlan(page);
    const old = await rows(page), before = imageCalls();
    await page.locator('#series-story-prompt').fill('小熊改去海边旅行');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /^重新拆解分镜/ }).click();
    await until(async () => (await page.locator('#scene-prompt-0').inputValue()).includes('柔和的绘本') && await confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).isEnabled(), 'new plan applied and text receipt finished');
    assert.ok(await confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).isEnabled(), 'new scenes need confirmation instead of reusing completed images');
    assert.equal(await cards(page).getByRole('img').count(), 0);
    assert.deepEqual((await rows(page)).map((row) => row.id), old.map((row) => row.id));
    assert.equal(imageCalls(), before);
    await confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).click();
    await settled(page, 8);
    assert.equal(new Set((await rows(page)).map((row) => row.seriesId)).size, 2);
  });

  await scenario('分镜设置读取原任务参数, 不跟随后来修改的默认值', async (page) => {
    await completePlan(page);
    await page.getByRole('button', { name: '1:1 方形插画', exact: true }).click();
    await page.getByLabel('系列生成质量').selectOption('low');
    await cards(page).nth(1).getByRole('button', { name: /^调整并重绘/ }).click();
    const dialog = page.getByRole('dialog', { name: '调整第 2 镜', exact: true });
    assert.equal(await dialog.getByLabel('本镜画幅').inputValue(), '16:9');
    assert.equal(await dialog.getByLabel('本镜质量').inputValue(), 'medium');
    await dialog.getByLabel('关闭本镜设置').click();
  });

  await scenario('排队编辑保留本地首镜参考与请求身份, 保存时阻止交叉操作', async (page) => {
    await completePlan(page);
    imageGate = gate();
    await cards(page).nth(0).getByTitle('重新绘制本镜', { exact: true }).click();
    await until(async () => (await jobs(page)).some((job) => job.status === 'running'), 'first redraw running');
    await closeQueue(page);
    await cards(page).nth(1).getByTitle('重新绘制本镜', { exact: true }).click();
    const pending = await until(async () => (await jobs(page)).find((job) => job.status === 'pending' && job.clientContext.sceneIndex === 1), 'second redraw waiting');
    await closeQueue(page);
    const original = (await rows(page, 'outbox')).find((row) => row.requestId === pending.requestId).input;
    assert.ok(original.referenceImage, 'redraw has a separate continuity reference');
    assert.ok(await page.getByLabel('系列生成质量').isDisabled(), 'global parameters must not misrepresent queued tasks');
    await cards(page).nth(1).getByTitle('修改尚未执行的分镜').click();
    const dialog = page.getByRole('dialog', { name: '调整第 2 镜', exact: true });
    await dialog.getByLabel('本镜画面提示词').fill('小熊停在瀑布旁边');
    await dialog.getByLabel('本镜画幅').selectOption('1:1');
    const saving = gate(); let captured;
    await page.route(`**/api/jobs/${pending.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      captured = route.request().postDataJSON(); await saving.promise; await route.continue();
    });
    await dialog.getByRole('button', { name: '更新排队任务', exact: true }).click();
    await until(() => captured, 'PATCH started');
    assert.ok(await dialog.getByLabel('本镜画面提示词').isDisabled());
    assert.ok(await dialog.getByLabel('关闭本镜设置').isDisabled());
    await page.keyboard.press('Escape');
    assert.ok(await dialog.isVisible());
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate((element) => element.contains(document.activeElement)), 'focus stays in the saving dialog');
    saving.release(); await dialog.waitFor({ state: 'hidden' });
    const updated = (await rows(page, 'outbox')).find((row) => row.requestId === pending.requestId).input;
    assert.deepEqual(updated.request.references, original.request.references);
    for (const field of ['requestId', 'creditQuote', 'providerId', 'referenceJobId', 'referenceImage', 'retryOf']) assert.deepEqual(updated[field], original[field], `${field} stays unchanged`);
    assert.deepEqual(updated.clientContext, { ...original.clientContext, prompt: '小熊停在瀑布旁边' });
    assert.equal(updated.request.size, '1024x1024');
    imageGate.release(); await settled(page, 6);
    const result = (await rows(page)).find((row) => row.requestId === pending.requestId);
    assert.ok(result.recipe.referenceImage);
    assert.ok(result.recipe.prompt.includes('小熊停在瀑布旁边'));
  });

  await scenario('窄屏和矮屏分镜弹窗可滚动, 保存按钮留在可视范围', async (page) => {
    await fillPlan(page);
    await page.setViewportSize({ width: 390, height: 320 });
    await cards(page).nth(0).getByTitle('设置本镜画幅, 质量和格式').click();
    const dialog = page.getByRole('dialog', { name: '调整第 1 镜', exact: true });
    const bounds = await dialog.boundingBox(), save = await dialog.getByRole('button', { name: '保存本镜设置', exact: true }).boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 320, 'dialog fits short viewport');
    assert.ok(save.y >= 0 && save.y + save.height <= 320, 'save action remains visible');
    await screenshot(page, 'scene-editor-mobile-short');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'series page has no horizontal overflow');
      await screenshot(page, `series-mobile-${theme}`);
    }
  });

  await scenario('排队更新回包晚于出图时, 完成的草稿仍正确清理', async (page) => {
    await fillPlan(page);
    imageGate = gate();
    await confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).click();
    const pending = await until(async () => (await jobs(page)).find((job) => job.status === 'pending' && job.clientContext.sceneIndex === 1), 'editable scene pending');
    await closeQueue(page);
    await cards(page).nth(1).getByTitle('修改尚未执行的分镜').click();
    const dialog = page.getByRole('dialog', { name: '调整第 2 镜', exact: true });
    await dialog.getByLabel('本镜画面提示词').fill('小熊的新画面已经保存');
    const responseGate = gate(); let updated = false;
    await page.route(`**/api/jobs/${pending.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      const response = await route.fetch(); updated = true;
      await responseGate.promise; await route.fulfill({ response });
    });
    await dialog.getByRole('button', { name: '更新排队任务', exact: true }).click();
    await until(() => updated, 'pending edit accepted');
    imageGate.release();
    await settled(page, 4);
    responseGate.release(); await dialog.waitFor({ state: 'hidden' });
    await until(async () => (await rows(page, 'drafts')).some((row) => row.data?.version === 1 && row.data?.taskText === '' && row.data?.seriesId === ''), 'completed workspace remains empty');
    await page.reload();
    await page.locator('#series-story-prompt').waitFor();
    assert.equal(await page.locator('#series-story-prompt').inputValue(), '');
    assert.equal((await rows(page)).length, 4);
  });

  await scenario('领取失败停止动画, 重试只领取原图不重复生成', async (page) => {
    await fillPlan(page);
    await page.route(/\/api\/jobs\/[^/]+\/result$/, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '图片传输暂时中断, 请重试领取原图' }) }));
    const before = imageCalls();
    await confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).click();
    await closeQueue(page);
    await cards(page).first().getByRole('button', { name: '重试领取', exact: true }).waitFor();
    await closeQueue(page);
    assert.equal(await cards(page).first().locator('[class*="animate-spin"]').count(), 0, 'failed delivery is not still shown as running');
    await screenshot(page, 'series-delivery-failed');
    await page.unroute(/\/api\/jobs\/[^/]+\/result$/);
    for (let index = 0; index < 4; index++) {
      const retry = cards(page).nth(index).getByRole('button', { name: '重试领取', exact: true });
      if (await retry.isVisible()) await retry.click();
    }
    await settled(page, 4);
    assert.equal(imageCalls(), before + 4);
  });

  await scenario('首镜失败后重新生成, 后续重试连接新的首镜任务', async (page) => {
    await fillPlan(page); rejectImage = true;
    await confirmation(page).getByRole('button', { name: /^确认并生成 4 张图片/ }).click();
    await until(async () => { const all = await jobs(page); return all.length === 4 && all.every((job) => job.status === 'failed'); }, 'initial series failed');
    await cards(page).first().getByRole('button', { name: /^重新尝试/ }).waitFor();
    await closeQueue(page);
    rejectImage = false; imageGate = gate();
    await cards(page).first().getByRole('button', { name: /^重新尝试/ }).click();
    const anchor = await until(async () => (await jobs(page)).find((job) => job.status === 'running' && job.clientContext.sceneIndex === 0), 'replacement first scene running');
    await cards(page).nth(1).getByRole('button', { name: /^重新尝试/ }).click();
    const following = await until(async () => (await jobs(page)).find((job) => job.status === 'pending' && job.clientContext.sceneIndex === 1), 'following scene uses replacement');
    assert.equal(following.referenceJobId, anchor.id);
    imageGate.release(); await settled(page, 2);
    const record = (await rows(page)).find((row) => row.sceneIndex === 1);
    assert.equal(record.recipe.referenceImage.recordId, anchor.clientContext.placeholderId);
  });

  await scenario('单镜新版本失败时不误报整套完成, 仍保留旧版本', async (page) => {
    await completePlan(page);
    rejectImage = true;
    await cards(page).nth(1).getByTitle('重新绘制本镜', { exact: true }).click();
    await closeQueue(page);
    await cards(page).nth(1).getByRole('button', { name: /^重新尝试/ }).waitFor();
    await closeQueue(page);
    assert.match(await confirmation(page).getByRole('status').innerText(), /异常|失败|待处理/);
    assert.doesNotMatch(await confirmation(page).innerText(), /全部分镜已生成/);
    assert.equal((await rows(page)).length, 4);
    await screenshot(page, 'series-redraw-failed');
    rejectImage = false;
    await cards(page).nth(1).getByRole('button', { name: '调整并重试', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '调整第 2 镜', exact: true });
    await dialog.getByLabel('本镜画面提示词').fill('小熊站在彩虹桥上');
    await dialog.getByLabel('本镜质量').selectOption('high');
    await dialog.getByRole('button', { name: /^保存并重新生成/ }).click();
    await settled(page, 5);
    const latest = (await rows(page)).sort((a, b) => b.version - a.version)[0];
    assert.equal(latest.version, 3, 'successful and failed attempts have distinct versions');
    assert.equal(latest.recipe.quality, 'high');
    assert.ok(latest.recipe.prompt.includes('小熊站在彩虹桥上'));
  });

  await scenario('结果未知时明确确认重新计费, 取消后不提交新任务', async (page) => {
    await completePlan(page); rejectImage = 'unknown';
    await cards(page).nth(1).getByTitle('重新绘制本镜', { exact: true }).click();
    await until(async () => (await jobs(page)).some((job) => job.outcomeUnknown), 'unknown paid result');
    await cards(page).nth(1).getByRole('button', { name: /^重新尝试/ }).waitFor();
    await closeQueue(page);
    const before = imageCalls(); let notice;
    page.once('dialog', async (dialog) => { notice = dialog.message(); await dialog.dismiss(); });
    await page.getByRole('button', { name: /^批量重新绘制/ }).click();
    assert.match(notice, /结果未知/);
    assert.equal(imageCalls(), before);
    await cards(page).nth(1).getByRole('button', { name: '调整并重试', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '调整第 2 镜', exact: true });
    page.once('dialog', (dialog) => dialog.dismiss());
    await editor.getByRole('button', { name: /^保存并重新生成/ }).click();
    assert.ok(await editor.isVisible());
    assert.equal(imageCalls(), before);
    await editor.getByLabel('关闭本镜设置').click();
  });
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, failures, errors }, null, 2));
  assert.equal(failures.length, 0, failures.map((failure) => failure.name).join('; '));
  console.log(`系列流程验收通过: ${checks.length} 项`);
} finally {
  for (const release of gates) release();
  await browser.close();
  await app.close();
}
