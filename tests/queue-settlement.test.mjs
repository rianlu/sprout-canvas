import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStateStore } from '../server/state-store.mjs';
import { isDefiniteConnectionFailure } from '../server/upstream-outcome.mjs';
import { PNG as PNG_BYTES, PNG_BASE64, PNG_URL, MASK_URL, submission } from './fixtures.mjs';
import { until } from './server-harness.mjs';

async function fixture(t, { fakeTimers = false, timeout = false, respond, limits = {} } = {}) {
  const queue = await import('../server/queue.mjs?settlement=' + randomUUID());
  const store = createStateStore(':memory:');
  const access = store.credits.create({ requestId: randomUUID(), initialPoints: 100, note: '结算测试' }).codes[0];
  const session = { userId: randomUUID(), accessCodeId: access.id, codeEpoch: 1 };
  const provider = { id: 'fixture', name: 'fixture', baseUrl: 'https://fixture.invalid', apiKey: 'fixture-key', imageModel: 'gpt-image-2', generationMode: 'images' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url);
    if (respond) return await respond(url, options);
    if (timeout) return await new Promise((_, reject) => { options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); });
    return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), { headers: { 'Content-Type': 'application/json' } });
  });
  if (fakeTimers) t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  queue.init({
    readLocalConfig: async () => ({ ...provider, providers: [provider, { ...provider, id: 'backup' }] }),
    upstreamHeaders: () => ({}), timeoutSignal: () => timeout ? AbortSignal.timeout(25) : undefined,
    logLine: () => {}, JOB_TTL_MS: 1000, ...limits,
  });
  queue.initializePersistence(store);
  const input = { ...submission(randomUUID()), creditQuote: { accessCodeId: access.id, userId: session.userId, version: 1 } };
  t.after(async () => { await queue.stopWorker(); store.close(); });
  const start = () => queue.submitGeneration(input, session.userId, provider, session);
  return { queue, store, access, session, input, start, calls };
}
async function drainMicrotasks(check) {
  for (let index = 0; index < 30; index++) {
    const value = check(); if (value) return value;
    await new Promise(setImmediate);
  }
  throw new Error('Work did not complete');
}

test('只有确定尚未建立连接的错误可以当作未执行, 混合错误按结果未知处理', () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']) {
    assert.equal(isDefiniteConnectionFailure(new TypeError('fetch failed', { cause: Object.assign(new Error(), { code }) })), true, code);
  }
  for (const code of ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']) {
    assert.equal(isDefiniteConnectionFailure(Object.assign(new Error(), { code })), false, code);
  }
  assert.equal(isDefiniteConnectionFailure(new AggregateError([{ code: 'ECONNREFUSED' }, { code: 'ENETUNREACH' }])), true);
  assert.equal(isDefiniteConnectionFailure(new AggregateError([{ code: 'ECONNREFUSED' }, { code: 'ECONNRESET' }])), false);
});

