import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startHarness, until } from './server-harness.mjs';
import { submission } from './fixtures.mjs';
import { secretHash } from '../server/credits-store.mjs';

const admin = (app, route, body, method = 'POST') => app.api(`/api/admin/${route}`, { cookie: app.adminCookie, method, body });
async function code(app, points, note = '专项验收') {
  const result = await admin(app, 'access-codes', { requestId: randomUUID(), initialPoints: points, note });
  assert.equal(result.status, 201); return result.data.codes[0];
}
const input = (app, cookie, changes = {}, version) => ({ ...submission(randomUUID(), changes), creditQuote: app.quote(cookie, version) });
const submit = (app, cookie, body) => app.api('/api/jobs', { cookie, method: 'POST', body });
const batch = (app, cookie, jobs) => app.api('/api/jobs/batch', { cookie, method: 'POST', body: { jobs } });
const snapshot = async (app, cookie) => (await app.api('/api/credits', { cookie })).data.credits;
const balance = async (app, cookie, expected) => {
  const value = await snapshot(app, cookie);
  assert.deepEqual([value.available, value.reserved, value.spent], expected);
};
const finished = (app, cookie, id) => until(async () => {
  const value = (await app.api(`/api/jobs/${id}`, { cookie })).data;
  return !['pending', 'running'].includes(value.status) && value;
}, 'image completion');
function holdImages(app) {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  app.controls.respond = async (call) => { if (call.path.includes('/images/')) await promise; return false; };
  return release;
}
const imageCalls = (app) => app.calls.filter((call) => call.path.includes('/images/'));

test('访问名称随当前会话只读返回并同步后台修改, 同码退出互不影响', async () => {
  const app = await startHarness();
  try {
    const access = await code(app, 80, '朋友共享');
    const a = await app.login('name-a', access.code), b = await app.login('name-b', access.code);
    const read = (cookie) => app.api('/api/auth/status', { cookie });
    const before = await read(a);
    assert.equal(before.data.accessName, '朋友共享');
    assert.equal((await read(b)).data.accessName, '朋友共享');
    assert.notEqual(before.data.userId, (await read(b)).data.userId);
    assert.equal(before.data.code, undefined);
    assert.equal(before.data.note, undefined);
    assert.equal((await read()).data.accessName, '');
    const changed = await admin(app, `access-codes/${access.id}`, { requestId: randomUUID(), version: access.version, note: '森林体验组' }, 'PATCH');
    assert.equal(changed.status, 200);
    assert.equal((await read(a)).data.accessName, '森林体验组');
    assert.equal((await read(b)).data.accessName, '森林体验组');
    await balance(app, a, [80, 0, 0]);
    assert.equal((await app.api('/api/auth/login', { method: 'POST', body: { code: access.code, accessName: '伪造名称' } })).status, 400);
    assert.equal((await app.api('/api/auth/logout', { method: 'POST', cookie: a })).status, 200);
    assert.equal((await read(a)).data.authenticated, false);
    assert.equal((await read(a)).data.accessName, '');
    assert.equal((await read(b)).data.authenticated, true);
    assert.equal((await read(b)).data.accessName, '森林体验组');
    assert.equal(app.calls.length, 0);
  } finally { await app.close(); }
});

