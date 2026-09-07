import type { GenerationSubmission } from '../../../shared/generation-contract.mjs';
import type { QueueJob, QueueListResponse, QueueResult } from '../../types/queue';
import { apiFetch } from './client';

export type QueueSubmitInput = GenerationSubmission;
const jsonBody = (input: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
export function submitQueueJob(input: QueueSubmitInput) { return apiFetch<QueueJob>('/api/jobs', { method: 'POST', ...jsonBody(input) }); }
export function listQueueJobs({ cursor = '', requestIds = [], limit = 30 }: { cursor?: string; requestIds?: string[]; limit?: number } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  if (requestIds.length) query.set('requests', requestIds.join(','));
  return apiFetch<QueueListResponse>(`/api/jobs/me?${query}`);
}
export function getQueueResult(jobId: string) { return apiFetch<QueueResult>(`/api/jobs/${jobId}/result`); }
export function cancelQueueJob(jobId: string) { return apiFetch<{ ok: boolean; job: QueueJob }>(`/api/jobs/${jobId}`, { method: 'DELETE' }); }
export function acknowledgeQueueJob(jobId: string) { return apiFetch<QueueJob>(`/api/jobs/${jobId}/ack`, { method: 'POST' }); }
export function prioritizeQueueJob(jobId: string) { return apiFetch<QueueJob>(`/api/jobs/${jobId}/priority`, { method: 'POST' }); }
export function archiveQueueJobs() { return apiFetch<{ ok: boolean }>('/api/jobs/archive', { method: 'POST' }); }
export function updateQueueJob(jobId: string, input: QueueSubmitInput) { return apiFetch<QueueJob>(`/api/jobs/${jobId}`, { method: 'PATCH', ...jsonBody(input) }); }
export function resumeQueueJob(jobId: string, input: QueueSubmitInput) { return apiFetch<QueueJob>(`/api/jobs/${jobId}/resume`, { method: 'POST', ...jsonBody(input) }); }
