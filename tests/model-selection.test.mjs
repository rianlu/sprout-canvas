import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startHarness, until } from './server-harness.mjs';
import { submission } from './fixtures.mjs';
import * as queue from '../server/queue.mjs';

const imageInput = (app, cookie, request = {}, extra = {}) => ({ ...submission(randomUUID(), request), creditQuote: app.quote(cookie), ...extra });
const postImage = (app, cookie, body) => app.api('/api/jobs', { cookie, method: 'POST', body });
const completed = (app, cookie, id) => until(async () => {
  const job = (await app.api('/api/jobs/' + id, { cookie })).data;
  return ['succeeded', 'failed', 'interrupted', 'expired'].includes(job.status) && job;
}, 'image outcome');
const saveConfig = (app) => writeFile(path.join(app.directory, 'config/local.config.json'), JSON.stringify(app.config));
async function unusedUrl() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return url;
}
/** Two GPT Image 2 channels plus one GPT Image 2.5 channel without transparency. */
async function heterogeneous(app) {
  const base = app.config.imageProviders[0];
  app.config.imageProviders.push({ ...base, id: 'newer', name: 'newer', baseUrl: base.baseUrl.replace('/primary', '/newer'), imageModel: 'gpt-image-2.5', capabilities: { ...base.capabilities, transparent: false } });
  await saveConfig(app);
}
const upstreamOf = (call) => call.path.split('/')[1];

test('按模型分组的公开能力不暴露密钥, 2.5 模型也能接收自定义尺寸', async () => {
  const app = await startHarness();
  try {
    await heterogeneous(app);
    const cookie = await app.login();
    const config = (await app.api('/api/config', { cookie })).data;
    assert.deepEqual(config.providers.map((provider) => [provider.id, provider.modelName, provider.capabilities.customSizes, provider.capabilities.transparent]), [
      ['primary', 'GPT Image 2', true, true], ['secondary', 'GPT Image 2', true, true], ['newer', 'GPT Image 2.5', true, false],
    ]);
    assert.doesNotMatch(JSON.stringify(config), /apiKey|fixture-[a-z]+-key|baseUrl":"http/);

    const wide = await postImage(app, cookie, imageInput(app, cookie, { size: '1280x720' }, { modelName: 'GPT Image 2.5' }));
    assert.equal(wide.status, 202, JSON.stringify(wide.data));
    const done = await completed(app, cookie, wide.data.id);
    assert.equal(done.status, 'succeeded');
    assert.equal(done.providerId, 'newer');
    assert.equal(done.recipe.modelName, 'GPT Image 2.5');
    assert.equal(app.calls.at(-1).json.model, 'gpt-image-2.5');
    assert.equal(app.calls.at(-1).json.size, '1280x720');

    const transparent = await postImage(app, cookie, imageInput(app, cookie, { background: 'transparent' }, { modelName: 'GPT Image 2.5' }));
    assert.equal(transparent.status, 400);
    assert.match(transparent.data.error, /所选模型不支持这些生成参数/);
    const missing = await postImage(app, cookie, imageInput(app, cookie, {}, { modelName: 'GPT Image 9' }));
    assert.equal(missing.status, 400);
    assert.match(missing.data.error, /所选模型暂未提供/);
    for (const modelName of [' GPT Image 2', 'x'.repeat(41), 7]) assert.equal((await postImage(app, cookie, imageInput(app, cookie, {}, { modelName }))).status, 400);

    // Automatic routing still reaches every channel that fits; transparency skips the 2.5 channel.
    const automatic = await completed(app, cookie, (await postImage(app, cookie, imageInput(app, cookie, { background: 'transparent', size: '1280x720' }))).data.id);
    assert.notEqual(automatic.providerId, 'newer');
    assert.equal(automatic.recipe.modelName, undefined);
  } finally { await app.close(); }
});

test('指定模型只在同模型通道间切换, 同模型全部未连接时失败返还而不换模型', async () => {
  const app = await startHarness();
  try {
    await heterogeneous(app);
    const cookie = await app.login();
    app.config.imageProviders[0].baseUrl = await unusedUrl();
    await saveConfig(app);
    const fallback = await completed(app, cookie, (await postImage(app, cookie, imageInput(app, cookie, { size: '1280x720' }, { modelName: 'GPT Image 2' }))).data.id);
    assert.equal(fallback.status, 'succeeded');
    assert.equal(fallback.providerId, 'secondary');
    assert.ok(app.calls.every((call) => upstreamOf(call) !== 'newer'));

    app.config.imageProviders[1].baseUrl = await unusedUrl();
    await saveConfig(app);
    const callsBefore = app.calls.length;
    const failed = await completed(app, cookie, (await postImage(app, cookie, imageInput(app, cookie, {}, { modelName: 'GPT Image 2' }))).data.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.credit.state, 'refunded');
    assert.equal(app.calls.length, callsBefore, 'the GPT Image 2.5 channel is never used for a GPT Image 2 request');

    const automatic = await completed(app, cookie, (await postImage(app, cookie, imageInput(app, cookie))).data.id);
    assert.equal(automatic.status, 'succeeded');
    assert.equal(automatic.providerId, 'newer', 'automatic routing falls back across models');
  } finally { await app.close(); }
});