test('同码并发共享余额, 批次原子受理, 全部任务权限按浏览器隔离', async () => {
  const app = await startHarness(); let release;
  try {
    const access = await code(app, 20);
    const a = await app.login('a', access.code), b = await app.login('b', access.code);
    assert.notEqual(app.quote(a).userId, app.quote(b).userId);
    const tooMany = await batch(app, a, [input(app, a), input(app, a), input(app, a)]);
    assert.equal(tooMany.status, 402); assert.equal(tooMany.data.required, 30);
    assert.equal(imageCalls(app).length, 0); await balance(app, a, [20, 0, 0]);
    assert.equal((await app.api('/api/jobs/me', { cookie: a })).data.jobs.length, 0);
    release = holdImages(app);
    const first = input(app, a), second = input(app, a);
    second.referenceJobId = first.requestId;
    const simultaneous = await Promise.all([batch(app, a, [first, second]), submit(app, b, input(app, b))]);
    assert.equal(simultaneous.filter((result) => result.status === 202).length, 1);
    assert.equal(simultaneous.filter((result) => result.status === 402).length, 1);
    // Whichever browser wins owns its jobs; the other cannot inspect or mutate them.
    const winner = simultaneous[0].status === 202 ? a : b, other = winner === a ? b : a;
    const jobs = simultaneous[0].status === 202 ? simultaneous[0].data.jobs : [simultaneous[1].data];
    const job = jobs[0];
    await until(() => imageCalls(app).length === 1, 'held upstream');
    for (const [suffix, method, body] of [['', 'GET'], ['/result', 'GET'], ['/ack', 'POST'], ['', 'DELETE'], ['/priority', 'POST'], ['', 'PATCH', input(app, other)], ['/resume', 'POST', input(app, other)]]) {
      assert.equal((await app.api(`/api/jobs/${job.id}${suffix}`, { cookie: other, method, body })).status, 404);
    }
    assert.equal((await app.api('/api/jobs/me', { cookie: other })).data.jobs.length, 0);
    assert.equal((await submit(app, other, { ...input(app, other), referenceJobId: job.id })).status, 404);
    assert.equal((await submit(app, other, { ...input(app, other), creditQuote: app.quote(winner) })).data.code, 'BROWSER_IDENTITY_CHANGED');
    assert.equal((await app.api('/api/admin/access-codes', { cookie: winner })).status, 401);
    assert.equal((await app.api('/api/jobs/me', { cookie: app.adminCookie })).status, 401);
    if (winner === a) {
      const replay = await batch(app, a, [first, second]);
      assert.deepEqual(replay.data.jobs.map((value) => value.id), jobs.map((value) => value.id));
      await balance(app, b, [0, 20, 0]);
      assert.equal((await app.api('/api/text', { cookie: b, method: 'POST', body: app.textInput(b) })).status, 402);
    }
    release();
    for (const accepted of jobs) await finished(app, winner, accepted.id);
    assert.equal(imageCalls(app).length, jobs.length);
    if (jobs.length === 2) assert.match(imageCalls(app)[1].path, /\/images\/edits$/);
    await balance(app, other, [20 - jobs.length * 10, 0, jobs.length * 10]);
    const done = await app.api(`/api/jobs/${job.id}/result`, { cookie: winner }); assert.equal(done.status, 200);
    assert.equal((await app.api(`/api/jobs/${job.id}/ack`, { cookie: winner, method: 'POST' })).status, 200);
    await balance(app, winner, [20 - jobs.length * 10, 0, jobs.length * 10]);
    const again = await app.login(winner === a ? 'a' : 'b', access.code);
    assert.equal(app.quote(again).userId, app.quote(winner).userId);
    assert.equal((await app.api(`/api/jobs/${job.id}`, { cookie: again })).status, 200);
  } finally { release?.(); await app.close(); }
});

