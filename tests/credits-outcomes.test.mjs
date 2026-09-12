import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { startHarness, until } from './server-harness.mjs';
import { PNG_BASE64, submission } from './fixtures.mjs';

const imageInput = (app, cookie, extra = {}) => ({ ...submission(randomUUID()), creditQuote: app.quote(cookie), ...extra });
const postImage = (app, cookie, body) => app.api('/api/jobs', { cookie, method: 'POST', body });
const completed = (app, cookie, id) => until(async () => {
  const job = (await app.api('/api/jobs/' + id, { cookie })).data;
  return ['succeeded', 'failed', 'interrupted', 'expired'].includes(job.status) && job;
}, 'image outcome');
async function checkBalance(app, cookie, expected) {
  const { credits } = (await app.api('/api/credits', { cookie })).data;
  assert.deepEqual([credits.available, credits.reserved, credits.spent], expected);
}
async function checkLedger(app, cookie, charge, expected) {
  const { entries } = (await app.api('/api/admin/access-codes/' + app.quote(cookie).accessCodeId + '/ledger', { cookie: app.adminCookie })).data;
  assert.deepEqual(entries.filter((entry) => entry.operationId === charge.id).map((entry) => entry.event).reverse(), expected);
}
const saveConfig = (app) => writeFile(path.join(app.directory, 'config/local.config.json'), JSON.stringify(app.config));
async function unusedUrl() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return url;
}
const sendJson = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); return true; };

test('网关超时或未知网关错误不换通道, 图片和文字保留一次预占', async (t) => {
  for (const status of [408, 504, 524, 502, 500]) await t.test('HTTP ' + status, async () => {
    const app = await startHarness();
    try {
      const cookie = await app.login();
      app.config.textProviders.push({ ...app.config.textProviders[0], id: 'backup', name: 'backup' }); await saveConfig(app);
      app.controls.respond = (_call, response) => {
        response.writeHead(status, { 'Content-Type': 'text/html' });
        response.end('<html>Gateway did not return a result</html>'); return true;
      };
      const input = imageInput(app, cookie), accepted = await postImage(app, cookie, input);
      const job = await completed(app, cookie, accepted.data.id);
      assert.equal(job.outcomeUnknown, true); assert.equal(job.credit.state, 'unknown');
      assert.equal(app.calls.length, 1);
      assert.equal((await postImage(app, cookie, input)).data.id, job.id);
      await checkLedger(app, cookie, job.credit, ['reserve', 'unknown']);
      const textInput = app.textInput(cookie);
      const text = await app.api('/api/text', { cookie, method: 'POST', body: textInput });
      assert.equal(text.data.code, 'OUTCOME_UNKNOWN'); assert.equal(text.data.credit.state, 'unknown');
      assert.equal((await app.api('/api/text', { cookie, method: 'POST', body: textInput })).data.credit.id, text.data.credit.id);
      assert.equal(app.calls.length, 2);
      await checkBalance(app, cookie, [999989, 11, 0]);
      await checkLedger(app, cookie, text.data.credit, ['reserve', 'unknown']);
    } finally { await app.close(); }
  });
});

test('明确连接失败可以换通道, 全部拒绝连接时返还图片和文字预占', async () => {
  const app = await startHarness();
  try {
    const cookie = await app.login(), unreachable = await unusedUrl();
    app.config.imageProviders[0].baseUrl = unreachable;
    app.config.textProviders.unshift({ ...app.config.textProviders[0], baseUrl: unreachable, id: 'offline', name: 'offline' });
    await saveConfig(app);
    const image = await completed(app, cookie, (await postImage(app, cookie, imageInput(app, cookie))).data.id);
    assert.equal(image.status, 'succeeded'); assert.equal(image.providerId, 'secondary');
    const text = await app.api('/api/text', { cookie, method: 'POST', body: app.textInput(cookie) });
    assert.equal(text.status, 200); assert.equal(text.data.credit.state, 'charged');
    assert.equal(app.calls.length, 2); await checkBalance(app, cookie, [999989, 0, 11]);
    app.config.imageProviders = [app.config.imageProviders[0]];
    app.config.textProviders = [app.config.textProviders[0]]; await saveConfig(app);
    const failed = await completed(app, cookie, (await postImage(app, cookie, imageInput(app, cookie))).data.id);
    assert.equal(failed.outcomeUnknown, false); assert.equal(failed.credit.state, 'refunded');
    const failedText = await app.api('/api/text', { cookie, method: 'POST', body: app.textInput(cookie) });
    assert.equal(failedText.data.credit.state, 'refunded');
    await checkLedger(app, cookie, failed.credit, ['reserve', 'refund']);
    await checkLedger(app, cookie, failedText.data.credit, ['reserve', 'refund']);
    await checkBalance(app, cookie, [999989, 0, 11]); assert.equal(app.calls.length, 2);
  } finally { await app.close(); }
});

