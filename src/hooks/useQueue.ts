import { useCallback, useEffect, useRef, useState } from 'react';
import { acknowledgeQueueJob, archiveQueueJobs, cancelQueueJob, getQueueResult, listQueueJobs, prioritizeQueueJob, resumeQueueJob, submitQueueJob, updateQueueJob, type QueueSubmitInput } from '../lib/api/queue';
import { ApiError } from '../lib/api/client';
import { dataUrlFormat, resultDataUrls } from '../lib/image/format';
import { attachLocalReference, getOutboxInput, isJobConsumed, listOutbox, removeOutbox, saveOutbox, collectUnusedReferences } from '../lib/storage/gallery-db';
import { randomId } from '../lib/random/id';
import { validateGenerationSubmission } from '../../shared/generation-contract.mjs';
import type { ResultRecord } from '../types/generation';
import type { QueueJob } from '../types/queue';

function localJob(input: QueueSubmitInput, savedAt: number, jobId?: string): QueueJob {
  return { id: jobId || `local_${input.requestId}`, requestId: input.requestId, status: jobId ? 'interrupted' : 'unsubmitted', localOnly: true, outcomeUnknown: Boolean(jobId), clientContext: input.clientContext, error: jobId ? '服务端任务记录已过期, 可从本地配方重新生成' : '尚未确认提交, 可继续提交', canRetry: true, retryOf: input.retryOf || '', providerId: '', providerName: '', yourPosition: 0, yourQueued: 0, globalActive: 0, globalQueued: 0, averageMs: 0, estimatedWaitMs: 0, queuedAt: savedAt, startedAt: 0, finishedAt: 0, elapsedMs: 0 };
}

