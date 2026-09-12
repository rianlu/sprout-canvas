import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStateStore } from '../server/state-store.mjs';
import { secretHash } from '../server/credits-store.mjs';
import { startHarness, until } from './server-harness.mjs';
import { submission } from './fixtures.mjs';

const create = (store, points = 0, unlimited = false) => store.credits.create({ requestId: randomUUID(), initialPoints: points, note: '额度与删除测试', unlimited }).codes[0];
const quote = (session, unlimited = false) => ({ accessCodeId: session.accessCodeId, userId: session.userId, version: 1, unlimited });
function job(session, unlimited = false) {
  const id = randomUUID();
  return { id: `img_${id}`, requestId: id, requestHash: secretHash(id), userId: session.userId, status: 'pending', queuedAt: Date.now(), submission: { creditQuote: quote(session, unlimited) } };
}
const update = (store, id, input) => store.credits.update(id, { requestId: randomUUID(), version: store.credits.getCode(id).version, ...input });
const remove = (store, id) => store.credits.remove(id, { requestId: randomUUID(), version: store.credits.getCode(id).version });

test('无限额度零余额可共享使用, 图片与文字记录用量且不产生虚假预占或返还', () => {
  const store = createStateStore(':memory:');
  try {
    const access = create(store, 0, true);
    const a = store.identities.login(access.code).session, b = store.identities.login(access.code).session;
    const tasks = [job(a, true), job(a, true)];
    store.acceptImageJobs(tasks, a); store.acceptImageJobs([job(b, true)], b);
    assert.equal(store.credits.balance(access.id).reserved, 0);
    store.credits.settle(tasks[0].creditId, 'charged'); store.credits.settle(tasks[0].creditId, 'charged');
    store.credits.settle(tasks[1].creditId, 'refunded');
    const op = store.credits.reserveText({ requestId: randomUUID(), kind: 'prompt', creditQuote: quote(b, true) }, b, 'text');
    store.credits.settle(op.id, 'charged');
    const balance = store.credits.balance(access.id);
    assert.deepEqual([balance.unlimited, balance.available, balance.reserved, balance.spent], [true, 0, 0, 11]);
    assert.equal(store.credits.publicCharge(op.id).unlimited, true);
    const ledger = store.credits.ledger(access.id).entries;
    assert.ok(ledger.every((entry) => entry.points === 0 && entry.reserved === 0));
    assert.ok(ledger.filter((entry) => entry.operationId).every((entry) => entry.operationUnlimited));
    assert.throws(() => store.credits.adjust(access.id, { requestId: randomUUID(), version: 1, delta: 10, reason: '禁止虚假充值' }), /无限额度/);
    assert.throws(() => create(store, 100, true), /初始点数应为 0/);
    assert.throws(() => update(store, access.id, { unlimited: 'true' }), /额度模式无效/);
  } finally { store.close(); }
});

test('有限与无限切换保留余额, 在途成功与未知结果按原模式结算, 旧页面需重新确认', () => {
  const store = createStateStore(':memory:');
  try {
    const access = create(store, 40), session = store.identities.login(access.code).session;
    const limited = job(session); store.acceptImageJobs([limited], session);
    update(store, access.id, { unlimited: true });
    assert.throws(() => store.acceptImageJobs([job(session)], session), (error) => error.code === 'CREDIT_MODE_CHANGED' && error.details.credits.unlimited);
    const infinite = job(session, true); store.acceptImageJobs([infinite], session);
    store.credits.settle(infinite.creditId, 'running');
    update(store, access.id, { unlimited: false, delta: 5, reason: '切回有限并加点', note: '统一保存' });
    assert.throws(() => store.acceptImageJobs([job(session, true)], session), (error) => error.code === 'CREDIT_MODE_CHANGED');
    store.credits.settle(limited.creditId, 'charged');
    store.credits.settle(infinite.creditId, 'unknown');
    store.credits.resolve(infinite.creditId, { requestId: randomUUID(), decision: 'charge', reason: '确认成功' });
    const balance = store.credits.balance(access.id);
    assert.deepEqual([balance.unlimited, balance.available, balance.reserved, balance.spent], [false, 35, 0, 20]);
    assert.equal(store.credits.getCode(access.id).note, '统一保存');
    const before = store.credits.getCode(access.id);
    assert.throws(() => update(store, access.id, { note: '不得部分保存', delta: -100, reason: '扣减失败' }), /不能超过/);
    assert.deepEqual(store.credits.getCode(access.id), before);
    assert.throws(() => update(store, access.id, { unlimited: true, delta: 10, reason: '无效组合' }), /无限额度/);
  } finally { store.close(); }
});