test('图片过期及历史清理遇到存储失败不会退出, 恢复后不多扣或退款', async (t) => {
  const f = await fixture(t, { fakeTimers: true });
  let rejectExpiry = false, rejectDelete = true, removalAttempts = 0;
  const save = f.store.saveJob.bind(f.store), remove = f.store.deleteJob.bind(f.store);
  t.mock.method(f.store, 'saveJob', (job) => {
    if (rejectExpiry && job.status === 'expired') throw new Error('isolated expiry write failure');
    save(job);
  });
  t.mock.method(f.store, 'deleteJob', (id) => {
    removalAttempts++;
    if (rejectDelete) throw new Error('isolated cleanup write failure');
    remove(id);
  });
  const accepted = f.start();
  await drainMicrotasks(() => f.queue.getJobStatus(accepted.id, f.session.userId).status === 'succeeded');
  const balance = () => {
    const value = f.store.credits.balance(f.access.id);
    return [value.available, value.reserved, value.spent];
  };
  assert.deepEqual(balance(), [90, 0, 10]);
  rejectExpiry = true;
  t.mock.timers.tick(1000);
  const expired = f.queue.getJobStatus(accepted.id, f.session.userId);
  assert.equal(expired.status, 'expired'); assert.equal(expired.settlementPending, true);
  assert.equal(f.queue.getJobResult(accepted.id, f.session.userId).status, 410);
  assert.equal(f.store.loadJobs()[0].status, 'succeeded');
  assert.deepEqual(balance(), [90, 0, 10]);
  rejectExpiry = false;
  t.mock.timers.tick(5000);
  assert.equal(f.store.loadJobs()[0].status, 'expired');
  assert.equal(f.queue.getJobStatus(accepted.id, f.session.userId).settlementPending, false);
  t.mock.timers.tick(7 * 86400000);
  assert.ok(removalAttempts > 0);
  assert.equal(f.store.loadJobs().length, 1);
  assert.ok(f.queue.getJobStatus(accepted.id, f.session.userId));
  rejectDelete = false;
  t.mock.timers.tick(5000);
  assert.equal(f.store.loadJobs().length, 0);
  assert.equal(f.queue.getJobStatus(accepted.id, f.session.userId), null);
  assert.deepEqual(balance(), [90, 0, 10]); assert.equal(f.calls.length, 1);
  assert.equal(f.store.credits.byRequest(f.session.userId, f.input.requestId).state, 'charged');
  assert.deepEqual(f.store.credits.ledger(f.access.id).entries.map((entry) => entry.event).reverse(), ['create', 'reserve', 'charge']);
});

test('优雅关闭等待图片结算写入恢复, 不重复调用生成接口', async (t) => {
  const f = await fixture(t, { fakeTimers: true });
  const save = f.store.saveJob.bind(f.store); let failSettlement = true;
  t.mock.method(f.store, 'saveJob', (job) => {
    if (failSettlement && job.status === 'succeeded') throw new Error('isolated settlement failure');
    save(job);
  });
  const accepted = f.start();
  await drainMicrotasks(() => f.queue.getJobStatus(accepted.id, f.session.userId).settlementPending);
  let stopped = false;
  const closing = f.queue.stopWorker().then(() => { stopped = true; });
  await new Promise(setImmediate); assert.equal(stopped, false);
  failSettlement = false; t.mock.timers.tick(5000); await closing;
  assert.equal(f.store.credits.byRequest(f.session.userId, f.input.requestId).state, 'charged');
  assert.equal(f.calls.length, 1);
});

test('图片请求本机等待超时自动返还, 不自动调用备用通道', async (t) => {
  const f = await fixture(t, { timeout: true });
  const accepted = f.start();
  const job = await until(() => {
    const value = f.queue.getJobStatus(accepted.id, f.session.userId);
    return value.status === 'failed' && value;
  }, 'image timeout');
  assert.equal(job.outcomeUnknown, true); assert.equal(job.credit.state, 'refunded');
  assert.equal(f.calls.length, 1);
  const balance = f.store.credits.balance(f.access.id);
  assert.deepEqual([balance.available, balance.reserved, balance.spent], [100, 0, 0]);
});

