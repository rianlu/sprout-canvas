import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const JOB_FIELDS = ['id', 'userId', 'requestId', 'requestHash', 'status', 'clientContext', 'recipe', 'providerId', 'providerName', 'retryOf', 'referenceJobId', 'queuedAt', 'startedAt', 'finishedAt', 'error', 'acknowledgedAt', 'archivedAt', 'outcomeUnknown', 'interruptionReason', 'attemptedProviderIds', 'outputImageHash'];

export function submissionHash(input) {
  // A verified copy of a previous result is transport data, not a new generation intent.
  const { referenceImage: _snapshot, ...intent } = input;
  return createHash('sha256').update(JSON.stringify(intent)).digest('hex');
}

export function createStateStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_id TEXT, metadata TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_request ON jobs(user_id, request_id) WHERE request_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  `);
  const putJob = db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata, updated_at=excluded.updated_at');
  const putSession = db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)');
  const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
  const store = {
    saveJob(job) {
      const metadata = Object.fromEntries(JOB_FIELDS.filter((key) => job[key] !== undefined).map((key) => [key, job[key]]));
      const serialized = JSON.stringify(metadata);
      // Never persist reference images, masks, request bodies, output images or API credentials.
      if (/data:image\/[^;]+;base64,/i.test(serialized)) throw new Error('任务元信息不能包含图片数据');
      putJob.run(job.id, job.userId, job.requestId || null, serialized, Date.now());
    },
    loadJobs() { return db.prepare('SELECT metadata FROM jobs ORDER BY updated_at').all().map((row) => JSON.parse(row.metadata)); },
    deleteJob(id) { db.prepare('DELETE FROM jobs WHERE id = ?').run(id); },
    createSession(token, session) { putSession.run(tokenHash(token), session.userId, session.createdAt, session.expiresAt); },
    getSession(token) {
      const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash(token), Date.now());
      return row ? { userId: row.user_id, createdAt: row.created_at, expiresAt: row.expires_at } : null;
    },
    deleteSession(token) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token)); },
    prune() {
      db.prepare('DELETE FROM jobs WHERE updated_at < ?').run(Date.now() - RETENTION_MS);
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    },
    close() { db.close(); },
  };
  store.prune();
  return store;
}
