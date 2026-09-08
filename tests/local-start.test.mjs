import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startHarness, until } from './server-harness.mjs';
import { PNG_URL } from './fixtures.mjs';

test('the local entry isolates data and credentials without touching deployment config', async () => {
  const app = await startHarness();
  const local = await mkdtemp(path.join(tmpdir(), 'sprout-local-entry-'));
  let child, output = '';
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exited;
  }
  async function start(extra = {}) {
    output = '';
    child = spawn(process.execPath, ['server/local.mjs'], {
      cwd: app.directory,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(app.config.port), DATA_DIR: local, STATE_FILE: path.join(app.directory, 'must-not-write.sqlite'), HOST: '0.0.0.0', ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    await until(async () => {
      if (child.exitCode !== null) throw new Error(output);
      try { return (await fetch(app.base + '/ready')).ok; } catch { return false; }
    }, 'isolated local entry');
  }
  try {
    await app.stop();
    const originalConfig = await readFile(path.join(app.directory, 'config/local.config.json'));
    await start();
    const passwordFile = path.join(local, 'admin-password.txt');
    const password = (await readFile(passwordFile, 'utf8')).trim();
    assert.ok(password.length >= 32);
    assert.equal((await stat(passwordFile)).mode & 0o777, 0o600);
    assert.ok(!output.includes(password));
    assert.ok(output.includes('http://127.0.0.1:' + app.config.port + '/#admin'));
    assert.ok(existsSync(path.join(local, 'runtime.sqlite')));
    assert.ok(existsSync(path.join(local, 'styles/library.sqlite')));
    assert.ok(!existsSync(path.join(app.directory, 'must-not-write.sqlite')));
    const login = await app.api('/api/admin/auth/login', { method: 'POST', body: { password } });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /^sprout_admin_local_[a-f0-9]{16}=/);
    const userCookie = await app.login();
    assert.match(userCookie, /^img_auth_max_local_[a-f0-9]{16}=/);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await app.api('/api/admin/styles', { cookie, method: 'POST', body: { prompt: '只属于本机测试的模板', imageDataUrl: PNG_URL } })).status, 201);
    await stop(); await start();
    assert.equal((await readFile(passwordFile, 'utf8')).trim(), password);
    assert.equal((await app.api('/api/admin/styles', { cookie })).data.styles.length, 37);
    assert.deepEqual(await readFile(path.join(app.directory, 'config/local.config.json')), originalConfig);
    await stop();
    const explicitDirectory = path.join(local, 'explicit-password');
    const explicitPassword = 'explicit-local-admin-password';
    await start({ DATA_DIR: explicitDirectory, ADMIN_PASSWORD: explicitPassword });
    assert.ok(!existsSync(path.join(explicitDirectory, 'admin-password.txt')));
    assert.ok(output.includes('使用 ADMIN_PASSWORD 环境变量'));
    assert.ok(!output.includes('管理员密码文件:'));
    assert.ok(!output.includes(explicitPassword));
    assert.equal((await app.api('/api/admin/auth/login', { method: 'POST', body: { password: explicitPassword } })).status, 200);
    assert.equal(app.calls.length, 0);
  } finally { await stop(); await app.close(); }
});
