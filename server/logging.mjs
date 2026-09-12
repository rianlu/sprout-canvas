import { appendFile, mkdir, open, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function createFileLogger(filename, {
  maxBytes = 10 * 1024 * 1024,
  retainedFiles = 3,
  maxPendingBytes = 1024 * 1024,
  onError = (error) => console.error(`[日志] 文件写入失败: ${error.code || 'unknown'}`),
} = {}) {
  let pending = Promise.resolve();
  let pendingBytes = 0;
  let size;
  let reported = false;
  const file = path.resolve(filename);

  async function ignoreMissing(action) {
    try { await action(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async function initialize() {
    await mkdir(path.dirname(file), { recursive: true });
    try { size = (await stat(file)).size; }
    catch (error) { if (error.code !== 'ENOENT') throw error; size = 0; }
    if (size <= maxBytes) return;
    // Bound a pre-existing oversized log too; preserve its most recent complete lines.
    const handle = await open(file, 'r');
    const tail = Buffer.alloc(maxBytes);
    try { await handle.read(tail, 0, tail.length, size - tail.length); }
    finally { await handle.close(); }
    const newline = tail.indexOf(10);
    const recent = newline >= 0 ? tail.subarray(newline + 1) : Buffer.alloc(0);
    await writeFile(file, recent, { mode: 0o600 });
    size = recent.length;
  }

  async function rotate() {
    if (retainedFiles === 1) {
      await writeFile(file, '', { mode: 0o600 });
    } else {
      await ignoreMissing(() => unlink(`${file}.${retainedFiles - 1}`));
      for (let index = retainedFiles - 2; index >= 1; index--) {
        await ignoreMissing(() => rename(`${file}.${index}`, `${file}.${index + 1}`));
      }
      await ignoreMissing(() => rename(file, `${file}.1`));
    }
    size = 0;
  }

  return {
    write(line) {
      let bytes = Buffer.from(line);
      if (bytes.length > maxBytes) {
        const suffix = Buffer.from(' [truncated]\n');
        bytes = Buffer.concat([bytes.subarray(0, Math.max(0, maxBytes - suffix.length)), suffix]).subarray(0, maxBytes);
      }
      if (pendingBytes + bytes.length > maxPendingBytes) {
        if (!reported) onError({ code: 'LOG_BUFFER_FULL' });
        reported = true;
        return false;
      }
      pendingBytes += bytes.length;
      pending = pending.then(async () => {
        if (size === undefined) await initialize();
        if (size + bytes.length > maxBytes) await rotate();
        await appendFile(file, bytes, { mode: 0o600 });
        size += bytes.length;
        reported = false;
      }).catch((error) => {
        size = undefined;
        if (!reported) onError(error);
        reported = true;
      }).finally(() => { pendingBytes -= bytes.length; });
      return true;
    },
    flush() { return pending; },
  };
}
