import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStateStore } from '../server/state-store.mjs';
import { secretHash } from '../server/credits-store.mjs';

const requestId = () => randomUUID();
function create(store, points = 100, extra = {}) { return store.credits.create({ requestId: requestId(), initialPoints: points, note: '测试访问码', ...extra }).codes[0]; }
function job(session, id = requestId(), version = 1) {
  return { id: `img_${id}`, requestId: id, requestHash: secretHash(id), userId: session.userId, status: 'pending', queuedAt: Date.now(), submission: { creditQuote: { accessCodeId: session.accessCodeId, userId: session.userId, version } } };
}

test('访问码仅存哈希, 批量创建与管理请求幂等, 点值及编辑有版本校验', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprout-credits-'));
  const file = join(dir, 'state.sqlite'); const store = createStateStore(file);
  try {
    const input = { requestId: requestId(), note: '朋友', initialPoints: 80, count: 5 };
    const first = store.credits.create(input);
    assert.equal(first.codes.length, 5);
    assert.equal(new Set(first.codes.map((item) => item.code)).size, 5);
    for (const item of first.codes) assert.match(item.code, /^sc_[A-Za-z0-9_-]{32}$/);
    const replay = store.credits.create(input);
    assert.equal(replay.replayed, true); assert.equal(replay.codes[0].code, undefined);
    assert.equal(store.credits.list().total, 5);
    assert.throws(() => store.credits.create({ ...input, count: 4 }), /请求编号/);
    const access = first.codes[0];
    store.credits.update(access.id, { requestId: requestId(), version: 1, note: '新备注' });
    assert.throws(() => store.credits.update(access.id, { requestId: requestId(), version: 1, note: '旧编辑' }), /已被更新/);
    assert.throws(() => store.credits.adjust(access.id, { requestId: requestId(), version: 2, delta: -81, reason: '减点' }), /不能超过/);
    assert.throws(() => store.credits.setPrices({ requestId: requestId(), version: 1, image: 0, text: 1 }), /整数/);
    store.credits.setPrices({ requestId: requestId(), version: 1, image: 20, text: 2 });
    assert.throws(() => store.credits.setPrices({ requestId: requestId(), version: 1, image: 30, text: 2 }), /已被修改/);
    assert.equal(store.credits.list({ search: '新备注' }).total, 1);
    store.close();
    const db = new DatabaseSync(file);
    assert.equal(db.prepare('SELECT code_hash FROM access_codes WHERE id=?').get(access.id).code_hash, secretHash(access.code));
    db.close();
    assert.equal(readFileSync(file).includes(Buffer.from(access.code)), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('同码不同浏览器共享余额并隔离身份, 退出重登保留归属, 重置不会丢失账本', () => {
  const store = createStateStore(':memory:');
  try {
    const access = create(store);
    const a = store.identities.login(access.code); const b = store.identities.login(access.code);
    assert.notEqual(a.session.userId, b.session.userId);
    assert.equal(a.session.accessCodeId, b.session.accessCodeId);
    store.identities.logout(a.token);
    const again = store.identities.login(access.code, { browserToken: a.browserToken });
    assert.equal(again.session.userId, a.session.userId);
    const task = job(again.session); store.acceptImageJobs([task], again.session);
    assert.equal(store.credits.balance(b.session.accessCodeId).available, 90);
    const reset = store.credits.reset(access.id, { requestId: requestId(), version: 1, reason: '更换码' });
    assert.throws(() => store.identities.login(access.code), /无效/);
    assert.equal(store.identities.session(b.token).canGenerate, false);
    assert.equal(store.identities.session(b.token).userId, b.session.userId);
    const fresh = store.identities.login(reset.code, { browserToken: a.browserToken, previousToken: again.token });
    assert.equal(fresh.session.userId, a.session.userId);
    assert.equal(store.credits.balance(access.id).reserved, 10);
    assert.throws(() => store.acceptImageJobs([job(b.session)], b.session), /停用或重置/);
  } finally { store.close(); }
});

test('重置和删除无需填写原因, 自动记录操作且保留版本校验和幂等', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprout-admin-actions-'));
  const file = join(dir, 'state.sqlite'); const store = createStateStore(file);
  try {
    const access = create(store, 80);
    const resetInput = { requestId: requestId(), version: 1 };
    const reset = store.credits.reset(access.id, resetInput);
    assert.notEqual(reset.code, access.code);
    assert.equal(reset.accessCode.available, 80);
    assert.equal(reset.accessCode.version, 2);
    assert.throws(() => store.identities.login(access.code), /无效/);
    assert.equal(store.identities.login(reset.code).session.accessCodeId, access.id);
    const replay = store.credits.reset(access.id, resetInput);
    assert.equal(replay.replayed, true);
    assert.equal(replay.code, undefined);
    assert.equal(store.credits.getCode(access.id).version, 2);
    assert.throws(() => store.credits.remove(access.id, { requestId: requestId(), version: 1 }), (error) => error.code === 'VERSION_CONFLICT');
    const deleteInput = { requestId: requestId(), version: 2 };
    store.credits.remove(access.id, deleteInput);
    assert.equal(store.credits.remove(access.id, deleteInput).replayed, true);
    assert.equal(store.credits.balance(access.id).available, 80);
    assert.throws(() => store.credits.ledger(access.id), /已删除/);
    const db = new DatabaseSync(file, { readOnly: true });
    const entries = db.prepare('SELECT event, reason FROM credit_ledger WHERE code_id=?').all(access.id);
    db.close();
    assert.deepEqual(entries.filter((entry) => entry.event === 'reset').map((entry) => entry.reason), ['管理员重置访问码']);
    assert.deepEqual(entries.filter((entry) => entry.event === 'delete').map((entry) => entry.reason), ['管理员删除访问码']);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('批次额度不足时全部拒绝, 成功与失败分别结算且不能重复扣除或返还', () => {
  const store = createStateStore(':memory:');
  try {
    const access = create(store, 25); const { session } = store.identities.login(access.code);
    const tasks = [job(session), job(session), job(session)];
    assert.throws(() => store.acceptImageJobs(tasks, session), (error) => error.code === 'INSUFFICIENT_CREDITS' && error.details.required === 30);
    assert.equal(store.loadJobs().length, 0); assert.equal(store.credits.balance(access.id).available, 25);
    store.acceptImageJobs(tasks.slice(0, 2), session);
    assert.equal(store.credits.balance(access.id).available, 5);
    assert.throws(() => store.credits.adjust(access.id, { requestId: requestId(), version: 1, delta: -6, reason: '不能扣占用额度' }), /不能超过/);
    tasks[0].status = 'succeeded'; store.saveJob(tasks[0]); store.saveJob(tasks[0]);
    tasks[1].status = 'failed'; store.saveJob(tasks[1]); store.saveJob(tasks[1]);
    assert.deepEqual({ ...store.credits.balance(access.id), tail: '' }, { accessCodeId: access.id, tail: '', available: 15, reserved: 0, spent: 10, enabled: true, unlimited: false });
    const events = store.credits.ledger(access.id).entries.map((entry) => entry.event);
    assert.equal(events.filter((event) => event === 'charge').length, 1);
    assert.equal(events.filter((event) => event === 'refund').length, 1);
    store.deleteJob(tasks[0].id);
    const duplicate = { ...tasks[0], id: requestId(), status: 'pending' };
    assert.throws(() => store.acceptImageJobs([duplicate], session), /已受理/);
    assert.equal(store.credits.balance(access.id).available, 15);
  } finally { store.close(); }
});

test('不同浏览器竞争同一码不能超扣, 报价变更须重新确认, 恢复任务保留原点值', () => {
  const store = createStateStore(':memory:');
  try {
    const access = create(store, 15); const a = store.identities.login(access.code).session; const b = store.identities.login(access.code).session;
    const task = job(a); store.acceptImageJobs([task], a);
    assert.throws(() => store.acceptImageJobs([job(b)], b), /灵感点不足/);
    store.credits.setPrices({ requestId: requestId(), version: 1, image: 12, text: 2 });
    assert.throws(() => store.acceptImageJobs([job(b)], b), (error) => error.code === 'PRICE_CHANGED');
    task.status = 'interrupted'; task.outcomeUnknown = false; store.saveJob(task);
    store.transaction(() => { store.credits.resume(task, a, task.submission.creditQuote); task.status = 'pending'; store.saveJob(task); });
    assert.equal(store.credits.publicCharge(task.creditId).points, 10);
    assert.equal(store.credits.balance(access.id).available, 5);
    assert.throws(() => store.credits.resume(task, a, task.submission.creditQuote), /无法恢复/);
    assert.throws(() => store.credits.checkQuote(a, { accessCodeId: create(store).id, userId: a.userId, version: 2 }), /另一个访问码/);
  } finally { store.close(); }
});

test('结果未知保留预占, 管理员核实幂等, 已结束请求不会重新计点', () => {
  const store = createStateStore(':memory:');
  try {
    const access = create(store); const { session } = store.identities.login(access.code); const task = job(session);
    store.acceptImageJobs([task], session);
    task.status = 'running'; store.saveJob(task);
    task.status = 'failed'; task.outcomeUnknown = true; store.saveJob(task);
    assert.equal(store.credits.balance(access.id).reserved, 10);
    assert.equal(store.credits.unresolved(access.id).operations.length, 1);
    store.credits.settle(task.creditId, 'refunded');
    assert.equal(store.credits.balance(access.id).reserved, 10);
    const input = { requestId: requestId(), decision: 'refund', reason: '核对上游未产出结果' };
    store.credits.resolve(task.creditId, input); store.credits.resolve(task.creditId, input);
    assert.equal(store.credits.balance(access.id).available, 100);
    assert.throws(() => store.credits.resolve(task.creditId, { ...input, requestId: requestId() }), /不再需要/);
  } finally { store.close(); }
});

test('文字完成结果可跨重启复用, 在途文字重启后保持待核实', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprout-credit-text-')); const file = join(dir, 'state.sqlite');
  let store = createStateStore(file);
  try {
    const access = create(store); const { session } = store.identities.login(access.code);
    const input = { requestId: requestId(), kind: 'series', creditQuote: { accessCodeId: access.id, userId: session.userId, version: 1 } };
    const op = store.credits.reserveText(input, session, 'stable-hash');
    store.credits.settle(op.id, 'running'); store.credits.settle(op.id, 'charged', { result: { status: 200, body: { text: '分镜草稿' } } });
    const unknown = store.credits.reserveText({ ...input, requestId: requestId() }, session, 'another-hash');
    store.credits.settle(unknown.id, 'running');
    store.close(); store = createStateStore(file); store.credits.recoverText();
    assert.equal(JSON.parse(store.credits.byRequest(session.userId, input.requestId).result).body.text, '分镜草稿');
    assert.equal(store.credits.publicCharge(unknown.id).state, 'unknown');
    assert.equal(store.credits.balance(access.id).available, 98);
    assert.equal(store.credits.balance(access.id).spent, 1);
    assert.equal(store.credits.balance(access.id).reserved, 1);
    assert.throws(() => store.credits.reserveText({ ...input, kind: 'prompt' }, session, 'stable-hash'), /不同内容/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('任务落盘失败回滚整个批次与预占, 不留下半批额度', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprout-credit-atomic-')); const file = join(dir, 'state.sqlite'); const store = createStateStore(file);
  try {
    const access = create(store); const { session } = store.identities.login(access.code);
    const db = new DatabaseSync(file);
    db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON jobs WHEN NEW.request_id='fail-this-job' BEGIN SELECT RAISE(ABORT, 'disk write simulation'); END"); db.close();
    assert.throws(() => store.acceptImageJobs([job(session), job(session, 'fail-this-job')], session), /disk write simulation/);
    assert.equal(store.loadJobs().length, 0);
    assert.equal(store.credits.balance(access.id).available, 100);
    assert.equal(store.credits.ledger(access.id).entries.length, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('旧任务归属仅通过可信旧会话迁移, 不接受浏览器自报用户编号', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprout-credit-legacy-')); const file = join(dir, 'state.sqlite');
  const db = new DatabaseSync(file); const legacyUser = randomUUID(); const legacyToken = randomUUID();
  db.exec('CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)');
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(secretHash(legacyToken), legacyUser, Date.now(), Date.now() + 60000); db.close();
  const store = createStateStore(file);
  try {
    const access = create(store);
    assert.equal(store.identities.session(legacyToken), null);
    const forged = store.identities.login(access.code, { userId: legacyUser });
    assert.notEqual(forged.session.userId, legacyUser);
    const migrated = store.identities.login(access.code, { previousToken: legacyToken });
    assert.equal(migrated.session.userId, legacyUser);
    assert.equal(store.identities.session(legacyToken), null);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