export function useQueue(onResult: (records: ResultRecord[], jobId: string) => Promise<unknown>, enabled = true) {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [globalActive, setGlobalActive] = useState(0);
  const [globalQueued, setGlobalQueued] = useState(0);
  const [error, setError] = useState('');
  const [historyCursor, setHistoryCursor] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const historyCache = useRef(new Map<string, QueueJob>());
  const historyExpanded = useRef(false);
  const retrying = useRef(new Map<string, Promise<QueueJob>>());
  const handled = useRef(new Set<string>());
  const workRef = useRef(false);
  const polling = useRef<Promise<void> | null>(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const tick = useCallback(async () => {
    if (!enabled) return;
    if (polling.current) return polling.current;
    const operation = (async () => {
      const outbox = await listOutbox();
      const data = await listQueueJobs({ requestIds: outbox.slice(0, 100).map((row) => row.requestId) });
      const latest = [...(data.jobs || [])];
      for (let offset = 100; offset < outbox.length; offset += 100) latest.push(...(await listQueueJobs({ limit: 1, requestIds: outbox.slice(offset, offset + 100).map((row) => row.requestId) })).jobs);
      if (!historyExpanded.current) setHistoryCursor(data.historyCursor || '');
      for (const job of latest) if (historyCache.current.has(job.id)) historyCache.current.set(job.id, job);
      const serverJobs = [...new Map([...historyCache.current.values(), ...latest].map((job) => [job.id, job])).values()];
      const visible = serverJobs.filter((job) => !job.archivedAt).map((job) => ({ ...job, canRetry: ['failed', 'expired', 'interrupted'].includes(job.status) && outbox.some((row) => row.requestId === job.requestId) }));
      for (const row of outbox) if (!serverJobs.some((job) => job.requestId === row.requestId) && !(row.jobId && await isJobConsumed(row.jobId))) visible.push(localJob(row.input, row.savedAt, row.jobId));
      setJobs(visible);
      jobsRef.current = visible;
      setGlobalActive(data.globalActive || 0);
      setGlobalQueued(data.globalQueued || 0);
      workRef.current = visible.some((job) => ['running', 'pending'].includes(job.status));
      let failure = '';
      for (const job of serverJobs.sort((a, b) => a.finishedAt - b.finishedAt)) {
        if (!['succeeded', 'expired'].includes(job.status) || handled.current.has(job.id)) continue;
        try {
          if (job.acknowledgedAt || await isJobConsumed(job.id)) {
            if (!job.acknowledgedAt) await acknowledgeQueueJob(job.id);
            handled.current.add(job.id);
            if (job.requestId) await removeOutbox(job.requestId);
            continue;
          }
          if (job.status !== 'succeeded') continue;
          const result = await getQueueResult(job.id);
          const images = await resultDataUrls(result);
          const context = job.clientContext;
          if (!images.length || !context) throw new Error('任务未返回可保存的作品');
          const records: ResultRecord[] = images.map((dataUrl, index) => ({
            id: index === 0 ? context.placeholderId : `${context.placeholderId}-${index + 1}`,
            prompt: context.prompt, dataUrl, providerId: job.providerId, providerName: job.providerName,
            mode: context.mode, kind: context.kind, outputFormat: dataUrlFormat(dataUrl) || 'png',
            createdAt: job.finishedAt || (result.created || 0) * 1000 || job.queuedAt,
            jobId: job.id, requestId: job.requestId, seriesId: context.seriesId, masterPrompt: context.masterPrompt,
            sceneId: context.sceneId, sceneIndex: context.sceneIndex, version: context.version,
            parentId: context.parentId, template: context.template, recipe: job.recipe || undefined,
            revisedPrompt: result.data?.[index]?.revised_prompt,
            width: result.data?.[index]?.width, height: result.data?.[index]?.height, bytes: result.data?.[index]?.bytes,
          }));
          await onResult(records, job.id);
          await acknowledgeQueueJob(job.id);
          handled.current.add(job.id);
          if (job.requestId) await removeOutbox(job.requestId);
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 401) throw cause;
          failure = cause instanceof Error ? cause.message : '图片保存失败';
        }
      }
      setError(failure ? `作品尚未保存: ${failure}. 请保持页面打开并重试.` : '');
    })();
    polling.current = operation;
    try { await operation; }
    catch (cause) { if (!(cause instanceof ApiError && cause.status === 401)) setError(cause instanceof Error ? cause.message : '队列连接失败'); }
    finally { polling.current = null; }
  }, [enabled, onResult]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer = 0;
    async function poll() {
      await tick();
      if (!stopped && !document.hidden) timer = window.setTimeout(poll, workRef.current ? 2000 : 5000);
    }
    function visibility() { window.clearTimeout(timer); if (!document.hidden) void poll(); }
    void poll();
    document.addEventListener('visibilitychange', visibility);
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [enabled, tick]);

  const submit = useCallback(async (value: QueueSubmitInput) => {
    const input = validateGenerationSubmission(await attachLocalReference(value));
    await saveOutbox(input);
    try {
      const job = await submitQueueJob(input);
      await saveOutbox(input, job.id);
      setJobs((current) => [job, ...current.filter((item) => item.requestId !== job.requestId)]);
      return job;
    } catch (cause) { await tick(); throw cause; }
  }, [tick]);

  const submitBatch = useCallback(async (inputs: QueueSubmitInput[]) => {
    for (const input of inputs) await saveOutbox(validateGenerationSubmission(input));
    const accepted: QueueJob[] = [];
    for (const input of inputs) accepted.push(await submit(input));
    return accepted;
  }, [submit]);

  const cancel = useCallback(async (jobId: string) => {
    const source = jobsRef.current.find((job) => job.id === jobId);
    if (source?.localOnly) await removeOutbox(source.requestId);
    else {
      await cancelQueueJob(jobId);
      if (source?.requestId) await removeOutbox(source.requestId);
    }
    await collectUnusedReferences();
    await tick();
  }, [tick]);

  const retry = useCallback(async (jobId: string) => {
    if (retrying.current.has(jobId)) return retrying.current.get(jobId)!;
    const operation = (async () => {
    const source = jobsRef.current.find((job) => job.id === jobId);
    if (!source) throw new Error('任务不存在');
    const input = await getOutboxInput(source.requestId);
    if (!input) throw new Error('本地原始配方不存在, 请回到创作页重新填写');
    if (source.status === 'unsubmitted') return submit(input);
    if (source.interruptionReason === 'pending-restart' && !source.outcomeUnknown) {
      const restored = await attachLocalReference(input);
      const job = await resumeQueueJob(jobId, restored);
      await saveOutbox(restored, job.id);
      await tick();
      return job;
    }
    if (source.outcomeUnknown && !window.confirm('上一次生成的结果未知. 重新生成可能重复计费, 是否继续?')) throw new Error('已取消重新生成');
    const queuedRetry = (await listOutbox()).find((row) => row.input.retryOf === jobId);
    if (queuedRetry) {
      const retryInput = await getOutboxInput(queuedRetry.requestId);
      if (retryInput) return submit(retryInput);
    }
    const next = { ...input, requestId: randomId(), providerId: undefined, retryOf: source.localOnly ? undefined : jobId, clientContext: { ...input.clientContext, placeholderId: randomId(), parentId: input.clientContext.placeholderId, version: (input.clientContext.version || 1) + 1 } };
    if (source.localOnly && next.referenceJobId) {
      const restored = await attachLocalReference(next);
      if (!restored.referenceImage) throw new Error('原参考任务已过期, 请从本地作品重新选择参考图');
      next.request = { ...next.request, references: [restored.referenceImage, ...next.request.references].slice(0, 4) };
      delete next.referenceJobId; delete next.referenceImage;
    }
    const job = await submit(next);
    if (source.localOnly) await removeOutbox(source.requestId);
    await tick();
    return job;
    })();
    retrying.current.set(jobId, operation);
    try { return await operation; } finally { retrying.current.delete(jobId); }
  }, [submit, tick]);

  const update = useCallback(async (jobId: string, input: QueueSubmitInput) => {
    const previous = await getOutboxInput(input.requestId);
    await saveOutbox(validateGenerationSubmission(input), jobId);
    let job;
    try { job = await updateQueueJob(jobId, input); }
    catch (cause) {
      if (previous && cause instanceof ApiError && cause.status >= 400 && cause.status < 500) await saveOutbox(previous, jobId);
      throw cause;
    }
    await tick();
    return job;
  }, [tick]);
  const prioritize = useCallback(async (jobId: string) => { await prioritizeQueueJob(jobId); await tick(); }, [tick]);
  const archive = useCallback(async () => { await archiveQueueJobs(); historyCache.current.clear(); historyExpanded.current = false; await tick(); }, [tick]);
  const loadMore = useCallback(async () => {
    if (!historyCursor || loadingHistory) return;
    setLoadingHistory(true);
    try {
      const page = await listQueueJobs({ cursor: historyCursor });
      for (const job of [...jobsRef.current, ...page.jobs]) if (!['pending', 'running', 'unsubmitted'].includes(job.status) && !job.localOnly) historyCache.current.set(job.id, job);
      historyExpanded.current = true;
      setHistoryCursor(page.historyCursor || '');
      await tick();
    } finally { setLoadingHistory(false); }
  }, [historyCursor, loadingHistory, tick]);
  return { jobs, globalActive, globalQueued, error, submit, submitBatch, cancel, retry, update, prioritize, archive, refresh: tick, loadMore, hasMore: Boolean(historyCursor), loadingHistory };
}
