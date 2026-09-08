import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

// Keep local manual testing separate from the Compose bind mounts and browser origin.
const directory = path.resolve(process.env.DATA_DIR || path.join(homedir(), '.local/share/sprout-canvas/local'));
mkdirSync(directory, { recursive: true, mode: 0o700 });
const passwordFile = path.join(directory, 'admin-password.txt');
const passwordFromEnvironment = Boolean(process.env.ADMIN_PASSWORD);
if (!passwordFromEnvironment) {
  try { writeFileSync(passwordFile, `${randomBytes(24).toString('base64url')}\n`, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  process.env.ADMIN_PASSWORD = readFileSync(passwordFile, 'utf8').trim();
}
process.env.NODE_ENV = 'development';
process.env.HOST = '127.0.0.1';
process.env.PORT ||= '8789';
process.env.DATA_DIR = directory;
process.env.COOKIE_NAMESPACE = 'local_' + createHash('sha256').update(directory).digest('hex').slice(0, 16);
process.env.STATE_FILE = path.join(directory, 'runtime.sqlite');
process.env.LOG_FILE = path.join(directory, 'server.log');
process.env.SECURE_COOKIES = 'false';
console.log(`本机数据目录: ${directory}`);
console.log(`管理入口: http://127.0.0.1:${process.env.PORT}/#admin`);
console.log(passwordFromEnvironment ? '管理员密码: 使用 ADMIN_PASSWORD 环境变量' : `管理员密码文件: ${passwordFile}`);
await import('../server.mjs');
