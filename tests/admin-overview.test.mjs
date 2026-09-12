import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStateStore } from '../server/state-store.mjs';
import { startHarness } from './server-harness.mjs';

test('仪表盘按结算快照汇总, 排除预占和返还, 保留无限额度与删除码历史', () => {
  const store = createStateStore(':memory:');
  const credits = store.credits;
  const create = (note, unlimited = false) => credits.create({ requestId: randomUUID(), note, initialPoints: unlimited ? 0 : 1000, unlimited }).codes[0];
  function reserve(access, kind = 'image') {
    const { session } = store.identities.login(access.code);
    const requestId = randomUUID();
    const creditQuote = { accessCodeId: access.id, userId: session.userId, unlimited: access.unlimited, version: credits.prices().version };
    if (kind !== 'image') return credits.reserveText({ requestId, kind, creditQuote }, session, requestId).id;
    const job = { id: `img_${requestId}`, requestId, requestHash: requestId, userId: session.userId, status: 'pending', queuedAt: Date.now(), submission: { creditQuote } };
    store.acceptImageJobs([job], session);
    return job.creditId;
  }
  try {
    assert.deepEqual(credits.overview().accessCodes, { total: 0, enabled: 0, disabled: 0, unlimited: 0 });
    assert.equal(credits.overview().usage.points, 0);
    assert.equal(credits.overview().pendingReview.total, 0);
    const finite = create('朋友共享'), unlimited = create('无限测试', true), disabled = create('暂时停用'), removed = create('已删除');
    credits.update(disabled.id, { requestId: randomUUID(), version: 1, enabled: false });
    for (let i = 0; i < 2; i++) credits.settle(reserve(finite), 'charged');
    credits.settle(reserve(finite, 'prompt'), 'charged');
    credits.settle(reserve(finite, 'series'), 'refunded');
    const pendingFinite = reserve(finite); credits.settle(pendingFinite, 'unknown');
    reserve(finite);
    credits.settle(reserve(finite, 'prompt'), 'running');
    credits.settle(reserve(unlimited), 'charged');
    const pendingUnlimited = reserve(unlimited, 'series'); credits.settle(pendingUnlimited, 'unknown');
    credits.settle(reserve(removed), 'charged');
    credits.remove(removed.id, { requestId: randomUUID(), version: 1 });
    const overview = credits.overview();
    assert.deepEqual(overview.accessCodes, { total: 3, enabled: 2, disabled: 1, unlimited: 1 });
    assert.deepEqual(overview.usage, { images: 4, texts: 1, imagePoints: 40, textPoints: 1, points: 41, deducted: 31 });
    assert.equal(overview.pendingReview.total, 2);
    assert.equal(overview.pendingReview.codeCount, 2);
    assert.equal(overview.pendingReview.reserved, 10);
    assert.equal(overview.pendingReview.codes.find((code) => code.id === unlimited.id).reserved, 0);
    assert.equal(overview.pendingReview.codes.find((code) => code.id === finite.id).tail, finite.tail);
    credits.update(unlimited.id, { requestId: randomUUID(), version: 1, unlimited: false });
    credits.setPrices({ requestId: randomUUID(), version: 1, image: 20, text: 2 });
    assert.deepEqual(credits.overview().usage, overview.usage, '模式和点值变更不重算历史用量');
    credits.resolve(pendingFinite, { requestId: randomUUID(), decision: 'refund', reason: '确认未生成' });
    credits.resolve(pendingUnlimited, { requestId: randomUUID(), decision: 'charge', reason: '确认已完成' });
    assert.deepEqual(credits.overview().pendingReview, { total: 0, codeCount: 0, reserved: 0, codes: [] });
    assert.equal(credits.overview().usage.points, 42);
    assert.equal(credits.overview().usage.deducted, 31);
    credits.create({ requestId: randomUUID(), note: '分页记录', initialPoints: 0, count: 35 });
    assert.equal(credits.list().codes.length, 30);
    assert.equal(credits.overview().accessCodes.total, 38, '概览汇总全量访问码');
    assert.deepEqual(credits.overview(), credits.overview(), '只读统计不改变账本状态');
  } finally { store.close(); }
});

test('仪表盘接口仅授权管理员, 返回真实风格统计且不返回凭据或用户作品', async () => {
  const app = await startHarness();
  try {
    assert.equal((await app.api('/api/admin/overview')).status, 401);
    const userCookie = await app.login();
    assert.equal((await app.api('/api/admin/overview', { cookie: userCookie })).status, 401);
    const request = () => app.api('/api/admin/overview', { cookie: app.adminCookie });
    const result = await request();
    assert.equal(result.status, 200);
    assert.equal(result.data.styles.total, 36);
    assert.equal(result.data.styles.published, 36);
    assert.equal(result.data.styles.recent.length, 4);
    assert.equal(result.data.usage.points, 0);
    assert.equal(result.data.usagePeriods.today.points, 0);
    assert.equal(result.data.usagePeriods.month.points, 0);
    assert.equal(result.data.activity.days.length, 365);
    assert.equal(result.data.activity.timeZone, 'Asia/Shanghai');
    assert.ok(result.data.activity.days.every((day) => day.images === 0 && day.texts === 0 && day.points === 0));
    assert.equal(result.data.accessCodes.total, 1);
    assert.ok(result.data.updatedAt > 0);
    assert.doesNotMatch(JSON.stringify(result.data), /code_hash|apiKey|request_hash|user_id|prompt|imageDataUrl|b64_json/);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    const { data: catalog } = await app.api('/api/admin/styles', { cookie: app.adminCookie });
    const style = catalog.styles[0];
    const input = Object.fromEntries(['name', 'prompt', 'author', 'category', 'sourceUrl', 'sortOrder', 'version'].map((key) => [key, style[key]]));
    const changed = await app.api(`/api/admin/styles/${style.id}`, { cookie: app.adminCookie, method: 'PUT', body: { ...input, published: false } });
    assert.equal(changed.status, 200);
    const latest = (await request()).data;
    assert.equal(latest.styles.published, 35);
    assert.equal(latest.styles.hidden, 1);
    assert.equal(latest.styles.recent[0].id, style.id);
    assert.equal(latest.styles.recent[0].published, false);
    assert.equal((await app.api('/api/admin/overview', { cookie: app.adminCookie, method: 'POST', body: {} })).status, 404);
    assert.equal(app.calls.length, 0, '读取后台统计不调用上游');
  } finally { await app.close(); }
});

