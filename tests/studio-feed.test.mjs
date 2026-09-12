import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/studio-feed.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { selectStudioFeed } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const job = (id, batchId, queuedAt, status = 'pending', fields = {}) => ({ id: `job-${id}`, requestId: `req-${id}`, status, queuedAt, clientContext: { placeholderId: id, batchId, kind: 'single' }, ...fields });
const record = (id, submittedAt, fields = {}) => ({ id, kind: 'single', createdAt: submittedAt + 100, submittedAt, requestId: `req-${id}`, jobId: `job-${id}`, ...fields });
const keys = (entries) => entries.map((entry) => entry.key);

test('画卷最多四格, 保持当前四图批次和成功保存过程的位置', () => {
  const current = ['a', 'b', 'c', 'd'].map((id) => job(id, 'new', 1000));
  const older = Array.from({ length: 12 }, (_, index) => record(`old-${index}`, index));
  const initial = selectStudioFeed(current, older);
  assert.deepEqual(keys(initial), ['a', 'b', 'c', 'd']);
  const partial = current.map((value, index) => ({ ...value, status: index === 0 ? 'succeeded' : index === 1 ? 'failed' : 'pending' }));
  assert.deepEqual(keys(selectStudioFeed(partial, older)), keys(initial), '未保存的成功结果保留原格');
  const saved = record('a', 1000, { batchId: 'new' });
  const merged = selectStudioFeed(partial, [...older, saved]);
  assert.deepEqual(keys(merged), keys(initial));
  assert.equal(merged[0].kind, 'result');
  assert.equal(merged[1].job.status, 'failed');
  assert.equal(merged.filter((entry) => entry.key === 'a').length, 1, '保存与队列状态交叠时不重复占位');
});

test('小批次以最近作品补位, 较早任务留在队列, 所有源记录完整保留', () => {
  const jobs = [job('active', 'current', 100), job('older-failure', 'previous', 80, 'failed'), job('queued', 'earlier', 50)];
  const records = [1, 2, 3, 4, 5].map((time) => record(`saved-${time}`, time));
  assert.deepEqual(keys(selectStudioFeed(jobs, records)), ['active', 'saved-5', 'saved-4', 'saved-3']);
  assert.equal(jobs.length, 3); assert.equal(records.length, 5);
});

test('迟到的旧批次结果不挤走当前批次, 清理任务历史后排序仍一致', () => {
  const recent = ['a', 'b', 'c', 'd'].map((id, index) => record(id, 100, { batchId: 'current', createdAt: 200 + index }));
  const late = record('late', 50, { batchId: 'old', createdAt: 1000 });
  assert.deepEqual(keys(selectStudioFeed([], [...recent, late])), ['a', 'b', 'c', 'd']);
  assert.deepEqual(keys(selectStudioFeed(recent.map((value) => job(value.id, 'current', 100, 'succeeded', { acknowledgedAt: 300 })), [...recent, late])), ['a', 'b', 'c', 'd']);
});

test('失败重试和本地未确认重试不重复占位, 已消费作品删除后不恢复旧卡', () => {
  const source = job('failed', 'batch', 100, 'failed');
  const uncertain = job('local', 'batch', 200, 'unsubmitted', { localOnly: true, retryOf: source.id });
  assert.deepEqual(keys(selectStudioFeed([source, uncertain], [])), ['failed']);
  const retry = job('retry', 'batch', 200, 'running', { retryOf: source.id });
  const superseded = { ...source, supersededBy: retry.id };
  assert.deepEqual(keys(selectStudioFeed([superseded, retry], [])), ['retry']);
  assert.deepEqual(selectStudioFeed([superseded, { ...retry, status: 'succeeded', acknowledgedAt: 300 }], []), []);
  assert.deepEqual(selectStudioFeed([{ ...source, archivedAt: 300 }], []), []);
});

test('支持旧作品, 单任务多图和指定系列分镜, 其他系列不进入单图画卷', () => {
  const legacy = { id: 'legacy', kind: 'single', createdAt: 10 };
  const series = record('series', 200, { kind: 'series', sceneId: 'scene-a' });
  const unrelated = record('other', 300, { kind: 'series', sceneId: 'scene-b' });
  assert.deepEqual(keys(selectStudioFeed([], [legacy, series, unrelated])), ['legacy']);
  assert.deepEqual(keys(selectStudioFeed([], [legacy, series, unrelated], 'scene-a')), ['series', 'legacy']);
  const multiple = [record('first', 100), record('first-2', 100, { requestId: 'req-first', jobId: 'job-first' })];
  const rows = selectStudioFeed([job('first', 'batch', 100, 'running')], [legacy, ...multiple]);
  assert.deepEqual(keys(rows), ['first', 'first-2', 'legacy']);
  assert.ok(rows.every((entry) => entry.kind === 'result'));
  const batch = ['first', 'second', 'third', 'fourth'].map((id) => job(id, 'batch', 100));
  const overflowing = Array.from({ length: 5 }, (_, index) => record(index ? `first-${index + 1}` : 'first', 100, { requestId: 'req-first', jobId: 'job-first', batchId: 'batch' }));
  assert.deepEqual(keys(selectStudioFeed(batch, overflowing)), ['first', 'fourth', 'second', 'third'], '同任务的额外输出不得挤走本批其他任务');
});