test('调价须确认, 重置或停用取消排队且保留在途领取, 重放管理请求不伤及新任务', async () => {
  const app = await startHarness(); let release;
  try {
    const access = await code(app, 80); const a = await app.login('a', access.code);
    release = holdImages(app);
    const values = [input(app, a), input(app, a)]; const accepted = await batch(app, a, values);
    assert.equal(accepted.status, 202); const [running, pending] = accepted.data.jobs;
    await until(() => imageCalls(app).length === 1, 'first dispatched');
    const repriced = await admin(app, 'credit-prices', { requestId: randomUUID(), image: 15, text: 2, version: 1 }, 'PUT');
    assert.equal(repriced.status, 200);
    assert.equal((await submit(app, a, input(app, a))).data.code, 'PRICE_CHANGED');
    assert.equal((await batch(app, a, values)).status, 202, 'accepted requests keep their original quote');
    const edited = structuredClone(values[1]); edited.request.prompt = '编辑排队的提示词';
    assert.equal((await app.api(`/api/jobs/${pending.id}`, { cookie: a, method: 'PATCH', body: edited })).data.credit.points, 10);
    const resetInput = { requestId: randomUUID(), version: 1, reason: '更换共享码' };
    const reset = await admin(app, `access-codes/${access.id}/reset`, resetInput);
    assert.equal(reset.status, 200); assert.notEqual(reset.data.code, access.code);
    assert.equal((await app.api(`/api/jobs/${pending.id}`, { cookie: a })).data.credit.state, 'refunded');
    assert.equal((await app.api('/api/auth/status', { cookie: a })).data.canGenerate, false);
    assert.equal((await submit(app, a, input(app, a, {}, 2))).status, 403);
    const fresh = await app.login('a', reset.data.code);
    assert.equal(app.quote(fresh).userId, app.quote(a).userId);
    const later = await submit(app, fresh, input(app, fresh)); assert.equal(later.status, 202);
    const replay = await admin(app, `access-codes/${access.id}/reset`, resetInput);
    assert.equal(replay.data.replayed, true); assert.equal(replay.data.code, undefined);
    assert.equal((await app.api(`/api/jobs/${later.data.id}`, { cookie: fresh })).data.status, 'pending');
    release();
    await finished(app, a, running.id); await finished(app, fresh, later.data.id);
    assert.equal(imageCalls(app).length, 2);
    await balance(app, fresh, [55, 0, 25]);
    assert.equal((await app.api(`/api/jobs/${running.id}/result`, { cookie: a })).status, 200);
    assert.equal((await app.api(`/api/jobs/${running.id}/ack`, { cookie: a, method: 'POST' })).status, 200);
    release = holdImages(app);
    const next = await batch(app, fresh, [input(app, fresh), input(app, fresh)]);
    await until(() => imageCalls(app).length === 3, 'next held job');
    const disabled = await admin(app, `access-codes/${access.id}`, { requestId: randomUUID(), version: 2, enabled: false }, 'PATCH');
    assert.equal(disabled.status, 200);
    assert.equal((await app.api(`/api/jobs/${next.data.jobs[1].id}`, { cookie: fresh })).data.status, 'canceled');
    release(); await finished(app, fresh, next.data.jobs[0].id);
    await balance(app, fresh, [40, 0, 40]);
    assert.equal((await app.api(`/api/jobs/${next.data.jobs[0].id}/result`, { cookie: fresh })).status, 200);
  } finally { release?.(); await app.close(); }
});