test('恢复未执行任务保持原额度模式, 无限变有限不补扣, 有限变无限不免除原扣点', () => {
  const store = createStateStore(':memory:');
  try {
    const access = create(store, 10), session = store.identities.login(access.code).session;
    const limited = job(session); store.acceptImageJobs([limited], session);
    store.credits.settle(limited.creditId, 'refunded'); update(store, access.id, { unlimited: true });
    const infinite = job(session, true); store.acceptImageJobs([infinite], session);
    store.credits.settle(infinite.creditId, 'refunded');
    store.credits.resume(limited, session, quote(session, true));
    store.credits.settle(limited.creditId, 'charged');
    update(store, access.id, { unlimited: false });
    store.credits.resume(infinite, session, quote(session)); store.credits.settle(infinite.creditId, 'charged');
    assert.deepEqual([store.credits.balance(access.id).available, store.credits.balance(access.id).reserved, store.credits.balance(access.id).spent], [0, 0, 20]);
  } finally { store.close(); }
});

test('删除立即失效并返还排队预占, 保留账本与幂等记录, 不可删除运行中和待核实任务', () => {
  const store = createStateStore(':memory:');
  try {
    const access = create(store, 20), identity = store.identities.login(access.code), session = identity.session;
    const tasks = [job(session), job(session)]; store.acceptImageJobs(tasks, session);
    store.credits.settle(tasks[0].creditId, 'running');
    assert.throws(() => remove(store, access.id), (error) => error.code === 'ACCESS_CODE_HAS_UNSETTLED_TASKS');
    store.credits.settle(tasks[0].creditId, 'unknown');
    assert.throws(() => remove(store, access.id), /待核实/);
    store.credits.resolve(tasks[0].creditId, { requestId: randomUUID(), decision: 'charge', reason: '确认成功' });
    assert.throws(() => store.credits.remove(access.id, { requestId: randomUUID(), version: 2 }), /已被更新/);
    const input = { requestId: randomUUID(), version: 1 };
    store.credits.remove(access.id, input); assert.equal(store.credits.remove(access.id, input).replayed, true);
    assert.equal(store.credits.list().total, 0);
    assert.equal(store.credits.balance(access.id).available, 10); assert.equal(store.credits.balance(access.id).reserved, 0);
    assert.equal(store.credits.publicCharge(tasks[1].creditId).state, 'refunded');
    assert.equal(store.credits.publicCharge(tasks[0].creditId).state, 'charged');
    assert.equal(store.identities.session(identity.token).canGenerate, false);
    assert.equal(store.identities.session(identity.token).userId, session.userId);
    assert.throws(() => store.identities.login(access.code), /无效/);
    assert.throws(() => store.credits.getCode(access.id), /已删除/);
    assert.throws(() => store.credits.update(access.id, { requestId: randomUUID(), version: 2, enabled: true }), /已删除/);
    const infinite = create(store, 0, true), free = store.identities.login(infinite.code).session;
    const unknown = job(free, true); store.acceptImageJobs([unknown], free); store.credits.settle(unknown.creditId, 'unknown');
    assert.throws(() => remove(store, infinite.id), /待核实/);
  } finally { store.close(); }
});

