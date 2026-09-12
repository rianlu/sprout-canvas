import { randomBytes, randomUUID } from 'node:crypto';
import { secretHash } from './credits-store.mjs';
import { ACCESS_CODE_PATTERN, creditError } from '../shared/credits-contract.mjs';

const BROWSER_SECONDS = 365 * 24 * 60 * 60;
export function createIdentityStore(db, transaction) {
  const columns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map((row) => row.name));
  for (const [name, type] of [['code_id', 'TEXT'], ['code_epoch', 'INTEGER'], ['browser_id', 'TEXT']]) if (!columns.has(name)) db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_keys (token_hash TEXT PRIMARY KEY, browser_id TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS browser_identities (browser_id TEXT NOT NULL, code_id TEXT NOT NULL REFERENCES access_codes(id), user_id TEXT NOT NULL UNIQUE, PRIMARY KEY(browser_id,code_id));
    CREATE INDEX IF NOT EXISTS sessions_code ON sessions(code_id);
  `);
  const token = () => randomBytes(32).toString('base64url');
  function browser(value) {
    return value && db.prepare('SELECT * FROM browser_keys WHERE token_hash=? AND expires_at>?').get(secretHash(value), Date.now());
  }
  function session(value) {
    if (!value) return null;
    const row = db.prepare(`SELECT s.*, c.enabled, c.epoch, c.note FROM sessions s JOIN access_codes c ON c.id=s.code_id WHERE s.token_hash=? AND s.expires_at>?`).get(secretHash(value), Date.now());
    return row ? { userId: row.user_id, accessCodeId: row.code_id, accessName: row.note, codeEpoch: row.code_epoch, browserId: row.browser_id, createdAt: row.created_at, expiresAt: row.expires_at, canGenerate: Boolean(row.enabled && row.epoch === row.code_epoch) } : null;
  }
  return {
    session,
    login(value, { browserToken = '', previousToken = '', sessionDays = 7 } = {}) {
      if (typeof value !== 'string' || !ACCESS_CODE_PATTERN.test(value)) throw creditError('访问码格式不正确, 请粘贴完整访问码', 'INVALID_ACCESS_CODE', 401);
      return transaction(() => {
        const code = db.prepare('SELECT * FROM access_codes WHERE code_hash=? AND enabled=1 AND deleted_at=0').get(secretHash(value));
        if (!code) throw creditError('访问码无效或已停用', 'INVALID_ACCESS_CODE', 401);
        let identity = browser(browserToken);
        if (!identity) {
          browserToken = token();
          identity = { browser_id: randomUUID(), expires_at: Date.now() + BROWSER_SECONDS * 1000 };
          db.prepare('INSERT INTO browser_keys VALUES (?,?,?)').run(secretHash(browserToken), identity.browser_id, identity.expires_at);
        }
        const previous = previousToken && db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(secretHash(previousToken), Date.now());
        let owner = db.prepare('SELECT user_id FROM browser_identities WHERE browser_id=? AND code_id=?').get(identity.browser_id, code.id);
        if (!owner) {
          // A legacy UUID is only migrated when the browser proves possession of its old session.
          const legacy = previous && previous.code_id === null && !db.prepare('SELECT 1 FROM browser_identities WHERE user_id=?').get(previous.user_id);
          owner = { user_id: legacy ? previous.user_id : randomUUID() };
          db.prepare('INSERT INTO browser_identities VALUES (?,?,?)').run(identity.browser_id, code.id, owner.user_id);
        }
        const sessionToken = token(); const now = Date.now(); const maxAge = Math.round(sessionDays * 86400);
        db.prepare('INSERT INTO sessions (token_hash,user_id,created_at,expires_at,code_id,code_epoch,browser_id) VALUES (?,?,?,?,?,?,?)').run(secretHash(sessionToken), owner.user_id, now, now + maxAge * 1000, code.id, code.epoch, identity.browser_id);
        if (previousToken) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(secretHash(previousToken));
        db.prepare('UPDATE access_codes SET last_used_at=? WHERE id=?').run(now, code.id);
        return { token: sessionToken, browserToken, maxAge, browserMaxAge: Math.max(1, Math.floor((identity.expires_at - now) / 1000)), session: session(sessionToken) };
      });
    },
    logout(value) { if (value) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(secretHash(value)); },
    prune() { db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now()); },
  };
}
