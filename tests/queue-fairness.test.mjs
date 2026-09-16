import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStateStore } from '../server/state-store.mjs';
import { PNG_BASE64, submission } from './fixtures.mjs';
import { until } from './server-harness.mjs';

async function fixture(t) {
  const queue = await import('../server/queue.mjs?fairness=' + randomUUID());
  const store = createStateStore(':memory:');
  const access = store.credits.create({ requestId: randomUUID(), initialPoints: 1000, note: '多人队列测试' }).codes[0];
  const provider = { id: 'mock', name: 'mock', baseUrl: 'https://queue.invalid', apiKey: 'fixture-key', imageModel: 'gpt-image-2', generationMode: 'images' };
  const order = [], gates = new Map(), owners = new Map(), jobs = new Map();
  let active = 0, maximumActive = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).hostname, 'queue.invalid');
    const { prompt, n } = JSON.parse(options.body);
    assert.equal(n, 1);
    order.push(prompt); active++; maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => gates.set(prompt, resolve));
    active--;
    return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), { headers: { 'Content-Type': 'application/json' } });
  });
  queue.init({ readLocalConfig: async () => ({ ...provider, providers: [provider] }), upstreamHeaders: () => ({}), timeoutSignal: () => undefined, stripHtml: String, logLine: () => {} });
  queue.initializePersistence(store);
  t.after(async () => { for (const release of gates.values()) release(); await queue.stopWorker(); store.close(); });
  function add(user, label, extra = {}) {
    const session = { userId: user, accessCodeId: access.id, codeEpoch: 1 };
    const input = { ...submission(randomUUID(), { prompt: label }), creditQuote: { accessCodeId: access.id, userId: user, version: 1 }, ...extra };
    const job = queue.submitGeneration(input, user, provider, session);
    jobs.set(label, job); owners.set(label, user);
    return job;
  }
  async function finish(label) {
    await until(() => gates.has(label), label + ' started');
    gates.get(label)();
    await until(() => queue.getJobStatus(jobs.get(label).id, owners.get(label)).status === 'succeeded', label + ' finished');
  }
  return { queue, store, access, add, finish, order, jobs, maximumActive: () => maximumActive };
}

test('单张用户完成退出后继续轮换, 共用访问码的批量任务不提前占用下一轮', async (t) => {
  const f = await fixture(t);
  for (const label of ['A1', 'A2', 'A3', 'A4']) f.add('a', label);
  f.add('b', 'B1'); f.add('c', 'C1');
  for (const user of ['b', 'c']) {
    const view = f.queue.getJobsForUser(user);
    assert.equal(view.jobs.length, 1, 'only this browser identity can see its tasks');
    assert.equal(view.jobs[0].yourPosition, 1, 'this is a personal position, never a global rank');
    assert.equal(view.globalActive, 1); assert.equal(view.globalQueued, 5);
    assert.ok(view.serverNow >= view.jobs[0].queuedAt);
    assert.equal(view.serverNow, view.jobs[0].serverNow);
  }
  for (const label of ['A1', 'B1', 'C1', 'A2', 'A3', 'A4']) await f.finish(label);
  assert.deepEqual(f.order, ['A1', 'B1', 'C1', 'A2', 'A3', 'A4']);
  assert.equal(f.maximumActive(), 1);
  const balance = f.store.credits.balance(f.access.id);
  assert.deepEqual([balance.available, balance.reserved, balance.spent], [940, 0, 60]);
});

test('个人置顶保持其他用户轮次, 取消返还后继续公平执行', async (t) => {
  const f = await fixture(t);
  for (const label of ['A1', 'A2', 'A3']) f.add('a', label);
  f.add('b', 'B1'); f.add('b', 'B2'); f.add('c', 'C1');
  assert.equal(f.queue.prioritize(f.jobs.get('A3').id, 'a').yourPosition, 1);
  f.queue.cancel(f.jobs.get('B2').id, 'b');
  for (const label of ['A1', 'B1', 'C1', 'A3', 'A2']) await f.finish(label);
  assert.deepEqual(f.order, ['A1', 'B1', 'C1', 'A3', 'A2']);
  assert.equal(f.maximumActive(), 1);
  assert.equal(f.queue.getJobsForUser('c').globalQueued, 0);
  const balance = f.store.credits.balance(f.access.id);
  assert.deepEqual([balance.available, balance.reserved, balance.spent], [950, 0, 50]);
});

test('当前用户的队列消失并有新用户进入时, 从原轮换位置继续而非回到队首', async (t) => {
  const f = await fixture(t);
  f.add('b', 'B1');
  f.add('a', 'A1'); f.add('c', 'C1');
  await f.finish('B1');
  await f.finish('C1'); await f.finish('A1');
  assert.deepEqual(f.order, ['B1', 'C1', 'A1']);
  assert.equal(f.maximumActive(), 1);
});