test('升级旧数据库默认有限额度, 保留原余额与管理幂等, 无限额度和删除可跨重启恢复', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprout-credit-migration-')), file = join(dir, 'state.sqlite');
  let store = createStateStore(file);
  try {
    const createInput = { requestId: randomUUID(), initialPoints: 30, note: '升级保留' };
    const access = store.credits.create(createInput).codes[0], identity = store.identities.login(access.code);
    const editInput = { requestId: randomUUID(), version: 1, note: '已修改' };
    store.credits.update(access.id, editInput);
    const task = job(identity.session); store.acceptImageJobs([task], identity.session);
    store.close();
    const db = new DatabaseSync(file);
    for (const table of ['access_codes', 'credit_operations', 'credit_ledger']) db.exec(`ALTER TABLE ${table} DROP COLUMN unlimited`);
    db.exec('ALTER TABLE access_codes DROP COLUMN deleted_at'); db.close();
    store = createStateStore(file);
    assert.equal(store.credits.balance(access.id).unlimited, false);
    assert.deepEqual([store.credits.balance(access.id).available, store.credits.balance(access.id).reserved], [20, 10]);
    assert.equal(store.credits.create(createInput).replayed, true);
    assert.equal(store.credits.update(access.id, editInput).replayed, true);
    update(store, access.id, { unlimited: true }); store.credits.settle(task.creditId, 'charged');
    store.close(); store = createStateStore(file);
    assert.equal(store.credits.balance(access.id).available, 20); assert.equal(store.credits.balance(access.id).unlimited, true);
    remove(store, access.id); store.close(); store = createStateStore(file);
    assert.equal(store.credits.list().total, 0); assert.equal(store.identities.session(identity.token).canGenerate, false);
    const audit = new DatabaseSync(file);
    assert.equal(audit.prepare("SELECT count(*) AS n FROM credit_ledger WHERE event='delete'").get().n, 1);
    assert.equal(audit.prepare("SELECT count(*) AS n FROM credit_ledger WHERE event='charge'").get().n, 1);
    assert.equal(audit.prepare('PRAGMA foreign_key_check').all().length, 0); audit.close();
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

const admin = (app, route, body, method = 'POST') => app.api(`/api/admin/${route}`, { cookie: app.adminCookie, method, body });
const submit = (app, cookie, overrides = {}) => app.api('/api/jobs', { cookie, method: 'POST', body: { ...submission(randomUUID()), creditQuote: app.quote(cookie), ...overrides } });
const finish = (app, cookie, id) => until(async () => {
  const result = (await app.api(`/api/jobs/${id}`, { cookie })).data;
  return !['pending', 'running'].includes(result.status) && result;
}, 'job completion');

test('无限额度 API 支持零余额图片和文字, 切回有限后旧报价不扣点', async () => {
  const app = await startHarness();
  try {
    const result = await admin(app, 'access-codes', { requestId: randomUUID(), note: '无限验收', initialPoints: 0, unlimited: true });
    assert.equal(result.status, 201); const access = result.data.codes[0];
    const cookie = await app.login('unlimited', access.code);
    const accepted = await submit(app, cookie); assert.equal(accepted.status, 202);
    assert.equal((await finish(app, cookie, accepted.data.id)).credit.unlimited, true);
    const text = await app.api('/api/text', { cookie, method: 'POST', body: app.textInput(cookie) });
    assert.equal(text.status, 200); assert.equal(text.data.credit.unlimited, true);
    let balance = (await app.api('/api/credits', { cookie })).data.credits;
    assert.deepEqual([balance.available, balance.reserved, balance.spent], [0, 0, 11]);
    app.controls.respond = (_call, response) => { response.destroy(); return true; };
    const unknown = await app.api('/api/text', { cookie, method: 'POST', body: app.textInput(cookie) });
    assert.equal(unknown.data.credit.state, 'unknown');
    assert.match(unknown.data.error, /无限额度, 未占用或扣减点数/);
    assert.equal((await admin(app, `access-codes/${access.id}`, { requestId: randomUUID(), version: 1 }, 'DELETE')).data.code, 'ACCESS_CODE_HAS_UNSETTLED_TASKS');
    await admin(app, `credit-operations/${unknown.data.credit.id}/resolve`, { requestId: randomUUID(), decision: 'refund', reason: '无限任务确认失败' });
    app.controls.respond = undefined;
    assert.equal((await admin(app, `access-codes/${access.id}`, { requestId: randomUUID(), version: 1, unlimited: false, delta: 10, reason: '限额' }, 'PATCH')).status, 200);
    const before = app.calls.length;
    assert.equal((await submit(app, cookie)).data.code, 'CREDIT_MODE_CHANGED');
    assert.equal(app.calls.length, before);
    const finite = await submit(app, cookie, { creditQuote: { ...app.quote(cookie), unlimited: false } });
    assert.equal(finite.status, 202); await finish(app, cookie, finite.data.id);
    balance = (await app.api('/api/credits', { cookie })).data.credits;
    assert.deepEqual([balance.available, balance.reserved, balance.spent], [0, 0, 21]);
  } finally { await app.close(); }
});

test('删除 API 取消等待任务, 原浏览器仍可领取完成图片, 其他权限失效且删除可安全重放', async () => {
  const app = await startHarness(); let release;
  try {
    const access = (await admin(app, 'access-codes', { requestId: randomUUID(), initialPoints: 30, note: '删除验收' })).data.codes[0];
    const cookie = await app.login('to-delete', access.code);
    const completed = await submit(app, cookie); await finish(app, cookie, completed.data.id);
    const blocker = await app.login('blocker');
    const hold = new Promise((resolve) => { release = resolve; });
    app.controls.respond = async (call) => { if (call.path.includes('/images/')) await hold; return false; };
    await submit(app, blocker); await until(() => app.calls.length === 2, 'worker blocked by another code');
    const pending = await submit(app, cookie); assert.equal(pending.status, 202);
    assert.equal((await app.api(`/api/admin/access-codes/${access.id}`, { cookie, method: 'DELETE', body: { requestId: randomUUID(), version: 1 } })).status, 401);
    const input = { requestId: randomUUID(), version: 1 };
    const deleted = await admin(app, `access-codes/${access.id}`, input, 'DELETE'); assert.equal(deleted.status, 200);
    assert.equal((await admin(app, `access-codes/${access.id}`, input, 'DELETE')).data.replayed, true);
    const canceled = (await app.api(`/api/jobs/${pending.data.id}`, { cookie })).data;
    assert.equal(canceled.status, 'canceled'); assert.equal(canceled.credit.state, 'refunded');
    assert.equal((await submit(app, cookie)).status, 403);
    assert.equal((await app.api('/api/auth/login', { method: 'POST', body: { code: access.code } })).status, 401);
    assert.equal((await app.api(`/api/jobs/${completed.data.id}/result`, { cookie })).status, 200);
    assert.equal((await app.api(`/api/jobs/${completed.data.id}/ack`, { cookie, method: 'POST' })).status, 200);
    assert.equal((await admin(app, `access-codes/${access.id}`, { requestId: randomUUID(), version: 2, enabled: true }, 'PATCH')).status, 404);
    const balance = (await app.api('/api/credits', { cookie })).data.credits;
    assert.deepEqual([balance.available, balance.reserved, balance.spent], [20, 0, 10]);
    const listed = await app.api('/api/admin/access-codes', { cookie: app.adminCookie });
    assert.ok(listed.data.codes.every((item) => item.id !== access.id));
    release();
  } finally { release?.(); await app.close(); }
});
