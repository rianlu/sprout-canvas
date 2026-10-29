import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStateStore } from '../server/state-store.mjs';
import { formatUpstreamFailure, upstreamFailure, upstreamFailureDetail } from '../server/upstream-outcome.mjs';
import { PNG_BASE64, submission } from './fixtures.mjs';

const MINUTE = 60_000;
const capabilities = { outputFormats: ['png'], transparent: true, customSizes: false };
const providers = ['one', 'two'].map((id) => ({ id, name: id, modelName: 'A', baseUrl: `https://${id}.invalid`, apiKey: `key-${id}-secret`, imageModel: 'gpt-image-2', generationMode: 'images', capabilities }));
const GATEWAY_TIMEOUT = '<!DOCTYPE html><html><head><title>relay.example.com | 524: A timeout occurred</title></head><body>Cloudflare Ray ID 8.8.8.8</body></html>';
const html = (status, body) => new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
const jsonError = (status, message, code = '') => new Response(JSON.stringify({ error: { message, code } }), { status, headers: { 'Content-Type': 'application/json' } });
const image = () => new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), { headers: { 'Content-Type': 'application/json' } });

// Fresh module state per test, with a clock the test can move forward past cooldowns.
async function fixture(t, list = providers) {
  const queue = await import('../server/queue.mjs?circuit=' + randomUUID());
  const store = createStateStore(':memory:');
  const access = store.credits.create({ requestId: randomUUID(), initialPoints: 1000, note: '熔断测试' }).codes[0];
  const realNow = Date.now.bind(Date);
  let offset = 0;
  t.mock.method(Date, 'now', () => realNow() + offset);
  const logs = [];
  const f = { queue, store, access, logs, respond: () => image(), advance(ms) { offset += ms; } };
  t.mock.method(globalThis, 'fetch', async (url) => f.respond(new URL(url).hostname.split('.')[0]));
  const config = (id = 'one') => ({ ...list.find((provider) => provider.id === id), providers: list, imageProviders: list });
  queue.init({ readLocalConfig: async (id) => config(id || 'one'), upstreamHeaders: () => ({}), timeoutSignal: () => undefined, stripHtml: String, logLine: (level, line) => logs.push(line) });
  queue.initializePersistence(store);
  t.after(async () => { await queue.stopWorker(); store.close(); });
  f.choose = (excludeId = '', modelName = '') => queue.chooseImageProvider(queue.modelScope(config(), modelName), '/v1/images/generations', 'application/json', excludeId, Buffer.from(JSON.stringify({ prompt: 'p', n: 1, size: '1024x1024', output_format: 'png' }))).id;
  f.health = (id) => queue.providerHealth(list).find((item) => item.id === id);
  f.cooldownMinutes = (id) => Math.round((f.health(id).openUntil - Date.now()) / MINUTE);
  // Pinning a channel mirrors a local edit, which always returns to its original channel; a model name scopes automatic routing.
  f.submit = (pinned = '', modelName = '') => {
    const session = { userId: 'u', accessCodeId: access.id, codeEpoch: 1 };
    const input = { ...submission(randomUUID()), creditQuote: { accessCodeId: access.id, userId: 'u', version: 1 }, ...(pinned ? { providerId: pinned } : {}), ...(modelName ? { modelName } : {}) };
    const selected = list.find((provider) => provider.id === (pinned || f.choose('', modelName)));
    return queue.submitGeneration(input, 'u', selected, session).id;
  };
  f.wait = async (id) => {
    for (let i = 0; i < 500; i++) {
      const job = queue.getJobStatus(id, 'u');
      if (['succeeded', 'failed'].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('job did not finish');
  };
  f.run = (pinned = '', modelName = '') => f.wait(f.submit(pinned, modelName));
  return f;
}

test('网关超时 1 次即冷却, 很快返回的 502 连续 3 次才冷却, 失败原因不含中转域名或错误页', async (t) => {
  const f = await fixture(t);
  f.respond = (host) => host === 'one' ? html(524, GATEWAY_TIMEOUT) : image();
  const timedOut = await f.run();
  assert.equal(timedOut.providerId, 'one'); assert.equal(timedOut.status, 'failed'); assert.equal(timedOut.outcomeUnknown, true);
  assert.equal(timedOut.error, '生图服务响应超时 (HTTP 524). 结果未知, 本次不扣点, 未自动重复调用.');
  assert.equal(f.health('one').status, 'cooldown'); assert.equal(f.cooldownMinutes('one'), 30);
  assert.equal(f.choose(), 'two');
  assert.ok(f.logs.some((line) => line.includes('[image-job] failed') && line.includes('relay.example.com | 524: A timeout occurred')), 'the server log keeps the raw gateway page text');

  f.respond = (host) => host === 'two' ? jsonError(502, 'upstream error: do request failed: Post "https://relay.example.com/v1/images/generations": EOF from 10.2.3.4:443') : image();
  for (let i = 1; i <= 3; i++) {
    const failed = await f.run();
    assert.equal(failed.providerId, 'two'); assert.equal(failed.outcomeUnknown, true);
    assert.doesNotMatch(failed.error, /relay\.example\.com|https?:|10\.2\.3\.4|key-two/);
    assert.match(failed.error, /^生图服务网关错误 \(HTTP 502\): upstream error/);
    // A quick 5xx often recovers on the next job, and the other channel is cooling down, so it stays in service.
    assert.equal(f.health('two').status, 'degraded', 'quick 502 number ' + i);
  }
  assert.ok(f.logs.some((line) => line.includes('circuit-kept provider=two')), 'the last usable channel is kept in service');
  // A manual retry normally avoids the channel it tried; with the other channel cooling down it returns there instead of refusing.
  assert.equal(f.choose('two'), 'two');
  f.advance(31 * MINUTE);
  assert.equal(f.choose('two'), 'one');
});

test('很快返回的 502 需连续 3 次, 耗时 90 秒以上的失败 1 次即冷却', async (t) => {
  const f = await fixture(t);
  f.respond = () => jsonError(502, 'bad response from upstream');
  for (let i = 0; i < 2; i++) await f.run('one');
  assert.equal(f.health('one').status, 'degraded'); assert.equal(f.choose(), 'one');
  await f.run('one');
  assert.equal(f.health('one').status, 'cooldown'); assert.equal(f.choose(), 'two');

  f.respond = () => { f.advance(95_000); return jsonError(502, 'bad response from upstream'); };
  const slow = await f.run('two');
  assert.equal(slow.status, 'failed');
  // "one" is cooling down, so the slow failure on "two" is logged but cannot remove the last channel.
  assert.equal(f.health('two').status, 'degraded');
  f.advance(31 * MINUTE);
  await f.run('two');
  assert.equal(f.health('two').status, 'cooldown');
  assert.ok(f.logs.some((line) => /circuit-open provider=two failures=2 trips=1 slow=true/.test(line)));
});

test('冷却到期后放行 1 个试探任务, 失败依次冷却 60 和 120 分钟并封顶, 成功后完全恢复', async (t) => {
  const f = await fixture(t);
  f.respond = (host) => host === 'one' ? html(524, GATEWAY_TIMEOUT) : image();
  await f.run();
  assert.equal(f.cooldownMinutes('one'), 30);
  // Even a quick failure on the trial job reopens the channel, each time for longer.
  f.respond = (host) => host === 'one' ? jsonError(502, 'bad response from upstream') : image();
  for (const minutes of [60, 120, 120]) {
    f.advance(f.health('one').openUntil - Date.now() + 1000);
    assert.equal(f.choose(), 'one', 'the cooled channel gets the next job as its trial');
    const trial = await f.run();
    assert.equal(trial.providerId, 'one'); assert.equal(trial.status, 'failed');
    assert.equal(f.health('one').status, 'cooldown'); assert.equal(f.cooldownMinutes('one'), minutes);
  }
  f.advance(121 * MINUTE);
  f.respond = () => image();
  assert.equal((await f.run()).status, 'succeeded');
  assert.equal(f.health('one').status, 'available');
  // After a success a single quick 502 no longer counts as a failed trial.
  f.respond = (host) => host === 'one' ? jsonError(502, 'bad response from upstream') : image();
  await f.run('one');
  assert.equal(f.health('one').status, 'degraded');
  assert.equal(f.choose(), 'one');
});

test('冷却期间固定原通道的局部重绘失败不延长冷却, 审核与参数拒绝不计入熔断', async (t) => {
  const f = await fixture(t);
  f.respond = () => html(524, GATEWAY_TIMEOUT);
  await f.run('one');
  const openUntil = f.health('one').openUntil;
  f.advance(10 * MINUTE);
  for (let i = 0; i < 3; i++) assert.equal((await f.run('one')).status, 'failed');
  assert.equal(f.health('one').openUntil, openUntil);

  f.respond = () => jsonError(400, 'AI 审核未通过, 违反内容政策', 'content_policy_violation');
  for (let i = 0; i < 4; i++) {
    const rejected = await f.run('two');
    assert.equal(rejected.outcomeUnknown, false);
    assert.match(rejected.error, /^生图服务拒绝了请求 \(HTTP 400\): AI 审核未通过/);
  }
  assert.equal(f.health('two').status, 'untested'); assert.equal(f.health('two').failures, 0);
});

test('连接失败的异常信息不向用户显示中转 IP 或主机名', async (t) => {
  const f = await fixture(t);
  f.respond = () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 10.9.8.7:443 (one.invalid)'), { code: 'ECONNREFUSED' }) }); };
  const failed = await f.run('one');
  assert.equal(failed.status, 'failed'); assert.equal(failed.outcomeUnknown, false);
  assert.match(failed.error, /^上游请求异常: fetch failed \| ECONNREFUSED/);
  assert.doesNotMatch(failed.error, /10\.9\.8\.7|one\.invalid/);
  assert.ok(f.logs.some((line) => line.includes('10.9.8.7:443')), 'the server log keeps the address');
});

test('文字通道的上游失败使用文字服务说法, 日志细节保留原文', () => {
  const config = { baseUrl: 'https://text.relay.example', apiKey: 'sk-text-secret' };
  const timeout = upstreamFailure(504, Buffer.from(GATEWAY_TIMEOUT));
  assert.equal(formatUpstreamFailure(timeout, config, '文字服务'), '文字服务响应超时 (HTTP 504). 结果未知, 本次不扣点, 未自动重复调用.');
  const embedded = upstreamFailure(200, Buffer.from(JSON.stringify({ type: 'error', error: { message: 'failed at text.relay.example with sk-text-secret' } })));
  assert.equal(formatUpstreamFailure(embedded, config, '文字服务'), '文字服务返回生成错误: failed at 上游服务 with [redacted]');
  assert.equal(upstreamFailureDetail(embedded, config), 'HTTP 200: failed at text.relay.example with [redacted]');
});

test('很快返回的 ETIMEDOUT 按普通失败连续 3 次才冷却, 不因错误名含 timeout 而 1 次停用', async (t) => {
  const f = await fixture(t);
  f.respond = () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ETIMEDOUT 10.9.8.7:443'), { code: 'ETIMEDOUT' }) }); };
  for (let i = 1; i <= 2; i++) {
    const failed = await f.run('one');
    assert.equal(failed.outcomeUnknown, true, 'a timed-out socket may have sent the request');
    assert.equal(f.health('one').status, 'degraded', 'quick ETIMEDOUT number ' + i);
  }
  await f.run('one');
  assert.equal(f.health('one').status, 'cooldown');
  assert.ok(f.logs.some((line) => /circuit-open provider=one failures=3 trips=1 slow=false/.test(line)));
});

test('所选模型的通道在排队期间冷却后, 后续任务说明模型暂不可用并返还点数, 不调用上游', async (t) => {
  const three = { ...providers[0], id: 'three', name: 'three', modelName: 'B', baseUrl: 'https://three.invalid' };
  const f = await fixture(t, [...providers, three]);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  f.respond = async (host) => { calls.push(host); await gate; return html(524, GATEWAY_TIMEOUT); };
  const ids = [f.submit('', 'B'), f.submit('', 'B'), f.submit('', 'B')];
  release();
  const [first, ...queued] = await Promise.all(ids.map((id) => f.wait(id)));
  assert.equal(first.outcomeUnknown, true);
  assert.equal(f.health('three').status, 'cooldown');
  for (const job of queued) {
    assert.equal(job.status, 'failed'); assert.equal(job.outcomeUnknown, false);
    assert.equal(job.error, '所选模型暂时不可用, 已返还点数, 请稍后重试或切换为自动');
  }
  assert.deepEqual(calls, ['three'], 'queued jobs never reach the cooled channel');
  const balance = f.store.credits.balance(f.access.id);
  assert.deepEqual([balance.available, balance.reserved, balance.spent], [1000, 0, 0]);
});
