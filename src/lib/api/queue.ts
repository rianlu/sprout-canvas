import type { QueueClientContext, QueueJob, QueueListResponse } from '../../types/queue';
import { apiFetch } from './client';

export interface QueueSubmitInput {
  endpoint: '/v1/images/generations' | '/v1/images/edits' | '/v1/responses';
  body: BodyInit;
  contentType: string;
  providerId?: string;
  clientContext: QueueClientContext;
}

function encodeClientContext(context: QueueClientContext) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(context))));
}

export function submitQueueJob(input: QueueSubmitInput) {
  const headers: Record<string, string> = {
    'Content-Type': input.contentType,
    'X-Client-Context': encodeClientContext(input.clientContext),
  };
  if (input.providerId) headers['X-Provider-Id'] = input.providerId;
  return apiFetch<QueueJob>(`/api/jobs${input.endpoint.replace(/^\/v1/, '')}`, {
    method: 'POST',
    headers,
    body: input.body,
  });
}

export function listQueueJobs() {
  return apiFetch<QueueListResponse>('/api/jobs/me');
}

export function getQueueResult(jobId: string) {
  return apiFetch<{ data?: Array<{ b64_json?: string; url?: string }> }>(`/api/jobs/${jobId}/result`);
}

export function cancelQueueJob(jobId: string) {
  return apiFetch<{ ok: boolean; job: QueueJob }>(`/api/jobs/${jobId}`, { method: 'DELETE' });
}

export function retryQueueJob(jobId: string) {
  return apiFetch<{ ok: boolean; job: QueueJob }>(`/api/jobs/${jobId}/retry`, { method: 'POST' });
}
