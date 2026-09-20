import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startHarness, until } from './server-harness.mjs';
import { png } from './fixtures.mjs';

const output = path.join(process.env.SPROUT_TEST_OUTPUT || path.join(tmpdir(), 'sprout-browser-check'), 'reference-images');
await mkdir(output, { recursive: true });
const app = await startHarness({ serveDist: true });
const executablePath = process.env.SPROUT_BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const files = await Promise.all(['series-01.jpg', 'series-02.jpg', 'studio-01.jpg', 'studio-02.jpg'].map(async (name) => ({ name, mimeType: 'image/jpeg', buffer: await readFile(new URL('../public/assets/stitch/' + name, import.meta.url)) })));
const checks = [], errors = [];

try {
  for (const series of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', locale: 'zh-CN' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    const label = series ? '系列参考图' : '参考图';
    const prefix = series ? 'series' : 'studio';
    const slots = page.getByLabel(`已载入${label}`, { exact: true });
    const images = () => slots.getByRole('img');
    const add = (index) => page.getByRole('button', { name: `添加${label} ${index}`, exact: true });
    const preview = () => page.getByRole('dialog', { name: '参考图预览', exact: true });
    const input = () => page.getByLabel(`上传${label}`, { exact: true });
    const sources = () => images().evaluateAll((items) => items.map((image) => image.src));
    const pastedImage = png(320, 180, [70, 120, 90, 255]);
    async function pasteImage() {
      await page.bringToFront();
      await page.evaluate(async (base64) => {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], { type: 'image/png' }) })]);
        document.activeElement?.blur();
      }, pastedImage.toString('base64'));
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    }
    async function dropImages(count, area = slots) {
      await area.evaluate((element, { count, base64 }) => {
        const transfer = new DataTransfer();
        for (let index = 0; index < count; index++) transfer.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], `拖拽-${index}.png`, { type: 'image/png' }));
        element.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
        element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }, { count, base64: pastedImage.toString('base64') });
    }
    async function draft() {
      return page.evaluate((key) => new Promise((resolve, reject) => {
        const open = indexedDB.open('img-gen-gallery');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result, query = db.transaction('drafts').objectStore('drafts').get(key);
          query.onsuccess = () => { resolve(query.result?.data); db.close(); };
          query.onerror = () => { reject(query.error); db.close(); };
        };
      }), series ? 'series' : 'studio');
    }
    async function screenshot(name) {
      await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
      await page.screenshot({ path: path.join(output, `${prefix}-${name}.png`), fullPage: !(await preview().count()) });
    }
    async function checkRow() {
      const bounds = await slots.locator('.reference-image-slot').evaluateAll((items) => items.map((item) => { const { x, y, width, height } = item.getBoundingClientRect(); return { x, y, width, height }; }));
      assert.equal(bounds.length, 4);
      assert.ok(bounds.every((box) => Math.abs(box.y - bounds[0].y) < 1), 'all four slots share one row');
      assert.ok(bounds.every((box) => Math.abs(box.width - bounds[0].width) < 1), 'slot widths are uniform');
      const row = await slots.boundingBox();
      assert.ok(bounds.every((box) => box.x >= row.x && box.x + box.width <= row.x + row.width + 1), 'all four slots are visible without horizontal scrolling');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page overflow');
      return (await slots.boundingBox()).height;
    }
    try {
      await page.goto(app.base);
      await page.getByLabel('访问码', { exact: true }).fill(app.accessCode);
      await page.getByRole('button', { name: '进入工作台', exact: true }).click();
      await page.getByLabel('画面提示词', { exact: true }).waitFor();
      if (series) await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '系列策划', exact: true }).click();
      const prompt = series ? page.locator('#series-story-prompt') : page.getByLabel('画面提示词', { exact: true });
      await prompt.fill('图 1 的小狐狸走进图 2 的森林, 保留温暖水彩画风.');
      await slots.waitFor();
      const emptyHeight = await checkRow();
      await screenshot('empty');
      const chooser = page.waitForEvent('filechooser');
      await add(1).click();
      await (await chooser).setFiles(files.slice(0, 2));
      await until(async () => await images().count() === 2 && await input().isEnabled(), 'two reference images ready');
      assert.ok(Math.abs(await checkRow() - emptyHeight) < 1, 'adding two images keeps row height');
      assert.equal(await add(3).count(), 1); assert.equal(await add(4).count(), 1);
      await screenshot('two-images');

      const initialSources = await sources();
      const trigger = page.getByRole('button', { name: `查看${label} 1`, exact: true });
      const thumbnail = await trigger.boundingBox();
      await trigger.click();
      await preview().waitFor();
      await until(async () => (await preview().getByLabel('缩放比例').innerText()) !== '--', 'preview image decoded');
      const close = preview().getByRole('button', { name: '关闭参考图预览', exact: true });
      const closeSize = await close.boundingBox();
      const view = preview().getByRole('region', { name: '图片查看区', exact: true });
      const viewSize = await view.boundingBox();
      assert.ok(viewSize.width > thumbnail.width * 5 && viewSize.height > thumbnail.height * 3, 'preview opens beyond the configuration panel');
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
      const originalScale = parseInt(await preview().getByLabel('缩放比例').innerText());
      await preview().getByLabel('放大图片', { exact: true }).click();
      await until(async () => parseInt(await preview().getByLabel('缩放比例').innerText()) > originalScale, 'image zoom increases');
      assert.equal((await close.boundingBox()).width, closeSize.width, 'controls do not scale with image');
      await screenshot('large-preview');
      await preview().getByRole('button', { name: '下一张参考图', exact: true }).click();
      await preview().getByRole('heading', { name: '参考图 2', exact: true }).waitFor();
      assert.equal(await preview().getByRole('img').getAttribute('src'), initialSources[1]);
      assert.equal(await preview().getByRole('button', { name: '适应窗口', exact: true }).getAttribute('aria-pressed'), 'true');
      await view.focus(); await page.keyboard.press('ArrowLeft');
      await preview().getByRole('heading', { name: '参考图 1', exact: true }).waitFor();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
      assert.equal(app.calls.length, 0, 'preview shortcuts do not call image or text models');
      await page.keyboard.press('Tab');
      assert.ok(await preview().evaluate((element) => element.contains(document.activeElement)), 'focus remains in preview');
      await page.keyboard.press('Escape');
      await preview().waitFor({ state: 'hidden' });
      assert.ok(await trigger.evaluate((element) => document.activeElement === element), 'closing returns focus to original thumbnail');
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert.deepEqual(await sources(), initialSources, 'preview does not change reference inputs');
      checks.push(`${label}: 大图预览, 缩放, 平移和键盘关闭正常, 焦点恢复且不触发生图`);

      await input().setInputFiles(files.slice(2));
      await until(async () => await images().count() === 4 && await input().isEnabled(), 'four reference images ready');
      assert.ok(Math.abs(await checkRow() - emptyHeight) < 1, 'four images do not increase row height');
      assert.equal(await slots.getByRole('button', { name: new RegExp(`^添加${label}`) }).count(), 0, 'full slots have no extra upload row');
      await screenshot('four-images');
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await checkRow();
        await screenshot(`mobile-${width}`);
        await trigger.click(); await preview().waitFor();
        const bounds = await preview().boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'mobile preview stays within viewport');
        await preview().getByRole('button', { name: '关闭参考图预览', exact: true }).click();
      }
      await page.getByRole('button', { name: `移除${label} 2`, exact: true }).click();
      await until(async () => await images().count() === 3, 'remove one reference');
      await checkRow(); assert.equal(await add(4).count(), 1);
      checks.push(`${label}: 空态和 2/4 张图片保持四槽同排与固定高度, 桌面及 390/320px 手机布局正常`);

      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      const beforePaste = await sources();
      await pasteImage();
      await until(async () => await images().count() === 4 && await input().isEnabled(), 'native paste appends to an occupied reference area without input focus');
      assert.deepEqual((await sources()).slice(0, 3), beforePaste);
      const fullSources = await sources();
      await pasteImage();
      await page.getByRole('alert').filter({ hasText: '最多使用 4 张参考图' }).waitFor();
      assert.deepEqual(await sources(), fullSources, 'full capacity never replaces an existing image');
      await page.getByRole('button', { name: `移除${label} 4`, exact: true }).click();
      await until(async () => await images().count() === 3, 'one free slot');
      await dropImages(2);
      assert.deepEqual(await sources(), beforePaste, 'an oversized drop is rejected as a whole');
      await dropImages(1);
      await until(async () => await images().count() === 4 && await input().isEnabled(), 'drop appends to the remaining slot');
      assert.deepEqual((await sources()).slice(0, 3), beforePaste);
      await page.reload(); await slots.waitFor();
      assert.deepEqual((await sources()).slice(0, 3), beforePaste);
      assert.equal(await images().count(), 4);
      checks.push(`${label}: 无需输入框焦点即可粘贴追加, 拖拽追加不覆盖原图, 满额与超量批次不改草稿, 刷新保留顺序`);

      if (!series) {
        await page.getByRole('button', { name: '移除参考图 4', exact: true }).click();
        await until(async () => await images().count() === 3, 'remove fourth reference');
        await page.getByRole('button', { name: '移除参考图 3', exact: true }).click();
        await until(async () => (await draft()).config.refImages.length === 2, 'two references saved');
        const original = await draft(), originalSources = await sources();
        const editTab = page.getByRole('button', { name: '局部重绘', exact: true });
        const referenceTab = page.getByRole('button', { name: '参考图生成', exact: true });
        const maskDialog = page.getByRole('dialog', { name: '局部重绘工作区', exact: true });
        const editArea = page.locator('.studio-reference-area');
        const draw = () => page.getByRole('button', { name: '绘制蒙版', exact: true });
        const editMask = () => page.getByRole('button', { name: '编辑蒙版', exact: true });
        async function checkSingleOriginal(source) {
          assert.equal(await slots.count(), 0, 'edit mode has no multi-reference slots');
          assert.equal(await editArea.getByRole('img').count(), 1, 'only one original is visible');
          assert.equal(await editArea.getByRole('img').getAttribute('src'), source);
          assert.equal(await editArea.getByRole('button', { name: /^局部重绘参考图/ }).count(), 0, 'no multi-image selection controls');
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'single-image layout has no horizontal overflow');
        }
        async function drawMask() {
          const canvas = maskDialog.getByLabel('蒙版画布, 按住拖动涂抹');
          await until(async () => (await canvas.boundingBox())?.width > 0, 'mask canvas ready');
          const box = await canvas.boundingBox();
          await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5); await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 6 }); await page.mouse.up();
        }
        await editTab.click();
        assert.equal(await maskDialog.count(), 0, 'changing mode does not open the editor');
        await until(async () => (await draft()).config.mode === 'edit', 'first original selected on mode change');
        const enteredEdit = await draft();
        assert.equal(enteredEdit.refImage.id, original.config.refImages[0].id);
        assert.deepEqual(enteredEdit.config.refImages, original.config.refImages, 'mode change retains all reference images');
        await checkSingleOriginal(originalSources[0]);
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
        await draw().click(); await maskDialog.waitFor();
        assert.equal(await maskDialog.getByRole('img').getAttribute('src'), originalSources[0]);
        await drawMask(); await maskDialog.getByLabel('局部重绘提示词').fill('未保存的修改');
        await maskDialog.getByRole('button', { name: '取消', exact: true }).click();
        await maskDialog.waitFor({ state: 'hidden' });
        assert.deepEqual(await draft(), enteredEdit, 'cancel preserves the original, parameters and prompt from before opening the editor');
        assert.equal(await editTab.getAttribute('aria-pressed'), 'true');
        assert.ok(await page.getByRole('button', { name: /^开始局部重绘/ }).isDisabled());
        await checkSingleOriginal(originalSources[0]);
        await screenshot('cancel-mask-single-original');

        await draw().click(); await drawMask();
        await maskDialog.getByLabel('局部重绘提示词').fill('只修改第一张图的涂抹区域');
        await maskDialog.getByRole('button', { name: '保存并应用蒙版', exact: true }).click();
        await maskDialog.waitFor({ state: 'hidden' });
        await until(async () => Boolean((await draft()).mask), 'first image mask saved');
        const saved = await draft();
        assert.equal(saved.refImage.id, original.config.refImages[0].id);
        assert.deepEqual(saved.config.refImages, original.config.refImages);
        await pasteImage(); await dropImages(1, editArea);
        assert.deepEqual(await draft(), saved, 'edit mode never appends references or changes a saved mask');
        await editTab.click();
        assert.deepEqual(await draft(), saved, 'clicking the selected tab does not clear its mask');
        await editMask().click(); await maskDialog.waitFor();
        assert.equal(await maskDialog.getByRole('img').getAttribute('src'), originalSources[0]);
        await drawMask(); await page.keyboard.press('Escape');
        await maskDialog.waitFor({ state: 'hidden' });
        assert.deepEqual(await draft(), saved, 'closing without saving preserves the previous mask');
        await screenshot('saved-mask-single-original');

        await page.reload(); await editMask().waitFor();
        assert.equal(await maskDialog.count(), 0);
        assert.equal((await draft()).refImage.id, original.config.refImages[0].id);
        assert.deepEqual((await draft()).config.refImages, original.config.refImages);
        await page.getByRole('button', { name: '查看局部重绘原图', exact: true }).click();
        await preview().waitFor();
        assert.equal(await preview().getByRole('img').getAttribute('src'), originalSources[0]);
        assert.equal(await preview().getByRole('button', { name: '下一张参考图', exact: true }).count(), 0, 'edit preview exposes only its one original');
        await preview().getByRole('button', { name: '关闭参考图预览', exact: true }).click();
        for (const width of [390, 320]) {
          await page.setViewportSize({ width, height: 844 }); await checkSingleOriginal(originalSources[0]);
          await screenshot(`edit-single-original-${width}`);
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await referenceTab.click();
        await slots.waitFor(); await checkRow();
        assert.deepEqual(await sources(), originalSources, 'switching back restores the complete reference list in order');
        await page.getByRole('button', { name: '移除参考图 1', exact: true }).click();
        await until(async () => (await draft()).config.refImages.length === 1, 'one reference saved');
        await editTab.click();
        assert.equal(await maskDialog.count(), 0, 'single-reference mode changes also require an explicit edit action');
        await until(async () => (await draft()).config.mode === 'edit', 'single original selected');
        const single = await draft();
        assert.equal(single.refImage.id, original.config.refImages[1].id, 'after removing the first reference the new first image becomes the edit original');
        assert.equal(single.mask, null, 'another original cannot inherit the old mask');
        await checkSingleOriginal(originalSources[1]);
        await draw().click(); await maskDialog.waitFor();
        assert.equal(await maskDialog.getByText('0 处笔触', { exact: true }).count(), 1);
        await maskDialog.getByRole('button', { name: '关闭', exact: true }).click();
        await maskDialog.waitFor({ state: 'hidden' });
        assert.deepEqual(await draft(), single);
        await checkSingleOriginal(originalSources[1]);
        assert.equal(app.calls.length, 0);
        checks.push('单图局部重绘: 切换后只取第一张并展示单图卡片, 不自动弹窗, 取消保留草稿, 仅预览当前原图, 刷新与切回保留完整参考列表且不串用蒙版');
      }
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
  assert.equal(app.calls.length, 0);
  const report = { passed: checks.length, checks, modelRequests: 0, output };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await app.close(); }