test('日/月用量与 365 天热力图按北京时间的稳定结算日期统计, 覆盖闰日和年界', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2023-03-02T23:59:59.999+08:00') });
  const store = createStateStore(':memory:');
  const credits = store.credits;
  const at = (date) => t.mock.timers.setTime(Date.parse(date));
  const create = (unlimited = false) => credits.create({ requestId: randomUUID(), initialPoints: unlimited ? 0 : 1000, unlimited }).codes[0];
  const finite = create(), unlimited = create(true);
  function reserve(kind = 'image', access = finite) {
    const { session } = store.identities.login(access.code);
    const requestId = randomUUID();
    const creditQuote = { accessCodeId: access.id, userId: session.userId, unlimited: access.unlimited, version: credits.prices().version };
    if (kind !== 'image') return credits.reserveText({ requestId, kind, creditQuote }, session, requestId).id;
    const job = { id: `img_${requestId}`, requestId, requestHash: requestId, userId: session.userId, status: 'pending', queuedAt: Date.now(), submission: { creditQuote } };
    store.acceptImageJobs([job], session); return job.creditId;
  }
  try {
    credits.settle(reserve(), 'charged');
    at('2023-03-03T00:00:00.000+08:00'); credits.settle(reserve('series'), 'charged');
    at('2024-02-28T12:00:00+08:00'); const unknown = reserve('series'); credits.settle(unknown, 'unknown');
    at('2024-02-29T23:59:59.999+08:00');
    const leap = reserve(); credits.settle(leap, 'charged');
    const crossesMonth = reserve();
    at('2024-03-01T00:00:00.000+08:00'); credits.settle(crossesMonth, 'charged');
    at('2024-03-01T00:01:00+08:00'); credits.settle(reserve('prompt', unlimited), 'charged');
    credits.resolve(unknown, { requestId: randomUUID(), decision: 'charge', reason: '按核实结算日期统计' });
    credits.settle(reserve(), 'refunded'); credits.settle(reserve(), 'unknown');
    credits.settle(leap, 'charged');
    credits.setPrices({ requestId: randomUUID(), version: 1, image: 25, text: 3 });
    credits.update(unlimited.id, { requestId: randomUUID(), version: 1, unlimited: false });
    credits.remove(unlimited.id, { requestId: randomUUID(), version: 2 });
    credits.pruneResults(); store.deleteJob(leap);
    const report = credits.overview();
    assert.deepEqual(report.usage, { images: 3, texts: 3, imagePoints: 30, textPoints: 3, points: 33, deducted: 32 });
    assert.deepEqual(report.usagePeriods.today, { images: 1, texts: 2, imagePoints: 10, textPoints: 2, points: 12, deducted: 11 });
    assert.deepEqual(report.usagePeriods.month, report.usagePeriods.today);
    assert.equal(report.activity.startDate, '2023-03-03');
    assert.equal(report.activity.endDate, '2024-03-01');
    assert.equal(report.activity.days.length, 365);
    assert.equal(new Set(report.activity.days.map((day) => day.date)).size, 365);
    const day = (date) => report.activity.days.find((item) => item.date === date);
    assert.deepEqual(day('2023-03-03'), { date: '2023-03-03', images: 0, texts: 1, points: 1 });
    assert.deepEqual(day('2024-02-29'), { date: '2024-02-29', images: 1, texts: 0, points: 10 });
    assert.deepEqual(day('2024-02-28'), { date: '2024-02-28', images: 0, texts: 0, points: 0 });
    assert.equal(report.activity.days.reduce((sum, item) => sum + item.points, 0), 23);
    assert.equal(report.pendingReview.total, 1);
    at('2024-03-02T00:00:00+08:00');
    assert.equal(credits.overview().usagePeriods.today.points, 0);
    assert.equal(credits.overview().usagePeriods.month.points, 12);
    assert.deepEqual(credits.overview().usage, report.usage);
    at('2025-01-01T00:00:00+08:00');
    assert.equal(credits.overview().usagePeriods.month.points, 0);
    assert.equal(credits.overview().activity.endDate, '2025-01-01');
    assert.deepEqual(credits.overview().usage, report.usage);
  } finally { store.close(); }
});