test('上游明确拒绝返还点数, 安全切换通道成功时只扣一次', async () => {
  const app = await startHarness();
  try {
    const cookie = await app.login();
    for (const status of [400, 401, 403, 429, 500, 503]) {
      app.config.textProviders[0].id = 'text-' + status;
      await saveConfig(app);
      const callsBefore = app.calls.length;
      app.controls.respond = (_call, response) => sendJson(response, status, { error: { message: 'fixture rejected' } });
      const input = imageInput(app, cookie, { providerId: 'primary' });
      const image = await completed(app, cookie, (await postImage(app, cookie, input)).data.id);
      assert.equal(image.credit.state, 'refunded', 'image HTTP ' + status);
      const text = await app.api('/api/text', { cookie, method: 'POST', body: app.textInput(cookie) });
      assert.equal(text.data.credit.state, 'refunded', 'text HTTP ' + status);
      assert.equal(app.calls.length, callsBefore + 2);
      await checkBalance(app, cookie, [1000000, 0, 0]);
    }
    // Clear transient circuit history by restarting, while retaining the ledger.
    await app.stop(); await app.start();
    app.config.textProviders.push({ ...app.config.textProviders[0], id: 'backup', name: 'backup', baseUrl: app.config.textProviders[0].baseUrl + '/text-backup' });
    await saveConfig(app);
    const callsBefore = app.calls.length;
    app.controls.respond = (call, response) => {
      if (call.path.startsWith('/primary/') || call.path === '/v1/chat/completions') return sendJson(response, 429, { error: { code: 'rate_limit_exceeded', message: 'fixture capacity reached' } });
      return false;
    };
    const image = await completed(app, cookie, (await postImage(app, cookie, imageInput(app, cookie))).data.id);
    assert.equal(image.credit.state, 'charged'); assert.equal(image.providerId, 'secondary');
    const text = await app.api('/api/text', { cookie, method: 'POST', body: app.textInput(cookie) });
    assert.equal(text.status, 200); assert.equal(text.data.credit.state, 'charged');
    assert.equal(app.calls.length, callsBefore + 4);
    await checkBalance(app, cookie, [999989, 0, 11]);
    await checkLedger(app, cookie, image.credit, ['reserve', 'charge']);
    await checkLedger(app, cookie, text.data.credit, ['reserve', 'charge']);
  } finally { await app.close(); }
});

test('多图部分失败和排队取消按单张结算, 生成中的取消请求不返还', async () => {
  const app = await startHarness(); let release;
  try {
    const cookie = await app.login();
    const gate = new Promise((resolve) => { release = resolve; });
    app.controls.respond = async (call, response) => {
      await gate;
      if (call.json?.prompt === 'fixture rejected') return sendJson(response, 400, { error: { code: 'invalid_request_error', message: 'fixture rejected' } });
      return false;
    };
    const inputs = [0, 1, 2, 3].map(() => imageInput(app, cookie));
    inputs[1].request.prompt = 'fixture rejected';
    const accepted = await app.api('/api/jobs/batch', { cookie, method: 'POST', body: { jobs: inputs } });
    const jobs = accepted.data.jobs;
    await until(() => app.calls.length === 1, 'first image running');
    assert.equal((await app.api('/api/jobs/' + jobs[0].id, { cookie, method: 'DELETE' })).status, 409);
    await checkBalance(app, cookie, [999960, 40, 0]);
    assert.equal((await app.api('/api/jobs/' + jobs[2].id, { cookie, method: 'DELETE' })).status, 200);
    assert.equal((await app.api('/api/jobs/' + jobs[2].id, { cookie, method: 'DELETE' })).status, 400);
    await checkBalance(app, cookie, [999970, 30, 0]);
    release();
    const outcomes = await Promise.all([0, 1, 3].map((index) => completed(app, cookie, jobs[index].id)));
    assert.deepEqual(outcomes.map((value) => value.credit.state), ['charged', 'refunded', 'charged']);
    await checkBalance(app, cookie, [999980, 0, 20]); assert.equal(app.calls.length, 3);
    const canceled = (await app.api('/api/jobs/' + jobs[2].id, { cookie })).data;
    await checkLedger(app, cookie, canceled.credit, ['reserve', 'refund']);
    await checkLedger(app, cookie, outcomes[1].credit, ['reserve', 'refund']);
  } finally { release?.(); await app.close(); }
});