test('排队任务不能改换模型, 局部重绘固定原通道不受模型选择影响', async () => {
  const app = await startHarness();
  let release;
  try {
    await heterogeneous(app);
    const cookie = await app.login();
    app.controls.respond = () => new Promise((resolve) => { release = () => resolve(false); });
    const running = (await postImage(app, cookie, imageInput(app, cookie))).data;
    await until(() => release, 'first job holds the worker');
    const input = imageInput(app, cookie, {}, { modelName: 'GPT Image 2' });
    const pending = (await postImage(app, cookie, input)).data;
    assert.equal(pending.status, 'pending');
    const changed = await app.api('/api/jobs/' + pending.id, { cookie, method: 'PATCH', body: { ...input, modelName: 'GPT Image 2.5' } });
    assert.equal(changed.status, 409);
    assert.match(changed.data.error, /模型/);
    app.controls.respond = null;
    release();
    await completed(app, cookie, running.id);
    assert.notEqual((await completed(app, cookie, pending.id)).providerId, 'newer');

    const pinned = await completed(app, cookie, (await postImage(app, cookie, imageInput(app, cookie, {}, { providerId: 'newer', modelName: 'GPT Image 2' }))).data.id);
    assert.equal(pinned.providerId, 'newer', 'a pinned channel wins over the model choice');
  } finally { release?.(); await app.close(); }
});

test('模型范围内按单一通道判断参数组合, 自定义尺寸来自配置而不是模型名', () => {
  const providers = [
    { id: 'square', name: 'square', modelName: 'A', generationMode: 'images', imageModel: 'gpt-image-2', capabilities: { outputFormats: ['png'], transparent: true, customSizes: false } },
    { id: 'wide', name: 'wide', modelName: 'A', generationMode: 'images', imageModel: 'other-model', capabilities: { outputFormats: ['png'], transparent: false, customSizes: true } },
    { id: 'other', name: 'other', modelName: 'B', generationMode: 'images', imageModel: 'gpt-image-2', capabilities: { outputFormats: ['png'], transparent: true, customSizes: true } },
  ];
  const config = { ...providers[0], providers, imageProviders: providers };
  const body = (payload) => Buffer.from(JSON.stringify({ prompt: 'p', n: 1, quality: 'auto', output_format: 'png', ...payload }));
  const choose = (scope, payload) => queue.chooseImageProvider(queue.modelScope(config, scope), '/v1/images/generations', 'application/json', '', body(payload)).id;
  assert.equal(choose('A', { size: '1280x720' }), 'wide', 'a non-GPT model name still routes custom sizes when configured');
  assert.equal(choose('A', { size: '1024x1024', background: 'transparent' }), 'square');
  assert.throws(() => choose('A', { size: '1280x720', background: 'transparent' }), /没有可用/, 'two channels cannot combine their capabilities');
  assert.equal(choose('', { size: '1280x720', background: 'transparent' }), 'other');
  assert.deepEqual(queue.modelScope(config, 'missing').providers, []);
  assert.equal(queue.modelScope(config, ''), config);
});

test('所选模型通道熔断时提交即说明原因并标为明确拒绝, 自动仍可使用其他模型', async () => {
  const app = await startHarness();
  try {
    await heterogeneous(app);
    const cookie = await app.login();
    app.controls.respond = (call, response) => {
      if (upstreamOf(call) !== 'newer') return false;
      response.writeHead(524, { 'Content-Type': 'text/html' }); response.end('<html>A timeout occurred</html>'); return true;
    };
    // A gateway timeout costs the user minutes, so one is enough to cool the channel down.
    const timedOut = await completed(app, cookie, (await postImage(app, cookie, imageInput(app, cookie, {}, { modelName: 'GPT Image 2.5' }))).data.id);
    assert.equal(timedOut.outcomeUnknown, true);
    assert.match(timedOut.error, /^生图服务响应超时 \(HTTP 524\)\. 结果未知/);
    const balance = (await app.api('/api/credits', { cookie })).data.credits;
    const refused = await postImage(app, cookie, imageInput(app, cookie, {}, { modelName: 'GPT Image 2.5' }));
    assert.equal(refused.status, 503);
    assert.equal(refused.data.code, 'CHANNEL_UNAVAILABLE');
    assert.match(refused.data.error, /所选模型暂时不可用/);
    assert.deepEqual((await app.api('/api/credits', { cookie })).data.credits, balance);
    const automatic = await completed(app, cookie, (await postImage(app, cookie, imageInput(app, cookie))).data.id);
    assert.equal(automatic.status, 'succeeded'); assert.notEqual(automatic.providerId, 'newer');
  } finally { await app.close(); }
});
