import type { GenerationSubmission } from '../../../shared/generation-contract.mjs';
import type { QueueJob, QueueListResponse, QueueResult } from '../../types/queue';
import { apiFetch } from './client';

export type QueueSubmitInput = GenerationSubmission;
const jsonBody = (input: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
const receivedJob = (job: QueueJob): QueueJob => ({ ...job, receivedAt: performance.now() });
export async function submitQueueJob(input: QueueSubmitInput) { return receivedJob(await apiFetch<QueueJob>('/api/jobs', { method: 'POST', ...jsonBody(input) })); }
export async function submitQueueBatch(jobs: QueueSubmitInput[]) {
  const result = await apiFetch<{ jobs: QueueJob[] }>('/api/jobs/batch', { method: 'POST', ...jsonBody({ jobs }) });
  return { ...result, jobs: Array.isArray(result.jobs) ? result.jobs.map(receivedJob) : result.jobs };
}
export async function listQueueJobs({ cursor = '', requestIds = [], limit = 30, signal }: { cursor?: string; requestIds?: string[]; limit?: number; signal?: AbortSignal } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  if (requestIds.length) query.set('requests', requestIds.join(','));
  const result = await apiFetch<QueueListResponse>(`/api/jobs/me?${query}`, { signal });
  return { ...result, jobs: Array.isArray(result.jobs) ? result.jobs.map(receivedJob) : result.jobs };
}
export function getQueueResult(jobId: string, signal?: AbortSignal) { return apiFetch<QueueResult>(`/api/jobs/${jobId}/result`, { signal }); }
export async function cancelQueueJob(jobId: string) {
  const result = await apiFetch<{ ok: boolean; job: QueueJob }>(`/api/jobs/${jobId}`, { method: 'DELETE' });
  return { ...result, job: receivedJob(result.job) };
}
export async function acknowledgeQueueJob(jobId: string, signal?: AbortSignal) { return receivedJob(await apiFetch<QueueJob>(`/api/jobs/${jobId}/ack`, { method: 'POST', signal })); }
export async function prioritizeQueueJob(jobId: string) { return receivedJob(await apiFetch<QueueJob>(`/api/jobs/${jobId}/priority`, { method: 'POST' })); }
export function archiveQueueJobs() { return apiFetch<{ ok: boolean }>('/api/jobs/archive', { method: 'POST' }); }
export async function archiveQueueJob(jobId: string) { return receivedJob(await apiFetch<QueueJob>(`/api/jobs/${jobId}/archive`, { method: 'POST' })); }
export async function updateQueueJob(jobId: string, input: QueueSubmitInput) { return receivedJob(await apiFetch<QueueJob>(`/api/jobs/${jobId}`, { method: 'PATCH', ...jsonBody(input) })); }
export async function resumeQueueJob(jobId: string, input: QueueSubmitInput) { return receivedJob(await apiFetch<QueueJob>(`/api/jobs/${jobId}/resume`, { method: 'POST', ...jsonBody(input) })); }
