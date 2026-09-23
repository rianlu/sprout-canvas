import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startHarness, TEST_PASSWORD, TEST_ADMIN_PASSWORD } from './server-harness.mjs';
import { png } from './fixtures.mjs';
import { STYLE_LIMITS } from '../shared/style-contract.mjs';

const input = (extra = {}) => ({ prompt: '  A small forest house.\n保留作者的原文和换行.  ', author: '示例作者', imageDataUrl: `data:image/png;base64,${png(32, 24).toString('base64')}`, ...extra });
const editable = (record, extra = {}) => Object.assign(Object.fromEntries(['name', 'prompt', 'author', 'category', 'sourceUrl', 'published', 'sortOrder', 'version'].map((key) => [key, record[key]])), extra);
async function login(app) {
  const result = await app.api('/api/admin/auth/login', { method: 'POST', body: { password: TEST_ADMIN_PASSWORD } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  return result.headers.get('set-cookie').split(';')[0];
}

test('style management authorization, persistence, assets and archive transactions', async (t) => {
  const app = await startHarness();
  let second;
  try {
    const user = await app.login();
    const admin = await login(app);
    const api = (url, options = {}) => app.api(`/api/admin/styles${url}`, { cookie: admin, ...options });
    const list = async (adminMode = true) => (await app.api(adminMode ? '/api/admin/styles' : '/api/styles', { cookie: adminMode ? admin : user })).data;
    await t.test('normal and admin sessions are independent and secrets stay server side', async () => {
      assert.equal((await app.api('/api/styles')).status, 401);
      assert.equal((await app.api('/api/admin/styles', { cookie: user })).status, 401);
      assert.equal((await app.api('/api/jobs/me', { cookie: admin })).status, 401);
      assert.equal((await app.api('/api/admin/auth/login', { method: 'POST', body: { password: TEST_PASSWORD } })).status, 401);
      assert.doesNotMatch(JSON.stringify((await app.api('/api/config', { cookie: user })).data), /adminPassword|isolated-admin|fixture-.*-key/);
      assert.equal((await api('', { method: 'POST', headers: { Origin: 'https://other.invalid' }, body: input() })).status, 403);
      assert.equal((await list()).styles.length, 36);
      assert.equal((await list(false)).styles.length, 36);
    });
    let first, duplicate;
    await t.test('simple creation preserves the original prompt and deduplicates image files', async () => {
      const result = await api('', { method: 'POST', body: input() });
      assert.equal(result.status, 201, JSON.stringify(result.data));
      first = result.data.style;
      assert.equal(first.prompt, input().prompt);
      assert.equal(first.category, '');
      assert.equal(first.license, '');
      assert.equal(first.name, 'A small forest house. 保留');
      assert.equal(first.imageWidth, 32);
      duplicate = (await api('', { method: 'POST', body: input({ name: '共享示例图' }) })).data.style;
      assert.equal(duplicate.image, first.image);
      assert.equal((await readdir(path.join(app.directory, 'data/styles/images'))).length, 37);
      const image = await app.api(first.image, { cookie: admin });
      assert.equal(image.status, 200);
      assert.equal(image.headers.get('content-type'), 'image/png');
      assert.equal(image.headers.get('cache-control'), 'private, max-age=31536000, immutable');
      assert.equal((await list(false)).styles.length, 38);
    });
    await t.test('version checks prevent lost updates and publishing affects the public library', async () => {
      const result = await api(`/${first.id}`, { method: 'PUT', body: editable(first, { category: '自定义分类', published: false, sortOrder: 12 }) });
      assert.equal(result.status, 200);
      assert.equal((await api(`/${first.id}`, { method: 'PUT', body: editable(first, { prompt: '过期编辑' }) })).status, 409);
      first = result.data.style;
      assert.equal(first.version, 2);
      assert.equal((await list(false)).styles.length, 37);
      assert.ok((await list()).categories.includes('自定义分类'));
      assert.ok(!(await list(false)).categories.includes('自定义分类'));
      assert.equal((await api(`/${first.id}`, { method: 'DELETE', body: { version: 1 } })).status, 409);
    });
    await t.test('invalid prompts, URLs, image content and fields are rejected without writes', async () => {
      const before = await list();
      for (const extra of [{ prompt: '' }, { sourceUrl: 'javascript:alert(1)' }, { category: '全部' }, { published: 'yes' }, { imageDataUrl: 'data:image/png;base64,ZmFrZQ==' }, { tags: ['extra'] }, { prompt: 'a'.repeat(24001) }]) {
        const result = await api('', { method: 'POST', body: input(extra) });
        assert.equal(result.status, 400, JSON.stringify(result.data));
      }
      assert.deepEqual(await list(), before);
    });
    await t.test('a failed image write rolls back the database and leaves the next write usable', async () => {
      const before = await list();
      const bytes = png(113, 57);
      const file = createHash('sha256').update(bytes).digest('hex') + '.png';
      await writeFile(path.join(app.directory, 'data/styles/images', file), 'damaged orphan');
      const body = input({ imageDataUrl: 'data:image/png;base64,' + bytes.toString('base64') });
      assert.equal((await api('', { method: 'POST', body })).status, 500);
      assert.deepEqual(await list(), before, 'the failed transaction changes neither rows nor revision');
      const saved = await api('', { method: 'POST', body });
      assert.equal(saved.status, 201);
      assert.equal((await api('/' + saved.data.style.id, { method: 'DELETE', body: { version: saved.data.style.version } })).status, 200);
    });
    await t.test('image replacement and last-reference deletion clean up only unused files', async () => {
      const originalFile = first.image.split('/').at(-1);
      let result = await api(`/${duplicate.id}`, { method: 'PUT', body: editable(duplicate, { imageDataUrl: `data:image/png;base64,${png(40, 30).toString('base64')}` }) });
      assert.equal(result.status, 200);
      duplicate = result.data.style;
      assert.ok((await readdir(path.join(app.directory, 'data/styles/images'))).includes(originalFile));
      result = await api(`/${first.id}`, { method: 'DELETE', body: { version: first.version } });
      assert.equal(result.status, 200);
      assert.ok(!(await readdir(path.join(app.directory, 'data/styles/images'))).includes(originalFile));
      assert.equal((await app.api(first.image.replace('/admin/', '/'), { cookie: user })).status, 404);
    });
    let archive;
    await t.test('backups include exact image bytes and fully validate before applying changes', async () => {
      const result = await api('/export');
      assert.equal(result.status, 200);
      archive = result.data;
      assert.equal(archive.styles.length, 37);
      const preview = await api('/import?preview=1', { method: 'POST', body: { archive } });
      assert.equal(preview.status, 200);
      assert.deepEqual({ added: preview.data.added, updated: preview.data.updated, unchanged: preview.data.unchanged }, { added: 0, updated: 0, unchanged: 37 });
      const damaged = structuredClone(archive);
      damaged.styles[0].prompt = '这条变化不能被部分保存';
      damaged.images.at(-1).dataUrl = 'data:image/png;base64,YmFk';
      const before = await list();
      assert.equal((await api('/import', { method: 'POST', body: { archive: damaged, revision: before.revision } })).status, 400);
      assert.deepEqual(await list(), before);
      assert.equal((await readdir(path.join(app.directory, 'data/styles/images'))).length, 37);
      const restored = await api('/import', { method: 'POST', body: { archive, revision: before.revision } });
      assert.equal(restored.status, 200);
      assert.equal(restored.data.revision, before.revision, 'unchanged imports are idempotent');
      const stale = structuredClone(archive);
      stale.styles[0].name = '旧预览不覆盖新修改';
      assert.equal((await api('/import', { method: 'POST', body: { archive: stale, revision: before.revision - 1 } })).status, 409);
    });
    await t.test('a fresh isolated service imports content without affecting the source', async () => {
      second = await startHarness();
      const cookie = await login(second);
      const preview = await second.api('/api/admin/styles/import?preview=1', { cookie, method: 'POST', body: { archive } });
      assert.equal(preview.data.added, 1);
      const imported = await second.api('/api/admin/styles/import', { cookie, method: 'POST', body: { archive, revision: preview.data.revision } });
      assert.equal(imported.status, 200);
      assert.equal((await second.api(duplicate.image, { cookie })).status, 200);
      const entries = (await second.api('/api/admin/styles', { cookie })).data.styles;
      const other = entries.find((style) => style.id === duplicate.id);
      await second.api(`/api/admin/styles/${other.id}`, { cookie, method: 'DELETE', body: { version: other.version } });
      assert.ok((await list()).styles.some((style) => style.id === duplicate.id));
      assert.equal((await app.api(duplicate.image, { cookie: admin })).status, 200);
    });
    await t.test('restart retains sessions and edits and never reseeds a deleted built-in', async () => {
      const seed = (await list()).styles.find((style) => style.id === 'open-15563');
      await api(`/${seed.id}`, { method: 'DELETE', body: { version: seed.version } });
      const before = await list();
      await app.stop(); await app.start();
      assert.equal((await app.api('/api/admin/auth/status', { cookie: admin })).data.authenticated, true);
      assert.deepEqual(await list(), before);
      assert.ok(!(await list()).styles.some((style) => style.id === seed.id));
      const database = await readFile(path.join(app.directory, 'data/styles/library.sqlite'));
      assert.equal(database.includes(Buffer.from(admin.split('=')[1])), false);
    });
    await t.test('replacing a source clears inherited attribution and password rotation revokes admin access', async () => {
      const seed = (await list()).styles.find((style) => style.license);
      const updated = await api(`/${seed.id}`, { method: 'PUT', body: editable(seed, { author: '另一个作者', sourceUrl: 'https://new.invalid/post' }) });
      assert.equal(updated.data.style.license, '');
      app.config.adminPassword = 'rotated-local-admin-password';
      await writeFile(path.join(app.directory, 'config/local.config.json'), JSON.stringify(app.config));
      assert.equal((await app.api('/api/admin/auth/status', { cookie: admin })).data.authenticated, false);
      assert.equal((await api('')).status, 401);
      assert.equal((await app.api('/api/styles', { cookie: user })).status, 200);
    });
  } finally { await second?.close(); await app.close(); }
});

test('merged libraries remain exportable and restorable within the backup limit', async () => {
  const app = await startHarness();
  try {
    const cookie = await login(app);
    const exported = (await app.api('/api/admin/styles/export', { cookie })).data;
    const source = exported.styles[0];
    const images = exported.images.filter((image) => image.file === source.imageFile);
    const prompt = '画'.repeat(STYLE_LIMITS.prompt);
    const makeArchive = (prefix) => ({ ...exported, styles: Array.from({ length: 480 }, (_, index) => ({ ...source, id: prefix + index, prompt })), images });
    const first = makeArchive('first-');
    const preview = await app.api('/api/admin/styles/import?preview=1', { cookie, method: 'POST', body: { archive: first } });
    assert.equal(preview.status, 200);
    const imported = await app.api('/api/admin/styles/import', { cookie, method: 'POST', body: { archive: first, revision: preview.data.revision } });
    assert.equal(imported.status, 200);
    const second = makeArchive('second-');
    assert.ok(Buffer.byteLength(JSON.stringify(second)) < STYLE_LIMITS.archiveBytes, 'each archive fits individually');
    const rejected = await app.api('/api/admin/styles/import', { cookie, method: 'POST', body: { archive: second, revision: imported.data.revision } });
    assert.equal(rejected.status, 413, 'reject a merge that would make the full library impossible to restore');
    const backup = await app.api('/api/admin/styles/export', { cookie });
    assert.equal(backup.status, 200);
    assert.equal(backup.data.styles.length, 516);
    assert.ok(Buffer.byteLength(JSON.stringify(backup.data, null, 2)) < STYLE_LIMITS.archiveBytes);
  } finally { await app.close(); }
});
