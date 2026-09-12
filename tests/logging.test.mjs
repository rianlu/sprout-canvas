import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, stat, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileLogger } from '../server/logging.mjs';

test('concurrent log writes retain the newest complete lines within file and count limits', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sprout-log-rotation-'));
  const filename = path.join(directory, 'server.log');
  const errors = [];
  const options = { maxBytes: 64, retainedFiles: 3, onError: (error) => errors.push(error) };
  const logger = createFileLogger(filename, options);
  const lines = Array.from({ length: 30 }, (_, index) => `日志 ${String(index).padStart(2, '0')} 内容\n`);
  for (const line of lines) assert.equal(logger.write(line), true);
  await logger.flush();
  assert.deepEqual((await readdir(directory)).sort(), ['server.log', 'server.log.1', 'server.log.2']);
  let retained = '';
  for (const name of ['server.log.2', 'server.log.1', 'server.log']) {
    assert.ok((await stat(path.join(directory, name))).size <= 64);
    retained += await readFile(path.join(directory, name), 'utf8');
  }
  assert.ok(lines.join('').endsWith(retained));
  assert.ok(retained.endsWith(lines.at(-1)));
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  const restarted = createFileLogger(filename, options);
  restarted.write('after restart\n');
  await restarted.flush();
  assert.match(await readFile(filename, 'utf8'), /after restart/);
  assert.deepEqual(errors, []);
});

test('oversized existing files and individual records cannot exceed the log budget', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sprout-log-size-'));
  const filename = path.join(directory, 'server.log');
  await writeFile(filename, 'old line\n'.repeat(100) + 'latest old line\n');
  const logger = createFileLogger(filename, { maxBytes: 64, retainedFiles: 3 });
  logger.write('new line\n');
  await logger.flush();
  const retained = (await readFile(`${filename}.1`, 'utf8')) + (await readFile(filename, 'utf8'));
  assert.match(retained, /latest old line\nnew line/);
  logger.write('x'.repeat(1000) + '\n');
  await logger.flush();
  for (const name of await readdir(directory)) assert.ok((await stat(path.join(directory, name))).size <= 64);
  assert.match(await readFile(filename, 'utf8'), /truncated/);
});

test('file logging reports failures, recovers, and bounds queued data', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sprout-log-recovery-'));
  const parent = path.join(directory, 'blocked');
  await writeFile(parent, 'not a directory');
  const errors = [];
  const filename = path.join(parent, 'server.log');
  const logger = createFileLogger(filename, { onError: (error) => errors.push(error.code) });
  logger.write('first\n'); logger.write('second\n');
  await logger.flush();
  assert.equal(errors.length, 1);
  await unlink(parent);
  logger.write('recovered\n'); await logger.flush();
  assert.equal(await readFile(filename, 'utf8'), 'recovered\n');

  const queuedErrors = [];
  const bounded = createFileLogger(path.join(directory, 'bounded.log'), { maxPendingBytes: 12, onError: (error) => queuedErrors.push(error.code) });
  assert.equal(bounded.write('12345\n'), true);
  assert.equal(bounded.write('67890\n'), true);
  assert.equal(bounded.write('drop\n'), false);
  await bounded.flush();
  assert.deepEqual(queuedErrors, ['LOG_BUFFER_FULL']);
  assert.equal(await readFile(path.join(directory, 'bounded.log'), 'utf8'), '12345\n67890\n');
  assert.equal(bounded.write('next\n'), true);
  await bounded.flush();
});
