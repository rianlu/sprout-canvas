import type { ResultRecord } from '../types/generation';
import type { QueueJob } from '../types/queue';

export type StudioFeedEntry = { key: string; batchId: string; submittedAt: number } & (
  { kind: 'job'; job: QueueJob } | { kind: 'result'; record: ResultRecord }
);

/** Keep the latest batch together while jobs settle, then fill with recent saved works. */
export function selectStudioFeed(jobs: QueueJob[], records: ResultRecord[], editingSceneId?: string): StudioFeedEntry[] {
  const matchingJobs = jobs.filter((job) => (job.clientContext?.kind ?? 'single') === 'single' || Boolean(editingSceneId && job.clientContext?.sceneId === editingSceneId));
  const byJob = new Map(matchingJobs.map((job) => [job.id, job]));
  const byRequest = new Map(matchingJobs.map((job) => [job.requestId, job]));
  const saved = records.filter((record) => record.kind === 'single' || Boolean(editingSceneId && record.sceneId === editingSceneId));
  const savedJobs = new Set(saved.map((record) => record.jobId).filter(Boolean));
  const savedRequests = new Set(saved.map((record) => record.requestId).filter(Boolean));
  const savedIds = new Set(saved.map((record) => record.id));

  const entries: StudioFeedEntry[] = saved.map((record) => {
    const job = (record.jobId && byJob.get(record.jobId)) || (record.requestId && byRequest.get(record.requestId)) || undefined;
    return {
      kind: 'result', record, key: record.id,
      batchId: record.batchId || job?.clientContext?.batchId || record.requestId || record.id,
      submittedAt: record.submittedAt || job?.queuedAt || record.createdAt,
    };
  });
  for (const job of matchingJobs) {
    if (job.supersededBy || job.archivedAt || savedJobs.has(job.id) || savedRequests.has(job.requestId) || savedIds.has(job.clientContext?.placeholderId || '')) continue;
    if (job.localOnly && job.retryOf && byJob.has(job.retryOf)) continue;
    if (!['pending', 'running', 'failed', 'interrupted', 'expired', 'unsubmitted'].includes(job.status) && !(job.status === 'succeeded' && !job.acknowledgedAt)) continue;
    entries.push({ kind: 'job', job, key: job.clientContext?.placeholderId || job.requestId || job.id, batchId: job.clientContext?.batchId || job.requestId || job.id, submittedAt: job.queuedAt });
  }
  if (!entries.length) return [];

  const latest = [...entries].sort((a, b) => b.submittedAt - a.submittedAt || a.batchId.localeCompare(b.batchId))[0].batchId;
  const current = entries.filter((entry) => entry.batchId === latest).sort((a, b) => a.submittedAt - b.submittedAt || a.key.localeCompare(b.key));
  const primary: StudioFeedEntry[] = [], extra: StudioFeedEntry[] = [];
  const requests = new Set<string>();
  for (const entry of current) {
    const request = entry.kind === 'job' ? entry.job.requestId || entry.key : entry.record.requestId || entry.record.jobId || entry.key;
    (requests.has(request) ? extra : primary).push(entry);
    requests.add(request);
  }
  const recent = entries.filter((entry) => entry.batchId !== latest && entry.kind === 'result').sort((a, b) => {
    const time = (entry: StudioFeedEntry) => entry.kind === 'result' ? entry.record.createdAt : entry.submittedAt;
    return time(b) - time(a) || a.key.localeCompare(b.key);
  });
  return [...primary, ...extra, ...recent].slice(0, 4);
}
