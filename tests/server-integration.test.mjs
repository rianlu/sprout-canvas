import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startHarness, until } from './server-harness.mjs';
import { PNG_BASE64, PNG_URL, MASK_URL, png, submission } from './fixtures.mjs';

const app = await startHarness();
let cookie;
const api = (url, options = {}) => {
  const owner = options.cookie || cookie;
  const body = options.body?.request && owner ? { ...options.body, creditQuote: options.body.creditQuote || app.quote(owner) } : options.body;
  return app.api(url, { cookie, ...options, ...(body !== undefined ? { body } : {}) });
};
async function submit(input, owner = cookie) {
  const result = await api('/api/jobs', { method: 'POST', body: input, cookie: owner });
  assert.equal(result.status, 202, JSON.stringify(result.data));
  return result.data;
}
async function finished(id, owner = cookie) {
  return until(async () => { const response = await api(`/api/jobs/${id}`, { cookie: owner }); return !['pending', 'running'].includes(response.data.status) && response.data; }, `job ${id}`);
}
try {
  assert.equal((await api('/api/auth/status', { headers: { Cookie: 'img_auth_max=%E0%A4%A' } })).status, 400);
  assert.equal((await api('/health')).status, 200);
  for (const rawBody of ['{', 'null', '[]']) assert.equal((await api('/api/auth/login', { method: 'POST', rawBody })).status, 400);
  assert.equal((await api('/api/auth/login', { method: 'POST', rawBody: JSON.stringify({ password: 'a'.repeat(17000) }) })).status, 413);
  assert.equal((await api('/api/jobs/me')).status, 401);
  cookie = await app.login();
  const otherCookie = await app.login('00000000-0000-4000-8000-000000000002');
  const publicConfig = await api('/api/config');
  assert.equal(publicConfig.data.imageConcurrency, 1);
  assert.equal(publicConfig.data.imageChannels[0].status, 'untested');
  assert.doesNotMatch(JSON.stringify(publicConfig.data), /fixture-primary-key|fixture-text-key|apiKey/);
  for (const endpoint of ['/api/images/generations', '/api/jobs/images/generations', '/api/responses', '/api/models']) assert.equal((await api(endpoint, { method: 'POST', body: {} })).status, 404);
  for (const body of [submission('bad-control', { seed: 1 }), submission('bad-size', { size: '512x512' }), submission('bad-alpha', { background: 'transparent', outputFormat: 'jpeg' }), submission('bad-image', { references: [{ id: 'ref', name: 'ref', dataUrl: 'data:image/png;base64,ZmFrZQ==' }] }), submission('bad-mask', { references: [{ id: 'ref', name: 'ref', dataUrl: PNG_URL }], mask: `data:image/png;base64,${png(3, 3).toString('base64')}` })]) assert.equal((await api('/api/jobs', { method: 'POST', body })).status, 400);
  assert.equal(app.calls.length, 0);

  const original = submission('once');
  const once = await submit(original);
  assert.equal((await submit(original)).id, once.id);
  assert.equal((await api('/api/jobs', { method: 'POST', body: { ...original, request: { ...original.request, prompt: '不同内容' } } })).status, 409);
  assert.equal((await finished(once.id)).status, 'succeeded');
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].json.model, 'gpt-image-2');
  assert.equal((await api(`/api/jobs/${once.id}`, { cookie: otherCookie })).status, 404);
  const result = await api(`/api/jobs/${once.id}/result`);
  assert.equal(result.data.data[0].width, 2);
  assert.equal(result.data.data[0].mime_type, 'image/png');
  assert.equal((await api(`/api/jobs/${once.id}/ack`, { method: 'POST' })).status, 200);
  assert.equal((await api(`/api/jobs/${once.id}/result`)).status, 410);
  assert.equal((await api('/api/config')).data.imageChannels[0].status, 'available');

  const edit = await submit(submission('edit', { references: [{ id: 'ref', name: 'ref.png', dataUrl: PNG_URL }], mask: MASK_URL, outputFormat: 'webp', background: 'transparent' }));
  assert.equal((await finished(edit.id)).status, 'succeeded');
  const editCall = app.calls.at(-1);
  assert.match(editCall.path, /images\/edits$/);
  assert.match(editCall.headers['content-type'], /multipart\/form-data/);
  assert.match(editCall.body.toString('latin1'), /name="mask"; filename=/);
  assert.match(editCall.body.toString('latin1'), /name="output_format"\r\n\r\nwebp/);
  assert.equal((await api(`/api/jobs/${edit.id}/result`)).data.data[0].mime_type, 'image/png');
  await api(`/api/jobs/${edit.id}/ack`, { method: 'POST' });

  // A claimed anchor can be replayed from its exact browser copy without generating it again.
  const dependent = { ...submission('dependent'), referenceJobId: original.requestId, referenceImage: { id: once.clientContext.placeholderId, recordId: once.clientContext.placeholderId, name: '首镜', dataUrl: PNG_URL } };
  const dependentJob = await submit(dependent);
  assert.equal((await finished(dependentJob.id)).status, 'succeeded');
  assert.equal((await submit({ ...dependent, referenceImage: undefined })).id, dependentJob.id);
  assert.equal((await api('/api/jobs', { method: 'POST', body: { ...dependent, requestId: 'bad-snapshot', referenceImage: { ...dependent.referenceImage, dataUrl: MASK_URL } } })).status, 409);
  await api(`/api/jobs/${dependentJob.id}/ack`, { method: 'POST' });

  // Keep the worker occupied to inspect fairness, pending edits and user-local priority.
  let release;
  app.controls.respond = async (call) => {
    if (call.json?.prompt === 'hold-fair') await new Promise((resolve) => { release = resolve; });
    return false;
  };
  const hold = await submit(submission('hold-fair', { prompt: 'hold-fair' }));
  await until(() => release, 'held worker');
  const firstPending = await submit(submission('pending-first'));
  const secondPending = await submit(submission('pending-second'));
  const otherPending = await submit(submission('other-pending'), otherCookie);
  assert.equal((await api(`/api/jobs/${hold.id}`, { method: 'DELETE' })).status, 409);
  assert.equal((await api(`/api/jobs/${secondPending.id}/priority`, { method: 'POST', cookie: otherCookie })).status, 404);
  assert.equal((await api(`/api/jobs/${secondPending.id}/priority`, { method: 'POST' })).data.yourPosition, 1);
  const changed = submission('pending-second', { prompt: 'edited-before-start', quality: 'high' });
  assert.equal((await api(`/api/jobs/${secondPending.id}`, { method: 'PATCH', body: changed })).status, 200);
  assert.equal((await submit(changed)).id, secondPending.id);
  const callOffset = app.calls.length;
  release(); app.controls.respond = null;
  await finished(firstPending.id); await finished(otherPending.id, otherCookie);
  assert.equal(app.calls[callOffset].json.prompt, '画一片叶子');
  assert.equal(app.calls[callOffset + 1].json.prompt, 'edited-before-start');
  assert.equal(app.calls[callOffset + 1].json.quality, 'high');
  for (const job of [hold, firstPending, secondPending]) await api(`/api/jobs/${job.id}/ack`, { method: 'POST' });

  // More than 50 active jobs must remain visible even with a one-item history page.
  release = undefined;
  app.controls.respond = async (call) => { if (call.json?.prompt === 'hold-many') await new Promise((resolve) => { release = resolve; }); return false; };
  const manyHold = await submit(submission('hold-many', { prompt: 'hold-many' }));
  await until(() => release, 'held capacity worker');
  const pending = [];
  for (let index = 0; index < 32; index++) pending.push(await submit(submission(`capacity-${index}`)));
  assert.equal((await api('/api/jobs', { method: 'POST', body: submission('capacity-overflow') })).status, 429);
  const other = [];
  for (let index = 0; index < 28; index++) other.push(await submit(submission(`other-capacity-${index}`), otherCookie));
  const active = await api('/api/jobs/me?limit=1');
  assert.equal(active.data.jobs.filter((job) => ['running', 'pending'].includes(job.status)).length, 33);
  assert.equal(active.data.globalQueued, 60);
  assert.ok(active.data.jobs.some((job) => job.id === manyHold.id));
  for (const job of pending) assert.equal((await api(`/api/jobs/${job.id}`, { method: 'DELETE' })).status, 200);
  for (const job of other) await api(`/api/jobs/${job.id}`, { method: 'DELETE', cookie: otherCookie });
  release(); app.controls.respond = null;
  await finished(manyHold.id); await api(`/api/jobs/${manyHold.id}/ack`, { method: 'POST' });
  let cursor = '', count = 0;
  const historyIds = new Set();
  do {
    const page = await api(`/api/jobs/me?limit=5${cursor ? `&cursor=${cursor}` : ''}`);
    for (const job of page.data.jobs) { assert.equal(historyIds.has(job.id), false); historyIds.add(job.id); count++; }
    cursor = page.data.historyCursor;
  } while (cursor);
  assert.ok(count > 32);
  assert.equal((await api(`/api/jobs/me?limit=1&requests=${once.requestId}`)).data.jobs.some((job) => job.id === once.id), true);
  await api('/api/jobs/archive', { method: 'POST' });
  assert.equal((await api('/api/jobs/me')).data.jobs.length, 0);

  // Unclaimed results are sync data and must never be truncated by history paging.
  const unclaimedMany = [];
  for (let index = 0; index < 51; index++) {
    const job = await submit(submission(`unclaimed-${index}`));
    assert.equal((await finished(job.id)).status, 'succeeded');
    unclaimedMany.push(job);
  }
  const unclaimedPage = await api('/api/jobs/me?limit=1');
  assert.equal(unclaimedPage.data.jobs.length, 51);
  assert.ok(unclaimedMany.every((job) => unclaimedPage.data.jobs.some((item) => item.id === job.id && !item.acknowledgedAt)));
  for (const job of unclaimedMany) await api(`/api/jobs/${job.id}/ack`, { method: 'POST' });
  await api('/api/jobs/archive', { method: 'POST' });

  // An ambiguous generation response must not trigger a second paid request.
  app.controls.respond = async (_call, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[{"b64_json":"YmFk"}]}'); return true; };
  const beforeMalformed = app.calls.length;
  const malformed = await submit(submission('malformed-upstream'));
  const malformedDone = await finished(malformed.id);
  assert.equal(malformedDone.status, 'failed'); assert.equal(malformedDone.outcomeUnknown, true);
  assert.equal(app.calls.length, beforeMalformed + 1);

  app.controls.respond = async (call, res) => {
    if (!call.path.startsWith('/primary/')) return false;
    res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `invalid_request_error, rejected ${call.headers.authorization}` })); return true;
  };
  const forcedInput = { ...submission('forced-failure'), providerId: 'primary' };
  const forced = await submit(forcedInput);
  const forcedFailure = await finished(forced.id);
  assert.equal(forcedFailure.status, 'failed');
  assert.equal(forcedFailure.supersededBy, '');
  assert.doesNotMatch(JSON.stringify(forcedFailure), /fixture-primary-key/);
  assert.match(forcedFailure.error, /\[redacted\]/);
  const retryInput = { ...submission('manual-retry'), retryOf: forced.id };
  assert.equal((await api('/api/jobs', { method: 'POST', body: retryInput, cookie: otherCookie })).status, 404);
  assert.equal((await api(`/api/jobs/${forced.id}`)).data.supersededBy, '', 'a rejected retry must not supersede its source');
  const retry = await submit(retryInput);
  assert.equal((await submit(retryInput)).id, retry.id, 'retry delivery is idempotent');
  assert.equal((await api('/api/jobs', { method: 'POST', body: { ...retryInput, requestId: 'duplicate-manual-retry' } })).status, 409, 'one failed attempt cannot produce duplicate retries');
  const superseded = (await api(`/api/jobs/${forced.id}`)).data;
  assert.equal(superseded.status, 'failed', 'retain the original failure for history');
  assert.equal(superseded.supersededBy, retry.id);
  assert.equal(superseded.canRetry, false);
  assert.equal((await finished(retry.id)).status, 'succeeded');
  assert.match(app.calls.at(-1).path, /^\/secondary\//);
  await api(`/api/jobs/${retry.id}/ack`, { method: 'POST' });
  await api('/api/jobs/archive', { method: 'POST' });
  const retryHistory = (await api(`/api/jobs/me?limit=1&requests=${forced.requestId}`)).data.jobs;
  assert.equal(retryHistory.find((job) => job.id === forced.id).supersededBy, retry.id, 'retry association survives when the successor is outside visible history');
  assert.ok(!retryHistory.some((job) => job.id === retry.id));
  app.controls.respond = null;

  // Crash recovery persists intent metadata, not request images or the result bytes.
  const unclaimed = await submit(submission('unclaimed'));
  await finished(unclaimed.id);
  release = undefined;
  app.controls.respond = async (call) => { if (call.json?.prompt === 'hold-restart') await new Promise((resolve) => { release = resolve; }); return false; };
  const runningInput = submission('running-restart', { prompt: 'hold-restart' });
  const running = await submit(runningInput);
  await until(() => release, 'held restart worker');
  const waitingInput = submission('waiting-restart');
  const waiting = await submit(waitingInput);
  const beforeRestart = app.calls.length;
  await app.stop('SIGKILL');
  release(); app.controls.respond = null;
  await app.start();
  assert.equal((await api('/api/auth/status')).data.authenticated, true);
  assert.equal((await api(`/api/jobs/${forced.id}`)).data.supersededBy, retry.id, 'derive retry association from durable metadata after restart');
  assert.equal((await api('/api/jobs', { method: 'POST', body: { ...retryInput, requestId: 'duplicate-after-restart' } })).status, 409);
  assert.equal((await api(`/api/jobs/${running.id}`)).data.outcomeUnknown, true);
  assert.equal((await api(`/api/jobs/${waiting.id}`)).data.interruptionReason, 'pending-restart');
  assert.equal((await api(`/api/jobs/${unclaimed.id}`)).data.status, 'expired');
  assert.equal((await submit(runningInput)).id, running.id);
  assert.equal(app.calls.length, beforeRestart);
  assert.equal((await api(`/api/jobs/${running.id}/resume`, { method: 'POST', body: runningInput })).status, 409);
  assert.equal((await api(`/api/jobs/${waiting.id}/resume`, { method: 'POST', body: waitingInput })).status, 202);
  assert.equal((await finished(waiting.id)).status, 'succeeded');
  const db = new DatabaseSync(path.join(app.directory, 'data/runtime.sqlite'));
  const saved = JSON.stringify(db.prepare('SELECT * FROM jobs').all());
  assert.doesNotMatch(saved, /data:image|fixture-primary-key|b64_json/);
  const tokens = JSON.stringify(db.prepare('SELECT * FROM sessions').all());
  assert.equal(tokens.includes(cookie.split('=')[1]), false);
  db.close();
  const databaseBytes = await readFile(path.join(app.directory, 'data/runtime.sqlite'));
  assert.equal(databaseBytes.includes(Buffer.from(PNG_BASE64)), false);
  assert.equal((await api('/api/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await api('/api/jobs/me')).status, 401);
  assert.equal((await api('/health')).status, 200);
  console.log('HTTP, idempotency, fairness, paging, edits, acknowledgements and restart recovery passed');
} catch (error) {
  console.error(app.logs());
  throw error;
} finally {
  await app.close();
}
