import type { GenerationContext, GenerationRecipe } from '../../shared/generation-contract.mjs';

export type QueueStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'interrupted' | 'expired' | 'unsubmitted';
export type QueueClientContext = GenerationContext;

export interface QueueJob {
  id: string;
  requestId: string;
  status: QueueStatus;
  error: string;
  providerId: string;
  providerName: string;
  retryOf: string;
  canRetry: boolean;
  clientContext?: QueueClientContext | null;
  recipe?: GenerationRecipe | null;
  referenceJobId?: string;
  acknowledgedAt?: number;
  archivedAt?: number;
  localOnly?: boolean;
  outcomeUnknown?: boolean;
  interruptionReason?: string;
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

export interface QueueListResponse { jobs: QueueJob[]; globalActive: number; globalQueued: number; averageMs: number; historyCursor?: string; historyTotal?: number }
export interface QueueResult { created?: number; data?: Array<{ b64_json?: string; url?: string; mime_type?: string; width?: number; height?: number; bytes?: number; revised_prompt?: string }> }
