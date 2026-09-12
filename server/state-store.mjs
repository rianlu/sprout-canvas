import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createCreditsStore } from './credits-store.mjs';
import { createIdentityStore } from './identity-store.mjs';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const JOB_FIELDS = ['id', 'userId', 'requestId', 'requestHash', 'status', 'clientContext', 'recipe', 'providerId', 'providerName', 'retryOf', 'referenceJobId', 'queuedAt', 'startedAt', 'finishedAt', 'error', 'acknowledgedAt', 'archivedAt', 'outcomeUnknown', 'interruptionReason', 'attemptedProviderIds', 'outputImageHash', 'creditId', 'accessCodeId', 'codeEpoch'];

export function submissionHash(input) {
  // A verified copy of a previous result is transport data, not a new generation intent.
  const { referenceImage: _snapshot, creditQuote: _quote, ...intent } = input;
  return createHash('sha256').update(JSON.stringify(intent)).digest('hex');
}

export function createStateStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_id TEXT, metadata TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_request ON jobs(user_id, request_id) WHERE request_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_state (id INTEGER PRIMARY KEY CHECK(id=1), credential_hash TEXT NOT NULL);
  `);
  const putJob = db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata, updated_at=excluded.updated_at');
  let transactionDepth = 0;
  function transaction(action) {
    if (transactionDepth) return action();
    db.exec('BEGIN IMMEDIATE'); transactionDepth++;
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { transactionDepth--; }
  }
  const credits = createCreditsStore(db, transaction);
  const identities = createIdentityStore(db, transaction);
  const store = {
    credits, identities, transaction,
    saveJob(job) {
      const metadata = Object.fromEntries(JOB_FIELDS.filter((key) => job[key] !== undefined).map((key) => [key, job[key]]));
      const serialized = JSON.stringify(metadata);
      // Never persist reference images, masks, request bodies, output images or API credentials.
      if (/data:image\/[^;]+;base64,/i.test(serialized)) throw new Error('任务元信息不能包含图片数据');
      transaction(() => {
        credits.reconcileJob(job);
        putJob.run(job.id, job.userId, job.requestId || null, serialized, Date.now());
      });
    },
    acceptImageJobs(jobs, session) { return transaction(() => { credits.reserveBatch(jobs, session); for (const job of jobs) store.saveJob(job); }); },
    loadJobs() { return db.prepare('SELECT metadata FROM jobs ORDER BY updated_at').all().map((row) => JSON.parse(row.metadata)); },
    deleteJob(id) { db.prepare('DELETE FROM jobs WHERE id = ?').run(id); },
    prune() {
      db.prepare("DELETE FROM jobs WHERE updated_at < ? AND json_extract(metadata,'$.status') NOT IN ('pending','running')").run(Date.now() - RETENTION_MS);
      identities.prune();
      credits.pruneResults();
    },
    close() { db.close(); },
  };
  store.prune();
  return store;
}
