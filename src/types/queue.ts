export type QueueStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface QueueClientContext {
  kind: 'single' | 'series';
  placeholderId: string;
  prompt: string;
  mode: string;
  outputFormat?: 'auto' | 'png' | 'jpeg' | 'webp';
  /** 系列聚合 (v3.5): 系列页提交时带上, 回填结果按系列分组 */
  seriesId?: string;
  masterPrompt?: string;
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
  estimatedWaitMs: number;
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