test('HTTP 200 错误正文和 Responses 终止事件按照实际结果结算', async (t) => {
  const cases = [
    { name: 'Images 明确错误', mode: 'images', body: { error: { code: 'content_policy_violation', message: 'fixture rejected' } }, state: 'refunded' },
    { name: 'Images 包装的超时', mode: 'images', body: { error: { code: 'upstream_timeout', message: 'upstream timed out' } }, state: 'unknown' },
    { name: 'Images 结果丢失', mode: 'images', body: { data: [] }, state: 'unknown' },
    { name: 'Responses JSON 失败', mode: 'responses', body: { status: 'failed', error: { code: 'server_error', message: 'fixture failed' } }, state: 'refunded' },
    { name: 'Responses 流式失败', mode: 'responses', events: [{ type: 'response.failed', response: { status: 'failed', error: { code: 'server_error', message: 'fixture failed' } } }], state: 'refunded' },
    { name: 'Responses 流式拒绝', mode: 'responses', events: [{ type: 'error', code: 'invalid_request_error', message: 'fixture rejected' }], state: 'refunded' },
    { name: 'Responses 输出上限终止', mode: 'responses', events: [{ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }], state: 'refunded' },
    { name: 'Responses 流式超时', mode: 'responses', events: [{ type: 'response.failed', response: { error: { code: 'upstream_timeout', message: 'upstream timed out' } } }], state: 'unknown' },
    { name: 'Responses 截断流', mode: 'responses', events: [{ type: 'response.created', response: { status: 'in_progress' } }], state: 'unknown' },
    { name: 'Responses 完整图片后返回失败事件', mode: 'responses', events: [{ type: 'response.output_item.done', item: { id: 'complete-image', type: 'image_generation_call', status: 'completed', result: PNG_BASE64 } }, { type: 'response.failed', response: { error: { code: 'server_error', message: 'later response failed' } } }], state: 'charged' },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const app = await startHarness({ imageMode: scenario.mode });
    try {
      const cookie = await app.login();
      app.controls.respond = (_call, response) => {
        if (!scenario.events) return sendJson(response, 200, scenario.body);
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end(scenario.events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join('')); return true;
      };
      const input = imageInput(app, cookie, { providerId: 'primary' });
      const job = await completed(app, cookie, (await postImage(app, cookie, input)).data.id);
      assert.equal(job.credit.state, scenario.state); assert.equal(job.outcomeUnknown, scenario.state === 'unknown');
      await postImage(app, cookie, input); assert.equal(app.calls.length, 1);
      await checkBalance(app, cookie, scenario.state === 'refunded' ? [1000000, 0, 0] : scenario.state === 'charged' ? [999990, 0, 10] : [999990, 10, 0]);
      await checkLedger(app, cookie, job.credit, ['reserve', { refunded: 'refund', charged: 'charge', unknown: 'unknown' }[scenario.state]]);
    } finally { await app.close(); }
  });
});

