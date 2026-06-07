export type QueueStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface QueueClientContext {
  kind: 'single' | 'series';
  placeholderId: string;
  prompt: string;
  mode: string;
  outputFormat?: 'auto' | 'png' | 'jpeg' | 'webp';
}

export interface QueueJob {
  id: string;
  status: QueueStatus;
  error: string;
  providerId: string;
  providerName: string;
  retryOf: string;
  canRetry: boolean;
  clientContext?: QueueClientContext | null;
  yourPosition: number;
  yourQueued: number;
  globalActive: number;
  globalQueued: number;
  averageMs: number;
  queuedAt: number;
  startedAt: number;
  finishedAt: number;
  elapsedMs: number;
}

export interface QueueListResponse {
  jobs: QueueJob[];
  globalActive: number;
  globalQueued: number;
  averageMs: number;
}