const rejection = (message) => new Response(JSON.stringify({ error: { message } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
const failedJob = (f, id, userId) => until(() => { const value = f.queue.getJobStatus(id, userId); return value?.status === 'failed' && value; }, 'failed ' + id);

test('单个浏览器不能占满全站待处理图片预算, 失败任务立即释放参考素材', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const probe = { ...submission(randomUUID(), { prompt: 'x'.repeat(4000) }), creditQuote: { accessCodeId: '', userId: randomUUID(), version: 1 } };
  const size = Buffer.byteLength(JSON.stringify(probe));
  const f = await fixture(t, { respond: async () => { await gate; return rejection('content_policy_violation'); }, limits: { MAX_USER_RETAINED_BYTES: Math.floor(size * 2.5), MAX_RETAINED_BYTES: size * 10 } });
  const other = { ...f.session, userId: randomUUID() };
  const submit = (session) => f.queue.submitGeneration({ ...submission(randomUUID(), { prompt: 'x'.repeat(4000) }), creditQuote: { accessCodeId: f.access.id, userId: session.userId, version: 1 } }, session.userId, { id: 'fixture', name: 'fixture' }, session);
  const first = submit(f.session), second = submit(f.session);
  try {
    assert.throws(() => submit(f.session), { statusCode: 429 }, 'one browser stops at its share of the budget');
    const neighbour = submit(other);
    release();
    for (const [job, session] of [[first, f.session], [second, f.session], [neighbour, other]]) assert.equal((await failedJob(f, job.id, session.userId)).credit.state, 'refunded');
    // Failed work keeps no images in memory, so the same browser can submit again before the result TTL.
    submit(f.session); submit(f.session);
    assert.equal(f.store.credits.balance(f.access.id).available, 80);
  } finally { release(); }
});

/** A valid PNG padded with an ancillary chunk, so budgets can be exercised with realistic sizes. */
function bulky(bytes) {
  const pad = Buffer.alloc(bytes, 7);
  const header = Buffer.alloc(4); header.writeUInt32BE(pad.length);
  const iend = PNG_BYTES.length - 12;
  return Buffer.concat([PNG_BYTES.subarray(0, iend), header, Buffer.from('teXt'), pad, Buffer.alloc(4), PNG_BYTES.subarray(iend)]);
}
const imageResponse = (bytes) => new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), { headers: { 'Content-Type': 'application/json' } });
const promptOf = (options) => JSON.parse(options.body).prompt;
const statusOf = (f, job, userId) => f.queue.getJobStatus(job.id, userId).status;

test('一个浏览器未领取的结果超过个人份额时, worker 改为执行其他人的任务', async (t) => {
  const result = bulky(20_000);
  const f = await fixture(t, { respond: async () => imageResponse(result), limits: { JOB_TTL_MS: 60 * 60 * 1000, MAX_USER_RETAINED_BYTES: 40_000, MAX_RETAINED_BYTES: 1_000_000 } });
  const other = { ...f.session, userId: randomUUID() };
  const submit = (session, prompt) => f.queue.submitGeneration({ ...submission(randomUUID(), { prompt }), creditQuote: { accessCodeId: f.access.id, userId: session.userId, version: 1 } }, session.userId, { id: 'fixture', name: 'fixture' }, session);
  const own = ['A1', 'A2', 'A3', 'A4'].map((prompt) => submit(f.session, prompt));
  await until(() => own.slice(0, 2).every((job) => statusOf(f, job, f.session.userId) === 'succeeded'), 'two unclaimed results');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(f.calls.length, 2, 'two unclaimed results exceed this browser share, so its third task waits');
  assert.equal(statusOf(f, own[2], f.session.userId), 'pending');
  const neighbour = submit(other, 'B1');
  await until(() => statusOf(f, neighbour, other.userId) === 'succeeded', 'another browser is still served');
  f.queue.acknowledge(own[0].id, f.session.userId);
  await until(() => statusOf(f, own[2], f.session.userId) === 'succeeded', 'claiming a result frees the share');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(statusOf(f, own[3], f.session.userId), 'pending');
});