test('包装在成功 HTTP 响应中的文字超时不会自动换通道或退款', async () => {
  const app = await startHarness();
  try {
    const cookie = await app.login();
    app.config.textProviders.push({ ...app.config.textProviders[0], id: 'backup', name: 'backup' }); await saveConfig(app);
    app.controls.respond = (_call, response) => sendJson(response, 200, { error: { code: 'upstream_timeout', message: 'upstream timed out' } });
    const text = await app.api('/api/text', { cookie, method: 'POST', body: app.textInput(cookie) });
    assert.equal(text.data.code, 'OUTCOME_UNKNOWN'); assert.equal(app.calls.length, 1);
    await checkBalance(app, cookie, [999999, 1, 0]);
  } finally { await app.close(); }
});

test('系列拆解先校验数量和完整分镜, 无效文字返还且成功只扣一次', async () => {
  const app = await startHarness();
  try {
    const cookie = await app.login();
    const scene = { title: '第一幕', prompt: '小狐狸在林间寻找新长出的叶子' };
    for (const output of ['not json', JSON.stringify([scene]), JSON.stringify([scene, scene, scene, { title: '', prompt: '' }])]) {
      app.controls.respond = (_call, response) => sendJson(response, 200, { choices: [{ message: { content: output } }] });
      const input = { ...app.textInput(cookie), kind: 'series', sceneCount: 4 };
      const callsBefore = app.calls.length;
      const failure = await app.api('/api/text', { cookie, method: 'POST', body: input });
      assert.equal(failure.status, 502); assert.equal(failure.data.credit.state, 'refunded');
      assert.equal((await app.api('/api/text', { cookie, method: 'POST', body: input })).data.credit.id, failure.data.credit.id);
      assert.equal(app.calls.length, callsBefore + 1);
      await checkBalance(app, cookie, [1000000, 0, 0]);
      await checkLedger(app, cookie, failure.data.credit, ['reserve', 'refund']);
    }
    await app.stop(); await app.start();
    const valid = Array.from({ length: 4 }, (_, index) => ({ title: '第 ' + (index + 1) + ' 幕', prompt: scene.prompt }));
    app.controls.respond = (_call, response) => sendJson(response, 200, { choices: [{ message: { content: JSON.stringify(valid) } }] });
    const input = { ...app.textInput(cookie), kind: 'series', sceneCount: 4 };
    const success = await app.api('/api/text', { cookie, method: 'POST', body: input });
    assert.equal(success.status, 200); assert.equal(success.data.credit.state, 'charged');
    assert.deepEqual(JSON.parse(success.data.text), valid);
    assert.equal((await app.api('/api/text', { cookie, method: 'POST', body: { ...input, sceneCount: 5 } })).status, 409);
    assert.equal((await app.api('/api/text/' + input.requestId, { cookie })).data.text, success.data.text);
    await checkBalance(app, cookie, [999999, 0, 1]); assert.equal(app.calls.length, 4);
    for (const sceneCount of [undefined, 2, 9]) {
      assert.equal((await app.api('/api/text', { cookie, method: 'POST', body: { ...app.textInput(cookie), kind: 'series', sceneCount } })).status, 400);
    }
    assert.equal((await app.api('/api/text', { cookie, method: 'POST', body: { ...app.textInput(cookie), sceneCount: 4 } })).status, 400);
    assert.equal(app.calls.length, 4); await checkBalance(app, cookie, [999999, 0, 1]);
  } finally { await app.close(); }
});

test('JPEG 截断与连接中途断开不扣成功点数, 不重新调用', async (t) => {
  const photo = await readFile(new URL('../public/assets/stitch/studio-01.jpg', import.meta.url));
  for (const mode of ['truncated-jpeg', 'reset']) await t.test(mode, async () => {
    const app = await startHarness();
    try {
      const cookie = await app.login();
      app.controls.respond = (_call, response) => {
        if (mode === 'reset') { response.destroy(); return true; }
        return sendJson(response, 200, { data: [{ b64_json: photo.subarray(0, Math.floor(photo.length / 2)).toString('base64') }] });
      };
      const job = await completed(app, cookie, (await postImage(app, cookie, imageInput(app, cookie))).data.id);
      assert.equal(job.credit.state, 'unknown'); assert.equal(app.calls.length, 1);
      await checkBalance(app, cookie, [999990, 10, 0]);
    } finally { await app.close(); }
  });
});