test('文字重复请求和丢响应只调用一次, 未知结果不切换通道且可以核实结算', async () => {
  const app = await startHarness(); let release;
  try {
    const access = await code(app, 10); const a = await app.login('a', access.code), b = await app.login('b', access.code);
    const gate = new Promise((resolve) => { release = resolve; });
    app.controls.respond = async () => { await gate; return false; };
    const body = app.textInput(a);
    const aborted = new AbortController();
    const lost = fetch(`${app.base}/api/text`, { method: 'POST', headers: { Cookie: a, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: aborted.signal }).catch(() => null);
    await until(() => app.calls.length === 1, 'text dispatched');
    aborted.abort(); await lost;
    const retry = app.api('/api/text', { cookie: a, method: 'POST', body });
    assert.equal((await app.api(`/api/text/${body.requestId}`, { cookie: b })).status, 404);
    release(); const result = await retry;
    assert.equal(result.status, 200); assert.equal(result.data.credit.state, 'charged');
    assert.equal(app.calls.length, 1); await balance(app, b, [9, 0, 1]);
    assert.equal((await app.api('/api/text', { cookie: a, method: 'POST', body })).data.text, result.data.text);
    assert.equal((await app.api('/api/text', { cookie: a, method: 'POST', body: { ...body, kind: 'series', sceneCount: 4 } })).status, 409);
    await app.stop(); await app.start();
    assert.equal((await app.api('/api/text', { cookie: a, method: 'POST', body })).data.text, result.data.text);
    assert.equal(app.calls.length, 1);
    app.config.textProviders.push({ ...app.config.textProviders[0], id: 'backup', name: 'backup' });
    await writeFile(path.join(app.directory, 'config/local.config.json'), JSON.stringify(app.config));
    app.controls.respond = (_call, response) => { response.destroy(); return true; };
    const unknownBody = app.textInput(a); const unknown = await app.api('/api/text', { cookie: a, method: 'POST', body: unknownBody });
    assert.equal(unknown.data.code, 'OUTCOME_UNKNOWN'); assert.equal(unknown.data.credit.state, 'unknown');
    assert.equal(app.calls.length, 2, 'unknown outcome must not switch to the backup');
    await balance(app, a, [8, 1, 1]);
    const resolve = { requestId: randomUUID(), decision: 'refund', reason: '上游确认未产出' };
    assert.equal((await admin(app, `credit-operations/${unknown.data.credit.id}/resolve`, resolve)).status, 200);
    assert.equal((await admin(app, `credit-operations/${unknown.data.credit.id}/resolve`, resolve)).data.replayed, true);
    const replay = await app.api(`/api/text/${unknownBody.requestId}`, { cookie: a });
    assert.equal(replay.data.credit.state, 'refunded'); assert.match(replay.data.error, /已由管理员返还/);
    await balance(app, a, [9, 0, 1]); assert.equal(app.calls.length, 2);
    assert.doesNotMatch(app.logs(), new RegExp(access.code));
  } finally { release?.(); await app.close(); }
});

test('图像和文字结算写入失败只重试入账, 预占或任务写入失败不调用上游', async () => {
  const app = await startHarness(); let db;
  try {
    const a = await app.login(); db = new DatabaseSync(path.join(app.directory, 'data/runtime.sqlite'));
    const failure = input(app, a);
    db.exec(`CREATE TRIGGER fail_job BEFORE INSERT ON jobs WHEN NEW.request_id='${failure.requestId}' BEGIN SELECT RAISE(ABORT, 'isolated disk failure'); END`);
    assert.equal((await batch(app, a, [input(app, a), failure])).status, 500);
    await balance(app, a, [1000000, 0, 0]); assert.equal(app.calls.length, 0);
    assert.equal((await app.api('/api/jobs/me', { cookie: a })).data.jobs.length, 0);
    db.exec("DROP TRIGGER fail_job; CREATE TRIGGER fail_charge BEFORE UPDATE ON credit_operations WHEN NEW.state='charged' BEGIN SELECT RAISE(ABORT, 'isolated settlement failure'); END");
    const body = input(app, a); const accepted = await submit(app, a, body);
    const done = await finished(app, a, accepted.data.id);
    assert.equal(done.status, 'succeeded'); assert.equal(done.settlementPending, true);
    assert.equal(done.credit.state, 'running');
    const textBody = app.textInput(a); const text = await app.api('/api/text', { cookie: a, method: 'POST', body: textBody });
    assert.equal(text.status, 200); assert.equal(text.data.settlementPending, true);
    assert.equal((await app.api('/api/text', { cookie: a, method: 'POST', body: textBody })).data.text, text.data.text);
    assert.equal(app.calls.length, 2);
    await balance(app, a, [999989, 11, 0]);
    db.exec('DROP TRIGGER fail_charge');
    await until(async () => (await snapshot(app, a)).reserved === 0, 'settlement recovery', 10000);
    await balance(app, a, [999989, 0, 11]);
    assert.equal((await submit(app, a, body)).data.id, accepted.data.id);
    assert.equal((await app.api('/api/text', { cookie: a, method: 'POST', body: textBody })).data.credit.state, 'charged');
    assert.equal(app.calls.length, 2);
  } finally { db?.close(); await app.close(); }
});

test('重启时区分已发送与未发送, 账本不受任务清理影响, 旧会话迁移不追溯扣点', async () => {
  const app = await startHarness(); let release; let db;
  try {
    const a = await app.login(); release = holdImages(app);
    const values = [input(app, a), input(app, a)];
    const accepted = await batch(app, a, values);
    await until(() => imageCalls(app).length === 1, 'running before restart');
    await app.stop('SIGKILL'); release(); app.controls.respond = null; await app.start();
    const first = (await app.api(`/api/jobs/${accepted.data.jobs[0].id}`, { cookie: a })).data;
    const second = (await app.api(`/api/jobs/${accepted.data.jobs[1].id}`, { cookie: a })).data;
    assert.equal(first.credit.state, 'unknown'); assert.equal(second.credit.state, 'refunded');
    await balance(app, a, [999990, 10, 0]);
    assert.equal((await app.api(`/api/jobs/${first.id}/resume`, { cookie: a, method: 'POST', body: values[0] })).status, 409);
    const resolved = await admin(app, `credit-operations/${first.credit.id}/resolve`, { requestId: randomUUID(), decision: 'charge', reason: '确认上游已经完成' });
    assert.equal(resolved.status, 200);
    await app.api(`/api/jobs/${second.id}/resume`, { cookie: a, method: 'POST', body: values[1] });
    await finished(app, a, second.id); await balance(app, a, [999980, 0, 20]);
    await app.stop();
    db = new DatabaseSync(path.join(app.directory, 'data/runtime.sqlite'));
    db.prepare('DELETE FROM jobs WHERE id=?').run(first.id);
    const legacyUser = randomUUID(), legacyToken = randomUUID(), legacyId = `img_${randomUUID()}`;
    db.prepare('INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(secretHash(legacyToken), legacyUser, Date.now(), Date.now() + 60000);
    db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?)').run(legacyId, legacyUser, null, JSON.stringify({ id: legacyId, userId: legacyUser, status: 'succeeded', acknowledgedAt: Date.now(), queuedAt: Date.now(), finishedAt: Date.now(), clientContext: { kind: 'single', placeholderId: 'legacy-picture' } }), Date.now());
    db.close(); db = null; await app.start();
    assert.equal((await submit(app, a, values[0])).data.code, 'REQUEST_ALREADY_ACCEPTED');
    assert.equal(imageCalls(app).length, 2); await balance(app, a, [999980, 0, 20]);
    const migrated = await app.api('/api/auth/login', { method: 'POST', cookie: `img_auth_max=${legacyToken}`, body: { code: app.accessCode } });
    assert.equal(migrated.status, 200); assert.equal(migrated.data.userId, legacyUser);
    const legacy = await app.api(`/api/jobs/${legacyId}`, { cookie: app.responseCookie(migrated) });
    assert.equal(legacy.status, 200); assert.equal(legacy.data.credit, null);
    await balance(app, a, [999980, 0, 20]);
  } finally { release?.(); db?.close(); await app.close(); }
});

test('零余额免费操作, 参数与登录限流, 点数调整幂等以及账本分页', async () => {
  const app = await startHarness();
  try {
    const zero = await code(app, 0); const a = await app.login('zero', zero.code);
    assert.equal((await app.api('/api/styles', { cookie: a })).status, 200);
    assert.equal((await app.api('/api/config', { cookie: a })).status, 200);
    assert.equal((await submit(app, a, input(app, a))).status, 402);
    assert.equal((await app.api('/api/text', { cookie: a, method: 'POST', body: app.textInput(a) })).status, 402);
    const forged = input(app, a); forged.creditQuote.points = 0;
    assert.equal((await submit(app, a, forged)).status, 400);
    delete forged.creditQuote;
    assert.equal((await submit(app, a, forged)).status, 400);
    assert.equal((await app.api('/api/admin/access-codes', { cookie: a })).status, 401);
    const change = { requestId: randomUUID(), version: 1, delta: 25, reason: '追加测试点数' };
    assert.equal((await admin(app, `access-codes/${zero.id}/points`, change)).status, 200);
    assert.equal((await admin(app, `access-codes/${zero.id}/points`, change)).data.replayed, true);
    await balance(app, a, [25, 0, 0]);
    assert.equal((await admin(app, `access-codes/${zero.id}/points`, { ...change, requestId: randomUUID(), version: 2, delta: -26 })).status, 400);
    for (let index = 0; index < 33; index++) assert.equal((await admin(app, `access-codes/${zero.id}/points`, { requestId: randomUUID(), version: index + 2, delta: 1, reason: '分页验收' })).status, 200);
    const first = (await admin(app, `access-codes/${zero.id}/ledger`, undefined, 'GET')).data;
    const second = (await admin(app, `access-codes/${zero.id}/ledger?cursor=${first.nextCursor}`, undefined, 'GET')).data;
    assert.equal(first.entries.length, 30); assert.equal(second.entries.length, 5);
    assert.equal(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size, 35);
    for (let index = 0; index < 8; index++) {
      const wrong = await app.api('/api/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': `1.1.1.${index}` }, body: { code: `sc_${'x'.repeat(32)}` } });
      assert.equal(wrong.status, 401);
    }
    const limited = await app.api('/api/auth/login', { method: 'POST', body: { code: zero.code } });
    assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal((await app.api('/api/auth/status', { cookie: a })).data.authenticated, true);
    assert.equal(app.calls.length, 0, 'login failures and free actions do not call models');
  } finally { await app.close(); }
});