test('取消排队任务释放预算后立即唤醒 worker', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const result = bulky(20_000);
  const f = await fixture(t, {
    respond: async (_url, options) => { if (promptOf(options) === 'A1') await gate; return imageResponse(result); },
    limits: { JOB_TTL_MS: 60 * 60 * 1000, MAX_USER_RETAINED_BYTES: 1_000_000, MAX_RETAINED_BYTES: 50_000 },
  });
  const other = { ...f.session, userId: randomUUID() };
  const reference = { id: 'big-ref', name: 'big.png', dataUrl: `data:image/png;base64,${bulky(20_000).toString('base64')}` };
  const submit = (session, prompt, request = {}) => f.queue.submitGeneration({ ...submission(randomUUID(), { prompt, ...request }), creditQuote: { accessCodeId: f.access.id, userId: session.userId, version: 1 } }, session.userId, { id: 'fixture', name: 'fixture' }, session);
  try {
    const first = submit(f.session, 'A1');
    await until(() => f.calls.length === 1, 'A1 holds the worker');
    const large = submit(f.session, 'P', { references: [reference] });
    const waiting = submit(other, 'C1');
    release();
    await until(() => statusOf(f, first, f.session.userId) === 'succeeded', 'A1 result retained');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(statusOf(f, waiting, other.userId), 'pending', 'the site budget is full');
    assert.equal(f.queue.cancel(large.id, f.session.userId).ok, true);
    await until(() => statusOf(f, waiting, other.userId) === 'succeeded', 'cancel wakes the worker');
  } finally { release(); }
});

test('首镜已失败时后续分镜在受理时拒绝, 不预占点数', async (t) => {
  const f = await fixture(t, { respond: async () => rejection('content_policy_violation') });
  const anchor = f.start();
  await failedJob(f, anchor.id, f.session.userId);
  const before = f.store.credits.balance(f.access.id);
  const later = { ...submission(randomUUID()), creditQuote: f.input.creditQuote, referenceJobId: anchor.id, clientContext: { ...f.input.clientContext, kind: 'series', seriesId: 's', sceneId: 'scene-2', sceneIndex: 1, placeholderId: 'art-later' } };
  assert.throws(() => f.queue.submitGeneration(later, f.session.userId, { id: 'fixture', name: 'fixture' }, f.session), { statusCode: 409, message: /首镜/ });
  assert.deepEqual(f.store.credits.balance(f.access.id), before);
  assert.equal(f.calls.length, 1);
});

test('局部重绘只用提交时的通道, 明确过载也不切换备用通道', async (t) => {
  const overloaded = () => new Response(JSON.stringify({ error: { message: 'fixture overloaded' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const f = await fixture(t, { respond: async () => overloaded() });
  const plain = f.start();
  await failedJob(f, plain.id, f.session.userId);
  assert.equal(f.calls.length, 2, 'an ordinary request may switch to the backup channel');
  const edit = { ...submission(randomUUID(), { references: [{ id: 'source', name: 'source.png', dataUrl: PNG_URL }], mask: MASK_URL }), creditQuote: f.input.creditQuote };
  const job = f.queue.submitGeneration(edit, f.session.userId, { id: 'fixture', name: 'fixture' }, f.session);
  const failed = await failedJob(f, job.id, f.session.userId);
  assert.equal(failed.providerId, 'fixture');
  assert.equal(f.calls.length, 3, 'a mask edit stays on its channel');
});

test('关闭服务时不再切换备用通道, 明确拒绝按失败返还', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = await fixture(t, { respond: async () => { await gate; return new Response(JSON.stringify({ error: { message: 'fixture capacity reached' } }), { status: 429, headers: { 'Content-Type': 'application/json' } }); } });
  const accepted = f.start();
  await until(() => f.calls.length === 1, 'first provider attempt');
  const closing = f.queue.stopWorker();
  release(); await closing;
  const job = f.queue.getJobStatus(accepted.id, f.session.userId);
  assert.equal(job.status, 'failed'); assert.equal(job.outcomeUnknown, false); assert.equal(job.credit.state, 'refunded');
  assert.equal(f.calls.length, 1, 'the backup provider is not called after shutdown starts');
});

test('上游错误回显图片数据时脱敏保存, 不进入无限重试', async (t) => {
  const f = await fixture(t, { respond: async () => rejection(`rejected data:image/png;base64,${PNG_BASE64}`) });
  const job = await failedJob(f, f.start().id, f.session.userId);
  assert.equal(job.settlementPending, false);
  assert.match(job.error, /\[图片数据已省略\]/); assert.doesNotMatch(job.error, /base64,/);
  assert.equal(job.credit.state, 'refunded');
});
