import type { GenerationContext, GenerationRecipe } from '../../shared/generation-contract.mjs';
import type { CreditCharge, CreditBalance, CreditPrices } from '../../shared/credits-contract.mjs';

export type QueueStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'interrupted' | 'expired' | 'unsubmitted' | 'submitting';
export type QueueClientContext = GenerationContext;

export interface QueueDelivery {
  phase: 'downloading' | 'saving' | 'confirming' | 'error';
  failedPhase?: 'downloading' | 'saving' | 'confirming';
  error?: string;
}

export interface QueueJob {
  id: string;
  requestId: string;
  credit?: CreditCharge | null;
  settlementPending?: boolean;
  delivery?: QueueDelivery;
  status: QueueStatus;
  error: string;
  providerId: string;
  providerName: string;
  retryOf: string;
  supersededBy?: string;
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

export interface QueueListResponse { jobs: QueueJob[]; userId: string; credits: CreditBalance; prices: CreditPrices; globalActive: number; globalQueued: number; averageMs: number; historyCursor?: string; historyTotal?: number }
export interface QueueResult { created?: number; data?: Array<{ b64_json?: string; url?: string; mime_type?: string; width?: number; height?: number; bytes?: number; revised_prompt?: string }> }
