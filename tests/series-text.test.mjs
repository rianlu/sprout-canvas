import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startHarness } from './server-harness.mjs';

const sendJson = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); return true; };
const reply = (response, content) => sendJson(response, 200, { choices: [{ message: { content } }] });
const saveConfig = (app) => writeFile(path.join(app.directory, 'config/local.config.json'), JSON.stringify(app.config));
const seriesInput = (app, cookie, extra = {}) => ({ ...app.textInput(cookie), kind: 'series', sceneCount: 4, content: '给 MORI 保温杯做详情页. 350ml, 陶瓷内胆, 12 小时保温.', ...extra });
async function balance(app, cookie) {
  const { credits } = (await app.api('/api/credits', { cookie })).data;
  return [credits.available, credits.reserved, credits.spent];
}
const detailPlan = (patch = () => ({})) => ({
  concept: '给通勤族的保温杯',
  visualRules: '雾霾蓝配浅木色, 柔和侧光, 主标题在左上.',
  shots: Array.from({ length: 4 }, (_, index) => ({ role: '场景', title: `第 ${index + 1} 屏`, headline: `早上的热水 ${index + 1}`, subline: '12 小时保温, 暖到工位', labels: ['12 小时保温 → 杯身'], prompt: `MORI 保温杯第 ${index + 1} 屏.`, ...patch(index) })),
});
// One event per chunk, like a relay flushing tokens; `cut` drops the finish signal and closes the socket.
function streamPlan(response, text, { cut = false, error = null, parts = 5 } = {}) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const size = Math.ceil(text.length / parts);
  for (let index = 0; index < text.length; index += size) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(index, index + size) } }] })}\n\n`);
  if (error) { response.write(`data: ${JSON.stringify({ error })}\n\n`); response.end(); return true; }
  if (cut) { response.socket.destroy(); return true; }
  response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
  response.end('data: [DONE]\n\n');
  return true;
}

test('场景拆解使用场景指令, 由服务端拼出卡片提示词, 只扣一次', async () => {
  const app = await startHarness();
  try {
    const cookie = await app.login();
    app.controls.respond = (_call, response) => reply(response, JSON.stringify(detailPlan()));
    const input = seriesInput(app, cookie, { scene: 'ecommerce-detail', referenceCount: 0 });
    const result = await app.api('/api/text', { cookie, method: 'POST', body: input });
    assert.equal(result.status, 200); assert.equal(result.data.credit.state, 'charged');
    const tasks = JSON.parse(result.data.text);
    assert.equal(tasks.length, 4);
    assert.ok(tasks[0].prompt.startsWith('雾霾蓝配浅木色'));
    assert.match(tasks[0].prompt, /主标题 "早上的热水 1"/);
    assert.equal(app.calls.length, 1);
    const [system, user] = app.calls[0].json.messages;
    assert.match(system.content, /电商详情页套图/); assert.match(system.content, /不要编造图号/);
    assert.equal(user.content, '创作需求: ' + input.content);
    assert.deepEqual(await balance(app, cookie), [999999, 0, 1]);
    // The scene is part of the request identity; the same id with another scene is a different intent.
    assert.equal((await app.api('/api/text', { cookie, method: 'POST', body: { ...input, scene: 'ecommerce-main' } })).data.code, 'REQUEST_CONFLICT');
    assert.equal((await app.api('/api/text', { cookie, method: 'POST', body: input })).data.text, result.data.text);
    assert.equal(app.calls.length, 1, 'replay reads the stored result');
    for (const body of [seriesInput(app, cookie, { scene: 'picture-book' }), { ...app.textInput(cookie), scene: 'ecommerce-main' }]) {
      assert.equal((await app.api('/api/text', { cookie, method: 'POST', body })).status, 400);
    }
    assert.equal(app.calls.length, 1); assert.deepEqual(await balance(app, cookie), [999999, 0, 1]);
  } finally { await app.close(); }
});

test('旧页面不带场景和图片张数时按通用场景处理, 新页面的默认值仍是同一请求', async () => {
  const app = await startHarness();
  try {
    const cookie = await app.login();
    const plan = Array.from({ length: 4 }, (_, index) => ({ title: `第 ${index + 1} 幕`, prompt: `小狐狸第 ${index + 1} 处` }));
    app.controls.respond = (_call, response) => reply(response, JSON.stringify(plan));
    const legacy = seriesInput(app, cookie);
    const first = await app.api('/api/text', { cookie, method: 'POST', body: legacy });
    assert.equal(first.status, 200);
    assert.match(app.calls[0].json.messages[1].content, /从梗概中提取主体与画面风格要求, 保持全系列一致/);
    const same = await app.api('/api/text', { cookie, method: 'POST', body: { ...legacy, scene: 'general', referenceCount: 0 } });
    assert.equal(same.status, 200); assert.equal(same.data.credit.id, first.data.credit.id);
    assert.equal(app.calls.length, 1);
  } finally { await app.close(); }
});

test('检查不通过时重写一次; 重写失败或更差时保留第一稿, 仍只扣一次', async () => {
  const app = await startHarness();
  try {
    const cookie = await app.login();
    const flawed = detailPlan((index) => (index === 2 ? { headline: '最好用的保温杯' } : {}));
    const fixed = detailPlan((index) => (index === 2 ? { headline: '一路都是温的' } : {}));
    for (const [second, expected] of [['not json', flawed], [JSON.stringify(fixed), fixed], [JSON.stringify(detailPlan(() => ({ headline: '最好的杯子' }))), flawed]]) {
      const replies = [JSON.stringify(flawed), second];
      const before = app.calls.length;
      app.controls.respond = (_call, response) => reply(response, replies.shift());
      const result = await app.api('/api/text', { cookie, method: 'POST', body: seriesInput(app, cookie, { scene: 'ecommerce-detail', referenceCount: 0 }) });
      assert.equal(result.status, 200); assert.equal(result.data.credit.state, 'charged');
      assert.match(JSON.parse(result.data.text)[2].prompt, new RegExp(`主标题 "${expected.shots[2].headline}"`));
      assert.equal(app.calls.length, before + 2);
      const rewrite = app.calls.at(-1).json.messages;
      assert.match(rewrite[0].content, /现在是修改轮/); assert.match(rewrite[1].content, /第 3 张 文案用了绝对词/);
    }
    assert.deepEqual(await balance(app, cookie), [999997, 0, 3]);
    assert.match(app.logs(), /rewrite kept first draft/);
  } finally { await app.close(); }
});

test('流式文本通道: 完整回复才扣点, 中途断开按结果未知返还且不换通道, 流内错误换备用通道', async () => {
  const app = await startHarness();
  try {
    const primary = app.config.textProviders[0];
    app.config.textProviders = [{ ...primary, stream: true }, { ...primary, id: 'backup', name: 'backup', baseUrl: primary.baseUrl + '/backup' }];
    await saveConfig(app);
    const cookie = await app.login();
    const plan = JSON.stringify(Array.from({ length: 4 }, (_, index) => ({ title: `第 ${index + 1} 幕`, prompt: `小狐狸第 ${index + 1} 处` })));

    app.controls.respond = (call, response) => (call.json.stream ? streamPlan(response, plan) : false);
    const streamed = await app.api('/api/text', { cookie, method: 'POST', body: seriesInput(app, cookie) });
    assert.equal(streamed.status, 200); assert.equal(streamed.data.credit.state, 'charged');
    assert.equal(JSON.parse(streamed.data.text).length, 4);
    assert.equal(app.calls.at(-1).json.stream, true); assert.equal(app.calls.at(-1).path, '/v1/chat/completions');
    app.controls.respond = (call, response) => (call.json.stream ? streamPlan(response, '一片在晨光里舒展的绿叶') : false);
    const polished = await app.api('/api/text', { cookie, method: 'POST', body: app.textInput(cookie) });
    assert.equal(polished.status, 200); assert.equal(polished.data.text, '一片在晨光里舒展的绿叶');

    let before = app.calls.length;
    app.controls.respond = (call, response) => (call.json.stream ? streamPlan(response, plan, { cut: true }) : false);
    const cut = await app.api('/api/text', { cookie, method: 'POST', body: seriesInput(app, cookie) });
    assert.equal(cut.status, 409); assert.equal(cut.data.code, 'OUTCOME_UNKNOWN'); assert.equal(cut.data.credit.state, 'refunded');
    assert.equal(app.calls.length, before + 1, 'an unknown outcome never moves to the backup channel');

    before = app.calls.length;
    app.controls.respond = (call, response) => (call.json.stream ? streamPlan(response, '', { error: { message: 'model is overloaded', type: 'server_error', code: 'overloaded' } }) : reply(response, plan));
    const fallback = await app.api('/api/text', { cookie, method: 'POST', body: seriesInput(app, cookie) });
    assert.equal(fallback.status, 200); assert.equal(fallback.data.providerName, 'backup');
    assert.equal(app.calls.length, before + 2);
    assert.equal(app.calls.at(-1).json.stream, false, 'the backup channel keeps the plain JSON reply');

    // A relay that ignores stream:true and answers with JSON still works.
    app.controls.respond = (_call, response) => reply(response, plan);
    assert.equal((await app.api('/api/text', { cookie, method: 'POST', body: seriesInput(app, cookie) })).status, 200);
    assert.deepEqual(await balance(app, cookie), [999996, 0, 4]);
  } finally { await app.close(); }
});