test('文字真实超时与在途重启保留预占, 不重发请求或自动切换备用通道', { timeout: 80000 }, async () => {
  const app = await startHarness();
  try {
    const a = await app.login();
    app.config.textProviders.push({ ...app.config.textProviders[0], id: 'backup', name: 'backup' });
    await writeFile(path.join(app.directory, 'config/local.config.json'), JSON.stringify(app.config));
    app.controls.respond = () => true;
    const timeoutBody = app.textInput(a);
    const timedOut = await app.api('/api/text', { cookie: a, method: 'POST', body: timeoutBody });
    assert.equal(timedOut.status, 409); assert.equal(timedOut.data.code, 'OUTCOME_UNKNOWN');
    assert.equal(timedOut.data.credit.state, 'unknown'); assert.equal(app.calls.length, 1);
    assert.equal(timedOut.data.attempts[0].timeout, true);
    const restartBody = app.textInput(a);
    const interrupted = app.api('/api/text', { cookie: a, method: 'POST', body: restartBody }).catch(() => null);
    await until(() => app.calls.length === 2, 'in-flight text before restart');
    await app.stop('SIGKILL'); await interrupted; await app.start();
    const restored = await app.api(`/api/text/${restartBody.requestId}`, { cookie: a });
    assert.equal(restored.data.code, 'OUTCOME_UNKNOWN'); assert.equal(restored.data.credit.state, 'unknown');
    assert.equal((await app.api('/api/text', { cookie: a, method: 'POST', body: restartBody })).data.credit.id, restored.data.credit.id);
    await balance(app, a, [999998, 2, 0]); assert.equal(app.calls.length, 2);
    await admin(app, `credit-operations/${restored.data.credit.id}/resolve`, { requestId: randomUUID(), decision: 'refund', reason: '重启前上游确认失败' });
    assert.match((await app.api(`/api/text/${restartBody.requestId}`, { cookie: a })).data.error, /已由管理员返还/);
    await balance(app, a, [999999, 1, 0]);
  } finally { await app.close(); }
});
