import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/queue-presentation.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { queueElapsedMs, formatQueueDuration, personalQueuePosition } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('使用服务端时间和浏览器单调时钟, 无需等下一次轮询或信任设备时间', () => {
  const serverNow = 1_700_000_000_000;
  const job = { status: 'pending', serverNow, queuedAt: serverNow - 45_000, startedAt: 0, finishedAt: 0, receivedAt: 500 };
  assert.equal(queueElapsedMs(job, 500), 45_000);
  assert.equal(queueElapsedMs(job, 1500), 46_000);
  assert.equal(queueElapsedMs(job, 2500), 47_000);
  assert.equal(queueElapsedMs(job, 65_500), 110_000, 'background suspension does not lose elapsed time');
  assert.equal(queueElapsedMs({ ...job, status: 'running', startedAt: serverNow - 3000 }, 1500), 4000, 'rendering starts its own stage clock');
  assert.equal(queueElapsedMs({ ...job, status: 'succeeded', startedAt: serverNow - 3000, finishedAt: serverNow }, 999_000), 3000, 'finished duration never keeps ticking');
});

test('个人顺序不暗示全站名次, 秒数跨分钟与小时正确显示', () => {
  assert.equal(personalQueuePosition(1), '我的待生成第 1 张');
  assert.equal(personalQueuePosition(0), '已加入我的待生成');
  assert.equal(formatQueueDuration(-10), '0 秒');
  assert.equal(formatQueueDuration(59_999), '59 秒');
  assert.equal(formatQueueDuration(60_000), '1 分 00 秒');
  assert.equal(formatQueueDuration(3_661_000), '1 时 01 分 01 秒');
});
