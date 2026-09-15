import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { acknowledgeQueueJob, getQueueResult } from '../lib/api/queue';
import { ApiError } from '../lib/api/client';
import { dataUrlFormat, resultDataUrls } from '../lib/image/format';
import { completeWorkspaceRequest, isJobConsumed, removeOutbox } from '../lib/storage/gallery-db';
import type { ResultRecord } from '../types/generation';
import type { QueueDelivery, QueueJob } from '../types/queue';

const MAX_DOWNLOADS = 2;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const ACK_TIMEOUT_MS = 15_000;

/** Receive completed jobs independently of metadata polling. Never resubmit a generation. */
export function useQueueDelivery(onResult: (records: ResultRecord[], jobId: string) => Promise<unknown>, enabled: boolean, ownerId: string) {
  const scope = useMemo(() => ({
    enabled, ownerId, stopped: false, timer: 0,
    jobs: new Map<string, QueueJob>(),
    active: new Map<string, AbortController>(),
    handled: new Set<string>(),
    retryAt: new Map<string, number>(),
    attempts: new Map<string, number>(),
    states: new Map<string, QueueDelivery>(),
  }), [enabled, ownerId]);
  const current = useRef(scope);
  current.current = scope;
  const [, redraw] = useReducer((value: number) => value + 1, 0);
  const pumpRef = useRef<() => void>(() => {});

  const collect = useCallback(async (job: QueueJob, controller: AbortController) => {
    const isCurrent = () => current.current === scope && !scope.stopped && !controller.signal.aborted;
    const setPhase = (phase: QueueDelivery['phase']) => {
      if (isCurrent()) { scope.states.set(job.id, { phase }); redraw(); }
    };
    let phase: NonNullable<QueueDelivery['failedPhase']> = 'downloading';
    try {
      const consumed = await isJobConsumed(job.id);
      if (!isCurrent()) return;
      if (!job.acknowledgedAt && !consumed) {
        if (job.status !== 'succeeded') {
          scope.jobs.delete(job.id); scope.states.delete(job.id);
          scope.retryAt.delete(job.id); scope.attempts.delete(job.id);
          redraw();
          return;
        }
        phase = 'downloading';
        setPhase(phase);
        const result = await getQueueResult(job.id, AbortSignal.any([controller.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]));
        if (!isCurrent()) return;
        if (!result?.data?.length) throw new Error('原图下载不完整, 请重试领取');
        const images = await resultDataUrls(result);
        if (!isCurrent()) return;
        const context = job.clientContext;
        if (!images.length || !context) throw new Error('任务未返回可保存的作品');
        const records: ResultRecord[] = images.map((dataUrl, index) => ({
          id: index === 0 ? context.placeholderId : context.placeholderId + '-' + (index + 1),
          prompt: context.prompt, dataUrl, providerId: job.providerId, providerName: job.providerName,
          mode: context.mode, kind: context.kind, outputFormat: dataUrlFormat(dataUrl) || 'png',
          createdAt: job.finishedAt || (result.created || 0) * 1000 || job.queuedAt,
          jobId: job.id, requestId: job.requestId, seriesId: context.seriesId, masterPrompt: context.masterPrompt,
          batchId: context.batchId, submittedAt: job.queuedAt,
          sceneId: context.sceneId, sceneIndex: context.sceneIndex, version: context.version,
          parentId: context.parentId, template: context.template, recipe: job.recipe || undefined,
          revisedPrompt: result.data?.[index]?.revised_prompt,
          width: result.data?.[index]?.width, height: result.data?.[index]?.height, bytes: result.data?.[index]?.bytes,
        }));
        phase = 'saving';
        setPhase(phase);
        await onResult(records, job.id);
        if (!isCurrent()) return;
      }
      phase = 'confirming';
      setPhase(phase);
      if (consumed || !job.acknowledgedAt) await completeWorkspaceRequest(job.requestId);
      if (!isCurrent()) return;
      if (!job.acknowledgedAt) {
        const receipt = await acknowledgeQueueJob(job.id, AbortSignal.any([controller.signal, AbortSignal.timeout(ACK_TIMEOUT_MS)]));
        if (!receipt?.acknowledgedAt || receipt.id !== job.id) throw new Error('领取确认未完成, 作品已保存到本地');
      }
      if (!isCurrent()) return;
      if (job.requestId) await removeOutbox(job.requestId);
      if (!isCurrent()) return;
      scope.handled.add(job.id);
      scope.jobs.delete(job.id);
      scope.states.delete(job.id);
      scope.retryAt.delete(job.id);
      scope.attempts.delete(job.id);
      redraw();
    } catch (cause) {
      if (!isCurrent()) return;
      const error = cause instanceof Error && cause.name === 'TimeoutError'
        ? phase === 'downloading' ? '原图下载超时, 可重新领取' : '领取确认超时, 作品已保存到本地'
        : cause instanceof Error ? cause.message : '作品领取失败';
      scope.states.set(job.id, { phase: 'error', failedPhase: phase, error });
      const attempts = (scope.attempts.get(job.id) || 0) + 1;
      scope.attempts.set(job.id, attempts);
      scope.retryAt.set(job.id, cause instanceof ApiError && cause.status === 401 ? Infinity : Date.now() + Math.min(30_000, 5000 * 2 ** Math.min(attempts - 1, 3)));
      redraw();
    }
  }, [scope, onResult]);

  const pump = useCallback(() => {
    if (current.current !== scope || scope.stopped || !scope.enabled || !scope.ownerId) return;
    window.clearTimeout(scope.timer);
    for (const job of [...scope.jobs.values()].sort((a, b) => a.finishedAt - b.finishedAt)) {
      if (scope.active.size >= MAX_DOWNLOADS) break;
      if (scope.active.has(job.id) || scope.handled.has(job.id) || (scope.retryAt.get(job.id) || 0) > Date.now()) continue;
      const controller = new AbortController();
      scope.active.set(job.id, controller);
      void collect(job, controller).finally(() => {
        if (scope.active.get(job.id) === controller) scope.active.delete(job.id);
        if (current.current === scope && !scope.stopped) pumpRef.current();
      });
    }
    const next = Math.min(...[...scope.retryAt.entries()]
      .filter(([id, time]) => scope.jobs.has(id) && !scope.active.has(id) && Number.isFinite(time))
      .map(([, time]) => time));
    if (scope.active.size < MAX_DOWNLOADS && Number.isFinite(next)) scope.timer = window.setTimeout(() => pumpRef.current(), Math.max(100, next - Date.now()));
  }, [scope, collect]);
  pumpRef.current = pump;

  useEffect(() => {
    scope.stopped = false;
    return () => {
      scope.stopped = true;
      window.clearTimeout(scope.timer);
      for (const controller of scope.active.values()) controller.abort();
    };
  }, [scope]);

  const enqueue = useCallback((jobs: QueueJob[]) => {
    if (current.current !== scope || scope.stopped) return;
    for (const job of jobs) if (['succeeded', 'expired'].includes(job.status) && !scope.handled.has(job.id)) scope.jobs.set(job.id, job);
    pump();
  }, [scope, pump]);

  const retry = useCallback((jobId?: string) => {
    for (const [id, state] of scope.states) if ((!jobId || jobId === id) && state.phase === 'error') {
      scope.retryAt.delete(id);
      scope.attempts.delete(id);
    }
    pump();
  }, [scope, pump]);

  const failure = [...scope.states.values()].find((state) => state.phase === 'error');
  const error = failure ? (failure.failedPhase === 'confirming' ? '作品已保存, 领取确认待重试: ' : '作品尚未保存: ') + failure.error : '';
  return { enqueue, retry, states: scope.states, error };
}