test('首镜明确失败或结果未知时, 尚未执行的后续分镜全部返还', async (t) => {
  for (const state of ['refunded', 'unknown']) await t.test(state, async () => {
    const app = await startHarness();
    try {
      const cookie = await app.login();
      app.controls.respond = (_call, response) => sendJson(response, state === 'unknown' ? 504 : 400, { error: { message: state === 'unknown' ? 'gateway timeout' : 'content_policy_violation' } });
      const first = imageInput(app, cookie), rest = [1, 2, 3].map(() => imageInput(app, cookie, { referenceJobId: first.requestId }));
      const accepted = await app.api('/api/jobs/batch', { cookie, method: 'POST', body: { jobs: [first, ...rest] } });
      assert.equal(accepted.status, 202);
      const jobs = await Promise.all(accepted.data.jobs.map((job) => completed(app, cookie, job.id)));
      assert.deepEqual(jobs.map((job) => job.credit.state), [state, 'refunded', 'refunded', 'refunded']);
      assert.equal(app.calls.length, 1);
      await checkBalance(app, cookie, state === 'unknown' ? [999990, 10, 0] : [1000000, 0, 0]);
      for (const job of jobs.slice(1)) await checkLedger(app, cookie, job.credit, ['reserve', 'refund']);
    } finally { await app.close(); }
  });
});

test('浏览器断开后优雅重启仍等待文字完成并只结算一次', async () => {
  const app = await startHarness(); let release, db;
  try {
    const cookie = await app.login();
    const gate = new Promise((resolve) => { release = resolve; });
    app.controls.respond = async () => { await gate; return false; };
    const input = app.textInput(cookie), abort = new AbortController();
    const lost = fetch(app.base + '/api/text', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: abort.signal }).catch(() => null);
    await until(() => app.calls.length === 1, 'text in flight'); abort.abort(); await lost;
    let stopped = false;
    const closing = app.stop().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const stoppedBeforeCompletion = stopped;
    release(); await closing;
    assert.equal(stoppedBeforeCompletion, false, 'shutdown must retain detached text work');
    db = new DatabaseSync(path.join(app.directory, 'data/runtime.sqlite'));
    assert.equal(db.prepare('SELECT state FROM credit_operations WHERE request_id=?').get(input.requestId).state, 'charged');
    db.close(); db = null; await app.start();
    const replay = await app.api('/api/text/' + input.requestId, { cookie });
    assert.equal(replay.status, 200); assert.equal(replay.data.credit.state, 'charged');
    await checkBalance(app, cookie, [999999, 0, 1]); assert.equal(app.calls.length, 1);
    await checkLedger(app, cookie, replay.data.credit, ['reserve', 'charge']);
  } finally { release?.(); db?.close(); await app.close(); }
});

test('无浏览器连接时关闭服务仍等待图片与文字的延迟落账', async () => {
  const app = await startHarness(); let db;
  try {
    const cookie = await app.login();
    db = new DatabaseSync(path.join(app.directory, 'data/runtime.sqlite'));
    db.exec("CREATE TRIGGER delay_charge BEFORE UPDATE ON credit_operations WHEN NEW.state='charged' BEGIN SELECT RAISE(ABORT, 'isolated write failure'); END");
    const image = await completed(app, cookie, (await postImage(app, cookie, imageInput(app, cookie))).data.id);
    const textInput = app.textInput(cookie);
    const text = await app.api('/api/text', { cookie, method: 'POST', body: textInput });
    assert.equal(image.settlementPending, true); assert.equal(text.data.settlementPending, true);
    let stopped = false;
    const closing = app.stop('SIGTERM', 10000).then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const stoppedBeforeRecovery = stopped;
    db.exec('DROP TRIGGER delay_charge');
    await closing;
    assert.equal(stoppedBeforeRecovery, false, 'pending settlements must keep the process alive');
    assert.deepEqual(db.prepare('SELECT state FROM credit_operations ORDER BY id').all().map((row) => row.state), ['charged', 'charged']);
    db.close(); db = null; await app.start();
    await checkBalance(app, cookie, [999989, 0, 11]); assert.equal(app.calls.length, 2);
    assert.equal((await app.api('/api/text/' + textInput.requestId, { cookie })).data.credit.state, 'charged');
  } finally { db?.close(); await app.close(); }
});
